// =============================================================================
// Appels d'authentification (étape 5A-3)
// =============================================================================
// Trois fonctions, construites sur `apiFetch` (5A-2). Aucune couche
// supplémentaire : ce fichier ne fait que nommer les trois routes du backend
// et leur donner leur type de retour.
//
// Son intérêt n'est pas d'abstraire, mais de RASSEMBLER : le jour où une
// route change de chemin, il n'y a qu'un endroit à corriger, et les écrans
// n'ont jamais à connaître « /auth/login ».
// =============================================================================

import { apiFetch } from "./api";
import type { LoginResponse, User } from "./types";

/**
 * Corps de `POST /api/users`.
 *
 * Les préférences sont VOLONTAIREMENT omises. Le backend les accepte
 * (`preferences?`), mais elles exigent alors un `co2BudgetWeekly` — un budget
 * carbone hebdomadaire qu'on ne peut pas demander à quelqu'un qui vient
 * d'arriver, et qu'on ne doit pas inventer à sa place. La relation est
 * facultative côté modèle : un compte sans préférences est parfaitement
 * valide. Elles seront proposées par l'écran de préférences (UC06).
 */
export interface InscriptionRequest {
  email: string;
  password: string;
}

/**
 * Crée un compte. Répond 201.
 *
 * Erreurs attendues du backend :
 *   400  validation (email mal formé, mot de passe < 8 caractères)
 *   409  « Un utilisateur avec l'email … existe déjà »
 */
export function inscrire(donnees: InscriptionRequest): Promise<User> {
  return apiFetch<User>("/users", { method: "POST", body: donnees });
}

/**
 * Ouvre une session. Répond 200 avec le jeton et l'usager.
 *
 * Erreur attendue : 401 « Email ou mot de passe incorrect » — le MÊME message
 * que l'email existe ou non. C'est délibéré côté backend : un message
 * distinct permettrait de découvrir quels emails sont inscrits. Le frontend
 * doit donc se garder de le « préciser » à l'affichage.
 */
export function connecter(donnees: { email: string; password: string }): Promise<LoginResponse> {
  return apiFetch<LoginResponse>("/auth/login", {
    method: "POST",
    body: donnees,
  });
}

/**
 * Lit l'usager courant à partir de son jeton.
 *
 * POURQUOI CET APPEL, alors que la connexion rend déjà `{ id, email, role }`.
 * Deux raisons :
 *
 *   1. au RECHARGEMENT de la page, on ne dispose que du jeton stocké : c'est
 *      le seul moyen de savoir à qui il appartient — et s'il est encore
 *      valable, puisqu'il expire au bout d'une heure ;
 *   2. la réponse est plus complète (préférences incluses) et surtout à jour,
 *      là où le jeton fige les données de l'instant de la connexion.
 *
 * Un 401 signifie « jeton absent, expiré ou falsifié » : à l'appelant
 * d'effacer le jeton stocké plutôt que de le conserver indéfiniment.
 */
export function utilisateurCourant(jeton: string): Promise<User> {
  return apiFetch<User>("/users/me", { token: jeton });
}

// -----------------------------------------------------------------------------
// Réinitialisation de mot de passe (war room)
// -----------------------------------------------------------------------------

export interface MessageReponse {
  message: string;
}

/**
 * Demande une réinitialisation. Répond TOUJOURS 200.
 *
 * ⚠️ NE PERMET PAS DE SAVOIR SI LE COMPTE EXISTE, et l'interface ne doit
 * jamais essayer de le deviner. Le backend répond identiquement pour une
 * adresse inscrite et pour une adresse inconnue : c'est ce qui empêche de lui
 * soumettre une liste d'adresses pour apprendre lesquelles ont un compte.
 *
 * ⚠️ LE MESSAGE DIT « PRÉPARÉ », PAS « ENVOYÉ ». Aucun transport de courriel
 * n'est configuré : annoncer un envoi serait faux. En développement, le lien
 * est journalisé côté serveur.
 *
 * Seule erreur attendue : 400 si l'adresse est mal formée.
 */
export function demanderReinitialisation(
  email: string,
): Promise<MessageReponse> {
  return apiFetch<MessageReponse>("/auth/forgot-password", {
    method: "POST",
    body: { email },
  });
}

/**
 * Consomme un jeton et remplace le mot de passe.
 *
 * Erreurs attendues :
 *   400  jeton inconnu, expiré ou déjà utilisé — un seul message pour les
 *        trois, ou mot de passe trop court.
 *
 * ⚠️ NE CONNECTE PAS. Réinitialiser son mot de passe ne doit pas ouvrir une
 * session : quelqu'un qui aurait intercepté le lien obtiendrait un accès sans
 * jamais prouver qu'il connaît le nouveau mot de passe.
 */
export function reinitialiserMotDePasse(
  token: string,
  password: string,
): Promise<MessageReponse> {
  return apiFetch<MessageReponse>("/auth/reset-password", {
    method: "POST",
    body: { token, password },
  });
}
