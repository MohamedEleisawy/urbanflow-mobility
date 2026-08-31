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
export type TransportMode = "WALK" | "BUS" | "TRAM" | "METRO" | "BIKE" | "ESCOOTER" | "CAR";

/// Rôles (`enum RoleEnum`).
///
/// ⚠️ Commentaire corrigé au bloc 6-6 : il affirmait que l'autorisation par
/// rôle n'était « pas encore branchée côté backend ». C'est faux depuis
/// l'étape 6-1 — `RolesGuard` et `@Roles(ADMIN)` protègent réellement
/// `/api/admin/*`. Un commentaire périmé désinforme plus sûrement qu'un
/// commentaire absent.
export type UserRole = "USER" | "ADMIN";

export type ThemePreference = "LIGHT" | "DARK" | "SYSTEM";
export type LanguagePreference = "FR" | "EN";

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

// ---------------------------------------------------------------------------
// Recherche d'itinéraire
// ---------------------------------------------------------------------------

/**
 * Corps attendu par `POST /api/routes/search`.
 *
 * ⚠️ Des COORDONNÉES, pas des noms d'arrêt. L'écran de recherche devra donc
 * faire choisir des arrêts (via `GET /api/stops`) et transmettre leurs
 * coordonnées.
 */
export interface SearchItineraryRequest {
  fromLat: number;
  fromLon: number;
  toLat: number;
  toLon: number;
}

/** Critère selon lequel un itinéraire a été optimisé. */
export type ItineraryCriterion = "FASTEST" | "SHORTEST";

/** Une portion de trajet, entre deux arrêts. */
export interface ItinerarySegment {
  fromStopId: string;
  fromStopName: string;
  toStopId: string;
  toStopName: string;
  mode: TransportMode;
  /** Nom affiché de la ligne — « 38 », « A »… */
  lineName: string;
  operator: string;
  /** Identifiant de la LIAISON retenue, à renvoyer pour enregistrer le trajet. */
  lineId: string;
  distanceM: number;
  durationMin: number;
}

export interface Itinerary {
  criterion: ItineraryCriterion;
  totalDistanceM: number;
  totalDurationMin: number;
  segments: ItinerarySegment[];
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
