import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MotDePasseOubliePage from "./page";
import { LangueProvider } from "@/components/LangueProvider";
import { AuthProvider } from "@/components/AuthProvider";
import { ApiError } from "@/lib/api";

// =============================================================================
// Ce que ces tests verrouillent
// =============================================================================
// UNE SEULE PROPRIÉTÉ, et c'est celle qui compte : l'écran ne laisse pas
// deviner si un compte existe. Tout le reste — le libellé du bouton, l'état de
// chargement — n'est vérifié que parce qu'il porte cette propriété.
// =============================================================================

vi.mock("@/lib/auth-api", () => ({
  demanderReinitialisation: vi.fn(),
  utilisateurCourant: vi.fn(),
  connexion: vi.fn(),
  inscription: vi.fn(),
}));

const { demanderReinitialisation } = await import("@/lib/auth-api");

const rendre = () =>
  render(
    <AuthProvider>
      <LangueProvider>
        <MotDePasseOubliePage />
      </LangueProvider>
    </AuthProvider>,
  );

describe("/mot-de-passe-oublie", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(demanderReinitialisation).mockReset();
    vi.mocked(demanderReinitialisation).mockResolvedValue({ message: "ok" });
  });

  it("transmet l’adresse saisie", async () => {
    const utilisateur = userEvent.setup();
    rendre();

    await utilisateur.type(
      screen.getByLabelText(/adresse électronique/i),
      "usager@example.test",
    );
    await utilisateur.click(
      screen.getByRole("button", { name: /préparer un lien/i }),
    );

    await waitFor(() =>
      expect(demanderReinitialisation).toHaveBeenCalledWith(
        "usager@example.test",
      ),
    );
  });

  it("DIT LA MÊME CHOSE quelle que soit l’adresse", async () => {
    // ⚠️ LE TEST LE PLUS IMPORTANT DU FICHIER. Un écran qui distinguerait
    // « adresse inconnue » se laisserait soumettre une liste d'adresses et
    // répondrait, pour chacune, si elle a un compte ici. Ces listes se
    // revendent et servent à l'hameçonnage ciblé.
    //
    // Le backend s'engage à répondre 200 dans les deux cas ; cette page ne
    // doit surtout pas essayer de distinguer plus finement.
    const utilisateur = userEvent.setup();
    const messages: string[] = [];

    for (const adresse of ["inscrit@example.test", "jamais-vu@example.test"]) {
      const { unmount } = rendre();

      await utilisateur.type(
        screen.getByLabelText(/adresse électronique/i),
        adresse,
      );
      await utilisateur.click(
        screen.getByRole("button", { name: /préparer un lien/i }),
      );

      const confirmation = await screen.findByRole("status");
      messages.push(confirmation.textContent ?? "");

      unmount();
    }

    expect(messages).toHaveLength(2);
    expect(new Set(messages).size).toBe(1);
  });

  it("N’ANNONCE PAS un envoi de courriel", async () => {
    // ⚠️ Aucun transport n'est configuré : le lien est PRÉPARÉ, pas envoyé.
    // « Email envoyé » laisserait quelqu'un attendre devant une boîte vide.
    const utilisateur = userEvent.setup();
    rendre();

    await utilisateur.type(
      screen.getByLabelText(/adresse électronique/i),
      "usager@example.test",
    );
    await utilisateur.click(
      screen.getByRole("button", { name: /préparer un lien/i }),
    );

    const confirmation = await screen.findByRole("status");

    expect(confirmation.textContent).toMatch(/préparé/i);
    expect(confirmation.textContent).not.toMatch(/envoyé/i);
  });

  it("EXPLIQUE pourquoi la réponse est vague", async () => {
    // Sans explication, « si un compte existe » se lit comme une dérobade.
    const utilisateur = userEvent.setup();
    rendre();

    await utilisateur.type(
      screen.getByLabelText(/adresse électronique/i),
      "usager@example.test",
    );
    await utilisateur.click(
      screen.getByRole("button", { name: /préparer un lien/i }),
    );

    expect(
      await screen.findByText(/qu’on puisse deviner qui a un compte/i),
    ).toBeDefined();
  });

  it("affiche l’état de chargement, puis le retire", async () => {
    const utilisateur = userEvent.setup();
    let debloquer: (valeur: { message: string }) => void = () => {};
    vi.mocked(demanderReinitialisation).mockReturnValue(
      new Promise((resoudre) => {
        debloquer = resoudre;
      }),
    );

    rendre();

    await utilisateur.type(
      screen.getByLabelText(/adresse électronique/i),
      "usager@example.test",
    );
    await utilisateur.click(
      screen.getByRole("button", { name: /préparer un lien/i }),
    );

    expect(
      screen.getByRole("button", { name: /préparation/i }),
    ).toBeDefined();

    debloquer({ message: "ok" });

    await waitFor(() => expect(screen.getByRole("status")).toBeDefined());
  });

  it("montre une erreur de VALIDATION sans révéler quoi que ce soit", async () => {
    // Seule une adresse mal formée peut échouer (400). Une adresse inconnue
    // rend 200 : le backend s'y engage.
    const utilisateur = userEvent.setup();
    vi.mocked(demanderReinitialisation).mockRejectedValue(
      new ApiError(400, "Adresse électronique invalide."),
    );

    rendre();

    await utilisateur.type(
      screen.getByLabelText(/adresse électronique/i),
      "pas-une-adresse",
    );
    await utilisateur.click(
      screen.getByRole("button", { name: /préparer un lien/i }),
    );

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("propose toujours un retour vers la connexion", () => {
    rendre();

    expect(
      screen
        .getByRole("link", { name: /retour à la connexion/i })
        .getAttribute("href"),
    ).toBe("/connexion");
  });
});
