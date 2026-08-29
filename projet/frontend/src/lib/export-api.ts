// =============================================================================
// Export des données personnelles (bloc 5F-4)
// =============================================================================
// Le dossier promet à l'usager de « télécharger à tout moment un fichier
// contenant l'intégralité de ses informations personnelles ».
//
// Ce module fait DEUX choses distinctes, et c'est volontaire : demander le
// fichier au serveur, puis le remettre au navigateur. Les séparer permet de
// tester le premier sans DOM, et le second sans réseau.
// =============================================================================

import { apiFetch } from "./api";
import type {
  CarbonRecord,
  LanguagePreference,
  ThemePreference,
  TransportMode,
  UserRole,
} from "./types";

// ---------------------------------------------------------------------------
// Forme du fichier
// ---------------------------------------------------------------------------
//
// ⚠️ TYPES DÉDIÉS, ET NON `User` / `RouteDetail` RÉUTILISÉS. L'export n'est pas
// une vue de plus sur les mêmes objets : il en diffère volontairement.
//
//   - `ExportUser` n'a pas de `preferences` imbriquées (elles ont leur propre
//     section) ;
//   - `ExportPreferences` n'a ni `id` ni `userId` ;
//   - `ExportSegment` n'a pas de `routeId` — il est déjà DANS son trajet ;
//   - `ExportCarbonRecord` n'a pas de `userId`.
//
// Réutiliser les types de l'application aurait promis des champs que le
// serveur ne renvoie pas, et le compilateur n'aurait rien vu.

export interface ExportUser {
  id: string;
  email: string;
  role: UserRole;
  createdAt: string;
  deletedAt: string | null;
}

export interface ExportPreferences {
  preferredModes: TransportMode[];
  pmrMode: boolean;
  co2BudgetWeekly: number;
  notificationsEnabled: boolean;
  language: LanguagePreference;
  theme: ThemePreference;
}

export interface ExportSegment {
  id: string;
  mode: TransportMode;
  operator: string;
  line: string;
  departureTime: string;
  arrivalTime: string;
  distanceM: number;
  gtfsTripId: string | null;
  fromStopId: string;
  toStopId: string;
}

export interface ExportRoute {
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
  segments: ExportSegment[];
}

/** Empreinte carbone, sans `userId` — il vaut toujours `user.id`. */
export type ExportCarbonRecord = Omit<CarbonRecord, "userId">;

export interface ExportCarbonBudget {
  id: string;
  year: number;
  week: number;
  weeklyBudgetGrams: number;
  consumedWeeklyGrams: number;
}

/** Le fichier complet, tel que `GET /api/users/me/export` le rend. */
export interface ExportDonneesPersonnelles {
  /** Numéro de structure : un fichier conservé des années doit être relisible. */
  version: number;
  /** Instant de génération, en ISO 8601 UTC. */
  exportedAt: string;
  user: ExportUser;
  /** `null` quand l'usager n'a jamais enregistré de préférences. */
  preferences: ExportPreferences | null;
  routes: ExportRoute[];
  carbonRecords: ExportCarbonRecord[];
  carbonBudgets: ExportCarbonBudget[];
}

// ---------------------------------------------------------------------------
// Récupération
// ---------------------------------------------------------------------------

/**
 * Demande l'export au serveur. Répond **200**.
 *
 * La route n'accepte AUCUN identifiant : le serveur lit le sien dans le jeton.
 * Il n'y a donc rien à passer, et rien à se tromper de passer.
 *
 * Erreurs attendues :
 *   401  jeton absent, expiré ou invalide
 *   404  compte disparu pendant la vie du jeton
 *
 * ⚠️ Le serveur pose bien un en-tête `Content-Disposition`, mais le frontend
 * NE PEUT PAS le lire : cet en-tête n'est pas exposé par défaut en CORS, et
 * l'exposer supposerait de modifier la configuration du backend pour un simple
 * confort. Le nom de fichier est donc composé ici, à partir d'`exportedAt` —
 * une donnée du corps, toujours disponible.
 */
export function telechargerExport(jeton: string): Promise<ExportDonneesPersonnelles> {
  return apiFetch<ExportDonneesPersonnelles>("/users/me/export", { token: jeton });
}

/**
 * Nom du fichier proposé à l'usager.
 *
 * DATÉ, et c'est utile : deux exports successifs ne s'écrasent pas dans le
 * dossier de téléchargements, et l'usager sait de quand date chaque fichier
 * sans avoir à l'ouvrir.
 *
 * La date est découpée sur la forme ISO (`2026-08-28T...`) plutôt que mise en
 * forme localement : un nom de fichier doit rester trié chronologiquement, ce
 * que « 28 août 2026 » ne permet pas.
 */
export function nomDuFichier(exportedAt: string): string {
  const jour = exportedAt.slice(0, 10);
  // Repli si la date est inexploitable : mieux vaut un nom générique qu'un
  // fichier nommé « urbanflow-donnees-undefined.json ».
  const suffixe = /^\d{4}-\d{2}-\d{2}$/.test(jour) ? `-${jour}` : "";
  return `urbanflow-donnees-personnelles${suffixe}.json`;
}

// ---------------------------------------------------------------------------
// Remise au navigateur
// ---------------------------------------------------------------------------

/**
 * Déclenche l'enregistrement du fichier par le navigateur.
 *
 * ═══ POURQUOI CETTE MÉTHODE, ET PAS UNE AUTRE ═══
 *
 * `<a download>` sur un `Blob` est la seule voie qui fonctionne partout sans
 * bibliothèque. Les alternatives ne conviennent pas :
 *
 *   - un lien direct vers l'API n'emporterait PAS l'en-tête `Authorization`,
 *     et le serveur répondrait 401 ;
 *   - `window.open` ouvrirait un onglet affichant les données personnelles au
 *     lieu de les enregistrer ;
 *   - `showSaveFilePicker` n'existe que sur les navigateurs Chromium.
 *
 * ═══ RIEN N'EST CONSERVÉ ═══
 *
 * L'URL de l'objet est révoquée immédiatement après le clic, et le lien
 * retiré du document. Sans `revokeObjectURL`, le contenu — c'est-à-dire
 * l'intégralité des données personnelles — resterait en mémoire du navigateur
 * jusqu'à la fermeture de l'onglet. Rien n'est écrit dans `localStorage` :
 * un export n'a aucune raison de survivre à son téléchargement.
 */
export function enregistrerFichier(contenu: ExportDonneesPersonnelles, nom: string): void {
  // Indenté sur deux espaces : un export RGPD se lit, il n'est pas seulement
  // traité par une machine.
  const blob = new Blob([JSON.stringify(contenu, null, 2)], {
    type: "application/json",
  });

  const url = URL.createObjectURL(blob);
  const lien = document.createElement("a");
  lien.href = url;
  lien.download = nom;

  // Le lien doit être DANS le document pour que le clic soit honoré par
  // Firefox ; il en ressort aussitôt.
  document.body.appendChild(lien);
  lien.click();
  document.body.removeChild(lien);
  URL.revokeObjectURL(url);
}
