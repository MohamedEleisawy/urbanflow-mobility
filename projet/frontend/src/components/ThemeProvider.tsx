"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
} from "react";
import { useAuth } from "@/components/AuthProvider";
import type { ThemePreference } from "@/lib/types";

// =============================================================================
// Application du thème (sprint soutenance — refonte du provider)
// =============================================================================
// ═══ CE QUE CETTE VERSION RÉPARE ═══
//
// La précédente lisait UNIQUEMENT `utilisateur.preferences.theme`. Conséquence
// visible : un VISITEUR NON CONNECTÉ ne pouvait pas choisir son thème. Le
// dossier promet un mode sombre ; l'application le réservait aux inscrits,
// pour une préférence d'affichage qui n'a rien de personnel.
//
// ═══ LES TROIS SOURCES, ET LEUR ORDRE ═══
//
//   1. la PRÉFÉRENCE DU COMPTE, si quelqu'un est connecté ;
//   2. sinon, le CHOIX LOCAL de ce navigateur (`localStorage`) ;
//   3. sinon, le SYSTÈME (`prefers-color-scheme`).
//
// ⚠️ LE COMPTE PASSE AVANT LE CHOIX LOCAL, et c'est délibéré. Se connecter
// doit retrouver ses réglages, y compris sur une machine empruntée — sinon la
// préférence enregistrée côté serveur ne servirait à rien.
//
// ⚠️ SE DÉCONNECTER NE CASSE PAS LE THÈME. Le choix local n'est jamais effacé
// à la déconnexion : l'interface retombe dessus. Une bascule brutale vers le
// clair au moment où l'on se déconnecte donnerait l'impression d'un bogue.
//
// ═══ POURQUOI `useSyncExternalStore` POUR LE CHOIX LOCAL ═══
//
// `localStorage` n'existe pas au rendu serveur. Le lire dans un `useState`
// initial produirait une hydratation divergente ; le lire dans un `useEffect`
// ferait clignoter le thème. `useSyncExternalStore` prend un instantané
// serveur explicite (« aucun choix ») et bascule à l'hydratation, ce que React
// gère sans avertissement.
// =============================================================================

/// Clé de stockage. Préfixée : `localStorage` est partagé par toute l'origine.
const CLE_THEME = "urbanflow.theme";

/**
 * Les valeurs qu'un usager peut choisir.
 *
 * Identiques à `ThemePreference` du backend — volontairement : un visiteur qui
 * se crée un compte doit retrouver le réglage qu'il avait, sans conversion.
 */
export type ChoixTheme = ThemePreference;

/**
 * Traduit la préférence en valeur de `data-theme`.
 *
 * `SYSTEM` rend `null` : on RETIRE alors l'attribut, laissant la feuille de
 * style suivre `prefers-color-scheme`. Écrire « light » en dur ignorerait un
 * système configuré en sombre — ce que « Système » promet de respecter.
 */
export function valeurDataTheme(theme: ThemePreference): "light" | "dark" | null {
  if (theme === "LIGHT") return "light";
  if (theme === "DARK") return "dark";
  return null;
}

// -----------------------------------------------------------------------------
// Le choix local, exposé comme un « store » externe
// -----------------------------------------------------------------------------

/// Abonnés au choix local, pour que tous les composants suivent une bascule.
const abonnes = new Set<() => void>();

function prevenir() {
  for (const abonne of abonnes) {
    abonne();
  }
}

function souscrireChoixLocal(rappel: () => void): () => void {
  abonnes.add(rappel);

  // ⚠️ `storage` NE SE DÉCLENCHE QUE POUR LES AUTRES ONGLETS — jamais pour
  // celui qui écrit. C'est pourquoi `prevenir()` existe : sans lui, l'onglet
  // courant ne verrait pas son propre changement. Les deux sont nécessaires.
  const surStorage = (evenement: StorageEvent) => {
    if (evenement.key === CLE_THEME || evenement.key === null) {
      rappel();
    }
  };

  window.addEventListener("storage", surStorage);

  return () => {
    abonnes.delete(rappel);
    window.removeEventListener("storage", surStorage);
  };
}

function lireChoixLocal(): ChoixTheme | null {
  try {
    const brut = window.localStorage.getItem(CLE_THEME);

    // ⚠️ ON VALIDE LA VALEUR RELUE. `localStorage` est modifiable par
    // l'usager, une extension, ou une version précédente de l'application :
    // une chaîne inattendue poserait `data-theme="null"`, que la feuille de
    // style ne connaît pas — et le thème système cesserait de s'appliquer.
    if (brut === "LIGHT" || brut === "DARK" || brut === "SYSTEM") {
      return brut;
    }

    return null;
  } catch {
    // Navigation privée stricte, cookies bloqués : lire peut lever. Un thème
    // n'est pas une raison de casser la page.
    return null;
  }
}

/// Instantané SERVEUR : aucun choix local, donc le système décide.
function instantaneServeur(): ChoixTheme | null {
  return null;
}

// -----------------------------------------------------------------------------
// Le contexte
// -----------------------------------------------------------------------------

interface ContexteTheme {
  /** Le choix EFFECTIF, toutes sources confondues. */
  theme: ChoixTheme;

  /**
   * Vrai si ce choix vient du compte connecté.
   *
   * L'interface s'en sert pour dire à un usager connecté que sa bascule ne
   * sera pas retenue tant qu'il ne l'aura pas enregistrée dans ses
   * préférences — plutôt que de laisser croire à un réglage perdu.
   */
  vientDuCompte: boolean;

  choisir: (theme: ChoixTheme) => void;
}

const Contexte = createContext<ContexteTheme | null>(null);

export function useTheme(): ContexteTheme {
  const contexte = useContext(Contexte);

  if (!contexte) {
    throw new Error("useTheme doit être utilisé dans un ThemeProvider");
  }

  return contexte;
}

export function ThemeProvider({ children }: { children?: React.ReactNode }) {
  const { utilisateur } = useAuth();

  const choixLocal = useSyncExternalStore(
    souscrireChoixLocal,
    lireChoixLocal,
    instantaneServeur,
  );

  const themeDuCompte = utilisateur?.preferences?.theme ?? null;
  const vientDuCompte = themeDuCompte !== null;

  // L'ordre des trois sources. `SYSTEM` clôt la chaîne : c'est le défaut, et
  // c'est aussi ce que voit un visiteur qui n'a jamais rien choisi.
  const theme: ChoixTheme = themeDuCompte ?? choixLocal ?? "SYSTEM";

  const choisir = useCallback((suivant: ChoixTheme) => {
    try {
      window.localStorage.setItem(CLE_THEME, suivant);
    } catch {
      // Écriture refusée : la bascule vaudra pour cette session seulement.
      // Mieux qu'une erreur affichée pour un réglage d'affichage.
    }

    prevenir();
  }, []);

  useEffect(() => {
    const valeur = valeurDataTheme(theme);
    const racine = document.documentElement;

    if (valeur) {
      racine.dataset.theme = valeur;
    } else {
      // ⚠️ On RETIRE l'attribut plutôt que d'y écrire « system » : la feuille
      // de style ne connaît que « light » et « dark », et c'est son absence
      // qui laisse `prefers-color-scheme` décider.
      delete racine.dataset.theme;
    }
  }, [theme]);

  return (
    <Contexte.Provider value={{ theme, vientDuCompte, choisir }}>
      {children}
    </Contexte.Provider>
  );
}
