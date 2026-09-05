import { Logger } from '@nestjs/common';
import { LineStringGeoJson } from '../gtfs/shape-geometry';
import { decoderPolyligne } from './polyline.util';

// =============================================================================
// Client Valhalla — un seul point d'appel pour tous les profils
// =============================================================================
// ═══ POURQUOI CE FICHIER EXISTE ═══
//
// Le routage piéton et le routage vélo interrogent LE MÊME moteur, à la même
// adresse, avec la même forme de requête et la même forme de réponse. Seul le
// `costing` change (`pedestrian` / `bicycle`). Dupliquer le `fetch`, le
// décodage de polyligne et la vérification de réponse dans deux services
// aurait produit deux copies qui divergent au premier ajustement.
//
// ═══ CE QU'IL NE FAIT PAS ═══
//
// Il ne connaît pas le disjoncteur, ni les variables d'environnement, ni la
// notion de « service configuré ». Ce sont des décisions de service, pas de
// client. Lui, il appelle et il traduit — ou il dit franchement qu'il a
// échoué, ce que le disjoncteur du service saura interpréter.
// =============================================================================

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

/** Profils de coût acceptés. Voir la documentation Valhalla. */
export type ProfilValhalla = 'pedestrian' | 'bicycle';

export interface PointGeo {
  latitude: number;
  longitude: number;
}

/**
 * Un trajet calculé par le moteur, rue par rue.
 *
 * ⚠️ TOUT VIENT DU MOTEUR, RIEN N'EST DÉDUIT. La distance est celle des voies
 * réellement empruntées — systématiquement SUPÉRIEURE au vol d'oiseau — et la
 * durée celle que le moteur calcule sur son propre profil, pente et type de
 * voie compris. Recalculer l'une à partir de l'autre remplacerait une mesure
 * par une estimation.
 */
export interface RouteGeometrieDto {
  distanceM: number;
  durationMin: number;
  /** Tracé en GeoJSON `LineString` (`[longitude, latitude]`). */
  geometry: LineStringGeoJson;
}

/**
 * Résultat d'un appel, en trois cas STRICTEMENT DISTINCTS :
 *
 *   `{ route }`    un vrai trajet ;
 *   `{ route: null }` le moteur a répondu correctement « aucun chemin ». Ce
 *                  n'est PAS une panne — un trajet peut être impossible à pied ;
 *   `{ erreur }`   le moteur est en mauvais état (injoignable, HTTP en erreur,
 *                  réponse illisible). C'est CE cas, et lui seul, qui doit
 *                  faire réagir un disjoncteur.
 */
export type ResultatValhalla =
  { route: RouteGeometrieDto } | { route: null } | { erreur: true };

/** Forme partielle de la réponse — seuls les champs consommés. */
interface ReponseValhalla {
  trip?: {
    legs?: {
      shape?: unknown;
      summary?: { length?: unknown; time?: unknown };
    }[];
  };
}

/**
 * Interroge Valhalla pour un profil donné. NE LÈVE JAMAIS.
 */
export async function itineraireValhalla(
  logger: Logger,
  baseUrl: string,
  profil: ProfilValhalla,
  depuis: PointGeo,
  vers: PointGeo,
): Promise<ResultatValhalla> {
  try {
    const reponse = await fetch(`${baseUrl.replace(/\/+$/, '')}/route`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        locations: [
          { lat: depuis.latitude, lon: depuis.longitude },
          { lat: vers.latitude, lon: vers.longitude },
        ],
        costing: profil,
        directions_options: { units: 'kilometers' },
      }),
      signal: AbortSignal.timeout(DELAI_MS),
    });

    if (!reponse.ok) {
      logger.warn(`Valhalla (${profil}) : HTTP ${reponse.status}.`);
      return { erreur: true };
    }

    return lire(logger, profil, (await reponse.json()) as ReponseValhalla);
  } catch (erreur) {
    // ⚠️ ON NE JOURNALISE PAS LES COORDONNÉES. Un trajet dit où quelqu'un part
    // et où il va : les voir dans les journaux à chaque panne reviendrait à
    // constituer un historique par accident.
    logger.warn(
      `Valhalla (${profil}) injoignable (${
        erreur instanceof Error ? erreur.name : 'erreur inconnue'
      }).`,
    );
    return { erreur: true };
  }
}

/**
 * Traduit la réponse. ⚠️ CHAQUE CHAMP EST VÉRIFIÉ — un fournisseur externe
 * n'est pas un contrat qu'on maîtrise, et le caster ferait passer un
 * `undefined` jusqu'à une carte qui tenterait de le dessiner.
 */
function lire(
  logger: Logger,
  profil: ProfilValhalla,
  corps: ReponseValhalla,
): ResultatValhalla {
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
    logger.warn(`Valhalla (${profil}) : réponse inexploitable.`);
    return { erreur: true };
  }

  const points = decoderPolyligne(forme, PRECISION_VALHALLA);

  // Un tracé d'un seul point ne se dessine pas — et signale une réponse
  // dégradée qu'il vaut mieux traiter comme une absence de chemin.
  if (points.length < 2) {
    return { route: null };
  }

  return {
    route: {
      distanceM: Math.round(longueurKm * 1000),
      // ⚠️ MINIMUM UNE MINUTE : « 0 min » se lit « vous y êtes », faux à
      // cinquante mètres.
      durationMin: Math.max(1, Math.round(secondes / 60)),
      geometry: {
        type: 'LineString',
        // ⚠️ GeoJSON impose [longitude, latitude] — l'inverse de l'ordre du
        // décodeur et de Leaflet. Une inversion place Strasbourg en Somalie.
        coordinates: points.map(([lat, lon]) => [lon, lat]),
      },
    },
  };
}
