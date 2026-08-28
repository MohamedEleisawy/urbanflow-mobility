// =============================================================================
// Appels de l'espace personnel (étape 5A-4)
// =============================================================================
// Trois routes, construites sur `apiFetch` (5A-2), comme `auth-api.ts`.
// Aucune nouvelle couche HTTP : ce fichier ne fait que nommer les routes et
// leur donner leur type de retour.
// =============================================================================

import { apiFetch } from "./api";
import type {
  PaginatedRoutes,
  RouteDetail,
  WeeklyCarbonBudget,
  WeeklyCarbonTracking,
} from "./types";

/**
 * Bilan carbone hebdomadaire.
 *
 * @param weeks nombre de semaines à remonter, semaine courante INCLUSE.
 *              Le backend accepte 1 à 52 et REFUSE (400) toute valeur hors
 *              bornes — il ne rabote pas en silence.
 */
export function suiviCarbone(jeton: string, weeks: number): Promise<WeeklyCarbonTracking> {
  return apiFetch<WeeklyCarbonTracking>(`/suivi-carbone?weeks=${weeks}`, {
    token: jeton,
  });
}

/**
 * Budget de la semaine EN COURS.
 *
 * Sans paramètre `year`/`week`, le backend répond pour la semaine courante —
 * c'est exactement ce que demande cet écran. Les deux paramètres vont par
 * paire : en fournir un seul est refusé.
 *
 * `weeklyBudgetGrams`, `remainingGrams` et `exceeded` sont nuls ENSEMBLE
 * lorsque l'usager n'a fixé aucun budget dans ses préférences.
 */
export function budgetHebdomadaire(jeton: string): Promise<WeeklyCarbonBudget> {
  return apiFetch<WeeklyCarbonBudget>("/suivi-carbone/budget", {
    token: jeton,
  });
}

/**
 * Historique paginé des trajets enregistrés.
 *
 * Le backend plafonne `limit` à 50 et numérote les pages à partir de 1 —
 * numérotation HUMAINE, pas un décalage. Une valeur hors bornes est refusée
 * en 400, jamais ramenée au plafond.
 *
 * `page` a une valeur par défaut : l'aperçu de `/mon-espace` (étape 5A-4) ne
 * demande que la première, et n'a pas à s'en soucier.
 */
export function historiqueTrajets(
  jeton: string,
  limit: number,
  page = 1,
): Promise<PaginatedRoutes> {
  return apiFetch<PaginatedRoutes>(`/routes?page=${page}&limit=${limit}`, {
    token: jeton,
  });
}

/**
 * Détail d'un trajet enregistré (étape 5A-8).
 *
 * Rend la route, ses `segments` — ordonnés par heure de départ — et ses
 * `carbonRecords`.
 *
 * ⚠️ LES DEUX TABLEAUX NE SE CORRESPONDENT PAS position par position. Un
 * `CarbonRecord` ne porte aucun `segmentId` : les rapprocher ligne à ligne
 * inventerait une association que le modèle ne contient pas. Le backend le
 * dit lui-même — leur ordre est « arbitraire mais TOTAL », choisi pour être
 * déterministe, pas pour refléter le trajet.
 *
 * Erreurs attendues :
 *   401  jeton absent, expiré ou invalide
 *   404  trajet inexistant OU appartenant à quelqu'un d'autre — le backend
 *        répond volontairement la MÊME chose dans les deux cas, pour ne pas
 *        révéler l'existence d'un trajet qui ne nous appartient pas
 */
export function detailTrajet(jeton: string, id: string): Promise<RouteDetail> {
  return apiFetch<RouteDetail>(`/routes/${id}`, { token: jeton });
}
