import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceWorker } from "./ServiceWorker";

// =============================================================================
// Enregistrement du service worker (bloc 5D-2)
// =============================================================================
// jsdom n'implémente pas `navigator.serviceWorker` : on l'installe, ce qui
// permet au passage d'éprouver le cas où il est ABSENT — celui d'une origine
// non sécurisée ou d'une navigation privée.
// =============================================================================

const installer = (register = vi.fn(() => Promise.resolve({} as ServiceWorkerRegistration))) => {
  // `addEventListener` est fourni EXPRÈS, alors que le composant ne s'en sert
  // pas : c'est ce qui permet de vérifier qu'il ne s'y abonne effectivement
  // jamais (voir le dernier test).
  const addEventListener = vi.fn();
  Object.defineProperty(navigator, "serviceWorker", {
    value: { register, addEventListener },
    configurable: true,
  });
  return { register, addEventListener };
};

const retirer = () => {
  // `delete` plutôt qu'`undefined` : le composant teste `"serviceWorker" in
  // navigator`, et une propriété définie à `undefined` passerait le test.
  Reflect.deleteProperty(navigator, "serviceWorker");
};

afterEach(() => {
  retirer();
  vi.restoreAllMocks();
});

describe("ServiceWorker", () => {
  it("enregistre /sw.js à la racine", async () => {
    const { register } = installer();

    render(<ServiceWorker />);

    await waitFor(() => expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" }));
  });

  it("ne rend RIEN dans le DOM", () => {
    installer();

    const { container } = render(<ServiceWorker />);

    // Il n'existe que pour son effet : tout élément ajouté déplacerait la
    // mise en page du layout.
    expect(container.innerHTML).toBe("");
  });

  it("ne PLANTE PAS quand le navigateur ne le gère pas", () => {
    // Cas réel : origine non sécurisée (http hors localhost), ou navigation
    // privée. Appeler `navigator.serviceWorker.register` lèverait alors un
    // TypeError qui remonterait jusqu'à la racine de l'application.
    retirer();

    expect(() => render(<ServiceWorker />)).not.toThrow();
  });

  it("AVALE un échec d'enregistrement", async () => {
    const { register } = installer(vi.fn(() => Promise.reject(new Error("refusé"))));

    render(<ServiceWorker />);

    // L'application fonctionne exactement pareil sans service worker : rien
    // n'est affiché à l'usager, qui n'aurait de toute façon rien à y faire.
    // Le test échouerait sur un rejet non traité.
    await waitFor(() => expect(register).toHaveBeenCalled());
  });

  it("ne RECHARGE JAMAIS la page", () => {
    // Garde-fou. Le motif `controllerchange` → `location.reload()` est la
    // cause classique des applications qui se rechargent en boucle — celle-là
    // même qui a été diagnostiquée sur ce projet avec un service worker
    // fantôme. Ce test doit échouer si quelqu'un l'introduit.
    const { register, addEventListener } = installer();

    render(<ServiceWorker />);

    expect(register).toHaveBeenCalled();
    // S'abonner à `controllerchange` est le premier pas du motif fautif.
    expect(addEventListener).not.toHaveBeenCalled();
  });
});
