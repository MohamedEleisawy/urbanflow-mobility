"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ApiError } from "@/lib/api";
import { connecter, inscrire, utilisateurCourant } from "@/lib/auth-api";
import {
  ecrireJeton,
  effacerJeton,
  jetonCoteServeur,
  lireJeton,
  souscrireJeton,
} from "@/lib/auth-storage";
import type { User, UserPreferences } from "@/lib/types";

// =============================================================================
// État d'authentification partagé (étape 5A-3)
// =============================================================================
// UN CONTEXTE REACT, ET RIEN DE PLUS. Ni Zustand, ni Redux : l'état tient en
// deux valeurs, et un seul endroit les écrit. Une bibliothèque de gestion
// d'état résoudrait un problème que nous n'avons pas.
//
// DEUX CHOIX QUI MÉRITENT UNE EXPLICATION
//
// 1. `useSyncExternalStore` pour lire le jeton. `localStorage` est un état
//    mutable EXTÉRIEUR à React : rien ne prévient React qu'il a changé, et le
//    lire pendant le rendu provoquerait une divergence entre le HTML produit
//    par le serveur et celui du navigateur. C'est exactement le problème que
//    cette primitive existe pour résoudre — et elle donne en prime la
//    synchronisation entre onglets.
//
// 2. `statut` est CALCULÉ, jamais stocké. Le déduire des trois faits connus
//    (le jeton est-il lu ? le profil est-il là ? le backend a-t-il répondu ?)
//    supprime toute possibilité qu'il contredise le reste. C'est aussi ce qui
//    évite d'appeler `setState` dans le corps d'un effet, ce que la règle
//    `react-hooks/set-state-in-effect` du compilateur React interdit à juste
//    titre : un état dérivé n'a pas à être recopié.
// =============================================================================

/**
 * Trois états, et le premier compte autant que les autres.
 *
 * `chargement` existe parce qu'au premier rendu on ne SAIT PAS encore si
 * l'usager est connecté : le jeton n'est pas lisible côté serveur, et il faut
 * ensuite demander au backend s'il est toujours valable. Sans cet état,
 * l'en-tête afficherait « Connexion » pendant une fraction de seconde à un
 * usager connecté — un scintillement déroutant.
 */
export type StatutAuth = "chargement" | "authentifie" | "anonyme";

interface ContexteAuth {
  statut: StatutAuth;
  utilisateur: User | null;
  /**
   * Jeton courant, ou `null`.
   *
   * EXPOSÉ À L'ÉTAPE 5A-4, et pour une raison de principe : les écrans
   * protégés doivent joindre l'API avec le jeton. Les laisser appeler
   * `lireJeton()` eux-mêmes créerait une SECONDE source de vérité — une page
   * pourrait alors lire un jeton que le provider a déjà jugé invalide.
   *
   * Ici, il vient du même `useSyncExternalStore` que le reste : un seul
   * endroit sait ce qu'est la session courante.
   */
  jeton: string | null;
  /** Ouvre une session et mémorise le jeton. Lève en cas d'échec. */
  connexion: (email: string, motDePasse: string) => Promise<void>;
  /** Crée un compte PUIS ouvre la session. Lève en cas d'échec. */
  inscription: (email: string, motDePasse: string) => Promise<void>;
  deconnexion: () => void;
  /**
   * Applique des préférences fraîchement enregistrées (bloc 5E-4).
   *
   * ═══ POURQUOI PAS UN NOUVEL APPEL À `GET /users/me` ═══
   *
   * La réponse du `PATCH` EST déjà la vérité : le backend renvoie la ligne
   * telle qu'il vient de la persister, valeurs par défaut du schéma
   * comprises. Redemander le profil entier coûterait un aller-retour pour
   * réapprendre ce qu'on vient d'apprendre — contraire à l'objectif de
   * sobriété du dossier — et ouvrirait une fenêtre où deux réponses
   * pourraient se croiser.
   *
   * ═══ POURQUOI ÇA NE CRÉE PAS UNE SECONDE SOURCE DE VÉRITÉ ═══
   *
   * L'écran de préférences n'a AUCUN état de son côté pour les valeurs
   * enregistrées : il lit `utilisateur.preferences` comme tout le monde, et
   * se contente de pousser ici ce que le serveur lui a répondu. Le provider
   * reste l'unique détenteur du profil.
   */
  appliquerPreferences: (preferences: UserPreferences) => void;
}

const Contexte = createContext<ContexteAuth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // `undefined` = rendu serveur, on ne sait pas ; `null` = pas de jeton ;
  // une chaîne = un jeton à vérifier.
  const jeton = useSyncExternalStore(souscrireJeton, lireJeton, jetonCoteServeur);

  const [utilisateur, setUtilisateur] = useState<User | null>(null);
  /// Le backend a répondu au sujet du jeton courant — quelle que soit sa
  /// réponse. Sert à distinguer « on attend encore » de « on a demandé, et
  /// ce jeton ne vaut rien ».
  const [verifie, setVerifie] = useState(false);

  // --- Vérification du jeton auprès du backend -----------------------------
  useEffect(() => {
    // Pas de jeton, ou rendu serveur : rien à vérifier.
    if (!jeton) {
      return;
    }

    // Un jeton présent ne suffit pas : il expire au bout d'une heure, et rien
    // n'empêche qu'il ait été modifié. Seul le backend peut trancher.
    let abandonne = false;

    utilisateurCourant(jeton)
      .then((profil) => {
        if (abandonne) return;
        setUtilisateur(profil);
        setVerifie(true);
      })
      .catch((erreur: unknown) => {
        if (abandonne) return;

        // 401 : jeton expiré ou invalide → on l'efface, il ne servira plus.
        // Toute AUTRE erreur (backend éteint, coupure réseau) laisse le jeton
        // en place : il redeviendra utilisable quand le serveur reviendra.
        // L'effacer punirait l'usager d'une panne qui n'est pas la sienne.
        if (erreur instanceof ApiError && erreur.estNonAuthentifie) {
          effacerJeton();
        }
        setUtilisateur(null);
        setVerifie(true);
      });

    return () => {
      abandonne = true;
    };
  }, [jeton]);

  const ouvrirSession = useCallback(async (email: string, mdp: string) => {
    const { accessToken } = await connecter({ email, password: mdp });

    // On relit le profil complet plutôt que d'utiliser le `user` de la
    // réponse de connexion : celui-ci ne porte ni préférences, ni date de
    // création. Un seul chemin alimente donc l'état, ici comme au
    // rechargement — moins de code, et aucun risque de divergence.
    const profil = await utilisateurCourant(accessToken);

    // Écrit en DERNIER : si la relecture du profil échouait, on n'aurait pas
    // mémorisé un jeton pour une session qu'on ne sait pas décrire.
    ecrireJeton(accessToken);
    setUtilisateur(profil);
    setVerifie(true);
  }, []);

  const creerCompte = useCallback(
    async (email: string, mdp: string) => {
      // L'inscription ne rend PAS de jeton (le backend répond 201 avec
      // l'usager créé) : on enchaîne donc sur une connexion. C'est ce que
      // l'usager attend — personne ne souhaite ressaisir ce qu'il vient de
      // taper.
      await inscrire({ email, password: mdp });
      await ouvrirSession(email, mdp);
    },
    [ouvrirSession],
  );

  const appliquerPreferences = useCallback((preferences: UserPreferences) => {
    // Forme fonctionnelle : deux enregistrements rapprochés ne doivent pas
    // se baser sur une capture périmée du profil.
    setUtilisateur((precedent) => (precedent ? { ...precedent, preferences } : precedent));
  }, []);

  const fermerSession = useCallback(() => {
    // Rien à demander au backend : un JWT est autoportant, il n'existe aucune
    // session à invalider côté serveur. Se déconnecter, c'est oublier le
    // jeton. (Il reste techniquement valable jusqu'à son expiration — la
    // limite d'un JWT sans liste de révocation, hors périmètre ici.)
    effacerJeton();
    setUtilisateur(null);
    setVerifie(false);
  }, []);

  /// DÉRIVÉ, jamais stocké : trois faits, un seul statut possible.
  const statut: StatutAuth =
    jeton === undefined
      ? "chargement"
      : jeton === null
        ? "anonyme"
        : utilisateur
          ? "authentifie"
          : verifie
            ? "anonyme"
            : "chargement";

  // `useMemo` : sans lui, un nouvel objet serait créé à chaque rendu et tous
  // les composants abonnés se redessineraient inutilement.
  const valeur = useMemo<ContexteAuth>(
    () => ({
      statut,
      utilisateur,
      // `undefined` (rendu serveur) est normalisé en `null` : un appelant n'a
      // pas à distinguer « pas encore lu » de « absent » — `statut` le dit
      // déjà, et plus clairement.
      jeton: jeton ?? null,
      connexion: ouvrirSession,
      inscription: creerCompte,
      deconnexion: fermerSession,
      appliquerPreferences,
    }),
    [statut, utilisateur, jeton, ouvrirSession, creerCompte, fermerSession, appliquerPreferences],
  );

  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}

/**
 * Accède à l'état d'authentification.
 *
 * Lève si le provider est absent : une erreur explicite au premier rendu vaut
 * mieux qu'un `utilisateur` éternellement `null` qu'on passerait des heures à
 * expliquer.
 */
export function useAuth(): ContexteAuth {
  const contexte = useContext(Contexte);

  if (!contexte) {
    throw new Error("useAuth doit être utilisé à l'intérieur de <AuthProvider>");
  }

  return contexte;
}
