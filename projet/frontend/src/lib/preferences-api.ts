// =============================================================================
// Préférences utilisateur (bloc 5E-2)
// =============================================================================
// UNE SEULE FONCTION, et une seule route. La LECTURE n'a pas sa place ici :
// `GET /api/users/me` renvoie déjà les préférences (`include: { preferences:
// true }` côté backend), et `AuthProvider` charge ce profil au démarrage.
// Ajouter un `lirePreferences()` créerait une SECONDE SOURCE DE VÉRITÉ pour
// une donnée déjà en mémoire — exactement ce que l'étape 5A-4 s'interdisait
// pour le jeton.
// =============================================================================

import { apiFetch } from "./api";
import type { LanguagePreference, ThemePreference, TransportMode, UserPreferences } from "./types";

/**
 * Corps de `PATCH /api/users/me/preferences`.
 *
 * ⚠️ TYPE DISTINCT DE `UserPreferences`, et ce n'est pas un doublon :
 *
 *   - `id`, `userId` n'y figurent PAS. Le serveur les connaît — `userId` vient
 *     du jeton — et les envoyer serait au mieux ignoré, au pire refusé : le
 *     DTO backend ne les déclare pas, et `forbidNonWhitelisted` répond 400.
 *   - tous les champs sont FACULTATIFS. C'est le propre d'un PATCH : on décrit
 *     ce qui change. Un champ absent n'est pas écrasé.
 *
 * Réutiliser `Partial<UserPreferences>` aurait laissé passer `id` et
 * `userId` — donc autorisé le client à envoyer un identifiant, ce que
 * l'interface doit rendre impossible à écrire.
 */
export interface MiseAJourPreferences {
  preferredModes?: TransportMode[];
  pmrMode?: boolean;
  /** Grammes de CO₂ par semaine. Le backend travaille en grammes. */
  co2BudgetWeekly?: number;
  notificationsEnabled?: boolean;
  language?: LanguagePreference;
  theme?: ThemePreference;
}

/**
 * Enregistre les préférences de l'usager authentifié. Répond **200**.
 *
 * ⚠️ LA RÉPONSE EST LA VÉRITÉ. Le serveur renvoie les préférences telles
 * qu'il les a réellement persistées — avec les valeurs par défaut du schéma
 * appliquées à la création, par exemple. Réafficher le corps envoyé plutôt
 * que la réponse montrerait ce que le client croit avoir écrit, pas ce que la
 * base contient.
 *
 * Erreurs attendues :
 *   400  champ inconnu, énumération invalide, mauvais type — ou **budget
 *        carbone absent alors qu'aucune préférence n'existe encore** : il est
 *        le seul champ du modèle sans valeur par défaut, et le backend refuse
 *        d'en inventer une.
 *   401  jeton absent, expiré ou invalide.
 *
 * Ni 403 ni 404 : la route n'atteint jamais que les préférences du porteur du
 * jeton, et n'accepte aucun identifiant.
 */
export function enregistrerPreferences(
  jeton: string,
  modifications: MiseAJourPreferences,
): Promise<UserPreferences> {
  return apiFetch<UserPreferences>("/users/me/preferences", {
    method: "PATCH",
    body: modifications,
    token: jeton,
  });
}
