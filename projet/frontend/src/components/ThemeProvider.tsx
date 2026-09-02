"use client";

import { useEffect } from "react";
import { useAuth } from "@/components/AuthProvider";
import type { ThemePreference } from "@/lib/types";

// =============================================================================
// Application du thème (refonte mobilité)
// =============================================================================
// ═══ LE PROBLÈME RÉPARÉ ═══
//
// `UserPreferences.theme` existait depuis le bloc 5E, l'écran de préférences
// l'enregistrait, le backend le persistait — et RIEN ne l'appliquait. Un
// usager choisissait « Sombre » et voyait l'interface rester claire : une
// promesse affichée mais non tenue.
//
// ═══ AUCUN SECOND SYSTÈME DE THÈME ═══
//
// La seule source de vérité reste `utilisateur.preferences.theme`, lu via
// `AuthProvider`. Ce composant ne stocke RIEN : il se contente de traduire
// cette préférence en un attribut `data-theme` sur `<html>`, que la feuille
// de style consomme.
//
// Conséquence voulue : à la déconnexion, `utilisateur` devient `null`, et
// l'interface retombe sur le thème système. Aucune préférence d'un compte ne
// survit à la session d'un autre.
// =============================================================================

/**
 * Traduit la préférence en valeur de `data-theme`.
 *
 * `SYSTEM` rend `null` : on RETIRE alors l'attribut, laissant la feuille de
 * style suivre `prefers-color-scheme`. Écrire « light » en dur ignorerait un
 * système configuré en sombre — ce que « Système » promet précisément de
 * respecter.
 */
export function valeurDataTheme(theme: ThemePreference): "light" | "dark" | null {
  if (theme === "LIGHT") return "light";
  if (theme === "DARK") return "dark";
  return null;
}

export function ThemeProvider() {
  const { utilisateur } = useAuth();

  // `SYSTEM` par défaut : c'est aussi ce que voit un visiteur non connecté.
  const theme: ThemePreference = utilisateur?.preferences?.theme ?? "SYSTEM";

  useEffect(() => {
    const valeur = valeurDataTheme(theme);
    const racine = document.documentElement;

    if (valeur) {
      racine.dataset.theme = valeur;
    } else {
      // ⚠️ On RETIRE l'attribut plutôt que d'y écrire « system » : la feuille
      // de style ne connaît que « light » et « dark », et l'absence
      // d'attribut est précisément ce qui laisse le système décider.
      delete racine.dataset.theme;
    }
  }, [theme]);

  return null;
}
