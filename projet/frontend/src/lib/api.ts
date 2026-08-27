// =============================================================================
// Client HTTP de l'API UrbanFlow (étape 5A-2)
// =============================================================================
// Ce fichier ne DÉCLENCHE aucune requête : il n'expose que les briques que les
// écrans des étapes suivantes utiliseront. Rien ici n'est appelé aujourd'hui.
//
// POURQUOI `fetch` NATIF, ET RIEN D'AUTRE
//
// Axios, React Query, SWR : chacun résout un vrai problème — intercepteurs,
// cache, revalidation, états de chargement. Aucun de ces problèmes ne se pose
// encore. `fetch` est natif dans le navigateur ET dans Node, il ne pèse rien
// dans le bundle, et Next.js s'appuie dessus pour son propre cache.
//
// La règle du projet est constante depuis le backend : on n'ajoute une
// dépendance que lorsque son absence coûte plus cher que sa présence. Le jour
// où le cache serveur deviendra un vrai sujet, React Query se posera par
// dessus ces fonctions sans les remplacer.
// =============================================================================

/**
 * Racine de l'API, préfixe `/api` INCLUS.
 *
 * La valeur vient de `NEXT_PUBLIC_API_URL`. Le préfixe fait partie de la
 * variable — c'est la convention du `.env.example` de la racine et de
 * docker-compose.yml, qui injecte `http://localhost:3001/api` dans le
 * conteneur. Reconstruire `/api` ici entrerait en conflit avec cette valeur.
 *
 * Le repli sur localhost sert le développement local : contrairement à
 * l'adresse d'un flux GTFS-RT (voir backend, étape 4F-1D), un repli a ici du
 * sens, puisque le backend écoute effectivement sur ce port en local.
 */
const RACINE_API = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api").replace(
  /\/+$/,
  "",
);

/**
 * Erreur renvoyée par l'API, avec son statut HTTP.
 *
 * POURQUOI UNE CLASSE, plutôt qu'une `Error` nue. Un écran doit pouvoir
 * réagir DIFFÉREMMENT selon le statut : proposer une reconnexion sur 401,
 * afficher « indisponible » sur 503, signaler une saisie invalide sur 400.
 * Distinguer ces cas en lisant le texte du message serait fragile — c'est
 * exactement la leçon tirée côté backend à l'étape 4F-1D.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Le jeton est absent, expiré ou refusé : il faut se reconnecter. */
  get estNonAuthentifie(): boolean {
    return this.status === 401;
  }

  /** Authentifié, mais droits insuffisants (rôle ADMIN attendu). */
  get estInterdit(): boolean {
    return this.status === 403;
  }

  /** Une dépendance du backend est en panne — le microservice carbone, typiquement. */
  get estIndisponible(): boolean {
    return this.status === 503;
  }
}

/** Erreur de transport : serveur éteint, réseau coupé, requête bloquée. */
export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

export interface RequestOptions {
  /** Verbe HTTP. GET par défaut. */
  method?: "GET" | "POST" | "DELETE";
  /** Corps à sérialiser en JSON. */
  body?: unknown;
  /**
   * Jeton JWT, quand la route l'exige.
   *
   * Transmis EXPLICITEMENT plutôt que lu depuis un stockage global. Le client
   * reste ainsi utilisable côté serveur comme côté navigateur, et surtout on
   * voit, à la lecture de l'appel, si une route est authentifiée ou non.
   */
  token?: string | null;
  /** Permet d'annuler la requête si le composant est démonté. */
  signal?: AbortSignal;
}

/**
 * Appelle l'API et rend la réponse désérialisée.
 *
 * @param chemin chemin RELATIF à la racine, commençant par « / » — par
 *               exemple `/alerts` ou `/routes/search`.
 *
 * @throws {ApiError}     réponse reçue, mais en erreur (4xx / 5xx)
 * @throws {NetworkError} aucune réponse : serveur injoignable, CORS, coupure
 */
export async function apiFetch<T>(chemin: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, token, signal } = options;

  const entetes: Record<string, string> = {};

  // Content-Type UNIQUEMENT s'il y a un corps : l'envoyer sur un GET est au
  // mieux inutile, au pire un déclencheur de requête CORS préalable.
  if (body !== undefined) {
    entetes["Content-Type"] = "application/json";
  }
  if (token) {
    entetes.Authorization = `Bearer ${token}`;
  }

  let reponse: Response;

  try {
    reponse = await fetch(`${RACINE_API}${chemin}`, {
      method,
      headers: entetes,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (erreur) {
    // Une requête annulée n'est pas une panne : on la laisse remonter telle
    // quelle, sans quoi un composant démonté afficherait « serveur
    // injoignable » alors que l'usager a simplement changé de page.
    if (erreur instanceof DOMException && erreur.name === "AbortError") {
      throw erreur;
    }

    // `fetch` ne rejette que si AUCUNE réponse n'arrive : serveur éteint,
    // réseau coupé, ou requête bloquée par la politique CORS du navigateur.
    // Ce dernier cas sera le plus probable au premier raccordement.
    throw new NetworkError(
      "Le serveur est injoignable. Vérifiez qu'il est démarré, puis réessayez.",
    );
  }

  if (!reponse.ok) {
    throw new ApiError(reponse.status, await lireMessageDErreur(reponse));
  }

  // 204 No Content : une suppression réussie n'a pas de corps, et
  // `response.json()` lèverait sur une chaîne vide.
  if (reponse.status === 204) {
    return undefined as T;
  }

  return (await reponse.json()) as T;
}

/**
 * Extrait un message lisible d'une réponse en erreur.
 *
 * NestJS répond `{ statusCode, message, error }`, où `message` est une chaîne
 * OU un tableau quand la validation rejette plusieurs champs à la fois. Les
 * deux formes sont traitées ; à défaut, un texte générique est rendu — jamais
 * `[object Object]`, ni le corps brut, qui pourrait exposer des détails
 * internes à l'usager.
 */
async function lireMessageDErreur(reponse: Response): Promise<string> {
  try {
    const corps: unknown = await reponse.json();

    if (typeof corps === "object" && corps !== null && "message" in corps) {
      const message = (corps as { message: unknown }).message;

      if (typeof message === "string") {
        return message;
      }
      if (Array.isArray(message)) {
        return message.filter((m) => typeof m === "string").join(" · ");
      }
    }
  } catch {
    // Corps vide ou non-JSON — une page d'erreur HTML, par exemple.
  }

  return `La requête a échoué (HTTP ${reponse.status}).`;
}

/**
 * Message d'erreur destiné à l'affichage, quelle que soit l'origine.
 *
 * Sert de garde-fou : une erreur inattendue ne doit jamais faire fuiter une
 * trace d'exécution dans l'interface.
 */
export function messageDErreur(erreur: unknown): string {
  if (erreur instanceof ApiError || erreur instanceof NetworkError) {
    return erreur.message;
  }
  return "Une erreur inattendue est survenue.";
}
