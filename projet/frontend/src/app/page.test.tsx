import { describe, expect, it, vi } from "vitest";

// Racine du site (refonte mobilité).
//
// `redirect()` de Next.js lève une exception de contrôle interne pour
// interrompre le rendu : on le simule donc pour observer sa CIBLE, plutôt que
// de faire échouer le test sur un mécanisme du framework.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((chemin: string) => {
    throw new Error(`REDIRECT:${chemin}`);
  }),
}));

const { redirect } = await import("next/navigation");
const { default: AccueilPage } = await import("./page");

describe("/", () => {
  it("redirige vers l'écran de recherche", () => {
    expect(() => AccueilPage()).toThrow("REDIRECT:/recherche");
    expect(redirect).toHaveBeenCalledWith("/recherche");
  });

  it("n'affiche AUCUNE page de présentation", () => {
    // L'ancienne page listait quatre encadrés décrivant l'application.
    // UrbanFlow est une application de mobilité, pas une plaquette : l'usager
    // qui l'ouvre veut un itinéraire.
    expect(() => AccueilPage()).toThrow(/REDIRECT/);
  });
});
