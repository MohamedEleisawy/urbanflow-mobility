import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ReinitialiserPage from "./page";
import { LangueProvider } from "@/components/LangueProvider";
import { AuthProvider } from "@/components/AuthProvider";
import { ApiError } from "@/lib/api";

// =============================================================================
// Ce que ces tests verrouillent
// =============================================================================
//   1. LA CONFIRMATION EST VÉRIFIÉE AVANT TOUT APPEL RÉSEAU. Le backend ne
//      reçoit qu'un mot de passe : il n'a aucun moyen de détecter une faute de
//      frappe, qui enfermerait l'usager dehors.
//   2. AUCUNE SESSION N'EST OUVERTE. Réinitialiser ne doit pas connecter.
//   3. UN LIEN SANS JETON EST TRAITÉ COMME TEL, pas comme un échec réseau.
// =============================================================================

const parametres = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useSearchParams: () => parametres,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/reinitialiser-mot-de-passe",
}));

vi.mock("@/lib/auth-api", () => ({
  reinitialiserMotDePasse: vi.fn(),
  utilisateurCourant: vi.fn(),
  connexion: vi.fn(),
  inscription: vi.fn(),
}));

const { reinitialiserMotDePasse } = await import("@/lib/auth-api");

const rendre = () =>
  render(
    <AuthProvider>
      <LangueProvider>
        <ReinitialiserPage />
      </LangueProvider>
    </AuthProvider>,
  );

const JETON = "a".repeat(64);

describe("/reinitialiser-mot-de-passe", () => {
  beforeEach(() => {
    window.localStorage.clear();
    parametres.set("token", JETON);
    vi.mocked(reinitialiserMotDePasse).mockReset();
    vi.mocked(reinitialiserMotDePasse).mockResolvedValue({ message: "ok" });
  });

  const remplir = async (motDePasse: string, confirmation: string) => {
    const utilisateur = userEvent.setup();

    await utilisateur.type(
      screen.getByLabelText(/^nouveau mot de passe$/i),
      motDePasse,
    );
    await utilisateur.type(
      screen.getByLabelText(/confirmer le mot de passe/i),
      confirmation,
    );
    await utilisateur.click(
      screen.getByRole("button", { name: /changer mon mot de passe/i }),
    );
  };

  it("transmet le jeton de l’URL et le mot de passe", async () => {
    rendre();
    await remplir("nouveau-mdp-1", "nouveau-mdp-1");

    await waitFor(() =>
      expect(reinitialiserMotDePasse).toHaveBeenCalledWith(
        JETON,
        "nouveau-mdp-1",
      ),
    );
  });

  it("REFUSE deux mots de passe différents SANS APPELER LE BACKEND", async () => {
    // ⚠️ Le backend ne reçoit qu'un mot de passe : il ne peut pas détecter la
    // faute de frappe. Non vérifiée ici, elle enfermerait l'usager dehors avec
    // un mot de passe qu'il croit connaître.
    rendre();
    await remplir("nouveau-mdp-1", "nouveau-mdp-2");

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(reinitialiserMotDePasse).not.toHaveBeenCalled();
  });

  it("REFUSE un mot de passe trop court SANS APPELER LE BACKEND", async () => {
    rendre();
    await remplir("court", "court");

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(reinitialiserMotDePasse).not.toHaveBeenCalled();
  });

  it("N’OUVRE AUCUNE SESSION : il renvoie vers la connexion", async () => {
    // ⚠️ Quelqu'un qui aurait intercepté le lien obtiendrait sinon un accès
    // sans jamais prouver qu'il connaît le nouveau mot de passe.
    rendre();
    await remplir("nouveau-mdp-1", "nouveau-mdp-1");

    const succes = await screen.findByRole("status");
    expect(succes.textContent).toMatch(/vous pouvez vous connecter/i);

    expect(
      screen
        .getByRole("link", { name: /aller à la connexion/i })
        .getAttribute("href"),
    ).toBe("/connexion");

    // Aucun jeton d'accès n'a été écrit.
    expect(window.localStorage.getItem("urbanflow.token")).toBeNull();
  });

  it("répète le message du backend SANS l’interpréter", async () => {
    // ⚠️ Inconnu, expiré, déjà utilisé : le backend rend le MÊME message pour
    // les trois. Le raffiner ici apprendrait qu'un jeton a existé, donc qu'une
    // demande a été faite pour un compte donné.
    vi.mocked(reinitialiserMotDePasse).mockRejectedValue(
      new ApiError(
        400,
        "Ce lien de réinitialisation est invalide ou a expiré. Demandez-en un nouveau.",
      ),
    );

    rendre();
    await remplir("nouveau-mdp-1", "nouveau-mdp-1");

    const erreur = await screen.findByRole("alert");
    expect(erreur.textContent).toMatch(/invalide ou a expiré/i);
    expect(erreur.textContent).not.toMatch(/déjà utilisé|expiré depuis/i);
  });

  it("traite un lien SANS JETON comme un lien tronqué", async () => {
    // Un lien recopié à la main ou coupé par un client de messagerie est assez
    // fréquent pour mériter sa propre phrase, plutôt qu'un échec réseau
    // incompréhensible après une saisie complète.
    parametres.delete("token");

    rendre();

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(
      screen.queryByRole("button", { name: /changer mon mot de passe/i }),
    ).toBeNull();
    expect(
      screen.getByRole("link", { name: /mot de passe oublié/i }),
    ).toBeDefined();
  });
});
