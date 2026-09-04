import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AccueilPage from "./page";
import { LangueProvider } from "@/components/LangueProvider";
import { AuthProvider } from "@/components/AuthProvider";

// =============================================================================
// Page d'accueil (sprint soutenance)
// =============================================================================
// ⚠️ CES TESTS ONT REMPLACÉ CEUX D'UNE REDIRECTION. `/` renvoyait vers
// `/recherche`, et deux tests vérifiaient précisément qu'aucune page de
// présentation n'existait.
//
// Le raisonnement d'alors valait pour un usager HABITUÉ, et échouait pour tous
// les autres : quelqu'un qui découvre l'application doit comprendre ce qu'elle
// fait de plus qu'un plan de réseau. Voir l'en-tête de `page.tsx`.
//
// Ce que ces tests protègent maintenant, c'est l'argument que la redirection
// avait raison de défendre : NE PAS METTRE D'ÉCRAN entre l'usager et sa
// recherche. D'où le premier test.
// =============================================================================

vi.mock("@/lib/auth-api", () => ({
  utilisateurCourant: vi.fn(),
  connexion: vi.fn(),
  inscription: vi.fn(),
}));

vi.mock("@/lib/territoire-api", () => ({ territoire: vi.fn() }));

const { territoire } = await import("@/lib/territoire-api");

const TERRITOIRE = {
  name: "strasbourg",
  displayName: "Eurométropole de Strasbourg",
  country: "FR",
  centerLat: 48.5834,
  centerLon: 7.7452,
  radiusM: 12_000,
  timezone: "Europe/Paris",
};

const rendre = () =>
  render(
    <AuthProvider>
      <LangueProvider>
        <AccueilPage />
      </LangueProvider>
    </AuthProvider>,
  );

describe("/", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(territoire).mockResolvedValue(TERRITOIRE);
  });

  it("mène à la recherche en UN SEUL clic", () => {
    rendre();

    // ⚠️ LE TEST LE PLUS IMPORTANT. C'est la promesse que la redirection
    // tenait : l'accueil ne doit pas coûter une étape supplémentaire à
    // quelqu'un qui vient chercher un itinéraire.
    const cta = screen.getByRole("link", { name: /chercher un itinéraire/i });

    expect(cta.getAttribute("href")).toBe("/recherche");
  });

  it("le CTA est ATTEIGNABLE AU CLAVIER, parce que c’est un vrai lien", () => {
    // ⚠️ Un `<div onClick>` stylé en bouton serait invisible au clavier,
    // inouvrable dans un nouvel onglet, et absent de la liste des liens d'un
    // lecteur d'écran. La taille et la couleur ne remplacent pas la
    // sémantique — et c'est le seul élément de la page qui compte vraiment.
    rendre();

    const cta = screen.getByRole("link", { name: /rechercher un itinéraire/i });

    // Un `<a href>` est focusable nativement : aucun `tabIndex` ne doit avoir
    // été ajouté pour compenser une balise mal choisie.
    expect(cta.tagName).toBe("A");
    expect(cta.getAttribute("tabindex")).toBeNull();
  });

  it("le pictogramme du CTA est DÉCORATIF", () => {
    // Sans `aria-hidden`, un lecteur d'écran annonce « emoji fusée » avant le
    // libellé du seul bouton qui compte sur cette page.
    rendre();

    const cta = screen.getByRole("link", { name: /rechercher un itinéraire/i });
    const picto = cta.querySelector("[aria-hidden='true']");

    expect(picto?.textContent).toBe("🚀");
  });

  it("porte le slogan du produit", () => {
    rendre();

    expect(screen.getByText(/bougez mieux/i)).toBeDefined();
    expect(screen.getByText(/émettez moins/i)).toBeDefined();
  });

  it("mène aussi aux perturbations", () => {
    rendre();

    expect(
      screen.getByRole("link", { name: /perturbations/i }).getAttribute("href"),
    ).toBe("/perturbations");
  });

  it("NOMME LE TERRITOIRE, depuis l’API et non en dur", async () => {
    rendre();

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1 }).textContent,
      ).toContain("Eurométropole de Strasbourg"),
    );
  });

  it("N’ÉCRIT AUCUN NOM DE VILLE tant que le territoire est inconnu", () => {
    // ⚠️ Un repli codé « Strasbourg » afficherait le mauvais nom une
    // demi-seconde sur un déploiement lyonnais — et l'erreur passerait
    // inaperçue en développement, où l'API répond instantanément.
    rendre();

    const titre = screen.getByRole("heading", { level: 1 }).textContent ?? "";

    expect(titre).not.toMatch(/strasbourg/i);
    expect(titre).toContain("votre métropole");
  });

  it("tient debout SANS l’API du territoire", async () => {
    vi.mocked(territoire).mockRejectedValue(new Error("réseau injoignable"));

    rendre();

    // Aucune erreur affichée, et l'appel à l'action reste atteignable : une
    // page d'accueil ne doit pas dépendre d'un appel réseau pour être
    // utilisable.
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: /chercher un itinéraire/i }),
      ).toBeDefined(),
    );
  });

  it("annonce le carbone comme la promesse du produit", () => {
    rendre();

    // La section carbone existe et porte l'accent : c'est ce qui distingue
    // UrbanFlow d'un plan de réseau. Sans elle, la page n'a plus d'objet.
    expect(screen.getByText(/Le carbone, chiffré/i)).toBeDefined();
  });

  it("assume ce que le produit NE SAIT PAS", () => {
    // Cette section engage le produit sur ses limites. La perdre au fil des
    // refontes reviendrait à laisser croire que tout est connu.
    expect(rendre).not.toThrow();

    expect(
      screen.getByRole("heading", { name: /ce que nous ne savons pas/i }),
    ).toBeDefined();
  });
});
