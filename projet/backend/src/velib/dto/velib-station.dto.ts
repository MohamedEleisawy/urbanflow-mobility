// =============================================================================
// Contrat public de GET /api/velib/* (Phase 5)
// =============================================================================
// ⚠️ CHAQUE CHAMP CORRESPOND À UNE DONNÉE RÉELLEMENT PUBLIÉE par le flux GBFS
// de Vélib' Métropole. Aucun n'est déduit, aucun n'est complété par une valeur
// de confort. Les champs que le flux ne donne pas n'existent pas ici.
// =============================================================================

/**
 * Fraîcheur d'une donnée affichée.
 *
 * ⚠️ CE TYPE EXISTE POUR QUE LE MOT « TEMPS RÉEL » NE SOIT JAMAIS ÉCRIT À
 * TORT. Le nombre de vélos disponibles est du temps réel ; le nom et la
 * position d'une station ne le sont pas — ils changent une fois par an.
 *
 *   `STATIC`    référentiel, valable jusqu'au prochain déploiement du réseau ;
 *   `REALTIME`  mesuré à l'instant, avec un horodatage à l'appui ;
 *   `UNKNOWN`   la source ne dit pas quand elle a mesuré.
 */
export type DataFreshness = 'STATIC' | 'REALTIME' | 'UNKNOWN';

/**
 * Une station Vélib', telle que le flux la décrit.
 *
 * Les deux flux GBFS sont FUSIONNÉS ici : `station_information` (le
 * référentiel) et `station_status` (l'état). Les rapprocher côté serveur évite
 * au client de faire deux appels et de les apparier lui-même.
 */
export interface VelibStationDto {
  /// Identifiant GBFS de la station. Clé de jointure entre les deux flux.
  stationId: string;

  /**
   * Code affiché sur la borne (« 16107 »).
   *
   * ⚠️ DISTINCT de `stationId`, et c'est le flux qui les sépare : le premier
   * est ce que l'usager lit sur place, le second ce que la machine manipule.
   */
  stationCode: string | null;

  name: string;
  latitude: number;
  longitude: number;

  /// Nombre total de points d'attache. `null` si le flux ne le publie pas.
  capacity: number | null;

  // ---------------------------------------------------------------------------
  // État — TEMPS RÉEL
  // ---------------------------------------------------------------------------

  /**
   * Vélos mécaniques et électriques disponibles.
   *
   * ⚠️ `null` SIGNIFIE « NON PUBLIÉ », JAMAIS « AUCUN ». Le flux détaille les
   * types dans `num_bikes_available_types` ; s'il cessait de le faire, écrire
   * 0 laisserait croire qu'il n'y a aucun vélo électrique alors qu'on ne sait
   * simplement pas. `0` et `null` doivent rester discernables à l'écran.
   */
  mechanical: number | null;
  electric: number | null;

  /// Total de vélos disponibles, tel que publié.
  bikesAvailable: number | null;

  /// Points d'attache libres.
  docksAvailable: number | null;

  /// La station loue-t-elle ? rend-elle ? est-elle installée ?
  isRenting: boolean | null;
  isReturning: boolean | null;
  isInstalled: boolean | null;

  /**
   * Instant de la dernière mesure, en ISO 8601.
   *
   * ⚠️ C'EST LUI QUI AUTORISE LE MOT « TEMPS RÉEL ». Sans horodatage, une
   * donnée vieille d'une heure serait indiscernable d'une donnée fraîche —
   * l'interface doit pouvoir écrire « actualisé à 18:42 » plutôt que de
   * laisser croire à l'instantané.
   */
  lastReported: string | null;

  /// Fraîcheur de la partie « état » de cette station.
  freshness: DataFreshness;

  /**
   * Distance au point demandé, en mètres.
   *
   * Renseignée seulement par `GET /api/velib/nearby`. `null` ailleurs — et
   * non zéro, qui voudrait dire « vous y êtes ».
   */
  distanceM: number | null;
}

export interface VelibStationsResponseDto {
  stations: VelibStationDto[];

  /// Nombre de stations correspondant à la demande, avant plafonnement.
  total: number;

  /**
   * Instant où NOTRE serveur a lu le flux, en ISO 8601.
   *
   * Distinct de `lastReported` : celui-ci date la lecture, celui-là la mesure.
   * L'écart entre les deux est exactement l'âge du cache.
   */
  fetchedAt: string;

  /// Mention d'attribution imposée par la licence du fournisseur.
  attribution: string;
}
