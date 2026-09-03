"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useAuth } from "@/components/AuthProvider";
import {
  ETIQUETTES_BCP47,
  LANGUE_PAR_DEFAUT,
  langueValide,
  TEXTES,
  type Langue,
  type Textes,
} from "@/lib/i18n/dictionnaire";

// =============================================================================
// Langue de l'interface (Phase 5)
// =============================================================================
// ═══ UNE SEULE SOURCE DE VÉRITÉ, COMME POUR LE THÈME ═══
//
// `UserPreferences.language` est la préférence PERSISTÉE. Ce fournisseur en
// dérive la langue affichée, exactement comme `ThemeProvider` dérive le thème.
//
// ⚠️ IL EXISTE POURTANT UN ÉTAT LOCAL, et ce n'est pas une seconde source de
// vérité : c'est la langue de la SESSION COURANTE. Deux raisons l'imposent :
//
//   1. UN VISITEUR NON CONNECTÉ doit pouvoir lire l'application dans sa
//      langue. Il n'a aucune préférence à persister, et lui refuser le choix
//      reviendrait à réserver l'anglais et l'espagnol aux titulaires d'un
//      compte.
//
//   2. LE CHANGEMENT DOIT ÊTRE IMMÉDIAT. Attendre l'aller-retour vers
//      `PATCH /api/users/me/preferences` ferait clignoter l'interface, et une
//      panne réseau la figerait dans la mauvaise langue.
//
// L'état local est RESYNCHRONISÉ dès que la préférence du compte change —
// connexion, déconnexion, modification depuis un autre onglet. La préférence
// reste donc bien ce qui commande, l'état local n'étant qu'un devant.
//
// ═══ LA LANGUE D'UN VISITEUR EST DÉSORMAIS RETENUE (sprint soutenance) ═══
//
// La version précédente ne persistait RIEN, au motif qu'un `localStorage`
// survivrait à la déconnexion et imposerait la langue d'un usager au suivant
// sur un appareil partagé.
//
// L'argument était réel mais mal calibré. Le coût de ne rien retenir est payé
// par TOUS les visiteurs, à CHAQUE visite : quelqu'un qui bascule en espagnol
// et rouvre l'application le lendemain la retrouve en français. Le coût
// inverse — un poste partagé qui s'ouvre dans la langue du précédent
// utilisateur — est immédiatement visible et se corrige d'un clic.
//
// Et l'objection ne tenait pas sur le fond : une langue d'interface n'est pas
// une donnée personnelle. Elle ne dit rien de qui l'a choisie, contrairement
// à un historique de trajets.
//
// ⚠️ LE COMPTE RESTE PRIORITAIRE. Se connecter applique la langue enregistrée,
// et l'écrase dans le stockage local. Un usager qui se connecte doit retrouver
// SA langue, pas celle du navigateur.
// =============================================================================

/// Clé de stockage. Préfixée : `localStorage` est partagé par toute l'origine.
const CLE_LANGUE = "urbanflow.langue";

/**
 * La langue retenue dans ce navigateur, ou `null`.
 *
 * ⚠️ VALIDÉE PAR `langueValide`, jamais crue sur parole. `localStorage` est
 * modifiable par l'usager, une extension ou une version antérieure de
 * l'application : une valeur inattendue ferait chercher `TEXTES["xx"]`, donc
 * `undefined`, et l'interface entière s'effondrerait sur un accès à `t.…`.
 */
function lireLangueLocale(): Langue | null {
  try {
    return langueValide(window.localStorage.getItem(CLE_LANGUE) ?? undefined);
  } catch {
    // Navigation privée stricte : lire peut lever. Une langue n'est pas une
    // raison de casser la page.
    return null;
  }
}

/// Abonnés au choix local, pour que tous les onglets et composants suivent.
const abonnes = new Set<() => void>();

function souscrireLangueLocale(rappel: () => void): () => void {
  abonnes.add(rappel);

  // ⚠️ `storage` NE SE DÉCLENCHE QUE POUR LES AUTRES ONGLETS. C'est pourquoi
  // `ecrireLangueLocale` prévient explicitement les abonnés : sans cela,
  // l'onglet qui écrit ne verrait pas son propre changement.
  const surStorage = (evenement: StorageEvent) => {
    if (evenement.key === CLE_LANGUE || evenement.key === null) {
      rappel();
    }
  };

  window.addEventListener("storage", surStorage);

  return () => {
    abonnes.delete(rappel);
    window.removeEventListener("storage", surStorage);
  };
}

/**
 * Instantané SERVEUR : aucun choix local connu.
 *
 * ⚠️ C'EST CE QUI ÉVITE UNE DIVERGENCE D'HYDRATATION. React rend d'abord avec
 * cet instantané — le même qu'au serveur — puis bascule sur le choix local
 * une fois hydraté. Lire `localStorage` dans un `useState` initial produirait
 * un HTML client différent du HTML serveur sur CHAQUE chaîne de l'interface.
 */
function instantaneServeur(): Langue | null {
  return null;
}

function ecrireLangueLocale(langue: Langue): void {
  try {
    window.localStorage.setItem(CLE_LANGUE, langue);
  } catch {
    // Écriture refusée : le choix vaudra pour cette session seulement.
  }

  for (const abonne of abonnes) {
    abonne();
  }
}

interface Traduction {
  langue: Langue;
  /** Les textes de l'interface dans la langue courante. */
  t: Textes;
  /** Étiquette BCP 47 — pour `Intl` et la synthèse vocale. */
  etiquette: string;
  /**
   * Change la langue, et la retient dans ce navigateur.
   *
   * ⚠️ N'ENREGISTRE RIEN CÔTÉ SERVEUR, même pour un usager connecté. La
   * préférence de compte se règle dans l'espace personnel, où elle est
   * explicitement sauvegardée. Écrire en base à chaque clic sur un sélecteur
   * de la barre de navigation multiplierait les requêtes et surprendrait :
   * un essai de l'espagnol pendant deux minutes ne doit pas redéfinir le
   * compte.
   */
  changerLangue: (langue: Langue) => void;
}

const Contexte = createContext<Traduction | null>(null);

export function LangueProvider({ children }: { children: ReactNode }) {
  const { utilisateur } = useAuth();

  // La préférence du compte, ou le choix local, ou le français.
  //
  // ⚠️ LE CHOIX LOCAL N'EST LU QU'À L'HYDRATATION, jamais au rendu serveur.
  // `useSyncExternalStore` serait plus rigoureux, mais la langue diffère du
  // thème sur un point décisif : elle change le TEXTE de la page, pas ses
  // couleurs. Un instantané serveur en français suivi d'une bascule cliente
  // provoquerait une divergence d'hydratation sur chaque chaîne de
  // l'interface. On part donc du français côté serveur, et l'effet
  // ci-dessous rétablit le choix retenu.
  const choixLocal = useSyncExternalStore(
    souscrireLangueLocale,
    lireLangueLocale,
    instantaneServeur,
  );

  // ⚠️ L'ORDRE DES TROIS SOURCES. Le compte l'emporte : se connecter doit
  // retrouver SA langue, y compris sur une machine dont le navigateur en
  // retient une autre.
  const preferee =
    langueValide(utilisateur?.preferences?.language) ??
    choixLocal ??
    LANGUE_PAR_DEFAUT;

  const [langue, setLangue] = useState<Langue>(preferee);

  /**
   * Préférence déjà prise en compte.
   *
   * ⚠️ PATRON « AJUSTER L'ÉTAT PENDANT LE RENDU », documenté par React — et
   * non un `useEffect` qui poserait un état. Un effet provoquerait un rendu
   * supplémentaire à chaque connexion, et déclencherait
   * `react-hooks/set-state-in-effect` du compilateur React.
   */
  const [prefereeVue, setPrefereeVue] = useState(preferee);

  if (preferee !== prefereeVue) {
    setPrefereeVue(preferee);
    // La préférence du compte reprend la main : c'est elle qui commande.
    setLangue(preferee);
  }

  const changerLangue = useCallback((suivante: Langue) => {
    setLangue(suivante);
    ecrireLangueLocale(suivante);
  }, []);

  return (
    <Contexte.Provider
      value={{
        langue,
        t: TEXTES[langue],
        etiquette: ETIQUETTES_BCP47[langue],
        changerLangue,
      }}
    >
      {children}
    </Contexte.Provider>
  );
}

/**
 * Les textes de l'interface, dans la langue courante.
 *
 * ⚠️ LÈVE HORS DU FOURNISSEUR, plutôt que de rendre le français en silence.
 * Un composant oublié afficherait sinon du français au milieu d'une interface
 * espagnole, sans que rien ne le signale.
 */
export function useTraduction(): Traduction {
  const contexte = useContext(Contexte);

  if (!contexte) {
    throw new Error(
      "useTraduction doit être appelé à l'intérieur d'un <LangueProvider>.",
    );
  }

  return contexte;
}
