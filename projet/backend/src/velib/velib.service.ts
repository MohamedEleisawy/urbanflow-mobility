import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { haversineDistanceM } from '../common/geo/distance.util';
import {
  DataFreshness,
  VelibStationDto,
  VelibStationsResponseDto,
} from './dto/velib-station.dto';

// =============================================================================
// Vélos en libre-service — proxy GBFS (Phase 5, généralisé Phase 6)
// =============================================================================
// ═══ CE SERVICE NE CONNAÎT AUCUN EXPLOITANT ═══
//
// Il a d'abord été écrit pour Vélib' Métropole. Le recadrage territorial vers
// Strasbourg a montré ce qu'il avait d'implicitement parisien : l'adresse du
// flux, le nom du fournisseur dans l'attribution, et surtout la façon de lire
// les types de vélos.
//
// Il parle désormais GBFS, et rien d'autre. Deux flux standards
// (`station_information` et `station_status`), un troisième facultatif
// (`vehicle_types`), et une adresse racine donnée par l'environnement. Vélhop
// à Strasbourg, Vélib' à Paris, ou tout autre réseau GBFS : le code est le
// même.
//
// ═══ CE QUE LES DEUX FLUX RÉELS ONT MONTRÉ ═══
//
// Ils ne se ressemblent pas, et c'est la raison des lectures défensives :
//
//   | | Vélib' (Smovengo) | Vélhop (nextbike) |
//   | `station_id`   | nombre        | chaîne              |
//   | booléens       | 0 / 1         | true / false        |
//   | types de vélos | `num_bikes_available_types` : `[{mechanical}, {ebike}]`
//   |                | `vehicle_types_available` : `[{vehicle_type_id, count}]`
//
// Les deux formes sont conformes à GBFS, à des versions différentes. Le
// service accepte les deux plutôt que d'imposer la sienne.
// =============================================================================
// ═══ POURQUOI UN PROXY, ET NON UN APPEL DEPUIS LE NAVIGATEUR ═══
//
// Les mêmes raisons que pour le géocodage, plus une qui lui est propre :
//
// 1. LA TAILLE. Les deux flux pèsent ensemble ~730 ko pour 1 519 stations.
//    Les faire télécharger par chaque navigateur, à chaque ouverture de la
//    carte, serait absurde — alors qu'un seul cache serveur les sert tous.
//
// 2. LE FOURNISSEUR NE PROMET AUCUN CORS. Un appel direct depuis le navigateur
//    dépend d'un en-tête que nous ne contrôlons pas.
//
// 3. LE CONTRAT PUBLIC. Le frontend ne connaît que `/api/velib/*` : changer de
//    fournisseur, ou passer par le proxy de transport.data.gouv.fr, ne
//    touchera pas une ligne d'interface.
//
// 4. LA MINIMISATION ET L'HONNÊTETÉ. Le flux mêle des champs `snake_case` et
//    `camelCase` redondants, des valeurs à 0/1 pour des booléens, et des
//    horodatages Unix. Tout cela est traduit ICI, une fois, plutôt que dans
//    chaque composant.
//
// ═══ CE QUE CE SERVICE N'EST PAS ═══
//
// Il n'écrit RIEN en base. Les stations Vélib' ne sont pas notre référentiel :
// elles appartiennent à l'exploitant, changent sans nous prévenir, et les
// stocker créerait un doublon périmé dès sa création.
// =============================================================================

/**
 * Racine des flux GBFS du service de vélos en libre-service du territoire.
 *
 * ⚠️ VALEUR PAR DÉFAUT, PAS CONSTANTE. C'est Vélhop, le service de
 * l'Eurométropole de Strasbourg — territoire de démonstration du prototype —
 * et elle se remplace par `BIKE_GBFS_URL`.
 *
 * Le flux est publié par nextbike sous licence CC0-1.0, sans clé d'accès.
 */
const URL_PAR_DEFAUT = 'https://gbfs.nextbike.net/maps/gbfs/v2/nextbike_ae/fr';

/**
 * Attribution employée quand le flux ne se nomme pas lui-même.
 *
 * ⚠️ LE NOM DU SERVICE EST LU DANS `system_information.json`, qui fait partie
 * de la spécification GBFS et porte le nom réel de l'exploitant. Le coder en
 * dur, c'était réécrire une donnée que le fournisseur publie déjà — et se
 * tromper dès qu'on change de territoire.
 *
 * Cette valeur ne sert donc que si ce flux facultatif manque.
 */
const ATTRIBUTION_PAR_DEFAUT = 'Source : service de vélos en libre-service';

/// Délai au-delà duquel on cesse d'attendre le fournisseur.
const DELAI_MS = 6_000;

/**
 * Durée de vie du cache.
 *
 * ⚠️ COURTE ET BORNÉE. Le flux annonce lui-même un `ttl` d'une heure pour son
 * document de découverte, mais l'état des stations, lui, change en permanence :
 * une minute est le compromis entre « ne pas marteler le fournisseur » et
 * « ne pas annoncer comme temps réel une donnée d'il y a un quart d'heure ».
 *
 * L'usager n'est de toute façon jamais trompé : `lastReported` date la MESURE
 * et `fetchedAt` date la LECTURE. Un cache d'une minute est visible à l'écran.
 */
const DUREE_CACHE_MS = 60_000;

/**
 * Rayon maximal d'une recherche de proximité, en mètres.
 *
 * Même plafond que `GET /api/stops` : au-delà, ce n'est plus un voisinage.
 */
const RAYON_MAXIMAL_M = 5_000;

/// Message PUBLIC unique : il ne révèle ni l'adresse du flux, ni la panne.
const MESSAGE_INDISPONIBLE =
  'Les données des vélos en libre-service sont momentanément indisponibles. ' +
  'Réessayez dans quelques instants.';

/** Forme PARTIELLE d'une station du flux `station_information`. */
interface StationInformationGbfs {
  station_id?: unknown;
  stationCode?: unknown;
  name?: unknown;
  lat?: unknown;
  lon?: unknown;
  capacity?: unknown;
}

/** Forme PARTIELLE d'une station du flux `station_status`. */
interface StationStatusGbfs {
  station_id?: unknown;
  num_bikes_available?: unknown;
  /// Forme GBFS employée par Vélib' : `[{mechanical: 5}, {ebike: 8}]`.
  num_bikes_available_types?: unknown;
  /// Forme GBFS employée par nextbike : `[{vehicle_type_id, count}]`.
  vehicle_types_available?: unknown;
  num_docks_available?: unknown;
  is_installed?: unknown;
  is_renting?: unknown;
  is_returning?: unknown;
  last_reported?: unknown;
}

/**
 * Ce que `vehicle_types.json` apprend : quel type de vélo est motorisé.
 *
 * ⚠️ SANS CE FLUX, LA RÉPARTITION MÉCANIQUE / ÉLECTRIQUE EST INCONNUE, et
 * doit le rester. Un réseau qui déclare `[{vehicle_type_id: "272", count: 2}]`
 * ne dit RIEN, à lui seul, sur la motorisation de ce type 272. Deviner
 * reviendrait à inventer une donnée que l'usager lit comme un fait.
 */
type PropulsionParType = ReadonlyMap<string, 'human' | 'electrique'>;

/** Ce que le cache retient : le résultat fusionné, sa date, sa source. */
interface Instantane {
  stations: VelibStationDto[];
  fetchedAt: string;
  /// Nom du service tel que le flux le publie, ou le repli.
  attribution: string;
  expireA: number;
}

@Injectable()
export class VelibService {
  private readonly logger = new Logger(VelibService.name);

  private readonly baseUrl: string;

  /**
   * Dernier instantané lu, ou `null`.
   *
   * ⚠️ SEUL LE SUCCÈS EST MIS EN CACHE. Contrairement aux facteurs d'émission
   * — dont l'échec est mémorisé pour ne pas payer le délai à chaque candidat
   * d'une recherche — un échec Vélib' concerne une seule requête d'un seul
   * usager. Le mémoriser prolongerait une panne déjà terminée.
   */
  private cache: Instantane | null = null;

  /**
   * Lecture EN COURS, s'il y en a une.
   *
   * ⚠️ SANS CE VERROU, dix usagers arrivant ensemble sur la carte
   * déclencheraient dix téléchargements de 730 ko en parallèle. Ils partagent
   * désormais la même promesse.
   */
  private lectureEnCours: Promise<Instantane> | null = null;

  constructor() {
    // `VELIB_GBFS_URL` reste acceptée : renommer une variable d'environnement
    // casserait les déploiements existants sans rien apporter.
    const configuree = process.env.BIKE_GBFS_URL ?? process.env.VELIB_GBFS_URL;

    if (!configuree) {
      // Avertissement et non erreur fatale : comme pour le géocodage, une
      // adresse manquante n'est pas un trou de sécurité, et faire échouer le
      // démarrage priverait toute l'API pour un seul endpoint public.
      this.logger.warn(
        `BIKE_GBFS_URL absente : repli sur ${URL_PAR_DEFAUT}. ` +
          'Définissez-la (voir projet/backend/.env.example).',
      );
    }

    this.baseUrl = (configuree ?? URL_PAR_DEFAUT).replace(/\/+$/, '');
  }

  /** Toutes les stations connues, plafonnées. */
  async findAll(limite: number): Promise<VelibStationsResponseDto> {
    const instantane = await this.instantane();

    return {
      stations: instantane.stations.slice(0, limite),
      total: instantane.stations.length,
      fetchedAt: instantane.fetchedAt,
      attribution: instantane.attribution,
    };
  }

  /**
   * Stations autour d'un point, de la plus proche à la plus éloignée.
   *
   * Le filtrage est fait en mémoire : le flux GBFS ne se requête pas, il se
   * télécharge en entier. Une fois l'instantané en cache, trier 1 519 stations
   * coûte moins qu'un aller-retour réseau.
   */
  async findNearby(
    latitude: number,
    longitude: number,
    radiusM: number,
    limite: number,
  ): Promise<VelibStationsResponseDto> {
    const rayon = Math.min(radiusM, RAYON_MAXIMAL_M);
    const instantane = await this.instantane();

    const proches = instantane.stations
      .map((station) => ({
        ...station,
        distanceM: Math.round(
          haversineDistanceM(
            latitude,
            longitude,
            station.latitude,
            station.longitude,
          ),
        ),
      }))
      .filter((station) => station.distanceM <= rayon)
      // Départage par identifiant à distance égale : deux requêtes identiques
      // doivent rendre le même ordre.
      .sort(
        (a, b) =>
          a.distanceM - b.distanceM || a.stationId.localeCompare(b.stationId),
      );

    return {
      stations: proches.slice(0, limite),
      total: proches.length,
      fetchedAt: instantane.fetchedAt,
      attribution: instantane.attribution,
    };
  }

  /** Une station précise, par son identifiant GBFS. */
  async findOne(stationId: string): Promise<VelibStationDto> {
    const instantane = await this.instantane();

    const station = instantane.stations.find(
      (candidate) => candidate.stationId === stationId,
    );

    if (!station) {
      throw new NotFoundException(`Station Vélib’ ${stationId} introuvable`);
    }

    return station;
  }

  // ---------------------------------------------------------------------------
  // Lecture du flux
  // ---------------------------------------------------------------------------

  private async instantane(): Promise<Instantane> {
    const maintenant = Date.now();

    if (this.cache && maintenant < this.cache.expireA) {
      return this.cache;
    }

    // Une seule lecture à la fois, partagée par tous les appelants.
    this.lectureEnCours ??= this.lireFlux()
      .then((instantane) => {
        this.cache = instantane;
        return instantane;
      })
      .finally(() => {
        this.lectureEnCours = null;
      });

    return this.lectureEnCours;
  }

  private async lireFlux(): Promise<Instantane> {
    // ⚠️ EN PARALLÈLE. Les flux sont indépendants ; les enchaîner
    // multiplierait la latence pour rien.
    //
    // Les deux premiers sont OBLIGATOIRES : sans eux, il n'y a pas de station.
    // Les deux suivants sont FACULTATIFS au sens de GBFS — leur absence ne doit
    // pas faire échouer la lecture, seulement appauvrir la réponse.
    const [information, status, types, systeme] = await Promise.all([
      this.telecharger('station_information.json'),
      this.telecharger('station_status.json'),
      this.telechargerFacultatif('vehicle_types.json'),
      this.telechargerFacultatif('system_information.json'),
    ]);

    const stations = this.fusionner(
      this.extraireStations(information),
      this.extraireStations(status),
      this.propulsionParType(types),
    );

    if (stations.length === 0) {
      // Un flux qui répond 200 avec zéro station est une anomalie, pas une
      // réponse : mieux vaut le dire que d'afficher une carte vide.
      this.logger.error('Flux Vélib’ lisible mais vide : aucune station');
      throw new ServiceUnavailableException(MESSAGE_INDISPONIBLE);
    }

    return {
      stations,
      fetchedAt: new Date().toISOString(),
      attribution: this.attribution(systeme),
      expireA: Date.now() + DUREE_CACHE_MS,
    };
  }

  /**
   * Télécharge un flux FACULTATIF : son absence rend `null`, jamais une erreur.
   *
   * ⚠️ `vehicle_types.json` et `system_information.json` ne sont pas exigés par
   * toutes les versions de GBFS. Les traiter comme obligatoires ferait échouer
   * la lecture entière d'un réseau parfaitement lisible.
   */
  private async telechargerFacultatif(fichier: string): Promise<unknown> {
    try {
      return await this.telecharger(fichier);
    } catch {
      this.logger.debug?.(`Flux GBFS facultatif absent : ${fichier}`);
      return null;
    }
  }

  /**
   * Nom du service, tel que `system_information.json` le publie.
   *
   * Le coder en dur reviendrait à réécrire une donnée que le fournisseur
   * publie déjà — et à se tromper dès qu'on change de territoire.
   */
  private attribution(systeme: unknown): string {
    if (typeof systeme !== 'object' || systeme === null) {
      return ATTRIBUTION_PAR_DEFAUT;
    }

    const data = (systeme as { data?: unknown }).data;

    if (typeof data !== 'object' || data === null) {
      return ATTRIBUTION_PAR_DEFAUT;
    }

    const nom = (data as { name?: unknown }).name;

    return typeof nom === 'string' && nom.length > 0
      ? `Source : ${nom}`
      : ATTRIBUTION_PAR_DEFAUT;
  }

  /**
   * Lit `vehicle_types.json` : identifiant de type → motorisation.
   *
   * GBFS définit `propulsion_type` parmi `human`, `electric_assist`,
   * `electric`, `combustion`… On ne retient que la distinction qui intéresse
   * l'usager : est-ce que ça pousse tout seul ?
   *
   * Rend une table VIDE quand le flux manque — et une table vide signifie
   * « motorisation inconnue », pas « tout est mécanique ».
   */
  private propulsionParType(document: unknown): PropulsionParType {
    const table = new Map<string, 'human' | 'electrique'>();

    if (typeof document !== 'object' || document === null) {
      return table;
    }

    const data = (document as { data?: unknown }).data;

    if (typeof data !== 'object' || data === null) {
      return table;
    }

    const types = (data as { vehicle_types?: unknown }).vehicle_types;

    if (!Array.isArray(types)) {
      return table;
    }

    for (const entree of types) {
      if (typeof entree !== 'object' || entree === null) {
        continue;
      }

      const objet = entree as Record<string, unknown>;
      const id = this.texte(objet.vehicle_type_id);
      const propulsion = objet.propulsion_type;

      if (id === null || typeof propulsion !== 'string') {
        continue;
      }

      table.set(id, propulsion === 'human' ? 'human' : 'electrique');
    }

    return table;
  }

  private async telecharger(fichier: string): Promise<unknown> {
    const url = `${this.baseUrl}/${fichier}`;

    let reponse: Response;

    try {
      reponse = await fetch(url, {
        // `fetch` est natif depuis Node 18 : aucune dépendance HTTP.
        signal: AbortSignal.timeout(DELAI_MS),
      });
    } catch (error) {
      // Connexion refusée, DNS introuvable, coupure, délai dépassé : quatre
      // causes, une seule conséquence pour l'usager. Le motif est journalisé,
      // jamais renvoyé.
      this.logger.error(
        `Flux Vélib’ injoignable (${url}) : ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      throw new ServiceUnavailableException(MESSAGE_INDISPONIBLE);
    }

    if (!reponse.ok) {
      this.logger.error(`Flux Vélib’ : HTTP ${reponse.status} sur ${fichier}`);
      throw new ServiceUnavailableException(MESSAGE_INDISPONIBLE);
    }

    try {
      return await reponse.json();
    } catch {
      this.logger.error(`Flux Vélib’ : JSON illisible sur ${fichier}`);
      throw new ServiceUnavailableException(MESSAGE_INDISPONIBLE);
    }
  }

  /**
   * Extrait `data.stations` d'un document GBFS, ou un tableau vide.
   *
   * ⚠️ AUCUNE CONFIANCE DANS LA FORME. Un 200 ne garantit pas la structure :
   * le fournisseur peut renvoyer une page d'erreur en JSON, ou changer son
   * schéma. Une lecture optimiste produirait un `undefined.map` en pleine
   * requête d'usager.
   */
  private extraireStations(document: unknown): Record<string, unknown>[] {
    if (typeof document !== 'object' || document === null) {
      return [];
    }

    const data = (document as { data?: unknown }).data;

    if (typeof data !== 'object' || data === null) {
      return [];
    }

    const stations = (data as { stations?: unknown }).stations;

    if (!Array.isArray(stations)) {
      return [];
    }

    return stations.filter(
      (station): station is Record<string, unknown> =>
        typeof station === 'object' && station !== null,
    );
  }

  /**
   * Rapproche le référentiel et l'état, par `station_id`.
   *
   * ⚠️ LE RÉFÉRENTIEL COMMANDE. Une station présente dans `station_status`
   * mais absente de `station_information` n'a ni nom ni position : elle serait
   * indessinable et innommable. On l'écarte plutôt que d'inventer un libellé.
   *
   * L'inverse est toléré : une station connue mais sans état publié est
   * rendue avec des compteurs à `null` — « nous ne savons pas », qui n'est
   * pas « il n'y a rien ».
   */
  private fusionner(
    information: Record<string, unknown>[],
    status: Record<string, unknown>[],
    propulsions: PropulsionParType,
  ): VelibStationDto[] {
    const etats = new Map<string, StationStatusGbfs>();

    for (const brut of status) {
      const id = this.texte(brut.station_id);

      if (id !== null) {
        etats.set(id, brut);
      }
    }

    const stations: VelibStationDto[] = [];

    for (const brut of information as StationInformationGbfs[]) {
      const stationId = this.texte(brut.station_id);
      const name = this.texte(brut.name);
      const latitude = this.nombre(brut.lat);
      const longitude = this.nombre(brut.lon);

      // Sans identifiant, nom ou position, une station n'est pas affichable.
      if (
        stationId === null ||
        name === null ||
        latitude === null ||
        longitude === null
      ) {
        continue;
      }

      const etat = etats.get(stationId);
      const types = this.velosParType(etat, propulsions);
      const lastReported = this.instantIso(etat?.last_reported);

      stations.push({
        stationId,
        stationCode: this.texte(brut.stationCode),
        name,
        latitude,
        longitude,
        capacity: this.nombre(brut.capacity),
        mechanical: types.mechanical,
        electric: types.electric,
        bikesAvailable: this.nombre(etat?.num_bikes_available),
        docksAvailable: this.nombre(etat?.num_docks_available),
        isRenting: this.booleen(etat?.is_renting),
        isReturning: this.booleen(etat?.is_returning),
        isInstalled: this.booleen(etat?.is_installed),
        lastReported,
        // ⚠️ « REALTIME » N'EST ÉCRIT QUE SI UN HORODATAGE L'ADOSSE. Sans lui,
        // rien ne permet de distinguer une mesure d'il y a trois secondes
        // d'une mesure d'il y a trois heures.
        freshness: this.fraicheur(etat, lastReported),
        distanceM: null,
      });
    }

    return stations;
  }

  private fraicheur(
    etat: StationStatusGbfs | undefined,
    lastReported: string | null,
  ): DataFreshness {
    if (etat === undefined) {
      // Le référentiel est là, l'état non : seule la partie statique est sûre.
      return 'STATIC';
    }

    return lastReported === null ? 'UNKNOWN' : 'REALTIME';
  }

  /**
   * Répartition mécaniques / électriques, dans l'un ou l'autre format GBFS.
   *
   * ═══ DEUX FORMES, TOUTES DEUX CONFORMES ═══
   *
   * Vélib' (Smovengo) publie la motorisation DIRECTEMENT dans le statut :
   *
   *     "num_bikes_available_types": [{ "mechanical": 5 }, { "ebike": 8 }]
   *
   * nextbike (Vélhop) publie des IDENTIFIANTS DE TYPE, dont la motorisation
   * vit dans un autre flux :
   *
   *     "vehicle_types_available": [{ "vehicle_type_id": "272", "count": 2 }]
   *
   * ⚠️ SANS `vehicle_types.json`, LA SECONDE FORME NE DIT RIEN de la
   * motorisation, et la réponse doit alors rendre `null` — « nous ne savons
   * pas ». Supposer « mécanique » parce que c'est le cas le plus fréquent
   * ferait passer une hypothèse pour une mesure.
   *
   * ⚠️ `null` N'EST PAS `0`, et la distinction compte pour quelqu'un qui
   * attend un vélo : « aucun électrique disponible » et « nous ignorons s'il y
   * en a » n'appellent pas la même décision.
   */
  private velosParType(
    etat: StationStatusGbfs | undefined,
    propulsions: PropulsionParType,
  ): { mechanical: number | null; electric: number | null } {
    if (etat === undefined) {
      return { mechanical: null, electric: null };
    }

    // Forme 1 : la motorisation est nommée dans le statut lui-même.
    const parNom = this.velosParNom(etat.num_bikes_available_types);

    if (parNom.mechanical !== null || parNom.electric !== null) {
      return parNom;
    }

    // Forme 2 : des identifiants de type, à résoudre.
    return this.velosParIdentifiant(etat.vehicle_types_available, propulsions);
  }

  /** Forme Vélib' : `[{ mechanical: 5 }, { ebike: 8 }]`. */
  private velosParNom(valeur: unknown): {
    mechanical: number | null;
    electric: number | null;
  } {
    if (!Array.isArray(valeur)) {
      return { mechanical: null, electric: null };
    }

    let mechanical: number | null = null;
    let electric: number | null = null;

    for (const entree of valeur) {
      if (typeof entree !== 'object' || entree === null) {
        continue;
      }

      const objet = entree as Record<string, unknown>;

      const mecanique = this.nombre(objet.mechanical);
      if (mecanique !== null) {
        mechanical = (mechanical ?? 0) + mecanique;
      }

      // `ebike` est le nom du flux ; `electric` celui de notre contrat.
      const electrique = this.nombre(objet.ebike);
      if (electrique !== null) {
        electric = (electric ?? 0) + electrique;
      }
    }

    return { mechanical, electric };
  }

  /**
   * Forme nextbike : `[{ vehicle_type_id, count }]`, résolue par
   * `vehicle_types.json`.
   *
   * ⚠️ UN TYPE INCONNU DE LA TABLE NE COMPTE NULLE PART. Le ranger d'office
   * dans « mécanique » gonflerait un chiffre que l'usager croirait mesuré.
   */
  private velosParIdentifiant(
    valeur: unknown,
    propulsions: PropulsionParType,
  ): { mechanical: number | null; electric: number | null } {
    if (!Array.isArray(valeur) || propulsions.size === 0) {
      return { mechanical: null, electric: null };
    }

    let mechanical: number | null = null;
    let electric: number | null = null;

    for (const entree of valeur) {
      if (typeof entree !== 'object' || entree === null) {
        continue;
      }

      const objet = entree as Record<string, unknown>;
      const id = this.texte(objet.vehicle_type_id);
      const compte = this.nombre(objet.count);

      if (id === null || compte === null) {
        continue;
      }

      const propulsion = propulsions.get(id);

      if (propulsion === 'human') {
        mechanical = (mechanical ?? 0) + compte;
      } else if (propulsion === 'electrique') {
        electric = (electric ?? 0) + compte;
      }
    }

    // ⚠️ QUAND LA TABLE EST CONNUE, UN TOTAL À ZÉRO EST UNE MESURE, PAS UNE
    // IGNORANCE. Vélhop ne déclare qu'un seul type, `human` : ses stations ont
    // donc RÉELLEMENT zéro vélo électrique, et l'afficher est exact.
    if (mechanical !== null && electric === null) {
      electric = 0;
    }

    if (electric !== null && mechanical === null) {
      mechanical = 0;
    }

    return { mechanical, electric };
  }

  // ---------------------------------------------------------------------------
  // Lecture défensive des champs
  // ---------------------------------------------------------------------------

  /**
   * `station_id` est publié tantôt en nombre, tantôt en chaîne selon les
   * réseaux GBFS. On normalise en chaîne, seule forme qui joint sans surprise.
   */
  private texte(valeur: unknown): string | null {
    if (typeof valeur === 'string' && valeur.length > 0) {
      return valeur;
    }

    if (typeof valeur === 'number' && Number.isFinite(valeur)) {
      return String(valeur);
    }

    return null;
  }

  private nombre(valeur: unknown): number | null {
    return typeof valeur === 'number' && Number.isFinite(valeur)
      ? valeur
      : null;
  }

  /**
   * GBFS publie ses booléens tantôt en `true`/`false`, tantôt en `1`/`0`.
   * Les deux sont acceptés ; toute autre valeur rend `null`.
   */
  private booleen(valeur: unknown): boolean | null {
    if (typeof valeur === 'boolean') {
      return valeur;
    }

    if (valeur === 1 || valeur === 0) {
      return valeur === 1;
    }

    return null;
  }

  /**
   * `last_reported` est un horodatage Unix en SECONDES.
   *
   * ⚠️ `new Date(secondes)` donnerait 1970 : JavaScript compte en
   * millisecondes. L'erreur ne lèverait rien et afficherait « actualisé il y a
   * 56 ans ».
   */
  private instantIso(valeur: unknown): string | null {
    const secondes = this.nombre(valeur);

    if (secondes === null || secondes <= 0) {
      return null;
    }

    return new Date(secondes * 1000).toISOString();
  }
}
