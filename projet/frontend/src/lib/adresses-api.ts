// =============================================================================
// Adresses favorites (bloc 7)
// =============================================================================
// Quatre routes, construites sur `apiFetch` (5A-2), comme `espace-api.ts` et
// `admin-api.ts`. Aucune logique d'authentification n'est recopiée : le jeton
// est transmis explicitement, comme partout ailleurs.
//
// ⚠️ AUCUNE FONCTION NE PREND D'IDENTIFIANT D'USAGER. Les chemins visent
// `/users/me/...` : le serveur lit l'identité dans le jeton signé. Il n'y a
// donc rien à passer, et rien à se tromper de passer.
// =============================================================================

import { apiFetch } from "./api";
import type { FavoriteAddress, FavoriteAddressType } from "./types";

/** Corps accepté par la création. Reflet exact de `CreateAddressDto`. */
export interface NouvelleAdresse {
  type: FavoriteAddressType;
  address: string;
  latitude: number;
  longitude: number;
}

/**
 * Les adresses du compte, de zéro à deux.
 *
 *   GET /api/users/me/addresses
 *
 * Ordonnées par le backend : Domicile avant Travail. Un compte sans adresse
 * rend un tableau VIDE — jamais 404 : « aucune adresse » est l'état normal
 * d'un compte neuf, pas une erreur.
 *
 * Erreurs attendues : 401 (jeton absent, expiré, ou compte supprimé).
 */
export function listerAdresses(jeton: string, signal?: AbortSignal): Promise<FavoriteAddress[]> {
  return apiFetch<FavoriteAddress[]>("/users/me/addresses", { token: jeton, signal });
}

/**
 * Enregistre une adresse. Répond **201**.
 *
 *   POST /api/users/me/addresses
 *
 * Erreurs attendues :
 *   400  validation — coordonnées hors bornes, adresse vide, champ inconnu
 *   401  jeton invalide
 *   409  une adresse de ce type existe déjà (un seul Domicile, un seul Travail)
 */
export function creerAdresse(jeton: string, adresse: NouvelleAdresse): Promise<FavoriteAddress> {
  return apiFetch<FavoriteAddress>("/users/me/addresses", {
    method: "POST",
    body: adresse,
    token: jeton,
  });
}

/**
 * Modifie une adresse. Répond **200** avec la ligne à jour.
 *
 *   PATCH /api/users/me/addresses/:id
 *
 * `PATCH` : le corps décrit ce qui CHANGE. C'est le verbe que la politique
 * CORS du backend a dû apprendre à l'étape 7-1.
 *
 * Erreurs attendues : 400, 401, 404 (inexistante OU appartenant à autrui —
 * le backend les rend volontairement indiscernables), 409.
 */
export function modifierAdresse(
  jeton: string,
  id: string,
  champs: Partial<NouvelleAdresse>,
): Promise<FavoriteAddress> {
  return apiFetch<FavoriteAddress>(`/users/me/addresses/${id}`, {
    method: "PATCH",
    body: champs,
    token: jeton,
  });
}

/**
 * Supprime une adresse. Répond **204 No Content**.
 *
 *   DELETE /api/users/me/addresses/:id
 *
 * ⚠️ SUPPRESSION RÉELLE, contrairement au compte lui-même (5G) : une adresse
 * favorite est un raccourci, pas une trace d'activité. Supprimer deux fois
 * rend donc 404 la seconde fois.
 *
 * Erreurs attendues : 400 (identifiant mal formé), 401, 404.
 */
export function supprimerAdresse(jeton: string, id: string): Promise<void> {
  return apiFetch<void>(`/users/me/addresses/${id}`, { method: "DELETE", token: jeton });
}
