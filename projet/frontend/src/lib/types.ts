// =============================================================================
// Contrats de l'API UrbanFlow (étape 5A-2)
// =============================================================================
// Recopie des formes RÉELLEMENT renvoyées par le backend NestJS, relevées dans
// `projet/backend/prisma/schema.prisma` et dans les DTO de sortie. Rien n'est
// inventé ici : chaque champ existe.
//
// DEUX RÈGLES QUI ÉVITENT DES BUGS SILENCIEUX
//
// 1. Les dates sont des `string`, pas des `Date`. Le backend manipule bien des
//    `Date`, mais JSON n'a pas de type date : elles traversent le réseau en
//    ISO 8601 UTC ("2026-08-25T10:00:00.000Z"). Les typer `Date` ici ferait
//    croire à TypeScript qu'on peut appeler `.getTime()` sur une chaîne —
//    l'erreur n'apparaîtrait qu'à l'exécution.
//
// 2. Ce fichier ne contient AUCUN import du backend. Les deux projets sont
//    compilés séparément ; partager des types exigerait un paquet commun,
//    disproportionné ici. La contrepartie est que ces types peuvent dériver :
//    ils sont donc documentés avec leur source.
// =============================================================================

/// Modes de transport connus du backend (`enum ModeTransport`).
export type TransportMode =
  | "WALK"
  | "BUS"
  | "TRAM"
  | "METRO"
  /**
   * Ferroviaire — RER, Transilien, TER (GTFS `route_type = 2`).
   *
   * ⚠️ Ajouté avec l'import du réseau ferré : 24 lignes réelles, jusque-là
   * REJETÉES faute d'équivalent. Les faire passer pour du métro aurait été
   * un mensonge — un RER n'a ni la même desserte, ni la même vitesse.
   */
  | "TRAIN"
  | "BIKE"
  | "ESCOOTER"
  | "CAR";

/// Rôles (`enum RoleEnum`).
///
/// ⚠️ Commentaire corrigé au bloc 6-6 : il affirmait que l'autorisation par
/// rôle n'était « pas encore branchée côté backend ». C'est faux depuis
/// l'étape 6-1 — `RolesGuard` et `@Roles(ADMIN)` protègent réellement
/// `/api/admin/*`. Un commentaire périmé désinforme plus sûrement qu'un
/// commentaire absent.
export type UserRole = "USER" | "ADMIN";

export type ThemePreference = "LIGHT" | "DARK" | "SYSTEM";
/**
 * Langue de l'interface.
 *
 * ⚠️ « ES » AJOUTÉ EN PHASE 5, en même temps que la valeur correspondante de
 * `LanguageEnum` côté base. Les deux listes doivent rester identiques : une
 * valeur connue d'un seul côté produirait un 400 à l'enregistrement.
 */
export type LanguagePreference = "FR" | "EN" | "ES";

// ---------------------------------------------------------------------------
// Utilisateur et authentification
// ---------------------------------------------------------------------------

/** Préférences d'un usager (`model UserPreferences`). */
export interface UserPreferences {
  id: string;
  preferredModes: TransportMode[];
  pmrMode: boolean;
  co2BudgetWeekly: number;
  notificationsEnabled: boolean;
  language: LanguagePreference;
  theme: ThemePreference;
  userId: string;
}

/**
 * Usager tel que renvoyé par `GET /api/users/me`.
 *
 * `passwordHash` est retiré côté backend (`toPublicUser`) : il n'a donc
 * aucune raison de figurer ici, même en optionnel.
 */
export interface User {
  id: string;
  email: string;
  role: UserRole;
  createdAt: string;
  /** Suppression logique RGPD : non nul si le compte a été désactivé. */
  deletedAt: string | null;
  /** Relation 1-1 facultative : un compte peut n'avoir aucune préférence. */
  preferences: UserPreferences | null;
}

/** Réponse de `POST /api/auth/login`. */
export interface LoginResponse {
  accessToken: string;
  /** Volontairement plus étroit que `User` : le login n'inclut pas les préférences. */
  user: Pick<User, "id" | "email" | "role">;
}

// ---------------------------------------------------------------------------
// Réseau
// ---------------------------------------------------------------------------

/** Arrêt renvoyé par `GET /api/stops` (`model Stop`). */
export interface Stop {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  pmrAccessible: boolean;
  operatorCode: string;
  /** Identifiant GTFS d'origine, nul pour un arrêt saisi à la main. */
  gtfsStopId: string | null;
}

/**
 * Un arrêt tel que le rend `GET /api/stops`.
 *
 * `distanceM` n'est renseigné que si la requête portait un point ; il vaut
 * `null` sinon — et non zéro, qui signifierait « vous y êtes ».
 */
export interface StopAvecDistance extends Stop {
  distanceM: number | null;
}

/**
 * Réponse de `GET /api/stops` (Phase 4).
 *
 * ⚠️ CE N'EST PLUS UN TABLEAU. L'endpoint rendait autrefois la table entière ;
 * il est désormais TOUJOURS borné — page, recherche par nom, ou voisinage.
 * Le réseau compte 1 934 arrêts aujourd'hui et en comptera plus de 35 000 une
 * fois le bus importé.
 */
export interface PaginatedStops {
  items: StopAvecDistance[];
  page: number;
  limit: number;
  total: number;
}

// ---------------------------------------------------------------------------
// Recherche d'itinéraire
// ---------------------------------------------------------------------------

/** Mode de déplacement demandé pour la recherche. */
export type ModeVoyage = "TRANSIT" | "WALK" | "BIKE";

/**
 * Corps attendu par `POST /api/routes/search`.
 *
 * ⚠️ Des COORDONNÉES, pas des noms d'arrêt : l'écran fait choisir des adresses
 * et transmet leurs coordonnées.
 */
export interface SearchItineraryRequest {
  fromLat: number;
  fromLon: number;
  toLat: number;
  toLon: number;

  /**
   * `TRANSIT` (défaut) : marche + tram/bus + marche.
   * `WALK` / `BIKE`     : le trajet ENTIER à pied ou à vélo, rue par rue —
   *                       un seul itinéraire, sans arrêt ni correspondance.
   */
  mode?: ModeVoyage;

  /**
   * `true` : privilégier les arrêts que le flux GTFS déclare accessibles en
   * fauteuil roulant. Le backend rend alors un trajet entièrement garanti si
   * possible, sinon le meilleur trajet possible marqué « non garanti »
   * (`Itinerary.accessibility`). Jamais « aucun itinéraire » faute de donnée.
   */
  pmr?: boolean;
}

/**
 * Verdict d'accessibilité d'un itinéraire — présent UNIQUEMENT quand la
 * recherche portait `pmr: true`.
 *
 * ⚠️ `guaranteed: false` NE VEUT PAS DIRE « INACCESSIBLE ». Le flux GTFS
 * n'affirme l'accessibilité que par `wheelchair_boarding = 1` ; tout le reste
 * est « non renseigné ». `uncertainStops` liste les arrêts qu'on ne peut pas
 * certifier — pas ceux qu'on sait infranchissables.
 */
export interface ItineraryAccessibility {
  requested: true;
  guaranteed: boolean;
  uncertainStops: string[];
}

/**
 * Critère selon lequel un itinéraire a été optimisé.
 *
 * ⚠️ `SHORTEST` A DISPARU du contrat backend (Phase 4). Dans un réseau de
 * transport, « le plus court en mètres » désignait presque toujours le même
 * trajet que « le plus rapide ». Il est remplacé par deux critères qui
 * répondent, eux, à des questions réelles : « je ne veux pas de
 * correspondance » et « je veux le trajet le moins émetteur ».
 */
export type ItineraryCriterion =
  | "FASTEST"
  | "LOWEST_CO2"
  | "SHORTEST"
  /**
   * ⚠️ PLUS PRODUIT PAR AUCUNE RECHERCHE depuis le sprint soutenance, où
   * `SHORTEST` a repris sa place. Conservé parce que des itinéraires
   * ENREGISTRÉS par les usagers le portent : le retirer ferait échouer la
   * relecture de leur historique.
   */
  | "FEWEST_TRANSFERS";

/**
 * Disponibilité des horaires d'un itinéraire.
 *
 *   `SCHEDULE_AVAILABLE`    heures de départ et d'arrivée établies ;
 *   `SCHEDULE_UNKNOWN`      le réseau est horodaté, mais aucune de ces lignes
 *                           ne passe dans les prochaines heures ;
 *   `SCHEDULE_UNAVAILABLE`  aucun horaire n'est importé.
 *
 * ⚠️ TROIS PHRASES DIFFÉRENTES À L'ÉCRAN. Les confondre ferait dire « pas de
 * passage aujourd'hui » à un usager dont le réseau n'a jamais été horodaté.
 */
export type ScheduleStatus =
  | "SCHEDULE_AVAILABLE"
  | "SCHEDULE_UNKNOWN"
  | "SCHEDULE_UNAVAILABLE";

export interface ItinerarySchedule {
  status: ScheduleStatus;
  departureAt: string | null;
  /** Heure d'arrivée estimée, ATTENTE COMPRISE. */
  arrivalAt: string | null;
  /** Somme des attentes sur le quai. `null` — jamais 0 — si inconnue. */
  totalWaitMin: number | null;
  reason: string | null;
}

/**
 * Un tracé GeoJSON `LineString`.
 *
 * ⚠️ ORDRE DES COORDONNÉES : `[longitude, latitude]`, comme l'impose la
 * RFC 7946 — l'INVERSE de Leaflet, qui attend `[lat, lon]`. Une inversion
 * placerait Paris en Somalie sans lever la moindre erreur.
 */
export interface GeoJsonLineString {
  type: "LineString";
  coordinates: [number, number][];
}

/**
 * D'où vient le tracé d'un segment.
 *
 * `SHAPE`    : géométrie réelle publiée par l'opérateur (`shapes.txt`) ;
 * `STRAIGHT` : aucune géométrie disponible — au client de relier les deux
 *              arrêts par une droite, QUI N'EST PAS le trajet réel.
 *
 * L'interface ne doit jamais présenter les deux de la même façon.
 */
/**
 *   `SHAPE`    tracé publié par l'opérateur (GTFS `shapes.txt`) ;
 *   `ROUTED`   tracé calculé rue par rue par un moteur de routage — un segment
 *              vélo, dont la voie n'est dans aucun flux GTFS mais qu'OSM connaît ;
 *   `STRAIGHT` une droite faute des deux précédents — PAS le trajet réel.
 */
export type GeometrySource = "SHAPE" | "ROUTED" | "STRAIGHT";

/** Une portion de trajet, entre deux arrêts. */
export interface ItinerarySegment {
  fromStopId: string;
  fromStopName: string;
  fromStopLat: number;
  fromStopLon: number;
  toStopId: string;
  toStopName: string;
  toStopLat: number;
  toStopLon: number;
  mode: TransportMode;
  /** Nom affiché de la ligne — « 38 », « A »… */
  lineName: string;
  operator: string;
  /** Identifiant de la LIAISON retenue, à renvoyer pour enregistrer le trajet. */
  lineId: string;

  /**
   * Identifiant de la ligne DANS LE FLUX DE L'OPÉRATEUR, ou `null`.
   *
   * ⚠️ C'est le SEUL moyen de rattacher une perturbation GTFS-RT à une ligne
   * réellement empruntée : `lineId` est notre UUID interne, que les flux ne
   * connaissent pas, et le NOM est ambigu (un « 4 » de métro et un « 4 » de
   * bus). Voir `lib/alertes-itineraire.ts`.
   */
  gtfsLineId: string | null;
  distanceM: number;
  durationMin: number;
  /** Tracé réel, ou `null` quand l'opérateur n'en publie pas. */
  geometry: GeoJsonLineString | null;
  geometrySource: GeometrySource;

  /**
   * Minutes d'attente AVANT de monter dans ce segment.
   *
   * ⚠️ PRÉSENT SEULEMENT SUR UNE MONTÉE, et `undefined` — jamais 0 — sur les
   * tronçons suivants d'une même ligne. Rester assis dans le tram sur cinq
   * arrêts n'est pas une attente de zéro minute : c'est l'absence d'attente.
   */
  waitMin?: number;

  /** Heures théoriques, en ISO 8601. Absentes si non calculables. */
  departureAt?: string;
  arrivalAt?: string;
}

/**
 * Disponibilité du calcul carbone.
 *
 * ⚠️ `CARBON_UNAVAILABLE` n'est pas « zéro gramme ». Tous les champs chiffrés
 * valent alors `null`, et l'interface doit écrire « indisponible », jamais
 * « 0 g » — ce qui annoncerait un trajet parfaitement propre.
 */
export type CarbonStatus = "CARBON_AVAILABLE" | "CARBON_UNAVAILABLE";

export interface ItineraryCarbon {
  status: CarbonStatus;
  co2Grams: number | null;
  /** Ce que le MÊME trajet aurait émis en voiture individuelle. */
  carCo2Grams: number | null;
  savedVsCarGrams: number | null;
  /** 0 = voiture individuelle, 100 = mobilité douce. */
  ecoScore: number | null;
  /** Message destiné à l'usager quand le calcul n'a pas abouti. */
  reason: string | null;
}

export interface Itinerary {
  criterion: ItineraryCriterion;

  /**
   * Horaires réels, attente comprise.
   *
   * FACULTATIF : les itinéraires relus depuis l'historique n'en ont pas —
   * ils décrivent un trajet passé, dont l'attente n'a plus de sens.
   */
  schedule?: ItinerarySchedule;
  totalDistanceM: number;

  /**
   * ⚠️ CETTE DURÉE NE CONTIENT PAS LE TEMPS D'ATTENTE.
   *
   * Elle additionne les durées de parcours (médianes GTFS) et les temps de
   * correspondance à pied publiés par l'opérateur. Il y manque l'attente du
   * véhicule à chaque montée : nous importons le réseau, pas les horaires.
   *
   * Mesuré sur le réseau réel depuis l'import du bus : un itinéraire peut
   * annoncer 17 minutes avec CINQ changements de bus, là où le RER met
   * 19 minutes sans aucun changement. Chaque durée est exacte ; c'est leur
   * somme qui suppose cinq correspondances instantanées.
   *
   * L'interface DOIT donc le dire dès que `numberOfTransfers > 0`.
   */
  totalDurationMin: number;
  /**
   * Changements de LIGNE — la marche n'en est pas un.
   *
   * ⚠️ VIENT DU BACKEND, qui en est désormais la source. Le recalculer ici
   * ferait deux implémentations d'une même règle, qui divergeraient.
   */
  numberOfTransfers: number;
  carbon: ItineraryCarbon;

  /**
   * Verdict d'accessibilité fauteuil. Présent uniquement si la recherche
   * portait `pmr: true` ; absent sinon (le cas courant).
   */
  accessibility?: ItineraryAccessibility;

  /**
   * Marche d'approche : du point demandé au premier arrêt.
   *
   * ⚠️ CE N'EST PAS UN `ItinerarySegment`, et la distinction est structurelle :
   * un segment relie deux ARRÊTS identifiés en base, une marche d'approche
   * part d'une ADRESSE, qui n'en est pas un.
   *
   * ⚠️ SES MÈTRES ET SES MINUTES SONT DÉJÀ DANS `totalDistanceM` /
   * `totalDurationMin`. Ne les additionnez pas une seconde fois.
   *
   * `null` quand l'usager part déjà d'un arrêt.
   */
  walkAccess: ItineraryWalkLeg | null;

  /** Marche finale : du dernier arrêt au point demandé. */
  walkEgress: ItineraryWalkLeg | null;

  /**
   * ⚠️ PEUT ÊTRE VIDE : un trajet entièrement à pied n'emprunte aucun
   * véhicule. L'interface doit alors montrer la marche, pas une carte vide.
   */
  segments: ItinerarySegment[];
}

/**
 * Une marche entre un point demandé par l'usager et le réseau.
 *
 * ⚠️ `source` N'EST PAS DÉCORATIF. `ESTIMATE` signifie « distance à vol
 * d'oiseau », donc MINORÉE : ni rue, ni traversée, ni pont ne sont connus.
 * L'afficher comme un itinéraire de rues serait une fausse précision.
 */
export interface ItineraryWalkLeg {
  fromLat: number;
  fromLon: number;
  toLat: number;
  toLon: number;
  /** Nom de l'arrêt à l'extrémité RÉSEAU. Vide pour une marche de bout en bout. */
  stopName: string;
  distanceM: number;
  durationMin: number;
  source: "ESTIMATE" | "ROUTED";

  /**
   * Tracé rue par rue, en GeoJSON `LineString` (`[longitude, latitude]`).
   *
   * ⚠️ `null` VA TOUJOURS AVEC `source: "ESTIMATE"` : sans moteur piéton il
   * n'existe aucun tracé, seulement deux points. C'est alors au client de
   * relier ces points par une droite ET DE LE DIRE — jamais de la faire passer
   * pour un chemin de rues.
   */
  geometry: GeoJsonLineString | null;
}

// ---------------------------------------------------------------------------
// Trajets enregistrés
// ---------------------------------------------------------------------------

/** Résumé d'un trajet enregistré (`GET /api/routes`, `model Route`). */
export interface RouteHistoryItem {
  id: string;
  originLat: number;
  originLng: number;
  destinationLat: number;
  destinationLng: number;
  requestedAt: string;
  totalDurationMin: number;
  totalDistanceM: number;
  ecoScore: number;
  carbonEstimate: number;
  userId: string | null;
  /**
   * Mode d'un trajet DIRECT : `"WALK"` / `"BIKE"` pour un trajet enregistré
   * via les boutons « À pied » / « À vélo » (il n'a alors AUCUN segment).
   * `null` pour un trajet multimodal ordinaire, décrit par ses segments.
   */
  mode: TransportMode | null;
}

/** Réponse paginée de `GET /api/routes`. */
export interface PaginatedRoutes {
  items: RouteHistoryItem[];
  page: number;
  limit: number;
  total: number;
}

/** Étape enregistrée d'un trajet (`model Segment`). */
export interface RouteSegment {
  id: string;
  mode: TransportMode;
  operator: string;
  departureTime: string;
  arrivalTime: string;
  distanceM: number;
  line: string;
  /** Nul pour une liaison agrégée : aucun passage GTFS précis à désigner. */
  gtfsTripId: string | null;
  routeId: string;
  fromStopId: string;
  toStopId: string;
  /**
   * Arrêts de départ et d'arrivée, joints par le backend (Phase 4).
   *
   * ⚠️ Sans eux, l'écran d'historique devait charger LA TOTALITÉ des arrêts
   * du réseau pour retrouver deux noms — ce que la pagination de
   * `GET /api/stops` interdit désormais, et qui coûtait de toute façon des
   * centaines de kilo-octets pour deux libellés.
   */
  fromStop: Stop;
  toStop: Stop;
}

/** Empreinte d'une portion de trajet (`model CarbonRecord`). */
export interface CarbonRecord {
  id: string;
  date: string;
  co2Grams: number;
  mode: TransportMode;
  distanceM: number;
  savedVsCarGrams: number;
  userId: string;
  routeId: string;
}

/**
 * Détail d'un trajet (`GET /api/routes/:id`).
 *
 * ⚠️ `segments` et `carbonRecords` ne se correspondent PAS position par
 * position : un `CarbonRecord` ne porte pas de `segmentId`. Les rapprocher
 * ligne à ligne inventerait une association. L'usage fiable est l'agrégation
 * par mode.
 */
export interface RouteDetail extends RouteHistoryItem {
  segments: RouteSegment[];
  carbonRecords: CarbonRecord[];
}

// ---------------------------------------------------------------------------
// Calcul et suivi carbone
// ---------------------------------------------------------------------------

/** Une portion soumise à `POST /api/carbone`. */
export interface CarbonSegmentInput {
  mode: TransportMode;
  distanceM: number;
}

export interface CarbonBreakdownItem {
  mode: TransportMode;
  distanceM: number;
  co2Grams: number;
}

/** Résultat de `POST /api/carbone` (endpoint PUBLIC : aucun compte requis). */
export interface CarbonResult {
  totalDistanceM: number;
  totalCo2Grams: number;
  /** Ce que le même trajet aurait coûté en voiture individuelle. */
  carCo2Grams: number;
  savedVsCarGrams: number;
  /** 0 = voiture individuelle, 100 = mobilité douce. */
  ecoScore: number;
  breakdown: CarbonBreakdownItem[];
}

/** Bilan d'une semaine ISO (`GET /api/suivi-carbone`). */
export interface WeeklyCarbon {
  year: number;
  week: number;
  co2Grams: number;
  savedVsCarGrams: number;
  /** Nombre de TRAJETS distincts — pas d'enregistrements carbone. */
  tripCount: number;
}

export interface WeeklyCarbonTracking {
  /** Semaines contenant au moins un trajet, de la plus récente à la plus ancienne. */
  weeks: WeeklyCarbon[];
  /** Fenêtre effectivement appliquée : une réponse bornée dit sa borne. */
  weeksRequested: number;
}

/**
 * Budget hebdomadaire (`GET /api/suivi-carbone/budget`).
 *
 * Les trois champs nullables le sont ENSEMBLE : sans budget défini dans les
 * préférences, il n'existe ni reste ni dépassement à annoncer.
 */
export interface WeeklyCarbonBudget {
  year: number;
  week: number;
  weeklyBudgetGrams: number | null;
  consumedGrams: number;
  remainingGrams: number | null;
  exceeded: boolean | null;
  tripCount: number;
}

// ---------------------------------------------------------------------------
// Perturbations
// ---------------------------------------------------------------------------

export type AlertSeverity = "INFO" | "WARNING" | "SEVERE";

/** Une ligne concernée par une perturbation. */
export interface AlertLine {
  /** Identifiant GTFS de la ligne. */
  id: string;
  /** Nom affiché, ou null si la ligne est absente de notre référentiel. */
  name: string | null;
}

/**
 * Une perturbation en cours (`GET /api/alerts`).
 *
 * `id` est l'identifiant du flux de l'opérateur, pas l'UUID interne — celui-ci
 * ne quitte jamais le backend.
 */
export interface Alert {
  id: string;
  /** Texte rédigé par l'opérateur. Nul s'il n'en a publié aucun. */
  headerText: string | null;
  descriptionText: string | null;
  stopIds: string[];
  lines: AlertLine[];
  mode: TransportMode;
  severity: AlertSeverity;
  /** Vocabulaire GTFS-RT conservé tel quel : "MAINTENANCE", "STRIKE"… */
  cause: string;
  effect: string;
  startTime: string;
  /** Nul quand l'opérateur n'annonce aucune fin. Aucune date n'est inventée. */
  endTime: string | null;
}

export interface AlertsResponse {
  items: Alert[];
  /** Plafond appliqué par le serveur. L'endpoint n'est pas paginé. */
  limit: number;
  /** Vrai si des perturbations ont été omises faute de place. */
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// Administration (bloc 6-6)
// ---------------------------------------------------------------------------
// Formes relevées dans `projet/backend/src/admin/dto/` — `admin-user.dto.ts`
// et `admin-stats.dto.ts`. Comme partout ici, les `Date` du backend
// deviennent des chaînes ISO en traversant JSON.

/**
 * Un compte, vu par un administrateur (`GET /api/admin/users`).
 *
 * CINQ CHAMPS, ET PAS UN DE PLUS. Le backend ne sélectionne rien d'autre :
 * ni `passwordHash`, ni les préférences, ni les trajets. Ce n'est pas une
 * omission d'affichage — la donnée ne quitte jamais le serveur.
 */
export interface AdminUser {
  id: string;
  email: string;
  role: UserRole;
  createdAt: string;
  /** Non nul si le compte a été désactivé (suppression LOGIQUE). */
  deletedAt: string | null;
}

/**
 * Page de comptes (`GET /api/admin/users?page=&limit=`).
 *
 * ⚠️ `total` compte TOUS les comptes, désactivés compris : le backend appelle
 * `count()` sans filtre. Le nombre de pages s'en déduit directement.
 */
export interface AdminUsersPage {
  items: AdminUser[];
  page: number;
  limit: number;
  total: number;
}

/** Usage d'un mode (`GET /api/admin/stats`, section `modeUsage`). */
export interface AdminModeUsage {
  mode: TransportMode;
  /**
   * Nombre d'ÉTAPES empruntant ce mode — pas de trajets.
   *
   * Le nom vient du backend, et il est délibéré : un trajet est multimodal,
   * il n'a pas UN mode. L'afficher comme un nombre de trajets retournerait le
   * mensonge que le backend s'est appliqué à éviter.
   */
  segmentCount: number;
  totalDistanceM: number;
}

/**
 * Tableau de bord anonymisé (`GET /api/admin/stats`).
 *
 * AUCUNE DONNÉE NOMINATIVE : que des comptes et des sommes. Aucun paramètre
 * n'est accepté — les chiffres sont globaux et cumulés depuis toujours.
 */
export interface AdminStats {
  users: { active: number; deleted: number };
  routes: { total: number; totalDistanceM: number };
  carbon: {
    totalCo2Grams: number;
    totalSavedVsCarGrams: number;
    /** ⚠️ Nombre d'enregistrements carbone — **pas** de trajets. */
    recordCount: number;
  };
  /** Trié par le backend : du mode le plus employé au moins employé. */
  modeUsage: AdminModeUsage[];
}

// ---------------------------------------------------------------------------
// Adresses favorites (bloc 7)
// ---------------------------------------------------------------------------

/**
 * Emplacement d'une adresse favorite (`enum FavoriteAddressType`).
 *
 * DEUX VALEURS, et deux seulement — celles que le dossier nomme :
 * « mémoriser des adresses favorites (Domicile, Travail) » (§3.2.1).
 *
 * L'enum plutôt qu'un libellé libre : le frontend identifie le domicile par
 * une VALEUR, jamais en comparant « Domicile » à « domicile » ou « Maison ».
 */
export type FavoriteAddressType = "HOME" | "WORK";

/**
 * Adresse favorite (`GET /api/users/me/addresses`).
 *
 * ⚠️ PAS DE `userId` : la route est `/me`, ces adresses sont forcément
 * celles de l'usager connecté. Le backend ne le sélectionne même pas.
 *
 * `address` est le texte SAISI par l'usager, conservé tel quel — aucun
 * géocodage n'a lieu nulle part dans le projet. `latitude` et `longitude`
 * sont ce que la recherche d'itinéraire consomme réellement.
 */
export interface FavoriteAddress {
  id: string;
  type: FavoriteAddressType;
  address: string;
  latitude: number;
  longitude: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Recherche d'adresses (Phase 3A)
// ---------------------------------------------------------------------------

/**
 * Un lieu proposé par `GET /api/geocoding/search`.
 *
 * ⚠️ TROIS CHAMPS. Le backend normalise la réponse du fournisseur et n'en
 * laisse sortir que le nécessaire : de quoi AFFICHER, et de quoi ENVOYER au
 * moteur d'itinéraire. Aucun identifiant OSM, aucune métadonnée.
 */
export interface AdresseTrouvee {
  label: string;
  latitude: number;
  longitude: number;
}

/** Réponse de `GET /api/geocoding/search`. */
export interface GeocodingResponse {
  /** Peut être VIDE — « aucun résultat » est une réponse, pas une erreur. */
  items: AdresseTrouvee[];
  /**
   * Mention imposée par la licence des données, à afficher près des
   * résultats. Elle vient du serveur plutôt que d'être écrite en dur : le
   * jour où le fournisseur change, elle change avec lui.
   */
  attribution: string;
}
