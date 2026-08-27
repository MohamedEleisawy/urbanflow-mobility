import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AuthForm } from "./AuthForm";
import { ApiError, NetworkError } from "@/lib/api";

// Tests du FORMULAIRE seul : il ne connaît ni l'API ni le stockage du jeton,
// puisqu'il reçoit son action en propriété. C'est ce qui les rend rapides et
// précis — un échec ici ne peut venir que du formulaire.
//
// Les champs sont retrouvés par leur LIBELLÉ, comme un usager les trouve —
// et non par un identifiant CSS. Un test qui passe par `getByLabelText`
// vérifie du même coup que le libellé est bien associé au champ : casser
// l'accessibilité casse le test.
const rendre = (onSubmit = vi.fn().mockResolvedValue(undefined)) => {
  render(
    <AuthForm
      titre="Se connecter"
      intituleBouton="Se connecter"
      autoCompleteMotDePasse="current-password"
      onSubmit={onSubmit}
    />,
  );
  return onSubmit;
};

const remplir = async (email = "usager@exemple.fr", mdp = "motdepasse123") => {
  const utilisateur = userEvent.setup();
  await utilisateur.type(screen.getByLabelText(/adresse email/i), email);
  await utilisateur.type(screen.getByLabelText(/mot de passe/i), mdp);
  return utilisateur;
};

describe("AuthForm", () => {
  describe("affichage", () => {
    it("affiche les deux champs et le bouton", () => {
      rendre();

      expect(screen.getByLabelText(/adresse email/i)).toBeDefined();
      expect(screen.getByLabelText(/mot de passe/i)).toBeDefined();
      expect(
        screen.getByRole("button", { name: /se connecter/i }),
      ).toBeDefined();
    });

    it("porte un titre de niveau 1", () => {
      rendre();

      // Un seul <h1> par page : c'est le repère principal d'un lecteur
      // d'écran.
      expect(screen.getByRole("heading", { level: 1 })).toBeDefined();
    });

    it("annonce la contrainte de longueur AVANT la saisie", () => {
      rendre();

      // Découvrir la règle après un refus du serveur est une mauvaise
      // expérience : on la dit d'emblée.
      expect(screen.getByText(/au moins 8 caractères/i)).toBeDefined();
      expect(
        screen.getByLabelText(/mot de passe/i).getAttribute("minlength"),
      ).toBe("8");
    });

    it("choisit le bon autocomplete selon l'écran", () => {
      render(
        <AuthForm
          titre="Créer un compte"
          intituleBouton="Créer mon compte"
          autoCompleteMotDePasse="new-password"
          onSubmit={vi.fn()}
        />,
      );

      // `new-password` fait SUGGÉRER un mot de passe par le gestionnaire du
      // navigateur ; `current-password` en propose un existant.
      expect(
        screen.getByLabelText(/mot de passe/i).getAttribute("autocomplete"),
      ).toBe("new-password");
    });

    it("n'affiche aucune erreur au départ", () => {
      rendre();

      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  describe("soumission", () => {
    it("transmet l'email et le mot de passe saisis", async () => {
      const onSubmit = rendre();
      const utilisateur = await remplir();

      await utilisateur.click(screen.getByRole("button"));

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          "usager@exemple.fr",
          "motdepasse123",
        );
      });
    });

    it("supprime les espaces autour de l'email", async () => {
      const onSubmit = rendre();
      const utilisateur = await remplir("  usager@exemple.fr  ");

      await utilisateur.click(screen.getByRole("button"));

      // Un espace collé par un copier-coller ne doit pas faire échouer une
      // connexion par ailleurs correcte.
      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith(
          "usager@exemple.fr",
          "motdepasse123",
        );
      });
    });

    it("désactive le bouton pendant l'envoi", async () => {
      let libere: () => void = () => {};
      const onSubmit = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            libere = resolve;
          }),
      );
      rendre(onSubmit);
      const utilisateur = await remplir();

      await utilisateur.click(screen.getByRole("button"));

      // Sans ce verrou, un double clic enverrait deux inscriptions — la
      // seconde échouant en 409.
      await waitFor(() => {
        expect(
          screen.getByRole("button").hasAttribute("disabled"),
        ).toBe(true);
      });

      libere();
    });
  });

  describe("erreurs", () => {
    it("affiche le message d'une erreur API", async () => {
      const onSubmit = vi
        .fn()
        .mockRejectedValue(new ApiError(401, "Email ou mot de passe incorrect"));
      rendre(onSubmit);
      const utilisateur = await remplir();

      await utilisateur.click(screen.getByRole("button"));

      const alerte = await screen.findByRole("alert");
      expect(alerte.textContent).toContain("Email ou mot de passe incorrect");
    });

    it("affiche un message lisible en cas de panne réseau", async () => {
      const onSubmit = vi
        .fn()
        .mockRejectedValue(new NetworkError("Le serveur est injoignable."));
      rendre(onSubmit);
      const utilisateur = await remplir();

      await utilisateur.click(screen.getByRole("button"));

      const alerte = await screen.findByRole("alert");
      expect(alerte.textContent).toContain("injoignable");
    });

    it("ne laisse JAMAIS fuir une erreur inattendue", async () => {
      const onSubmit = vi
        .fn()
        .mockRejectedValue(new TypeError("Cannot read properties of undefined"));
      rendre(onSubmit);
      const utilisateur = await remplir();

      await utilisateur.click(screen.getByRole("button"));

      const alerte = await screen.findByRole("alert");
      // Le détail technique reste hors de l'écran : l'usager voit un message
      // générique, pas une trace d'exécution.
      expect(alerte.textContent).toContain("erreur inattendue");
      expect(alerte.textContent).not.toContain("Cannot read properties");
    });

    it("relie le message d'erreur aux champs", async () => {
      const onSubmit = vi.fn().mockRejectedValue(new ApiError(401, "Refusé"));
      rendre(onSubmit);
      const utilisateur = await remplir();

      await utilisateur.click(screen.getByRole("button"));
      await screen.findByRole("alert");

      // `aria-describedby` fait annoncer l'erreur en atteignant le champ,
      // sans obliger à remonter dans la page.
      expect(
        screen.getByLabelText(/adresse email/i).getAttribute("aria-describedby"),
      ).toBeTruthy();
    });

    it("réactive le bouton après un échec", async () => {
      const onSubmit = vi.fn().mockRejectedValue(new ApiError(409, "Existe"));
      rendre(onSubmit);
      const utilisateur = await remplir();

      await utilisateur.click(screen.getByRole("button"));
      await screen.findByRole("alert");

      // Un échec ne doit pas condamner le formulaire : l'usager doit pouvoir
      // corriger et réessayer.
      expect(screen.getByRole("button").hasAttribute("disabled")).toBe(false);
    });

    it("efface l'erreur précédente à la nouvelle tentative", async () => {
      const onSubmit = vi
        .fn()
        .mockRejectedValueOnce(new ApiError(401, "Refusé"))
        .mockResolvedValueOnce(undefined);
      rendre(onSubmit);
      const utilisateur = await remplir();

      await utilisateur.click(screen.getByRole("button"));
      await screen.findByRole("alert");

      await utilisateur.click(screen.getByRole("button"));

      await waitFor(() => {
        expect(screen.queryByRole("alert")).toBeNull();
      });
    });
  });
});
