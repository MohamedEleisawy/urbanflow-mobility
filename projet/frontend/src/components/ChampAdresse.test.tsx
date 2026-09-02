import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChampAdresse, type PointChoisi } from "./ChampAdresse";
import { ApiError, NetworkError } from "@/lib/api";

// =============================================================================
// Champ de recherche d'adresse (Phase 3A)
// =============================================================================
// SEUL LE RÉSEAU EST SIMULÉ. Le vrai composant, le vrai débounce, le vrai
// clavier. Aucun test n'interroge Nominatim : le géocodeur est un service
// public gratuit, et un test qui en dépendrait échouerait hors ligne.
// =============================================================================

vi.mock("@/lib/geocoding-api", () => ({ rechercherAdresses: vi.fn() }));

const { rechercherAdresses } = await import("@/lib/geocoding-api");

const TOUR_EIFFEL = { label: "Tour Eiffel, Paris", latitude: 48.8584, longitude: 2.2945 };
const GARE_DU_NORD = { label: "Gare du Nord, Paris", latitude: 48.8809, longitude: 2.3553 };

const repondre = (items = [TOUR_EIFFEL, GARE_DU_NORD]) =>
  vi.mocked(rechercherAdresses).mockResolvedValue({
    items,
    attribution: "© Contributeurs OpenStreetMap",
  });

/// Monte le champ et expose ce que le parent a reçu.
const monter = (valeurInitiale: PointChoisi | null = null) => {
  const choix = vi.fn();
  const utilisateur = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

  render(
    <ChampAdresse
      libelle="Départ"
      placeholder="D'où partez-vous ?"
      valeur={valeurInitiale}
      onChoisir={choix}
    />,
  );

  return { choix, utilisateur };
};

/// Saisit un texte puis laisse le débounce s'écouler.
const saisir = async (utilisateur: ReturnType<typeof userEvent.setup>, texte: string) => {
  await utilisateur.type(screen.getByLabelText("Départ"), texte);
  await vi.advanceTimersByTimeAsync(800);
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.mocked(rechercherAdresses).mockReset();
  repondre();
});

afterEach(() => {
  vi.useRealTimers();
});

// ===========================================================================
// Saisie et débounce
// ===========================================================================
describe("saisie", () => {
  it("N'APPELLE PAS le serveur à chaque frappe", async () => {
    const { utilisateur } = monter();

    await utilisateur.type(screen.getByLabelText("Départ"), "Tour Eiffel");

    // Nominatim est plafonné à une requête par seconde : une recherche par
    // frappe le saturerait, et nous ferait bloquer à juste titre.
    expect(rechercherAdresses).not.toHaveBeenCalled();
  });

  it("appelle le serveur UNE FOIS après la pause", async () => {
    const { utilisateur } = monter();

    await saisir(utilisateur, "Tour Eiffel");

    expect(rechercherAdresses).toHaveBeenCalledTimes(1);
    expect(vi.mocked(rechercherAdresses).mock.calls[0][0]).toBe("Tour Eiffel");
  });

  it("N'APPELLE PAS le serveur sous trois caractères", async () => {
    const { utilisateur } = monter();

    await saisir(utilisateur, "ab");

    // Le backend refuserait en 400 : autant ne pas partir.
    expect(rechercherAdresses).not.toHaveBeenCalled();
  });

  it("annule la requête précédente quand la saisie continue", async () => {
    const { utilisateur } = monter();

    await utilisateur.type(screen.getByLabelText("Départ"), "Tour");
    await vi.advanceTimersByTimeAsync(800);
    await utilisateur.type(screen.getByLabelText("Départ"), " Eiffel");
    await vi.advanceTimersByTimeAsync(800);

    // Deux pauses, deux appels — et le premier a été abandonné plutôt que
    // d'afficher des propositions périmées.
    expect(rechercherAdresses).toHaveBeenCalledTimes(2);
    const signal = vi.mocked(rechercherAdresses).mock.calls[0][1];
    expect(signal?.aborted).toBe(true);
  });
});

// ===========================================================================
// Résultats
// ===========================================================================
describe("résultats", () => {
  it("affiche les propositions dans une liste", async () => {
    const { utilisateur } = monter();

    await saisir(utilisateur, "Tour");

    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "Tour Eiffel, Paris",
      "Gare du Nord, Paris",
    ]);
  });

  it("annonce le nombre de propositions", async () => {
    const { utilisateur } = monter();

    await saisir(utilisateur, "Tour");

    expect((await screen.findByRole("status")).textContent).toMatch(/2 propositions/);
  });

  it("affiche l'attribution des données", async () => {
    const { utilisateur } = monter();

    await saisir(utilisateur, "Tour");

    // Imposée par la licence. Elle vient du serveur : changer de fournisseur
    // changera l'attribution au même endroit.
    expect(await screen.findByText(/OpenStreetMap/)).toBeDefined();
  });

  it("dit AUCUN RÉSULTAT sans traiter cela comme une erreur", async () => {
    repondre([]);
    const { utilisateur } = monter();

    await saisir(utilisateur, "zzzzzz");

    // « Aucun résultat » invite à reformuler ; « service indisponible » invite
    // à réessayer. Les confondre ferait corriger une saisie correcte.
    expect((await screen.findByRole("status")).textContent).toMatch(/Aucun lieu ne correspond/);
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("affiche un état de recherche", async () => {
    vi.mocked(rechercherAdresses).mockReturnValue(new Promise(() => {}));
    const { utilisateur } = monter();

    await saisir(utilisateur, "Tour");

    // La requête ne se résout jamais : l'état de recherche doit rester
    // affiché, sans quoi rien n'expliquerait l'attente.
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toMatch(/Recherche en cours/),
    );
  });

  it("affiche l'erreur du serveur", async () => {
    vi.mocked(rechercherAdresses).mockRejectedValue(
      new ApiError(503, "Service de recherche indisponible."),
    );
    const { utilisateur } = monter();

    await saisir(utilisateur, "Tour");

    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/indisponible/i));
  });

  it("affiche une panne réseau", async () => {
    vi.mocked(rechercherAdresses).mockRejectedValue(
      new NetworkError("Le serveur est injoignable."),
    );
    const { utilisateur } = monter();

    await saisir(utilisateur, "Tour");

    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/injoignable/i));
  });
});

// ===========================================================================
// Sélection — le cœur de la phase
// ===========================================================================
describe("sélection", () => {
  it("remonte les COORDONNÉES exactes de la proposition choisie", async () => {
    const { choix, utilisateur } = monter();
    await saisir(utilisateur, "Tour");

    await utilisateur.click(await screen.findByText("Tour Eiffel, Paris"));

    expect(choix).toHaveBeenCalledWith({
      label: "Tour Eiffel, Paris",
      latitude: 48.8584,
      longitude: 2.2945,
      origine: "adresse",
    });
  });

  it("choisit la BONNE proposition, pas la première", async () => {
    const { choix, utilisateur } = monter();
    await saisir(utilisateur, "Gare");

    await utilisateur.click(await screen.findByText("Gare du Nord, Paris"));

    expect(vi.mocked(choix).mock.calls[0][0]).toMatchObject({
      latitude: 48.8809,
      longitude: 2.3553,
    });
  });

  it("referme la liste après la sélection", async () => {
    const { utilisateur } = monter();
    await saisir(utilisateur, "Tour");

    await utilisateur.click(await screen.findByText("Tour Eiffel, Paris"));

    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("⚠️ MODIFIER LE TEXTE INVALIDE la sélection", async () => {
    const { choix } = monter(null);
    const utilisateur = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    // Le parent a déjà un point retenu.
    render(
      <ChampAdresse
        libelle="Arrivée"
        placeholder="Où allez-vous ?"
        valeur={{ ...TOUR_EIFFEL, origine: "adresse" }}
        onChoisir={choix}
      />,
    );

    await utilisateur.type(screen.getByLabelText("Arrivée"), "x");

    // LA RÈGLE CENTRALE DE LA PHASE. Sans elle, on lancerait une recherche
    // vers la Tour Eiffel en affichant un tout autre texte dans le champ.
    expect(choix).toHaveBeenCalledWith(null);
  });

  it("n'invalide rien si aucune sélection n'existe", async () => {
    const { choix, utilisateur } = monter(null);

    await utilisateur.type(screen.getByLabelText("Départ"), "To");

    expect(choix).not.toHaveBeenCalled();
  });

  it("affiche le libellé d'une valeur imposée par le parent", () => {
    monter({ ...GARE_DU_NORD, origine: "favori" });

    // Un favori ou la position remplissent le champ sans géocodage.
    expect(screen.getByLabelText("Départ")).toHaveProperty("value", "Gare du Nord, Paris");
  });

  it("NE RECHERCHE PAS le texte d'une valeur imposée", async () => {
    monter({ ...GARE_DU_NORD, origine: "favori" });

    await vi.advanceTimersByTimeAsync(1500);

    // Le favori porte déjà ses coordonnées : le géocoder serait un appel
    // réseau pour réapprendre ce qu'on sait.
    expect(rechercherAdresses).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Clavier
// ===========================================================================
describe("clavier", () => {
  it("descend dans la liste avec la flèche bas", async () => {
    const { utilisateur } = monter();
    await saisir(utilisateur, "Tour");
    await screen.findAllByRole("option");

    await utilisateur.keyboard("{ArrowDown}");

    expect(screen.getAllByRole("option")[0].getAttribute("aria-selected")).toBe("true");
  });

  it("remonte avec la flèche haut, en bouclant", async () => {
    const { utilisateur } = monter();
    await saisir(utilisateur, "Tour");
    await screen.findAllByRole("option");

    await utilisateur.keyboard("{ArrowUp}");

    // Depuis « rien de surligné », remonter mène au DERNIER élément.
    expect(screen.getAllByRole("option")[1].getAttribute("aria-selected")).toBe("true");
  });

  it("Entrée SÉLECTIONNE l'élément surligné", async () => {
    const { choix, utilisateur } = monter();
    await saisir(utilisateur, "Tour");
    await screen.findAllByRole("option");

    await utilisateur.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    expect(vi.mocked(choix).mock.calls[0][0]).toMatchObject({
      label: "Gare du Nord, Paris",
    });
  });

  it("Entrée sans surlignage ne sélectionne RIEN", async () => {
    const { choix, utilisateur } = monter();
    await saisir(utilisateur, "Tour");
    await screen.findAllByRole("option");

    await utilisateur.keyboard("{Enter}");

    expect(choix).not.toHaveBeenCalled();
  });

  it("Échap ferme la liste sans rien choisir", async () => {
    const { choix, utilisateur } = monter();
    await saisir(utilisateur, "Tour");
    await screen.findAllByRole("option");

    await utilisateur.keyboard("{Escape}");

    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(choix).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Accessibilité
// ===========================================================================
describe("accessibilité", () => {
  it("expose le motif combobox", async () => {
    const { utilisateur } = monter();
    const champ = screen.getByLabelText("Départ");

    expect(champ.getAttribute("role")).toBe("combobox");
    expect(champ.getAttribute("aria-expanded")).toBe("false");

    await saisir(utilisateur, "Tour");
    await screen.findAllByRole("option");

    expect(screen.getByLabelText("Départ").getAttribute("aria-expanded")).toBe("true");
  });

  it("désigne l'option surlignée par aria-activedescendant", async () => {
    const { utilisateur } = monter();
    await saisir(utilisateur, "Tour");
    await screen.findAllByRole("option");

    await utilisateur.keyboard("{ArrowDown}");

    // C'est ce qui permet à un lecteur d'écran d'annoncer l'option courante
    // sans que le focus quitte le champ de saisie.
    const designe = screen.getByLabelText("Départ").getAttribute("aria-activedescendant");
    expect(designe).toBe(screen.getAllByRole("option")[0].id);
  });

  it("nomme la liste de propositions", async () => {
    const { utilisateur } = monter();
    await saisir(utilisateur, "Tour");

    expect(await screen.findByRole("listbox", { name: "Propositions pour Départ" })).toBeDefined();
  });

  it("guide l'usager quand rien n'est saisi", () => {
    monter();

    expect(screen.getByRole("status").textContent).toMatch(/au moins trois caractères/);
  });
});
