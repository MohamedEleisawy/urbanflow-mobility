import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthProvider";
import { SupprimerCompte } from "./SupprimerCompte";
import { ApiError, NetworkError } from "@/lib/api";
import type { User } from "@/lib/types";

// =============================================================================
// Suppression du compte — interface (bloc 5G)
// =============================================================================
// LE VRAI AuthProvider et le VRAI localStorage : c'est lui qui détient le
// jeton, et c'est lui qui doit l'oublier après une suppression réussie. Le
// simuler ne prouverait rien du nettoyage de session, qui est l'essentiel ici.
// =============================================================================

const remplacer = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: remplacer, push: vi.fn() }),
}));

vi.mock("@/lib/auth-api", () => ({
  inscrire: vi.fn(),
  connecter: vi.fn(),
  utilisateurCourant: vi.fn(),
}));

vi.mock("@/lib/compte-api", () => ({
  supprimerMonCompte: vi.fn(),
}));

const { utilisateurCourant } = await import("@/lib/auth-api");
const { supprimerMonCompte } = await import("@/lib/compte-api");

const PROFIL: User = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "usager@exemple.fr",
  role: "USER",
  createdAt: "2026-08-01T10:00:00.000Z",
  deletedAt: null,
  preferences: null,
};

/// Sonde : montre ce que la SESSION contient encore.
function Sonde() {
  const { statut } = useAuth();
  return <p data-testid="sonde">{statut}</p>;
}

const rendre = () =>
  render(
    <AuthProvider>
      <Sonde />
      <SupprimerCompte />
    </AuthProvider>,
  );

const authentifier = () => {
  window.localStorage.setItem("urbanflow.token", "jeton-valide");
  vi.mocked(utilisateurCourant).mockResolvedValue(PROFIL);
};

const ouvrir = () => screen.getByRole("button", { name: /^supprimer mon compte$/i });
const confirmer = () => screen.getByRole("button", { name: /confirmer la suppression/i });
const annuler = () => screen.getByRole("button", { name: /annuler/i });

/// Affiche le composant authentifié, puis ouvre la confirmation.
const demanderSuppression = async () => {
  const utilisateur = userEvent.setup();
  await utilisateur.click(await screen.findByRole("button", { name: /^supprimer mon compte$/i }));
  return utilisateur;
};

describe("Suppression du compte", () => {
  beforeEach(() => {
    remplacer.mockReset();
    vi.mocked(utilisateurCourant).mockReset();
    vi.mocked(supprimerMonCompte).mockReset();
    authentifier();
  });

  // ---------------------------------------------------------------------------
  // Confirmation
  // ---------------------------------------------------------------------------
  describe("confirmation", () => {
    it("présente une « Zone de danger » nommée", async () => {
      rendre();

      // Le MOT porte l'avertissement : un encadré rouge ne dirait rien à qui
      // ne perçoit pas la couleur (WCAG 1.4.1).
      expect(
        await screen.findByRole("heading", { name: /zone de danger/i, level: 2 }),
      ).toBeDefined();
      expect(ouvrir()).toBeDefined();
    });

    it("le PREMIER clic ne supprime RIEN", async () => {
      rendre();

      await demanderSuppression();

      // L'action la plus destructive de l'application ne part pas sur un seul
      // geste.
      expect(supprimerMonCompte).not.toHaveBeenCalled();
    });

    it("ÉNUMÈRE les conséquences, une par une", async () => {
      rendre();

      await demanderSuppression();

      // « Cette action est irréversible » est vrai mais vague : l'usager doit
      // savoir exactement ce qu'il perd. Assertions portées sur la LISTE :
      // le mot « définitive » figure aussi dans la question de confirmation
      // juste au-dessus.
      const consequences = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
      expect(consequences).toHaveLength(4);
      expect(consequences.join(" ")).toMatch(/immédiatement déconnecté/i);
      expect(consequences.join(" ")).toMatch(/plus vous reconnecter/i);
      expect(consequences.join(" ")).toMatch(/historique/i);
      expect(consequences.join(" ")).toMatch(/définitive/i);
    });

    it("conseille de télécharger ses données AVANT", async () => {
      rendre();

      await demanderSuppression();

      // Conseil utile et honnête : l'export ne fonctionne que tant que le
      // compte est actif.
      expect(screen.getByText(/télécharger vos données/i)).toBeDefined();
    });

    it("place le focus sur ANNULER, pas sur Confirmer", async () => {
      rendre();

      await demanderSuppression();

      // Sur une action irréversible, le geste par défaut doit être celui qui
      // ne détruit rien : appuyer sur Entrée ne doit pas supprimer le compte.
      await waitFor(() => expect(document.activeElement).toBe(annuler()));
    });

    it("annule sans AUCUN appel réseau", async () => {
      rendre();
      const utilisateur = await demanderSuppression();

      await utilisateur.click(annuler());

      expect(supprimerMonCompte).not.toHaveBeenCalled();
      expect(ouvrir()).toBeDefined();
      expect(screen.queryByText(/confirmer la suppression définitive/i)).toBeNull();
    });

    it("garde la SESSION intacte pendant la confirmation", async () => {
      rendre();

      await demanderSuppression();

      expect(screen.getByTestId("sonde").textContent).toBe("authentifie");
      expect(window.localStorage.getItem("urbanflow.token")).toBe("jeton-valide");
    });
  });

  // ---------------------------------------------------------------------------
  // Appel et succès
  // ---------------------------------------------------------------------------
  describe("suppression", () => {
    it("transmet le jeton de la session", async () => {
      vi.mocked(supprimerMonCompte).mockResolvedValue(undefined);
      rendre();
      const utilisateur = await demanderSuppression();

      await utilisateur.click(confirmer());

      await waitFor(() => expect(supprimerMonCompte).toHaveBeenCalledWith("jeton-valide"));
    });

    it("n'appelle DELETE qu'une seule fois", async () => {
      vi.mocked(supprimerMonCompte).mockResolvedValue(undefined);
      rendre();
      const utilisateur = await demanderSuppression();

      await utilisateur.click(confirmer());

      await waitFor(() => expect(supprimerMonCompte).toHaveBeenCalledTimes(1));
    });

    it("annonce l'envoi et DÉSACTIVE les deux boutons", async () => {
      vi.mocked(supprimerMonCompte).mockReturnValue(new Promise(() => {}));
      rendre();
      const utilisateur = await demanderSuppression();

      await utilisateur.click(confirmer());

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /suppression en cours/i }).hasAttribute("disabled"),
        ).toBe(true);
        // Annuler n'annulerait rien d'une requête déjà partie.
        expect(annuler().hasAttribute("disabled")).toBe(true);
      });
    });

    it("EMPÊCHE une double soumission", async () => {
      vi.mocked(supprimerMonCompte).mockReturnValue(new Promise(() => {}));
      rendre();
      const utilisateur = await demanderSuppression();

      await utilisateur.click(confirmer());
      await utilisateur.click(screen.getByRole("button", { name: /suppression en cours/i }));

      expect(supprimerMonCompte).toHaveBeenCalledTimes(1);
    });

    it("NE NETTOIE PAS la session avant la réponse du serveur", async () => {
      vi.mocked(supprimerMonCompte).mockReturnValue(new Promise(() => {}));
      rendre();
      const utilisateur = await demanderSuppression();

      await utilisateur.click(confirmer());
      await screen.findByRole("button", { name: /suppression en cours/i });

      // Effacer le jeton avant confirmation laisserait l'usager déconnecté
      // d'un compte toujours actif si la requête échouait.
      expect(window.localStorage.getItem("urbanflow.token")).toBe("jeton-valide");
      expect(remplacer).not.toHaveBeenCalled();
    });

    it("NETTOIE la session après le succès", async () => {
      vi.mocked(supprimerMonCompte).mockResolvedValue(undefined);
      rendre();
      const utilisateur = await demanderSuppression();

      await utilisateur.click(confirmer());

      // Le jeton ne vaut plus rien — le backend le refuse partout — et le
      // garder ne produirait que des 401 déroutants.
      await waitFor(() => expect(window.localStorage.getItem("urbanflow.token")).toBeNull());
      expect(screen.getByTestId("sonde").textContent).toBe("anonyme");
    });

    it("redirige vers l'accueil APRÈS le succès", async () => {
      vi.mocked(supprimerMonCompte).mockResolvedValue(undefined);
      rendre();
      const utilisateur = await demanderSuppression();

      await utilisateur.click(confirmer());

      // `replace` : revenir en arrière ramènerait sur un espace personnel
      // devenu inaccessible.
      await waitFor(() => expect(remplacer).toHaveBeenCalledWith("/"));
    });
  });

  // ---------------------------------------------------------------------------
  // Erreurs
  // ---------------------------------------------------------------------------
  describe("erreurs", () => {
    const echouerAvec = async (erreur: unknown) => {
      vi.mocked(supprimerMonCompte).mockRejectedValue(erreur);
      rendre();
      const utilisateur = await demanderSuppression();
      await utilisateur.click(confirmer());
      await screen.findByText(/n'a pas pu être supprimé/i);
      return utilisateur;
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

    it("CONSERVE la session après un échec", async () => {
      await echouerAvec(new ApiError(500, "Panne"));

      // Rien n'a été supprimé côté serveur : déconnecter l'usager le
      // punirait d'une panne.
      expect(window.localStorage.getItem("urbanflow.token")).toBe("jeton-valide");
      expect(screen.getByTestId("sonde").textContent).toBe("authentifie");
    });

    it("NE REDIRIGE PAS après un échec", async () => {
      await echouerAvec(new ApiError(500, "Panne"));

      expect(remplacer).not.toHaveBeenCalled();
    });

    it("DIT que le compte est toujours actif", async () => {
      await echouerAvec(new ApiError(500, "Panne"));

      // Laisser l'usager dans le doute sur l'état de son compte serait pire
      // que l'échec lui-même.
      expect(screen.getByRole("alert").textContent).toMatch(/toujours actif/i);
    });

    it("permet de RÉESSAYER", async () => {
      const utilisateur = await echouerAvec(new ApiError(500, "Panne"));

      expect(confirmer().hasAttribute("disabled")).toBe(false);
      vi.mocked(supprimerMonCompte).mockResolvedValue(undefined);
      await utilisateur.click(confirmer());

      await waitFor(() => expect(remplacer).toHaveBeenCalledWith("/"));
    });

    it("permet de RENONCER après un échec", async () => {
      const utilisateur = await echouerAvec(new ApiError(500, "Panne"));

      await utilisateur.click(annuler());

      expect(ouvrir()).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Accessibilité
  // ---------------------------------------------------------------------------
  describe("accessibilité", () => {
    it("annonce l'échec en role=alert", async () => {
      vi.mocked(supprimerMonCompte).mockRejectedValue(new ApiError(500, "Panne"));
      rendre();
      const utilisateur = await demanderSuppression();

      await utilisateur.click(confirmer());

      // Un échec sur une action destructive doit être entendu tout de suite.
      expect((await screen.findByRole("alert")).textContent).toMatch(/n'a pas pu être supprimé/i);
    });

    it("s'utilise entièrement au CLAVIER", async () => {
      vi.mocked(supprimerMonCompte).mockResolvedValue(undefined);
      rendre();
      const utilisateur = userEvent.setup();

      (await screen.findByRole("button", { name: /^supprimer mon compte$/i })).focus();
      await utilisateur.keyboard("{Enter}");

      // Le focus a suivi sur Annuler : appuyer encore sur Entrée ANNULE, il
      // ne supprime pas.
      await waitFor(() => expect(document.activeElement).toBe(annuler()));
      await utilisateur.keyboard("{Enter}");

      expect(supprimerMonCompte).not.toHaveBeenCalled();
      expect(ouvrir()).toBeDefined();
    });

    it("ne signale PAS le danger par la seule couleur", async () => {
      rendre();

      await demanderSuppression();

      // Chaque avertissement est un texte : titre de section, question de
      // confirmation, liste des conséquences.
      expect(screen.getByRole("heading", { name: /zone de danger/i })).toBeDefined();
      expect(screen.getByText(/confirmer la suppression définitive/i)).toBeDefined();
    });
  });
});
