import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NavigationPage from "./page";
import { memoriserSelection, type SelectionItineraire } from "@/lib/itineraire-selection";
import type { Itinerary, ItinerarySegment } from "@/lib/types";
import { AuthProvider } from "@/components/AuthProvider";
import { LangueProvider } from "@/components/LangueProvider";

// =============================================================================
// /navigation — suivi guidé
// =============================================================================
// Trois choses sont simulées, et rien d'autre : Leaflet (jsdom ne le dessine
// pas), le GPS (un vrai rendrait le test dépendant du lieu) et la recherche
// d'itinéraires (pour éprouver le recalcul sans backend).
//
// La synthèse vocale l'est aussi, sans quoi la machine parlerait pendant les
// tests.
// =============================================================================

vi.mock("@/components/CarteLeaflet", () => ({
  default: ({
    position,
    suivrePosition,
  }: {
    position?: { latitude: number; longitude: number; accuracyM: number | null } | null;
    suivrePosition?: boolean;
  }) => (
    <div
      data-testid="carte-leaflet"
      data-position={position ? `${position.latitude},${position.longitude}` : "aucune"}
      data-precision={position?.accuracyM ?? "aucune"}
      data-suivi={suivrePosition ? "oui" : "non"}
    />
  ),
}));

vi.mock("@/lib/itineraires-api", async (original) => ({
  ...(await original<typeof import("@/lib/itineraires-api")>()),
  rechercherItineraires: vi.fn(),
}));

const { rechercherItineraires } = await import("@/lib/itineraires-api");

const segment = (
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
  surcharge: Partial<ItinerarySegment> = {},
): ItinerarySegment => ({
  fromStopId: `${fromLat},${fromLon}`,
  fromStopName: "Gare de Lyon",
  fromStopLat: fromLat,
  fromStopLon: fromLon,
  toStopId: `${toLat},${toLon}`,
  toStopName: "Gare du Nord",
  toStopLat: toLat,
  toStopLon: toLon,
  mode: "METRO",
  lineName: "4",
  operator: "RATP",
  lineId: "ligne-4",
  gtfsLineId: null,
  distanceM: 1500,
  durationMin: 5,
  geometry: null,
  geometrySource: "STRAIGHT",
  ...surcharge,
});

const ITINERAIRE: Itinerary = {
  criterion: "FASTEST",
  totalDistanceM: 1500,
  totalDurationMin: 5,
  walkAccess: null,
  walkEgress: null,
  numberOfTransfers: 0,
  carbon: {
    status: "CARBON_AVAILABLE",
    co2Grams: 6,
    carCo2Grams: 327,
    savedVsCarGrams: 321,
    ecoScore: 98.2,
    reason: null,
  },
  // Trajet est-ouest à latitude constante : les écarts se raisonnent de tête.
  segments: [segment(48.86, 2.34, 48.86, 2.36)],
};

const SELECTION: SelectionItineraire = {
  itineraire: ITINERAIRE,
  origine: { label: "Gare de Lyon", latitude: 48.86, longitude: 2.34 },
  destination: { label: "Gare du Nord", latitude: 48.86, longitude: 2.36 },
  choisiA: "2026-09-03T08:00:00.000Z",
};

type Succes = (position: GeolocationPosition) => void;

describe("/navigation", () => {
  let watchPosition: ReturnType<typeof vi.fn>;
  let clearWatch: ReturnType<typeof vi.fn>;
  let succes: Succes | null;
  let speak: ReturnType<typeof vi.fn>;

  /** Une mesure GPS, avec son horodatage — l'horloge du délai de garde. */
  const mesure = (
    latitude: number,
    longitude: number,
    accuracy = 10,
    timestamp = 1_788_000_000_000,
  ) =>
    ({
      coords: {
        latitude,
        longitude,
        accuracy,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
      timestamp,
    }) as GeolocationPosition;

  beforeEach(() => {
    window.sessionStorage.clear();
    memoriserSelection(SELECTION);

    succes = null;
    watchPosition = vi.fn((ok: Succes) => {
      succes = ok;
      return 7;
    });
    clearWatch = vi.fn();

    Object.defineProperty(navigator, "geolocation", {
      value: { watchPosition, clearWatch, getCurrentPosition: vi.fn() },
      configurable: true,
    });

    speak = vi.fn();
    Object.defineProperty(window, "speechSynthesis", {
      value: { speak, cancel: vi.fn(), speaking: false },
      configurable: true,
    });
    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      value: class {
        lang = "";
        constructor(public text: string) {}
      },
      configurable: true,
    });

    vi.mocked(rechercherItineraires).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const rendre = () =>
    render(
      <AuthProvider>
        <LangueProvider>
          <NavigationPage />
        </LangueProvider>
      </AuthProvider>,
    );

  const demarrer = async () => {
    const utilisateur = userEvent.setup();
    await utilisateur.click(await screen.findByRole("button", { name: /commencer le trajet/i }));
    return utilisateur;
  };

  // ---------------------------------------------------------------------------
  // Sans trajet mémorisé
  // ---------------------------------------------------------------------------

  it("dit franchement qu'il n'y a rien à suivre", () => {
    window.sessionStorage.clear();

    rendre();

    expect(screen.getByText(/aucun trajet à suivre/i)).toBeDefined();
    expect(screen.getByRole("link", { name: /revenir à la recherche/i })).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Consentement
  // ---------------------------------------------------------------------------

  it("ne sollicite AUCUNE position avant le clic", () => {
    rendre();

    // ⚠️ L'ASSERTION LA PLUS IMPORTANTE. Une invite de permission qui surgit
    // au chargement est une invite qu'on refuse par réflexe.
    expect(watchPosition).not.toHaveBeenCalled();
  });

  it("démarre le suivi au clic", async () => {
    rendre();

    await demarrer();

    expect(watchPosition).toHaveBeenCalledTimes(1);
  });

  it("éteint la puce quand on arrête le suivi", async () => {
    rendre();
    const utilisateur = await demarrer();

    await utilisateur.click(screen.getByRole("button", { name: /arrêter le suivi/i }));

    expect(clearWatch).toHaveBeenCalledWith(7);
  });

  // ---------------------------------------------------------------------------
  // Instruction
  // ---------------------------------------------------------------------------

  it("affiche l'instruction courante, issue des DONNÉES du trajet", async () => {
    rendre();
    await demarrer();

    act(() => succes!(mesure(48.86, 2.345)));

    // Ni « tournez à droite » ni rien d'inventé : le mode, la ligne, l'arrêt.
    expect(await screen.findByText(/Prenez le Métro 4, descendez à Gare du Nord/)).toBeDefined();
  });

  it("place l'instruction dans une zone aria-live", async () => {
    rendre();
    await demarrer();

    act(() => succes!(mesure(48.86, 2.345)));

    const vivante = document.querySelector('[aria-live="polite"]');

    // Sans cette zone, un lecteur d'écran n'annoncerait jamais un changement
    // d'instruction — qui survient sans aucun geste de l'usager.
    expect(vivante?.textContent).toMatch(/Prenez le Métro 4/);
  });

  it("annonce la distance et la durée restantes", async () => {
    rendre();
    await demarrer();

    act(() => succes!(mesure(48.86, 2.35)));

    expect(await screen.findByText(/restants/i)).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Position sur la carte
  // ---------------------------------------------------------------------------

  it("transmet la position ET sa précision à la carte", async () => {
    rendre();
    await demarrer();

    act(() => succes!(mesure(48.86, 2.345, 25)));

    await waitFor(() => {
      const carte = screen.getByTestId("carte-leaflet");
      expect(carte.getAttribute("data-position")).toBe("48.86,2.345");
      expect(carte.getAttribute("data-precision")).toBe("25");
    });
  });

  it("suit la position par défaut, et laisse la relâcher", async () => {
    rendre();
    const utilisateur = await demarrer();
    act(() => succes!(mesure(48.86, 2.345)));

    await waitFor(() =>
      expect(screen.getByTestId("carte-leaflet").getAttribute("data-suivi")).toBe("oui"),
    );

    await utilisateur.click(screen.getByRole("button", { name: /suivi de la carte/i }));

    // ⚠️ L'usager doit pouvoir regarder plus loin sans que le prochain relevé
    // ne ramène la carte de force sous ses pieds.
    await waitFor(() =>
      expect(screen.getByTestId("carte-leaflet").getAttribute("data-suivi")).toBe("non"),
    );
  });

  // ---------------------------------------------------------------------------
  // Arrivée
  // ---------------------------------------------------------------------------

  it("détecte l'arrivée et coupe le GPS", async () => {
    rendre();
    await demarrer();

    act(() => succes!(mesure(48.86, 2.36)));

    // Le message apparaît DEUX fois, et c'est voulu : comme instruction
    // courante en haut, et dans le résumé d'arrivée en dessous.
    expect(await screen.findAllByText(/vous êtes arrivé/i)).toHaveLength(2);
    // Continuer à suivre après l'arrivée viderait la batterie pour rien.
    await waitFor(() => expect(clearWatch).toHaveBeenCalledWith(7));
  });

  it("résume le trajet à l'arrivée, sans PRÉTENDRE l'avoir chronométré", async () => {
    rendre();
    await demarrer();

    act(() => succes!(mesure(48.86, 2.36)));

    // ⚠️ « Durée PRÉVUE » : nous ne chronométrons pas l'usager et ne
    // conservons aucune trace. Annoncer « vous avez mis 27 minutes »
    // supposerait une mesure que nous refusons de faire.
    expect(await screen.findByText(/durée prévue/i)).toBeDefined();
    expect(screen.getByText(/CO₂ évité vs voiture/i)).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Recalcul
  // ---------------------------------------------------------------------------

  it("recalcule depuis la position quand l'usager s'écarte", async () => {
    vi.mocked(rechercherItineraires).mockResolvedValue([ITINERAIRE]);
    rendre();
    await demarrer();

    // ~1,1 km au nord du trajet, avec une position sûre.
    act(() => succes!(mesure(48.87, 2.35, 10)));

    await waitFor(() =>
      expect(rechercherItineraires).toHaveBeenCalledWith({
        fromLat: 48.87,
        fromLon: 2.35,
        // ⚠️ LA DESTINATION NE CHANGE JAMAIS : on ne recalcule que le chemin.
        toLat: 48.86,
        toLon: 2.36,
      }),
    );
  });

  it("NE RECALCULE PAS sur une position trop imprécise", async () => {
    rendre();
    await demarrer();

    // Même écart, mais annoncé à ±2 km : la mesure ne prouve rien.
    act(() => succes!(mesure(48.87, 2.35, 2000)));

    await new Promise((resoudre) => setTimeout(resoudre, 50));

    // Dans un tunnel, l'application recalculerait sans fin un trajet que
    // l'usager suit correctement.
    expect(rechercherItineraires).not.toHaveBeenCalled();
  });

  it("respecte un DÉLAI DE GARDE entre deux recalculs", async () => {
    vi.mocked(rechercherItineraires).mockResolvedValue([ITINERAIRE]);
    rendre();
    await demarrer();

    act(() => succes!(mesure(48.87, 2.35, 10, 1_788_000_000_000)));
    await waitFor(() => expect(rechercherItineraires).toHaveBeenCalledTimes(1));

    // Une seconde GPS plus tard, toujours hors trajet.
    act(() => succes!(mesure(48.87, 2.351, 10, 1_788_000_001_000)));
    await new Promise((resoudre) => setTimeout(resoudre, 50));

    // ⚠️ Sans ce verrou, un usager réellement sorti du trajet déclencherait
    // une recherche PAR RELEVÉ — plusieurs par seconde.
    expect(rechercherItineraires).toHaveBeenCalledTimes(1);
  });

  it("garde l'itinéraire précédent quand le recalcul ne trouve rien", async () => {
    vi.mocked(rechercherItineraires).mockResolvedValue([]);
    rendre();
    await demarrer();

    act(() => succes!(mesure(48.87, 2.35, 10)));

    // « Aucun itinéraire » est une réponse, pas une panne : on ne laisse pas
    // l'usager sans rien.
    expect(await screen.findByText(/aucun itinéraire depuis votre position/i)).toBeDefined();
    expect(screen.getByText(/Prenez le Métro 4/)).toBeDefined();
  });

  it("annonce un échec de recalcul sans perdre le trajet", async () => {
    vi.mocked(rechercherItineraires).mockRejectedValue(new Error("réseau coupé"));
    rendre();
    await demarrer();

    act(() => succes!(mesure(48.87, 2.35, 10)));

    await waitFor(() => expect(screen.getByText(/Prenez le Métro 4/)).toBeDefined());
  });

  // ---------------------------------------------------------------------------
  // Guidage vocal
  // ---------------------------------------------------------------------------

  it("reste MUET tant que le guidage n'est pas activé", async () => {
    rendre();
    await demarrer();

    act(() => succes!(mesure(48.86, 2.345)));

    // Une application qui se met à parler toute seule dans un métro est une
    // application qu'on coupe.
    expect(speak).not.toHaveBeenCalled();
  });

  it("énonce l'instruction une fois le guidage activé", async () => {
    rendre();
    const utilisateur = await demarrer();

    await utilisateur.click(screen.getByRole("button", { name: /guidage vocal/i }));
    act(() => succes!(mesure(48.86, 2.345)));

    await waitFor(() => expect(speak).toHaveBeenCalled());
    expect((speak.mock.calls[0][0] as { text: string }).text).toMatch(/Prenez le Métro 4/);
  });

  it("ne répète PAS la même instruction à chaque relevé", async () => {
    rendre();
    const utilisateur = await demarrer();
    await utilisateur.click(screen.getByRole("button", { name: /guidage vocal/i }));

    act(() => succes!(mesure(48.86, 2.345)));
    act(() => succes!(mesure(48.86, 2.3455)));
    act(() => succes!(mesure(48.86, 2.346)));

    await waitFor(() => expect(speak).toHaveBeenCalled());
    // Le GPS émet plusieurs relevés par seconde : sans cette garde, la voix
    // parlerait sans fin.
    expect(speak).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // Erreurs de localisation
  // ---------------------------------------------------------------------------

  it("explique un refus de permission", async () => {
    let echec: ((erreur: GeolocationPositionError) => void) | null = null;
    watchPosition.mockImplementation(
      (_ok: Succes, ko: (erreur: GeolocationPositionError) => void) => {
        echec = ko;
        return 7;
      },
    );

    rendre();
    await demarrer();

    act(() => echec!({ code: 1, message: "" } as GeolocationPositionError));

    expect(await screen.findByText(/localisation indisponible/i)).toBeDefined();
    expect(screen.getByText(/réglages/i)).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Déroulé du trajet, étape en cours
  // ---------------------------------------------------------------------------
  describe("timeline", () => {
    /// Deux lignes distinctes : le trajet a donc deux étapes.
    const DEUX_ETAPES = {
      ...ITINERAIRE,
      walkAccess: null,
      walkEgress: null,
      numberOfTransfers: 1,
      segments: [
        segment(48.86, 2.34, 48.86, 2.35, {
          lineName: "A",
          lineId: "tram-a",
          toStopName: "Homme de Fer",
        }),
        segment(48.86, 2.35, 48.86, 2.36, {
          lineName: "C",
          lineId: "tram-c",
          fromStopName: "Homme de Fer",
          toStopName: "Esplanade",
        }),
      ],
    };

    it("n'affiche AUCUN déroulé avant le départ", () => {
      rendre();

      // Avant de commencer, l'écran doit tenir en une décision : partir ou
      // non. Le détail viendra en route.
      expect(screen.queryByRole("region", { name: /déroulé du trajet/i })).toBeNull();
    });

    it("affiche les étapes une fois le suivi lancé", async () => {
      window.sessionStorage.clear();
      memoriserSelection({ ...SELECTION, itineraire: DEUX_ETAPES });
      rendre();
      await demarrer();

      act(() => succes!(mesure(48.86, 2.345)));

      const deroule = within(await screen.findByRole("region", { name: /déroulé du trajet/i }));

      expect(deroule.getByText(/Métro A/)).toBeDefined();
      expect(deroule.getByText(/Métro C/)).toBeDefined();
    });

    it("SURLIGNE l'étape en cours, sans reposer sur la seule couleur", async () => {
      window.sessionStorage.clear();
      memoriserSelection({ ...SELECTION, itineraire: DEUX_ETAPES });
      rendre();
      await demarrer();

      // Position sur le SECOND tronçon.
      act(() => succes!(mesure(48.86, 2.355)));

      await waitFor(() => {
        const courante = document.querySelector('[aria-current="step"]');
        expect(courante?.textContent).toMatch(/Métro C/);
      });

      // ⚠️ TROIS SIGNAUX, pas seulement la couleur : `aria-current="step"`,
      // un repère textuel lu par les lecteurs d'écran, et la graisse. Deux
      // survivent à un daltonisme ou à un écran en plein soleil (WCAG 1.4.1).
      expect(screen.getByText(/étape en cours/i)).toBeDefined();
    });

    it("suit l'avancement quand la position change d'étape", async () => {
      window.sessionStorage.clear();
      memoriserSelection({ ...SELECTION, itineraire: DEUX_ETAPES });
      rendre();
      await demarrer();

      act(() => succes!(mesure(48.86, 2.343)));
      await waitFor(() =>
        expect(document.querySelector('[aria-current="step"]')?.textContent).toMatch(/Métro A/),
      );

      act(() => succes!(mesure(48.86, 2.358)));
      await waitFor(() =>
        expect(document.querySelector('[aria-current="step"]')?.textContent).toMatch(/Métro C/),
      );
    });

    it("désigne UN SEUL groupe, même sur un trajet à plusieurs tronçons", async () => {
      // Trois tronçons de la MÊME ligne : un seul groupe, donc une seule
      // étape courante. Confondre l'indice de segment et celui de groupe
      // désignerait une étape qui n'existe pas.
      window.sessionStorage.clear();
      memoriserSelection({
        ...SELECTION,
        itineraire: {
          ...ITINERAIRE,
          segments: [
            segment(48.86, 2.34, 48.86, 2.35),
            segment(48.86, 2.35, 48.86, 2.36),
            segment(48.86, 2.36, 48.86, 2.37),
          ],
        },
      });
      rendre();
      await demarrer();

      act(() => succes!(mesure(48.86, 2.365)));

      await waitFor(() =>
        expect(document.querySelectorAll('[aria-current="step"]')).toHaveLength(1),
      );
    });
  });
});
