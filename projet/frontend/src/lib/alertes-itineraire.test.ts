import { describe, expect, it } from "vitest";
import { alertesDeLItineraire } from "./alertes-itineraire";
import type { Alert, ItinerarySegment } from "./types";

// =============================================================================
// Perturbations d'un itinéraire
// =============================================================================
// Fonction PURE : aucun React, aucun réseau. Ce qu'elle protège tient en une
// phrase — ne pas déverser les perturbations de tout le réseau sur chaque
// itinéraire, et ne pas se tromper de ligne.
// =============================================================================

const segment = (
  gtfsLineId: string | null,
  lineName: string,
  mode: ItinerarySegment["mode"] = "METRO",
): ItinerarySegment => ({
  fromStopId: "a",
  fromStopName: "Départ",
  fromStopLat: 48.86,
  fromStopLon: 2.34,
  toStopId: "b",
  toStopName: "Arrivée",
  toStopLat: 48.87,
  toStopLon: 2.35,
  mode,
  lineName,
  operator: "IDFM",
  lineId: `interne-${lineName}`,
  gtfsLineId,
  distanceM: 1000,
  durationMin: 3,
  geometry: null,
  geometrySource: "STRAIGHT",
});

const alerte = (
  id: string,
  lignes: { id: string; name: string | null }[],
): Alert => ({
  id,
  headerText: `Perturbation ${id}`,
  descriptionText: null,
  stopIds: [],
  lines: lignes,
  mode: "METRO",
  severity: "WARNING",
  cause: "MAINTENANCE",
  effect: "REDUCED_SERVICE",
  startTime: "2026-09-03T06:00:00.000Z",
  endTime: null,
});

describe("alertesDeLItineraire", () => {
  it("retient une alerte qui touche une ligne empruntée", () => {
    const retenues = alertesDeLItineraire(
      [alerte("A1", [{ id: "IDFM:C01371", name: "RER D" }])],
      [segment("IDFM:C01371", "D", "TRAIN")],
    );

    expect(retenues).toHaveLength(1);
    expect(retenues[0].lignes).toEqual(["RER D"]);
  });

  it("ÉCARTE une alerte qui ne concerne aucune ligne empruntée", () => {
    // ⚠️ LA RAISON D'ÊTRE DE CE MODULE. L'endpoint rend jusqu'à 200 alertes
    // pour 2 021 lignes : les déverser toutes noierait celles qui comptent.
    const retenues = alertesDeLItineraire(
      [alerte("A1", [{ id: "IDFM:C99999", name: "Bus 999" }])],
      [segment("IDFM:C01371", "D", "TRAIN")],
    );

    expect(retenues).toEqual([]);
  });

  it("rapproche sur l'IDENTIFIANT DU FLUX, jamais sur le nom", () => {
    // ⚠️ LE PIÈGE QUE CE MODULE ÉVITE. Le réseau contient un « 4 » de métro et
    // un « 4 » de bus. Rapprocher sur le nom afficherait la perturbation du
    // métro à quelqu'un qui prend le bus.
    const retenues = alertesDeLItineraire(
      [alerte("A1", [{ id: "IDFM:METRO-4", name: "Métro 4" }])],
      [segment("IDFM:BUS-4", "4", "BUS")],
    );

    expect(retenues).toEqual([]);
  });

  it("ne rapproche JAMAIS un segment sans identifiant de flux", () => {
    // La marche et les lignes saisies à la main n'existent dans aucun flux :
    // aucune alerte ne peut les désigner.
    const retenues = alertesDeLItineraire(
      [alerte("A1", [{ id: "IDFM:C01371", name: "RER D" }])],
      [segment(null, "À pied", "WALK")],
    );

    expect(retenues).toEqual([]);
  });

  it("retient une alerte dès qu'UNE de ses lignes est empruntée", () => {
    const retenues = alertesDeLItineraire(
      [
        alerte("A1", [
          { id: "IDFM:AUTRE", name: "Bus 12" },
          { id: "IDFM:C01371", name: "RER D" },
        ]),
      ],
      [segment("IDFM:C01371", "D", "TRAIN")],
    );

    expect(retenues).toHaveLength(1);
    // Seule la ligne CONCERNÉE est nommée, pas toute la liste de l'alerte.
    expect(retenues[0].lignes).toEqual(["RER D"]);
  });

  it("se replie sur NOTRE nom quand l'alerte n'en porte pas", () => {
    const retenues = alertesDeLItineraire(
      [alerte("A1", [{ id: "IDFM:C01371", name: null }])],
      [segment("IDFM:C01371", "D", "TRAIN")],
    );

    // « D » vaut mieux que l'identifiant brut du flux.
    expect(retenues[0].lignes).toEqual(["D"]);
  });

  it("conserve l'ordre du serveur, qui classe par gravité", () => {
    const retenues = alertesDeLItineraire(
      [
        alerte("SEVERE", [{ id: "L1", name: "1" }]),
        alerte("INFO", [{ id: "L1", name: "1" }]),
      ],
      [segment("L1", "1")],
    );

    // Retrier ici produirait un ordre différent de celui que le backend
    // documente et teste.
    expect(retenues.map((r) => r.alerte.id)).toEqual(["SEVERE", "INFO"]);
  });

  it("rend une liste vide quand il n'y a aucune alerte", () => {
    expect(alertesDeLItineraire([], [segment("L1", "1")])).toEqual([]);
  });

  it("rend une liste vide pour un itinéraire entièrement à pied", () => {
    expect(
      alertesDeLItineraire(
        [alerte("A1", [{ id: "L1", name: "1" }])],
        [segment(null, "À pied", "WALK"), segment(null, "À pied", "WALK")],
      ),
    ).toEqual([]);
  });
});
