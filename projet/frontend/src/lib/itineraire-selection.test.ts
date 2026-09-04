import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  analyserSelection,
  instantaneServeur,
  lireBrut,
  lireSelection,
  memoriserSelection,
  oublierSelection,
  souscrireSelection,
  type SelectionItineraire,
} from "./itineraire-selection";
import type { Itinerary } from "./types";

// =============================================================================
// Transmission de l'itinéraire retenu entre /recherche et /itineraire
// =============================================================================
// Le point sensible n'est PAS l'écriture : c'est la RELECTURE. Le contenu de
// `sessionStorage` est modifiable par n'importe quel script de l'origine, et
// survit à un déploiement qui aurait changé la forme des données. Un cast
// naïf ferait planter l'écran sur une valeur d'hier.
// =============================================================================

const ITINERAIRE: Itinerary = {
  criterion: "FASTEST",
  totalDistanceM: 4300,
  totalDurationMin: 24,
  walkAccess: null,
  walkEgress: null,
  numberOfTransfers: 1,
  carbon: {
    status: "CARBON_AVAILABLE",
    co2Grams: 316,
    carCo2Grams: 937,
    savedVsCarGrams: 621,
    ecoScore: 66.3,
    reason: null,
  },
  segments: [
    {
      fromStopId: "a",
      fromStopName: "Gare du Nord",
      fromStopLat: 48.88,
      fromStopLon: 2.355,
      toStopId: "b",
      toStopName: "Châtelet",
      toStopLat: 48.858,
      toStopLon: 2.347,
      mode: "METRO",
      lineName: "4",
      operator: "RATP",
      lineId: "ligne-4",
      gtfsLineId: null,
      distanceM: 2800,
      durationMin: 9,
      geometry: null,
      geometrySource: "STRAIGHT",
    },
  ],
};

const SELECTION: SelectionItineraire = {
  itineraire: ITINERAIRE,
  origine: { label: "Gare du Nord", latitude: 48.88, longitude: 2.355 },
  destination: { label: "Châtelet", latitude: 48.858, longitude: 2.347 },
  choisiA: "2026-09-02T10:00:00.000Z",
};

describe("mémorisation et relecture", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("relit exactement ce qui a été mémorisé", () => {
    expect(memoriserSelection(SELECTION)).toBe(true);

    expect(lireSelection()).toEqual(SELECTION);
  });

  it("rend null quand rien n'a été mémorisé", () => {
    expect(lireSelection()).toBeNull();
  });

  it("oublie la sélection sur demande", () => {
    memoriserSelection(SELECTION);

    oublierSelection();

    expect(lireSelection()).toBeNull();
  });

  it("ne stocke AUCUNE donnée d'authentification", () => {
    memoriserSelection(SELECTION);

    // `sessionStorage` est lisible par tout script de l'origine : rien de ce
    // qui s'y trouve ne doit pouvoir servir à authentifier quelqu'un.
    const brut = lireBrut()!;

    expect(brut).not.toContain("token");
    expect(brut).not.toContain("jeton");
    expect(brut).not.toContain("userId");
  });
});

describe("relecture défensive", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("rejette un JSON tronqué plutôt que de lever", () => {
    window.sessionStorage.setItem("urbanflow.itineraire", '{"itineraire":');

    expect(lireSelection()).toBeNull();
  });

  it("rejette une valeur qui n'est pas un objet", () => {
    expect(analyserSelection('"bonjour"')).toBeNull();
    expect(analyserSelection("42")).toBeNull();
    expect(analyserSelection("null")).toBeNull();
  });

  it("ACCEPTE un trajet entièrement à pied, sans aucun tronçon", () => {
    // ═══ RÉGRESSION VERROUILLÉE ═══
    //
    // Cette vérification exigeait `segments.length > 0`. Conséquence mesurée :
    // « 19 rue Finkmatt » → « 6 rue des Cigognes » se calculait bien, mais
    // cliquer sur le résultat ouvrait une page VIDE — la sélection était
    // écrite, puis REFUSÉE à la relecture.
    const aPied = {
      ...SELECTION,
      itineraire: {
        ...ITINERAIRE,
        segments: [],
        walkAccess: {
          fromLat: 48.5902513,
          fromLon: 7.7468657,
          toLat: 48.5886297,
          toLon: 7.7447026,
          stopName: "",
          distanceM: 240,
          durationMin: 4,
          source: "ESTIMATE",
          geometry: null,
        },
        walkEgress: null,
      },
    };

    const relu = analyserSelection(JSON.stringify(aPied));

    expect(relu).not.toBeNull();
    // ⚠️ AUCUNE PERTE : la marche survit au passage par `sessionStorage`.
    expect(relu?.itineraire.walkAccess?.distanceM).toBe(240);
    expect(relu?.itineraire.walkAccess?.source).toBe("ESTIMATE");
    expect(relu?.origine.label).toBe(SELECTION.origine.label);
    expect(relu?.destination.label).toBe(SELECTION.destination.label);
  });

  it("rejette un itinéraire sans tronçon NI marche — il ne décrit aucun trajet", () => {
    // Un itinéraire doit décrire un DÉPLACEMENT RÉEL. Ni véhicule ni marche :
    // il n'y a rien à montrer, et l'écran ne doit pas prétendre le contraire.
    expect(
      analyserSelection(
        JSON.stringify({
          ...SELECTION,
          itineraire: {
            ...ITINERAIRE,
            segments: [],
            walkAccess: null,
            walkEgress: null,
          },
        }),
      ),
    ).toBeNull();
  });

  it("rejette une sélection dont l'empreinte carbone manque", () => {
    const sansCarbone = { ...ITINERAIRE } as Record<string, unknown>;
    delete sansCarbone.carbon;

    expect(analyserSelection(JSON.stringify({ ...SELECTION, itineraire: sansCarbone }))).toBeNull();
  });

  it("rejette un point sans coordonnées exploitables", () => {
    expect(
      analyserSelection(
        JSON.stringify({ ...SELECTION, origine: { label: "X", latitude: "48.8", longitude: 2.3 } }),
      ),
    ).toBeNull();

    expect(
      analyserSelection(
        JSON.stringify({ ...SELECTION, destination: { label: "X", latitude: 48.8 } }),
      ),
    ).toBeNull();
  });

  it("rejette une sélection dont le nombre de changements manque", () => {
    const ancien = { ...ITINERAIRE } as Record<string, unknown>;
    delete ancien.numberOfTransfers;

    // Le cas RÉEL que cette validation protège : une valeur écrite par une
    // version antérieure de l'application, encore présente dans l'onglet.
    expect(analyserSelection(JSON.stringify({ ...SELECTION, itineraire: ancien }))).toBeNull();
  });
});

describe("stockage indisponible", () => {
  it("ne lève pas quand l'écriture est refusée", () => {
    const echouer = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    // Navigation privée, quota atteint, stockage désactivé par politique :
    // ce n'est pas une raison pour casser un clic.
    expect(() => memoriserSelection(SELECTION)).not.toThrow();
    expect(memoriserSelection(SELECTION)).toBe(false);

    echouer.mockRestore();
  });

  it("ne lève pas quand la lecture est refusée", () => {
    const echouer = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    expect(lireBrut()).toBeNull();
    expect(lireSelection()).toBeNull();

    echouer.mockRestore();
  });

  it("ne lève pas quand la suppression est refusée", () => {
    const echouer = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    expect(() => oublierSelection()).not.toThrow();

    echouer.mockRestore();
  });
});

describe("contrat useSyncExternalStore", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("rend un instantané STABLE entre deux lectures", () => {
    memoriserSelection(SELECTION);

    // ⚠️ LA PROPRIÉTÉ QUE `useSyncExternalStore` EXIGE. Rendre l'objet analysé
    // produirait une nouvelle référence à chaque appel, et React boucherait
    // indéfiniment. Une chaîne se compare par valeur.
    expect(Object.is(lireBrut(), lireBrut())).toBe(true);
  });

  it("distingue « pas encore lu » de « rien de mémorisé »", () => {
    // Côté serveur : `undefined`. Sans cette distinction, l'écran afficherait
    // « cet itinéraire n'est plus disponible » pendant le prérendu, puis le
    // trajet après hydratation — un message d'erreur qui clignote.
    expect(instantaneServeur()).toBeUndefined();
    expect(lireBrut()).toBeNull();
  });

  it("rend un désabonnement appelable", () => {
    const desabonner = souscrireSelection();

    expect(() => desabonner()).not.toThrow();
  });
});
