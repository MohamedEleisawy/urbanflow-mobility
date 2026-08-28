import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DetailTrajetPage from "./page";
import { AuthProvider } from "@/components/AuthProvider";
import { ApiError, NetworkError } from "@/lib/api";
import type { RouteDetail, Stop, User } from "@/lib/types";

const ID_TRAJET = "aaaaaaaa-0000-0000-0000-000000000001";

const remplacer = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: remplacer, push: vi.fn() }),
  // Le segment dynamique tel que Next le fournirait à la page.
  useParams: () => ({ id: ID_TRAJET }),
}));

vi.mock("@/lib/auth-api", () => ({
  inscrire: vi.fn(),
  connecter: vi.fn(),
  utilisateurCourant: vi.fn(),
}));

vi.mock("@/lib/espace-api", () => ({
  suiviCarbone: vi.fn(),
  budgetHebdomadaire: vi.fn(),
  historiqueTrajets: vi.fn(),
  detailTrajet: vi.fn(),
}));

vi.mock("@/lib/itineraires-api", () => ({
  listerArrets: vi.fn(),
  rechercherItineraires: vi.fn(),
  enregistrerItineraire: vi.fn(),
  versRequeteEnregistrement: vi.fn(),
}));

const { utilisateurCourant } = await import("@/lib/auth-api");
const { detailTrajet } = await import("@/lib/espace-api");
const { listerArrets } = await import("@/lib/itineraires-api");

const PROFIL: User = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "usager@exemple.fr",
  role: "USER",
  createdAt: "2026-08-01T10:00:00.000Z",
  deletedAt: null,
  preferences: null,
};

const GARE = "stop-gare-du-nord";
const CHATELET = "stop-chatelet";
const BASTILLE = "stop-bastille";

const arret = (id: string, name: string): Stop => ({
  id,
  name,
  latitude: 48.86,
  longitude: 2.35,
  pmrAccessible: true,
  operatorCode: "RATP",
  // `gtfsStopId` NUL : un arrêt saisi à la main doit garder son nom.
  gtfsStopId: null,
});

const ARRETS: Stop[] = [
  arret(GARE, "Gare du Nord"),
  arret(CHATELET, "Châtelet"),
  arret(BASTILLE, "Bastille"),
];

/**
 * Trajet de test — construit pour PIÉGER l'alignement segments/carbone.
 *
 * Les segments sont dans l'ordre chronologique (métro puis marche) ; les
 * `carbonRecords` sont triés par distance DÉCROISSANTE — soit l'ordre
 * inverse. Aligner les deux tableaux position par position attribuerait donc
 * le CO₂ du métro à l'étape de marche.
 */
const TRAJET: RouteDetail = {
  id: ID_TRAJET,
  originLat: 48.88,
  originLng: 2.355,
  destinationLat: 48.853,
  destinationLng: 2.369,
  requestedAt: "2026-08-25T09:30:00.000Z",
  totalDurationMin: 24,
  totalDistanceM: 4300,
  ecoScore: 82.4,
  carbonEstimate: 310,
  userId: PROFIL.id,
  segments: [
    {
      id: "seg-1",
      mode: "METRO",
      operator: "RATP",
      departureTime: "2026-08-25T09:30:00.000Z",
      arrivalTime: "2026-08-25T09:39:00.000Z",
      distanceM: 1500,
      line: "4",
      gtfsTripId: null,
      routeId: ID_TRAJET,
      fromStopId: GARE,
      toStopId: CHATELET,
    },
    {
      id: "seg-2",
      mode: "WALK",
      operator: "—",
      departureTime: "2026-08-25T09:39:00.000Z",
      arrivalTime: "2026-08-25T09:54:00.000Z",
      distanceM: 2800,
      line: "À pied",
      gtfsTripId: null,
      routeId: ID_TRAJET,
      fromStopId: CHATELET,
      toStopId: BASTILLE,
    },
  ],
  carbonRecords: [
    // Distance décroissante : la MARCHE vient en premier, alors qu'elle est
    // la SECONDE étape.
    {
      id: "carb-1",
      date: "2026-08-25T09:30:00.000Z",
      co2Grams: 0,
      mode: "WALK",
      distanceM: 2800,
      savedVsCarGrams: 610,
      userId: PROFIL.id,
      routeId: ID_TRAJET,
    },
    {
      id: "carb-2",
      date: "2026-08-25T09:30:00.000Z",
      co2Grams: 6,
      mode: "METRO",
      distanceM: 1500,
      savedVsCarGrams: 321,
      userId: PROFIL.id,
      routeId: ID_TRAJET,
    },
  ],
};

const rendre = () =>
  render(
    <AuthProvider>
      <DetailTrajetPage />
    </AuthProvider>,
  );

const authentifier = () => {
  window.localStorage.setItem("urbanflow.token", "jeton-valide");
  vi.mocked(utilisateurCourant).mockResolvedValue(PROFIL);
};

describe("/historique/[id]", () => {
  beforeEach(() => {
    remplacer.mockReset();
    vi.mocked(utilisateurCourant).mockReset();
    vi.mocked(detailTrajet).mockReset();
    vi.mocked(listerArrets).mockReset();
    vi.mocked(listerArrets).mockResolvedValue(ARRETS);
  });

  // ---------------------------------------------------------------------------
  // Protection et chargement
  // ---------------------------------------------------------------------------
  describe("protection", () => {
    it("redirige un visiteur vers /connexion", async () => {
      rendre();

      await waitFor(() => expect(remplacer).toHaveBeenCalledWith("/connexion"));
      expect(detailTrajet).not.toHaveBeenCalled();
    });

    it("affiche le trajet à un usager authentifié", async () => {
      authentifier();
      vi.mocked(detailTrajet).mockResolvedValue(TRAJET);

      rendre();

      expect(
        await screen.findByRole("heading", {
          name: /gare du nord → bastille/i,
          level: 1,
        }),
      ).toBeDefined();
    });
  });

  describe("chargement", () => {
    beforeEach(() => {
      authentifier();
    });

    it("affiche un indicateur pendant le chargement", async () => {
      vi.mocked(detailTrajet).mockReturnValue(new Promise(() => {}));

      rendre();

      expect(await screen.findByText(/chargement du trajet/i)).toBeDefined();
    });

    it("appelle GET /api/routes/:id avec l'identifiant de l'URL", async () => {
      vi.mocked(detailTrajet).mockResolvedValue(TRAJET);

      rendre();

      // L'identifiant vient de `params`, qui est une PROMESSE dans cette
      // version de Next.js.
      await waitFor(() => expect(detailTrajet).toHaveBeenCalledWith("jeton-valide", ID_TRAJET));
    });
  });

  // ---------------------------------------------------------------------------
  // Informations générales
  // ---------------------------------------------------------------------------
  describe("informations générales", () => {
    beforeEach(() => {
      authentifier();
      vi.mocked(detailTrajet).mockResolvedValue(TRAJET);
    });

    it("affiche les totaux du trajet", async () => {
      rendre();

      expect(await screen.findByText("24 min")).toBeDefined();
      // 4300 m → « 4,3 km » ; 310 g ; éco-score arrondi.
      expect(screen.getByText("4,3 km")).toBeDefined();
      expect(screen.getByText("310 g")).toBeDefined();
      expect(screen.getByText("82/100")).toBeDefined();
    });

    it("nomme le départ et l'arrivée d'après les SEGMENTS", async () => {
      rendre();

      // `Route` ne stocke que des coordonnées ; les noms viennent du premier
      // et du dernier segment, résolus via GET /api/stops.
      expect(
        await screen.findByRole("heading", { name: /gare du nord → bastille/i }),
      ).toBeDefined();
    });

    it("reste lisible si le référentiel des arrêts est indisponible", async () => {
      vi.mocked(listerArrets).mockRejectedValue(new NetworkError("Le serveur est injoignable."));

      rendre();

      // Le trajet s'affiche quand même : seuls les NOMS manquent.
      expect(await screen.findByText("24 min")).toBeDefined();
      expect(screen.getByRole("heading", { name: /trajet enregistré/i, level: 1 })).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Segments
  // ---------------------------------------------------------------------------
  describe("étapes", () => {
    beforeEach(() => {
      authentifier();
      vi.mocked(detailTrajet).mockResolvedValue(TRAJET);
    });

    it("affiche les étapes DANS L'ORDRE du trajet", async () => {
      rendre();

      await screen.findByText("Gare du Nord → Châtelet");
      const etapes = screen.getAllByRole("listitem");

      // Le backend les rend triées par `departureTime` : on les affiche
      // telles quelles, dans une liste ORDONNÉE.
      expect(etapes[0].textContent).toContain("Gare du Nord → Châtelet");
      expect(etapes[1].textContent).toContain("Châtelet → Bastille");
    });

    it("affiche mode, ligne, opérateur et distance de chaque étape", async () => {
      rendre();

      // « Métro 4 · RATP », pas « METRO ».
      expect(await screen.findByText(/Métro 4 · RATP/)).toBeDefined();
      expect(screen.getByText(/Marche À pied/)).toBeDefined();
    });

    it("affiche les horaires estimés", async () => {
      rendre();

      await screen.findByText("Gare du Nord → Châtelet");
      const etapes = screen.getAllByRole("listitem");

      // L'HEURE AFFICHÉE EST LOCALE — « 09:30 » en UTC devient « 11:30 » à
      // Paris l'été, et c'est le comportement voulu : un voyageur lit l'heure
      // de son fuseau. On vérifie donc les attributs `datetime`, qui portent
      // l'instant EXACT en ISO, plutôt qu'un texte qui dépendrait de la
      // machine exécutant les tests.
      const horaires = etapes[0].querySelectorAll("time");
      expect(horaires).toHaveLength(2);
      expect(horaires[0].getAttribute("datetime")).toBe("2026-08-25T09:30:00.000Z");
      expect(horaires[1].getAttribute("datetime")).toBe("2026-08-25T09:39:00.000Z");
      // Et un horaire lisible est bien rendu, quel qu'il soit.
      expect(horaires[0].textContent).toMatch(/^\d{2}:\d{2}$/);
    });
  });

  // ---------------------------------------------------------------------------
  // Empreinte carbone — la précaution centrale
  // ---------------------------------------------------------------------------
  describe("empreinte carbone", () => {
    beforeEach(() => {
      authentifier();
      vi.mocked(detailTrajet).mockResolvedValue(TRAJET);
    });

    it("présente les enregistrements dans une section SÉPARÉE", async () => {
      rendre();

      expect(
        await screen.findByRole("heading", {
          name: /répartition de l'empreinte carbone/i,
        }),
      ).toBeDefined();
    });

    it("dit explicitement qu'ils ne correspondent pas aux étapes", async () => {
      rendre();

      // L'usager doit savoir que ces lignes ne se lisent pas en regard des
      // étapes : c'est une répartition par MODE.
      expect(await screen.findByText(/ne correspondent pas un à un aux étapes/i)).toBeDefined();
    });

    it("n'aligne JAMAIS un enregistrement sur une étape", async () => {
      rendre();

      const tableau = await screen.findByRole("table");
      const lignes = within(tableau).getAllByRole("row").slice(1);

      // Les segments sont [MÉTRO, MARCHE] ; les carbonRecords, triés par
      // distance décroissante, sont [MARCHE, MÉTRO]. Le tableau suit l'ordre
      // du BACKEND, jamais celui des étapes — les aligner attribuerait le CO₂
      // du métro à la marche.
      expect(lignes[0].textContent).toContain("Marche");
      expect(lignes[0].textContent).toContain("2,8 km");
      expect(lignes[1].textContent).toContain("Métro");
      expect(lignes[1].textContent).toContain("1,5 km");
    });

    it("affiche les valeurs de l'API sans les recalculer", async () => {
      rendre();

      const tableau = await screen.findByRole("table");

      // 0 g pour la marche — une valeur légitime, pas une absence.
      expect(within(tableau).getByText("0 g")).toBeDefined();
      expect(within(tableau).getByText("6 g")).toBeDefined();
      expect(within(tableau).getByText("610 g")).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Erreurs
  // ---------------------------------------------------------------------------
  describe("erreurs", () => {
    beforeEach(() => {
      authentifier();
    });

    it("annonce un trajet introuvable sur un 404", async () => {
      vi.mocked(detailTrajet).mockRejectedValue(new ApiError(404, "Itinéraire introuvable"));

      rendre();

      expect(await screen.findByText(/trajet introuvable/i)).toBeDefined();
    });

    it("ne révèle JAMAIS qu'un trajet appartient à quelqu'un d'autre", async () => {
      // Le backend répond 404 aussi bien pour un trajet inexistant que pour
      // celui d'un autre usager — dire la différence révélerait son existence.
      vi.mocked(detailTrajet).mockRejectedValue(new ApiError(404, "Itinéraire introuvable"));

      rendre();

      await screen.findByText(/trajet introuvable/i);
      const page = document.body.textContent ?? "";
      expect(page).not.toMatch(/autre utilisateur|appartient|interdit|403/i);
    });

    it("signale une panne réseau", async () => {
      vi.mocked(detailTrajet).mockRejectedValue(new NetworkError("Le serveur est injoignable."));

      rendre();

      const alerte = await screen.findByRole("alert");
      expect(alerte.textContent).toContain("injoignable");
    });

    it("signale une erreur serveur", async () => {
      vi.mocked(detailTrajet).mockRejectedValue(new ApiError(500, "Erreur interne"));

      rendre();

      const alerte = await screen.findByRole("alert");
      expect(alerte.textContent).toContain("Erreur interne");
    });

    it("propose toujours le retour à l'historique", async () => {
      vi.mocked(detailTrajet).mockRejectedValue(new ApiError(404, "Introuvable"));

      rendre();

      await screen.findByText(/trajet introuvable/i);
      expect(screen.getAllByRole("link", { name: /historique/i }).length).toBeGreaterThan(0);
    });
  });
});
