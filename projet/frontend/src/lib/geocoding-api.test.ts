import { afterEach, describe, expect, it, vi } from "vitest";
import { rechercherAdresses } from "./geocoding-api";
import { ApiError, NetworkError } from "./api";

// Client de recherche d'adresses (Phase 3A).
//
// `fetch` est simulé : ces tests éprouvent l'URL construite et la traduction
// des erreurs, jamais le réseau.
describe("rechercherAdresses", () => {
  const repondre = (corps: unknown, status = 200) =>
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(corps),
    } as unknown as Response);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("interroge NOTRE backend, jamais le fournisseur", async () => {
    const appel = repondre({ items: [], attribution: "©" });

    await rechercherAdresses("Tour Eiffel");

    const url = appel.mock.calls[0][0] as string;
    // Le frontend ne connaît pas l'adresse de Nominatim, et n'a pas à la
    // connaître : changer de fournisseur ne touchera aucune ligne d'interface.
    expect(url).toContain("/geocoding/search");
    expect(url).not.toContain("nominatim");
  });

  it("ÉCHAPPE la saisie", async () => {
    const appel = repondre({ items: [], attribution: "©" });

    await rechercherAdresses("rue A & B");

    // Sans échappement, le « & » couperait la requête en deux paramètres.
    expect(appel.mock.calls[0][0] as string).toContain("%26");
  });

  it("n'envoie AUCUN jeton", async () => {
    const appel = repondre({ items: [], attribution: "©" });

    await rechercherAdresses("Châtelet");

    // La recherche d'adresse est publique : le dossier place la recherche
    // d'itinéraire en libre accès.
    const options = appel.mock.calls[0][1] as RequestInit | undefined;
    const entetes = (options?.headers ?? {}) as Record<string, string>;
    expect(entetes.Authorization).toBeUndefined();
  });

  it("rend les items et l'attribution", async () => {
    repondre({
      items: [{ label: "Tour Eiffel, Paris", latitude: 48.8584, longitude: 2.2945 }],
      attribution: "© Contributeurs OpenStreetMap",
    });

    const reponse = await rechercherAdresses("Tour Eiffel");

    expect(reponse.items[0].latitude).toBe(48.8584);
    expect(reponse.attribution).toMatch(/OpenStreetMap/);
  });

  it("traduit un 400 en ApiError", async () => {
    repondre({ message: "q doit contenir au moins 3 caractères" }, 400);

    await expect(rechercherAdresses("ab")).rejects.toThrow(ApiError);
  });

  it("traduit un 503 en ApiError avec son message", async () => {
    repondre({ message: "Service de recherche momentanément indisponible." }, 503);

    await expect(rechercherAdresses("Tour")).rejects.toThrow(/indisponible/);
  });

  it("traduit une panne réseau en NetworkError", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));

    await expect(rechercherAdresses("Tour")).rejects.toThrow(NetworkError);
  });

  it("propage l'annulation sans la déguiser en panne", async () => {
    const annulation = new DOMException("aborted", "AbortError");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(annulation);

    // Une requête annulée n'est pas une panne : afficher « serveur
    // injoignable » alors que l'usager a simplement continué à taper serait
    // faux.
    await expect(rechercherAdresses("Tour")).rejects.toBe(annulation);
  });
});
