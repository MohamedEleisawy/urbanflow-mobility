import { describe, expect, it } from "vitest";
import { geometrieMarcheEstimee, pointsDuTrajet, tronconDeMarche, tronconsDuTrajet } from "./carte";
import type { ItinerarySegment, ItineraryWalkLeg } from "./types";

// =============================================================================
// Tracé d'un trajet à pied
// =============================================================================
// ═══ CE QUE CE FICHIER VERROUILLE ═══
//
// « 19 rue Finkmatt » → « 6 rue des Cigognes » : le moteur trouvait bien un
// trajet à pied, mais la carte n'affichait AUCUN trait et aucun repère. Le
// trajet existait dans les chiffres et nulle part à l'écran.
//
// Cause : la carte ne dessinait que `itineraire.segments`, vide par définition
// pour un trajet sans véhicule.
// =============================================================================

const MARCHE: ItineraryWalkLeg = {
  fromLat: 48.5902513,
  fromLon: 7.7468657,
  toLat: 48.5886297,
  toLon: 7.7447026,
  stopName: "",
  distanceM: 240,
  durationMin: 4,
  source: "ESTIMATE",
  geometry: null,
};

const SEGMENT: ItinerarySegment = {
  fromStopId: "s1",
  fromStopName: "Gare Centrale",
  fromStopLat: 48.5853,
  fromStopLon: 7.7339,
  toStopId: "s2",
  toStopName: "Homme de Fer",
  toStopLat: 48.5843,
  toStopLon: 7.7449,
  mode: "TRAM",
  lineName: "A",
  operator: "CTS",
  lineId: "ligne-a",
  gtfsLineId: "A",
  distanceM: 800,
  durationMin: 3,
  geometry: null,
  geometrySource: "STRAIGHT",
};

const POINT = (label: string, latitude: number, longitude: number) => ({
  label,
  latitude,
  longitude,
});

describe("geometrieMarcheEstimee", () => {
  it("relie les deux points, dans l'ordre Leaflet [lat, lon]", () => {
    const trace = geometrieMarcheEstimee(
      { latitude: 48.59, longitude: 7.74 },
      { latitude: 48.58, longitude: 7.75 },
    );

    expect(trace).toEqual([
      [48.59, 7.74],
      [48.58, 7.75],
    ]);
  });

  it("rend `null` quand les deux points sont CONFONDUS", () => {
    // ⚠️ Une « ligne » d'un seul point ne se dessine pas, et Leaflet en ferait
    // un cadrage de largeur nulle — donc un zoom maximal sur un point, ce qui
    // déroute plus que ça n'informe.
    expect(
      geometrieMarcheEstimee(
        { latitude: 48.59, longitude: 7.74 },
        { latitude: 48.59, longitude: 7.74 },
      ),
    ).toBeNull();
  });
});

describe("tronconDeMarche", () => {
  it("marque le tracé `WALK_ESTIMATE`, jamais `SHAPE`", () => {
    // ⚠️ C'est ce qui interdit à l'interface de présenter une droite comme le
    // chemin réel des rues.
    const troncon = tronconDeMarche(MARCHE, "acces", "Marche");

    expect(troncon?.source).toBe("WALK_ESTIMATE");
    expect(troncon?.mode).toBe("WALK");
    expect(troncon?.points).toHaveLength(2);
  });

  it("rend `null` pour une marche absente", () => {
    expect(tronconDeMarche(null, "acces", "Marche")).toBeNull();
  });

  it("rend `null` quand la marche ne va nulle part", () => {
    const surPlace: ItineraryWalkLeg = {
      ...MARCHE,
      toLat: MARCHE.fromLat,
      toLon: MARCHE.fromLon,
    };

    expect(tronconDeMarche(surPlace, "acces", "Marche")).toBeNull();
  });
});

describe("tronconsDuTrajet", () => {
  it("dessine un trajet ENTIÈREMENT À PIED, sans aucun tronçon de réseau", () => {
    // ⚠️ LE CŒUR DE LA RÉGRESSION : ce cas rendait un tableau vide, et la
    // carte restait sans le moindre trait.
    const troncons = tronconsDuTrajet({
      segments: [],
      walkAccess: MARCHE,
      walkEgress: null,
    });

    expect(troncons).toHaveLength(1);
    expect(troncons[0].source).toBe("WALK_ESTIMATE");
  });

  it("encadre les tronçons du réseau par les deux marches", () => {
    const troncons = tronconsDuTrajet({
      segments: [SEGMENT],
      walkAccess: MARCHE,
      walkEgress: MARCHE,
    });

    expect(troncons.map((t) => t.source)).toEqual(["WALK_ESTIMATE", "STRAIGHT", "WALK_ESTIMATE"]);
  });

  it("n'invente aucune marche quand il n'y en a pas", () => {
    const troncons = tronconsDuTrajet({
      segments: [SEGMENT],
      walkAccess: null,
      walkEgress: null,
    });

    expect(troncons).toHaveLength(1);
    expect(troncons[0].source).toBe("STRAIGHT");
  });
});

describe("pointsDuTrajet", () => {
  it("montre les DEUX bouts d'un trajet à pied, seuls repères qu'il possède", () => {
    const points = pointsDuTrajet(
      { segments: [], walkAccess: MARCHE, walkEgress: null },
      POINT("19 Rue Finkmatt", 48.5902513, 7.7468657),
      POINT("6 Rue des Cigognes", 48.5886297, 7.7447026),
    );

    expect(points.map((p) => p.nom)).toEqual(["19 Rue Finkmatt", "6 Rue des Cigognes"]);
  });

  it("ajoute les bouts demandés quand une marche les sépare des arrêts", () => {
    const points = pointsDuTrajet(
      { segments: [SEGMENT], walkAccess: MARCHE, walkEgress: MARCHE },
      POINT("19 Rue Finkmatt", 48.59, 7.74),
      POINT("6 Rue des Cigognes", 48.58, 7.75),
    );

    expect(points.map((p) => p.nom)).toEqual([
      "19 Rue Finkmatt",
      "Gare Centrale",
      "Homme de Fer",
      "6 Rue des Cigognes",
    ]);
  });

  it("NE DOUBLE PAS un arrêt choisi comme départ", () => {
    // ⚠️ Sans marche d'approche, le point demandé EST le premier arrêt :
    // ajouter un repère superposerait deux marqueurs du même nom.
    const points = pointsDuTrajet(
      { segments: [SEGMENT], walkAccess: null, walkEgress: null },
      POINT("Gare Centrale", SEGMENT.fromStopLat, SEGMENT.fromStopLon),
      POINT("Homme de Fer", SEGMENT.toStopLat, SEGMENT.toStopLon),
    );

    expect(points.map((p) => p.nom)).toEqual(["Gare Centrale", "Homme de Fer"]);
  });
});
