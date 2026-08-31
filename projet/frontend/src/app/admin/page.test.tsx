import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminPage from "./page";
import { AuthProvider } from "@/components/AuthProvider";
import { ApiError, NetworkError } from "@/lib/api";
import type { AdminStats, AdminUser, AdminUsersPage, User } from "@/lib/types";

// =============================================================================
// Back-office administrateur (bloc 6-6)
// =============================================================================
// SEUL LE RÉSEAU EST SIMULÉ. Le vrai `AuthProvider`, le vrai `RequireAuth`, le
// vrai `RequireAdmin`, le vrai `localStorage` de jsdom : c'est la chaîne
// complète qui décide de l'accès, et c'est elle qu'on éprouve. Simuler
// `RequireAdmin` reviendrait à tester que le test dit la vérité.
// =============================================================================

const remplacer = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: remplacer, push: vi.fn() }),
  usePathname: () => "/admin",
}));

vi.mock("@/lib/auth-api", () => ({
  inscrire: vi.fn(),
  connecter: vi.fn(),
  utilisateurCourant: vi.fn(),
}));

vi.mock("@/lib/admin-api", () => ({
  recupererStatsAdmin: vi.fn(),
  listerUtilisateursAdmin: vi.fn(),
  desactiverUtilisateurAdmin: vi.fn(),
}));

const { utilisateurCourant } = await import("@/lib/auth-api");
const { recupererStatsAdmin, listerUtilisateursAdmin, desactiverUtilisateurAdmin } =
  await import("@/lib/admin-api");

// ---------------------------------------------------------------------------
// Jeux d'essai
// ---------------------------------------------------------------------------

const ID_ADMIN = "11111111-1111-1111-1111-111111111111";
const ID_USER_B = "22222222-2222-2222-2222-222222222222";
const ID_USER_C = "33333333-3333-3333-3333-333333333333";

const profil = (role: "USER" | "ADMIN", id = ID_ADMIN): User => ({
  id,
  email: role === "ADMIN" ? "admin@exemple.fr" : "usager@exemple.fr",
  role,
  createdAt: "2026-08-01T10:00:00.000Z",
  deletedAt: null,
  preferences: null,
});

const compte = (id: string, surcharge: Partial<AdminUser> = {}): AdminUser => ({
  id,
  email: `compte-${id.slice(0, 4)}@exemple.fr`,
  role: "USER",
  createdAt: "2026-08-20T08:00:00.000Z",
  deletedAt: null,
  ...surcharge,
});

const STATS: AdminStats = {
  users: { active: 12, deleted: 3 },
  routes: { total: 48, totalDistanceM: 123456 },
  carbon: { totalCo2Grams: 12345, totalSavedVsCarGrams: 45678, recordCount: 96 },
  modeUsage: [
    { mode: "BUS", segmentCount: 42, totalDistanceM: 98765 },
    { mode: "WALK", segmentCount: 10, totalDistanceM: 2000 },
  ],
};

/// 25 comptes au total, 20 par page → deux pages.
const PAGE_1: AdminUsersPage = {
  items: [
    compte(ID_ADMIN, { email: "admin@exemple.fr", role: "ADMIN" }),
    compte(ID_USER_B, { email: "bea@exemple.fr" }),
    compte(ID_USER_C, {
      email: "cyril@exemple.fr",
      deletedAt: "2026-08-28T12:00:00.000Z",
    }),
  ],
  page: 1,
  limit: 20,
  total: 25,
};

const PAGE_2: AdminUsersPage = {
  items: [compte("44444444-4444-4444-4444-444444444444", { email: "dora@exemple.fr" })],
  page: 2,
  limit: 20,
  total: 25,
};

/// Monte la page avec un jeton déjà en place — l'état d'un administrateur
/// qui revient sur l'application.
const monter = (role: "USER" | "ADMIN" | "anonyme", id = ID_ADMIN) => {
  if (role !== "anonyme") {
    window.localStorage.setItem("urbanflow.token", "jeton-valide");
    vi.mocked(utilisateurCourant).mockResolvedValue(profil(role, id));
  }

  return render(
    <AuthProvider>
      <AdminPage />
    </AuthProvider>,
  );
};

/// Attend que la liste des comptes soit affichée.
const attendreListe = () => screen.findByRole("table");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(recupererStatsAdmin).mockResolvedValue(STATS);
  vi.mocked(listerUtilisateursAdmin).mockResolvedValue(PAGE_1);
  vi.mocked(desactiverUtilisateurAdmin).mockResolvedValue(undefined);
});

// ===========================================================================
// Protection
// ===========================================================================
describe("protection de /admin", () => {
  it("un visiteur anonyme est renvoyé vers la connexion", async () => {
    monter("anonyme");

    await waitFor(() => {
      expect(remplacer).toHaveBeenCalledWith("/connexion");
    });

    // Et surtout : AUCUN appel administrateur n'est parti.
    expect(recupererStatsAdmin).not.toHaveBeenCalled();
    expect(listerUtilisateursAdmin).not.toHaveBeenCalled();
  });

  it("un USER authentifié voit un refus explicite, pas le back-office", async () => {
    monter("USER", ID_USER_B);

    expect(await screen.findByText(/Accès réservé aux administrateurs/)).toBeDefined();

    // Ni statistiques, ni liste : le contenu n'est pas seulement masqué,
    // il n'est jamais demandé.
    expect(screen.queryByRole("table")).toBeNull();
    expect(recupererStatsAdmin).not.toHaveBeenCalled();
    expect(listerUtilisateursAdmin).not.toHaveBeenCalled();
  });

  it("un USER n'est PAS redirigé : on lui explique", async () => {
    monter("USER", ID_USER_B);
    await screen.findByText(/Accès réservé aux administrateurs/);

    // Rediriger silencieusement laisserait croire à un lien cassé.
    expect(remplacer).not.toHaveBeenCalled();
  });

  it("un ADMIN accède au back-office", async () => {
    monter("ADMIN");

    expect(await screen.findByRole("heading", { level: 1, name: "Administration" })).toBeDefined();
    await attendreListe();
    expect(remplacer).not.toHaveBeenCalled();
  });

  it("le jeton est transmis aux deux appels", async () => {
    monter("ADMIN");
    await attendreListe();

    expect(recupererStatsAdmin).toHaveBeenCalledWith("jeton-valide", expect.anything());
    expect(listerUtilisateursAdmin).toHaveBeenCalledWith("jeton-valide", 1, 20, expect.anything());
  });
});

// ===========================================================================
// Statistiques
// ===========================================================================
describe("statistiques", () => {
  it("affiche les indicateurs réellement fournis", async () => {
    monter("ADMIN");

    const stats = await screen.findByRole("region", { name: /Statistiques/i }).catch(() => null);
    void stats;

    expect(await screen.findByText("12")).toBeDefined(); // comptes actifs
    expect(screen.getByText("3")).toBeDefined(); // comptes désactivés
    expect(screen.getByText("48")).toBeDefined(); // trajets
    expect(screen.getByText("123,5 km")).toBeDefined(); // distance cumulée
    expect(screen.getByText("12,3 kg")).toBeDefined(); // CO2 émis
    expect(screen.getByText("45,7 kg")).toBeDefined(); // CO2 évité
  });

  it("affiche la répartition des modes en FRANÇAIS", async () => {
    monter("ADMIN");

    expect(await screen.findByText("Bus")).toBeDefined();
    expect(screen.getByText("Marche")).toBeDefined();
    // « BUS » brut ne se montre pas à un usager.
    expect(screen.queryByText("BUS")).toBeNull();
  });

  it("dit « étapes », JAMAIS « trajets », pour segmentCount", async () => {
    monter("ADMIN");

    // Le backend compte des SEGMENTS. Afficher « 42 trajets » retournerait
    // le mensonge que `segmentCount` existe précisément pour éviter.
    expect(await screen.findByText(/42 étapes/)).toBeDefined();
    expect(screen.queryByText(/42 trajets/)).toBeNull();
  });

  it("distingue les enregistrements carbone des trajets", async () => {
    monter("ADMIN");

    expect(await screen.findByText(/96 enregistrements carbone/)).toBeDefined();
  });

  it("montre un état de chargement avant la réponse", async () => {
    // Une promesse qui ne se résout pas : l'écran reste dans son état initial.
    vi.mocked(recupererStatsAdmin).mockReturnValue(new Promise(() => {}));

    monter("ADMIN");

    expect(await screen.findByText("Chargement des statistiques…")).toBeDefined();
  });

  it("affiche une erreur de statistiques SANS faire disparaître la liste", async () => {
    vi.mocked(recupererStatsAdmin).mockRejectedValue(new NetworkError("Serveur injoignable."));

    monter("ADMIN");

    expect(await screen.findByText(/Les statistiques n'ont pas pu être chargées/)).toBeDefined();

    // LE POINT DU TEST : la panne d'une section n'emporte pas l'autre.
    const tableau = await attendreListe();
    expect(within(tableau).getByText("bea@exemple.fr")).toBeDefined();
  });

  it("affiche un message neutre quand aucun mode n'est enregistré", async () => {
    vi.mocked(recupererStatsAdmin).mockResolvedValue({ ...STATS, modeUsage: [] });

    monter("ADMIN");

    // Absence de données, pas panne : aucune alerte rouge.
    expect(
      await screen.findByText(/Aucune étape de trajet n'a encore été enregistrée/),
    ).toBeDefined();
  });
});

// ===========================================================================
// Liste des utilisateurs
// ===========================================================================
describe("liste des utilisateurs", () => {
  it("affiche email, rôle et date de création", async () => {
    const tableau = await (monter("ADMIN"), attendreListe());

    expect(within(tableau).getByText("bea@exemple.fr")).toBeDefined();
    expect(within(tableau).getByText("Administrateur")).toBeDefined();
    expect(within(tableau).getAllByText("Utilisateur").length).toBe(2);
    expect(within(tableau).getAllByText(/20 août 2026/).length).toBe(3);
  });

  it("n'affiche JAMAIS de champ interne", async () => {
    const tableau = await (monter("ADMIN"), attendreListe());

    // L'API ne rend ni hash ni identifiant technique — et rien ici ne les
    // fabrique. Le test le fige.
    expect(tableau.textContent).not.toMatch(/passwordHash|Bearer|jeton-valide/);
    expect(tableau.textContent).not.toContain(ID_USER_B);
  });

  it("distingue un compte actif d'un compte désactivé PAR UN MOT", async () => {
    const tableau = await (monter("ADMIN"), attendreListe());

    // La couleur seule ne dirait rien à un usager daltonien (WCAG 1.4.1).
    expect(within(tableau).getAllByText("Actif").length).toBe(2);
    expect(within(tableau).getByText(/Désactivé le/)).toBeDefined();
    expect(within(tableau).getByText(/28 août 2026/)).toBeDefined();
  });

  it("montre un état de chargement avant la réponse", async () => {
    vi.mocked(listerUtilisateursAdmin).mockReturnValue(new Promise(() => {}));

    monter("ADMIN");

    expect(await screen.findByText("Chargement des comptes…")).toBeDefined();
  });

  it("affiche une erreur de liste sans emporter les statistiques", async () => {
    vi.mocked(listerUtilisateursAdmin).mockRejectedValue(new ApiError(403, "Interdit."));

    monter("ADMIN");

    expect(await screen.findByText(/La liste des comptes n'a pas pu être chargée/)).toBeDefined();
    // Les statistiques, elles, sont bien là.
    expect(screen.getByText("48")).toBeDefined();
  });

  it("affiche un état vide quand la base ne contient aucun compte", async () => {
    vi.mocked(listerUtilisateursAdmin).mockResolvedValue({
      items: [],
      page: 1,
      limit: 20,
      total: 0,
    });

    monter("ADMIN");

    expect(await screen.findByText("Aucun compte")).toBeDefined();
  });
});

// ===========================================================================
// Pagination
// ===========================================================================
describe("pagination", () => {
  it("indique la page courante et le nombre de pages", async () => {
    monter("ADMIN");

    expect(await screen.findByText(/Page 1 sur 2/)).toBeDefined();
  });

  it("demande la page suivante AU SERVEUR, sans tout charger d'avance", async () => {
    const usager = userEvent.setup();
    monter("ADMIN");
    await attendreListe();

    vi.mocked(listerUtilisateursAdmin).mockResolvedValue(PAGE_2);
    await usager.click(screen.getByRole("button", { name: "Suivant" }));

    // Une requête par page : la pagination est celle du backend, pas une
    // découpe côté client d'une liste complète.
    await waitFor(() => {
      expect(screen.getByText("dora@exemple.fr")).toBeDefined();
    });
    expect(listerUtilisateursAdmin).toHaveBeenLastCalledWith(
      "jeton-valide",
      2,
      20,
      expect.anything(),
    );
  });

  it("désactive « Précédent » sur la première page", async () => {
    monter("ADMIN");
    await attendreListe();

    // Demander une page 0 serait refusé en 400 par le backend.
    expect(screen.getByRole("button", { name: "Précédent" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Suivant" })).toHaveProperty("disabled", false);
  });

  it("désactive « Suivant » sur la dernière page", async () => {
    const usager = userEvent.setup();
    monter("ADMIN");
    await attendreListe();

    vi.mocked(listerUtilisateursAdmin).mockResolvedValue(PAGE_2);
    await usager.click(screen.getByRole("button", { name: "Suivant" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Suivant" })).toHaveProperty("disabled", true);
    });
  });

  it("ne montre aucune pagination quand tout tient sur une page", async () => {
    vi.mocked(listerUtilisateursAdmin).mockResolvedValue({ ...PAGE_1, total: 3 });

    monter("ADMIN");
    await attendreListe();

    // Deux boutons tous deux désactivés n'apprendraient rien.
    expect(screen.queryByRole("button", { name: "Suivant" })).toBeNull();
  });
});

// ===========================================================================
// Modération
// ===========================================================================
describe("modération", () => {
  /// Ouvre la confirmation sur le compte de Béa.
  const demanderDesactivation = async () => {
    const usager = userEvent.setup();
    monter("ADMIN");
    await attendreListe();

    await usager.click(screen.getByRole("button", { name: /Désactiver le compte bea@exemple.fr/ }));

    return usager;
  };

  it("le premier clic n'appelle RIEN : il demande confirmation", async () => {
    await demanderDesactivation();

    expect(screen.getByText("Désactiver ce compte ?")).toBeDefined();
    // Aucun appel réseau n'est parti : rien n'est encore décidé.
    expect(desactiverUtilisateurAdmin).not.toHaveBeenCalled();
  });

  it("le focus va sur « Annuler », jamais sur « Confirmer »", async () => {
    await demanderDesactivation();

    // Sur une action lourde, le geste par défaut au clavier ne doit rien
    // détruire.
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe("Annuler");
    });
  });

  it("annuler referme la confirmation sans rien appeler", async () => {
    const usager = await demanderDesactivation();

    await usager.click(screen.getByRole("button", { name: "Annuler" }));

    expect(screen.queryByText("Désactiver ce compte ?")).toBeNull();
    expect(desactiverUtilisateurAdmin).not.toHaveBeenCalled();
    // Le bouton d'origine est revenu : l'action reste possible.
    expect(
      screen.getByRole("button", { name: /Désactiver le compte bea@exemple.fr/ }),
    ).toBeDefined();
  });

  it("confirmer appelle DELETE avec le BON identifiant", async () => {
    const usager = await demanderDesactivation();

    await usager.click(screen.getByRole("button", { name: /Confirmer la désactivation/ }));

    await waitFor(() => {
      expect(desactiverUtilisateurAdmin).toHaveBeenCalledWith("jeton-valide", ID_USER_B);
    });
    // Une seule fois, et sur personne d'autre.
    expect(desactiverUtilisateurAdmin).toHaveBeenCalledTimes(1);
  });

  it("affiche un état d'envoi et empêche la double soumission", async () => {
    const usager = userEvent.setup();
    let resoudre: () => void = () => {};
    vi.mocked(desactiverUtilisateurAdmin).mockReturnValue(
      new Promise<void>((r) => {
        resoudre = r;
      }),
    );

    monter("ADMIN");
    await attendreListe();
    await usager.click(screen.getByRole("button", { name: /Désactiver le compte bea@exemple.fr/ }));
    await usager.click(screen.getByRole("button", { name: /Confirmer la désactivation/ }));

    // Le nom accessible change pendant l'envoi : il DIT que l'action est en
    // cours, plutôt que de laisser croire qu'elle est encore à déclencher.
    const enCours = await screen.findByRole("button", {
      name: /Désactivation de bea@exemple.fr en cours/,
    });
    expect(enCours).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Annuler" })).toHaveProperty("disabled", true);

    resoudre();
  });

  it("annonce le succès et RECHARGE la page courante", async () => {
    const usager = await demanderDesactivation();

    // La ligne revient du serveur marquée « Désactivé » : rien n'est deviné
    // localement, et surtout aucune date n'est fabriquée.
    vi.mocked(listerUtilisateursAdmin).mockResolvedValue({
      ...PAGE_1,
      items: PAGE_1.items.map((c) =>
        c.id === ID_USER_B ? { ...c, deletedAt: "2026-08-31T09:00:00.000Z" } : c,
      ),
    });

    await usager.click(screen.getByRole("button", { name: /Confirmer la désactivation/ }));

    const succes = await screen.findByRole("status");
    expect(succes.textContent).toContain("bea@exemple.fr");
    // Le message dit la vérité du backend : suppression LOGIQUE.
    expect(succes.textContent).toMatch(/logique|pas détruites/);

    await waitFor(() => {
      expect(listerUtilisateursAdmin).toHaveBeenCalledTimes(2);
    });
    expect(screen.getAllByText(/Désactivé le/).length).toBe(2);
  });

  it("affiche l'erreur du backend et CONSERVE la liste", async () => {
    const usager = await demanderDesactivation();

    vi.mocked(desactiverUtilisateurAdmin).mockRejectedValue(
      new ApiError(400, "Vous ne pouvez pas supprimer votre propre compte depuis cette interface."),
    );

    await usager.click(screen.getByRole("button", { name: /Confirmer la désactivation/ }));

    // Le message vient du BACKEND : l'interface ne rejoue pas la règle, elle
    // rapporte la décision.
    const alerte = await screen.findByRole("alert");
    expect(alerte.textContent).toContain("votre propre compte");

    // LE POINT DU TEST : la liste est intacte, la page n'est pas perdue.
    const tableau = screen.getByRole("table");
    expect(within(tableau).getByText("bea@exemple.fr")).toBeDefined();
    expect(within(tableau).getByText("admin@exemple.fr")).toBeDefined();
    // Et aucun rechargement n'a été déclenché sur un échec.
    expect(listerUtilisateursAdmin).toHaveBeenCalledTimes(1);
  });

  it("n'offre AUCUNE action sur son propre compte", async () => {
    const tableau = await (monter("ADMIN"), attendreListe());

    // Le backend refuse en 400 ; l'interface ne propose pas une action dont
    // elle sait qu'elle sera refusée — et le dit par un mot.
    expect(within(tableau).getByText("Votre compte")).toBeDefined();
    expect(
      screen.queryByRole("button", { name: /Désactiver le compte admin@exemple.fr/ }),
    ).toBeNull();
    expect(within(tableau).getByText("(vous)")).toBeDefined();
  });

  it("n'offre AUCUNE action sur un compte déjà désactivé", async () => {
    monter("ADMIN");
    await attendreListe();

    // Le backend répondrait 204 sans rien changer : un bouton inerte serait
    // une fausse promesse.
    expect(
      screen.queryByRole("button", { name: /Désactiver le compte cyril@exemple.fr/ }),
    ).toBeNull();
  });

  it("laisse désactiver un AUTRE administrateur si le backend l'autorise", async () => {
    // Le dossier ne définit aucune règle entre administrateurs, et le backend
    // l'autorise. En inventer une ici trancherait une question d'organisation
    // qui ne nous appartient pas.
    vi.mocked(listerUtilisateursAdmin).mockResolvedValue({
      ...PAGE_1,
      items: [
        compte(ID_ADMIN, { email: "admin@exemple.fr", role: "ADMIN" }),
        compte(ID_USER_B, { email: "bea@exemple.fr", role: "ADMIN" }),
      ],
      total: 2,
    });

    monter("ADMIN");
    await attendreListe();

    expect(
      screen.getByRole("button", { name: /Désactiver le compte bea@exemple.fr/ }),
    ).toBeDefined();
  });
});

// ===========================================================================
// Accessibilité
// ===========================================================================
describe("accessibilité", () => {
  it("structure la page en titres hiérarchisés", async () => {
    monter("ADMIN");
    await attendreListe();

    expect(screen.getByRole("heading", { level: 1, name: "Administration" })).toBeDefined();
    expect(screen.getByRole("heading", { level: 2, name: "Statistiques" })).toBeDefined();
    expect(screen.getByRole("heading", { level: 2, name: "Utilisateurs" })).toBeDefined();
  });

  it("emploie un tableau SÉMANTIQUE avec légende et en-têtes de colonne", async () => {
    const tableau = await (monter("ADMIN"), attendreListe());

    // Sans `scope`, un lecteur d'écran annonce les valeurs sans dire de quoi
    // elles sont la valeur.
    const entetes = within(tableau).getAllByRole("columnheader");
    expect(entetes.map((e) => e.textContent)).toEqual([
      "Adresse e-mail",
      "Rôle",
      "Création",
      "Statut",
      "Action",
    ]);
    expect(entetes.every((e) => e.getAttribute("scope") === "col")).toBe(true);

    expect(tableau.querySelector("caption")?.textContent).toMatch(/Comptes utilisateurs/);
    // L'email est l'en-tête de SA ligne : c'est lui qui identifie la ligne.
    expect(within(tableau).getAllByRole("rowheader").length).toBe(3);
  });

  it("rend la zone défilante atteignable au clavier et nommée", async () => {
    monter("ADMIN");
    await attendreListe();

    // Sans `tabIndex`, un usager au clavier ne pourrait pas faire défiler le
    // tableau horizontalement sur mobile.
    const region = screen.getByRole("region", { name: "Liste des comptes utilisateurs" });
    expect(region.getAttribute("tabindex")).toBe("0");
  });

  it("chaque bouton d'action nomme le compte concerné", async () => {
    monter("ADMIN");
    await attendreListe();

    // « Désactiver » répété vingt fois serait indistinguable hors contexte.
    expect(
      screen.getByRole("button", { name: /Désactiver le compte bea@exemple.fr/ }),
    ).toBeDefined();
  });
});
