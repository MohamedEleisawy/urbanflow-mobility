"use client";

import { useTraduction } from "@/components/LangueProvider";
import { useTheme, type ChoixTheme } from "@/components/ThemeProvider";

// =============================================================================
// Bascule de thème (sprint soutenance)
// =============================================================================
// ═══ POURQUOI TROIS ÉTATS ET NON UN INTERRUPTEUR ═══
//
// Un interrupteur clair/sombre oblige à choisir, et fait perdre le suivi du
// système. Quelqu'un dont le téléphone bascule en sombre le soir veut que
// l'application suive : c'est ce que « Système » promet, et c'est le défaut.
//
// ═══ POURQUOI UN GROUPE DE BOUTONS ET NON UN `<select>` ═══
//
// Trois options tiennent à l'écran. Un menu déroulant cacherait l'état
// courant derrière un clic, et sur mobile ouvrirait une feuille système pour
// un réglage qui doit se voir et se changer d'un geste.
//
// ⚠️ `radiogroup` ET NON TROIS BOUTONS INDÉPENDANTS. Les trois états sont
// EXCLUSIFS : un lecteur d'écran doit annoncer « 2 sur 3 sélectionné », pas
// trois interrupteurs sans rapport. C'est aussi ce qui donne la navigation aux
// flèches, attendue d'un groupe de boutons radio.
// =============================================================================

/// Pictogramme par état. Décoratif : le libellé est toujours écrit à côté ou
/// porté par `aria-label`.
const PICTOS: Record<ChoixTheme, string> = {
  SYSTEM: "🖥️",
  LIGHT: "☀️",
  DARK: "🌙",
};

const ORDRE: ChoixTheme[] = ["SYSTEM", "LIGHT", "DARK"];

export function SelecteurTheme({ compact = false }: { compact?: boolean }) {
  const { t } = useTraduction();
  const { theme, choisir } = useTheme();

  const libelles: Record<ChoixTheme, string> = {
    SYSTEM: t.themeSystem,
    LIGHT: t.themeLight,
    DARK: t.themeDark,
  };

  return (
    <div
      role="radiogroup"
      aria-label={t.themeLabel}
      className="inline-flex items-center gap-0.5 rounded-full border border-neutral-300 bg-white p-0.5"
    >
      {ORDRE.map((valeur) => {
        const actif = theme === valeur;

        return (
          <button
            key={valeur}
            type="button"
            role="radio"
            aria-checked={actif}
            // ⚠️ `aria-label` PORTE TOUJOURS LE MOT, même en mode compact où
            // seul le pictogramme est visible. Un bouton dont le nom
            // accessible serait « 🌙 » n'est pas annonçable.
            aria-label={libelles[valeur]}
            onClick={() => choisir(valeur)}
            className={`rounded-full px-2 py-1 text-sm transition-colors ${
              actif
                ? "bg-brand text-white"
                : "text-neutral-600 hover:bg-neutral-100"
            }`}
          >
            <span aria-hidden="true">{PICTOS[valeur]}</span>
            {!compact && (
              <span className="ml-1 hidden text-xs font-medium sm:inline">
                {libelles[valeur]}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
