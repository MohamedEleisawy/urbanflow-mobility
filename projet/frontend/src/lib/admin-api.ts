// =============================================================================
// Appels du back-office administrateur (bloc 6-6)
// =============================================================================
// Trois routes, toutes construites sur `apiFetch` (5A-2). Ce fichier ne fait
// que NOMMER les routes et leur donner leur type de retour : aucune logique
// d'authentification n'est recopiée ici, aucun en-tête n'est fabriqué à la
// main. Le jeton est transmis explicitement, comme partout ailleurs.
//
// POURQUOI UN MODULE À PART. Ces trois routes partagent une propriété qu'on
// ne retrouve nulle part ailleurs dans l'application : elles échouent en 403
// pour un usager parfaitement authentifié. Les mêler à `espace-api.ts`
// laisserait croire qu'un compte ordinaire peut les appeler.
// =============================================================================

import { apiFetch } from "./api";
import type { AdminStats, AdminUsersPage } from "./types";

/**
 * Tableau de bord anonymisé.
 *
 *   GET /api/admin/stats
 *
 * AUCUN PARAMÈTRE : les statistiques sont globales et cumulées depuis
 * toujours. Le backend n'accepte ni période ni filtre — un paramètre ajouté
 * ici serait ignoré, ce qui est pire qu'une erreur, car silencieux.
 *
 * Erreurs attendues :
 *   401  jeton absent, expiré ou invalide
 *   403  authentifié, mais le compte n'est pas ADMIN
 */
export function recupererStatsAdmin(jeton: string, signal?: AbortSignal): Promise<AdminStats> {
  return apiFetch<AdminStats>("/admin/stats", { token: jeton, signal });
}

/**
 * Liste paginée de TOUS les comptes, désactivés compris.
 *
 *   GET /api/admin/users?page=1&limit=20
 *
 * Le backend réutilise le DTO de pagination de `GET /api/routes` : page ≥ 1
 * (numérotation humaine), `limit` entre 1 et 50. Une valeur hors bornes est
 * REFUSÉE en 400 — elle n'est pas ramenée au plafond en silence. C'est
 * pourquoi l'appelant ne doit jamais construire ces valeurs à partir d'une
 * saisie libre.
 *
 * Les comptes sont ordonnés du plus récemment créé au plus ancien, et `total`
 * compte l'ensemble des comptes — y compris ceux dont `deletedAt` est posé.
 *
 * Erreurs attendues : 400 (pagination hors bornes), 401, 403.
 */
export function listerUtilisateursAdmin(
  jeton: string,
  page: number,
  limit: number,
  signal?: AbortSignal,
): Promise<AdminUsersPage> {
  return apiFetch<AdminUsersPage>(`/admin/users?page=${page}&limit=${limit}`, {
    token: jeton,
    signal,
  });
}

/**
 * Désactive logiquement un compte. Répond **204 No Content**.
 *
 *   DELETE /api/admin/users/:id
 *
 * ⚠️ SUPPRESSION LOGIQUE, jamais physique : le backend pose une date sur le
 * compte. La ligne subsiste, et elle reparaîtra dans la liste marquée
 * « Désactivé ». Les trajets, préférences et empreintes carbone de la
 * personne sont conservés — aucune cascade ne se déclenche.
 *
 * ⚠️ SEUL APPEL DE L'APPLICATION QUI DÉSIGNE QUELQU'UN D'AUTRE. Toutes les
 * autres routes visent `/me`. L'identifiant de l'appelant, lui, n'est PAS
 * transmis : le backend le lit dans le jeton, et c'est ainsi qu'il refuse
 * l'auto-suppression. Le corps de la requête est ignoré — il n'y a donc rien
 * qu'un client puisse glisser pour se faire passer pour un autre.
 *
 * Erreurs attendues :
 *   400  auto-suppression, ou identifiant qui n'est pas un UUID
 *   401  jeton absent, expiré ou invalide
 *   403  authentifié, mais le compte n'est pas ADMIN
 *   404  compte inexistant
 *
 * Un compte DÉJÀ désactivé répond 204, sans redater la suppression : l'appel
 * est idempotent côté serveur.
 */
export function desactiverUtilisateurAdmin(jeton: string, id: string): Promise<void> {
  return apiFetch<void>(`/admin/users/${id}`, { method: "DELETE", token: jeton });
}
