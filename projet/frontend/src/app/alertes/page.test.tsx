import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AlertesPage from "./page";
import { ApiError, NetworkError } from "@/lib/api";
import type { Alert, AlertsResponse } from "@/lib/types";

// Seul le RÉSEAU est simulé. Le tri, la mise en forme des dates, les libellés
// de gravité et la troncature sont les vrais : c'est ce qu'on veut éprouver.
vi.mock("@/lib/alertes-api", () => ({
  listerAlertes: vi.fn(),
}));

const { listerAlertes } = await import("@/lib/alertes-api");

const alerte = (surcharge: Partial<Alert> = {}): Alert => ({
  id: "alerte-1",
  headerText: "Trafic interrompu entre Gare du Nord et Châtelet",
  descriptionText: "Un incident technique immobilise une rame.",
  stopIds: ["N1", "N2"],
  lines: [{ id: "ROUTE_4", name: "4" }],
  mode: "METRO",
  severity: "SEVERE",
  cause: "TECHNICAL_PROBLEM",
  effect: "NO_SERVICE",
  startTime: "2026-08-25T07:30:00.000Z",
  endTime: null,
  ...surcharge,
});

/// Réponse complète, non tronquée.
const reponse = (items: Alert[], truncated = false): AlertsResponse => ({
  items,
  limit: 200,
  truncated,
});

describe("/alertes", () => {
  beforeEach(() => {
    vi.mocked(listerAlertes).mockReset();
  });

  // ---------------------------------------------------------------------------
  // Accès et chargement
  // ---------------------------------------------------------------------------
  describe("accès", () => {
    it("s'affiche SANS authentification", async () => {
      vi.mocked(listerAlertes).mockResolvedValue(reponse([alerte()]));

      render(<AlertesPage />);

      // Aucun jeton dans le localStorage, aucun AuthProvider autour : la page
      // se rend quand même. Le dossier veut l'application utilisable sans
      // compte lorsque celui-ci n'est pas nécessaire.
      expect(
        await screen.findByRole("heading", { name: /perturbations en cours/i, level: 1 }),
      ).toBeDefined();
    });

    it("n'envoie AUCUN jeton au backend", async () => {
      vi.mocked(listerAlertes).mockResolvedValue(reponse([]));
      window.localStorage.setItem("urbanflow.token", "jeton-valide");

      render(<AlertesPage />);

      await waitFor(() => expect(listerAlertes).toHaveBeenCalled());
      // La signature ne prend qu'un signal d'annulation : rien d'autre ne
      // peut être transmis.
      const [premier] = vi.mocked(listerAlertes).mock.calls[0];
      expect(premier === undefined || premier instanceof AbortSignal).toBe(true);
    });

    it("affiche un indicateur pendant le chargement", async () => {
      vi.mocked(listerAlertes).mockReturnValue(new Promise(() => {}));

      render(<AlertesPage />);

      expect(await screen.findByText(/chargement des perturbations/i)).toBeDefined();
    });

    it("annonce l'arrivée du contenu aux lecteurs d'écran", async () => {
      vi.mocked(listerAlertes).mockResolvedValue(reponse([alerte(), alerte({ id: "b" })]));

      render(<AlertesPage />);

      // Le contenu arrive APRÈS le rendu initial : sans zone d'état, un
      // lecteur d'écran resterait sur « Chargement ».
      await waitFor(() =>
        expect(screen.getByRole("status").textContent).toBe("2 perturbations signalées."),
      );
    });

    it("n'empile PAS deux annonces l'une sur l'autre", async () => {
      vi.mocked(listerAlertes).mockRejectedValue(new ApiError(500, "Erreur interne"));

      render(<AlertesPage />);

      await screen.findByRole("alert");
      // `ErrorMessage` porte déjà `role="alert"`. Si la zone d'état annonçait
      // aussi quelque chose, l'erreur serait lue deux fois.
      expect(screen.getByRole("status").textContent).toBe("");
    });
  });

  // ---------------------------------------------------------------------------
  // Liste vide
  // ---------------------------------------------------------------------------
  describe("aucune perturbation", () => {
    it("formule la liste vide comme une BONNE nouvelle", async () => {
      vi.mocked(listerAlertes).mockResolvedValue(reponse([]));

      render(<AlertesPage />);

      // « Aucune perturbation » n'est pas une erreur : c'est une réponse.
      // Elle est dite DEUX FOIS — à l'écran, et dans la zone d'état pour les
      // lecteurs d'écran — d'où `findAllByText`.
      expect((await screen.findAllByText(/aucune perturbation en cours/i)).length).toBe(2);
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByText(/le réseau circule normalement/i)).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Contenu
  // ---------------------------------------------------------------------------
  describe("perturbations", () => {
    it("affiche le texte publié par l'opérateur", async () => {
      vi.mocked(listerAlertes).mockResolvedValue(reponse([alerte()]));

      render(<AlertesPage />);

      expect(
        await screen.findByText("Trafic interrompu entre Gare du Nord et Châtelet"),
      ).toBeDefined();
      expect(screen.getByText("Un incident technique immobilise une rame.")).toBeDefined();
    });

    it("ne FABRIQUE aucun titre quand l'opérateur n'en publie pas", async () => {
      vi.mocked(listerAlertes).mockResolvedValue(
        reponse([alerte({ headerText: null, descriptionText: null })]),
      );

      render(<AlertesPage />);

      // Un titre neutre, qui ne prétend rien. Composer « Problème technique —
      // service interrompu » ferait passer notre phrase pour celle de
      // l'opérateur (règle posée en 4F-2A).
      expect(await screen.findByText(/perturbation signalée sur le réseau métro/i)).toBeDefined();
      expect(screen.queryByRole("heading", { name: /^problème technique/i })).toBeNull();
    });

    it("traduit cause et conséquence dans des champs ÉTIQUETÉS", async () => {
      vi.mocked(listerAlertes).mockResolvedValue(reponse([alerte()]));

      render(<AlertesPage />);

      // Étiquetés : le libellé dit d'où vient l'information, ce qui distingue
      // ce cas d'un titre fabriqué.
      expect(await screen.findByText("Cause")).toBeDefined();
      expect(screen.getByText("Problème technique")).toBeDefined();
      expect(screen.getByText("Conséquence")).toBeDefined();
      expect(screen.getByText("Service interrompu")).toBeDefined();
    });

    it("affiche TEL QUEL un vocabulaire GTFS inconnu", async () => {
      vi.mocked(listerAlertes).mockResolvedValue(
        reponse([alerte({ cause: "CAUSE_EXOTIQUE", effect: "EFFET_EXOTIQUE" })]),
      );

      render(<AlertesPage />);

      // Un flux peut publier une valeur que notre table ne prévoit pas :
      // mieux vaut la montrer brute que masquer l'information.
      expect(await screen.findByText("CAUSE_EXOTIQUE")).toBeDefined();
      expect(screen.getByText("EFFET_EXOTIQUE")).toBeDefined();
    });

    it("nomme la ligne concernée, ou rend son identifiant", async () => {
      vi.mocked(listerAlertes).mockResolvedValue(
        reponse([
          alerte({
            lines: [
              { id: "ROUTE_4", name: "4" },
              // Absente de notre référentiel : le nom est nul.
              { id: "ROUTE_INCONNUE", name: null },
            ],
          }),
        ]),
      );

      render(<AlertesPage />);

      expect(await screen.findByText("4, ROUTE_INCONNUE")).toBeDefined();
    });

    it("ne montre pas de champ « ligne » quand aucune n'est concernée", async () => {
      vi.mocked(listerAlertes).mockResolvedValue(reponse([alerte({ lines: [], stopIds: [] })]));

      render(<AlertesPage />);

      await screen.findByText(/trafic interrompu/i);
      expect(screen.queryByText(/ligne concernée|lignes concernées/i)).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Gravité
  // ---------------------------------------------------------------------------
  describe("gravité", () => {
    it("écrit la gravité EN TOUTES LETTRES", async () => {
      vi.mocked(listerAlertes).mockResolvedValue(
        reponse([
          alerte({ id: "a", severity: "SEVERE" }),
          alerte({ id: "b", severity: "WARNING" }),
          alerte({ id: "c", severity: "INFO" }),
        ]),
      );

      render(<AlertesPage />);

      // L'information ne passe JAMAIS par la seule couleur (WCAG 1.4.1) : un
      // usager daltonien, une impression noir et blanc ou un lecteur d'écran
      // lisent le même mot.
      expect(await screen.findByText("Perturbation majeure")).toBeDefined();
      expect(screen.getByText("Perturbation")).toBeDefined();
      expect(screen.getByText("Information")).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Ordre
  // ---------------------------------------------------------------------------
  describe("ordre", () => {
    it("respecte l'ordre du SERVEUR, sans retrier", async () => {
      // Volontairement remis dans le désordre : si la page retriait, elle
      // remonterait SEVERE en tête et ce test échouerait. L'ordre est celui
      // que le backend documente et teste (gravité, puis date de début).
      vi.mocked(listerAlertes).mockResolvedValue(
        reponse([
          alerte({ id: "a", severity: "INFO", headerText: "Première" }),
          alerte({ id: "b", severity: "SEVERE", headerText: "Deuxième" }),
        ]),
      );

      render(<AlertesPage />);

      const elements = await screen.findAllByRole("listitem");
      expect(within(elements[0]).getByText("Première")).toBeDefined();
      expect(within(elements[1]).getByText("Deuxième")).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Dates
  // ---------------------------------------------------------------------------
  describe("dates", () => {
    it("rend la date de début lisible ET machine", async () => {
      vi.mocked(listerAlertes).mockResolvedValue(reponse([alerte()]));

      const { container } = render(<AlertesPage />);

      await screen.findByText("Depuis");
      // On assère l'attribut `datetime`, pas le texte rendu : celui-ci dépend
      // du fuseau horaire de la machine qui exécute les tests.
      const debut = container.querySelector('time[datetime="2026-08-25T07:30:00.000Z"]');
      expect(debut).not.toBeNull();
      expect(debut?.textContent).toMatch(/25 août 2026/);
    });

    it("n'INVENTE aucune date de fin quand l'opérateur n'en annonce pas", async () => {
      vi.mocked(listerAlertes).mockResolvedValue(reponse([alerte({ endTime: null })]));

      render(<AlertesPage />);

      // Une échéance arbitraire serait indiscernable d'une vraie.
      expect(await screen.findByText("Aucune fin annoncée")).toBeDefined();
    });

    it("affiche la date de fin quand elle existe", async () => {
      vi.mocked(listerAlertes).mockResolvedValue(
        reponse([alerte({ endTime: "2026-08-26T18:00:00.000Z" })]),
      );

      const { container } = render(<AlertesPage />);

      await screen.findByText("Jusqu'au");
      expect(container.querySelector('time[datetime="2026-08-26T18:00:00.000Z"]')).not.toBeNull();
      expect(screen.queryByText("Aucune fin annoncée")).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Troncature
  // ---------------------------------------------------------------------------
  describe("liste tronquée", () => {
    it("DIT que la liste est incomplète", async () => {
      vi.mocked(listerAlertes).mockResolvedValue(reponse([alerte()], true));

      render(<AlertesPage />);

      // Se taire laisserait croire la liste complète — et l'endpoint n'offre
      // aucune pagination pour aller chercher le reste.
      const avis = await screen.findByText(/cette liste est incomplète/i);
      // Le plafond réel du serveur est annoncé, pas un nombre inventé.
      expect(avis.parentElement?.textContent).toContain("200");
    });

    it("ne dit RIEN quand la liste est complète", async () => {
      vi.mocked(listerAlertes).mockResolvedValue(reponse([alerte()], false));

      render(<AlertesPage />);

      await screen.findByText(/trafic interrompu/i);
      expect(screen.queryByText(/cette liste est incomplète/i)).toBeNull();
    });

    it("ne propose AUCUNE pagination", async () => {
      vi.mocked(listerAlertes).mockResolvedValue(reponse([alerte()], true));

      render(<AlertesPage />);

      await screen.findByText(/cette liste est incomplète/i);
      // L'endpoint n'expose ni `page` ni `offset` : un bouton « Suivant »
      // serait un bouton qui ne peut rien ramener.
      expect(screen.queryByRole("button", { name: /suivant|précédent|charger/i })).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Erreurs
  // ---------------------------------------------------------------------------
  describe("erreurs", () => {
    it("signale une panne du serveur", async () => {
      vi.mocked(listerAlertes).mockRejectedValue(new ApiError(500, "Erreur interne"));

      render(<AlertesPage />);

      expect(await screen.findByText(/n'ont pas pu être chargées/i)).toBeDefined();
      expect(screen.getByText("Erreur interne")).toBeDefined();
    });

    it("signale une panne réseau", async () => {
      vi.mocked(listerAlertes).mockRejectedValue(new NetworkError("Le serveur est injoignable."));

      render(<AlertesPage />);

      expect(await screen.findByText("Le serveur est injoignable.")).toBeDefined();
    });

    it("ne prétend PAS que le réseau circule normalement en cas d'erreur", async () => {
      vi.mocked(listerAlertes).mockRejectedValue(new ApiError(503, "Service indisponible"));

      render(<AlertesPage />);

      await screen.findByText(/n'ont pas pu être chargées/i);
      // Confondre « aucune perturbation » et « je ne sais pas » enverrait un
      // usager vers une ligne coupée.
      expect(screen.queryByText(/aucune perturbation en cours/i)).toBeNull();
    });
  });
});
