import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DetailTrajetPage from "./page";
import { AuthProvider } from "@/components/AuthProvider";
import { ApiError, NetworkError } from "@/lib/api";
import type { RouteDetail, Stop, User } from "@/lib/types";

const ID_TRAJET = "aaaaaaaa-0000-0000-0000-000000000001";

const remplacer = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: remplacer, push: vi.fn() }),
  // Le segment dynamique tel que Next le fournirait à la page.
  useParams: () => ({ id: ID_TRAJET }),
}));

// LEAFLET EST LA SEULE CHOSE SIMULÉE DU BLOC 5B. La vraie bibliothèque exige
// un vrai navigateur : jsdom n'a ni `ResizeObserver`, ni disposition calculée.
// On remplace donc UNIQUEMENT le fichier qui la contient — le cadre `Carte`,
// l'équivalent textuel et le calcul du tracé restent les vrais.
vi.mock("@/components/CarteLeaflet", () => ({
  default: ({ arrets, trace }: { arrets: unknown[]; trace: unknown[] | null }) => (
    <div
      data-testid="carte-leaflet"
      data-arrets={arrets.length}
      data-trace={
        trace === null ? "aucun" : trace.map((p) => (p as { nom: string }).nom).join(" > ")
      }
    />
  ),
}));

vi.mock("@/lib/auth-api", () => ({
  inscrire: vi.fn(),
  connecter: vi.fn(),
  utilisateurCourant: vi.fn(),
}));

vi.mock("@/lib/espace-api", () => ({
  suiviCarbone: vi.fn(),
  budgetHebdomadaire: vi.fn(),
  historiqueTrajets: vi.fn(),
  detailTrajet: vi.fn(),
}));

vi.mock("@/lib/itineraires-api", () => ({
  listerArrets: vi.fn(),
  rechercherItineraires: vi.fn(),
  enregistrerItineraire: vi.fn(),
  versRequeteEnregistrement: vi.fn(),
  supprimerTrajet: vi.fn(),
}));

const { utilisateurCourant } = await import("@/lib/auth-api");
const { detailTrajet } = await import("@/lib/espace-api");
const { listerArrets, supprimerTrajet } = await import("@/lib/itineraires-api");

const PROFIL: User = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "usager@exemple.fr",
  role: "USER",
  createdAt: "2026-08-01T10:00:00.000Z",
  deletedAt: null,
  preferences: null,
};

const GARE = "stop-gare-du-nord";
const CHATELET = "stop-chatelet";
const BASTILLE = "stop-bastille";

const arret = (id: string, name: string): Stop => ({
  id,
  name,
  latitude: 48.86,
  longitude: 2.35,
  pmrAccessible: true,
  operatorCode: "RATP",
  // `gtfsStopId` NUL : un arrêt saisi à la main doit garder son nom.
  gtfsStopId: null,
});

const ARRETS: Stop[] = [
  arret(GARE, "Gare du Nord"),
  arret(CHATELET, "Châtelet"),
  arret(BASTILLE, "Bastille"),
];

/**
 * Trajet de test — construit pour PIÉGER l'alignement segments/carbone.
 *
 * Les segments sont dans l'ordre chronologique (métro puis marche) ; les
 * `carbonRecords` sont triés par distance DÉCROISSANTE — soit l'ordre
 * inverse. Aligner les deux tableaux position par position attribuerait donc
 * le CO₂ du métro à l'étape de marche.
 */
const TRAJET: RouteDetail = {
  id: ID_TRAJET,
  originLat: 48.88,
  originLng: 2.355,
  destinationLat: 48.853,
  destinationLng: 2.369,
  requestedAt: "2026-08-25T09:30:00.000Z",
  totalDurationMin: 24,
  totalDistanceM: 4300,
  ecoScore: 82.4,
  carbonEstimate: 310,
  userId: PROFIL.id,
  segments: [
    {
      id: "seg-1",
      mode: "METRO",
      operator: "RATP",
      departureTime: "2026-08-25T09:30:00.000Z",
      arrivalTime: "2026-08-25T09:39:00.000Z",
      distanceM: 1500,
      line: "4",
      gtfsTripId: null,
      routeId: ID_TRAJET,
      fromStopId: GARE,
      toStopId: CHATELET,
    },
    {
      id: "seg-2",
      mode: "WALK",
      operator: "—",
      departureTime: "2026-08-25T09:39:00.000Z",
      arrivalTime: "2026-08-25T09:54:00.000Z",
      distanceM: 2800,
      line: "À pied",
      gtfsTripId: null,
      routeId: ID_TRAJET,
      fromStopId: CHATELET,
      toStopId: BASTILLE,
    },
  ],
  carbonRecords: [
    // Distance décroissante : la MARCHE vient en premier, alors qu'elle est
    // la SECONDE étape.
    {
      id: "carb-1",
      date: "2026-08-25T09:30:00.000Z",
      co2Grams: 0,
      mode: "WALK",
      distanceM: 2800,
      savedVsCarGrams: 610,
      userId: PROFIL.id,
      routeId: ID_TRAJET,
    },
    {
      id: "carb-2",
      date: "2026-08-25T09:30:00.000Z",
      co2Grams: 6,
      mode: "METRO",
      distanceM: 1500,
      savedVsCarGrams: 321,
      userId: PROFIL.id,
      routeId: ID_TRAJET,
    },
  ],
};

const rendre = () =>
  render(
    <AuthProvider>
      <DetailTrajetPage />
    </AuthProvider>,
  );

const authentifier = () => {
  window.localStorage.setItem("urbanflow.token", "jeton-valide");
  vi.mocked(utilisateurCourant).mockResolvedValue(PROFIL);
};

describe("/historique/[id]", () => {
  beforeEach(() => {
    remplacer.mockReset();
    vi.mocked(utilisateurCourant).mockReset();
    vi.mocked(detailTrajet).mockReset();
    vi.mocked(listerArrets).mockReset();
    vi.mocked(supprimerTrajet).mockReset();
    vi.mocked(listerArrets).mockResolvedValue(ARRETS);
  });

  // ---------------------------------------------------------------------------
  // Protection et chargement
  // ---------------------------------------------------------------------------
  describe("protection", () => {
    it("redirige un visiteur vers /connexion", async () => {
      rendre();

      await waitFor(() => expect(remplacer).toHaveBeenCalledWith("/connexion"));
      expect(detailTrajet).not.toHaveBeenCalled();
    });

    it("affiche le trajet à un usager authentifié", async () => {
      authentifier();
      vi.mocked(detailTrajet).mockResolvedValue(TRAJET);

      rendre();

      expect(
        await screen.findByRole("heading", {
          name: /gare du nord → bastille/i,
          level: 1,
        }),
      ).toBeDefined();
    });
  });

  describe("chargement", () => {
    beforeEach(() => {
      authentifier();
    });

    it("affiche un indicateur pendant le chargement", async () => {
      vi.mocked(detailTrajet).mockReturnValue(new Promise(() => {}));

      rendre();

      expect(await screen.findByText(/chargement du trajet/i)).toBeDefined();
    });

    it("appelle GET /api/routes/:id avec l'identifiant de l'URL", async () => {
      vi.mocked(detailTrajet).mockResolvedValue(TRAJET);

      rendre();

      // L'identifiant vient de `params`, qui est une PROMESSE dans cette
      // version de Next.js.
      await waitFor(() => expect(detailTrajet).toHaveBeenCalledWith("jeton-valide", ID_TRAJET));
    });
  });

  // ---------------------------------------------------------------------------
  // Informations générales
  // ---------------------------------------------------------------------------
  describe("informations générales", () => {
    beforeEach(() => {
      authentifier();
      vi.mocked(detailTrajet).mockResolvedValue(TRAJET);
    });

    it("affiche les totaux du trajet", async () => {
      rendre();

      expect(await screen.findByText("24 min")).toBeDefined();
      // 4300 m → « 4,3 km » ; 310 g ; éco-score arrondi.
      expect(screen.getByText("4,3 km")).toBeDefined();
      expect(screen.getByText("310 g")).toBeDefined();
      expect(screen.getByText("82/100")).toBeDefined();
    });

    it("nomme le départ et l'arrivée d'après les SEGMENTS", async () => {
      rendre();

      // `Route` ne stocke que des coordonnées ; les noms viennent du premier
      // et du dernier segment, résolus via GET /api/stops.
      expect(
        await screen.findByRole("heading", { name: /gare du nord → bastille/i }),
      ).toBeDefined();
    });

    it("reste lisible si le référentiel des arrêts est indisponible", async () => {
      vi.mocked(listerArrets).mockRejectedValue(new NetworkError("Le serveur est injoignable."));

      rendre();

      // Le trajet s'affiche quand même : seuls les NOMS manquent.
      expect(await screen.findByText("24 min")).toBeDefined();
      expect(screen.getByRole("heading", { name: /trajet enregistré/i, level: 1 })).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Segments
  // ---------------------------------------------------------------------------
  describe("étapes", () => {
    beforeEach(() => {
      authentifier();
      vi.mocked(detailTrajet).mockResolvedValue(TRAJET);
    });

    it("affiche les étapes DANS L'ORDRE du trajet", async () => {
      rendre();

      await screen.findByText("Gare du Nord → Châtelet");
      const etapes = screen.getAllByRole("listitem");

      // Le backend les rend triées par `departureTime` : on les affiche
      // telles quelles, dans une liste ORDONNÉE.
      expect(etapes[0].textContent).toContain("Gare du Nord → Châtelet");
      expect(etapes[1].textContent).toContain("Châtelet → Bastille");
    });

    it("affiche mode, ligne, opérateur et distance de chaque étape", async () => {
      rendre();

      // « Métro 4 · RATP », pas « METRO ».
      expect(await screen.findByText(/Métro 4 · RATP/)).toBeDefined();
      expect(screen.getByText(/Marche À pied/)).toBeDefined();
    });

    it("affiche les horaires estimés", async () => {
      rendre();

      await screen.findByText("Gare du Nord → Châtelet");
      const etapes = screen.getAllByRole("listitem");

      // L'HEURE AFFICHÉE EST LOCALE — « 09:30 » en UTC devient « 11:30 » à
      // Paris l'été, et c'est le comportement voulu : un voyageur lit l'heure
      // de son fuseau. On vérifie donc les attributs `datetime`, qui portent
      // l'instant EXACT en ISO, plutôt qu'un texte qui dépendrait de la
      // machine exécutant les tests.
      const horaires = etapes[0].querySelectorAll("time");
      expect(horaires).toHaveLength(2);
      expect(horaires[0].getAttribute("datetime")).toBe("2026-08-25T09:30:00.000Z");
      expect(horaires[1].getAttribute("datetime")).toBe("2026-08-25T09:39:00.000Z");
      // Et un horaire lisible est bien rendu, quel qu'il soit.
      expect(horaires[0].textContent).toMatch(/^\d{2}:\d{2}$/);
    });
  });

  // ---------------------------------------------------------------------------
  // Empreinte carbone — la précaution centrale
  // ---------------------------------------------------------------------------
  describe("empreinte carbone", () => {
    beforeEach(() => {
      authentifier();
      vi.mocked(detailTrajet).mockResolvedValue(TRAJET);
    });

    it("présente les enregistrements dans une section SÉPARÉE", async () => {
      rendre();

      expect(
        await screen.findByRole("heading", {
          name: /répartition de l'empreinte carbone/i,
        }),
      ).toBeDefined();
    });

    it("dit explicitement qu'ils ne correspondent pas aux étapes", async () => {
      rendre();

      // L'usager doit savoir que ces lignes ne se lisent pas en regard des
      // étapes : c'est une répartition par MODE.
      expect(await screen.findByText(/ne correspondent pas un à un aux étapes/i)).toBeDefined();
    });

    it("n'aligne JAMAIS un enregistrement sur une étape", async () => {
      rendre();

      const tableau = await screen.findByRole("table");
      const lignes = within(tableau).getAllByRole("row").slice(1);

      // Les segments sont [MÉTRO, MARCHE] ; les carbonRecords, triés par
      // distance décroissante, sont [MARCHE, MÉTRO]. Le tableau suit l'ordre
      // du BACKEND, jamais celui des étapes — les aligner attribuerait le CO₂
      // du métro à la marche.
      expect(lignes[0].textContent).toContain("Marche");
      expect(lignes[0].textContent).toContain("2,8 km");
      expect(lignes[1].textContent).toContain("Métro");
      expect(lignes[1].textContent).toContain("1,5 km");
    });

    it("affiche les valeurs de l'API sans les recalculer", async () => {
      rendre();

      const tableau = await screen.findByRole("table");

      // 0 g pour la marche — une valeur légitime, pas une absence.
      expect(within(tableau).getByText("0 g")).toBeDefined();
      expect(within(tableau).getByText("6 g")).toBeDefined();
      expect(within(tableau).getByText("610 g")).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Carte interactive (bloc 5B)
  // ---------------------------------------------------------------------------
  describe("carte", () => {
    const carte = () => screen.getByTestId("carte-leaflet");
    const traceAffiche = () => carte().getAttribute("data-trace");

    beforeEach(() => {
      authentifier();
    });

    it("affiche le trajet enregistré sur la carte", async () => {
      vi.mocked(detailTrajet).mockResolvedValue(TRAJET);

      rendre();

      expect(await screen.findByRole("heading", { name: /ce trajet sur la carte/i })).toBeDefined();
      // Trois points pour deux segments, dans l'ordre CHRONOLOGIQUE — celui
      // des segments, jamais celui des `carbonRecords`.
      await waitFor(() => expect(traceAffiche()).toBe("Gare du Nord > Châtelet > Bastille"));
    });

    it("réutilise les arrêts déjà chargés, sans appel par étape", async () => {
      vi.mocked(detailTrajet).mockResolvedValue(TRAJET);

      rendre();

      await waitFor(() => expect(carte().getAttribute("data-arrets")).toBe("3"));
      // Un seul GET /api/stops : la carte ne résout pas chaque arrêt
      // individuellement (pas de N+1 réseau).
      expect(listerArrets).toHaveBeenCalledTimes(1);
    });

    it("ne trace RIEN si le référentiel des arrêts est indisponible", async () => {
      vi.mocked(detailTrajet).mockResolvedValue(TRAJET);
      vi.mocked(listerArrets).mockRejectedValue(new NetworkError("Le serveur est injoignable."));

      rendre();

      // Sans positions, aucune ligne ne peut être honnête. Leaflet n'est même
      // pas chargé : il n'y a rien à dessiner, et la carte le dit.
      expect(await screen.findByText(/aucun arrêt à afficher/i)).toBeDefined();
      expect(screen.queryByTestId("carte-leaflet")).toBeNull();
      expect(screen.getByText(/le tracé ne peut pas être dessiné/i)).toBeDefined();
      // Le trajet, lui, reste entièrement affiché.
      expect(screen.getByText("24 min")).toBeDefined();
    });

    it("annonce que le tracé est un SCHÉMA, pas le chemin réel", async () => {
      vi.mocked(detailTrajet).mockResolvedValue(TRAJET);

      rendre();

      expect(await screen.findByText(/schéma du trajet, pas le chemin exact/i)).toBeDefined();
    });

    it("garde les étapes lisibles EN TEXTE à côté de la carte", async () => {
      vi.mocked(detailTrajet).mockResolvedValue(TRAJET);

      rendre();

      // La carte est un complément : la retirer ne ferait perdre aucune
      // information sur le trajet.
      const etapes = within(await screen.findByRole("region", { name: /étapes/i }));
      expect(etapes.getByText("Gare du Nord → Châtelet")).toBeDefined();
      expect(etapes.getByText("Châtelet → Bastille")).toBeDefined();
    });

    it("n'apparaît pas tant que le trajet n'est pas chargé", async () => {
      vi.mocked(detailTrajet).mockReturnValue(new Promise(() => {}));

      rendre();

      await screen.findByText(/chargement du trajet/i);
      // Une carte vide sous un indicateur de chargement laisserait croire que
      // le trajet n'a pas d'étapes.
      expect(screen.queryByTestId("carte-leaflet")).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Suppression (étape 5A-9)
  // ---------------------------------------------------------------------------
  describe("suppression", () => {
    const ouvrir = () => screen.getByRole("button", { name: /^supprimer ce trajet$/i });
    const confirmer = () => screen.getByRole("button", { name: /confirmer la suppression/i });
    const annuler = () => screen.getByRole("button", { name: /annuler/i });

    /// Affiche le trajet, puis ouvre l'état de confirmation.
    const demanderSuppression = async () => {
      const utilisateur = userEvent.setup();
      await utilisateur.click(
        await screen.findByRole("button", {
          name: /^supprimer ce trajet$/i,
        }),
      );
      return utilisateur;
    };

    beforeEach(() => {
      authentifier();
      vi.mocked(detailTrajet).mockResolvedValue(TRAJET);
    });

    describe("confirmation", () => {
      it("propose la suppression sans rien déclencher", async () => {
        rendre();

        expect(
          await screen.findByRole("button", {
            name: /^supprimer ce trajet$/i,
          }),
        ).toBeDefined();
        expect(supprimerTrajet).not.toHaveBeenCalled();
      });

      it("le PREMIER clic n'appelle AUCUN DELETE", async () => {
        rendre();

        await demanderSuppression();

        // Une action destructive ne part jamais sur un seul geste.
        expect(supprimerTrajet).not.toHaveBeenCalled();
      });

      it("affiche une demande de confirmation explicite", async () => {
        rendre();

        await demanderSuppression();

        expect(screen.getByText(/confirmer la suppression de ce trajet/i)).toBeDefined();
        expect(screen.getByText(/cette action est définitive/i)).toBeDefined();
      });

      it("propose Annuler ET Confirmer", async () => {
        rendre();

        await demanderSuppression();

        expect(annuler()).toBeDefined();
        expect(confirmer()).toBeDefined();
      });

      it("place le focus sur Annuler, pas sur Confirmer", async () => {
        rendre();

        await demanderSuppression();

        // Sur une action destructive, le geste par défaut doit être celui qui
        // ne détruit rien : appuyer sur Entrée ne doit pas supprimer.
        await waitFor(() => expect(document.activeElement).toBe(annuler()));
      });

      it("annule sans aucun appel API", async () => {
        rendre();
        const utilisateur = await demanderSuppression();

        await utilisateur.click(annuler());

        expect(supprimerTrajet).not.toHaveBeenCalled();
        // On revient à l'état initial : l'action reste proposée.
        expect(ouvrir()).toBeDefined();
        expect(screen.queryByText(/confirmer la suppression de ce trajet/i)).toBeNull();
      });

      it("laisse le trajet entièrement visible pendant la confirmation", async () => {
        rendre();

        await demanderSuppression();

        expect(screen.getByText("Gare du Nord → Châtelet")).toBeDefined();
        expect(screen.getByText("24 min")).toBeDefined();
      });
    });

    describe("appel API", () => {
      it("transmet le jeton et l'identifiant du trajet", async () => {
        vi.mocked(supprimerTrajet).mockResolvedValue(undefined);
        rendre();
        const utilisateur = await demanderSuppression();

        await utilisateur.click(confirmer());

        // Le jeton vient d'AuthProvider — aucune lecture directe de
        // localStorage dans la page.
        await waitFor(() =>
          expect(supprimerTrajet).toHaveBeenCalledWith("jeton-valide", ID_TRAJET),
        );
      });

      it("n'appelle DELETE qu'une seule fois", async () => {
        vi.mocked(supprimerTrajet).mockResolvedValue(undefined);
        rendre();
        const utilisateur = await demanderSuppression();

        await utilisateur.click(confirmer());

        await waitFor(() => expect(supprimerTrajet).toHaveBeenCalledTimes(1));
      });
    });

    describe("suppression en cours", () => {
      it("annonce que la suppression est en cours", async () => {
        vi.mocked(supprimerTrajet).mockReturnValue(new Promise(() => {}));
        rendre();
        const utilisateur = await demanderSuppression();

        await utilisateur.click(confirmer());

        expect(await screen.findByRole("button", { name: /suppression en cours/i })).toBeDefined();
      });

      it("désactive les DEUX boutons pendant l'envoi", async () => {
        vi.mocked(supprimerTrajet).mockReturnValue(new Promise(() => {}));
        rendre();
        const utilisateur = await demanderSuppression();

        await utilisateur.click(confirmer());

        // Confirmer : empêche un second DELETE, qui répondrait 404 et
        // afficherait une erreur pour une suppression pourtant réussie.
        // Annuler : n'annulerait rien d'une requête déjà partie.
        await waitFor(() => {
          expect(
            screen.getByRole("button", { name: /suppression en cours/i }).hasAttribute("disabled"),
          ).toBe(true);
          expect(annuler().hasAttribute("disabled")).toBe(true);
        });
      });

      it("ne redirige PAS avant la réponse du serveur", async () => {
        vi.mocked(supprimerTrajet).mockReturnValue(new Promise(() => {}));
        rendre();
        const utilisateur = await demanderSuppression();

        await utilisateur.click(confirmer());
        await screen.findByRole("button", { name: /suppression en cours/i });

        expect(remplacer).not.toHaveBeenCalledWith("/historique");
      });
    });

    describe("succès", () => {
      it("redirige vers l'historique APRÈS la réponse", async () => {
        vi.mocked(supprimerTrajet).mockResolvedValue(undefined);
        rendre();
        const utilisateur = await demanderSuppression();

        await utilisateur.click(confirmer());

        // `replace` : revenir en arrière ramènerait sur un trajet supprimé.
        await waitFor(() => expect(remplacer).toHaveBeenCalledWith("/historique"));
      });
    });

    describe("échecs", () => {
      const echouerAvec = async (erreur: unknown) => {
        vi.mocked(supprimerTrajet).mockRejectedValue(erreur);
        rendre();
        const utilisateur = await demanderSuppression();
        await utilisateur.click(confirmer());
        await screen.findByText(/n'a pas pu être supprimé/i);
        return utilisateur;
      };

      it("signale une erreur serveur", async () => {
        await echouerAvec(new ApiError(500, "Erreur interne"));

        expect(screen.getByRole("alert").textContent).toContain("Erreur interne");
      });

      it("signale un trajet introuvable (404)", async () => {
        await echouerAvec(new ApiError(404, "Itinéraire introuvable"));

        expect(screen.getByRole("alert").textContent).toContain("introuvable");
      });

      it("signale une session expirée (401)", async () => {
        await echouerAvec(new ApiError(401, "Token invalide ou expiré"));

        expect(screen.getByRole("alert").textContent).toContain("expiré");
      });

      it("signale une panne réseau", async () => {
        await echouerAvec(new NetworkError("Le serveur est injoignable."));

        expect(screen.getByRole("alert").textContent).toContain("injoignable");
      });

      it("garde le trajet VISIBLE après un échec", async () => {
        await echouerAvec(new ApiError(500, "Panne"));

        // Rien n'a été retiré localement : il n'y avait rien à remettre.
        expect(screen.getByText("Gare du Nord → Châtelet")).toBeDefined();
        expect(screen.getByText("24 min")).toBeDefined();
      });

      it("n'annonce JAMAIS un succès après un échec", async () => {
        await echouerAvec(new ApiError(500, "Panne"));

        expect(remplacer).not.toHaveBeenCalledWith("/historique");
        expect(screen.queryByText(/trajet supprimé/i)).toBeNull();
      });

      it("permet de réessayer", async () => {
        const utilisateur = await echouerAvec(new ApiError(500, "Panne"));

        expect(confirmer().hasAttribute("disabled")).toBe(false);

        vi.mocked(supprimerTrajet).mockResolvedValue(undefined);
        await utilisateur.click(confirmer());

        await waitFor(() => expect(remplacer).toHaveBeenCalledWith("/historique"));
      });

      it("permet de renoncer après un échec", async () => {
        const utilisateur = await echouerAvec(new ApiError(500, "Panne"));

        await utilisateur.click(annuler());

        expect(ouvrir()).toBeDefined();
      });

      it("ne révèle RIEN sur la propriété du trajet", async () => {
        // Le backend répond 404 aussi bien pour un trajet inexistant que pour
        // celui d'un autre usager — et jamais 403. L'interface ne doit pas
        // introduire la distinction que le backend refuse de faire.
        await echouerAvec(new ApiError(404, "Itinéraire introuvable"));

        const page = document.body.textContent ?? "";
        expect(page).not.toMatch(/autre utilisateur|appartient|interdit|403/i);
      });
    });

    describe("visiteur", () => {
      it("n'expose AUCUNE action de suppression", async () => {
        window.localStorage.clear();
        vi.mocked(utilisateurCourant).mockReset();
        rendre();

        await waitFor(() => expect(remplacer).toHaveBeenCalledWith("/connexion"));
        // La protection de route agit avant tout affichage : ni bouton, ni
        // appel possible.
        expect(screen.queryByRole("button", { name: /supprimer/i })).toBeNull();
        expect(supprimerTrajet).not.toHaveBeenCalled();
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Erreurs
  // ---------------------------------------------------------------------------
  describe("erreurs", () => {
    beforeEach(() => {
      authentifier();
    });

    it("annonce un trajet introuvable sur un 404", async () => {
      vi.mocked(detailTrajet).mockRejectedValue(new ApiError(404, "Itinéraire introuvable"));

      rendre();

      expect(await screen.findByText(/trajet introuvable/i)).toBeDefined();
    });

    it("ne révèle JAMAIS qu'un trajet appartient à quelqu'un d'autre", async () => {
      // Le backend répond 404 aussi bien pour un trajet inexistant que pour
      // celui d'un autre usager — dire la différence révélerait son existence.
      vi.mocked(detailTrajet).mockRejectedValue(new ApiError(404, "Itinéraire introuvable"));

      rendre();

      await screen.findByText(/trajet introuvable/i);
      const page = document.body.textContent ?? "";
      expect(page).not.toMatch(/autre utilisateur|appartient|interdit|403/i);
    });

    it("signale une panne réseau", async () => {
      vi.mocked(detailTrajet).mockRejectedValue(new NetworkError("Le serveur est injoignable."));

      rendre();

      const alerte = await screen.findByRole("alert");
      expect(alerte.textContent).toContain("injoignable");
    });

    it("signale une erreur serveur", async () => {
      vi.mocked(detailTrajet).mockRejectedValue(new ApiError(500, "Erreur interne"));

      rendre();

      const alerte = await screen.findByRole("alert");
      expect(alerte.textContent).toContain("Erreur interne");
    });

    it("propose toujours le retour à l'historique", async () => {
      vi.mocked(detailTrajet).mockRejectedValue(new ApiError(404, "Introuvable"));

      rendre();

      await screen.findByText(/trajet introuvable/i);
      expect(screen.getAllByRole("link", { name: /historique/i }).length).toBeGreaterThan(0);
    });
  });
});
