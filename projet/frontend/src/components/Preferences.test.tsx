import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthProvider";
import { LangueProvider } from "./LangueProvider";
import { Preferences } from "./Preferences";
import { ApiError, NetworkError } from "@/lib/api";
import type { User, UserPreferences } from "@/lib/types";

// =============================================================================
// Préférences — interface (bloc 5E)
// =============================================================================
// LE VRAI AuthProvider, LE VRAI localStorage, LE VRAI formulaire. Seules les
// deux fonctions réseau sont simulées : c'est le câblage entre le formulaire,
// la couche API et la session qu'on veut éprouver, et le simuler reviendrait à
// ne rien tester.
// =============================================================================

vi.mock("@/lib/auth-api", () => ({
  inscrire: vi.fn(),
  connecter: vi.fn(),
  utilisateurCourant: vi.fn(),
}));

vi.mock("@/lib/preferences-api", () => ({
  enregistrerPreferences: vi.fn(),
}));

const { utilisateurCourant } = await import("@/lib/auth-api");
const { enregistrerPreferences } = await import("@/lib/preferences-api");

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

const profil = (preferences: UserPreferences | null): User => ({
  id: "11111111-1111-1111-1111-111111111111",
  email: "usager@exemple.fr",
  role: "USER",
  createdAt: "2026-08-01T10:00:00.000Z",
  deletedAt: null,
  preferences,
});

/// Sonde : affiche ce que la SESSION contient, pour vérifier que le provider
/// est réellement mis à jour — et pas seulement le formulaire.
function Sonde() {
  const { utilisateur } = useAuth();
  return (
    <p data-testid="sonde">
      {utilisateur?.preferences ? `${utilisateur.preferences.theme}` : "aucune"}
    </p>
  );
}

const rendre = () =>
  render(
    <AuthProvider>
      <LangueProvider>
        <Sonde />
        <Preferences />
      </LangueProvider>
    </AuthProvider>,
  );

const authentifier = (preferences: UserPreferences | null = PREFERENCES) => {
  window.localStorage.setItem("urbanflow.token", "jeton-valide");
  vi.mocked(utilisateurCourant).mockResolvedValue(profil(preferences));
};

const budget = () => screen.getByLabelText(/budget carbone hebdomadaire/i) as HTMLInputElement;
const enregistrer = () => screen.getByRole("button", { name: /enregistrer les préférences/i });

describe("Préférences", () => {
  beforeEach(() => {
    vi.mocked(utilisateurCourant).mockReset();
    vi.mocked(enregistrerPreferences).mockReset();
  });

  // ---------------------------------------------------------------------------
  // Affichage
  // ---------------------------------------------------------------------------
  describe("affichage", () => {
    it("présente une section « Mes préférences »", async () => {
      authentifier();
      rendre();

      expect(
        await screen.findByRole("heading", { name: /mes préférences/i, level: 2 }),
      ).toBeDefined();
    });

    it("PRÉREMPLIT le formulaire avec les valeurs du backend", async () => {
      authentifier();
      rendre();

      await waitFor(() => expect(budget().value).toBe("5000"));
      // Les modes cochés sont EXACTEMENT ceux du profil.
      expect((screen.getByLabelText("Bus") as HTMLInputElement).checked).toBe(true);
      expect((screen.getByLabelText("Métro") as HTMLInputElement).checked).toBe(true);
      expect((screen.getByLabelText("Vélo") as HTMLInputElement).checked).toBe(false);
      expect(
        (screen.getByLabelText(/notifications de perturbation/i) as HTMLInputElement).checked,
      ).toBe(true);
    });

    it("annonce l'UNITÉ du budget en toutes lettres", async () => {
      authentifier();
      rendre();

      // Le backend stocke des GRAMMES. Afficher un nombre nu laisserait
      // deviner l'unité — et 5000 kg serait une erreur d'un facteur mille.
      expect(await screen.findByText(/en grammes de CO₂ par semaine/i)).toBeDefined();
    });

    it("montre l'équivalent en kilogrammes, clairement dérivé", async () => {
      authentifier();
      rendre();

      // Une commodité de lecture, présentée comme telle : la SAISIE reste en
      // grammes, seule l'indication est convertie.
      expect(await screen.findByText(/soit 5 kg/i)).toBeDefined();
    });

    it("annonce ce que la langue change RÉELLEMENT, et ce qu'elle ne change pas", async () => {
      authentifier();
      rendre();

      // ⚠️ CETTE NOTE A CHANGÉ DE SENS. Elle disait que le choix était
      // enregistré sans rien changer à l'affichage : c'était vrai, et
      // honnête. Depuis la Phase 5, `LangueProvider` applique la langue et
      // `ThemeProvider` le thème — la note dit donc désormais ce qui reste
      // partiel, plutôt qu'une limite disparue.
      expect(await screen.findByText(/s'applique immédiatement/i)).toBeDefined();
      expect(screen.getByText(/restent en français/i)).toBeDefined();
    });

    it("propose les TROIS langues", async () => {
      authentifier();
      rendre();

      const langue = await screen.findByLabelText("Langue");
      const options = Array.from(langue.querySelectorAll("option")).map((o) => o.value);

      expect(options).toEqual(["FR", "EN", "ES"]);
    });

    it("s'affiche même SANS préférences existantes", async () => {
      authentifier(null);
      rendre();

      await waitFor(() => expect(budget().value).toBe(""));
      // Les valeurs par défaut du schéma sont reflétées, sans être inventées.
      expect(
        (screen.getByLabelText(/notifications de perturbation/i) as HTMLInputElement).checked,
      ).toBe(true);
      expect((screen.getByLabelText(/fauteuil roulant/i) as HTMLInputElement).checked).toBe(false);
    });

    it("affiche un budget de ZÉRO, et non un champ vide", async () => {
      // `|| ""` aurait transformé 0 en absence : l'usager aurait vu son
      // objectif « zéro émission » disparaître à chaque affichage.
      authentifier({ ...PREFERENCES, co2BudgetWeekly: 0 });
      rendre();

      await waitFor(() => expect(budget().value).toBe("0"));
    });
  });

  // ---------------------------------------------------------------------------
  // Modification et envoi
  // ---------------------------------------------------------------------------
  describe("enregistrement", () => {
    it("envoie EXACTEMENT les six champs supportés", async () => {
      authentifier();
      vi.mocked(enregistrerPreferences).mockResolvedValue(PREFERENCES);
      rendre();
      await waitFor(() => expect(budget().value).toBe("5000"));

      await userEvent.click(enregistrer());

      await waitFor(() => expect(enregistrerPreferences).toHaveBeenCalled());
      const [jeton, corps] = vi.mocked(enregistrerPreferences).mock.calls[0];
      expect(jeton).toBe("jeton-valide");
      // Ni `id`, ni `userId` : le serveur les connaît, et les envoyer serait
      // refusé par `forbidNonWhitelisted`.
      expect(Object.keys(corps).sort()).toEqual([
        "co2BudgetWeekly",
        "language",
        "notificationsEnabled",
        "pmrMode",
        "preferredModes",
        "theme",
      ]);
    });

    it("transmet une valeur MODIFIÉE", async () => {
      authentifier();
      vi.mocked(enregistrerPreferences).mockResolvedValue(PREFERENCES);
      rendre();
      await waitFor(() => expect(budget().value).toBe("5000"));

      await userEvent.clear(budget());
      await userEvent.type(budget(), "3000");
      await userEvent.click(screen.getByLabelText("Vélo"));
      await userEvent.click(enregistrer());

      await waitFor(() => expect(enregistrerPreferences).toHaveBeenCalled());
      const [, corps] = vi.mocked(enregistrerPreferences).mock.calls[0];
      expect(corps.co2BudgetWeekly).toBe(3000);
      expect(corps.preferredModes).toEqual(["BUS", "METRO", "BIKE"]);
    });

    it("envoie un budget de ZÉRO comme une vraie valeur", async () => {
      authentifier();
      vi.mocked(enregistrerPreferences).mockResolvedValue(PREFERENCES);
      rendre();
      await waitFor(() => expect(budget().value).toBe("5000"));

      await userEvent.clear(budget());
      await userEvent.type(budget(), "0");
      await userEvent.click(enregistrer());

      await waitFor(() => expect(enregistrerPreferences).toHaveBeenCalled());
      expect(vi.mocked(enregistrerPreferences).mock.calls[0][1].co2BudgetWeekly).toBe(0);
    });

    it("permet de DÉCOCHER tous les modes", async () => {
      authentifier();
      vi.mocked(enregistrerPreferences).mockResolvedValue(PREFERENCES);
      rendre();
      await waitFor(() => expect(budget().value).toBe("5000"));

      await userEvent.click(screen.getByLabelText("Bus"));
      await userEvent.click(screen.getByLabelText("Métro"));
      await userEvent.click(enregistrer());

      await waitFor(() => expect(enregistrerPreferences).toHaveBeenCalled());
      // Un tableau vide est un choix, pas une absence de changement.
      expect(vi.mocked(enregistrerPreferences).mock.calls[0][1].preferredModes).toEqual([]);
    });

    it("annonce l'envoi et DÉSACTIVE le bouton", async () => {
      authentifier();
      vi.mocked(enregistrerPreferences).mockReturnValue(new Promise(() => {}));
      rendre();
      await waitFor(() => expect(budget().value).toBe("5000"));

      await userEvent.click(enregistrer());

      const bouton = await screen.findByRole("button", { name: /enregistrement…/i });
      expect(bouton.hasAttribute("disabled")).toBe(true);
    });

    it("EMPÊCHE une double soumission", async () => {
      authentifier();
      vi.mocked(enregistrerPreferences).mockReturnValue(new Promise(() => {}));
      rendre();
      await waitFor(() => expect(budget().value).toBe("5000"));

      await userEvent.click(enregistrer());
      await userEvent.click(screen.getByRole("button", { name: /enregistrement…/i }));

      // Deux PATCH concurrents laisseraient la réponse la plus lente écraser
      // la plus rapide.
      expect(enregistrerPreferences).toHaveBeenCalledTimes(1);
    });

    it("ne confirme QU'APRÈS la réponse du serveur", async () => {
      authentifier();
      let repondre: (p: UserPreferences) => void = () => {};
      vi.mocked(enregistrerPreferences).mockReturnValue(
        new Promise((resoudre) => {
          repondre = resoudre;
        }),
      );
      rendre();
      await waitFor(() => expect(budget().value).toBe("5000"));

      await userEvent.click(enregistrer());
      // Rien n'est encore promis : la requête est en vol.
      expect(screen.queryByText(/préférences enregistrées/i)).toBeNull();

      repondre({ ...PREFERENCES, theme: "DARK" });

      expect(await screen.findByText(/préférences enregistrées/i)).toBeDefined();
    });

    it("réaffiche ce que le SERVEUR a retenu", async () => {
      authentifier(null);
      // Le serveur applique les défauts du schéma à la création : sa réponse
      // peut différer du corps envoyé.
      vi.mocked(enregistrerPreferences).mockResolvedValue({
        ...PREFERENCES,
        co2BudgetWeekly: 4200,
        preferredModes: ["WALK"],
      });
      rendre();
      await waitFor(() => expect(budget().value).toBe(""));

      await userEvent.type(budget(), "4200");
      await userEvent.click(enregistrer());

      await waitFor(() =>
        expect((screen.getByLabelText("Marche") as HTMLInputElement).checked).toBe(true),
      );
      expect(budget().value).toBe("4200");
    });
  });

  // ---------------------------------------------------------------------------
  // Validation locale
  // ---------------------------------------------------------------------------
  describe("validation", () => {
    it("exige un budget pour une PREMIÈRE création", async () => {
      authentifier(null);
      rendre();
      await waitFor(() => expect(budget().value).toBe(""));

      // Le backend refuserait de toute façon — mais aller chercher un 400
      // pour une règle connue d'avance serait discourtois.
      expect(enregistrer().hasAttribute("disabled")).toBe(true);
      // Une CONSIGNE, pas une alerte : l'usager vient d'arriver et n'a rien
      // tapé. Le crier en rouge avant le moindre geste le ferait douter d'un
      // bug — et parasiterait les vraies erreurs de la page.
      expect(screen.getByText(/pour créer vos préférences/i)).toBeDefined();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("refuse un budget NÉGATIF", async () => {
      authentifier();
      rendre();
      await waitFor(() => expect(budget().value).toBe("5000"));

      await userEvent.clear(budget());
      await userEvent.type(budget(), "-100");

      expect(enregistrer().hasAttribute("disabled")).toBe(true);
      expect(screen.getByRole("alert").textContent).toMatch(/nombre positif/i);
      expect(enregistrerPreferences).not.toHaveBeenCalled();
    });

    it("laisse enregistrer sans budget quand des préférences EXISTENT", async () => {
      authentifier();
      vi.mocked(enregistrerPreferences).mockResolvedValue(PREFERENCES);
      rendre();
      await waitFor(() => expect(budget().value).toBe("5000"));

      await userEvent.clear(budget());
      await userEvent.click(enregistrer());

      await waitFor(() => expect(enregistrerPreferences).toHaveBeenCalled());
      // Le champ vidé est OMIS du corps : un PATCH ne décrit que ce qui
      // change, et la valeur en base est conservée.
      expect(vi.mocked(enregistrerPreferences).mock.calls[0][1]).not.toHaveProperty(
        "co2BudgetWeekly",
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Erreurs
  // ---------------------------------------------------------------------------
  describe("erreurs", () => {
    const echouerAvec = async (erreur: unknown) => {
      authentifier();
      vi.mocked(enregistrerPreferences).mockRejectedValue(erreur);
      rendre();
      await waitFor(() => expect(budget().value).toBe("5000"));

      await userEvent.clear(budget());
      await userEvent.type(budget(), "1234");
      await userEvent.click(enregistrer());

      await screen.findByText(/échec de l'enregistrement/i);
    };

    it("signale une erreur de validation (400)", async () => {
      await echouerAvec(new ApiError(400, "Un budget carbone hebdomadaire est nécessaire."));

      expect(screen.getByRole("alert").textContent).toMatch(/budget carbone/i);
    });

    it("signale une session expirée (401)", async () => {
      await echouerAvec(new ApiError(401, "Token invalide ou expiré"));

      expect(screen.getByRole("alert").textContent).toMatch(/expiré/i);
    });

    it("signale une erreur serveur (500)", async () => {
      await echouerAvec(new ApiError(500, "Erreur interne"));

      expect(screen.getByRole("alert").textContent).toMatch(/erreur interne/i);
    });

    it("signale une panne réseau", async () => {
      await echouerAvec(new NetworkError("Le serveur est injoignable."));

      expect(screen.getByRole("alert").textContent).toMatch(/injoignable/i);
    });

    it("CONSERVE les valeurs saisies après un échec", async () => {
      await echouerAvec(new ApiError(500, "Panne"));

      // Les remettre à leur état d'origine ferait perdre à l'usager tout ce
      // qu'il vient de taper, en punition d'une panne réseau.
      expect(budget().value).toBe("1234");
    });

    it("n'annonce JAMAIS un succès après un échec", async () => {
      await echouerAvec(new ApiError(500, "Panne"));

      expect(screen.queryByText(/préférences enregistrées/i)).toBeNull();
    });

    it("permet de RÉESSAYER", async () => {
      await echouerAvec(new ApiError(500, "Panne"));

      expect(enregistrer().hasAttribute("disabled")).toBe(false);
      vi.mocked(enregistrerPreferences).mockResolvedValue(PREFERENCES);
      await userEvent.click(enregistrer());

      expect(await screen.findByText(/préférences enregistrées/i)).toBeDefined();
    });

    it("laisse la SESSION intacte après un échec", async () => {
      await echouerAvec(new ApiError(500, "Panne"));

      // Rien n'a été enregistré : la session ne doit surtout pas refléter une
      // valeur que le serveur a refusée.
      expect(screen.getByTestId("sonde").textContent).toBe("SYSTEM");
    });
  });

  // ---------------------------------------------------------------------------
  // Cohérence de session
  // ---------------------------------------------------------------------------
  describe("session", () => {
    it("met à jour l'utilisateur COURANT après un succès", async () => {
      authentifier();
      vi.mocked(enregistrerPreferences).mockResolvedValue({ ...PREFERENCES, theme: "DARK" });
      rendre();
      await waitFor(() => expect(screen.getByTestId("sonde").textContent).toBe("SYSTEM"));

      await userEvent.click(enregistrer());

      // Une seule source de vérité : le provider porte le profil, le
      // formulaire n'en garde pas une copie divergente.
      await waitFor(() => expect(screen.getByTestId("sonde").textContent).toBe("DARK"));
    });

    it("crée les préférences dans la session quand il n'y en avait AUCUNE", async () => {
      authentifier(null);
      vi.mocked(enregistrerPreferences).mockResolvedValue(PREFERENCES);
      rendre();
      await waitFor(() => expect(screen.getByTestId("sonde").textContent).toBe("aucune"));

      await userEvent.type(budget(), "5000");
      await userEvent.click(enregistrer());

      await waitFor(() => expect(screen.getByTestId("sonde").textContent).toBe("SYSTEM"));
    });

    it("repart du BACKEND au rechargement", async () => {
      // Simule un rechargement : un nouveau montage relit `/users/me`. Les
      // valeurs affichées viennent donc du serveur, jamais d'un cache local.
      authentifier({ ...PREFERENCES, co2BudgetWeekly: 8888, theme: "LIGHT" });
      rendre();

      await waitFor(() => expect(budget().value).toBe("8888"));
      expect(screen.getByTestId("sonde").textContent).toBe("LIGHT");
      // Aucun appel d'écriture n'a eu lieu au simple affichage.
      expect(enregistrerPreferences).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Accessibilité
  // ---------------------------------------------------------------------------
  describe("accessibilité", () => {
    it("associe chaque champ à un LABEL", async () => {
      authentifier();
      rendre();

      // `getByLabelText` échoue si l'association `htmlFor`/`id` est cassée :
      // ces requêtes SONT le test.
      expect(await screen.findByLabelText(/budget carbone hebdomadaire/i)).toBeDefined();
      expect(screen.getByLabelText("Thème")).toBeDefined();
      expect(screen.getByLabelText("Langue")).toBeDefined();
      expect(screen.getByLabelText(/fauteuil roulant/i)).toBeDefined();
    });

    it("groupe les modes dans un fieldset nommé", async () => {
      authentifier();
      rendre();

      // Sans `fieldset`/`legend`, un lecteur d'écran annoncerait sept cases
      // isolées, sans dire de quoi elles parlent.
      expect(
        await screen.findByRole("group", { name: /modes de transport favoris/i }),
      ).toBeDefined();
    });

    it("lie le message d'erreur au champ budget", async () => {
      authentifier();
      rendre();
      await waitFor(() => expect(budget().value).toBe("5000"));

      await userEvent.clear(budget());
      await userEvent.type(budget(), "-5");

      // `aria-invalid` signale l'état du champ lui-même, en plus du message.
      expect(budget().getAttribute("aria-invalid")).toBe("true");
      expect(budget().getAttribute("aria-describedby")).toBeTruthy();
    });

    it("annonce le succès en role=status, pas en alerte", async () => {
      authentifier();
      vi.mocked(enregistrerPreferences).mockResolvedValue(PREFERENCES);
      rendre();
      await waitFor(() => expect(budget().value).toBe("5000"));

      await userEvent.click(enregistrer());

      // Une confirmation n'a pas à interrompre la lecture en cours ; une
      // erreur, si.
      const statut = await screen.findByRole("status");
      expect(statut.textContent).toMatch(/préférences enregistrées/i);
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("ne transmet PAS le résultat par la seule couleur", async () => {
      authentifier();
      vi.mocked(enregistrerPreferences).mockResolvedValue(PREFERENCES);
      rendre();
      await waitFor(() => expect(budget().value).toBe("5000"));

      await userEvent.click(enregistrer());

      // Le mot « enregistrées » porte l'information ; le vert ne fait que la
      // renforcer (WCAG 1.4.1).
      expect((await screen.findByRole("status")).textContent).toMatch(/enregistrées/i);
    });
  });
});
