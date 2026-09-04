import { haversineDistanceM } from "./geo";
import {
  COOLDOWN_RECALCUL_MS,
  estHorsTrajet,
  type PositionSuivie,
} from "./navigation-suivi";
import type { ItinerarySegment } from "./types";

// =============================================================================
// Faut-il recalculer l'itinéraire ? — décision PURE
// =============================================================================
// ═══ POURQUOI CETTE DÉCISION VIT HORS DE REACT ═══
//
// Elle combinait quatre règles, éparpillées dans le corps d'un composant :
// l'écart au trajet, la précision du GPS, un délai de garde, et l'existence
// d'un recalcul déjà en cours. Chacune évite une panne réelle — une rafale de
// requêtes, un tunnel pris pour une déviation, deux réponses qui se croisent —
// mais aucune n'était vérifiable isolément.
//
// Ici, elles se lisent d'un bloc et se testent sur des nombres, sans GPS, sans
// horloge et sans DOM.
//
// ═══ CE QU'ELLE NE FAIT PAS ═══
//
// Elle ne lance RIEN. Elle rend une décision et LA RAISON de cette décision —
// c'est cette raison qui alimente les journaux de développement, et qui permet
// de répondre à « pourquoi n'a-t-il pas recalculé ? » autrement que par une
// lecture de code.
// =============================================================================

/**
 * Distance minimale entre deux recalculs successifs.
 *
 * ═══ POURQUOI UN SEUIL DE DISTANCE EN PLUS DE L'ÉCART AU TRAJET ═══
 *
 * `estHorsTrajet` répond à « me suis-je écarté de ma route ? ». C'est la bonne
 * question en marche normale, mais elle ne suffit pas : après un recalcul, la
 * nouvelle route PART de la position courante. L'usager est donc parfaitement
 * « sur le trajet » — et le resterait même en sautant de plusieurs centaines
 * de mètres, tant que le saut se fait le long de la route.
 *
 * Ce second seuil garantit qu'un déplacement franc est TOUJOURS pris en
 * compte, quelle que soit sa direction.
 *
 * 50 m : au-dessus du bruit d'un GPS urbain (10 à 30 m), et bien en dessous du
 * premier pâté de maisons. Un piéton les parcourt en quarante secondes.
 */
export const SEUIL_DEPLACEMENT_M = 50;

/**
 * Pourquoi le recalcul a eu lieu — ou n'a pas eu lieu.
 *
 * ⚠️ CHAQUE REFUS PORTE SA CAUSE. « Rien ne s'est passé » est le pire des
 * retours pour qui met au point une navigation : ces libellés sont ce que
 * les journaux de développement affichent.
 */
export type RaisonRecalcul =
  /// Aucun trajet à suivre : il n'y a rien dont s'écarter.
  | "aucun-trajet"
  /// Un recalcul court déjà : en lancer un second les ferait se croiser.
  | "deja-en-cours"
  /// Deux recalculs trop rapprochés dans le temps.
  | "delai-de-garde"
  /// L'usager est sur sa route et n'a pas franchement bougé.
  | "sur-le-trajet"
  /// L'usager s'est écarté de la route tracée.
  | "hors-trajet"
  /// L'usager a franchement bougé depuis le dernier calcul.
  | "deplacement-significatif";

export interface DecisionRecalcul {
  recalculer: boolean;
  raison: RaisonRecalcul;
  /** Distance parcourue depuis le point du dernier calcul, en mètres. */
  distanceDepuisDernierCalculM: number;
}

export interface ContexteRecalcul {
  /** Dernier relevé GPS. */
  position: PositionSuivie;
  /** Les étapes du trajet actuellement suivi. */
  segments: readonly ItinerarySegment[];
  /**
   * Point d'où le trajet courant a été calculé.
   *
   * `null` avant tout recalcul : on se réfère alors au seul écart au trajet.
   */
  origineDuCalcul: { latitude: number; longitude: number } | null;
  /** Un recalcul est-il déjà en cours ? */
  recalculEnCours: boolean;
  /** Horodatage du dernier recalcul lancé, en millisecondes. */
  dernierRecalculMs: number;
  /** Instant du relevé, en millisecondes. */
  maintenantMs: number;
  /** Distance minimale de déplacement. Injectée pour être testable. */
  seuilDeplacementM?: number;
  /** Délai de garde entre deux recalculs. Injecté pour être testable. */
  cooldownMs?: number;
}

/**
 * Décide s'il faut recalculer l'itinéraire depuis la position courante.
 *
 * L'ordre des refus n'est pas indifférent : on écarte d'abord ce qui rendrait
 * un recalcul DANGEREUX (requêtes concurrentes, rafale), puis seulement ce qui
 * le rendrait INUTILE.
 */
export function decisionRecalcul(
  contexte: ContexteRecalcul,
): DecisionRecalcul {
  const {
    position,
    segments,
    origineDuCalcul,
    recalculEnCours,
    dernierRecalculMs,
    maintenantMs,
    seuilDeplacementM = SEUIL_DEPLACEMENT_M,
    cooldownMs = COOLDOWN_RECALCUL_MS,
  } = contexte;

  const distanceDepuisDernierCalculM = origineDuCalcul
    ? haversineDistanceM(
        origineDuCalcul.latitude,
        origineDuCalcul.longitude,
        position.latitude,
        position.longitude,
      )
    : 0;

  const refus = (raison: RaisonRecalcul): DecisionRecalcul => ({
    recalculer: false,
    raison,
    distanceDepuisDernierCalculM,
  });

  if (segments.length === 0) {
    return refus("aucun-trajet");
  }

  // ⚠️ D'ABORD CELUI-CI. Deux recherches lancées en parallèle reviendraient
  // dans un ordre imprévisible, et la plus lente écraserait la plus récente :
  // l'usager se retrouverait guidé depuis une position qu'il a quittée.
  if (recalculEnCours) {
    return refus("deja-en-cours");
  }

  if (maintenantMs - dernierRecalculMs < cooldownMs) {
    return refus("delai-de-garde");
  }

  // ⚠️ LE DÉPLACEMENT FRANC PRIME SUR L'ÉCART AU TRAJET, et c'est ce qui rend
  // la démonstration au capteur possible : après un recalcul, la route part de
  // la position courante, donc l'usager n'est jamais « hors trajet » — même
  // s'il vient de sauter de trois cents mètres.
  if (
    origineDuCalcul !== null &&
    distanceDepuisDernierCalculM >= seuilDeplacementM
  ) {
    return {
      recalculer: true,
      raison: "deplacement-significatif",
      distanceDepuisDernierCalculM,
    };
  }

  // `estHorsTrajet` porte sa propre garde de précision : il refuse de conclure
  // quand l'incertitude du GPS dépasse l'écart mesuré.
  if (estHorsTrajet(position, segments)) {
    return {
      recalculer: true,
      raison: "hors-trajet",
      distanceDepuisDernierCalculM,
    };
  }

  return refus("sur-le-trajet");
}
