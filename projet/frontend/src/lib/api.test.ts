import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError, apiFetch, messageDErreur } from "./api";

// La couche `fetch` (5A-2) n'était couverte par rien : elle ne servait à
// personne. Elle sert maintenant à l'authentification, donc elle se teste.
//
// `fetch` global est remplacé — aucune requête ne part.

const simuler = (corps: unknown, init: { status?: number } = {}): ReturnType<typeof vi.fn> => {
  const faux = vi.fn().mockResolvedValue(
    new Response(corps === undefined ? null : JSON.stringify(corps), {
      status: init.status ?? 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", faux);
  return faux;
};

/// Options réellement passées à `fetch`.
const optionsAppel = (faux: ReturnType<typeof vi.fn>) =>
  faux.mock.calls[0][1] as RequestInit & {
    headers: Record<string, string>;
  };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiFetch", () => {
  describe("requête", () => {
    it("préfixe le chemin par la racine de l'API", async () => {
      const faux = simuler({ ok: true });

      await apiFetch("/alerts");

      expect(String(faux.mock.calls[0][0])).toContain("/alerts");
    });

    it("fait un GET sans corps par défaut", async () => {
      const faux = simuler({ ok: true });

      await apiFetch("/alerts");

      const options = optionsAppel(faux);
      expect(options.method).toBe("GET");
      expect(options.body).toBeUndefined();
      // Content-Type sur un GET est au mieux inutile, au pire un déclencheur
      // de requête CORS préalable.
      expect(options.headers["Content-Type"]).toBeUndefined();
    });

    it("sérialise le corps et annonce le type JSON", async () => {
      const faux = simuler({ ok: true });

      await apiFetch("/auth/login", {
        method: "POST",
        body: { email: "a@b.fr", password: "secret" },
      });

      const options = optionsAppel(faux);
      expect(options.method).toBe("POST");
      expect(options.headers["Content-Type"]).toBe("application/json");
      expect(options.body).toBe(JSON.stringify({ email: "a@b.fr", password: "secret" }));
    });

    it("ajoute l'en-tête Authorization quand un jeton est fourni", async () => {
      const faux = simuler({ ok: true });

      await apiFetch("/users/me", { token: "jeton-abc" });

      expect(optionsAppel(faux).headers.Authorization).toBe("Bearer jeton-abc");
    });

    it("n'ajoute AUCUN en-tête Authorization sans jeton", async () => {
      const faux = simuler({ ok: true });

      await apiFetch("/alerts", { token: null });

      // Une route publique ne doit pas partir avec un en-tête vide, qui
      // vaudrait un jeton invalide.
      expect(optionsAppel(faux).headers.Authorization).toBeUndefined();
    });
  });

  describe("réponses", () => {
    it("rend le corps désérialisé", async () => {
      simuler({ items: [], limit: 200, truncated: false });

      const reponse = await apiFetch<{ limit: number }>("/alerts");

      expect(reponse.limit).toBe(200);
    });

    it("ne tente PAS de lire un corps sur un 204", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

      // Une suppression réussie n'a pas de corps : `response.json()` lèverait
      // sur une chaîne vide.
      await expect(apiFetch("/routes/abc", { method: "DELETE" })).resolves.toBeUndefined();
    });
  });

  describe("erreurs", () => {
    it("lève une ApiError portant le statut HTTP", async () => {
      simuler({ message: "Email ou mot de passe incorrect" }, { status: 401 });

      await expect(apiFetch("/auth/login", { method: "POST" })).rejects.toThrow(ApiError);
    });

    it("expose le statut sous forme lisible", async () => {
      simuler({ message: "Refusé" }, { status: 401 });

      // Un écran doit pouvoir réagir au statut sans lire le message.
      const erreur = await apiFetch("/users/me").catch((e: unknown) => e);
      expect(erreur).toBeInstanceOf(ApiError);
      expect((erreur as ApiError).estNonAuthentifie).toBe(true);
      expect((erreur as ApiError).estInterdit).toBe(false);
    });

    it("reprend le message du backend", async () => {
      simuler({ message: "Un utilisateur avec cet email existe déjà" }, { status: 409 });

      await expect(apiFetch("/users", { method: "POST" })).rejects.toThrow(/existe déjà/);
    });

    it("assemble les messages de validation multiples", async () => {
      // NestJS rend un TABLEAU quand plusieurs champs sont refusés.
      simuler({ message: ["email must be an email", "password too short"] }, { status: 400 });

      await expect(apiFetch("/users", { method: "POST" })).rejects.toThrow(
        /email must be an email · password too short/,
      );
    });

    it("reste lisible si le corps n'est pas du JSON", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response("<html>502</html>", { status: 502 })),
      );

      // Une page d'erreur HTML ne doit pas produire « [object Object] », ni
      // faire fuiter le corps brut.
      await expect(apiFetch("/alerts")).rejects.toThrow(/HTTP 502/);
    });

    it("lève une NetworkError quand aucune réponse n'arrive", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

      // Serveur éteint, réseau coupé, ou requête bloquée par CORS : trois
      // causes, un seul symptôme pour l'appelant.
      await expect(apiFetch("/alerts")).rejects.toThrow(NetworkError);
    });

    it("laisse remonter une annulation telle quelle", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError")));

      // Changer de page n'est pas une panne : sans ce traitement, l'écran
      // afficherait « serveur injoignable ».
      await expect(apiFetch("/alerts")).rejects.toThrow(DOMException);
      await expect(apiFetch("/alerts")).rejects.not.toThrow(NetworkError);
    });
  });
});

describe("messageDErreur", () => {
  it("rend le message d'une ApiError", () => {
    expect(messageDErreur(new ApiError(409, "Déjà pris"))).toBe("Déjà pris");
  });

  it("rend le message d'une NetworkError", () => {
    expect(messageDErreur(new NetworkError("Injoignable"))).toBe("Injoignable");
  });

  it("masque toute erreur inattendue", () => {
    // Garde-fou : une trace d'exécution ne doit jamais atteindre l'interface.
    expect(messageDErreur(new TypeError("x is not a function"))).toBe(
      "Une erreur inattendue est survenue.",
    );
  });
});
