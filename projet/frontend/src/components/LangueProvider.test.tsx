import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "./AuthProvider";
import { LangueProvider, useTraduction } from "./LangueProvider";
import { LANGUES, TEXTES, type Langue } from "@/lib/i18n/dictionnaire";
import type { User, UserPreferences } from "@/lib/types";

vi.mock("@/lib/auth-api", () => ({
  utilisateurCourant: vi.fn(),
  connexion: vi.fn(),
  inscription: vi.fn(),
}));

const { utilisateurCourant } = await import("@/lib/auth-api");

const PREFERENCES: UserPreferences = {
  id: "pref-1",
  preferredModes: [],
  pmrMode: false,
  co2BudgetWeekly: 5000,
  notificationsEnabled: true,
  language: "FR",
  theme: "SYSTEM",
  userId: "user-1",
};

const profil = (language: UserPreferences["language"]): User => ({
  id: "user-1",
  email: "usager@example.com",
  role: "USER",
  createdAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
  preferences: { ...PREFERENCES, language },
});

/// Une sonde qui affiche la langue courante et deux textes traduits.
function Sonde() {
  const { langue, t, etiquette, changerLangue } = useTraduction();

  return (
    <div>
      <p data-testid="langue">{langue}</p>
      <p data-testid="etiquette">{etiquette}</p>
      <p data-testid="titre">{t.rechercheTitre}</p>
      <p data-testid="critere">{t.critereLowestCo2}</p>
      {LANGUES.map((valeur) => (
        <button key={valeur} type="button" onClick={() => changerLangue(valeur)}>
          {valeur}
        </button>
      ))}
    </div>
  );
}

const rendre = () =>
  render(
    <AuthProvider>
      <LangueProvider>
        <Sonde />
      </LangueProvider>
    </AuthProvider>,
  );

describe("LangueProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(utilisateurCourant).mockReset();
  });

  // ---------------------------------------------------------------------------
  // Changement immédiat
  // ---------------------------------------------------------------------------

  it("part du français pour un visiteur", () => {
    rendre();

    expect(screen.getByTestId("langue").textContent).toBe("FR");
    expect(screen.getByTestId("titre").textContent).toBe("Rechercher un itinéraire");
  });

  it("change de langue SANS RECHARGEMENT", async () => {
    const utilisateur = userEvent.setup();
    rendre();

    await utilisateur.click(screen.getByRole("button", { name: "EN" }));

    // ⚠️ Aucun rechargement, aucun appel réseau : le contexte suffit.
    expect(screen.getByTestId("titre").textContent).toBe("Find a route");
    expect(screen.getByTestId("critere").textContent).toBe("Greenest");
  });

  it("passe à l'espagnol", async () => {
    const utilisateur = userEvent.setup();
    rendre();

    await utilisateur.click(screen.getByRole("button", { name: "ES" }));

    expect(screen.getByTestId("titre").textContent).toBe("Buscar un itinerario");
    expect(screen.getByTestId("critere").textContent).toBe("El más ecológico");
  });

  it("revient au français", async () => {
    const utilisateur = userEvent.setup();
    rendre();

    await utilisateur.click(screen.getByRole("button", { name: "ES" }));
    await utilisateur.click(screen.getByRole("button", { name: "FR" }));

    expect(screen.getByTestId("titre").textContent).toBe("Rechercher un itinéraire");
  });

  it("fournit l'étiquette BCP 47 de la langue", async () => {
    const utilisateur = userEvent.setup();
    rendre();

    expect(screen.getByTestId("etiquette").textContent).toBe("fr-FR");

    await utilisateur.click(screen.getByRole("button", { name: "ES" }));

    // ⚠️ C'est elle qui choisit la VOIX de la synthèse vocale : une phrase
    // espagnole lue par une voix française est inintelligible.
    expect(screen.getByTestId("etiquette").textContent).toBe("es-ES");
  });

  // ---------------------------------------------------------------------------
  // Préférence du compte
  // ---------------------------------------------------------------------------

  it("suit la préférence du compte à la connexion", async () => {
    window.localStorage.setItem("urbanflow.token", "jeton-valide");
    vi.mocked(utilisateurCourant).mockResolvedValue(profil("EN"));

    rendre();

    // La préférence persistée commande : elle reprend la main dès qu'elle
    // arrive.
    await waitFor(() => expect(screen.getByTestId("langue").textContent).toBe("EN"));
  });

  it("laisse l'usager changer de langue APRÈS le chargement du compte", async () => {
    const utilisateur = userEvent.setup();
    window.localStorage.setItem("urbanflow.token", "jeton-valide");
    vi.mocked(utilisateurCourant).mockResolvedValue(profil("EN"));

    rendre();
    await waitFor(() => expect(screen.getByTestId("langue").textContent).toBe("EN"));

    await utilisateur.click(screen.getByRole("button", { name: "ES" }));

    // Le choix de session n'est pas écrasé par la préférence déjà lue.
    expect(screen.getByTestId("langue").textContent).toBe("ES");
  });

  it("RETIENT le choix d’un visiteur dans ce navigateur", async () => {
    // ⚠️ CE TEST A ÉTÉ INVERSÉ AU SPRINT SOUTENANCE. Il vérifiait auparavant
    // qu'aucune langue n'était persistée, au motif qu'un poste partagé
    // imposerait le choix d'un usager au suivant.
    //
    // Le calcul était mauvais : ce coût-là se corrige d'un clic et concerne
    // les postes partagés, tandis que ne rien retenir fait repartir de zéro
    // TOUS les visiteurs à CHAQUE visite. Une langue d'interface ne dit rien
    // de qui l'a choisie — contrairement à un historique de trajets.
    const utilisateur = userEvent.setup();
    rendre();

    await utilisateur.click(screen.getByRole("button", { name: "ES" }));

    expect(window.localStorage.getItem("urbanflow.langue")).toBe("ES");
  });

  it("REPART du choix retenu à la visite suivante", async () => {
    window.localStorage.setItem("urbanflow.langue", "ES");

    rendre();

    await waitFor(() =>
      expect(screen.getByTestId("langue").textContent).toBe("ES"),
    );
  });

  it("IGNORE une valeur stockée invalide", async () => {
    // `localStorage` est modifiable par l'usager ou une extension. Une valeur
    // inattendue ferait chercher `TEXTES["xx"]`, donc `undefined`, et toute
    // l'interface s'effondrerait au premier accès à `t.…`.
    window.localStorage.setItem("urbanflow.langue", "klingon");

    rendre();

    await waitFor(() =>
      expect(screen.getByTestId("langue").textContent).toBe("FR"),
    );
  });

  it("laisse le COMPTE l’emporter sur le choix du navigateur", async () => {
    // Se connecter doit retrouver SA langue, y compris sur une machine dont
    // le navigateur en retient une autre.
    window.localStorage.setItem("urbanflow.langue", "ES");
    window.localStorage.setItem("urbanflow.token", "jeton-valide");
    vi.mocked(utilisateurCourant).mockResolvedValue(profil("EN"));

    rendre();

    await waitFor(() =>
      expect(screen.getByTestId("langue").textContent).toBe("EN"),
    );
  });
});

// =============================================================================
// Complétude des catalogues
// =============================================================================
// ⚠️ TypeScript garantit déjà qu'aucune clé ne MANQUE (`Record<Langue, typeof
// FR>`). Ce qu'il ne voit pas, c'est une traduction OUBLIÉE — une valeur
// recopiée telle quelle du français.
// =============================================================================
describe("catalogues", () => {
  const cles = Object.keys(TEXTES.FR) as (keyof typeof TEXTES.FR)[];

  it("expose exactement les mêmes clés dans les trois langues", () => {
    for (const langue of LANGUES) {
      expect(Object.keys(TEXTES[langue]).sort()).toEqual([...cles].sort());
    }
  });

  it("ne laisse AUCUNE chaîne vide", () => {
    for (const langue of LANGUES) {
      for (const cle of cles) {
        const valeur = TEXTES[langue][cle];

        if (typeof valeur === "string") {
          expect(valeur.trim().length, `${langue}.${String(cle)}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("traduit réellement les textes DESTINÉS À L'USAGER", () => {
    // Quelques clés dont la traduction ne peut pas coïncider avec le
    // français. Les tester toutes serait faux : « UrbanFlow » et « Distance »
    // sont identiques dans les trois langues, à juste titre.
    const aTraduire: (keyof typeof TEXTES.FR)[] = [
      "rechercheTitre",
      "critereFastest",
      "critereLowestCo2",
      "vousEtesArrive",
      "aucunItineraire",
    ];

    for (const langue of LANGUES.filter((l): l is Exclude<Langue, "FR"> => l !== "FR")) {
      for (const cle of aTraduire) {
        expect(TEXTES[langue][cle], `${langue}.${String(cle)}`).not.toBe(TEXTES.FR[cle]);
      }
    }
  });

  it("formule les instructions de navigation dans chaque langue", () => {
    expect(TEXTES.FR.instructionMarcher("180 m", "Châtelet")).toBe(
      "Marchez 180 m jusqu'à Châtelet",
    );
    expect(TEXTES.EN.instructionMarcher("180 m", "Châtelet")).toBe("Walk 180 m to Châtelet");
    expect(TEXTES.ES.instructionMarcher("180 m", "Châtelet")).toBe(
      "Camina 180 m hasta Châtelet",
    );
  });

  it("conserve les NOMS PROPRES des données, sans les traduire", () => {
    // « Châtelet » reste « Châtelet » : il vient du flux de l'opérateur et ne
    // figure sur aucun panneau sous un autre nom.
    for (const langue of LANGUES) {
      expect(TEXTES[langue].instructionPrendre("Metro", "4", "Châtelet")).toContain("Châtelet");
      expect(TEXTES[langue].instructionPrendre("Metro", "4", "Châtelet")).toContain("4");
    }
  });
});
