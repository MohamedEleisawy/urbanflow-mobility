import { renderToStaticMarkup } from "react-dom/server";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Carte } from "./Carte";
import type { PointCarte } from "@/lib/carte";

// =============================================================================
// Cadre de la carte (bloc 5B)
// =============================================================================
// ⚠️ CE FICHIER NE SIMULE PAS LEAFLET, volontairement — contrairement aux
// tests de pages. C'est le seul endroit où l'on vérifie que la frontière
// client tient : si `CarteLeaflet` était rendu côté serveur, l'import de
// Leaflet toucherait `window` et le rendu ci-dessous échouerait.
// =============================================================================

const POINTS: PointCarte[] = [
  { id: "a", nom: "Gare Centrale", latitude: 48.5853, longitude: 7.7355 },
  { id: "b", nom: "Homme de Fer", latitude: 48.5836, longitude: 7.7454 },
];

describe("Carte", () => {
  it("se rend CÔTÉ SERVEUR sans toucher au navigateur", () => {
    // `renderToStaticMarkup` reproduit ce que fait `next build` en prérendant
    // la page. Leaflet lit `window` dès son import : sans `ssr: false`, cet
    // appel lèverait une exception.
    const html = renderToStaticMarkup(
      <Carte titre="Le réseau" description="Deux arrêts." arrets={POINTS} />,
    );

    expect(html).toContain("Le réseau");
    expect(html).toContain("Deux arrêts.");
    // La bibliothèque n'a rien dessiné : aucune classe Leaflet n'apparaît.
    expect(html).not.toContain("leaflet");
  });

  it("annonce son titre comme un vrai en-tête", () => {
    render(<Carte titre="Le réseau" description="Deux arrêts." arrets={POINTS} />);

    expect(screen.getByRole("heading", { name: "Le réseau" })).toBeDefined();
  });

  it("affiche l'équivalent textuel SOUS la carte, visible", () => {
    render(
      <Carte titre="Le réseau" description="2 arrêts sont localisés." arrets={POINTS} />,
    );

    // Visible, et non réservé aux lecteurs d'écran : une carte est illisible
    // pour bien d'autres raisons que la cécité.
    const texte = screen.getByText("2 arrêts sont localisés.");
    expect(texte.className).not.toContain("sr-only");
  });

  it("le dit quand il n'y a rien à montrer, SANS retirer la carte", () => {
    // ⚠️ RÉGRESSION VERROUILLÉE. La carte conditionnait autrefois son rendu sur
    // `arrets.length` : une recherche sans arrêt la faisait disparaître.
    // Désormais le fond cartographique reste monté, et le message n'est qu'une
    // incrustation `pointer-events-none`.
    const { container } = render(
      <Carte titre="Le réseau" description="Rien à afficher." arrets={[]} />,
    );

    expect(screen.getByText(/aucun arrêt à proximité/i)).toBeDefined();
    // Le conteneur Leaflet (chargé dynamiquement) est toujours là.
    expect(container.querySelector(".h-64")).not.toBeNull();
  });

  it("laisse personnaliser le message d'incrustation", () => {
    render(
      <Carte
        titre="Le réseau"
        description="Rien."
        arrets={[]}
        messageVide="Déplacez la carte pour voir des arrêts."
      />,
    );

    expect(
      screen.getByText("Déplacez la carte pour voir des arrêts."),
    ).toBeDefined();
  });

  it("réserve une hauteur explicite au conteneur", () => {
    // Un conteneur Leaflet sans hauteur mesurable ne dessine rien : la carte
    // paraîtrait cassée sans qu'aucune erreur ne soit levée.
    const { container } = render(
      <Carte titre="Le réseau" description="Deux arrêts." arrets={POINTS} />,
    );

    expect(container.querySelector(".h-64")).not.toBeNull();
    // Plus haute dès le format tablette : sur mobile, l'écran doit rester
    // utilisable sous la carte.
    expect(container.querySelector(".sm\\:h-96")).not.toBeNull();
  });
});
