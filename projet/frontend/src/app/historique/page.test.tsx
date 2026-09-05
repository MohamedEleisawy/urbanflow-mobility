import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HistoriquePage from "./page";
import { AuthProvider } from "@/components/AuthProvider";
import { ApiError, NetworkError } from "@/lib/api";
import type { PaginatedRoutes, RouteHistoryItem, User } from "@/lib/types";

// Le VRAI AuthProvider et le VRAI localStorage : c'est lui qui décide de
// l'accès. Seul le réseau est simulé.
const remplacer = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: remplacer, push: vi.fn() }),
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

const { utilisateurCourant } = await import("@/lib/auth-api");
const { historiqueTrajets } = await import("@/lib/espace-api");

const PROFIL: User = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "usager@exemple.fr",
  role: "USER",
  createdAt: "2026-08-01T10:00:00.000Z",
  deletedAt: null,
  preferences: null,
};

const trajet = (id: string, surcharge: Partial<RouteHistoryItem> = {}): RouteHistoryItem => ({
  id,
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
  mode: null,
  ...surcharge,
});

/// 12 trajets au total, 10 par page → deux pages.
const PAGE_1: PaginatedRoutes = {
  items: [
    trajet("aaaaaaaa-0000-0000-0000-000000000001"),
    trajet("aaaaaaaa-0000-0000-0000-000000000002", {
      requestedAt: "2026-08-24T08:00:00.000Z",
      totalDistanceM: 8200,
    }),
  ],
  page: 1,
  limit: 10,
  total: 12,
};

const PAGE_2: PaginatedRoutes = {
  items: [
    trajet("bbbbbbbb-0000-0000-0000-000000000003", {
      requestedAt: "2026-08-10T07:15:00.000Z",
    }),
  ],
  page: 2,
  limit: 10,
  total: 12,
};

const rendre = () =>
  render(
    <AuthProvider>
      <HistoriquePage />
    </AuthProvider>,
  );

const authentifier = () => {
  window.localStorage.setItem("urbanflow.token", "jeton-valide");
  vi.mocked(utilisateurCourant).mockResolvedValue(PROFIL);
};

describe("/historique", () => {
  beforeEach(() => {
    remplacer.mockReset();
    vi.mocked(utilisateurCourant).mockReset();
    vi.mocked(historiqueTrajets).mockReset();
  });

  // ---------------------------------------------------------------------------
  // Protection
  // ---------------------------------------------------------------------------
  describe("protection", () => {
    it("redirige un visiteur vers /connexion", async () => {
      rendre();

      await waitFor(() => expect(remplacer).toHaveBeenCalledWith("/connexion"));
    });

    it("n'appelle AUCUNE API sans authentification", async () => {
      rendre();

      await waitFor(() => expect(remplacer).toHaveBeenCalled());
      expect(historiqueTrajets).not.toHaveBeenCalled();
    });

    it("affiche la page à un usager authentifié", async () => {
      authentifier();
      vi.mocked(historiqueTrajets).mockResolvedValue(PAGE_1);

      rendre();

      expect(
        await screen.findByRole("heading", { name: /mon historique/i, level: 1 }),
      ).toBeDefined();
      expect(remplacer).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Chargement et contenu
  // ---------------------------------------------------------------------------
  describe("liste", () => {
    beforeEach(() => {
      authentifier();
    });

    it("affiche un indicateur pendant le chargement", async () => {
      vi.mocked(historiqueTrajets).mockReturnValue(new Promise(() => {}));

      rendre();

      expect(await screen.findByText(/chargement de votre historique/i)).toBeDefined();
    });

    it("demande la PREMIÈRE page au chargement", async () => {
      vi.mocked(historiqueTrajets).mockResolvedValue(PAGE_1);

      rendre();

      // 10 par page, page 1 : la numérotation du backend est HUMAINE.
      await waitFor(() => expect(historiqueTrajets).toHaveBeenCalledWith("jeton-valide", 10, 1));
    });

    it("liste les trajets avec leurs valeurs mises en forme", async () => {
      vi.mocked(historiqueTrajets).mockResolvedValue(PAGE_1);

      rendre();

      expect(await screen.findByText("25 août 2026")).toBeDefined();
      // 4300 m → « 4,3 km » ; 8200 m → « 8,2 km ».
      expect(screen.getByText(/4,3 km/)).toBeDefined();
      expect(screen.getByText(/8,2 km/)).toBeDefined();
    });

    it("propose un lien vers le détail de CHAQUE trajet", async () => {
      vi.mocked(historiqueTrajets).mockResolvedValue(PAGE_1);

      rendre();

      const liens = await screen.findAllByRole("link", {
        name: /voir le détail/i,
      });
      expect(liens).toHaveLength(2);
      expect(liens[0].getAttribute("href")).toBe(
        "/historique/aaaaaaaa-0000-0000-0000-000000000001",
      );
    });

    it("invite à chercher un itinéraire quand l'historique est vide", async () => {
      vi.mocked(historiqueTrajets).mockResolvedValue({
        items: [],
        page: 1,
        limit: 10,
        total: 0,
      });

      rendre();

      expect(await screen.findByText(/aucun trajet enregistré/i)).toBeDefined();
      // Un état vide utile propose l'action qui le remplira.
      expect(screen.getByRole("link", { name: /rechercher un itinéraire/i })).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Pagination
  // ---------------------------------------------------------------------------
  describe("pagination", () => {
    beforeEach(() => {
      authentifier();
    });

    it("annonce la page courante et le nombre de pages", async () => {
      vi.mocked(historiqueTrajets).mockResolvedValue(PAGE_1);

      rendre();

      // 12 trajets, 10 par page → 2 pages. Le nombre est DÉDUIT de `total` et
      // `limit`, jamais stocké.
      expect(await screen.findByText(/page 1 sur 2/i)).toBeDefined();
    });

    it("désactive « Précédent » sur la première page", async () => {
      vi.mocked(historiqueTrajets).mockResolvedValue(PAGE_1);

      rendre();

      const precedent = await screen.findByRole("button", { name: /précédent/i });
      expect(precedent.hasAttribute("disabled")).toBe(true);
    });

    it("charge la page suivante au clic", async () => {
      vi.mocked(historiqueTrajets).mockResolvedValueOnce(PAGE_1).mockResolvedValueOnce(PAGE_2);
      rendre();
      await screen.findByText(/page 1 sur 2/i);

      await userEvent.click(screen.getByRole("button", { name: /suivant/i }));

      await waitFor(() =>
        expect(historiqueTrajets).toHaveBeenLastCalledWith("jeton-valide", 10, 2),
      );
      expect(await screen.findByText(/page 2 sur 2/i)).toBeDefined();
    });

    it("désactive « Suivant » sur la dernière page", async () => {
      vi.mocked(historiqueTrajets).mockResolvedValue(PAGE_2);

      rendre();

      const suivant = await screen.findByRole("button", { name: /suivant/i });
      expect(suivant.hasAttribute("disabled")).toBe(true);
    });

    it("revient à la page précédente", async () => {
      vi.mocked(historiqueTrajets).mockResolvedValueOnce(PAGE_2).mockResolvedValueOnce(PAGE_1);
      rendre();
      await screen.findByText(/page 2 sur 2/i);

      await userEvent.click(screen.getByRole("button", { name: /précédent/i }));

      await waitFor(() =>
        expect(historiqueTrajets).toHaveBeenLastCalledWith("jeton-valide", 10, 1),
      );
    });

    it("n'affiche AUCUNE pagination quand tout tient sur une page", async () => {
      vi.mocked(historiqueTrajets).mockResolvedValue({
        items: [trajet("cccccccc-0000-0000-0000-000000000004")],
        page: 1,
        limit: 10,
        total: 1,
      });

      rendre();

      await screen.findByText("25 août 2026");
      // Deux boutons tous deux désactivés n'apprendraient rien à personne.
      expect(screen.queryByRole("button", { name: /suivant/i })).toBeNull();
    });

    it("ne relance AUCUN appel tant que la page ne change pas", async () => {
      vi.mocked(historiqueTrajets).mockResolvedValue(PAGE_1);

      rendre();
      await screen.findByText(/page 1 sur 2/i);

      // Un seul appel : l'effet ne dépend que du jeton et de la page.
      expect(historiqueTrajets).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Erreurs
  // ---------------------------------------------------------------------------
  describe("erreurs", () => {
    beforeEach(() => {
      authentifier();
    });

    it("signale une panne réseau", async () => {
      vi.mocked(historiqueTrajets).mockRejectedValue(
        new NetworkError("Le serveur est injoignable."),
      );

      rendre();

      const alerte = await screen.findByRole("alert");
      expect(alerte.textContent).toContain("injoignable");
    });

    it("signale une session expirée (401)", async () => {
      vi.mocked(historiqueTrajets).mockRejectedValue(new ApiError(401, "Token invalide ou expiré"));

      rendre();

      const alerte = await screen.findByRole("alert");
      expect(alerte.textContent).toContain("expiré");
    });

    it("signale une erreur serveur", async () => {
      vi.mocked(historiqueTrajets).mockRejectedValue(new ApiError(500, "Erreur interne"));

      rendre();

      const alerte = await screen.findByRole("alert");
      expect(alerte.textContent).toContain("Erreur interne");
    });

    it("n'affiche PAS une liste périmée sous le message d'erreur", async () => {
      vi.mocked(historiqueTrajets)
        .mockResolvedValueOnce(PAGE_1)
        .mockRejectedValueOnce(new ApiError(500, "Panne"));
      rendre();
      await screen.findByText(/page 1 sur 2/i);

      await userEvent.click(screen.getByRole("button", { name: /suivant/i }));

      await screen.findByRole("alert");
      // Les laisser afficherait une liste qui ne correspond pas à la page
      // demandée.
      expect(screen.queryByText("25 août 2026")).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Accessibilité
  // ---------------------------------------------------------------------------
  describe("accessibilité", () => {
    beforeEach(() => {
      authentifier();
    });

    it("structure les trajets en liste", async () => {
      vi.mocked(historiqueTrajets).mockResolvedValue(PAGE_1);

      rendre();

      await screen.findByText("25 août 2026");
      const liste = screen.getAllByRole("list")[0];
      expect(within(liste).getAllByRole("listitem")).toHaveLength(2);
    });

    it("nomme la navigation entre les pages", async () => {
      vi.mocked(historiqueTrajets).mockResolvedValue(PAGE_1);

      rendre();

      // `aria-label` distingue cette navigation de celle de l'en-tête pour
      // qui liste les repères de la page.
      expect(
        await screen.findByRole("navigation", { name: /pages de l'historique/i }),
      ).toBeDefined();
    });
  });
});
