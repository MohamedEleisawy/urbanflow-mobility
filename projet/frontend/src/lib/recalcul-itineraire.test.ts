import { describe, expect, it } from "vitest";
import {
  decisionRecalcul,
  SEUIL_DEPLACEMENT_M,
  type ContexteRecalcul,
} from "./recalcul-itineraire";
import { COOLDOWN_RECALCUL_MS, type PositionSuivie } from "./navigation-suivi";
import type { ItinerarySegment } from "./types";

// =============================================================================
// Décision de recalcul — les quatre verrous, un par un
// =============================================================================
// Chaque règle évite une panne réelle : une rafale de requêtes, un tunnel pris
// pour une déviation, deux réponses qui se croisent, un trajet figé après le
// premier recalcul. Elles ne se vérifiaient qu'en lisant le composant ; elles
// se vérifient ici sur des nombres.
// =============================================================================

/// Un tronçon rectiligne le long de la rue de Finkmatt, vers le sud-ouest.
const SEGMENT: ItinerarySegment = {
  fromStopId: "a",
  fromStopName: "Départ",
  fromStopLat: 48.5902,
  fromStopLon: 7.7468,
  toStopId: "b",
  toStopName: "Arrivée",
  toStopLat: 48.5886,
  toStopLon: 7.7447,
  mode: "WALK",
  lineName: "",
  operator: "",
  lineId: "marche",
  gtfsLineId: null,
  distanceM: 240,
  durationMin: 4,
  geometry: null,
  geometrySource: "STRAIGHT",
};

const position = (
  latitude: number,
  longitude: number,
  accuracyM: number | null = 8,
  timestamp = 1_000_000,
): PositionSuivie => ({
  latitude,
  longitude,
  accuracyM,
  headingDeg: null,
  speedMs: null,
  timestamp,
});

/// Contexte « tout va bien » : sur le trajet, aucun recalcul récent.
const contexte = (
  partiel: Partial<ContexteRecalcul> = {},
): ContexteRecalcul => ({
  position: position(48.5902, 7.7468),
  segments: [SEGMENT],
  origineDuCalcul: null,
  recalculEnCours: false,
  dernierRecalculMs: 0,
  maintenantMs: 1_000_000,
  ...partiel,
});

describe("decisionRecalcul", () => {
  it("ne recalcule RIEN sans trajet à suivre", () => {
    const decision = decisionRecalcul(contexte({ segments: [] }));

    expect(decision.recalculer).toBe(false);
    expect(decision.raison).toBe("aucun-trajet");
  });

  it("REFUSE quand un recalcul est déjà en cours", () => {
    // ⚠️ Deux recherches lancées en parallèle reviendraient dans un ordre
    // imprévisible : la plus lente écraserait la plus récente, et l'usager
    // serait guidé depuis une position qu'il a quittée.
    const decision = decisionRecalcul(
      contexte({
        recalculEnCours: true,
        // Pourtant très loin : la garde prime.
        position: position(48.62, 7.79),
        origineDuCalcul: { latitude: 48.5902, longitude: 7.7468 },
      }),
    );

    expect(decision.recalculer).toBe(false);
    expect(decision.raison).toBe("deja-en-cours");
  });

  it("REFUSE deux recalculs trop rapprochés", () => {
    const decision = decisionRecalcul(
      contexte({
        dernierRecalculMs: 1_000_000 - (COOLDOWN_RECALCUL_MS - 1),
        position: position(48.62, 7.79),
        origineDuCalcul: { latitude: 48.5902, longitude: 7.7468 },
      }),
    );

    expect(decision.recalculer).toBe(false);
    expect(decision.raison).toBe("delai-de-garde");
  });

  it("ne recalcule pas pour une micro-variation du GPS", () => {
    // ~3 m : le bruit ordinaire d'un GPS urbain.
    const decision = decisionRecalcul(
      contexte({
        position: position(48.59023, 7.74681),
        origineDuCalcul: { latitude: 48.5902, longitude: 7.7468 },
      }),
    );

    expect(decision.recalculer).toBe(false);
    expect(decision.raison).toBe("sur-le-trajet");
    expect(decision.distanceDepuisDernierCalculM).toBeLessThan(10);
  });

  it("RECALCULE après un déplacement franc, MÊME EN RESTANT sur le trajet", () => {
    // ═══ LE CAS QUI REND LA DÉMONSTRATION POSSIBLE ═══
    //
    // Après un recalcul, la route PART de la position courante : l'usager
    // n'est donc plus jamais « hors trajet ». Sans ce second critère, le
    // deuxième déplacement du capteur ne déclencherait plus rien, et
    // l'itinéraire semblerait figé.
    const decision = decisionRecalcul(
      contexte({
        // Le long du trajet, mais à ~180 m du point de calcul.
        position: position(48.5889, 7.7451),
        origineDuCalcul: { latitude: 48.5902, longitude: 7.7468 },
      }),
    );

    expect(decision.recalculer).toBe(true);
    expect(decision.raison).toBe("deplacement-significatif");
    expect(decision.distanceDepuisDernierCalculM).toBeGreaterThan(
      SEUIL_DEPLACEMENT_M,
    );
  });

  it("RECALCULE quand l'usager s'écarte de la route tracée", () => {
    // Aucun point de calcul mémorisé (trajet issu de la recherche initiale) :
    // seul l'écart au trajet peut alors conclure.
    const decision = decisionRecalcul(
      contexte({ position: position(48.5960, 7.7530) }),
    );

    expect(decision.recalculer).toBe(true);
    expect(decision.raison).toBe("hors-trajet");
  });

  it("REFUSE de conclure quand le GPS est trop imprécis pour trancher", () => {
    // ⚠️ Un tunnel ou une rue étroite dégradent la position à ±300 m. Conclure
    // à une déviation de 200 m sur une mesure à ±300 m déclencherait des
    // recalculs en rafale sur un usager parfaitement sur sa route.
    const decision = decisionRecalcul(
      contexte({ position: position(48.5960, 7.7530, 5_000) }),
    );

    expect(decision.recalculer).toBe(false);
    expect(decision.raison).toBe("sur-le-trajet");
  });

  it("rend TOUJOURS la distance parcourue, même en refusant", () => {
    // C'est elle que le journal de développement affiche : « pourquoi n'a-t-il
    // pas recalculé ? » doit se répondre sans relire le code.
    const decision = decisionRecalcul(
      contexte({
        recalculEnCours: true,
        position: position(48.5889, 7.7451),
        origineDuCalcul: { latitude: 48.5902, longitude: 7.7468 },
      }),
    );

    expect(decision.distanceDepuisDernierCalculM).toBeGreaterThan(100);
  });

  it("garde un seuil au-dessus du bruit GPS et sous le pâté de maisons", () => {
    expect(SEUIL_DEPLACEMENT_M).toBeGreaterThanOrEqual(30);
    expect(SEUIL_DEPLACEMENT_M).toBeLessThanOrEqual(60);
  });
});
