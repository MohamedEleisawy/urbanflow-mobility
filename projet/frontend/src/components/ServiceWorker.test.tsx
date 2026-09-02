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
  // `getRegistrations` sert au chemin de DÉSINSTALLATION en développement.
  const unregister = vi.fn(() => Promise.resolve(true));
  const getRegistrations = vi.fn(() =>
    Promise.resolve([{ unregister }] as unknown as ServiceWorkerRegistration[]),
  );

  Object.defineProperty(navigator, "serviceWorker", {
    value: { register, addEventListener, getRegistrations },
    configurable: true,
  });

  return { register, addEventListener, getRegistrations, unregister };
};

/// Bascule l'environnement sur « production » — le SEUL où le service worker
/// s'enregistre depuis la correction de la boucle de rechargement.
const enProduction = () => vi.stubEnv("NODE_ENV", "production");

const retirer = () => {
  // `delete` plutôt qu'`undefined` : le composant teste `"serviceWorker" in
  // navigator`, et une propriété définie à `undefined` passerait le test.
  Reflect.deleteProperty(navigator, "serviceWorker");
};

afterEach(() => {
  retirer();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("ServiceWorker", () => {
  it("enregistre /sw.js à la racine", async () => {
    enProduction();
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
    enProduction();
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
    enProduction();
    const { register, addEventListener } = installer();

    render(<ServiceWorker />);

    expect(register).toHaveBeenCalled();
    // S'abonner à `controllerchange` est le premier pas du motif fautif.
    expect(addEventListener).not.toHaveBeenCalled();
  });

  // ===========================================================================
  // Développement — la correction de la boucle de rechargement
  // ===========================================================================
  describe("en développement", () => {
    it("NE S'ENREGISTRE PAS", async () => {
      // `NODE_ENV` vaut « test » : on est hors production.
      const { register, getRegistrations } = installer();

      render(<ServiceWorker />);

      await waitFor(() => expect(getRegistrations).toHaveBeenCalled());

      // ⚠️ LA CORRECTION. Le service worker met `/_next/static/*` en cache
      // sans jamais revalider, en supposant que ces URL ne changent pas de
      // contenu. C'est vrai après `next build`, FAUX avec `next dev` :
      // Turbopack réutilise les mêmes URL d'une recompilation à l'autre.
      //
      // Le navigateur recevait alors un fragment périmé, Next rechargeait la
      // page, qui recevait de nouveau le même fragment : boucle infinie.
      expect(register).not.toHaveBeenCalled();
    });

    it("DÉSINSTALLE un service worker déjà présent", async () => {
      const { unregister } = installer();

      render(<ServiceWorker />);

      // Ne plus l'enregistrer ne suffit pas : un service worker déjà installé
      // SURVIT au changement de code et continue de servir ses fragments
      // périmés. Il faut le retirer explicitement.
      await waitFor(() => expect(unregister).toHaveBeenCalled());
    });

    it("VIDE les caches", async () => {
      const supprimer = vi.fn(() => Promise.resolve(true));
      Object.defineProperty(window, "caches", {
        value: {
          keys: vi.fn(() => Promise.resolve(["urbanflow-v1"])),
          delete: supprimer,
        },
        configurable: true,
      });
      installer();

      render(<ServiceWorker />);

      // Sans cela, le prochain enregistrement retrouverait les fragments
      // périmés et la boucle reprendrait.
      await waitFor(() => expect(supprimer).toHaveBeenCalledWith("urbanflow-v1"));

      Reflect.deleteProperty(window, "caches");
    });

    it("NE PLANTE PAS si les caches sont inaccessibles", async () => {
      const { unregister } = installer();
      Object.defineProperty(window, "caches", {
        value: { keys: vi.fn(() => Promise.reject(new Error("refusé"))) },
        configurable: true,
      });

      // Un navigateur peut refuser l'accès aux caches — navigation privée,
      // réglage strict. La page ne doit pas en souffrir.
      expect(() => render(<ServiceWorker />)).not.toThrow();
      await waitFor(() => expect(unregister).toHaveBeenCalled());

      Reflect.deleteProperty(window, "caches");
    });
  });
});
