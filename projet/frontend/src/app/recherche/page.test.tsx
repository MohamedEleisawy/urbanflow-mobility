import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RecherchePage from "./page";
import { AuthProvider } from "@/components/AuthProvider";
import { ApiError, NetworkError } from "@/lib/api";
import type { CarbonResult, Itinerary, Stop, User } from "@/lib/types";

// Seul le RÉSEAU est simulé. Le formulaire, son état, sa validation et le
// rendu des résultats sont les vrais : c'est précisément ce qu'on veut
// éprouver.
// `versRequeteEnregistrement` n'est PAS simulée : c'est elle qui fabrique le
// corps envoyé au backend, et la laisser réelle est le seul moyen de détecter
// une erreur de câblage — un `originLon` au lieu d'`originLng`, par exemple.
vi.mock("@/lib/itineraires-api", async (original) => ({
  ...(await original<typeof import("@/lib/itineraires-api")>()),
  listerArrets: vi.fn(),
  rechercherItineraires: vi.fn(),
  enregistrerItineraire: vi.fn(),
}));

// LEAFLET EST LA SEULE CHOSE SIMULÉE DU BLOC 5B. La vraie bibliothèque exige
// un vrai navigateur : jsdom n'a ni `ResizeObserver`, ni disposition calculée,
// ni canvas. On remplace donc UNIQUEMENT le fichier qui la contient — le cadre
// `Carte`, l'équivalent textuel et le calcul du tracé restent les vrais, et
// c'est bien eux qu'on veut éprouver.
//
// Le remplaçant EXPOSE ses propriétés dans le DOM : c'est ainsi qu'on vérifie
// ce que la page transmet réellement à la carte.
vi.mock("@/components/CarteLeaflet", () => ({
  default: ({ arrets, trace }: { arrets: unknown[]; trace: unknown[] | null }) => (
    <div
      data-testid="carte-leaflet"
      data-arrets={arrets.length}
      data-trace={
        trace === null ? "aucun" : trace.map((p) => (p as { nom: string }).nom).join(" > ")
      }
    />
  ),
}));

// Le VRAI AuthProvider est utilisé, avec le VRAI localStorage : c'est lui qui
// décide si l'enregistrement est proposé.
vi.mock("@/lib/auth-api", () => ({
  inscrire: vi.fn(),
  connecter: vi.fn(),
  utilisateurCourant: vi.fn(),
}));

// `versSegmentsCarbone` n'est PAS simulée : c'est une fonction pure, testée
// à part, et la laisser réelle vérifie au passage que la page lui transmet
// bien les segments de l'itinéraire.
vi.mock("@/lib/carbone-api", async (original) => ({
  ...(await original<typeof import("@/lib/carbone-api")>()),
  estimerCarbone: vi.fn(),
}));

const { listerArrets, rechercherItineraires, enregistrerItineraire } =
  await import("@/lib/itineraires-api");
const { estimerCarbone } = await import("@/lib/carbone-api");
const { utilisateurCourant } = await import("@/lib/auth-api");

const PROFIL: User = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "usager@exemple.fr",
  role: "USER",
  createdAt: "2026-08-01T10:00:00.000Z",
  deletedAt: null,
  preferences: null,
};

const ARRETS: Stop[] = [
  {
    id: "aaaaaaaa-0000-0000-0000-000000000001",
    name: "Gare du Nord",
    latitude: 48.88,
    longitude: 2.355,
    pmrAccessible: true,
    operatorCode: "RATP",
    gtfsStopId: "N1",
  },
  {
    id: "aaaaaaaa-0000-0000-0000-000000000002",
    name: "Châtelet",
    latitude: 48.858,
    longitude: 2.347,
    pmrAccessible: false,
    operatorCode: "RATP",
    gtfsStopId: "N2",
  },
  {
    id: "aaaaaaaa-0000-0000-0000-000000000003",
    name: "Bastille",
    latitude: 48.853,
    longitude: 2.369,
    pmrAccessible: true,
    operatorCode: "RATP",
    gtfsStopId: "N3",
  },
];

const RAPIDE: Itinerary = {
  criterion: "FASTEST",
  totalDistanceM: 4300,
  totalDurationMin: 24,
  segments: [
    {
      fromStopId: ARRETS[0].id,
      fromStopName: "Gare du Nord",
      toStopId: ARRETS[1].id,
      toStopName: "Châtelet",
      mode: "METRO",
      lineName: "4",
      operator: "RATP",
      lineId: "ligne-4",
      distanceM: 2800,
      durationMin: 9,
    },
    {
      fromStopId: ARRETS[1].id,
      fromStopName: "Châtelet",
      toStopId: ARRETS[2].id,
      toStopName: "Bastille",
      mode: "WALK",
      lineName: "À pied",
      operator: "—",
      lineId: "ligne-marche",
      distanceM: 1500,
      durationMin: 15,
    },
  ],
};

const COURT: Itinerary = {
  criterion: "SHORTEST",
  totalDistanceM: 3900,
  totalDurationMin: 31,
  segments: [
    {
      fromStopId: ARRETS[0].id,
      fromStopName: "Gare du Nord",
      toStopId: ARRETS[2].id,
      toStopName: "Bastille",
      mode: "BUS",
      lineName: "38",
      operator: "RATP",
      lineId: "ligne-38",
      distanceM: 3900,
      durationMin: 31,
    },
  ],
};

const CARBONE_RAPIDE: CarbonResult = {
  totalDistanceM: 4300,
  totalCo2Grams: 316,
  carCo2Grams: 937,
  savedVsCarGrams: 621,
  ecoScore: 66.3,
  breakdown: [
    { mode: "METRO", distanceM: 2800, co2Grams: 11 },
    { mode: "WALK", distanceM: 1500, co2Grams: 0 },
  ],
};

const CARBONE_COURT: CarbonResult = {
  totalDistanceM: 3900,
  totalCo2Grams: 441,
  carCo2Grams: 850,
  savedVsCarGrams: 409,
  ecoScore: 48.1,
  breakdown: [{ mode: "BUS", distanceM: 3900, co2Grams: 441 }],
};

const rendre = () =>
  render(
    <AuthProvider>
      <RecherchePage />
    </AuthProvider>,
  );

/// Place un jeton et fait répondre /me : l'usager est authentifié.
const authentifier = () => {
  window.localStorage.setItem("urbanflow.token", "jeton-valide");
  vi.mocked(utilisateurCourant).mockResolvedValue(PROFIL);
};

/// Choisit un départ et une arrivée, puis lance la recherche.
const chercher = async (depart = "Gare du Nord", arrivee = "Bastille") => {
  const utilisateur = userEvent.setup();

  await utilisateur.selectOptions(
    await screen.findByLabelText("Départ"),
    screen.getAllByRole("option", { name: new RegExp(depart) })[0],
  );
  await utilisateur.selectOptions(
    screen.getByLabelText("Arrivée"),
    screen.getAllByRole("option", { name: new RegExp(arrivee) })[1],
  );
  await utilisateur.click(screen.getByRole("button", { name: /rechercher/i }));

  return utilisateur;
};

describe("/recherche", () => {
  beforeEach(() => {
    vi.mocked(listerArrets).mockReset();
    vi.mocked(rechercherItineraires).mockReset();
    vi.mocked(estimerCarbone).mockReset();
    vi.mocked(enregistrerItineraire).mockReset();
    vi.mocked(utilisateurCourant).mockReset();
    vi.mocked(listerArrets).mockResolvedValue(ARRETS);
    // Par défaut, l'estimation n'aboutit jamais : les tests qui ne parlent
    // pas de carbone ne doivent pas dépendre de son résultat.
    vi.mocked(estimerCarbone).mockReturnValue(new Promise(() => {}));
  });

  // ---------------------------------------------------------------------------
  // Chargement du formulaire
  // ---------------------------------------------------------------------------
  describe("formulaire", () => {
    it("affiche les deux listes d'arrêts et le bouton", async () => {
      rendre();

      expect(await screen.findByLabelText("Départ")).toBeDefined();
      expect(screen.getByLabelText("Arrivée")).toBeDefined();
      expect(screen.getByRole("button", { name: /rechercher/i })).toBeDefined();
    });

    it("propose les arrêts renvoyés par le backend", async () => {
      rendre();

      const depart = await screen.findByLabelText("Départ");
      // Trois arrêts + l'option d'invite.
      expect(within(depart).getAllByRole("option")).toHaveLength(4);
      expect(within(depart).getByText(/Châtelet/)).toBeDefined();
    });

    it("signale les arrêts accessibles en fauteuil", async () => {
      rendre();

      const depart = await screen.findByLabelText("Départ");
      // `pmrAccessible` est une donnée réelle du modèle, utile à une partie
      // des usagers.
      expect(within(depart).getByText(/Gare du Nord ♿/)).toBeDefined();
    });

    it("affiche un indicateur pendant le chargement des arrêts", () => {
      vi.mocked(listerArrets).mockReturnValue(new Promise(() => {}));

      rendre();

      expect(screen.getByText(/chargement des arrêts/i)).toBeDefined();
    });

    it("signale l'échec du chargement des arrêts", async () => {
      vi.mocked(listerArrets).mockRejectedValue(new NetworkError("Le serveur est injoignable."));

      rendre();

      const alerte = await screen.findByRole("alert");
      expect(alerte.textContent).toContain("injoignable");
    });
  });

  // ---------------------------------------------------------------------------
  // Validation minimale
  // ---------------------------------------------------------------------------
  describe("validation", () => {
    it("désactive la recherche tant que les deux arrêts ne sont pas choisis", async () => {
      rendre();
      await screen.findByLabelText("Départ");

      expect(screen.getByRole("button", { name: /rechercher/i }).hasAttribute("disabled")).toBe(
        true,
      );
    });

    it("refuse un départ et une arrivée identiques", async () => {
      rendre();
      const utilisateur = userEvent.setup();
      const depart = await screen.findByLabelText("Départ");

      await utilisateur.selectOptions(depart, ARRETS[0].id);
      await utilisateur.selectOptions(screen.getByLabelText("Arrivée"), ARRETS[0].id);

      // Un aller-retour réseau pour apprendre cela serait discourtois : le
      // backend rendrait une liste vide.
      expect(await screen.findByText(/doivent être différents/i)).toBeDefined();
      expect(screen.getByRole("button", { name: /rechercher/i }).hasAttribute("disabled")).toBe(
        true,
      );
      expect(rechercherItineraires).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Appel API
  // ---------------------------------------------------------------------------
  describe("appel API", () => {
    it("transmet les COORDONNÉES des arrêts choisis", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
      rendre();

      await chercher();

      // Le contrat backend attend quatre coordonnées, jamais des
      // identifiants d'arrêt.
      await waitFor(() =>
        expect(rechercherItineraires).toHaveBeenCalledWith({
          fromLat: 48.88,
          fromLon: 2.355,
          toLat: 48.853,
          toLon: 2.369,
        }),
      );
    });

    it("désactive le bouton pendant la recherche", async () => {
      let libere: (valeur: Itinerary[]) => void = () => {};
      vi.mocked(rechercherItineraires).mockReturnValue(
        new Promise((resolve) => {
          libere = resolve;
        }),
      );
      rendre();

      await chercher();

      // Sans ce verrou, un double clic lancerait deux recherches
      // concurrentes, et la plus lente écraserait la plus rapide.
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: /recherche en cours/i }).hasAttribute("disabled"),
        ).toBe(true),
      );

      libere([RAPIDE]);
    });

    it("affiche un indicateur pendant la recherche", async () => {
      vi.mocked(rechercherItineraires).mockReturnValue(new Promise(() => {}));
      rendre();

      await chercher();

      expect(await screen.findByText(/recherche d'itinéraires/i)).toBeDefined();
    });

    it("n'appelle l'API qu'une fois par soumission", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
      rendre();

      await chercher();

      await screen.findByText("Le plus rapide");
      expect(rechercherItineraires).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Résultats
  // ---------------------------------------------------------------------------
  describe("résultats", () => {
    it("n'affiche rien avant la première recherche", async () => {
      rendre();
      await screen.findByLabelText("Départ");

      // « Pas encore cherché » n'est pas « rien trouvé ».
      //
      // On vise le TITRE du bloc de résultats, pas un texte libre : le
      // paragraphe d'introduction contient lui aussi « le plus rapide », et
      // une recherche trop large passerait sans rien prouver.
      expect(screen.queryByText(/aucun itinéraire/i)).toBeNull();
      expect(screen.queryByRole("heading", { name: /itinéraires? proposés?/i })).toBeNull();
    });

    it("affiche un itinéraire avec ses totaux", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
      rendre();

      await chercher();

      expect(await screen.findByText("Le plus rapide")).toBeDefined();
      // Portée à la LISTE des résultats : depuis le bloc 5B, l'équivalent
      // textuel de la carte reprend volontairement les mêmes chiffres, et une
      // recherche sur toute la page en trouverait donc deux.
      const liste = within(screen.getByRole("region", { name: /itinéraire/i }));
      // 24 min, 4300 m → « 4,3 km », 2 étapes.
      expect(liste.getByText(/24 min/)).toBeDefined();
      expect(liste.getByText(/4,3 km/)).toBeDefined();
      expect(liste.getByText(/2 étapes/)).toBeDefined();
    });

    it("détaille chaque étape avec son mode et sa ligne", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
      rendre();

      await chercher();

      expect(await screen.findByText("Gare du Nord → Châtelet")).toBeDefined();
      // « Métro 4 », pas « METRO » : l'exigence posée en 4E-2.
      expect(screen.getByText(/Métro 4 · RATP/)).toBeDefined();
      expect(screen.getByText(/Marche À pied/)).toBeDefined();
    });

    it("présente les deux propositions pour les comparer", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE, COURT]);
      rendre();

      await chercher();

      expect(await screen.findByRole("heading", { name: /2 itinéraires proposés/i })).toBeDefined();
      expect(screen.getByText("Le plus rapide")).toBeDefined();
      expect(screen.getByText("Le plus court")).toBeDefined();
    });

    it("accorde le titre au singulier pour une seule proposition", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
      rendre();

      await chercher();

      // Le backend déduplique quand le plus court est aussi le plus rapide.
      expect(await screen.findByRole("heading", { name: /1 itinéraire proposé/i })).toBeDefined();
    });

    it("ordonne les étapes dans une liste ordonnée", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
      rendre();

      await chercher();

      await screen.findByText("Le plus rapide");
      // <ol> et non <ul> : l'ordre des étapes est celui du trajet.
      expect(document.querySelector("ol")).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Carte interactive (bloc 5B)
  // ---------------------------------------------------------------------------
  describe("carte", () => {
    /// Le remplaçant de Leaflet expose ses propriétés : c'est ainsi qu'on lit
    /// ce que la page lui a réellement transmis.
    const carte = () => screen.getByTestId("carte-leaflet");
    const traceAffiche = () => carte().getAttribute("data-trace");

    it("est présente dès le chargement, avant toute recherche", async () => {
      rendre();

      expect(await screen.findByRole("heading", { name: /arrêts du réseau/i })).toBeDefined();
      expect(carte()).toBeDefined();
    });

    it("reçoit les arrêts DÉJÀ chargés, sans appel supplémentaire", async () => {
      rendre();

      await waitFor(() => expect(carte().getAttribute("data-arrets")).toBe("3"));
      // Un seul GET /api/stops pour toute la page : ni la carte ni les étapes
      // ne résolvent un arrêt par un appel individuel (pas de N+1).
      expect(listerArrets).toHaveBeenCalledTimes(1);
    });

    it("ne trace RIEN tant qu'aucune recherche n'a eu lieu", async () => {
      rendre();

      await waitFor(() => expect(traceAffiche()).toBe("aucun"));
      expect(screen.getByText(/3 arrêts du réseau sont localisés/i)).toBeDefined();
    });

    it("trace l'itinéraire retenu après une recherche", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
      rendre();

      await chercher();

      // Trois points pour deux étapes, dans l'ordre du trajet.
      await waitFor(() => expect(traceAffiche()).toBe("Gare du Nord > Châtelet > Bastille"));
    });

    it("met en avant le PREMIER résultat sans attendre un clic", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE, COURT]);
      rendre();

      await chercher();

      await waitFor(() =>
        expect(screen.getByRole("heading", { name: /trajet retenu sur la carte/i })).toBeDefined(),
      );
      const boutons = screen.getAllByRole("button", { name: /sur la carte/i });
      expect(boutons[0].getAttribute("aria-pressed")).toBe("true");
      expect(boutons[1].getAttribute("aria-pressed")).toBe("false");
    });

    it("change de tracé quand on sélectionne l'autre itinéraire", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE, COURT]);
      rendre();
      const utilisateur = await chercher();
      await waitFor(() => expect(traceAffiche()).toBe("Gare du Nord > Châtelet > Bastille"));

      await utilisateur.click(screen.getAllByRole("button", { name: /afficher sur la carte/i })[0]);

      // Le second itinéraire ne passe pas par les mêmes arrêts : le tracé
      // change réellement, il n'est pas simplement redessiné.
      await waitFor(() => expect(traceAffiche()).not.toBe("Gare du Nord > Châtelet > Bastille"));
      const boutons = screen.getAllByRole("button", { name: /sur la carte/i });
      expect(boutons[1].getAttribute("aria-pressed")).toBe("true");
    });

    it("repart d'une sélection neuve à chaque nouvelle recherche", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE, COURT]);
      rendre();
      const utilisateur = await chercher();
      await utilisateur.click(screen.getAllByRole("button", { name: /afficher sur la carte/i })[0]);
      await waitFor(() =>
        expect(
          screen.getAllByRole("button", { name: /sur la carte/i })[1].getAttribute("aria-pressed"),
        ).toBe("true"),
      );

      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
      await chercher();

      // Garder « SHORTEST » mettrait en avant un critère absent de la
      // nouvelle réponse.
      await waitFor(() => expect(traceAffiche()).toBe("Gare du Nord > Châtelet > Bastille"));
    });

    it("ne trace RIEN quand un arrêt du trajet est inconnu", async () => {
      // Un itinéraire dont une étape désigne un arrêt absent de GET /api/stops.
      vi.mocked(rechercherItineraires).mockResolvedValue([
        {
          ...RAPIDE,
          segments: [
            { ...RAPIDE.segments[0], toStopId: "arret-absent-du-referentiel" },
            { ...RAPIDE.segments[1], fromStopId: "arret-absent-du-referentiel" },
          ],
        },
      ]);
      rendre();

      await chercher();

      // Relier directement les arrêts connus sauterait une étape réelle :
      // mieux vaut ne rien tracer, et le DIRE.
      await waitFor(() => expect(traceAffiche()).toBe("aucun"));
      expect(screen.getByText(/le tracé ne peut pas être dessiné/i)).toBeDefined();
    });

    it("annonce que le tracé est un SCHÉMA, pas le chemin réel", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
      rendre();

      await chercher();

      // Le backend ne stocke aucune géométrie de voie : le dire est la seule
      // façon honnête d'afficher une ligne droite entre deux arrêts.
      expect(await screen.findByText(/schéma du trajet, pas le chemin exact/i)).toBeDefined();
    });

    it("garde les étapes lisibles EN TEXTE, carte ou pas", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
      rendre();

      await chercher();

      // L'information essentielle ne dépend jamais de la carte : chaque étape
      // reste écrite, avec son mode et sa ligne.
      const liste = within(screen.getByRole("region", { name: /itinéraire/i }));
      expect(await liste.findByText("Gare du Nord → Châtelet")).toBeDefined();
      expect(liste.getByText(/Métro 4/)).toBeDefined();
      expect(liste.getByText("Châtelet → Bastille")).toBeDefined();
    });

    it("reste sans effet sur l'enregistrement du trajet", async () => {
      // La sélection sert la CARTE, pas l'enregistrement : celui-ci reçoit
      // toujours l'itinéraire de sa propre fiche (étape 5A-7).
      authentifier();
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE, COURT]);
      vi.mocked(enregistrerItineraire).mockResolvedValue({
        id: "route-1",
        originLat: 48.88,
        originLng: 2.355,
        destinationLat: 48.853,
        destinationLng: 2.369,
        requestedAt: "2026-08-25T09:30:00.000Z",
        totalDurationMin: 31,
        totalDistanceM: 3900,
        ecoScore: 90,
        carbonEstimate: 12,
        userId: PROFIL.id,
        segments: [],
      });
      rendre();
      const utilisateur = await chercher();

      // On met le SECOND itineraire sur la carte, puis on enregistre le
      // PREMIER : les deux gestes ne doivent pas se confondre.
      await utilisateur.click(screen.getAllByRole("button", { name: /afficher sur la carte/i })[0]);
      await utilisateur.click(
        await screen.findByRole("button", { name: /enregistrer le trajet le plus rapide/i }),
      );

      await waitFor(() => expect(enregistrerItineraire).toHaveBeenCalled());
      const [envoye] = vi.mocked(enregistrerItineraire).mock.calls[0];
      // Les segments envoyés sont ceux de l'itinéraire RAPIDE, dont la fiche
      // portait le bouton — pas ceux de l'itinéraire affiché sur la carte.
      expect(envoye.segments.map((segment) => segment.lineId)).toEqual(
        RAPIDE.segments.map((segment) => segment.lineId),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Estimation carbone (étape 5A-6)
  // ---------------------------------------------------------------------------
  describe("empreinte carbone", () => {
    it("transmet les segments de l'itinéraire au calcul", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
      vi.mocked(estimerCarbone).mockResolvedValue(CARBONE_RAPIDE);
      rendre();

      await chercher();

      await waitFor(() => expect(estimerCarbone).toHaveBeenCalledWith(RAPIDE.segments));
    });

    it("affiche les chiffres réellement calculés", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
      vi.mocked(estimerCarbone).mockResolvedValue(CARBONE_RAPIDE);
      rendre();

      await chercher();

      // 316 g, 621 g économisés, éco-score arrondi.
      expect(await screen.findByText("316 g")).toBeDefined();
      expect(screen.getByText("621 g")).toBeDefined();
      expect(screen.getByText("66/100")).toBeDefined();
    });

    it("affiche un indicateur pendant l'estimation", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
      vi.mocked(estimerCarbone).mockReturnValue(new Promise(() => {}));
      rendre();

      await chercher();

      expect(await screen.findByText(/estimation de l'empreinte carbone/i)).toBeDefined();
    });

    it("garde l'itinéraire visible PENDANT l'estimation", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
      vi.mocked(estimerCarbone).mockReturnValue(new Promise(() => {}));
      rendre();

      await chercher();

      // Deux niveaux de données : l'itinéraire est déjà connu, il n'a aucune
      // raison d'attendre le carbone pour s'afficher.
      expect(await screen.findByText("Le plus rapide")).toBeDefined();
      expect(
        within(screen.getByRole("region", { name: /itinéraire/i })).getByText(/24 min/),
      ).toBeDefined();
    });

    it("garde l'itinéraire visible quand l'estimation ÉCHOUE", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
      vi.mocked(estimerCarbone).mockRejectedValue(
        new ApiError(503, "Le service de calcul carbone est indisponible."),
      );
      rendre();

      await chercher();

      // LA RÈGLE DE L'ÉTAPE : une panne du calcul carbone ne fait pas
      // disparaître un itinéraire valide.
      expect(await screen.findByText("Le plus rapide")).toBeDefined();
      expect(screen.getByText(/empreinte carbone indisponible/i)).toBeDefined();
    });

    it("annonce un refus de calcul sans le confondre avec une panne", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
      // 422 : un mode reconnu mais sans facteur d'émission (ESCOOTER). Le
      // refus est légitime, et son motif doit remonter à l'usager.
      vi.mocked(estimerCarbone).mockRejectedValue(
        new ApiError(422, "Aucun facteur d'émission pour le mode ESCOOTER"),
      );
      rendre();

      await chercher();

      const texte = await screen.findByText(/empreinte carbone indisponible/i);
      expect(texte.parentElement?.textContent).toContain("ESCOOTER");
    });

    it("reste lisible si le microservice est injoignable", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
      vi.mocked(estimerCarbone).mockRejectedValue(new NetworkError("Le serveur est injoignable."));
      rendre();

      await chercher();

      const texte = await screen.findByText(/empreinte carbone indisponible/i);
      expect(texte.parentElement?.textContent).toContain("injoignable");
    });

    it("n'affiche JAMAIS 0 g à la place d'une erreur", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
      vi.mocked(estimerCarbone).mockRejectedValue(new ApiError(503, "Panne"));
      rendre();

      await chercher();

      await screen.findByText(/empreinte carbone indisponible/i);
      // Zéro est une valeur LÉGITIME — un trajet entièrement à pied émet
      // réellement zéro. L'employer comme repli rendrait les deux cas
      // indiscernables.
      expect(screen.queryByText("0 g")).toBeNull();
    });

    it("estime CHAQUE itinéraire séparément", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE, COURT]);
      vi.mocked(estimerCarbone)
        .mockResolvedValueOnce(CARBONE_RAPIDE)
        .mockResolvedValueOnce(CARBONE_COURT);
      rendre();

      await chercher();

      expect(await screen.findByText("316 g")).toBeDefined();
      expect(screen.getByText("441 g")).toBeDefined();
      expect(estimerCarbone).toHaveBeenCalledTimes(2);
    });

    it("n'attribue JAMAIS l'estimation d'un itinéraire à un autre", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE, COURT]);
      vi.mocked(estimerCarbone)
        .mockResolvedValueOnce(CARBONE_RAPIDE)
        .mockResolvedValueOnce(CARBONE_COURT);
      rendre();

      await chercher();
      await screen.findByText("316 g");

      // Chaque carte est inspectée SÉPARÉMENT : les chiffres du plus rapide
      // ne doivent pas apparaître sous le plus court.
      const cartes = screen.getAllByRole("listitem");
      const carteRapide = cartes.find((c) => c.textContent?.includes("Le plus rapide"))!;
      const carteCourte = cartes.find((c) => c.textContent?.includes("Le plus court"))!;

      expect(within(carteRapide).getByText("316 g")).toBeDefined();
      expect(within(carteRapide).queryByText("441 g")).toBeNull();
      expect(within(carteCourte).getByText("441 g")).toBeDefined();
      expect(within(carteCourte).queryByText("316 g")).toBeNull();
    });

    it("laisse l'estimation réussie visible quand l'AUTRE échoue", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE, COURT]);
      vi.mocked(estimerCarbone)
        .mockResolvedValueOnce(CARBONE_RAPIDE)
        .mockRejectedValueOnce(new ApiError(503, "Panne"));
      rendre();

      await chercher();

      // C'est ce que `allSettled` garantit et que `all` interdirait : un
      // échec n'emporte pas le succès de l'autre.
      expect(await screen.findByText("316 g")).toBeDefined();
      expect(screen.getByText(/empreinte carbone indisponible/i)).toBeDefined();
    });

    it("n'estime rien quand aucun itinéraire n'est trouvé", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([]);
      rendre();

      await chercher();

      await screen.findByText(/aucun itinéraire trouvé/i);
      expect(estimerCarbone).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Enregistrement d'un itinéraire (étape 5A-7)
  // ---------------------------------------------------------------------------
  describe("enregistrement", () => {
    /// Le bouton d'UN itinéraire, désigné par son libellé.
    const boutonEnregistrer = (critere: "rapide" | "court") =>
      screen.getByRole("button", {
        name: new RegExp(`enregistrer le trajet le plus ${critere}`, "i"),
      });

    describe("visiteur non authentifié", () => {
      it("propose la connexion au lieu du bouton", async () => {
        vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
        rendre();

        await chercher();

        expect(await screen.findByText(/connectez-vous pour enregistrer/i)).toBeDefined();
        expect(screen.getByRole("link", { name: /se connecter/i })).toBeDefined();
      });

      it("n'appelle JAMAIS POST /api/routes", async () => {
        vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
        rendre();

        await chercher();
        await screen.findByText(/connectez-vous pour enregistrer/i);

        // Inutile de déranger le backend : il répondrait 401.
        expect(enregistrerItineraire).not.toHaveBeenCalled();
      });

      it("laisse la recherche entièrement lisible", async () => {
        vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
        rendre();

        await chercher();

        // Seul l'ENREGISTREMENT demande un compte ; la recherche est publique.
        expect(await screen.findByText("Le plus rapide")).toBeDefined();
        expect(screen.getByText("Gare du Nord → Châtelet")).toBeDefined();
      });
    });

    describe("usager authentifié", () => {
      beforeEach(() => {
        authentifier();
      });

      it("propose un bouton par itinéraire", async () => {
        vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE, COURT]);
        rendre();

        await chercher();

        // Deux boutons DISTINCTS : leur nom dit ce qu'ils enregistrent.
        expect(await screen.findByRole("button", { name: /le plus rapide/i })).toBeDefined();
        expect(screen.getByRole("button", { name: /le plus court/i })).toBeDefined();
      });

      it("envoie le corps EXACT attendu par le backend", async () => {
        vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
        vi.mocked(enregistrerItineraire).mockResolvedValue({} as never);
        rendre();
        const utilisateur = await chercher();

        await utilisateur.click(await screen.findByRole("button", { name: /le plus rapide/i }));

        // Coordonnées des arrêts CHOISIS, et pour chaque segment le seul
        // triplet du réseau. Ni durée, ni distance, ni CO2, ni éco-score :
        // le ValidationPipe les rejetterait en 400.
        await waitFor(() =>
          expect(enregistrerItineraire).toHaveBeenCalledWith(
            {
              originLat: 48.88,
              originLng: 2.355,
              destinationLat: 48.853,
              destinationLng: 2.369,
              segments: [
                {
                  lineId: "ligne-4",
                  fromStopId: ARRETS[0].id,
                  toStopId: ARRETS[1].id,
                },
                {
                  lineId: "ligne-marche",
                  fromStopId: ARRETS[1].id,
                  toStopId: ARRETS[2].id,
                },
              ],
            },
            "jeton-valide",
          ),
        );
      });

      it("envoie un itinéraire à UN seul segment", async () => {
        vi.mocked(rechercherItineraires).mockResolvedValue([COURT]);
        vi.mocked(enregistrerItineraire).mockResolvedValue({} as never);
        rendre();
        const utilisateur = await chercher();

        await utilisateur.click(await screen.findByRole("button", { name: /le plus court/i }));

        await waitFor(() => {
          const corps = vi.mocked(enregistrerItineraire).mock.calls[0][0];
          expect(corps.segments).toEqual([
            {
              lineId: "ligne-38",
              fromStopId: ARRETS[0].id,
              toStopId: ARRETS[2].id,
            },
          ]);
        });
      });

      it("n'envoie JAMAIS les segments de l'autre itinéraire", async () => {
        vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE, COURT]);
        vi.mocked(enregistrerItineraire).mockResolvedValue({} as never);
        rendre();
        const utilisateur = await chercher();

        // On clique sur le SECOND bouton.
        await utilisateur.click(await screen.findByRole("button", { name: /le plus court/i }));

        await waitFor(() => {
          const corps = vi.mocked(enregistrerItineraire).mock.calls[0][0];
          // Un seul segment, celui du plus court — jamais les deux du plus
          // rapide. C'est ce que garantit l'absence d'état « sélection ».
          expect(corps.segments).toHaveLength(1);
          expect(corps.segments[0].lineId).toBe("ligne-38");
        });
      });

      it("n'envoie AUCUN champ calculé côté frontend", async () => {
        vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
        vi.mocked(enregistrerItineraire).mockResolvedValue({} as never);
        rendre();
        const utilisateur = await chercher();

        await utilisateur.click(await screen.findByRole("button", { name: /le plus rapide/i }));

        await waitFor(() => {
          // Passage par `unknown` : le type du corps n'a pas de signature
          // d'index, et c'est justement ce qu'on veut inspecter — la liste
          // EXACTE des clés envoyées.
          const corps = vi.mocked(enregistrerItineraire).mock.calls[0][0] as unknown as Record<
            string,
            unknown
          >;
          // Ces champs ont été RETIRÉS du contrat en 4E-3B : les envoyer
          // rouvrirait la faille d'intégrité qu'ils avaient créée.
          expect(corps.totalDurationMin).toBeUndefined();
          expect(corps.totalDistanceM).toBeUndefined();
          expect(corps.ecoScore).toBeUndefined();
          expect(corps.carbonEstimate).toBeUndefined();
          expect(Object.keys(corps).sort()).toEqual([
            "destinationLat",
            "destinationLng",
            "originLat",
            "originLng",
            "segments",
          ]);
        });
      });

      it("désactive le bouton pendant l'envoi", async () => {
        vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
        vi.mocked(enregistrerItineraire).mockReturnValue(new Promise(() => {}));
        rendre();
        const utilisateur = await chercher();

        await utilisateur.click(await screen.findByRole("button", { name: /le plus rapide/i }));

        // Sans ce verrou, un double clic créerait deux trajets identiques.
        await waitFor(() =>
          expect(
            screen.getByRole("button", { name: /enregistrement/i }).hasAttribute("disabled"),
          ).toBe(true),
        );
      });

      it("n'annonce le succès QU'APRÈS la réponse du serveur", async () => {
        let libere: () => void = () => {};
        vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
        vi.mocked(enregistrerItineraire).mockReturnValue(
          new Promise((resolve) => {
            libere = () => resolve({} as never);
          }),
        );
        rendre();
        const utilisateur = await chercher();

        await utilisateur.click(await screen.findByRole("button", { name: /le plus rapide/i }));

        // Pendant l'envoi : aucune confirmation.
        await screen.findByRole("button", { name: /enregistrement/i });
        expect(screen.queryByText(/trajet enregistré/i)).toBeNull();

        libere();

        expect(await screen.findByText(/trajet enregistré/i)).toBeDefined();
      });

      it("confirme l'enregistrement sans masquer l'itinéraire", async () => {
        vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
        vi.mocked(enregistrerItineraire).mockResolvedValue({} as never);
        rendre();
        const utilisateur = await chercher();

        await utilisateur.click(await screen.findByRole("button", { name: /le plus rapide/i }));

        expect(await screen.findByText(/trajet enregistré/i)).toBeDefined();
        expect(screen.getByText("Le plus rapide")).toBeDefined();
      });

      it("n'enregistre QUE l'itinéraire cliqué", async () => {
        vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE, COURT]);
        vi.mocked(enregistrerItineraire).mockResolvedValue({} as never);
        rendre();
        const utilisateur = await chercher();

        await utilisateur.click(await screen.findByRole("button", { name: /le plus rapide/i }));
        await screen.findByText(/trajet enregistré/i);

        // L'autre carte garde son bouton : elle n'a pas été enregistrée.
        expect(boutonEnregistrer("court")).toBeDefined();
        expect(enregistrerItineraire).toHaveBeenCalledTimes(1);
      });

      describe("erreurs", () => {
        const echouerAvec = async (erreur: unknown) => {
          vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
          vi.mocked(enregistrerItineraire).mockRejectedValue(erreur);
          rendre();
          const utilisateur = await chercher();
          await utilisateur.click(await screen.findByRole("button", { name: /le plus rapide/i }));
          return screen.findByRole("alert");
        };

        it("signale un refus de validation (400)", async () => {
          const alerte = await echouerAvec(new ApiError(400, "Les segments ne senchainent pas"));

          expect(alerte.textContent).toContain("senchainent");
        });

        it("signale une session expirée (401)", async () => {
          const alerte = await echouerAvec(new ApiError(401, "Token invalide ou expiré"));

          expect(alerte.textContent).toContain("expiré");
        });

        it("signale un refus de calcul carbone (422)", async () => {
          const alerte = await echouerAvec(
            new ApiError(422, "Aucun facteur d emission pour le mode ESCOOTER"),
          );

          expect(alerte.textContent).toContain("ESCOOTER");
        });

        it("signale un microservice indisponible (503)", async () => {
          const alerte = await echouerAvec(
            new ApiError(503, "Service de calcul carbone indisponible"),
          );

          expect(alerte.textContent).toContain("indisponible");
        });

        it("signale une panne réseau", async () => {
          const alerte = await echouerAvec(new NetworkError("Le serveur est injoignable."));

          expect(alerte.textContent).toContain("injoignable");
        });

        it("n'annonce JAMAIS un succès après un échec", async () => {
          await echouerAvec(new ApiError(503, "Panne"));

          expect(screen.queryByText(/trajet enregistré/i)).toBeNull();
        });

        it("garde l'itinéraire visible malgré l'échec", async () => {
          await echouerAvec(new ApiError(503, "Panne"));

          // Une erreur d'enregistrement n'invalide pas le trajet trouvé.
          expect(screen.getByText("Le plus rapide")).toBeDefined();
          expect(screen.getByText("Gare du Nord → Châtelet")).toBeDefined();
        });

        it("laisse réessayer après un échec", async () => {
          await echouerAvec(new ApiError(503, "Panne"));

          expect(boutonEnregistrer("rapide").hasAttribute("disabled")).toBe(false);
        });
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Absence de résultat et erreurs
  // ---------------------------------------------------------------------------
  describe("absence de résultat et erreurs", () => {
    it("annonce l'absence d'itinéraire SANS la présenter comme une panne", async () => {
      // Le backend répond 200 avec un tableau vide : « aucun itinéraire » est
      // une réponse, pas une erreur.
      vi.mocked(rechercherItineraires).mockResolvedValue([]);
      rendre();

      await chercher();

      expect(await screen.findByText(/aucun itinéraire trouvé/i)).toBeDefined();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("affiche l'erreur de validation renvoyée par le backend", async () => {
      vi.mocked(rechercherItineraires).mockRejectedValue(
        new ApiError(400, "fromLat must be a latitude string or number"),
      );
      rendre();

      await chercher();

      const alerte = await screen.findByRole("alert");
      expect(alerte.textContent).toContain("fromLat");
    });

    it("affiche un message lisible en cas de panne réseau", async () => {
      vi.mocked(rechercherItineraires).mockRejectedValue(
        new NetworkError("Le serveur est injoignable."),
      );
      rendre();

      await chercher();

      const alerte = await screen.findByRole("alert");
      expect(alerte.textContent).toContain("injoignable");
    });

    it("ne laisse JAMAIS fuir une erreur inattendue", async () => {
      vi.mocked(rechercherItineraires).mockRejectedValue(
        new TypeError("Cannot read properties of undefined"),
      );
      rendre();

      await chercher();

      const alerte = await screen.findByRole("alert");
      expect(alerte.textContent).toContain("erreur inattendue");
      expect(alerte.textContent).not.toContain("Cannot read properties");
    });

    it("efface les anciens résultats quand la recherche échoue", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValueOnce([RAPIDE]);
      rendre();
      const utilisateur = await chercher();
      await screen.findByText("Le plus rapide");

      vi.mocked(rechercherItineraires).mockRejectedValueOnce(new ApiError(500, "Erreur interne"));
      await utilisateur.click(screen.getByRole("button", { name: /rechercher/i }));

      // Les laisser sous un message d'erreur laisserait croire qu'ils
      // correspondent à la dernière recherche.
      await screen.findByRole("alert");
      expect(screen.queryByText("Le plus rapide")).toBeNull();
    });

    it("réactive le bouton après un échec", async () => {
      vi.mocked(rechercherItineraires).mockRejectedValue(new ApiError(500, "Erreur interne"));
      rendre();

      await chercher();
      await screen.findByRole("alert");

      expect(screen.getByRole("button", { name: /rechercher/i }).hasAttribute("disabled")).toBe(
        false,
      );
    });
  });
});
