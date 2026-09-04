import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import ItinerairePage from "./page";
import { memoriserSelection, type SelectionItineraire } from "@/lib/itineraire-selection";
import type { Itinerary, ItinerarySegment } from "@/lib/types";
import { AuthProvider } from "@/components/AuthProvider";
import { LangueProvider } from "@/components/LangueProvider";

// =============================================================================
// /itineraire — le détail du trajet retenu
// =============================================================================
// ⚠️ CET ÉCRAN NE FAIT AUCUN APPEL RÉSEAU. Aucun module d'API n'est donc
// simulé ici : s'il en appelait un, le test échouerait sur un `fetch` absent
// plutôt que passer inaperçu.
//
// Leaflet, lui, est remplacé : la vraie bibliothèque exige un vrai navigateur.
// Le remplaçant expose ses propriétés dans le DOM, ce qui permet de vérifier
// ce que la page lui transmet réellement.
// =============================================================================

// Les perturbations : cet écran les charge, mais leur échec ne doit jamais
// l'empêcher de s'afficher.
vi.mock("@/lib/alertes-api", () => ({ listerAlertes: vi.fn() }));

vi.mock("@/components/CarteLeaflet", () => ({
  default: ({ arrets, troncons }: { arrets: unknown[]; troncons?: unknown[] | null }) => (
    <div
      data-testid="carte-leaflet"
      data-arrets={arrets.length}
      data-troncons={
        troncons == null
          ? "aucun"
          : troncons
              .map((t) => {
                const troncon = t as { source: string; points: unknown[] };
                return `${troncon.source}:${troncon.points.length}`;
              })
              .join("|")
      }
    />
  ),
}));

const { listerAlertes } = await import("@/lib/alertes-api");

const segment = (surcharge: Partial<ItinerarySegment> = {}): ItinerarySegment => ({
  fromStopId: "a",
  fromStopName: "Gare de Lyon",
  fromStopLat: 48.8443,
  fromStopLon: 2.3743,
  toStopId: "b",
  toStopName: "Châtelet",
  toStopLat: 48.8583,
  toStopLon: 2.347,
  mode: "TRAIN",
  lineName: "A",
  operator: "SNCF",
  lineId: "rer-a",
  gtfsLineId: null,
  distanceM: 2964,
  durationMin: 3,
  geometry: null,
  geometrySource: "STRAIGHT",
  ...surcharge,
});

/// Le trajet réel mesuré en base : RER A puis RER D, avec géométrie.
const ITINERAIRE: Itinerary = {
  criterion: "FASTEST",
  totalDistanceM: 5358,
  totalDurationMin: 6,
  walkAccess: null,
  walkEgress: null,
  numberOfTransfers: 1,
  carbon: {
    status: "CARBON_AVAILABLE",
    co2Grams: 21.43,
    carCo2Grams: 1231.7,
    savedVsCarGrams: 1210.27,
    ecoScore: 98.3,
    reason: null,
  },
  segments: [
    segment({
      geometry: {
        type: "LineString",
        coordinates: [
          [2.3743, 48.8443],
          [2.36, 48.851],
          [2.347, 48.8583],
        ],
      },
      geometrySource: "SHAPE",
    }),
    segment({
      fromStopId: "b",
      fromStopName: "Châtelet",
      fromStopLat: 48.8583,
      fromStopLon: 2.347,
      toStopId: "c",
      toStopName: "Gare du Nord",
      toStopLat: 48.8809,
      toStopLon: 2.3553,
      lineName: "D",
      lineId: "rer-d",
      gtfsLineId: null,
      distanceM: 2394,
      durationMin: 3,
    }),
  ],
};

const SELECTION: SelectionItineraire = {
  itineraire: ITINERAIRE,
  origine: { label: "Gare de Lyon, Paris", latitude: 48.8443, longitude: 2.3743 },
  destination: { label: "Gare du Nord, Paris", latitude: 48.8809, longitude: 2.3553 },
  choisiA: "2026-09-02T10:00:00.000Z",
};

/**
 * ⚠️ `LangueProvider` EXIGE `AuthProvider` : il lit la préférence de langue du
 * compte. La langue par défaut restant le français, tous les tests écrits
 * avant l'internationalisation attendent les mêmes textes.
 */
const rendre = () =>
  render(
    <AuthProvider>
      <LangueProvider>
        <ItinerairePage />
      </LangueProvider>
    </AuthProvider>,
  );

describe("/itineraire", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.mocked(listerAlertes).mockReset();
    // Par défaut : aucune perturbation. Les tests qui n'en parlent pas ne
    // doivent pas en dépendre.
    vi.mocked(listerAlertes).mockResolvedValue({
      items: [],
      limit: 200,
      truncated: false,
    });
  });

  // ---------------------------------------------------------------------------
  // Absence de sélection
  // ---------------------------------------------------------------------------
  describe("sans itinéraire mémorisé", () => {
    it("le dit franchement et propose un retour", () => {
      rendre();

      // §54 du cahier des charges : jamais de page vide cassée.
      expect(screen.getByText(/n'est plus disponible/i)).toBeDefined();
      expect(screen.getByRole("link", { name: /revenir à la recherche/i })).toBeDefined();
    });

    it("ne montre aucune carte ni aucun chiffre inventé", () => {
      rendre();

      expect(screen.queryByTestId("carte-leaflet")).toBeNull();
      expect(screen.queryByText(/durée/i)).toBeNull();
    });

    it("traite une valeur corrompue comme une absence", () => {
      window.sessionStorage.setItem("urbanflow.itineraire", "{ceci n'est pas du JSON");

      rendre();

      // Plutôt qu'un écran blanc et une exception dans la console.
      expect(screen.getByText(/n'est plus disponible/i)).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Trajet affiché
  // ---------------------------------------------------------------------------
  describe("avec un itinéraire mémorisé", () => {
    beforeEach(() => {
      memoriserSelection(SELECTION);
    });

    it("nomme le trajet par les libellés SAISIS PAR L'USAGER", () => {
      rendre();

      // Pas les noms d'arrêts : l'usager a demandé « Gare de Lyon, Paris »,
      // pas « quai du RER A ».
      expect(
        screen.getByRole("heading", {
          name: /Gare de Lyon, Paris → Gare du Nord, Paris/,
          level: 1,
        }),
      ).toBeDefined();
    });

    it("annonce le critère retenu", () => {
      rendre();

      expect(screen.getByText("Le plus rapide")).toBeDefined();
    });

    it("affiche les quatre chiffres du trajet", () => {
      rendre();

      expect(screen.getByText("6 min")).toBeDefined();
      expect(screen.getByText("5,4 km")).toBeDefined();
      // « 1 » changement, pas « Aucun ».
      expect(screen.getByText("1")).toBeDefined();
      expect(screen.getByText("21 g")).toBeDefined();
    });

    it("dit « Aucun » plutôt que « 0 » quand il n'y a pas de changement", () => {
      window.sessionStorage.clear();
      memoriserSelection({
        ...SELECTION,
        itineraire: { ...ITINERAIRE, numberOfTransfers: 0 },
      });

      rendre();

      expect(screen.getByText("Aucun")).toBeDefined();
    });

    it("met en avant l'économie de CO₂ et l'éco-score", () => {
      rendre();

      const eco = screen.getByText(/évités par rapport à la voiture/i);
      expect(eco.textContent).toContain("1,2 kg");
      expect(eco.textContent).toContain("98/100");
    });
  });

  // ---------------------------------------------------------------------------
  // Empreinte indisponible
  // ---------------------------------------------------------------------------
  describe("empreinte carbone indisponible", () => {
    beforeEach(() => {
      memoriserSelection({
        ...SELECTION,
        itineraire: {
          ...ITINERAIRE,
          carbon: {
            status: "CARBON_UNAVAILABLE",
            co2Grams: null,
            carCo2Grams: null,
            savedVsCarGrams: null,
            ecoScore: null,
            reason: "Le calcul des émissions est momentanément indisponible.",
          },
        },
      });
    });

    it("écrit « Indisponible », JAMAIS « 0 g »", () => {
      rendre();

      expect(screen.getByText("Indisponible")).toBeDefined();
      // Zéro est une valeur légitime — un trajet à pied émet réellement zéro.
      // L'employer comme repli rendrait les deux cas indiscernables.
      expect(screen.queryByText("0 g")).toBeNull();
    });

    it("affiche le motif rendu par le backend", () => {
      rendre();

      expect(screen.getByText(/momentanément indisponible/i)).toBeDefined();
    });

    it("affiche quand même le trajet en entier", () => {
      rendre();

      // Une panne du calcul carbone ne fait pas disparaître un itinéraire.
      expect(screen.getByText("6 min")).toBeDefined();
      expect(screen.getByText(/Gare de Lyon → Châtelet/)).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Déroulé
  // ---------------------------------------------------------------------------
  describe("déroulé du trajet", () => {
    beforeEach(() => {
      memoriserSelection(SELECTION);
    });

    it("liste une étape par LIGNE empruntée", () => {
      rendre();

      const deroule = within(screen.getByRole("region", { name: /déroulé du trajet/i }));

      expect(deroule.getByText(/Train A/)).toBeDefined();
      expect(deroule.getByText(/Train D/)).toBeDefined();
    });

    it("nomme le départ et l'arrivée de chaque étape", () => {
      rendre();

      expect(screen.getByText(/Gare de Lyon → Châtelet/)).toBeDefined();
      expect(screen.getByText(/Châtelet → Gare du Nord/)).toBeDefined();
    });

    it("termine par l'arrivée à destination", () => {
      rendre();

      expect(screen.getByText(/Arrivée · Gare du Nord, Paris/)).toBeDefined();
    });

    it("regroupe plusieurs tronçons d'une même ligne en UNE étape", () => {
      window.sessionStorage.clear();
      memoriserSelection({
        ...SELECTION,
        itineraire: {
          ...ITINERAIRE,
          // Trois tronçons consécutifs sur la même ligne.
          segments: [
            segment({ fromStopId: "s0", toStopId: "s1", toStopName: "Arrêt 1" }),
            segment({
              fromStopId: "s1",
              fromStopName: "Arrêt 1",
              toStopId: "s2",
              toStopName: "Arrêt 2",
            }),
            segment({
              fromStopId: "s2",
              fromStopName: "Arrêt 2",
              toStopId: "s3",
              toStopName: "Arrêt 3",
            }),
          ],
        },
      });

      rendre();

      const deroule = within(screen.getByRole("region", { name: /déroulé du trajet/i }));

      // UNE étape « Train A », pas trois — c'est tout l'objet du regroupement.
      expect(deroule.getAllByText(/Train A/)).toHaveLength(1);
      // « 3 arrêts » au sens de « trois arrêts plus loin » — la formulation
      // qu'emploient les réseaux eux-mêmes.
      expect(deroule.getByText(/· 3 arrêts ·/)).toBeDefined();
      // Le détail reste accessible, REPLIÉ.
      expect(deroule.getByText(/voir les 3 arrêts desservis/i)).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Carte
  // ---------------------------------------------------------------------------
  describe("carte", () => {
    beforeEach(() => {
      memoriserSelection(SELECTION);
    });

    it("dessine la voie RÉELLE là où elle existe", () => {
      rendre();

      const carte = screen.getByTestId("carte-leaflet");

      // Le premier tronçon suit les trois points du `LineString` ; le second,
      // dépourvu de géométrie, relie ses deux arrêts en droite.
      expect(carte.getAttribute("data-troncons")).toBe("SHAPE:3|STRAIGHT:2");
    });

    it("ne dessine que les arrêts DU TRAJET quand on part d'un arrêt", () => {
      rendre();

      // Trois arrêts pour deux segments : le `toStop` du premier est le
      // `fromStop` du second, et n'est pas dessiné deux fois.
      //
      // ⚠️ AUCUN REPÈRE DE DÉPART EN PLUS : cet itinéraire n'a pas de marche
      // d'approche, donc le point demandé EST le premier arrêt. En ajouter un
      // superposerait deux marqueurs du même nom.
      expect(screen.getByTestId("carte-leaflet").getAttribute("data-arrets")).toBe("3");
    });

    it("annonce qu'une portion du tracé est approchée", () => {
      rendre();

      const description = screen.getByText(/1 portion dessinée/i);
      expect(description.textContent).toContain("pointillés");
    });

    it("annonce un tracé ENTIÈREMENT réel quand toutes les géométries existent", () => {
      window.sessionStorage.clear();
      memoriserSelection({
        ...SELECTION,
        itineraire: {
          ...ITINERAIRE,
          segments: [ITINERAIRE.segments[0]],
        },
      });

      rendre();

      expect(screen.getByText(/suit la voie réelle publiée par l'opérateur/i)).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Perturbations
  // ---------------------------------------------------------------------------
  describe("perturbations", () => {
    const alerte = (ligneGtfs: string, texte: string) => ({
      id: `alerte-${ligneGtfs}`,
      headerText: texte,
      descriptionText: null,
      stopIds: [],
      lines: [{ id: ligneGtfs, name: "RER A" }],
      mode: "TRAIN" as const,
      severity: "WARNING" as const,
      cause: "MAINTENANCE",
      effect: "REDUCED_SERVICE",
      startTime: "2026-09-03T06:00:00.000Z",
      endTime: null,
    });

    it("affiche une perturbation qui touche une ligne EMPRUNTÉE", async () => {
      window.sessionStorage.clear();
      memoriserSelection({
        ...SELECTION,
        itineraire: {
          ...ITINERAIRE,
          segments: [{ ...ITINERAIRE.segments[0], gtfsLineId: "IDFM:RER-A" }],
        },
      });
      vi.mocked(listerAlertes).mockResolvedValue({
        items: [alerte("IDFM:RER-A", "Trafic interrompu entre Auber et Nation")],
        limit: 200,
        truncated: false,
      });

      rendre();

      expect(await screen.findByText(/trafic interrompu/i)).toBeDefined();
    });

    it("N'AFFICHE PAS une perturbation d'une autre ligne", async () => {
      window.sessionStorage.clear();
      memoriserSelection({
        ...SELECTION,
        itineraire: {
          ...ITINERAIRE,
          segments: [{ ...ITINERAIRE.segments[0], gtfsLineId: "IDFM:RER-A" }],
        },
      });
      vi.mocked(listerAlertes).mockResolvedValue({
        items: [alerte("IDFM:BUS-999", "Déviation du bus 999")],
        limit: 200,
        truncated: false,
      });

      rendre();

      await screen.findByText("6 min");
      // ⚠️ Déverser les 200 alertes d'Île-de-France sur chaque itinéraire
      // noierait celles qui comptent.
      expect(screen.queryByText(/déviation du bus/i)).toBeNull();
      expect(screen.queryByText(/perturbations sur votre trajet/i)).toBeNull();
    });

    it("reste utilisable quand les perturbations sont injoignables", async () => {
      vi.mocked(listerAlertes).mockRejectedValue(new Error("réseau coupé"));
      memoriserSelection(SELECTION);

      rendre();

      // Un itinéraire reste parfaitement utilisable sans la liste des
      // perturbations ; l'inverse serait absurde.
      expect(await screen.findByText("6 min")).toBeDefined();
      expect(screen.queryByText(/perturbations/i)).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Trajet entièrement à pied
  // ---------------------------------------------------------------------------
  // « 19 rue Finkmatt » → « 6 rue des Cigognes », deux cent quarante mètres.
  // Le moteur trouvait bien le trajet, mais cliquer sur le résultat ouvrait une
  // page VIDE : la sélection était refusée à la relecture parce qu'elle
  // n'avait aucun tronçon. Et même acceptée, la carte n'aurait rien dessiné.
  describe("trajet entièrement à pied", () => {
    const A_PIED: SelectionItineraire = {
      ...SELECTION,
      origine: {
        label: "19 Rue Finkmatt, Strasbourg",
        latitude: 48.5902513,
        longitude: 7.7468657,
      },
      destination: {
        label: "6 Rue des Cigognes, Strasbourg",
        latitude: 48.5886297,
        longitude: 7.7447026,
      },
      itineraire: {
        ...SELECTION.itineraire,
        totalDistanceM: 240,
        totalDurationMin: 4,
        numberOfTransfers: 0,
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

    it("N'OUVRE PAS une page vide", () => {
      memoriserSelection(A_PIED);
      rendre();

      expect(screen.queryByText(/n'est plus disponible/i)).toBeNull();
      expect(
        screen.getByRole("heading", {
          name: /19 Rue Finkmatt.*6 Rue des Cigognes/,
        }),
      ).toBeDefined();
    });

    it("DESSINE le trajet : un tracé piéton et les deux bouts", () => {
      memoriserSelection(A_PIED);
      rendre();

      const carte = screen.getByTestId("carte-leaflet");

      // ⚠️ UN tronçon — la marche — et non zéro. La carte restait sans le
      // moindre trait.
      expect(carte.getAttribute("data-troncons")).toBe("WALK_ESTIMATE:2");
      // Les deux bouts demandés : seuls repères d'un trajet sans arrêt.
      expect(carte.getAttribute("data-arrets")).toBe("2");
    });

    it("annonce que le tracé est ESTIMÉ, jamais un itinéraire de rues", () => {
      memoriserSelection(A_PIED);
      rendre();

      expect(screen.getByText(/entièrement à pied/i)).toBeDefined();
      expect(screen.getByText(/ligne droite/i)).toBeDefined();
    });

    it("affiche durée, distance, CO₂ et permet de COMMENCER le trajet", () => {
      memoriserSelection(A_PIED);
      rendre();

      expect(screen.getByText("4 min")).toBeDefined();
      expect(screen.getByText("240 m")).toBeDefined();
      // Le bouton mène bien à la navigation : un trajet à pied se guide aussi.
      expect(screen.getByRole("link", { name: /commencer/i }).getAttribute("href")).toBe(
        "/navigation",
      );
    });
  });
});
