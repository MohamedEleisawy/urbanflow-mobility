import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdressesFavorites } from "./AdressesFavorites";
import { AuthProvider } from "@/components/AuthProvider";
import { ApiError, NetworkError } from "@/lib/api";
import type { FavoriteAddress, User } from "@/lib/types";

// =============================================================================
// Mes adresses favorites (bloc 7-7)
// =============================================================================
// SEUL LE RÉSEAU EST SIMULÉ. Le vrai `AuthProvider`, le vrai `localStorage` de
// jsdom, le vrai composant : c'est la chaîne complète qu'on éprouve.
// =============================================================================

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/mon-espace",
}));

vi.mock("@/lib/auth-api", () => ({
  inscrire: vi.fn(),
  connecter: vi.fn(),
  utilisateurCourant: vi.fn(),
}));

vi.mock("@/lib/adresses-api", () => ({
  listerAdresses: vi.fn(),
  creerAdresse: vi.fn(),
  modifierAdresse: vi.fn(),
  supprimerAdresse: vi.fn(),
}));

const { utilisateurCourant } = await import("@/lib/auth-api");
const { listerAdresses, creerAdresse, modifierAdresse, supprimerAdresse } =
  await import("@/lib/adresses-api");

const PROFIL: User = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "usager@exemple.fr",
  role: "USER",
  createdAt: "2026-08-01T10:00:00.000Z",
  deletedAt: null,
  preferences: null,
};

const DOMICILE: FavoriteAddress = {
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  type: "HOME",
  address: "12 rue des Lilas, 75011 Paris",
  latitude: 48.8566,
  longitude: 2.3522,
  createdAt: "2026-08-30T10:00:00.000Z",
};

const TRAVAIL: FavoriteAddress = {
  id: "bbbbbbbb-0000-0000-0000-000000000002",
  type: "WORK",
  address: "3 avenue de la Gare, 75012 Paris",
  latitude: 48.8443,
  longitude: 2.3735,
  createdAt: "2026-08-30T11:00:00.000Z",
};

const monter = () => {
  window.localStorage.setItem("urbanflow.token", "jeton-valide");
  vi.mocked(utilisateurCourant).mockResolvedValue(PROFIL);

  return render(
    <AuthProvider>
      <AdressesFavorites />
    </AuthProvider>,
  );
};

/// Le bloc « Domicile » ou « Travail », comme unité de test.
const bloc = async (nom: "Domicile" | "Travail") => {
  const titre = await screen.findByRole("heading", { level: 3, name: nom });
  return titre.closest("div.rounded-lg") as HTMLElement;
};

/// Ouvre le formulaire d'un emplacement et rend l'utilitaire d'événements.
const ouvrirFormulaire = async (nom: "Domicile" | "Travail", action: "Ajouter" | "Modifier") => {
  const usager = userEvent.setup();
  monter();

  await usager.click(await screen.findByRole("button", { name: `${action} l'adresse ${nom}` }));

  return usager;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listerAdresses).mockResolvedValue([]);
  vi.mocked(creerAdresse).mockResolvedValue(DOMICILE);
  vi.mocked(modifierAdresse).mockResolvedValue(DOMICILE);
  vi.mocked(supprimerAdresse).mockResolvedValue(undefined);
});

// ===========================================================================
// Affichage
// ===========================================================================
describe("affichage", () => {
  it("montre TOUJOURS les deux emplacements, même vides", async () => {
    monter();

    // Le backend borne le modèle à deux places : l'écran le reflète par deux
    // blocs fixes. Une liste avec « ajouter » laisserait croire qu'on peut en
    // créer une troisième, et le 409 serait vécu comme un bug.
    expect(await screen.findByRole("heading", { level: 3, name: "Domicile" })).toBeDefined();
    expect(screen.getByRole("heading", { level: 3, name: "Travail" })).toBeDefined();
    expect(screen.getAllByText("Aucune adresse enregistrée.")).toHaveLength(2);
  });

  it("affiche l'adresse et ses coordonnées", async () => {
    vi.mocked(listerAdresses).mockResolvedValue([DOMICILE]);

    monter();

    const domicile = await bloc("Domicile");
    expect(within(domicile).getByText(DOMICILE.address)).toBeDefined();
    // Les coordonnées sont AFFICHÉES : ce sont elles que la recherche
    // utilise, et l'usager les a saisies. Les masquer rendrait une faute de
    // frappe indétectable.
    expect(within(domicile).getByText("48.8566, 2.3522")).toBeDefined();
  });

  it("place chaque adresse dans SON emplacement", async () => {
    vi.mocked(listerAdresses).mockResolvedValue([TRAVAIL, DOMICILE]);

    monter();

    const domicile = await bloc("Domicile");
    const travail = await bloc("Travail");

    // Ordre d'arrivée volontairement inversé : le composant ne doit pas
    // supposer que la liste est triée pour l'affecter au bon bloc.
    expect(within(domicile).getByText(DOMICILE.address)).toBeDefined();
    expect(within(travail).getByText(TRAVAIL.address)).toBeDefined();
  });

  it("affiche un état de chargement", async () => {
    vi.mocked(listerAdresses).mockReturnValue(new Promise(() => {}));

    monter();

    expect(await screen.findByText("Chargement de vos adresses…")).toBeDefined();
  });

  it("affiche une erreur de chargement", async () => {
    vi.mocked(listerAdresses).mockRejectedValue(new NetworkError("Serveur injoignable."));

    monter();

    expect(await screen.findByText(/Vos adresses n'ont pas pu être chargées/)).toBeDefined();
  });

  it("transmet le jeton", async () => {
    monter();
    await screen.findByRole("heading", { level: 3, name: "Domicile" });

    expect(listerAdresses).toHaveBeenCalledWith("jeton-valide", expect.anything());
  });

  it("propose « Ajouter » sur un emplacement vide, « Modifier » sinon", async () => {
    vi.mocked(listerAdresses).mockResolvedValue([DOMICILE]);

    monter();

    expect(
      await screen.findByRole("button", { name: "Modifier l'adresse Domicile" }),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Ajouter l'adresse Travail" })).toBeDefined();
    // Rien à supprimer là où rien n'est enregistré.
    expect(screen.queryByRole("button", { name: "Supprimer l'adresse Travail" })).toBeNull();
  });
});

// ===========================================================================
// Création
// ===========================================================================
describe("création", () => {
  const remplir = async (
    usager: ReturnType<typeof userEvent.setup>,
    valeurs: { adresse?: string; lat?: string; lng?: string },
  ) => {
    if (valeurs.adresse) {
      await usager.type(screen.getByLabelText("Adresse"), valeurs.adresse);
    }
    if (valeurs.lat) {
      await usager.type(screen.getByLabelText("Latitude"), valeurs.lat);
    }
    if (valeurs.lng) {
      await usager.type(screen.getByLabelText("Longitude"), valeurs.lng);
    }
  };

  it("envoie EXACTEMENT ce qui est saisi", async () => {
    const usager = await ouvrirFormulaire("Domicile", "Ajouter");

    await remplir(usager, {
      adresse: "12 rue des Lilas, 75011 Paris",
      lat: "48.8566",
      lng: "2.3522",
    });
    await usager.click(screen.getByRole("button", { name: "Enregistrer" }));

    // Aucun rognage, aucun arrondi, aucun géocodage : le projet conserve ce
    // qu'on lui confie.
    await waitFor(() => {
      expect(creerAdresse).toHaveBeenCalledWith("jeton-valide", {
        type: "HOME",
        address: "12 rue des Lilas, 75011 Paris",
        latitude: 48.8566,
        longitude: 2.3522,
      });
    });
  });

  it("envoie le type WORK depuis le bloc Travail", async () => {
    const usager = await ouvrirFormulaire("Travail", "Ajouter");

    await remplir(usager, { adresse: "3 avenue de la Gare", lat: "48.8443", lng: "2.3735" });
    await usager.click(screen.getByRole("button", { name: "Enregistrer" }));

    // Chaque bloc est FIXÉ à son emplacement : le type ne peut pas se
    // tromper de case.
    await waitFor(() => {
      expect(vi.mocked(creerAdresse).mock.calls[0][1].type).toBe("WORK");
    });
  });

  it("affiche l'adresse dès la réponse, sans recharger la liste", async () => {
    const usager = await ouvrirFormulaire("Domicile", "Ajouter");

    await remplir(usager, { adresse: "12 rue des Lilas", lat: "48.8566", lng: "2.3522" });
    await usager.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(await screen.findByText(DOMICILE.address)).toBeDefined();
    // La réponse du serveur EST la vérité : redemander la liste coûterait un
    // aller-retour pour réapprendre ce qu'on vient d'apprendre.
    expect(listerAdresses).toHaveBeenCalledTimes(1);
  });

  it("empêche la double soumission", async () => {
    let resoudre: (a: FavoriteAddress) => void = () => {};
    vi.mocked(creerAdresse).mockReturnValue(
      new Promise<FavoriteAddress>((r) => {
        resoudre = r;
      }),
    );

    const usager = await ouvrirFormulaire("Domicile", "Ajouter");
    await remplir(usager, { adresse: "12 rue des Lilas", lat: "48.8566", lng: "2.3522" });
    await usager.click(screen.getByRole("button", { name: "Enregistrer" }));

    const bouton = await screen.findByRole("button", { name: "Enregistrement…" });
    expect(bouton).toHaveProperty("disabled", true);

    resoudre(DOMICILE);
  });

  it("affiche l'erreur du backend SANS effacer la saisie", async () => {
    vi.mocked(creerAdresse).mockRejectedValue(
      new ApiError(409, "Vous avez déjà une adresse de domicile."),
    );

    const usager = await ouvrirFormulaire("Domicile", "Ajouter");
    await remplir(usager, { adresse: "12 rue des Lilas", lat: "48.8566", lng: "2.3522" });
    await usager.click(screen.getByRole("button", { name: "Enregistrer" }));

    const alerte = await screen.findByRole("alert");
    expect(alerte.textContent).toContain("déjà une adresse de domicile");
    // L'usager peut corriger sans tout ressaisir.
    expect(screen.getByLabelText("Adresse")).toHaveProperty("value", "12 rue des Lilas");
  });

  it("annuler referme le formulaire sans rien envoyer", async () => {
    const usager = await ouvrirFormulaire("Domicile", "Ajouter");

    await usager.click(screen.getByRole("button", { name: "Annuler" }));

    expect(screen.queryByLabelText("Adresse")).toBeNull();
    expect(creerAdresse).not.toHaveBeenCalled();
  });

  describe("validation locale", () => {
    const refuse = async (
      valeurs: { adresse?: string; lat?: string; lng?: string },
      motif: RegExp,
    ) => {
      const usager = await ouvrirFormulaire("Domicile", "Ajouter");
      await remplir(usager, valeurs);
      await usager.click(screen.getByRole("button", { name: "Enregistrer" }));

      expect((await screen.findByRole("alert")).textContent).toMatch(motif);
      // AUCUNE requête : on n'envoie pas ce qu'on sait refusé.
      expect(creerAdresse).not.toHaveBeenCalled();
    };

    it("refuse une adresse vide", async () => {
      await refuse({ lat: "48.8", lng: "2.3" }, /Renseignez une adresse/);
    });

    it("refuse une latitude absente", async () => {
      await refuse({ adresse: "x", lng: "2.3" }, /latitude doit être un nombre/);
    });

    it("refuse une coordonnée non numérique", async () => {
      await refuse({ adresse: "x", lat: "abc", lng: "2.3" }, /latitude doit être un nombre/);
    });

    it("refuse une latitude hors bornes", async () => {
      await refuse({ adresse: "x", lat: "91", lng: "2.3" }, /entre -90 et 90/);
    });

    it("refuse une longitude hors bornes", async () => {
      await refuse({ adresse: "x", lat: "48.8", lng: "181" }, /entre -180 et 180/);
    });

    it("un champ vide n'est JAMAIS interprété comme 0", async () => {
      // `Number("")` vaut 0 — une coordonnée parfaitement valide au large du
      // golfe de Guinée. Sans ce contrôle, un champ oublié enverrait un point
      // en plein océan sans que rien ne le signale.
      await refuse({ adresse: "x", lat: "", lng: "2.3" }, /latitude doit être un nombre/);
    });
  });
});

// ===========================================================================
// Modification
// ===========================================================================
describe("modification", () => {
  it("pré-remplit le formulaire avec l'adresse existante", async () => {
    vi.mocked(listerAdresses).mockResolvedValue([DOMICILE]);
    await ouvrirFormulaire("Domicile", "Modifier");

    expect(screen.getByLabelText("Adresse")).toHaveProperty("value", DOMICILE.address);
    expect(screen.getByLabelText("Latitude")).toHaveProperty("value", "48.8566");
    expect(screen.getByLabelText("Longitude")).toHaveProperty("value", "2.3522");
  });

  it("appelle PATCH avec le BON identifiant", async () => {
    vi.mocked(listerAdresses).mockResolvedValue([DOMICILE]);
    const usager = await ouvrirFormulaire("Domicile", "Modifier");

    await usager.clear(screen.getByLabelText("Adresse"));
    await usager.type(screen.getByLabelText("Adresse"), "99 boulevard Neuf");
    await usager.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => {
      expect(modifierAdresse).toHaveBeenCalledWith("jeton-valide", DOMICILE.id, {
        type: "HOME",
        address: "99 boulevard Neuf",
        latitude: 48.8566,
        longitude: 2.3522,
      });
    });
    // Modifier, pas créer : la place est déjà occupée, un POST rendrait 409.
    expect(creerAdresse).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Suppression
// ===========================================================================
describe("suppression", () => {
  const demanderSuppression = async () => {
    vi.mocked(listerAdresses).mockResolvedValue([DOMICILE]);
    const usager = userEvent.setup();
    monter();

    await usager.click(await screen.findByRole("button", { name: "Supprimer l'adresse Domicile" }));

    return usager;
  };

  it("le premier clic n'appelle RIEN : il demande confirmation", async () => {
    await demanderSuppression();

    expect(screen.getByText("Supprimer votre adresse Domicile ?")).toBeDefined();
    expect(supprimerAdresse).not.toHaveBeenCalled();
  });

  it("le focus va sur « Annuler »", async () => {
    await demanderSuppression();

    // Le geste par défaut au clavier ne doit rien détruire.
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe("Annuler");
    });
  });

  it("annuler referme sans rien appeler", async () => {
    const usager = await demanderSuppression();

    await usager.click(screen.getByRole("button", { name: "Annuler" }));

    expect(screen.queryByText("Supprimer votre adresse Domicile ?")).toBeNull();
    expect(supprimerAdresse).not.toHaveBeenCalled();
  });

  it("confirmer appelle DELETE et vide l'emplacement", async () => {
    const usager = await demanderSuppression();

    await usager.click(
      screen.getByRole("button", { name: "Confirmer la suppression de l'adresse Domicile" }),
    );

    await waitFor(() => {
      expect(supprimerAdresse).toHaveBeenCalledWith("jeton-valide", DOMICILE.id);
    });
    // Le bloc reste, VIDE : les deux emplacements sont permanents. On cherche
    // dans le bloc Domicile — les DEUX portent désormais le même texte.
    await waitFor(() => {
      expect(screen.queryByText(DOMICILE.address)).toBeNull();
    });
    const domicile = await bloc("Domicile");
    expect(within(domicile).getByText("Aucune adresse enregistrée.")).toBeDefined();
  });

  it("affiche l'erreur et CONSERVE l'adresse", async () => {
    vi.mocked(supprimerAdresse).mockRejectedValue(new ApiError(404, "Adresse introuvable"));
    const usager = await demanderSuppression();

    await usager.click(
      screen.getByRole("button", { name: "Confirmer la suppression de l'adresse Domicile" }),
    );

    expect((await screen.findByRole("alert")).textContent).toMatch(/n'a pas pu être supprimée/);
    // Rien n'a disparu de l'écran.
    expect(screen.getByText(DOMICILE.address)).toBeDefined();
  });
});

// ===========================================================================
// Accessibilité
// ===========================================================================
describe("accessibilité", () => {
  it("chaque bouton nomme l'emplacement concerné", async () => {
    vi.mocked(listerAdresses).mockResolvedValue([DOMICILE, TRAVAIL]);
    monter();

    // « Modifier » répété quatre fois serait indistinguable hors contexte.
    expect(
      await screen.findByRole("button", { name: "Modifier l'adresse Domicile" }),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Modifier l'adresse Travail" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Supprimer l'adresse Domicile" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Supprimer l'adresse Travail" })).toBeDefined();
  });

  it("chaque champ porte un libellé lié", async () => {
    await ouvrirFormulaire("Domicile", "Ajouter");

    // `getByLabelText` échouerait si le `for`/`id` ne se répondaient pas.
    expect(screen.getByLabelText("Adresse")).toBeDefined();
    expect(screen.getByLabelText("Latitude")).toBeDefined();
    expect(screen.getByLabelText("Longitude")).toBeDefined();
  });

  it("explique que l'application ne géocode pas", async () => {
    await ouvrirFormulaire("Domicile", "Ajouter");

    // Sans cette phrase, l'usager chercherait pourquoi on lui demande des
    // chiffres qu'il ne sait pas où trouver.
    expect(screen.getByText(/ne les devine pas à partir de l'adresse/)).toBeDefined();
  });

  it("titre la section", async () => {
    monter();

    expect(
      await screen.findByRole("heading", { level: 2, name: "Mes adresses favorites" }),
    ).toBeDefined();
  });
});
