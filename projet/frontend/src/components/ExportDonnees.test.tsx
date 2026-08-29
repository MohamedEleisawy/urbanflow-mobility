import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "./AuthProvider";
import { ExportDonnees } from "./ExportDonnees";
import { ApiError, NetworkError } from "@/lib/api";
import type { ExportDonneesPersonnelles } from "@/lib/export-api";
import type { User } from "@/lib/types";

// =============================================================================
// Export des données personnelles — interface (bloc 5F-5)
// =============================================================================
// LE VRAI AuthProvider et le VRAI localStorage : c'est lui qui fournit le
// jeton. Seules les fonctions de `export-api` sont simulées — elles sont
// éprouvées séparément dans `export-api.test.ts`.
// =============================================================================

vi.mock("@/lib/auth-api", () => ({
  inscrire: vi.fn(),
  connecter: vi.fn(),
  utilisateurCourant: vi.fn(),
}));

vi.mock("@/lib/export-api", async (original) => ({
  // `nomDuFichier` n'est PAS simulée : c'est une fonction pure, et la laisser
  // réelle vérifie au passage que la page l'alimente avec `exportedAt`.
  ...(await original<typeof import("@/lib/export-api")>()),
  telechargerExport: vi.fn(),
  enregistrerFichier: vi.fn(),
}));

const { utilisateurCourant } = await import("@/lib/auth-api");
const { telechargerExport, enregistrerFichier } = await import("@/lib/export-api");

const PROFIL: User = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "usager@exemple.fr",
  role: "USER",
  createdAt: "2026-08-01T10:00:00.000Z",
  deletedAt: null,
  preferences: null,
};

const EXPORT: ExportDonneesPersonnelles = {
  version: 1,
  exportedAt: "2026-08-28T14:05:09.123Z",
  user: {
    id: PROFIL.id,
    email: PROFIL.email,
    role: "USER",
    createdAt: PROFIL.createdAt,
    deletedAt: null,
  },
  preferences: null,
  routes: [],
  carbonRecords: [],
  carbonBudgets: [],
};

const rendre = () =>
  render(
    <AuthProvider>
      <ExportDonnees />
    </AuthProvider>,
  );

const authentifier = () => {
  window.localStorage.setItem("urbanflow.token", "jeton-valide");
  vi.mocked(utilisateurCourant).mockResolvedValue(PROFIL);
};

const bouton = () => screen.getByRole("button", { name: /télécharger mes données/i });

describe("Export des données personnelles", () => {
  beforeEach(() => {
    vi.mocked(utilisateurCourant).mockReset();
    vi.mocked(telechargerExport).mockReset();
    vi.mocked(enregistrerFichier).mockReset();
  });

  // ---------------------------------------------------------------------------
  // Affichage
  // ---------------------------------------------------------------------------
  describe("affichage", () => {
    it("présente une section « Mes données personnelles »", async () => {
      authentifier();
      rendre();

      expect(
        await screen.findByRole("heading", { name: /mes données personnelles/i, level: 2 }),
      ).toBeDefined();
    });

    it("propose une action explicite", async () => {
      authentifier();
      rendre();

      // « Télécharger mes données » dit ce qui va se passer ; « Exporter »
      // seul laisserait deviner où le résultat atterrit.
      expect(bouton()).toBeDefined();
    });

    it("annonce ce que le fichier CONTIENT", async () => {
      authentifier();
      rendre();

      expect(screen.getByText(/vos trajets enregistrés/i)).toBeDefined();
      expect(screen.getByText(/empreintes carbone/i)).toBeDefined();
    });

    it("annonce ce que le fichier NE CONTIENT PAS", async () => {
      authentifier();
      rendre();

      // Un usager qui ne trouve pas son mot de passe doit comprendre que
      // c'est voulu, et non un oubli.
      expect(screen.getByText(/mot de passe n'y figure pas/i)).toBeDefined();
    });

    it("n'AFFICHE JAMAIS les données elles-mêmes", async () => {
      authentifier();
      vi.mocked(telechargerExport).mockResolvedValue(EXPORT);
      rendre();

      await userEvent.click(bouton());
      await screen.findByText(/fichier téléchargé/i);

      // Les données transitent en mémoire le temps d'écrire un fichier, et
      // rien de plus : les montrer les exposerait à quiconque regarde
      // l'écran.
      expect(document.body.textContent).not.toContain(PROFIL.id);
      expect(document.body.textContent).not.toContain("carbonRecords");
    });
  });

  // ---------------------------------------------------------------------------
  // Téléchargement
  // ---------------------------------------------------------------------------
  describe("téléchargement", () => {
    it("transmet le jeton de la session", async () => {
      authentifier();
      vi.mocked(telechargerExport).mockResolvedValue(EXPORT);
      rendre();

      await userEvent.click(bouton());

      // Le jeton vient d'AuthProvider : aucune lecture directe de
      // localStorage dans le composant.
      await waitFor(() => expect(telechargerExport).toHaveBeenCalledWith("jeton-valide"));
    });

    it("remet le fichier au navigateur avec un nom DATÉ", async () => {
      authentifier();
      vi.mocked(telechargerExport).mockResolvedValue(EXPORT);
      rendre();

      await userEvent.click(bouton());

      await waitFor(() =>
        expect(enregistrerFichier).toHaveBeenCalledWith(
          EXPORT,
          "urbanflow-donnees-personnelles-2026-08-28.json",
        ),
      );
    });

    it("annonce la préparation et DÉSACTIVE le bouton", async () => {
      authentifier();
      vi.mocked(telechargerExport).mockReturnValue(new Promise(() => {}));
      rendre();

      await userEvent.click(bouton());

      const enCours = await screen.findByRole("button", { name: /préparation du fichier/i });
      expect(enCours.hasAttribute("disabled")).toBe(true);
    });

    it("EMPÊCHE un double téléchargement", async () => {
      authentifier();
      vi.mocked(telechargerExport).mockReturnValue(new Promise(() => {}));
      rendre();

      await userEvent.click(bouton());
      await userEvent.click(screen.getByRole("button", { name: /préparation du fichier/i }));

      // Deux clics lanceraient deux requêtes et deux téléchargements du même
      // fichier.
      expect(telechargerExport).toHaveBeenCalledTimes(1);
    });

    it("ne confirme QU'APRÈS la remise du fichier", async () => {
      authentifier();
      let repondre: (e: ExportDonneesPersonnelles) => void = () => {};
      vi.mocked(telechargerExport).mockReturnValue(
        new Promise((resoudre) => {
          repondre = resoudre;
        }),
      );
      rendre();

      await userEvent.click(bouton());
      expect(screen.queryByText(/fichier téléchargé/i)).toBeNull();
      expect(enregistrerFichier).not.toHaveBeenCalled();

      repondre(EXPORT);

      expect(await screen.findByText(/fichier téléchargé/i)).toBeDefined();
    });

    it("nomme le fichier dans la confirmation", async () => {
      authentifier();
      vi.mocked(telechargerExport).mockResolvedValue(EXPORT);
      rendre();

      await userEvent.click(bouton());

      // Sur un téléphone, le fichier atterrit dans un dossier que l'usager
      // devra retrouver : son nom lui est utile.
      expect(
        await screen.findByText(/urbanflow-donnees-personnelles-2026-08-28\.json/),
      ).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Erreurs
  // ---------------------------------------------------------------------------
  describe("erreurs", () => {
    const echouerAvec = async (erreur: unknown) => {
      authentifier();
      vi.mocked(telechargerExport).mockRejectedValue(erreur);
      rendre();

      await userEvent.click(bouton());
      await screen.findByText(/le téléchargement a échoué/i);
    };

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

    it("NE TÉLÉCHARGE RIEN après un échec", async () => {
      await echouerAvec(new ApiError(500, "Panne"));

      // Un fichier vide ou partiel serait pire que pas de fichier du tout.
      expect(enregistrerFichier).not.toHaveBeenCalled();
    });

    it("n'annonce JAMAIS un succès après un échec", async () => {
      await echouerAvec(new ApiError(500, "Panne"));

      expect(screen.queryByText(/fichier téléchargé/i)).toBeNull();
    });

    it("permet de RÉESSAYER", async () => {
      await echouerAvec(new NetworkError("Le serveur est injoignable."));

      expect(bouton().hasAttribute("disabled")).toBe(false);
      vi.mocked(telechargerExport).mockResolvedValue(EXPORT);
      await userEvent.click(bouton());

      expect(await screen.findByText(/fichier téléchargé/i)).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Accessibilité
  // ---------------------------------------------------------------------------
  describe("accessibilité", () => {
    it("annonce le succès en role=status", async () => {
      authentifier();
      vi.mocked(telechargerExport).mockResolvedValue(EXPORT);
      rendre();

      await userEvent.click(bouton());

      // Une confirmation n'a pas à interrompre la lecture ; une erreur, si.
      const statut = await screen.findByRole("status");
      expect(statut.textContent).toMatch(/fichier téléchargé/i);
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("ne transmet PAS le résultat par la seule couleur", async () => {
      authentifier();
      vi.mocked(telechargerExport).mockResolvedValue(EXPORT);
      rendre();

      await userEvent.click(bouton());

      // Le mot « téléchargé » porte l'information ; le vert ne fait que la
      // renforcer (WCAG 1.4.1).
      expect((await screen.findByRole("status")).textContent).toMatch(/téléchargé/i);
    });

    it("s'utilise au CLAVIER", async () => {
      authentifier();
      vi.mocked(telechargerExport).mockResolvedValue(EXPORT);
      rendre();

      bouton().focus();
      await userEvent.keyboard("{Enter}");

      // Un vrai `<button>`, et non un `<div>` cliquable : il est atteignable
      // par tabulation et s'active à Entrée comme à Espace.
      await waitFor(() => expect(telechargerExport).toHaveBeenCalled());
    });
  });
});
