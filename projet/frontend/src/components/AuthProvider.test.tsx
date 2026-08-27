import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthProvider";
import { ApiError, NetworkError } from "@/lib/api";
import { lireJeton } from "@/lib/auth-storage";
import type { LoginResponse, User } from "@/lib/types";

// Seule la COUCHE RÉSEAU est simulée. Le stockage du jeton, lui, est le vrai
// `localStorage` fourni par jsdom : c'est précisément ce qu'on veut vérifier,
// et le simuler reviendrait à tester une simulation.
vi.mock("@/lib/auth-api", () => ({
  inscrire: vi.fn(),
  connecter: vi.fn(),
  utilisateurCourant: vi.fn(),
}));

const { inscrire, connecter, utilisateurCourant } = await import("@/lib/auth-api");

const PROFIL: User = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "usager@exemple.fr",
  role: "USER",
  createdAt: "2026-08-01T10:00:00.000Z",
  deletedAt: null,
  preferences: null,
};

const REPONSE_LOGIN: LoginResponse = {
  accessToken: "jeton-de-test",
  user: { id: PROFIL.id, email: PROFIL.email, role: PROFIL.role },
};

/// Sonde : affiche l'état du contexte et expose ses actions.
///
/// Les rejets sont AVALÉS ici, et il faut dire pourquoi : dans
/// l'application, c'est `AuthForm` qui les attrape pour les afficher. Cette
/// sonde n'a pas d'affichage d'erreur ; sans ce `catch`, un test qui vérifie
/// justement l'échec produirait un rejet non intercepté et brouillerait la
/// sortie des tests suivants. Ce que le test vérifie reste l'ÉTAT résultant,
/// pas le message — celui-ci est couvert par AuthForm.test.tsx.
const ignorerEchec = (promesse: Promise<void>) => {
  promesse.catch(() => {});
};
function Sonde() {
  const { statut, utilisateur, connexion, inscription, deconnexion } = useAuth();

  return (
    <div>
      <p data-testid="statut">{statut}</p>
      <p data-testid="email">{utilisateur?.email ?? "—"}</p>
      <button onClick={() => ignorerEchec(connexion("usager@exemple.fr", "motdepasse"))}>
        connexion
      </button>
      <button onClick={() => ignorerEchec(inscription("usager@exemple.fr", "motdepasse"))}>
        inscription
      </button>
      <button onClick={deconnexion}>deconnexion</button>
    </div>
  );
}

const rendre = () =>
  render(
    <AuthProvider>
      <Sonde />
    </AuthProvider>,
  );

const statut = () => screen.getByTestId("statut").textContent;

describe("AuthProvider", () => {
  beforeEach(() => {
    vi.mocked(inscrire).mockReset();
    vi.mocked(connecter).mockReset();
    vi.mocked(utilisateurCourant).mockReset();
  });

  // ---------------------------------------------------------------------------
  // Sans jeton
  // ---------------------------------------------------------------------------
  describe("aucun jeton stocké", () => {
    it("se déclare anonyme", async () => {
      rendre();

      await waitFor(() => expect(statut()).toBe("anonyme"));
    });

    it("n'interroge PAS le backend", async () => {
      rendre();

      await waitFor(() => expect(statut()).toBe("anonyme"));
      // Rien à vérifier sans jeton : une requête serait du gaspillage, et
      // renverrait de toute façon 401.
      expect(utilisateurCourant).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Restauration d'une session existante
  // ---------------------------------------------------------------------------
  describe("jeton déjà stocké", () => {
    beforeEach(() => {
      window.localStorage.setItem("urbanflow.token", "jeton-existant");
    });

    it("relit le profil auprès de /api/users/me", async () => {
      vi.mocked(utilisateurCourant).mockResolvedValue(PROFIL);

      rendre();

      await waitFor(() => expect(statut()).toBe("authentifie"));
      // Le jeton stocké ne suffit pas : il expire au bout d'une heure, et
      // seul le backend peut dire s'il vaut encore quelque chose.
      expect(utilisateurCourant).toHaveBeenCalledWith("jeton-existant");
      expect(screen.getByTestId("email").textContent).toBe(PROFIL.email);
    });

    it("efface un jeton refusé en 401", async () => {
      vi.mocked(utilisateurCourant).mockRejectedValue(
        new ApiError(401, "Token invalide ou expiré"),
      );

      rendre();

      await waitFor(() => expect(statut()).toBe("anonyme"));
      // Un jeton que le backend refuse ne resservira jamais : le garder
      // relancerait la même requête vouée à l'échec à chaque page.
      expect(lireJeton()).toBeNull();
    });

    it("CONSERVE le jeton si le backend est injoignable", async () => {
      vi.mocked(utilisateurCourant).mockRejectedValue(
        new NetworkError("Le serveur est injoignable."),
      );

      rendre();

      await waitFor(() => expect(statut()).toBe("anonyme"));
      // Une panne de serveur n'est pas la faute de l'usager : effacer son
      // jeton l'obligerait à se reconnecter pour une coupure passagère.
      expect(lireJeton()).toBe("jeton-existant");
    });
  });

  // ---------------------------------------------------------------------------
  // Connexion
  // ---------------------------------------------------------------------------
  describe("connexion", () => {
    it("stocke le jeton et passe authentifié", async () => {
      vi.mocked(connecter).mockResolvedValue(REPONSE_LOGIN);
      vi.mocked(utilisateurCourant).mockResolvedValue(PROFIL);
      rendre();
      await waitFor(() => expect(statut()).toBe("anonyme"));

      await userEvent.click(screen.getByRole("button", { name: "connexion" }));

      await waitFor(() => expect(statut()).toBe("authentifie"));
      expect(lireJeton()).toBe("jeton-de-test");
      expect(screen.getByTestId("email").textContent).toBe(PROFIL.email);
    });

    it("relit le profil complet plutôt que de croire la réponse de login", async () => {
      vi.mocked(connecter).mockResolvedValue(REPONSE_LOGIN);
      vi.mocked(utilisateurCourant).mockResolvedValue(PROFIL);
      rendre();
      await waitFor(() => expect(statut()).toBe("anonyme"));

      await userEvent.click(screen.getByRole("button", { name: "connexion" }));

      // La réponse de login ne porte ni préférences ni date de création : un
      // seul chemin alimente l'état, ici comme au rechargement.
      await waitFor(() => expect(utilisateurCourant).toHaveBeenCalledWith("jeton-de-test"));
    });

    it("ne stocke AUCUN jeton si la connexion échoue", async () => {
      vi.mocked(connecter).mockRejectedValue(new ApiError(401, "Email ou mot de passe incorrect"));
      rendre();
      await waitFor(() => expect(statut()).toBe("anonyme"));

      await userEvent.click(screen.getByRole("button", { name: "connexion" }));

      await waitFor(() => expect(connecter).toHaveBeenCalled());
      expect(lireJeton()).toBeNull();
      expect(statut()).toBe("anonyme");
    });
  });

  // ---------------------------------------------------------------------------
  // Inscription
  // ---------------------------------------------------------------------------
  describe("inscription", () => {
    it("crée le compte PUIS ouvre la session", async () => {
      vi.mocked(inscrire).mockResolvedValue(PROFIL);
      vi.mocked(connecter).mockResolvedValue(REPONSE_LOGIN);
      vi.mocked(utilisateurCourant).mockResolvedValue(PROFIL);
      rendre();
      await waitFor(() => expect(statut()).toBe("anonyme"));

      await userEvent.click(screen.getByRole("button", { name: "inscription" }));

      // Personne ne souhaite ressaisir ce qu'il vient de taper : la création
      // enchaîne sur la connexion.
      await waitFor(() => expect(statut()).toBe("authentifie"));
      expect(inscrire).toHaveBeenCalledWith({
        email: "usager@exemple.fr",
        password: "motdepasse",
      });
      expect(lireJeton()).toBe("jeton-de-test");
    });

    it("ne connecte PAS si la création échoue", async () => {
      vi.mocked(inscrire).mockRejectedValue(
        new ApiError(409, "Un utilisateur avec cet email existe déjà"),
      );
      rendre();
      await waitFor(() => expect(statut()).toBe("anonyme"));

      await userEvent.click(screen.getByRole("button", { name: "inscription" }));

      await waitFor(() => expect(inscrire).toHaveBeenCalled());
      expect(connecter).not.toHaveBeenCalled();
      expect(lireJeton()).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Déconnexion
  // ---------------------------------------------------------------------------
  describe("déconnexion", () => {
    it("efface le jeton et redevient anonyme", async () => {
      window.localStorage.setItem("urbanflow.token", "jeton-existant");
      vi.mocked(utilisateurCourant).mockResolvedValue(PROFIL);
      rendre();
      await waitFor(() => expect(statut()).toBe("authentifie"));

      await userEvent.click(screen.getByRole("button", { name: "deconnexion" }));

      await waitFor(() => expect(statut()).toBe("anonyme"));
      expect(lireJeton()).toBeNull();
      expect(screen.getByTestId("email").textContent).toBe("—");
    });
  });

  // ---------------------------------------------------------------------------
  // Garde-fou
  // ---------------------------------------------------------------------------
  it("refuse d'être utilisé hors du provider", () => {
    // Une erreur explicite au premier rendu vaut mieux qu'un `utilisateur`
    // éternellement nul qu'on passerait des heures à expliquer.
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => render(<Sonde />)).toThrow(/AuthProvider/);

    silence.mockRestore();
  });
});
