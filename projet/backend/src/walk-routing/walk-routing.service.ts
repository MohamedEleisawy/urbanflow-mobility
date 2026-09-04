import { Injectable, Logger } from '@nestjs/common';
import { capabilitiesConfig } from '../config/capabilities.config';
import { LineStringGeoJson } from '../gtfs/shape-geometry';
import { decoderPolyligne } from './polyline.util';
import { WalkRouteDto } from './dto/walk-route.dto';

// =============================================================================
// Routage piéton réel
// =============================================================================
// ═══ LE MENSONGE QUE CE SERVICE SUPPRIME ═══
//
// La marche était tracée par une DROITE entre deux points. Sur une carte, cette
// droite traverse les immeubles, les jardins et les voies ferrées — et sa
// longueur est systématiquement inférieure au chemin réel. Mesuré sur le trajet
// de démonstration : 240 m à vol d'oiseau contre 327 m par les rues, soit 36 %
// d'écart.
//
// Une droite n'est pas un itinéraire piéton. Ce service en calcule un vrai.
//
// ═══ CE QUI EST CACHÉ DERRIÈRE CETTE FRONTIÈRE ═══
//
// Le frontend ne connaît QUE `walkAccess` / `walkEgress` et leur `source`. Il
// ignore quel moteur les a produits, et n'appelle jamais un fournisseur
// extérieur lui-même : changer de moteur ne touchera pas une ligne d'interface.
//
// ═══ CE SERVICE NE LÈVE JAMAIS ═══
//
// ⚠️ `null` EST UNE RÉPONSE NORMALE : moteur non configuré, injoignable, en
// erreur, ou sans chemin. L'appelant retombe alors sur l'estimation à vol
// d'oiseau, marquée `ESTIMATE` — et l'interface le DIT. Une recherche
// d'itinéraire ne doit jamais échouer parce qu'un routeur piéton est en panne.
// =============================================================================

/**
 * Profil de coût demandé au moteur.
 *
 * ⚠️ `pedestrian`, ET JAMAIS UN PROFIL AUTOMOBILE. Un moteur voiture évite les
 * ruelles, ignore les passages piétons et les escaliers, et respecte des sens
 * interdits qui ne s'appliquent pas à un piéton. Le tracé serait plausible et
 * faux — bien plus trompeur qu'une droite assumée.
 */
const PROFIL_PIETON = 'pedestrian';

/**
 * Précision d'encodage des polylignes de Valhalla : 10⁻⁶ degré.
 *
 * ⚠️ CE N'EST PAS LA CONVENTION DE GOOGLE NI D'OSRM (10⁻⁵). Se tromper d'un
 * facteur dix place le tracé en mer du Nord sans lever la moindre erreur.
 */
const PRECISION_VALHALLA = 6;

/**
 * Délai au-delà duquel on renonce au moteur.
 *
 * ⚠️ COURT, ET DÉLIBÉRÉMENT. Ce calcul s'insère dans une recherche
 * d'itinéraire que l'usager attend : mieux vaut une estimation immédiate,
 * annoncée comme telle, qu'un tracé exact au bout de dix secondes.
 */
const DELAI_MS = 4_000;

/** Forme partielle de la réponse Valhalla — seuls les champs consommés. */
interface ReponseValhalla {
  trip?: {
    legs?: {
      shape?: unknown;
      summary?: { length?: unknown; time?: unknown };
    }[];
  };
}

export interface PointGeo {
  latitude: number;
  longitude: number;
}

@Injectable()
export class WalkRoutingService {
  private readonly logger = new Logger(WalkRoutingService.name);

  /**
   * Le moteur est-il configuré ?
   *
   * Lu à CHAQUE APPEL et non figé au démarrage : `GET /api/capabilities` doit
   * pouvoir refléter un changement d'environnement sans redémarrage, et les
   * tests doivent pouvoir basculer d'un cas à l'autre.
   */
  estConfigure(): boolean {
    return capabilitiesConfig().walkRouting.status === 'CONFIGURED';
  }

  /**
   * Calcule un vrai trajet à pied entre deux points.
   *
   * @returns le trajet rue par rue, ou `null` si aucun moteur n'est configuré
   *   ou s'il n'a rien pu rendre. JAMAIS d'exception.
   */
  async itineraire(
    depuis: PointGeo,
    vers: PointGeo,
  ): Promise<WalkRouteDto | null> {
    const base = process.env.WALK_ROUTING_BASE_URL?.trim();

    if (!this.estConfigure() || !base) {
      return null;
    }

    // ⚠️ DEUX POINTS CONFONDUS N'ONT PAS D'ITINÉRAIRE. Le moteur répondrait
    // par une erreur ; on s'épargne l'aller-retour.
    if (
      depuis.latitude === vers.latitude &&
      depuis.longitude === vers.longitude
    ) {
      return null;
    }

    try {
      const reponse = await fetch(`${base.replace(/\/+$/, '')}/route`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          locations: [
            { lat: depuis.latitude, lon: depuis.longitude },
            { lat: vers.latitude, lon: vers.longitude },
          ],
          costing: PROFIL_PIETON,
          directions_options: { units: 'kilometers' },
        }),
        signal: AbortSignal.timeout(DELAI_MS),
      });

      if (!reponse.ok) {
        this.logger.warn(
          `Routeur piéton : HTTP ${reponse.status}. Repli sur l'estimation.`,
        );
        return null;
      }

      return this.lire((await reponse.json()) as ReponseValhalla);
    } catch (erreur) {
      // ⚠️ ON NE JOURNALISE PAS LES COORDONNÉES. Un trajet à pied dit où
      // quelqu'un part et où il va : les voir dans les journaux du serveur à
      // chaque panne reviendrait à constituer un historique par accident.
      this.logger.warn(
        `Routeur piéton injoignable (${
          erreur instanceof Error ? erreur.name : 'erreur inconnue'
        }). Repli sur l'estimation.`,
      );
      return null;
    }
  }

  /**
   * Traduit la réponse du moteur, ou rend `null`.
   *
   * ⚠️ CHAQUE CHAMP EST VÉRIFIÉ. Un fournisseur externe n'est pas un contrat
   * qu'on maîtrise ; le caster ferait passer un `undefined` jusqu'à une carte
   * qui tenterait de le dessiner.
   */
  private lire(corps: ReponseValhalla): WalkRouteDto | null {
    const leg = corps.trip?.legs?.[0];
    const forme = leg?.shape;
    const longueurKm = leg?.summary?.length;
    const secondes = leg?.summary?.time;

    if (
      typeof forme !== 'string' ||
      typeof longueurKm !== 'number' ||
      typeof secondes !== 'number' ||
      !Number.isFinite(longueurKm) ||
      !Number.isFinite(secondes)
    ) {
      this.logger.warn('Routeur piéton : réponse inexploitable.');
      return null;
    }

    const points = decoderPolyligne(forme, PRECISION_VALHALLA);

    // Un tracé d'un seul point ne se dessine pas — et signale une réponse
    // dégradée qu'il vaut mieux traiter comme une absence.
    if (points.length < 2) {
      return null;
    }

    const geometry: LineStringGeoJson = {
      type: 'LineString',
      // ⚠️ GeoJSON impose [longitude, latitude] — l'inverse de l'ordre rendu
      // par le décodeur, et de celui de Leaflet. Une inversion ne lève aucune
      // erreur : elle place simplement Strasbourg en Somalie.
      coordinates: points.map(([lat, lon]) => [lon, lat]),
    };

    return {
      distanceM: Math.round(longueurKm * 1000),
      // ⚠️ MINIMUM UNE MINUTE, comme l'estimation : « 0 min de marche » se lit
      // « vous y êtes », ce qui est faux à cinquante mètres.
      durationMin: Math.max(1, Math.round(secondes / 60)),
      geometry,
    };
  }
}
