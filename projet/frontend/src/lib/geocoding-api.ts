// =============================================================================
// Recherche d'adresses (Phase 3A)
// =============================================================================
// Une seule fonction, construite sur `apiFetch` (5A-2).
//
// ⚠️ LE FRONTEND N'APPELLE JAMAIS NOMINATIM DIRECTEMENT, et il ne connaît même
// pas son adresse. Trois raisons, dont la première est bloquante :
//
//   - Nominatim exige un `User-Agent` identifiant l'application, en-tête
//     qu'un navigateur INTERDIT d'écrire. La règle serait impossible à tenir.
//   - Le plafond d'une requête par seconde ne se raisonne que côté serveur.
//   - Changer de fournisseur ne devra toucher aucune ligne d'interface.
// =============================================================================

import { apiFetch } from "./api";
import type { GeocodingResponse } from "./types";

/**
 * Cherche des lieux correspondant à une saisie libre.
 *
 *   GET /api/geocoding/search?q=Tour+Eiffel
 *
 * PUBLIC : aucun jeton. Le dossier place la recherche d'itinéraire en libre
 * accès, et exiger un compte pour saisir une adresse fermerait la porte
 * d'entrée de l'application à un visiteur.
 *
 * ⚠️ `encodeURIComponent` est indispensable : une adresse contenant « & » ou
 * « # » couperait la requête en deux sans lui.
 *
 * Erreurs attendues :
 *   400  saisie absente, plus courte que 3 caractères ou plus longue que 120
 *   503  fournisseur injoignable, en erreur, ou réponse illisible
 *
 * ⚠️ Une liste VIDE n'est PAS une erreur : c'est « aucun lieu ne correspond ».
 * Le 503, lui, invite à réessayer. L'interface doit distinguer les deux —
 * sinon l'usager corrige une saisie parfaitement correcte pendant une panne.
 */
export function rechercherAdresses(
  texte: string,
  signal?: AbortSignal,
): Promise<GeocodingResponse> {
  return apiFetch<GeocodingResponse>(`/geocoding/search?q=${encodeURIComponent(texte)}`, {
    signal,
  });
}
