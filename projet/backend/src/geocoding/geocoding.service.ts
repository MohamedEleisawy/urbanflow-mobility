import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { territoryConfig } from '../config/territory.config';
import { GeocodingQueryDto } from './dto/geocoding-query.dto';
import {
  GeocodingResponseDto,
  GeocodingResultDto,
} from './dto/geocoding-result.dto';

// =============================================================================
// Recherche d'adresses (Phase 3A)
// =============================================================================
// ═══ POURQUOI UN PROXY, ET NON UN APPEL DEPUIS LE NAVIGATEUR ═══
//
// Quatre raisons, dont trois seraient bloquantes :
//
// 1. LA POLITIQUE DU FOURNISSEUR. Nominatim exige un `User-Agent` identifiant
//    l'application. Un navigateur ne laisse PAS écrire cet en-tête — il est
//    interdit par la spécification fetch. Depuis le frontend, la règle serait
//    donc impossible à respecter, et le service en droit de nous bloquer.
//
// 2. LE PLAFOND D'UNE REQUÊTE PAR SECONDE se raisonne côté serveur. Réparti
//    sur N navigateurs, personne ne sait combien de requêtes partent vraiment.
//
// 3. LE CONTRAT PUBLIC. Le frontend ne connaît que `/api/geocoding/search` :
//    changer de fournisseur ne touchera pas une ligne d'interface.
//
// 4. LA MINIMISATION. Nominatim rend une vingtaine de champs par résultat ;
//    trois seulement sortent d'ici.
//
// ═══ CE QUE CE SERVICE N'EST PAS ═══
//
// Il n'écrit RIEN. Aucune table, aucun Prisma, aucun historique de recherche.
// Une adresse saisie est une donnée personnelle sensible — elle traverse ce
// service et n'y laisse aucune trace.
// =============================================================================

/// Point d'entrée public de Nominatim.
const URL_PAR_DEFAUT = 'https://nominatim.openstreetmap.org';

/**
 * Identification de l'application, exigée par la politique d'usage de
 * Nominatim.
 *
 * ⚠️ Une requête sans `User-Agent` explicite est refusée, et c'est légitime :
 * le service est gratuit, il doit pouvoir joindre l'exploitant d'un client
 * abusif. C'est aussi pourquoi cet appel ne peut pas vivre dans le navigateur,
 * qui interdit d'écrire cet en-tête.
 */
const USER_AGENT =
  'UrbanFlowMobility/1.0 (projet etudiant B3DEV ; contact via depot)';

/// Mention d'attribution imposée par la licence ODbL d'OpenStreetMap.
const ATTRIBUTION = '© Contributeurs OpenStreetMap';

/**
 * Nombre maximal de propositions rendues.
 *
 * Cinq : au-delà, une liste déroulante devient une liste à parcourir, et le
 * choix ralentit au lieu d'aller plus vite. C'est aussi moins d'octets
 * transportés pour un résultat que l'usager ne lira pas.
 */
const LIMITE_RESULTATS = 5;

/// Délai au-delà duquel on cesse d'attendre le fournisseur.
const DELAI_MS = 5_000;

/**
 * Degrés de latitude par mètre. Un degré vaut ~111 320 m partout sur le globe.
 *
 * Sert à traduire le rayon du territoire — exprimé en mètres — en une boîte
 * englobante que Nominatim comprend.
 */
const DEGRES_LAT_PAR_METRE = 1 / 111_320;

/**
 * Marge ajoutée au rayon du territoire pour la boîte de recherche.
 *
 * ⚠️ LA BOÎTE EST PLUS LARGE QUE LE TERRITOIRE, ET C'EST VOULU. Quelqu'un
 * cherche couramment une adresse juste au-delà de la limite administrative —
 * une commune voisine, une gare de correspondance. Coller la boîte au rayon
 * exact refuserait des lieux parfaitement légitimes.
 *
 * 1,8 fois le rayon couvre l'aire urbaine autour d'une métropole sans rouvrir
 * la recherche au monde entier.
 */
const FACTEUR_BOITE = 1.8;

const MESSAGE_INDISPONIBLE =
  "Le service de recherche d'adresses est momentanément indisponible. " +
  'Réessayez dans quelques instants.';

/** Forme partielle d'un résultat Nominatim — seuls les champs consommés. */
interface ResultatNominatim {
  display_name?: unknown;
  lat?: unknown;
  lon?: unknown;
}

@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);
  private readonly baseUrl: string;

  constructor() {
    // Même convention que `CARBON_SERVICE_URL` (4D-2) : un avertissement, pas
    // une erreur fatale. Une variable absente ne doit pas empêcher toute
    // l'API de démarrer pour un seul endpoint public.
    const configuree = process.env.GEOCODING_URL?.trim();

    if (!configuree) {
      this.logger.warn(
        `GEOCODING_URL absente : repli sur ${URL_PAR_DEFAUT}. ` +
          'Définissez-la (voir .env.example) pour pointer une instance dédiée.',
      );
    }

    this.baseUrl = (configuree ?? URL_PAR_DEFAUT).replace(/\/+$/, '');
  }

  /**
   * Cherche des lieux correspondant au texte saisi.
   *
   * @throws {ServiceUnavailableException} fournisseur injoignable, en erreur,
   *   ou réponse illisible. JAMAIS une liste vide déguisée : « aucun résultat »
   *   et « le service est tombé » demandent deux réactions différentes de
   *   l'usager, et l'interface doit pouvoir les distinguer.
   */
  async search(query: GeocodingQueryDto): Promise<GeocodingResponseDto> {
    const reponse = await this.interroger(query.q);

    if (!reponse.ok) {
      this.logger.error(
        `Fournisseur de géocodage : réponse inattendue HTTP ${reponse.status}`,
      );
      throw new ServiceUnavailableException(MESSAGE_INDISPONIBLE);
    }

    return {
      items: this.normaliser(await this.lireCorps(reponse)),
      attribution: ATTRIBUTION,
    };
  }

  // ---------------------------------------------------------------------------
  // Appel réseau
  // ---------------------------------------------------------------------------

  private async interroger(texte: string): Promise<Response> {
    const territoire = territoryConfig();

    // `URLSearchParams` échappe le texte : une adresse contenant « & » ou
    // « # » ne peut pas altérer les autres paramètres.
    const parametres = new URLSearchParams({
      q: texte,
      format: 'jsonv2',
      limit: String(LIMITE_RESULTATS),
      // Ni polygone, ni détail d'adresse, ni métadonnées : on ne demande au
      // fournisseur que ce dont on se sert. Moins d'octets transportés, et
      // moins de données personnelles manipulées.
      addressdetails: '0',
      polygon_geojson: '0',

      // ═══ BORNAGE AU TERRITOIRE DESSERVI ═══
      //
      // ⚠️ SANS LUI, LA RECHERCHE PROPOSAIT LE MONDE ENTIER. Taper « gare »
      // rendait des gares de Berlin ou de Buenos Aires, qu'un usager pouvait
      // choisir — et le moteur d'itinéraires répondait alors « aucun arrêt à
      // moins de 2 km », sans jamais expliquer pourquoi.
      //
      // ⚠️ `bounded=1` REJETTE ce qui est hors boîte, là où `viewbox` seul se
      // contente de FAVORISER. La nuance est décisive : sans lui, un lieu
      // lointain remonterait quand même faute de résultat local.
      viewbox: this.boiteDuTerritoire(territoire),
      bounded: '1',
    });

    try {
      return await fetch(`${this.baseUrl}/search?${parametres.toString()}`, {
        headers: {
          // Exigé par la politique d'usage de Nominatim.
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
        },
        // Sans délai maximal, un fournisseur lent bloquerait une connexion du
        // serveur jusqu'à son propre timeout — et l'usager n'aurait aucun
        // retour entre-temps.
        signal: AbortSignal.timeout(DELAI_MS),
      });
    } catch (erreur) {
      // ⚠️ ON NE JOURNALISE PAS LE TEXTE CHERCHÉ. Une adresse est une donnée
      // personnelle : la voir dans les journaux du serveur à chaque panne
      // reviendrait à constituer un historique des recherches par accident.
      this.logger.error(
        `Fournisseur de géocodage injoignable : ${
          erreur instanceof Error ? erreur.name : 'erreur inconnue'
        }`,
      );
      throw new ServiceUnavailableException(MESSAGE_INDISPONIBLE);
    }
  }

  /**
   * Boîte englobante du territoire, au format attendu par Nominatim :
   * `ouest,nord,est,sud` — un ordre qui ne s'invente pas et que la
   * documentation du fournisseur impose.
   *
   * ⚠️ LA LONGITUDE SE RESSERRE AVEC LA LATITUDE. Un degré vaut 111 km à
   * l'équateur mais 73 km à Strasbourg : appliquer la même marge aux deux axes
   * produirait une boîte bien trop étroite en largeur, et rejetterait des
   * adresses pourtant proches.
   */
  private boiteDuTerritoire(territoire: {
    centerLat: number;
    centerLon: number;
    radiusM: number;
  }): string {
    const margeLat = territoire.radiusM * FACTEUR_BOITE * DEGRES_LAT_PAR_METRE;

    // `Math.max(cos φ, …)` évite la division par zéro aux pôles. Aucun réseau
    // de transport ne s'y trouve, mais un `Infinity` traversant l'URL serait
    // une panne, pas un résultat vide.
    const cosinus = Math.max(
      Math.cos((territoire.centerLat * Math.PI) / 180),
      1e-6,
    );
    const margeLon = margeLat / cosinus;

    const ouest = territoire.centerLon - margeLon;
    const est = territoire.centerLon + margeLon;
    const nord = territoire.centerLat + margeLat;
    const sud = territoire.centerLat - margeLat;

    return `${ouest},${nord},${est},${sud}`;
  }

  private async lireCorps(reponse: Response): Promise<unknown> {
    try {
      return await reponse.json();
    } catch {
      this.logger.error('Fournisseur de géocodage : corps illisible.');
      throw new ServiceUnavailableException(MESSAGE_INDISPONIBLE);
    }
  }

  // ---------------------------------------------------------------------------
  // Normalisation
  // ---------------------------------------------------------------------------

  /**
   * Traduit la réponse du fournisseur en contrat public.
   *
   * ⚠️ CHAQUE RÉSULTAT EST VÉRIFIÉ INDIVIDUELLEMENT, et un résultat
   * inexploitable est ÉCARTÉ plutôt que de faire échouer les autres. Un
   * fournisseur externe n'est pas un contrat qu'on maîtrise : il peut changer
   * de forme sans prévenir. Une liste de quatre bons résultats vaut mieux
   * qu'une erreur 503 parce que le cinquième était mal formé.
   *
   * `lat` et `lon` arrivent en CHAÎNES chez Nominatim ("48.8584"), jamais en
   * nombres. Les passer tels quels au frontend produirait un `POST` refusé en
   * 400 par `@IsNumber()` du moteur d'itinéraire.
   */
  private normaliser(corps: unknown): GeocodingResultDto[] {
    if (!Array.isArray(corps)) {
      this.logger.error('Fournisseur de géocodage : un tableau était attendu.');
      throw new ServiceUnavailableException(MESSAGE_INDISPONIBLE);
    }

    const items: GeocodingResultDto[] = [];

    for (const brut of corps as ResultatNominatim[]) {
      const label =
        typeof brut?.display_name === 'string' ? brut.display_name : null;
      const latitude = this.nombre(brut?.lat);
      const longitude = this.nombre(brut?.lon);

      if (
        !label ||
        latitude === null ||
        longitude === null ||
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180
      ) {
        continue;
      }

      items.push({ label, latitude, longitude });
    }

    return items.slice(0, LIMITE_RESULTATS);
  }

  /// Convertit une valeur inconnue en nombre fini, ou `null`.
  private nombre(valeur: unknown): number | null {
    if (typeof valeur === 'number') {
      return Number.isFinite(valeur) ? valeur : null;
    }

    if (typeof valeur !== 'string' || valeur.trim() === '') {
      return null;
    }

    const converti = Number(valeur);

    return Number.isFinite(converti) ? converti : null;
  }
}
