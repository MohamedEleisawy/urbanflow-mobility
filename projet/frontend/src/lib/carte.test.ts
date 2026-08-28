import { describe, expect, it } from "vitest";
import {
  CENTRE_DEFAUT,
  indexerArrets,
  pointDepuisArret,
  traceDepuisSegments,
  type PointCarte,
} from "./carte";
import type { Stop } from "./types";

// =============================================================================
// Géométrie de la carte (bloc 5B)
// =============================================================================
// Aucun DOM, aucun Leaflet : ce module ne manipule que des nombres. C'est
// précisément pour cela qu'il existe séparément — la règle « ne jamais tracer
// une ligne fausse » se vérifie ici, sans navigateur.
// =============================================================================

const GARE = "stop-gare-du-nord";
const CHATELET = "stop-chatelet";
const BASTILLE = "stop-bastille";

const arret = (id: string, name: string, latitude: number, longitude: number): Stop => ({
  id,
  name,
  latitude,
  longitude,
  pmrAccessible: true,
  operatorCode: "RATP",
  // NUL : un arrêt saisi à la main doit rester localisable.
  gtfsStopId: null,
});

const ARRETS: Stop[] = [
  arret(GARE, "Gare du Nord", 48.8809, 2.3553),
  arret(CHATELET, "Châtelet", 48.8583, 2.3477),
  arret(BASTILLE, "Bastille", 48.8532, 2.369),
];

const INDEX = indexerArrets(ARRETS);

const noms = (points: PointCarte[] | null) => points?.map((point) => point.nom) ?? null;

describe("pointDepuisArret", () => {
  it("conserve l'identifiant, le nom et la position RÉELS", () => {
    expect(pointDepuisArret(ARRETS[0])).toEqual({
      id: GARE,
      nom: "Gare du Nord",
      latitude: 48.8809,
      longitude: 2.3553,
    });
  });
});

describe("indexerArrets", () => {
  it("indexe par identifiant INTERNE, pas par gtfsStopId", () => {
    // Les segments désignent `fromStopId`/`toStopId`, c'est-à-dire l'`id`
    // interne. Indexer sur `gtfsStopId` — nul ici — perdrait les trois arrêts.
    expect(INDEX.size).toBe(3);
    expect(INDEX.get(CHATELET)?.nom).toBe("Châtelet");
  });

  it("rend un index vide pour un réseau vide", () => {
    expect(indexerArrets([]).size).toBe(0);
  });
});

describe("traceDepuisSegments", () => {
  it("suit les arrêts dans l'ordre du trajet", () => {
    const trace = traceDepuisSegments(
      [
        { fromStopId: GARE, toStopId: CHATELET },
        { fromStopId: CHATELET, toStopId: BASTILLE },
      ],
      INDEX,
    );

    // Trois points pour deux étapes : le départ n'est compté qu'une fois.
    expect(noms(trace)).toEqual(["Gare du Nord", "Châtelet", "Bastille"]);
  });

  it("gère un trajet d'une seule étape", () => {
    const trace = traceDepuisSegments([{ fromStopId: GARE, toStopId: BASTILLE }], INDEX);

    expect(noms(trace)).toEqual(["Gare du Nord", "Bastille"]);
  });

  it("ne trace RIEN sans segment", () => {
    expect(traceDepuisSegments([], INDEX)).toBeNull();
  });

  it("ne trace RIEN si un arrêt est inconnu", () => {
    // Relier Gare du Nord à Bastille directement sauterait Châtelet : la
    // ligne dessinée ne correspondrait à aucun trajet réel.
    const trace = traceDepuisSegments(
      [
        { fromStopId: GARE, toStopId: "stop-inconnu" },
        { fromStopId: "stop-inconnu", toStopId: BASTILLE },
      ],
      INDEX,
    );

    expect(trace).toBeNull();
  });

  it("ne trace RIEN si les segments ne s'enchaînent pas", () => {
    // Gare → Châtelet puis Bastille → … : il manque le lien entre Châtelet et
    // Bastille. Tracer quand même inventerait un déplacement.
    const trace = traceDepuisSegments(
      [
        { fromStopId: GARE, toStopId: CHATELET },
        { fromStopId: BASTILLE, toStopId: GARE },
      ],
      INDEX,
    );

    expect(trace).toBeNull();
  });

  it("ne trace RIEN avec un index vide", () => {
    const trace = traceDepuisSegments([{ fromStopId: GARE, toStopId: CHATELET }], new Map());

    expect(trace).toBeNull();
  });
});

describe("CENTRE_DEFAUT", () => {
  it("est une position valide", () => {
    const [latitude, longitude] = CENTRE_DEFAUT;

    expect(latitude).toBeGreaterThanOrEqual(-90);
    expect(latitude).toBeLessThanOrEqual(90);
    expect(longitude).toBeGreaterThanOrEqual(-180);
    expect(longitude).toBeLessThanOrEqual(180);
  });
});
