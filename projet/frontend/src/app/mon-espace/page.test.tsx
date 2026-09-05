import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MonEspacePage from "./page";
import { AuthProvider } from "@/components/AuthProvider";
import { ApiError, NetworkError } from "@/lib/api";
import { lireJeton } from "@/lib/auth-storage";
import type { PaginatedRoutes, User, WeeklyCarbonBudget, WeeklyCarbonTracking } from "@/lib/types";
import { LangueProvider } from "@/components/LangueProvider";

// Le VRAI AuthProvider est utilisé, avec le VRAI localStorage de jsdom : c'est
// lui qui décide de l'accès, et le simuler reviendrait à tester une
// simulation. Seul le RÉSEAU est remplacé.
const remplacer = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: remplacer, push: vi.fn() }),
}));

vi.mock("@/lib/auth-api", () => ({
  inscrire: vi.fn(),
  connecter: vi.fn(),
  utilisateurCourant: vi.fn(),
}));

// Bloc 7 : la section « Mes adresses favorites » vit dans cette page. Le
// module est simulé pour qu'aucun appel réseau réel ne parte d'un test.
vi.mock("@/lib/adresses-api", () => ({
  listerAdresses: vi.fn().mockResolvedValue([]),
  creerAdresse: vi.fn(),
  modifierAdresse: vi.fn(),
  supprimerAdresse: vi.fn(),
}));

vi.mock("@/lib/espace-api", () => ({
  suiviCarbone: vi.fn(),
  budgetHebdomadaire: vi.fn(),
  historiqueTrajets: vi.fn(),
}));

const { utilisateurCourant } = await import("@/lib/auth-api");
const { suiviCarbone, budgetHebdomadaire, historiqueTrajets } = await import("@/lib/espace-api");

const PROFIL: User = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "usager@exemple.fr",
  role: "USER",
  createdAt: "2026-08-01T10:00:00.000Z",
  deletedAt: null,
  preferences: null,
};

const SUIVI: WeeklyCarbonTracking = {
  weeks: [
    {
      year: 2026,
      week: 35,
      co2Grams: 1450,
      savedVsCarGrams: 3200,
      tripCount: 3,
    },
    { year: 2026, week: 34, co2Grams: 820, savedVsCarGrams: 1900, tripCount: 2 },
  ],
  weeksRequested: 4,
};

const BUDGET: WeeklyCarbonBudget = {
  year: 2026,
  week: 35,
  weeklyBudgetGrams: 5000,
  consumedGrams: 1450,
  remainingGrams: 3550,
  exceeded: false,
  tripCount: 3,
};

const TRAJETS: PaginatedRoutes = {
  items: [
    {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      originLat: 48.85,
      originLng: 2.35,
      destinationLat: 48.87,
      destinationLng: 2.33,
      requestedAt: "2026-08-25T09:30:00.000Z",
      totalDurationMin: 24,
      totalDistanceM: 4300,
      ecoScore: 82.4,
      carbonEstimate: 310,
      userId: PROFIL.id,
      mode: null,
    },
  ],
  page: 1,
  limit: 5,
  total: 12,
};

const rendre = () =>
  render(
    <AuthProvider>
      <LangueProvider>
        <MonEspacePage />
      </LangueProvider>
    </AuthProvider>,
  );

/// Place un jeton et fait répondre /me : l'usager est authentifié.
const authentifier = () => {
  window.localStorage.setItem("urbanflow.token", "jeton-valide");
  vi.mocked(utilisateurCourant).mockResolvedValue(PROFIL);
};

const donneesCompletes = () => {
  vi.mocked(suiviCarbone).mockResolvedValue(SUIVI);
  vi.mocked(budgetHebdomadaire).mockResolvedValue(BUDGET);
  vi.mocked(historiqueTrajets).mockResolvedValue(TRAJETS);
};

describe("/mon-espace", () => {
  beforeEach(() => {
    remplacer.mockReset();
    vi.mocked(utilisateurCourant).mockReset();
    vi.mocked(suiviCarbone).mockReset();
    vi.mocked(budgetHebdomadaire).mockReset();
    vi.mocked(historiqueTrajets).mockReset();
  });

  // ---------------------------------------------------------------------------
  // Protection
  // ---------------------------------------------------------------------------
  describe("protection de la route", () => {
    it("redirige un visiteur non authentifié vers /connexion", async () => {
      rendre();

      await waitFor(() => expect(remplacer).toHaveBeenCalledWith("/connexion"));
    });

    it("n'appelle AUCUNE API sans authentification", async () => {
      rendre();

      await waitFor(() => expect(remplacer).toHaveBeenCalled());
      // Inutile de déranger le backend : il répondrait 401 de toute façon.
      expect(suiviCarbone).not.toHaveBeenCalled();
      expect(historiqueTrajets).not.toHaveBeenCalled();
    });

    it("affiche l'espace à un usager authentifié", async () => {
      authentifier();
      donneesCompletes();

      rendre();

      expect(await screen.findByRole("heading", { name: /mon espace/i, level: 1 })).toBeDefined();
      expect(remplacer).not.toHaveBeenCalled();
    });

    it("attend la vérification du jeton avant de trancher", async () => {
      // Jeton présent, backend qui n'a pas encore répondu : on ne sait pas
      // encore. Rediriger maintenant serait faux une fois sur deux.
      window.localStorage.setItem("urbanflow.token", "jeton-valide");
      vi.mocked(utilisateurCourant).mockReturnValue(new Promise(() => {}));

      rendre();

      expect(await screen.findByText(/vérification de votre session/i)).toBeDefined();
      expect(remplacer).not.toHaveBeenCalled();
    });

    it("redirige si le jeton stocké est refusé", async () => {
      window.localStorage.setItem("urbanflow.token", "jeton-perime");
      vi.mocked(utilisateurCourant).mockRejectedValue(
        new ApiError(401, "Token invalide ou expiré"),
      );

      rendre();

      await waitFor(() => expect(remplacer).toHaveBeenCalledWith("/connexion"));
      expect(lireJeton()).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Profil
  // ---------------------------------------------------------------------------
  describe("profil", () => {
    it("affiche l'email et le rôle", async () => {
      authentifier();
      donneesCompletes();

      rendre();

      expect(await screen.findByText("usager@exemple.fr")).toBeDefined();
      // Le modèle User ne porte ni prénom ni nom : l'email est la seule
      // identité disponible.
      expect(screen.getByText("Usager")).toBeDefined();
    });

    it("traduit le rôle ADMIN", async () => {
      window.localStorage.setItem("urbanflow.token", "jeton-valide");
      vi.mocked(utilisateurCourant).mockResolvedValue({
        ...PROFIL,
        role: "ADMIN",
      });
      donneesCompletes();

      rendre();

      expect(await screen.findByText("Administrateur")).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Chargement des données
  // ---------------------------------------------------------------------------
  describe("chargement", () => {
    it("affiche un indicateur pendant le chargement des données", async () => {
      authentifier();
      vi.mocked(suiviCarbone).mockReturnValue(new Promise(() => {}));
      vi.mocked(budgetHebdomadaire).mockReturnValue(new Promise(() => {}));
      vi.mocked(historiqueTrajets).mockReturnValue(new Promise(() => {}));

      rendre();

      expect(await screen.findByText(/chargement de vos données/i)).toBeDefined();
    });

    it("demande la fenêtre et la pagination attendues", async () => {
      authentifier();
      donneesCompletes();

      rendre();

      await screen.findByText("usager@exemple.fr");
      await waitFor(() => {
        expect(suiviCarbone).toHaveBeenCalledWith("jeton-valide", 4);
        expect(historiqueTrajets).toHaveBeenCalledWith("jeton-valide", 5);
      });
    });

    it("ne redemande PAS le profil : il vient du contexte", async () => {
      authentifier();
      donneesCompletes();

      rendre();

      await screen.findByText("usager@exemple.fr");
      // Un seul appel — celui du provider au chargement. La page n'en ajoute
      // pas un quatrième pour une donnée qu'elle a déjà.
      expect(utilisateurCourant).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Budget
  // ---------------------------------------------------------------------------
  describe("budget", () => {
    it("affiche budget, consommation et reste", async () => {
      authentifier();
      donneesCompletes();

      rendre();

      // 5000 g → « 5 kg », 3550 g → « 3,6 kg ».
      expect(await screen.findByText("5 kg")).toBeDefined();
      expect(screen.getByText("Restant")).toBeDefined();
    });

    it("annonce un dépassement par le MOT, pas seulement par la couleur", async () => {
      authentifier();
      vi.mocked(suiviCarbone).mockResolvedValue(SUIVI);
      vi.mocked(historiqueTrajets).mockResolvedValue(TRAJETS);
      vi.mocked(budgetHebdomadaire).mockResolvedValue({
        ...BUDGET,
        consumedGrams: 6200,
        remainingGrams: -1200,
        exceeded: true,
      });

      rendre();

      // La couleur seule ne dit rien à qui ne la voit pas (WCAG 1.4.1).
      expect(await screen.findByText("Dépassement")).toBeDefined();
    });

    it("invite à définir un budget quand il n'y en a pas", async () => {
      authentifier();
      vi.mocked(suiviCarbone).mockResolvedValue(SUIVI);
      vi.mocked(historiqueTrajets).mockResolvedValue(TRAJETS);
      // Les trois champs sont nuls ENSEMBLE quand aucun budget n'est fixé.
      vi.mocked(budgetHebdomadaire).mockResolvedValue({
        ...BUDGET,
        weeklyBudgetGrams: null,
        remainingGrams: null,
        exceeded: null,
      });

      rendre();

      expect(await screen.findByText(/aucun budget défini/i)).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Suivi carbone
  // ---------------------------------------------------------------------------
  describe("suivi carbone", () => {
    it("liste les semaines avec leurs chiffres", async () => {
      authentifier();
      donneesCompletes();

      rendre();

      const tableau = await screen.findByRole("table");
      expect(within(tableau).getByText("S35 2026")).toBeDefined();
      // 1450 g → « 1,5 kg ».
      expect(within(tableau).getByText("1,5 kg")).toBeDefined();
    });

    it("annonce la fenêtre effectivement appliquée", async () => {
      authentifier();
      donneesCompletes();

      rendre();

      // Une réponse bornée doit dire sa borne — la règle de 4E-5A.
      expect(await screen.findByRole("heading", { name: /4 dernières semaines/i })).toBeDefined();
    });

    it("affiche un état vide sans données carbone", async () => {
      authentifier();
      vi.mocked(budgetHebdomadaire).mockResolvedValue(BUDGET);
      vi.mocked(historiqueTrajets).mockResolvedValue(TRAJETS);
      vi.mocked(suiviCarbone).mockResolvedValue({
        weeks: [],
        weeksRequested: 4,
      });

      rendre();

      expect(await screen.findByText(/aucun trajet enregistré sur la période/i)).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Historique
  // ---------------------------------------------------------------------------
  describe("trajets récents", () => {
    it("affiche les trajets avec leurs valeurs mises en forme", async () => {
      authentifier();
      donneesCompletes();

      rendre();

      expect(await screen.findByText("25 août 2026")).toBeDefined();
      // 4300 m → « 4,3 km » ; 24 min ; éco-score arrondi.
      expect(screen.getByText(/4,3 km/)).toBeDefined();
      expect(screen.getByText("82/100")).toBeDefined();
    });

    it("indique combien de trajets sont montrés sur le total", async () => {
      authentifier();
      donneesCompletes();

      rendre();

      expect(await screen.findByText("1 sur 12")).toBeDefined();
    });

    it("propose la recherche quand aucun trajet n'existe", async () => {
      authentifier();
      vi.mocked(suiviCarbone).mockResolvedValue(SUIVI);
      vi.mocked(budgetHebdomadaire).mockResolvedValue(BUDGET);
      vi.mocked(historiqueTrajets).mockResolvedValue({
        items: [],
        page: 1,
        limit: 5,
        total: 0,
      });

      rendre();

      expect(await screen.findByText(/aucun trajet enregistré$/i)).toBeDefined();
      // Un état vide utile propose l'action qui le remplira.
      expect(screen.getByRole("link", { name: /rechercher un itinéraire/i })).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Erreurs
  // ---------------------------------------------------------------------------
  describe("erreurs", () => {
    it("affiche un message si une API échoue", async () => {
      authentifier();
      vi.mocked(suiviCarbone).mockResolvedValue(SUIVI);
      vi.mocked(budgetHebdomadaire).mockResolvedValue(BUDGET);
      vi.mocked(historiqueTrajets).mockRejectedValue(new ApiError(500, "Erreur interne"));

      rendre();

      const alerte = await screen.findByRole("alert");
      expect(alerte.textContent).toContain("Erreur interne");
    });

    it("reste lisible quand le backend est injoignable", async () => {
      authentifier();
      vi.mocked(suiviCarbone).mockRejectedValue(new NetworkError("Le serveur est injoignable."));
      vi.mocked(budgetHebdomadaire).mockResolvedValue(BUDGET);
      vi.mocked(historiqueTrajets).mockResolvedValue(TRAJETS);

      rendre();

      const alerte = await screen.findByRole("alert");
      expect(alerte.textContent).toContain("injoignable");
    });

    it("conserve le profil affiché malgré l'échec des données", async () => {
      authentifier();
      vi.mocked(suiviCarbone).mockRejectedValue(new ApiError(500, "Panne"));
      vi.mocked(budgetHebdomadaire).mockResolvedValue(BUDGET);
      vi.mocked(historiqueTrajets).mockResolvedValue(TRAJETS);

      rendre();

      await screen.findByRole("alert");
      // Le profil vient du contexte, pas de l'appel qui a échoué : il n'y a
      // aucune raison de le faire disparaître.
      expect(screen.getByText("usager@exemple.fr")).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Déconnexion
  // ---------------------------------------------------------------------------
  it("permet de se déconnecter depuis l'espace", async () => {
    authentifier();
    donneesCompletes();
    rendre();
    await screen.findByText("usager@exemple.fr");

    await userEvent.click(screen.getByRole("button", { name: /se déconnecter/i }));

    // Le mécanisme est celui d'AuthProvider — aucune logique dupliquée.
    await waitFor(() => expect(lireJeton()).toBeNull());
    await waitFor(() => expect(remplacer).toHaveBeenCalledWith("/connexion"));
  });
});
