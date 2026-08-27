// =============================================================================
// Stockage du jeton d'authentification (étape 5A-3)
// =============================================================================
// LE CHOIX, ET SA LIMITE — à lire avant de s'en servir.
//
// Trois options existaient :
//
//   A. localStorage        simple, lisible par tout script de la page
//   B. cookie HttpOnly     inaccessible au JavaScript, donc à l'abri du XSS
//   C. mémoire seule       perdu à chaque rechargement de page
//
// RETENU : A, et c'est un compromis assumé, pas une ignorance.
//
// Le cookie HttpOnly est plus sûr — un script injecté par une faille XSS ne
// peut pas le lire. Mais il suppose que le serveur le pose lui-même : le
// backend devrait cesser de rendre `accessToken` dans le corps de la réponse
// pour l'écrire dans un `Set-Cookie`, avec `SameSite`, `Secure`, et une
// protection CSRF — puisqu'un cookie part AUTOMATIQUEMENT avec chaque
// requête, y compris celles déclenchées par un autre site. Cela réécrirait
// l'authentification du backend, terminée et testée.
//
// L'option C obligerait à se reconnecter à chaque rechargement : inutilisable.
//
// CE QUE LA LIMITE SIGNIFIE CONCRÈTEMENT : si une faille XSS existait dans
// l'application, un script injecté pourrait lire ce jeton et se faire passer
// pour l'usager pendant une heure (durée de validité côté backend). La
// contre-mesure est donc de ne JAMAIS introduire de XSS — React échappe le
// texte par défaut, et le projet n'utilise nulle part
// `dangerouslySetInnerHTML`.
// =============================================================================

const CLE = "urbanflow.token";

/// Abonnés à notifier quand le jeton change.
///
/// POURQUOI CE PETIT MÉCANISME. `localStorage` est un état MUTABLE EXTÉRIEUR
/// à React : rien ne prévient React qu'il a changé. La primitive prévue pour
/// ce cas est `useSyncExternalStore`, et elle réclame exactement deux choses —
/// une façon de lire (`lireJeton`) et une façon de s'abonner (ci-dessous).
///
/// Bénéfice inattendu : l'événement `storage` du navigateur se déclenche dans
/// les AUTRES onglets. Se déconnecter d'un onglet déconnecte donc les autres,
/// sans une ligne de code supplémentaire.
const abonnes = new Set<() => void>();

function notifier(): void {
  for (const abonne of abonnes) {
    abonne();
  }
}

/** S'abonne aux changements du jeton. Rend la fonction de désabonnement. */
export function souscrireJeton(surChangement: () => void): () => void {
  abonnes.add(surChangement);

  // `storage` ne se déclenche que pour les modifications faites par un AUTRE
  // onglet — d'où le `notifier()` explicite dans nos propres écritures.
  const surAutreOnglet = (evenement: StorageEvent) => {
    if (evenement.key === CLE || evenement.key === null) {
      surChangement();
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("storage", surAutreOnglet);
  }

  return () => {
    abonnes.delete(surChangement);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", surAutreOnglet);
    }
  };
}

/**
 * Ce que le RENDU SERVEUR doit lire.
 *
 * `undefined` — et non `null` — dit « on ne sait pas encore », par opposition
 * à « il n'y a pas de jeton ». La distinction fait toute la différence à
 * l'affichage : l'en-tête montre un espace réservé au lieu d'annoncer
 * « Connexion » à un usager qui se trouve être connecté.
 */
export function jetonCoteServeur(): undefined {
  return undefined;
}

/**
 * Lit le jeton, ou `null`.
 *
 * `typeof window === "undefined"` : ce code peut être évalué CÔTÉ SERVEUR
 * pendant le rendu Next.js, où `localStorage` n'existe pas. Sans cette garde,
 * la page entière planterait au prérendu.
 *
 * Le `try/catch` n'est pas de la superstition : `localStorage` LÈVE dans un
 * navigateur configuré pour bloquer le stockage de site, et en navigation
 * privée sur certains navigateurs. Un usager dans ce cas doit voir
 * l'application fonctionner en anonyme, pas un écran blanc.
 */
export function lireJeton(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage.getItem(CLE);
  } catch {
    return null;
  }
}

/** Enregistre le jeton. Silencieux si le stockage est indisponible. */
export function ecrireJeton(jeton: string): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(CLE, jeton);
    notifier();
  } catch {
    // Stockage refusé : la session vivra le temps de l'onglet, ce qui vaut
    // mieux que de refuser la connexion.
  }
}

/** Efface le jeton — déconnexion, ou jeton rejeté par l'API. */
export function effacerJeton(): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(CLE);
    notifier();
  } catch {
    // Rien à faire : s'il n'a pas pu être écrit, il n'y a rien à effacer.
  }
}
