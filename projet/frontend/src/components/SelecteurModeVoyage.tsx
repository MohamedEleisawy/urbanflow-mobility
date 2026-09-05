"use client";

import { useTraduction } from "@/components/LangueProvider";
import type { ModeVoyage } from "@/lib/types";

// =============================================================================
// Sélecteur de mode de déplacement
// =============================================================================
// ═══ CE QUE CE CONTRÔLE FAIT, ET CE QU'IL NE FAIT PAS ═══
//
// Il choisit COMMENT l'usager veut se déplacer :
//
//   🚌 Transports  marche + tram/bus + marche, plusieurs itinéraires comparés ;
//   🚶 À pied      le trajet ENTIER à pied, rue par rue, un seul itinéraire ;
//   🚲 À vélo      le trajet ENTIER à vélo, rue par rue, un seul itinéraire.
//
// ⚠️ CE N'EST PAS LE FILTRE DE MODES (`FiltresModes`). Celui-là MASQUE des
// itinéraires déjà calculés. Celui-ci CHANGE LA REQUÊTE : « à pied » et « à
// vélo » court-circuitent le graphe des transports côté backend. Changer de
// mode demande donc une nouvelle recherche, comme changer d'adresse — c'est
// écrit sous les boutons.
//
// ⚠️ LES TROIS BOUTONS SONT TOUJOURS PROPOSÉS. Le vélo était autrefois masqué
// quand aucun routeur cyclable n'était configuré ; il ne l'est plus, pour la
// même raison que la marche ne l'a jamais été : sans routeur, le backend rend
// une ESTIMATION à vol d'oiseau, honnêtement annoncée (« Itinéraire vélo
// estimé », tracé en pointillés, CO₂ 0). Un repli franc vaut mieux qu'un
// bouton absent — la fonctionnalité existe, elle est simplement dégradée.
// =============================================================================

const PICTOS: Record<ModeVoyage, string> = {
  TRANSIT: "🚌",
  WALK: "🚶",
  BIKE: "🚲",
};

const MODES: ModeVoyage[] = ["TRANSIT", "WALK", "BIKE"];

export interface SelecteurModeVoyageProps {
  valeur: ModeVoyage;
  onChanger: (mode: ModeVoyage) => void;
}

export function SelecteurModeVoyage({
  valeur,
  onChanger,
}: SelecteurModeVoyageProps) {
  const { t } = useTraduction();

  const libelles: Record<ModeVoyage, string> = {
    TRANSIT: t.modeVoyageTransit,
    WALK: t.modeVoyageMarche,
    BIKE: t.modeVoyageVelo,
  };

  const modes = MODES;

  return (
    <fieldset>
      <legend className="text-ink mb-2 text-sm font-medium">
        {t.modeVoyageLabel}
      </legend>

      <div
        role="radiogroup"
        aria-label={t.modeVoyageLabel}
        className="inline-flex flex-wrap gap-1 rounded-lg border border-neutral-300 bg-white p-1"
      >
        {modes.map((mode) => {
          const actif = valeur === mode;

          return (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={actif}
              onClick={() => onChanger(mode)}
              className={`focus-visible:outline-brand rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${
                actif
                  ? "bg-brand text-white"
                  : "text-neutral-700 hover:bg-neutral-100"
              }`}
            >
              <span aria-hidden="true" className="mr-1.5">
                {PICTOS[mode]}
              </span>
              {libelles[mode]}
            </button>
          );
        })}
      </div>

      {/* ⚠️ DIT FRANCHEMENT QUE CHANGER DE MODE RELANCE UNE RECHERCHE. Sans
          cette phrase, l'usager cliquerait « À vélo » et attendrait que la
          liste se mette à jour toute seule. */}
      <p className="mt-1.5 text-xs text-neutral-500">
        {valeur === "TRANSIT"
          ? t.modeVoyageAideTransit
          : t.modeVoyageAideDirect}
      </p>
    </fieldset>
  );
}
