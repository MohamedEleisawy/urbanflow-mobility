import { describe, expect, it } from "vitest";
import { modesEmpruntes, nombreDeChangements, regrouperSegments, resumerModes } from "./itineraire";
import { LIBELLES_MODES } from "./format";
import type { Itinerary, ItinerarySegment, TransportMode } from "./types";

// Regroupement des étapes d'un itinéraire (refonte UX).
//
// Fonctions PURES : aucun React, aucun réseau. Les jeux d'essai reprennent la
// forme exacte que rend le backend — un segment par tronçon entre deux arrêts
// consécutifs.

const segment = (
  mode: TransportMode,
  lineId: string,
  lineName: string,
  de: string,
  vers: string,
  distanceM = 800,
  durationMin = 2,
): ItinerarySegment => ({
  fromStopId: `${de}-id`,
  fromStopName: de,
  toStopId: `${vers}-id`,
  toStopName: vers,
  mode,
  lineName,
  operator: "IDFM",
  lineId,
  distanceM,
  durationMin,
});

/// Le cas réel qui a motivé ce module : cinq tronçons sur la ligne 8,
/// encadrés par deux correspondances à pied.
const TRAJET_LIGNE_8: ItinerarySegment[] = [
  segment("WALK", "corr", "Correspondance", "Créteil quai A", "Créteil quai B", 60, 4),
  segment("METRO", "l8", "8", "Créteil-Préfecture", "Créteil-Université"),
  segment("METRO", "l8", "8", "Créteil-Université", "Créteil-l'Échat"),
  segment("METRO", "l8", "8", "Créteil-l'Échat", "Maisons-Alfort"),
  segment("METRO", "l8", "8", "Maisons-Alfort", "École Vétérinaire"),
  segment("METRO", "l8", "8", "École Vétérinaire", "République"),
  segment("WALK", "corr", "Correspondance", "République quai A", "République quai B", 80, 3),
];

describe("regrouperSegments", () => {
  it("FUSIONNE les tronçons consécutifs d'une même ligne", () => {
    const groupes = regrouperSegments(TRAJET_LIGNE_8);

    // Sept segments deviennent trois groupes lisibles.
    expect(groupes).toHaveLength(3);
    expect(groupes.map((g) => g.mode)).toEqual(["WALK", "METRO", "WALK"]);
  });

  it("compte les arrêts parcourus", () => {
    const [, metro] = regrouperSegments(TRAJET_LIGNE_8);

    // Cinq tronçons = cinq arrêts plus loin, la formulation des réseaux.
    expect(metro.nombreArrets).toBe(5);
  });

  it("retient le PREMIER départ et la DERNIÈRE arrivée", () => {
    const [, metro] = regrouperSegments(TRAJET_LIGNE_8);

    expect(metro.depart).toBe("Créteil-Préfecture");
    expect(metro.arrivee).toBe("République");
  });

  it("SOMME durée et distance, sans rien estimer", () => {
    const [, metro] = regrouperSegments(TRAJET_LIGNE_8);

    expect(metro.durationMin).toBe(10); // 5 × 2
    expect(metro.distanceM).toBe(4000); // 5 × 800
  });

  it("CONSERVE toutes les étapes d'origine", () => {
    const [, metro] = regrouperSegments(TRAJET_LIGNE_8);

    // ⚠️ Le regroupement est un affichage, pas une perte d'information :
    // l'interface doit pouvoir déplier le détail.
    expect(metro.segments).toHaveLength(5);
    expect(metro.segments.map((s) => s.toStopName)).toEqual([
      "Créteil-Université",
      "Créteil-l'Échat",
      "Maisons-Alfort",
      "École Vétérinaire",
      "République",
    ]);
  });

  it("préserve l'ORDRE des groupes", () => {
    const groupes = regrouperSegments([
      segment("WALK", "corr", "Correspondance", "A", "B"),
      segment("METRO", "l1", "1", "B", "C"),
      segment("TRAM", "t3", "T3a", "C", "D"),
    ]);

    expect(groupes.map((g) => g.lineName)).toEqual(["Correspondance", "1", "T3a"]);
  });

  it("SÉPARE deux lignes différentes", () => {
    const groupes = regrouperSegments([
      segment("METRO", "l1", "1", "A", "B"),
      segment("METRO", "l4", "4", "B", "C"),
    ]);

    expect(groupes).toHaveLength(2);
  });

  it("⚠️ SÉPARE deux lignes de MÊME NOM mais d'identifiants différents", () => {
    const groupes = regrouperSegments([
      segment("METRO", "ligne-a", "8", "A", "B"),
      segment("METRO", "ligne-b", "8", "B", "C"),
    ]);

    // LA VÉRIFICATION LA PLUS IMPORTANTE. Le réseau réel contient des lignes
    // homonymes — un test du backend le vérifie déjà. Fusionner sur le NOM
    // annoncerait « restez dans la ligne 8 » alors qu'il faut changer de quai.
    expect(groupes).toHaveLength(2);
  });

  it("SÉPARE deux modes, même identifiant de ligne", () => {
    const groupes = regrouperSegments([
      segment("METRO", "x", "X", "A", "B"),
      segment("TRAM", "x", "X", "B", "C"),
    ]);

    expect(groupes).toHaveLength(2);
  });

  it("NE FUSIONNE PAS deux passages NON consécutifs sur la même ligne", () => {
    const groupes = regrouperSegments([
      segment("METRO", "l8", "8", "A", "B"),
      segment("METRO", "l1", "1", "B", "C"),
      segment("METRO", "l8", "8", "C", "D"),
    ]);

    // On y monte bien DEUX fois : les confondre effacerait un changement.
    expect(groupes).toHaveLength(3);
    expect(groupes.map((g) => g.lineName)).toEqual(["8", "1", "8"]);
  });

  it("fusionne des correspondances à pied consécutives", () => {
    const groupes = regrouperSegments([
      segment("WALK", "corr", "Correspondance", "A", "B", 50, 2),
      segment("WALK", "corr", "Correspondance", "B", "C", 70, 3),
    ]);

    expect(groupes).toHaveLength(1);
    expect(groupes[0].durationMin).toBe(5);
  });

  it("rend un tableau vide pour un itinéraire sans segment", () => {
    expect(regrouperSegments([])).toEqual([]);
  });

  it("gère un segment unique", () => {
    const groupes = regrouperSegments([segment("METRO", "l1", "1", "A", "B")]);

    expect(groupes).toHaveLength(1);
    expect(groupes[0].nombreArrets).toBe(1);
  });
});

describe("resumerModes", () => {
  it("résume le trajet en une ligne", () => {
    const resume = resumerModes(regrouperSegments(TRAJET_LIGNE_8), LIBELLES_MODES);

    // « Marche » n'apparaît qu'une fois bien qu'il y ait deux correspondances.
    expect(resume).toBe("Marche + Métro 8");
  });

  it("nomme chaque ligne empruntée", () => {
    const resume = resumerModes(
      regrouperSegments([
        segment("METRO", "l1", "1", "A", "B"),
        segment("METRO", "l4", "4", "B", "C"),
      ]),
      LIBELLES_MODES,
    );

    expect(resume).toBe("Métro 1 + Métro 4");
  });

  it("n'attache PAS de numéro à la marche", () => {
    const resume = resumerModes(
      regrouperSegments([segment("WALK", "corr", "Correspondance", "A", "B")]),
      LIBELLES_MODES,
    );

    // « Marche Correspondance » n'aurait aucun sens pour un usager.
    expect(resume).toBe("Marche");
  });

  it("rend une chaîne vide sans groupe", () => {
    expect(resumerModes([], LIBELLES_MODES)).toBe("");
  });
});

describe("nombreDeChangements", () => {
  it("ne compte PAS la marche comme un changement", () => {
    const groupes = regrouperSegments(TRAJET_LIGNE_8);

    // Marche → Métro 8 → Marche : on ne monte que dans UN véhicule.
    expect(nombreDeChangements(groupes)).toBe(0);
  });

  it("compte un changement entre deux lignes", () => {
    const groupes = regrouperSegments([
      segment("METRO", "l1", "1", "A", "B"),
      segment("WALK", "corr", "Correspondance", "B", "B2"),
      segment("METRO", "l4", "4", "B2", "C"),
    ]);

    expect(nombreDeChangements(groupes)).toBe(1);
  });

  it("rend zéro pour un trajet entièrement à pied", () => {
    const groupes = regrouperSegments([segment("WALK", "corr", "Correspondance", "A", "B")]);

    expect(nombreDeChangements(groupes)).toBe(0);
  });

  it("rend zéro sans aucun groupe", () => {
    expect(nombreDeChangements([])).toBe(0);
  });
});

describe("modesEmpruntes", () => {
  it("liste les modes SANS doublon", () => {
    const itineraire = {
      criterion: "FASTEST",
      totalDistanceM: 4140,
      totalDurationMin: 17,
      segments: TRAJET_LIGNE_8,
    } as Itinerary;

    expect(modesEmpruntes(itineraire)).toEqual(["WALK", "METRO"]);
  });
});
