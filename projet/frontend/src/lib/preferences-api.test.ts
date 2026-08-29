import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "./api";
import { enregistrerPreferences } from "./preferences-api";
import type { UserPreferences } from "./types";

// =============================================================================
// Couche API des préférences (bloc 5E-2)
// =============================================================================
// `fetch` global est remplacé, comme dans `api.test.ts` : aucune requête ne
// part, et l'on inspecte EXACTEMENT ce qui aurait été envoyé. C'est le seul
// niveau où l'on peut prouver la méthode, l'URL, l'en-tête d'autorisation et
// le corps sérialisé.
// =============================================================================

const PREFERENCES: UserPreferences = {
  id: "pref-1",
  preferredModes: ["BUS", "METRO"],
  pmrMode: false,
  co2BudgetWeekly: 5000,
  notificationsEnabled: true,
  language: "FR",
  theme: "SYSTEM",
  userId: "11111111-1111-1111-1111-111111111111",
};

const simuler = (corps: unknown, init: { status?: number } = {}) => {
  const faux = vi.fn().mockResolvedValue(
    new Response(corps === undefined ? null : JSON.stringify(corps), {
      status: init.status ?? 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", faux);
  return faux;
};

const appel = (faux: ReturnType<typeof vi.fn>) => ({
  url: String(faux.mock.calls[0][0]),
  options: faux.mock.calls[0][1] as RequestInit & { headers: Record<string, string> },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("enregistrerPreferences", () => {
  describe("requête", () => {
    it("vise /users/me/preferences", async () => {
      const faux = simuler(PREFERENCES);

      await enregistrerPreferences("jeton-valide", { theme: "DARK" });

      // `/me`, jamais `/:id` : la route n'accepte aucun identifiant, et c'est
      // ce qui rend impossible de viser les préférences d'autrui.
      expect(appel(faux).url).toContain("/users/me/preferences");
      expect(appel(faux).url).not.toMatch(/users\/[0-9a-f-]{36}/);
    });

    it("emploie la méthode PATCH", async () => {
      const faux = simuler(PREFERENCES);

      await enregistrerPreferences("jeton-valide", { theme: "DARK" });

      // PATCH et non PUT : le corps décrit ce qui CHANGE. Un PUT exigerait
      // l'objet entier, et tout oubli effacerait un champ.
      expect(appel(faux).options.method).toBe("PATCH");
    });

    it("transmet le jeton en Authorization", async () => {
      const faux = simuler(PREFERENCES);

      await enregistrerPreferences("jeton-valide", { theme: "DARK" });

      expect(appel(faux).options.headers.Authorization).toBe("Bearer jeton-valide");
    });

    it("envoie EXACTEMENT les champs modifiés", async () => {
      const faux = simuler(PREFERENCES);

      await enregistrerPreferences("jeton-valide", { theme: "DARK", pmrMode: true });

      expect(JSON.parse(String(appel(faux).options.body))).toEqual({
        theme: "DARK",
        pmrMode: true,
      });
    });

    it("n'envoie NI id NI userId", async () => {
      const faux = simuler(PREFERENCES);

      // Le type `MiseAJourPreferences` ne les déclare pas — ce test garantit
      // qu'aucune évolution ne les réintroduira. Le backend les refuserait en
      // 400 (`forbidNonWhitelisted`), mais mieux vaut ne jamais les former.
      await enregistrerPreferences("jeton-valide", { co2BudgetWeekly: 1200 });

      const corps = JSON.parse(String(appel(faux).options.body)) as Record<string, unknown>;
      expect(corps).not.toHaveProperty("id");
      expect(corps).not.toHaveProperty("userId");
    });

    it("transmet un budget de ZÉRO", async () => {
      const faux = simuler(PREFERENCES);

      await enregistrerPreferences("jeton-valide", { co2BudgetWeekly: 0 });

      // 0 est une valeur, pas une absence : un objectif « zéro émission » est
      // légitime, et il doit franchir toute la chaîne sans être avalé.
      const corps = JSON.parse(String(appel(faux).options.body)) as Record<string, unknown>;
      expect(corps.co2BudgetWeekly).toBe(0);
    });

    it("transmet un tableau de modes VIDE", async () => {
      const faux = simuler(PREFERENCES);

      await enregistrerPreferences("jeton-valide", { preferredModes: [] });

      // Vider ses modes favoris est un choix. Un tableau vide ne doit pas être
      // confondu avec « pas de changement ».
      const corps = JSON.parse(String(appel(faux).options.body)) as Record<string, unknown>;
      expect(corps.preferredModes).toEqual([]);
    });
  });

  describe("réponse", () => {
    it("rend les préférences telles que le SERVEUR les a enregistrées", async () => {
      // Le serveur applique les valeurs par défaut du schéma à la création :
      // sa réponse peut donc différer du corps envoyé.
      simuler({ ...PREFERENCES, theme: "DARK", notificationsEnabled: true });

      const resultat = await enregistrerPreferences("jeton-valide", { theme: "DARK" });

      expect(resultat.theme).toBe("DARK");
      expect(resultat.notificationsEnabled).toBe(true);
      expect(resultat.userId).toBe(PREFERENCES.userId);
    });
  });

  describe("erreurs", () => {
    it("remonte un 400 de validation", async () => {
      simuler(
        { message: "Un budget carbone hebdomadaire est nécessaire pour créer vos préférences." },
        { status: 400 },
      );

      await expect(enregistrerPreferences("jeton-valide", { theme: "DARK" })).rejects.toMatchObject(
        { status: 400 },
      );
    });

    it("conserve le message du backend", async () => {
      simuler({ message: "Un budget carbone hebdomadaire est nécessaire." }, { status: 400 });

      // Le message du serveur dit QUOI FAIRE : le remplacer par un « erreur
      // de validation » générique perdrait l'information utile.
      await expect(enregistrerPreferences("jeton-valide", {})).rejects.toThrow(/budget carbone/i);
    });

    it("remonte un 401 de session expirée", async () => {
      simuler({ message: "Token invalide ou expiré" }, { status: 401 });

      const echec = await enregistrerPreferences("jeton-perime", { theme: "DARK" }).catch(
        (e: unknown) => e,
      );

      expect(echec).toBeInstanceOf(ApiError);
      expect((echec as ApiError).estNonAuthentifie).toBe(true);
    });

    it("remonte une erreur serveur", async () => {
      simuler({ message: "Erreur interne" }, { status: 500 });

      await expect(enregistrerPreferences("jeton-valide", {})).rejects.toMatchObject({
        status: 500,
      });
    });

    it("distingue une PANNE RÉSEAU d'une réponse d'erreur", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

      // Un serveur éteint et un serveur qui refuse ne se traitent pas
      // pareil : l'un se réessaie, l'autre demande de corriger la saisie.
      await expect(enregistrerPreferences("jeton-valide", {})).rejects.toBeInstanceOf(NetworkError);
    });
  });
});
