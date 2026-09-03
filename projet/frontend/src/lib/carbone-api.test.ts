import { describe, expect, it } from "vitest";
import { versSegmentsCarbone } from "./carbone-api";
import type { ItinerarySegment } from "./types";

// La TRANSFORMATION est testée à part de l'appel réseau : c'est une fonction
// pure, et c'est là que se logerait une erreur d'unité — le genre de bug qui
// ne se voit pas à l'écran mais fausse tous les chiffres.

const segment = (
  surcharge: Partial<ItinerarySegment> = {},
): ItinerarySegment => ({
  fromStopId: "a",
  fromStopName: "A",
  fromStopLat: 48.86,
  fromStopLon: 2.34,
  toStopId: "b",
  toStopName: "B",
  toStopLat: 48.87,
  toStopLon: 2.35,
  mode: "BUS",
  lineName: "38",
  operator: "RATP",
  lineId: "ligne-38",
  gtfsLineId: null,
  distanceM: 3900,
  durationMin: 31,
  geometry: null,
  geometrySource: "STRAIGHT",
  ...surcharge,
});

describe("versSegmentsCarbone", () => {
  it("ne retient que le mode et la distance", () => {
    const resultat = versSegmentsCarbone([segment()]);

    // Le contrat carbone ne demande rien d'autre : « les émissions se
    // mesurent au kilomètre, pas à la minute ».
    expect(resultat).toEqual([{ mode: "BUS", distanceM: 3900 }]);
  });

  it("conserve la distance en MÈTRES, sans conversion", () => {
    const resultat = versSegmentsCarbone([segment({ distanceM: 1500 })]);

    // Les deux contrats emploient `distanceM`. Convertir en kilomètres
    // fausserait tout d'un facteur 1000, sans qu'aucun type ne s'en aperçoive.
    expect(resultat[0].distanceM).toBe(1500);
  });

  it("conserve l'ordre et le nombre de segments", () => {
    const resultat = versSegmentsCarbone([
      segment({ mode: "METRO", distanceM: 2800 }),
      segment({ mode: "WALK", distanceM: 1500 }),
    ]);

    expect(resultat).toEqual([
      { mode: "METRO", distanceM: 2800 },
      { mode: "WALK", distanceM: 1500 },
    ]);
  });

  it("INCLUT la marche plutôt que de l'écarter", () => {
    const resultat = versSegmentsCarbone([
      segment({ mode: "WALK", distanceM: 1200 }),
    ]);

    // La marche a un facteur de 0 g/km côté microservice : c'est un mode
    // CALCULABLE. L'omettre réduirait la distance totale, donc l'équivalent
    // voiture, donc les économies affichées.
    expect(resultat).toEqual([{ mode: "WALK", distanceM: 1200 }]);
  });

  it("inclut le vélo, lui aussi à facteur nul", () => {
    const resultat = versSegmentsCarbone([
      segment({ mode: "BIKE", distanceM: 4000 }),
    ]);

    expect(resultat).toEqual([{ mode: "BIKE", distanceM: 4000 }]);
  });

  it("transmet une distance nulle telle quelle", () => {
    const resultat = versSegmentsCarbone([segment({ distanceM: 0 })]);

    // `@Min(0)` côté backend l'accepte. L'écarter serait décider à sa place.
    expect(resultat).toEqual([{ mode: "BUS", distanceM: 0 }]);
  });

  it("transmet un mode sans facteur SANS le filtrer", () => {
    const resultat = versSegmentsCarbone([
      segment({ mode: "ESCOOTER", distanceM: 900 }),
    ]);

    // ESCOOTER n'a pas de facteur d'émission : le microservice REFUSE de le
    // calculer (422). Ce refus lui appartient — dupliquer ici la liste des
    // modes calculables créerait deux vérités à maintenir.
    expect(resultat).toEqual([{ mode: "ESCOOTER", distanceM: 900 }]);
  });

  it("rend un tableau vide pour un itinéraire sans segment", () => {
    // Le backend refusera (400, `@ArrayNotEmpty`) : c'est lui qui tranche,
    // pas cette fonction.
    expect(versSegmentsCarbone([])).toEqual([]);
  });
});
