import type { DecisionRecalcul } from "./recalcul-itineraire";
import type { PositionSuivie } from "./navigation-suivi";

// =============================================================================
// Journal de mise au point de la navigation
// =============================================================================
// ⚠️ DÉVELOPPEMENT UNIQUEMENT. `process.env.NODE_ENV` est remplacé à la
// compilation par sa valeur littérale : en production, la condition devient
// `if (false)` et l'empaqueteur retire le corps de la fonction. Aucune de ces
// lignes n'atteint le navigateur d'un usager, et aucune position n'y est
// journalisée.
//
// ═══ POURQUOI CE FICHIER EXISTE ═══
//
// Mettre au point une navigation, c'est répondre à trois questions : le GPS
// a-t-il parlé ? de combien l'usager a-t-il bougé ? pourquoi l'itinéraire
// n'a-t-il pas été recalculé ? Sans trace, chacune se répond en relisant du
// code et en devinant.
// =============================================================================

const ACTIF = process.env.NODE_ENV === "development";

const PREFIXE = "[UrbanFlow GPS]";

/** Un relevé GPS vient d'arriver. */
export function journaliserPosition(position: PositionSuivie): void {
  if (!ACTIF) return;

  console.info(
    `${PREFIXE} position reçue — lat ${position.latitude.toFixed(6)}, ` +
      `lon ${position.longitude.toFixed(6)}, ` +
      `précision ${
        position.accuracyM === null
          ? "non annoncée"
          : `${Math.round(position.accuracyM)} m`
      }`,
  );
}

/** Ce que la décision de recalcul a conclu, et pourquoi. */
export function journaliserDecision(decision: DecisionRecalcul): void {
  if (!ACTIF) return;

  console.info(
    `${PREFIXE} déplacement depuis le dernier calcul : ` +
      `${Math.round(decision.distanceDepuisDernierCalculM)} m — ` +
      `recalcul ${decision.recalculer ? "DÉCLENCHÉ" : "ignoré"} ` +
      `(${decision.raison})`,
  );
}

/** L'issue d'un recalcul effectivement lancé. */
export function journaliserRecalcul(
  issue: "abouti" | "aucun-itineraire" | "echec",
): void {
  if (!ACTIF) return;

  console.info(`${PREFIXE} recalcul terminé — ${issue}`);
}
