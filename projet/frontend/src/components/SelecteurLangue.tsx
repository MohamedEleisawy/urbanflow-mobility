"use client";

import { useTraduction } from "@/components/LangueProvider";
import { LANGUES, type Langue } from "@/lib/i18n/dictionnaire";

// =============================================================================
// Bascule de langue (sprint soutenance)
// =============================================================================
// ⚠️ ACCESSIBLE AVANT TOUTE CONNEXION. C'est le point du sujet : un visiteur
// hispanophone doit pouvoir lire l'application AVANT de décider s'il s'y
// inscrit. La réserver à l'espace personnel en faisait une récompense.
//
// ⚠️ LES NOMS DE LANGUE SONT DANS LEUR PROPRE LANGUE — « Español », jamais
// « Espagnol ». Quelqu'un qui ne lit pas le français doit reconnaître la
// sienne : c'est la seule chaîne de l'interface qui ne doit PAS être traduite.
// =============================================================================

/// Nom de chaque langue, écrit dans cette langue.
const NOMS: Record<Langue, string> = {
  FR: "Français",
  EN: "English",
  ES: "Español",
};

export function SelecteurLangue() {
  const { langue, changerLangue, t } = useTraduction();

  return (
    <div
      role="radiogroup"
      aria-label={t.langueLabel}
      className="inline-flex items-center gap-0.5 rounded-full border border-neutral-300 bg-white p-0.5"
    >
      {LANGUES.map((valeur) => {
        const actif = langue === valeur;

        return (
          <button
            key={valeur}
            type="button"
            role="radio"
            aria-checked={actif}
            // Le code à l'écran — « FR » tient là où « Français » déborde —
            // mais le nom COMPLET dans le nom accessible.
            aria-label={NOMS[valeur]}
            // `lang` fait prononcer « English » à l'anglaise par un lecteur
            // d'écran réglé en français. Sans lui, la liste est inaudible.
            lang={valeur.toLowerCase()}
            onClick={() => changerLangue(valeur)}
            className={`rounded-full px-2 py-1 text-xs font-semibold transition-colors ${
              actif
                ? "bg-brand text-white"
                : "text-neutral-600 hover:bg-neutral-100"
            }`}
          >
            {valeur}
          </button>
        );
      })}
    </div>
  );
}
