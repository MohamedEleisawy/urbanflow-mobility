"use client";

import { useTraduction } from "@/components/LangueProvider";
import { formaterDistance, formaterDuree } from "@/lib/format";
import type { ItineraryWalkLeg } from "@/lib/types";

// =============================================================================
// Marche d'approche et de sortie
// =============================================================================
// ═══ CE QU'ELLE RÉPARE ═══
//
// Un itinéraire s'affichait « 15 min, 3 994 m » et commençait à l'arrêt
// Jardiniers — alors que l'usager avait demandé à partir du 15 rue Adler. Les
// cinq cents mètres à pied pour atteindre le tram, et les deux cents de la
// sortie, n'étaient nulle part : ni sur la carte, ni dans la durée, ni dans la
// distance. Le premier arrêt tombait du ciel, et la durée annoncée était
// FAUSSE — pas approximative.
//
// ⚠️ « ESTIMATION » N'EST PAS UNE PRÉCAUTION DE STYLE. Aucun routeur piéton
// n'est configuré : la distance est mesurée à VOL D'OISEAU, donc minorée. Un
// fleuve, une voie ferrée ou une gare à contourner allongent le trajet réel.
// Le dire fait partie de la réponse ; le taire serait une fausse précision.
// =============================================================================

export interface EtapeMarcheProps {
  marche: ItineraryWalkLeg;
  /**
   * `acces`  la marche PART du point demandé et rejoint un arrêt ;
   * `sortie` la marche PART d'un arrêt et rejoint le point demandé.
   *
   * ⚠️ Le sens change la phrase affichée : « Marche jusqu'à Jardiniers » et
   * « Marche depuis Homme de Fer » ne décrivent pas le même déplacement.
   */
  sens: "acces" | "sortie";
}

/**
 * Une étape de marche, avec sa distance, sa durée et sa provenance.
 *
 * Volontairement SANS `<li>` ni `<ol>` : les deux écrans qui l'utilisent
 * l'insèrent dans des structures différentes, et c'est à eux de décider de la
 * sémantique de liste.
 */
export function EtapeMarche({ marche, sens }: EtapeMarcheProps) {
  const { t } = useTraduction();

  // Une marche de bout en bout n'a d'arrêt à aucune extrémité : le libellé ne
  // peut donc nommer que la destination de l'usager.
  const libelle =
    marche.stopName === ""
      ? t.marcheJusquAArrivee
      : sens === "acces"
        ? `${t.marcheVers} ${marche.stopName}`
        : `${t.marcheDepuis} ${marche.stopName}`;

  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
      <span aria-hidden="true">🚶</span>
      <span className="text-ink font-medium">{libelle}</span>
      <span className="text-neutral-600">
        {formaterDistance(marche.distanceM)} ·{" "}
        {formaterDuree(marche.durationMin)}
      </span>

      {/* ⚠️ AFFICHÉ, JAMAIS SOUS-ENTENDU. `title` porte l'explication longue
          pour qui veut la lire, mais la mention elle-même reste visible : une
          info-bulle ne se voit pas au doigt sur un téléphone. */}
      {marche.source === "ESTIMATE" && (
        <span
          className="text-xs text-neutral-500 italic"
          title={t.marcheEstimationDetail}
        >
          ({t.marcheEstimation})
        </span>
      )}
    </div>
  );
}
