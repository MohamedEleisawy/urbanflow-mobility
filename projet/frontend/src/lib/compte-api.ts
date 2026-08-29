// =============================================================================
// Cycle de vie du compte (bloc 5G)
// =============================================================================
// UNE SEULE FONCTION, et un module à part plutôt qu'un ajout à
// `preferences-api.ts` ou `export-api.ts` : supprimer son compte n'est ni une
// préférence ni un export. Le regrouper avec l'un des deux ferait chercher
// une action destructive dans un fichier qui ne l'annonce pas.
// =============================================================================

import { apiFetch } from "./api";

/**
 * Supprime le compte de l'usager authentifié. Répond **204 No Content**.
 *
 * ⚠️ SUPPRESSION LOGIQUE côté serveur : la ligne n'est pas détruite, une date
 * de suppression est posée. Les trajets, préférences et empreintes carbone
 * restent en base — mais le compte devient définitivement inutilisable :
 * la reconnexion est refusée, et le jeton encore valide cesse d'être accepté
 * par TOUTES les routes protégées.
 *
 * La route n'accepte AUCUN identifiant : le serveur lit le sien dans le jeton.
 * Il n'y a donc rien à passer, et rien à se tromper de passer.
 *
 * Erreurs attendues :
 *   401  jeton absent, expiré, invalide — **ou compte déjà supprimé**
 *
 * Pas de 404 : la suppression est idempotente côté service. Pas de 403 : on
 * n'atteint jamais que son propre compte.
 */
export function supprimerMonCompte(jeton: string): Promise<void> {
  return apiFetch<void>("/users/me", { method: "DELETE", token: jeton });
}
