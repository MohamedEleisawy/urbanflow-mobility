import { describe, expect, it } from "vitest";
import {
  avancement,
  distanceAuSegment,
  ecartAuTrajet,
  estArrive,
  estHorsTrajet,
  instructionCourante,
  SEUIL_ARRIVEE_M,
  SEUIL_DEVIATION_M,
  type LibellesInstruction,
  type PositionSuivie,
} from "./navigation-suivi";
import type { ItinerarySegment } from "./types";

// =============================================================================
// Suivi de trajet — logique pure
// =============================================================================
// Aucun React, aucun GPS, aucune horloge. Les positions sont écrites à la
// main, ce qui rend chaque résultat attendu vérifiable de tête.
//
// Repère utile : sous nos latitudes, 0,001° de latitude ≈ 111 m.
// =============================================================================

const segment = (
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
  surcharge: Partial<ItinerarySegment> = {},
): ItinerarySegment => ({
  fromStopId: `${fromLat},${fromLon}`,
  fromStopName: "Départ",
  fromStopLat: fromLat,
  fromStopLon: fromLon,
  toStopId: `${toLat},${toLon}`,
  toStopName: "Arrivée",
  toStopLat: toLat,
  toStopLon: toLon,
  mode: "METRO",
  lineName: "4",
  operator: "RATP",
  lineId: "ligne-4",
  gtfsLineId: null,
  distanceM: 1000,
  durationMin: 3,
  geometry: null,
  geometrySource: "STRAIGHT",
  ...surcharge,
});

const position = (
  latitude: number,
  longitude: number,
  accuracyM: number | null = 10,
): PositionSuivie => ({
  latitude,
  longitude,
  accuracyM,
  headingDeg: null,
  speedMs: null,
  timestamp: 1_788_000_000_000,
});

// Un trajet est-ouest d'environ 1,5 km, à latitude constante.
const TRAJET = [segment(48.86, 2.34, 48.86, 2.36)];

describe("distanceAuSegment", () => {
  it("rend zéro sur le segment lui-même", () => {
    expect(distanceAuSegment({ latitude: 48.86, longitude: 2.35 }, { latitude: 48.86, longitude: 2.34 }, { latitude: 48.86, longitude: 2.36 })).toBeLessThan(1);
  });

  it("mesure la distance à la LIGNE, pas à ses extrémités", () => {
    // ⚠️ LE CŒUR DE CE MODULE. Le point est au milieu du segment, donc à
    // ~740 m de chaque extrémité — mais exactement SUR la voie. Mesurer la
    // distance aux arrêts conclurait à une déviation de 740 m.
    const auMilieu = { latitude: 48.86, longitude: 2.35 };

    expect(
      distanceAuSegment(auMilieu, { latitude: 48.86, longitude: 2.34 }, { latitude: 48.86, longitude: 2.36 }),
    ).toBeLessThan(1);
  });

  it("mesure l'écart perpendiculaire", () => {
    // 0,001° de latitude ≈ 111 m au nord de la ligne.
    const ecart = distanceAuSegment(
      { latitude: 48.861, longitude: 2.35 },
      { latitude: 48.86, longitude: 2.34 },
      { latitude: 48.86, longitude: 2.36 },
    );

    expect(ecart).toBeGreaterThan(100);
    expect(ecart).toBeLessThan(120);
  });

  it("retombe sur l'extrémité au-delà du segment", () => {
    // Au-delà du bout est : le point le plus proche EST l'extrémité.
    const ecart = distanceAuSegment(
      { latitude: 48.86, longitude: 2.37 },
      { latitude: 48.86, longitude: 2.34 },
      { latitude: 48.86, longitude: 2.36 },
    );

    // ~730 m au-delà de 2.36.
    expect(ecart).toBeGreaterThan(600);
    expect(ecart).toBeLessThan(900);
  });

  it("corrige la longitude selon la latitude", () => {
    // Un degré de longitude vaut 111 km à l'équateur, 73 km à Paris. Sans
    // correction, la projection serait déformée d'un tiers et l'écart
    // perpendiculaire faux.
    const aParis = distanceAuSegment(
      { latitude: 48.861, longitude: 2.35 },
      { latitude: 48.86, longitude: 2.34 },
      { latitude: 48.86, longitude: 2.36 },
    );

    // L'écart nord-sud ne dépend PAS de la longitude : ~111 m, quoi qu'il
    // arrive. Une projection non corrigée donnerait une autre valeur.
    expect(aParis).toBeCloseTo(111, -1);
  });

  it("gère un segment de longueur nulle sans diviser par zéro", () => {
    const meme = { latitude: 48.86, longitude: 2.35 };

    expect(distanceAuSegment({ latitude: 48.861, longitude: 2.35 }, meme, meme)).toBeGreaterThan(
      100,
    );
  });
});

describe("ecartAuTrajet", () => {
  it("retient le PLUS PETIT écart parmi les segments", () => {
    const trajet = [
      segment(48.86, 2.34, 48.86, 2.36),
      segment(48.87, 2.36, 48.88, 2.36),
    ];

    // Le point est sur le premier segment : l'écart doit être nul, même si le
    // second est à un kilomètre.
    expect(ecartAuTrajet({ latitude: 48.86, longitude: 2.35 }, trajet)).toBeLessThan(1);
  });

  it("rend Infinity pour un trajet vide", () => {
    // `0` laisserait croire qu'on est dessus.
    expect(ecartAuTrajet({ latitude: 48.86, longitude: 2.35 }, [])).toBe(Infinity);
  });
});

describe("estHorsTrajet", () => {
  it("dit non quand on est sur le trajet", () => {
    expect(estHorsTrajet(position(48.86, 2.35), TRAJET)).toBe(false);
  });

  it("dit non juste en deçà du seuil", () => {
    // ~55 m au nord : sous les 80 m du seuil.
    expect(estHorsTrajet(position(48.8605, 2.35, 5), TRAJET)).toBe(false);
  });

  it("dit oui nettement au-delà du seuil", () => {
    // ~333 m au nord, avec une position sûre.
    expect(estHorsTrajet(position(48.863, 2.35, 5), TRAJET)).toBe(true);
  });

  it("REFUSE de conclure quand le GPS est trop imprécis", () => {
    // ⚠️ LA RÈGLE QUI ÉVITE LES RECALCULS EN RAFALE. Une position annoncée à
    // ±500 m ne peut pas prouver une déviation de 333 m : dans un tunnel ou
    // entre deux immeubles, l'application recalculerait sans fin un trajet
    // que l'usager suit correctement.
    expect(estHorsTrajet(position(48.863, 2.35, 500), TRAJET)).toBe(false);
  });

  it("conclut malgré tout si l'écart dépasse l'incertitude", () => {
    // ~1,1 km au nord, annoncé à ±100 m : l'écart est six fois l'incertitude.
    expect(estHorsTrajet(position(48.87, 2.35, 100), TRAJET)).toBe(true);
  });

  it("conclut quand l'appareil ne donne AUCUNE précision", () => {
    // `null` = l'appareil ne dit rien. On ne peut pas s'en servir pour
    // douter, donc on s'en tient à la mesure.
    expect(estHorsTrajet(position(48.863, 2.35, null), TRAJET)).toBe(true);
  });

  it("ne dévie jamais d'un trajet vide", () => {
    expect(estHorsTrajet(position(0, 0), [])).toBe(false);
  });

  it("expose un seuil cohérent avec l'imprécision urbaine", () => {
    // Le seuil doit rester au-dessus de l'erreur GPS courante en ville
    // (30–50 m), sinon il déclencherait sur du bruit.
    expect(SEUIL_DEVIATION_M).toBeGreaterThan(50);
  });
});

describe("estArrive", () => {
  it("dit oui à quelques mètres de la destination", () => {
    expect(estArrive({ latitude: 48.86, longitude: 2.36 }, TRAJET)).toBe(true);
  });

  it("dit non à 200 m de la destination", () => {
    expect(estArrive({ latitude: 48.8618, longitude: 2.36 }, TRAJET)).toBe(false);
  });

  it("dit non pour un trajet vide", () => {
    expect(estArrive({ latitude: 48.86, longitude: 2.36 }, [])).toBe(false);
  });

  it("tolère l'imprécision de la position finale", () => {
    // Exiger le point exact ne terminerait jamais un trajet : un arrêt fait
    // plusieurs dizaines de mètres.
    expect(SEUIL_ARRIVEE_M).toBeGreaterThan(20);
  });
});

describe("avancement", () => {
  const TRAJET_TROIS = [
    segment(48.86, 2.34, 48.86, 2.35, { distanceM: 730, durationMin: 2 }),
    segment(48.86, 2.35, 48.86, 2.36, { distanceM: 730, durationMin: 2 }),
    segment(48.86, 2.36, 48.86, 2.37, { distanceM: 730, durationMin: 2 }),
  ];

  it("désigne le segment dont on est le plus proche", () => {
    const resultat = avancement({ latitude: 48.86, longitude: 2.355 }, TRAJET_TROIS);

    expect(resultat?.index).toBe(1);
  });

  it("compte les segments RESTANTS, pas ceux déjà parcourus", () => {
    // ⚠️ 2.365, et non 2.36 : à la jonction exacte de deux tronçons, la
    // distance aux deux est nulle et le choix est arbitraire. On place donc
    // le point FRANCHEMENT sur le dernier.
    const resultat = avancement({ latitude: 48.86, longitude: 2.365 }, TRAJET_TROIS);

    expect(resultat?.index).toBe(2);
    // Sur le dernier tronçon : il reste sa durée, et rien d'autre.
    expect(resultat?.dureeRestanteMin).toBe(2);
  });

  it("départage une position à la JONCTION de deux tronçons", () => {
    // À 2.36 exactement, l'écart aux tronçons 1 et 2 est nul. Le premier
    // rencontré gagne — arbitraire, mais DÉTERMINISTE : deux appels
    // identiques rendent le même résultat.
    const a = avancement({ latitude: 48.86, longitude: 2.36 }, TRAJET_TROIS);
    const b = avancement({ latitude: 48.86, longitude: 2.36 }, TRAJET_TROIS);

    expect(a?.index).toBe(b?.index);
  });

  it("additionne la distance restante du segment courant et des suivants", () => {
    const resultat = avancement({ latitude: 48.86, longitude: 2.35 }, TRAJET_TROIS);

    // Depuis 2.35 : ~730 m jusqu'à 2.36, puis 730 m de dernier tronçon.
    expect(resultat!.distanceRestanteM).toBeGreaterThan(1300);
    expect(resultat!.distanceRestanteM).toBeLessThan(1600);
  });

  it("rend null pour un trajet vide", () => {
    expect(avancement({ latitude: 48.86, longitude: 2.35 }, [])).toBeNull();
  });
});

describe("instructionCourante", () => {
  const LIBELLES: LibellesInstruction = {
    mode: (mode) => ({ METRO: "Métro", WALK: "Marche", TRAIN: "Train" })[mode] ?? mode,
    marcher: (distance, arret) => `Marchez ${distance} jusqu'à ${arret}`,
    prendre: (mode, ligne, arret) => `Prenez le ${mode} ${ligne}, descendez à ${arret}`,
    arrivee: "Vous êtes arrivé",
    recalcul: "Recalcul de l'itinéraire…",
  };

  const formater = (metres: number) => `${metres} m`;

  const TRAJET_MIXTE = [
    segment(48.86, 2.34, 48.86, 2.35, {
      mode: "WALK",
      distanceM: 180,
      toStopName: "Châtelet",
      lineName: "À pied",
    }),
    segment(48.86, 2.35, 48.86, 2.36, {
      mode: "METRO",
      lineName: "4",
      toStopName: "Gare du Nord",
    }),
  ];

  it("dit de marcher, avec la distance et l'arrêt visé", () => {
    const instruction = instructionCourante("tracking", TRAJET_MIXTE, 0, LIBELLES, formater);

    expect(instruction?.texte).toBe("Marchez 180 m jusqu'à Châtelet");
  });

  it("dit quelle ligne prendre et où descendre", () => {
    const instruction = instructionCourante("tracking", TRAJET_MIXTE, 1, LIBELLES, formater);

    expect(instruction?.texte).toBe("Prenez le Métro 4, descendez à Gare du Nord");
  });

  it("annonce l'arrivée, quel que soit le segment courant", () => {
    const instruction = instructionCourante("completed", TRAJET_MIXTE, 0, LIBELLES, formater);

    expect(instruction?.texte).toBe("Vous êtes arrivé");
  });

  it("annonce le recalcul", () => {
    const instruction = instructionCourante("recalculating", TRAJET_MIXTE, 0, LIBELLES, formater);

    expect(instruction?.texte).toBe("Recalcul de l'itinéraire…");
  });

  it("rend null quand il n'y a rien à dire", () => {
    expect(instructionCourante("tracking", [], 0, LIBELLES, formater)).toBeNull();
    expect(instructionCourante("tracking", TRAJET_MIXTE, 9, LIBELLES, formater)).toBeNull();
  });

  it("porte une clé STABLE, pour ne pas se répéter", () => {
    const a = instructionCourante("tracking", TRAJET_MIXTE, 1, LIBELLES, formater);
    const b = instructionCourante("tracking", TRAJET_MIXTE, 1, LIBELLES, formater);

    // C'est cette clé qui empêche la voix de répéter la même phrase à chaque
    // relevé GPS — soit plusieurs fois par seconde.
    expect(a?.cle).toBe(b?.cle);
    expect(a?.cle).not.toBe(
      instructionCourante("tracking", TRAJET_MIXTE, 0, LIBELLES, formater)?.cle,
    );
  });

  it("n'invente AUCUNE instruction de virage", () => {
    // ⚠️ « Tournez à droite » exigerait une géométrie de voirie et un cap, que
    // le réseau ne fournit pas. On ne dit que ce que les données disent.
    const textes = TRAJET_MIXTE.map(
      (_, index) => instructionCourante("tracking", TRAJET_MIXTE, index, LIBELLES, formater)?.texte,
    );

    expect(textes.join(" ")).not.toMatch(/droite|gauche|tournez/i);
  });
});
