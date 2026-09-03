import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RecherchePage from "./page";
import { AuthProvider } from "@/components/AuthProvider";
import { LangueProvider } from "@/components/LangueProvider";
import { ApiError, NetworkError } from "@/lib/api";
import type {
  FavoriteAddress,
  Itinerary,
  ItineraryCarbon,
  Stop,
  User,
} from "@/lib/types";

// Seul le RÉSEAU est simulé. Le formulaire, son état, sa validation et le
// rendu des résultats sont les vrais : c'est précisément ce qu'on veut
// éprouver.
// `versRequeteEnregistrement` n'est PAS simulée : c'est elle qui fabrique le
// corps envoyé au backend, et la laisser réelle est le seul moyen de détecter
// une erreur de câblage — un `originLon` au lieu d'`originLng`, par exemple.
vi.mock("@/lib/itineraires-api", async (original) => ({
  ...(await original<typeof import("@/lib/itineraires-api")>()),
  listerArrets: vi.fn(),
  modesDuReseau: vi.fn(),
  rechercherItineraires: vi.fn(),
  enregistrerItineraire: vi.fn(),
}));

// LEAFLET EST LA SEULE CHOSE SIMULÉE DU BLOC 5B. La vraie bibliothèque exige
// un vrai navigateur : jsdom n'a ni `ResizeObserver`, ni disposition calculée,
// ni canvas. On remplace donc UNIQUEMENT le fichier qui la contient — le cadre
// `Carte`, l'équivalent textuel et le calcul du tracé restent les vrais, et
// c'est bien eux qu'on veut éprouver.
//
// Le remplaçant EXPOSE ses propriétés dans le DOM : c'est ainsi qu'on vérifie
// ce que la page transmet réellement à la carte.
/**
 * Ce que la page a transmis en dernier au composant de carte.
 *
 * ⚠️ C'EST LA SEULE FAÇON D'ÉPROUVER LES INTERACTIONS DE CARTE dans jsdom :
 * Leaflet ne s'y dessine pas, donc aucun clic réel n'est possible. On capture
 * les rappels et on les déclenche à la main — ce qui teste exactement le
 * contrat entre la page et la carte, et rien de Leaflet.
 */
let derniersProps: {
  arrets: { id: string; nom: string; latitude: number; longitude: number }[];
  onChoisirArret?: (arret: unknown, role: "depart" | "arrivee") => void;
  onCentreDeplace?: (latitude: number, longitude: number) => void;
  velib?: unknown[] | null;
} = { arrets: [] };

/// Simule un clic sur le n-ième arrêt dessiné, avec le rôle choisi.
const cliquerArret = (index: number, role: "depart" | "arrivee") => {
  act(() => {
    derniersProps.onChoisirArret?.(derniersProps.arrets[index], role);
  });
};

/// Simule un déplacement de la carte vers un nouveau centre.
const deplacerLaCarte = (latitude: number, longitude: number) => {
  act(() => {
    derniersProps.onCentreDeplace?.(latitude, longitude);
  });
};

vi.mock("@/components/CarteLeaflet", () => ({
  default: (props: {
    arrets: { id: string; nom: string; latitude: number; longitude: number }[];
    trace: unknown[] | null;
    troncons?: unknown[] | null;
    onChoisirArret?: (arret: unknown, role: "depart" | "arrivee") => void;
    onCentreDeplace?: (latitude: number, longitude: number) => void;
    velib?: unknown[] | null;
  }) => {
    derniersProps = props;
    const { arrets, trace, troncons, velib } = props;

    return (
    <div
      data-testid="carte-leaflet"
      data-arrets={arrets.length}
      data-trace={
        trace === null ? "aucun" : trace.map((p) => (p as { nom: string }).nom).join(" > ")
      }
      // Chaque tronçon est résumé par sa PROVENANCE et son nombre de points :
      // c'est ce qui permet de vérifier qu'une géométrie réelle est bien
      // suivie, et qu'une droite de repli est bien signalée comme telle.
      data-troncons={
        troncons == null
          ? "aucun"
          : troncons
              .map((t) => {
                const troncon = t as { source: string; points: unknown[] };
                return `${troncon.source}:${troncon.points.length}`;
              })
              .join("|")
      }
      data-velib={velib == null ? "aucun" : String(velib.length)}
      />
    );
  },
}));

// Le routeur de Next : `useRouter` exige un contexte que jsdom n'a pas. On le
// remplace par une navigation OBSERVABLE — c'est ainsi qu'on vérifie que
// « Voir le trajet » ouvre bien /itineraire.
const pousser = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pousser, replace: vi.fn(), refresh: vi.fn() }),
}));

// Le VRAI AuthProvider est utilisé, avec le VRAI localStorage : c'est lui qui
// décide si l'enregistrement est proposé.
vi.mock("@/lib/geocoding-api", () => ({ rechercherAdresses: vi.fn() }));

// Le client Vélib' : la couche est masquée par défaut, donc la plupart des
// tests ne le déclenchent jamais. Un appel inattendu se verrait ici.
vi.mock("@/lib/velib-api", () => ({ velibProches: vi.fn() }));

vi.mock("@/lib/adresses-api", () => ({
  listerAdresses: vi.fn(),
  creerAdresse: vi.fn(),
  modifierAdresse: vi.fn(),
  supprimerAdresse: vi.fn(),
}));

vi.mock("@/lib/auth-api", () => ({
  inscrire: vi.fn(),
  connecter: vi.fn(),
  utilisateurCourant: vi.fn(),
}));

// `versSegmentsCarbone` n'est PAS simulée : c'est une fonction pure, testée
// à part, et la laisser réelle vérifie au passage que la page lui transmet
// bien les segments de l'itinéraire.
vi.mock("@/lib/carbone-api", async (original) => ({
  ...(await original<typeof import("@/lib/carbone-api")>()),
  estimerCarbone: vi.fn(),
}));

const { listerArrets, modesDuReseau, rechercherItineraires, enregistrerItineraire } =
  await import("@/lib/itineraires-api");
const { estimerCarbone } = await import("@/lib/carbone-api");
const { velibProches } = await import("@/lib/velib-api");
const { utilisateurCourant } = await import("@/lib/auth-api");
const { listerAdresses } = await import("@/lib/adresses-api");
const { rechercherAdresses } = await import("@/lib/geocoding-api");

const PROFIL: User = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "usager@exemple.fr",
  role: "USER",
  createdAt: "2026-08-01T10:00:00.000Z",
  deletedAt: null,
  preferences: null,
};

const ARRETS: Stop[] = [
  {
    id: "aaaaaaaa-0000-0000-0000-000000000001",
    name: "Gare du Nord",
    latitude: 48.88,
    longitude: 2.355,
    pmrAccessible: true,
    operatorCode: "RATP",
    gtfsStopId: "N1",
  },
  {
    id: "aaaaaaaa-0000-0000-0000-000000000002",
    name: "Châtelet",
    latitude: 48.858,
    longitude: 2.347,
    pmrAccessible: false,
    operatorCode: "RATP",
    gtfsStopId: "N2",
  },
  {
    id: "aaaaaaaa-0000-0000-0000-000000000003",
    name: "Bastille",
    latitude: 48.853,
    longitude: 2.369,
    pmrAccessible: true,
    operatorCode: "RATP",
    gtfsStopId: "N3",
  },
];

/**
 * Empreinte disponible — la forme que le backend rend depuis la Phase 4.
 *
 * Elle voyage AVEC l'itinéraire : il n'y a plus de second appel `POST
 * /api/carbone` depuis cet écran.
 */
const carbone = (
  co2Grams: number,
  carCo2Grams: number,
  savedVsCarGrams: number,
  ecoScore: number,
): ItineraryCarbon => ({
  status: "CARBON_AVAILABLE",
  co2Grams,
  carCo2Grams,
  savedVsCarGrams,
  ecoScore,
  reason: null,
});

/**
 * Empreinte INDISPONIBLE.
 *
 * ⚠️ TOUS LES CHAMPS À `null`, JAMAIS À ZÉRO : « nous ne savons pas » ne se
 * dit pas « ce trajet ne pollue pas ».
 */
const CARBONE_ABSENT: ItineraryCarbon = {
  status: "CARBON_UNAVAILABLE",
  co2Grams: null,
  carCo2Grams: null,
  savedVsCarGrams: null,
  ecoScore: null,
  reason: "Le calcul des émissions est momentanément indisponible.",
};

const RAPIDE: Itinerary = {
  criterion: "FASTEST",
  totalDistanceM: 4300,
  totalDurationMin: 24,
  numberOfTransfers: 0,
  carbon: carbone(316, 937, 621, 66.3),
  segments: [
    {
      fromStopId: ARRETS[0].id,
      fromStopName: "Gare du Nord",
      fromStopLat: ARRETS[0].latitude,
      fromStopLon: ARRETS[0].longitude,
      toStopId: ARRETS[1].id,
      toStopName: "Châtelet",
      toStopLat: ARRETS[1].latitude,
      toStopLon: ARRETS[1].longitude,
      mode: "METRO",
      lineName: "4",
      operator: "RATP",
      lineId: "ligne-4",
      gtfsLineId: null,
      distanceM: 2800,
      durationMin: 9,
      // Tracé RÉEL : ce segment doit être dessiné en trait plein.
      geometry: {
        type: "LineString",
        // ⚠️ [longitude, latitude] — l'ordre GeoJSON.
        coordinates: [
          [ARRETS[0].longitude, ARRETS[0].latitude],
          [2.36, 48.865],
          [ARRETS[1].longitude, ARRETS[1].latitude],
        ],
      },
      geometrySource: "SHAPE",
    },
    {
      fromStopId: ARRETS[1].id,
      fromStopName: "Châtelet",
      fromStopLat: ARRETS[1].latitude,
      fromStopLon: ARRETS[1].longitude,
      toStopId: ARRETS[2].id,
      toStopName: "Bastille",
      toStopLat: ARRETS[2].latitude,
      toStopLon: ARRETS[2].longitude,
      mode: "WALK",
      lineName: "À pied",
      operator: "—",
      lineId: "ligne-marche",
      gtfsLineId: null,
      distanceM: 1500,
      durationMin: 15,
      // Aucune géométrie publiée : droite, et l'interface doit le dire.
      geometry: null,
      geometrySource: "STRAIGHT",
    },
  ],
};

/**
 * Le second itinéraire : plus lent, mais MOINS ÉMETTEUR.
 *
 * ⚠️ Les chiffres sont choisis pour que le compromis soit vérifiable de tête :
 * 31 − 24 = 7 minutes de plus, et 316 − 200 = 116 g de CO₂ en moins.
 */
const PROPRE: Itinerary = {
  criterion: "LOWEST_CO2",
  totalDistanceM: 3900,
  totalDurationMin: 31,
  numberOfTransfers: 0,
  carbon: carbone(200, 850, 650, 76.5),
  segments: [
    {
      fromStopId: ARRETS[0].id,
      fromStopName: "Gare du Nord",
      fromStopLat: ARRETS[0].latitude,
      fromStopLon: ARRETS[0].longitude,
      toStopId: ARRETS[2].id,
      toStopName: "Bastille",
      toStopLat: ARRETS[2].latitude,
      toStopLon: ARRETS[2].longitude,
      mode: "BUS",
      lineName: "38",
      operator: "RATP",
      lineId: "ligne-38",
      gtfsLineId: null,
      distanceM: 3900,
      durationMin: 31,
      geometry: null,
      geometrySource: "STRAIGHT",
    },
  ],
};

/// Ancien nom, conservé pour ne pas réécrire des dizaines de tests.
const COURT = PROPRE;

/**
 * ⚠️ `LangueProvider` DANS `AuthProvider`, comme dans la vraie mise en page :
 * il lit la préférence de langue du compte. L'inverse ferait lire un profil
 * absent, et le français par défaut masquerait le bogue.
 *
 * La langue par défaut restant le français, tous les tests écrits avant
 * l'internationalisation continuent d'attendre les mêmes textes.
 */
const rendre = () =>
  render(
    <AuthProvider>
      <LangueProvider>
        <RecherchePage />
      </LangueProvider>
    </AuthProvider>,
  );

/// Place un jeton et fait répondre /me : l'usager est authentifié.
const authentifier = () => {
  window.localStorage.setItem("urbanflow.token", "jeton-valide");
  vi.mocked(utilisateurCourant).mockResolvedValue(PROFIL);
};

/// Les arrêts du réseau vivent désormais dans un bloc REPLIÉ (Phase 3A) : la
/// saisie libre d'adresse est l'entrée principale, la liste d'arrêts une
/// option secondaire. Les tests antérieurs l'ouvrent donc avant de choisir.
const ouvrirArrets = async () => {
  const repli = await screen.findByText("Choisir directement un arrêt du réseau");
  if (!(repli.closest("details") as HTMLDetailsElement | null)?.open) {
    await userEvent.setup().click(repli);
  }
};

/// Choisit un départ et une arrivée, puis lance la recherche.
const chercher = async (depart = "Gare du Nord", arrivee = "Bastille") => {
  const utilisateur = userEvent.setup();

  await utilisateur.selectOptions(
    await (await ouvrirArrets(), screen.getByLabelText("Arrêt de départ")),
    screen.getAllByRole("option", { name: new RegExp(depart) })[0],
  );
  await utilisateur.selectOptions(
    screen.getByLabelText("Arrêt d'arrivée"),
    screen.getAllByRole("option", { name: new RegExp(arrivee) })[1],
  );
  await utilisateur.click(screen.getByRole("button", { name: /rechercher/i }));

  return utilisateur;
};

describe("/recherche", () => {
  beforeEach(() => {
    vi.mocked(listerArrets).mockReset();
    vi.mocked(rechercherItineraires).mockReset();
    vi.mocked(estimerCarbone).mockReset();
    vi.mocked(enregistrerItineraire).mockReset();
    vi.mocked(utilisateurCourant).mockReset();
    vi.mocked(listerAdresses).mockReset();
    // Par defaut : aucune adresse favorite. Les tests anterieurs au bloc 7
    // doivent se comporter exactement comme avant.
    vi.mocked(listerAdresses).mockResolvedValue([]);
    vi.mocked(rechercherAdresses).mockReset();
    vi.mocked(velibProches).mockReset();
    vi.mocked(modesDuReseau).mockReset();
    // Le réseau de démonstration : du tram et du bus, comme la CTS.
    vi.mocked(modesDuReseau).mockResolvedValue({
      modes: [
        { mode: "TRAM", lineCount: 6 },
        { mode: "BUS", lineCount: 41 },
        { mode: "WALK", lineCount: 1 },
      ],
    });
    // ⚠️ UNE PAGE, PAS UN TABLEAU (Phase 4) : `GET /api/stops` est borné.
    vi.mocked(listerArrets).mockResolvedValue({
      items: ARRETS.map((arret) => ({ ...arret, distanceM: null })),
      page: 1,
      limit: 200,
      total: ARRETS.length,
    });
    // L'écran ne doit plus JAMAIS appeler le calcul carbone : si un test le
    // déclenchait malgré tout, la promesse en suspens le ferait échouer par
    // dépassement de délai plutôt que passer inaperçu.
    vi.mocked(estimerCarbone).mockReturnValue(new Promise(() => {}));
  });

  // ---------------------------------------------------------------------------
  // Chargement du formulaire
  // ---------------------------------------------------------------------------
  describe("formulaire", () => {
    it("affiche les deux listes d'arrêts et le bouton", async () => {
      rendre();

      expect(await (await ouvrirArrets(), screen.getByLabelText("Arrêt de départ"))).toBeDefined();
      expect(screen.getByLabelText("Arrêt d'arrivée")).toBeDefined();
      expect(screen.getByRole("button", { name: /rechercher/i })).toBeDefined();
    });

    it("propose les arrêts renvoyés par le backend", async () => {
      rendre();

      const depart = await (await ouvrirArrets(), screen.getByLabelText("Arrêt de départ"));
      // Trois arrêts + l'option d'invite. « Ma position » a quitté la liste
      // pour devenir un bouton (Phase 3A).
      expect(within(depart).getAllByRole("option")).toHaveLength(4);
      expect(within(depart).getByText(/Châtelet/)).toBeDefined();

      // L'ARRIVÉE, elle, n'offre PAS la position : on ne va pas là où on est
      // déjà. Trois arrêts + l'invite.
      const arrivee = screen.getByLabelText("Arrêt d'arrivée");
      expect(within(arrivee).getAllByRole("option")).toHaveLength(4);
      expect(within(arrivee).queryByText(/ma position/i)).toBeNull();
    });

    it("signale les arrêts accessibles en fauteuil", async () => {
      rendre();

      const depart = await (await ouvrirArrets(), screen.getByLabelText("Arrêt de départ"));
      // `pmrAccessible` est une donnée réelle du modèle, utile à une partie
      // des usagers.
      expect(within(depart).getByText(/Gare du Nord ♿/)).toBeDefined();
    });

    it("affiche un indicateur pendant le chargement des arrêts", () => {
      vi.mocked(listerArrets).mockReturnValue(new Promise(() => {}));

      rendre();

      expect(screen.getByText(/chargement des arrêts/i)).toBeDefined();
    });

    it("signale l'échec du chargement des arrêts", async () => {
      vi.mocked(listerArrets).mockRejectedValue(new NetworkError("Le serveur est injoignable."));

      rendre();

      const alerte = await screen.findByRole("alert");
      expect(alerte.textContent).toContain("injoignable");
    });
  });

  // ---------------------------------------------------------------------------
  // Validation minimale
  // ---------------------------------------------------------------------------
  describe("validation", () => {
    it("désactive la recherche tant que les deux arrêts ne sont pas choisis", async () => {
      rendre();
      await (await ouvrirArrets(), screen.getByLabelText("Arrêt de départ"));

      expect(screen.getByRole("button", { name: /rechercher/i }).hasAttribute("disabled")).toBe(
        true,
      );
    });

    it("refuse un départ et une arrivée identiques", async () => {
      rendre();
      const utilisateur = userEvent.setup();
      const depart = await (await ouvrirArrets(), screen.getByLabelText("Arrêt de départ"));

      await utilisateur.selectOptions(depart, ARRETS[0].id);
      await utilisateur.selectOptions(screen.getByLabelText("Arrêt d'arrivée"), ARRETS[0].id);

      // Un aller-retour réseau pour apprendre cela serait discourtois : le
      // backend rendrait une liste vide.
      expect(await screen.findByText(/doivent être différents/i)).toBeDefined();
      expect(screen.getByRole("button", { name: /rechercher/i }).hasAttribute("disabled")).toBe(
        true,
      );
      expect(rechercherItineraires).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Appel API
  // ---------------------------------------------------------------------------
  describe("appel API", () => {
    it("transmet les COORDONNÉES des arrêts choisis", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
      rendre();

      await chercher();

      // Le contrat backend attend quatre coordonnées, jamais des
      // identifiants d'arrêt.
      await waitFor(() =>
        expect(rechercherItineraires).toHaveBeenCalledWith({
          fromLat: 48.88,
          fromLon: 2.355,
          toLat: 48.853,
          toLon: 2.369,
        }),
      );
    });

    it("désactive le bouton pendant la recherche", async () => {
      let libere: (valeur: Itinerary[]) => void = () => {};
      vi.mocked(rechercherItineraires).mockReturnValue(
        new Promise((resolve) => {
          libere = resolve;
        }),
      );
      rendre();

      await chercher();

      // Sans ce verrou, un double clic lancerait deux recherches
      // concurrentes, et la plus lente écraserait la plus rapide.
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: /recherche en cours/i }).hasAttribute("disabled"),
        ).toBe(true),
      );

      libere([RAPIDE]);
    });

    it("affiche un indicateur pendant la recherche", async () => {
      vi.mocked(rechercherItineraires).mockReturnValue(new Promise(() => {}));
      rendre();

      await chercher();

      expect(await screen.findByText(/recherche d'itinéraires/i)).toBeDefined();
    });

    it("n'appelle l'API qu'une fois par soumission", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
      rendre();

      await chercher();

      await screen.findByText("Le plus rapide");
      expect(rechercherItineraires).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Résultats
  // ---------------------------------------------------------------------------
  describe("résultats", () => {
    it("n'affiche rien avant la première recherche", async () => {
      rendre();
      await (await ouvrirArrets(), screen.getByLabelText("Arrêt de départ"));

      // « Pas encore cherché » n'est pas « rien trouvé ».
      //
      // On vise le TITRE du bloc de résultats, pas un texte libre : le
      // paragraphe d'introduction contient lui aussi « le plus rapide », et
      // une recherche trop large passerait sans rien prouver.
      expect(screen.queryByText(/aucun itinéraire/i)).toBeNull();
      expect(screen.queryByRole("heading", { name: /itinéraires? proposés?/i })).toBeNull();
    });

    it("affiche un itinéraire avec ses totaux", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
      rendre();

      await chercher();

      expect(await screen.findByText("Le plus rapide")).toBeDefined();
      // Portée à la LISTE des résultats : depuis le bloc 5B, l'équivalent
      // textuel de la carte reprend volontairement les mêmes chiffres, et une
      // recherche sur toute la page en trouverait donc deux.
      const liste = within(screen.getByRole("region", { name: /itinéraire/i }));
      // 24 min, 4300 m → « 4,3 km ». Le nombre de tronçons a disparu de
      // l'en-tête au profit du RÉSUMÉ des modes : « 2 étapes » n'apprenait
      // rien, « Métro 4 + Marche » dit ce qu'on fait.
      expect(liste.getByText(/24 min/)).toBeDefined();
      expect(liste.getByText(/4,3 km/)).toBeDefined();
      expect(liste.getByText("Métro 4 + Marche")).toBeDefined();
    });

    it("REGROUPE les étapes par ligne", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
      rendre();

      await chercher();

      // ⚠️ Le titre d'une étape est la LIGNE, pas le couple d'arrêts : c'est
      // ce qu'on lit d'abord. « Métro 4 », jamais « METRO » (exigence 4E-2).
      expect(await screen.findByText("Métro 4")).toBeDefined();

      // ⚠️ PORTÉE À LA ZONE DES RÉSULTATS. Le filtre de modes porte lui aussi
      // un bouton « Marche » : chercher dans toute la page confondrait
      // l'étape et le filtre.
      const resultats = within(screen.getByRole("region", { name: /itinéraire/i }));

      // La marche n'a pas de numéro de ligne : « Marche À pied » n'aurait
      // aucun sens pour un usager.
      expect(resultats.getByText("Marche")).toBeDefined();

      // Le trajet du groupe reste lisible, avec son nombre d'arrêts.
      expect(screen.getByText(/Gare du Nord → Châtelet/)).toBeDefined();
      expect(screen.getByText(/1 arrêt/)).toBeDefined();
    });

    it("présente les deux propositions pour les comparer", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE, COURT]);
      rendre();

      await chercher();

      expect(await screen.findByRole("heading", { name: /2 itinéraires proposés/i })).toBeDefined();
      expect(screen.getByText("Le plus rapide")).toBeDefined();
      expect(screen.getByText("Le plus écologique")).toBeDefined();
    });

    it("accorde le titre au singulier pour une seule proposition", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
      rendre();

      await chercher();

      // Le backend déduplique quand deux critères désignent le même trajet.
      expect(await screen.findByRole("heading", { name: /1 itinéraire proposé/i })).toBeDefined();
    });

    it("ordonne les étapes dans une liste ordonnée", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
      rendre();

      await chercher();

      await screen.findByText("Le plus rapide");
      // <ol> et non <ul> : l'ordre des étapes est celui du trajet.
      expect(document.querySelector("ol")).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Géolocalisation (bloc 5D-1)
  // ---------------------------------------------------------------------------
  describe("géolocalisation", () => {
    /// jsdom n'implémente pas `navigator.geolocation` : on l'installe.
    const installerPosition = (
      implementation: (succes: PositionCallback, echec: PositionErrorCallback) => void,
    ) => {
      const getCurrentPosition = vi.fn(implementation);
      Object.defineProperty(navigator, "geolocation", {
        value: { getCurrentPosition },
        configurable: true,
      });
      return getCurrentPosition;
    };

    const POSITION_PARIS = {
      coords: { latitude: 48.8712, longitude: 2.3501 },
    } as GeolocationPosition;

    /// Demande la position via le BOUTON dédié (Phase 3A).
    ///
    /// C'était auparavant une option de la liste d'arrêts. La saisie libre
    /// étant devenue l'entrée principale, la position est un bouton d'action
    /// à côté du champ — mais le mécanisme sous-jacent est INCHANGÉ :
    /// `getCurrentPosition`, sur geste explicite, jamais au chargement.
    const choisirMaPosition = async () => {
      const utilisateur = userEvent.setup();
      await utilisateur.click(await screen.findByRole("button", { name: "Ma position" }));
      return utilisateur;
    };

    afterEach(() => {
      Object.defineProperty(navigator, "geolocation", {
        value: undefined,
        configurable: true,
      });
    });

    it("ne demande RIEN au chargement de la page", async () => {
      const appel = installerPosition((succes) => succes(POSITION_PARIS));

      rendre();
      await (await ouvrirArrets(), screen.getByLabelText("Arrêt de départ"));

      // Une invite de permission qui surgit sans geste de l'usager est une
      // invite qu'on refuse par réflexe.
      expect(appel).not.toHaveBeenCalled();
    });

    it("demande la position quand l'usager la choisit", async () => {
      const appel = installerPosition((succes) => succes(POSITION_PARIS));
      rendre();

      await choisirMaPosition();

      await waitFor(() => expect(appel).toHaveBeenCalledTimes(1));
      expect(await screen.findByText(/position trouvée/i)).toBeDefined();
    });

    it("annonce la localisation en cours", async () => {
      // Ne répond jamais : la demande reste en attente.
      installerPosition(() => {});
      rendre();

      await choisirMaPosition();

      expect(await screen.findByText(/localisation en cours/i)).toBeDefined();
    });

    it("EMPÊCHE de chercher tant que la position n'est pas arrivée", async () => {
      installerPosition(() => {});
      rendre();
      const utilisateur = await choisirMaPosition();

      await utilisateur.selectOptions(
        screen.getByLabelText("Arrêt d'arrivée"),
        screen.getAllByRole("option", { name: /Bastille/ })[1],
      );

      // Partir maintenant enverrait des coordonnées absentes, et le backend
      // répondrait 400.
      await screen.findByText(/localisation en cours/i);
      expect(screen.getByRole("button", { name: /rechercher/i }).hasAttribute("disabled")).toBe(
        true,
      );
    });

    it("transmet les COORDONNÉES de la position au backend", async () => {
      installerPosition((succes) => succes(POSITION_PARIS));
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
      rendre();
      const utilisateur = await choisirMaPosition();
      await screen.findByText(/position trouvée/i);

      await utilisateur.selectOptions(
        screen.getByLabelText("Arrêt d'arrivée"),
        screen.getAllByRole("option", { name: /Bastille/ })[1],
      );
      await utilisateur.click(screen.getByRole("button", { name: /rechercher/i }));

      // Le contrat de POST /api/routes/search attend des coordonnées brutes
      // et cherche lui-même l'arrêt le plus proche : la position GPS s'y
      // branche telle quelle, sans aucun ajout backend.
      await waitFor(() =>
        expect(rechercherItineraires).toHaveBeenCalledWith(
          expect.objectContaining({ fromLat: 48.8712, fromLon: 2.3501 }),
        ),
      );
    });

    describe("échecs", () => {
      const refuser = (code: number) =>
        installerPosition((_succes, echec) => echec({ code } as GeolocationPositionError));

      it("explique un refus de permission ET dit quoi faire", async () => {
        refuser(1);
        rendre();

        await choisirMaPosition();

        expect(await screen.findByText(/réglages de votre navigateur/i)).toBeDefined();
      });

      it("distingue un délai dépassé d'un refus", async () => {
        refuser(3);
        rendre();

        await choisirMaPosition();

        expect(await screen.findByText(/pris trop de temps/i)).toBeDefined();
      });

      it("laisse RÉESSAYER après un échec", async () => {
        const appel = installerPosition((_succes, echec) =>
          echec({ code: 3 } as GeolocationPositionError),
        );
        rendre();
        const utilisateur = await choisirMaPosition();
        await screen.findByText(/pris trop de temps/i);

        // Refuser une fois par mégarde ne doit pas condamner la
        // fonctionnalité pour la session.
        appel.mockImplementation((succes) => succes(POSITION_PARIS));
        await utilisateur.click(screen.getByRole("button", { name: /réessayer/i }));

        expect(await screen.findByText(/position trouvée/i)).toBeDefined();
      });

      it("empêche de chercher après un échec", async () => {
        refuser(1);
        rendre();
        const utilisateur = await choisirMaPosition();
        await screen.findByText(/réglages de votre navigateur/i);

        await utilisateur.selectOptions(
          screen.getByLabelText("Arrêt d'arrivée"),
          screen.getAllByRole("option", { name: /Bastille/ })[1],
        );

        expect(screen.getByRole("button", { name: /rechercher/i }).hasAttribute("disabled")).toBe(
          true,
        );
        expect(rechercherItineraires).not.toHaveBeenCalled();
      });

      it("reste utilisable SANS géolocalisation du tout", async () => {
        // L'API absente : origine non sécurisée, ou navigateur qui ne la
        // gère pas. Le formulaire doit continuer de fonctionner.
        Object.defineProperty(navigator, "geolocation", {
          value: undefined,
          configurable: true,
        });
        vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
        rendre();

        await chercher();

        // La recherche par arrêts fonctionne exactement comme avant.
        await waitFor(() => expect(rechercherItineraires).toHaveBeenCalled());
        expect(await screen.findByText("Le plus rapide")).toBeDefined();
      });
    });

    it("OUBLIE la position quand on revient à un arrêt", async () => {
      installerPosition((succes) => succes(POSITION_PARIS));
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
      rendre();
      const utilisateur = await choisirMaPosition();
      await screen.findByText(/position trouvée/i);

      await utilisateur.selectOptions(
        screen.getByLabelText("Arrêt de départ"),
        screen.getAllByRole("option", { name: /Gare du Nord/ })[0],
      );

      // Garder une donnée de géolocalisation dont plus rien n'a besoin
      // contreviendrait à la minimisation (C8).
      expect(screen.queryByText(/position trouvée/i)).toBeNull();

      await utilisateur.selectOptions(
        screen.getByLabelText("Arrêt d'arrivée"),
        screen.getAllByRole("option", { name: /Bastille/ })[1],
      );
      await utilisateur.click(screen.getByRole("button", { name: /rechercher/i }));

      // Et c'est bien l'ARRÊT qui part, pas la position mémorisée.
      await waitFor(() =>
        expect(rechercherItineraires).toHaveBeenCalledWith(
          expect.objectContaining({ fromLat: 48.88, fromLon: 2.355 }),
        ),
      );
    });

    it("annonce son état aux lecteurs d'écran", async () => {
      installerPosition((succes) => succes(POSITION_PARIS));
      rendre();

      await choisirMaPosition();

      // Le résultat arrive de façon asynchrone : sans zone d'état, rien
      // n'expliquerait pourquoi « Rechercher » reste désactivé.
      //
      // ⚠️ `getAllByRole` depuis la Phase 3A : chaque champ d'adresse porte
      // désormais sa PROPRE zone d'état — « 3 propositions », « Recherche en
      // cours… ». Ce sont des messages distincts, attachés à des contrôles
      // distincts, et non des annonces concurrentes.
      await waitFor(() =>
        expect(
          screen
            .getAllByRole("status")
            .map((zone) => zone.textContent)
            .join(" "),
        ).toMatch(/position trouvée/i),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Carte interactive (bloc 5B)
  // ---------------------------------------------------------------------------
  describe("carte", () => {
    /// Le remplaçant de Leaflet expose ses propriétés : c'est ainsi qu'on lit
    /// ce que la page lui a réellement transmis.
    const carte = () => screen.getByTestId("carte-leaflet");
    const traceAffiche = () => carte().getAttribute("data-trace");

    it("est présente dès le chargement, avant toute recherche", async () => {
      rendre();

      expect(
        await screen.findByRole("heading", { name: /les arrêts autour de vous/i }),
      ).toBeDefined();

      // ⚠️ LA CARTE MONTRE QUELQUE CHOSE AVANT TOUTE RECHERCHE : les arrêts
      // du voisinage, cliquables. C'est ce qui manquait — l'écran s'ouvrait
      // sur un cadre vide.
      expect(await screen.findByTestId("carte-leaflet")).toBeDefined();
      expect(screen.getByText(/cliquez sur l'un d'eux/i)).toBeDefined();
    });

    it("ne dessine QUE les arrêts du trajet, jamais le réseau entier", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
      rendre();

      await chercher();

      // ⚠️ TROIS arrêts — ceux des deux segments — et non les 1 934 du
      // réseau. La carte n'a plus besoin d'aucun référentiel : chaque segment
      // porte les coordonnées de ses deux extrémités.
      await waitFor(() => expect(carte().getAttribute("data-arrets")).toBe("3"));
    });

    it("ne trace RIEN tant qu'aucune recherche n'a eu lieu", async () => {
      rendre();

      // Les arrêts sont dessinés, mais aucun TRAJET ne l'est : il n'y en a
      // pas encore.
      await screen.findByTestId("carte-leaflet");
      expect(traceAffiche()).toBe("aucun");
    });

    it("charge les arrêts AUTOUR du centre, jamais tout le réseau", async () => {
      rendre();

      await waitFor(() => expect(listerArrets).toHaveBeenCalled());

      // ⚠️ `GET /api/stops` est borné : la carte demande un VOISINAGE. Sans
      // `lat`/`lon`, elle retomberait sur un début d'alphabet sans rapport
      // avec ce qu'elle montre.
      expect(listerArrets).toHaveBeenCalledWith(
        expect.objectContaining({
          lat: expect.any(Number),
          lon: expect.any(Number),
          radiusM: expect.any(Number),
        }),
      );
    });

    it("recharge les arrêts quand la carte est déplacée", async () => {
      rendre();
      await screen.findByTestId("carte-leaflet");
      await waitFor(() => expect(listerArrets).toHaveBeenCalledTimes(1));

      // Le composant Leaflet simulé expose le rappel de déplacement.
      deplacerLaCarte(45.75, 4.85);

      await waitFor(() =>
        expect(listerArrets).toHaveBeenCalledWith(
          expect.objectContaining({ lat: 45.75, lon: 4.85 }),
        ),
      );
    });

    it("fait d'un arrêt cliqué la DESTINATION", async () => {
      rendre();
      await screen.findByTestId("carte-leaflet");

      cliquerArret(0, "arrivee");

      // Le champ du formulaire porte le nom de l'arrêt : la carte n'impose
      // jamais un point que le formulaire ne montrerait pas.
      await waitFor(() =>
        expect(screen.getByLabelText("Arrivée")).toHaveProperty("value", ARRETS[0].name),
      );
    });

    it("fait d'un arrêt cliqué le DÉPART quand on le demande", async () => {
      rendre();
      await screen.findByTestId("carte-leaflet");

      cliquerArret(1, "depart");

      await waitFor(() =>
        expect(screen.getByLabelText("Départ")).toHaveProperty("value", ARRETS[1].name),
      );
    });

    it("trace l'itinéraire retenu après une recherche", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
      rendre();

      await chercher();

      // Trois points pour deux étapes, dans l'ordre du trajet.
      await waitFor(() => expect(traceAffiche()).toBe("Gare du Nord > Châtelet > Bastille"));
    });

    it("met en avant le PREMIER résultat sans attendre un clic", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE, COURT]);
      rendre();

      await chercher();

      await waitFor(() =>
        expect(screen.getByRole("heading", { name: /trajet retenu sur la carte/i })).toBeDefined(),
      );
      const boutons = screen.getAllByRole("button", { name: /sur la carte/i });
      expect(boutons[0].getAttribute("aria-pressed")).toBe("true");
      expect(boutons[1].getAttribute("aria-pressed")).toBe("false");
    });

    it("change de tracé quand on sélectionne l'autre itinéraire", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE, COURT]);
      rendre();
      const utilisateur = await chercher();
      await waitFor(() => expect(traceAffiche()).toBe("Gare du Nord > Châtelet > Bastille"));

      await utilisateur.click(screen.getAllByRole("button", { name: /afficher sur la carte/i })[0]);

      // Le second itinéraire ne passe pas par les mêmes arrêts : le tracé
      // change réellement, il n'est pas simplement redessiné.
      await waitFor(() => expect(traceAffiche()).not.toBe("Gare du Nord > Châtelet > Bastille"));
      const boutons = screen.getAllByRole("button", { name: /sur la carte/i });
      expect(boutons[1].getAttribute("aria-pressed")).toBe("true");
    });

    it("repart d'une sélection neuve à chaque nouvelle recherche", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE, COURT]);
      rendre();
      const utilisateur = await chercher();
      await utilisateur.click(screen.getAllByRole("button", { name: /afficher sur la carte/i })[0]);
      await waitFor(() =>
        expect(
          screen.getAllByRole("button", { name: /sur la carte/i })[1].getAttribute("aria-pressed"),
        ).toBe("true"),
      );

      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
      await chercher();

      // Garder « SHORTEST » mettrait en avant un critère absent de la
      // nouvelle réponse.
      await waitFor(() => expect(traceAffiche()).toBe("Gare du Nord > Châtelet > Bastille"));
    });

    it("dessine la VOIE RÉELLE quand l'opérateur la publie", async () => {
      // Les deux segments de RAPIDE : le métro a une géométrie, la marche non.
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
      rendre();

      await chercher();

      // Le premier tronçon suit les trois points du `LineString`, converti de
      // [lon, lat] (GeoJSON) vers [lat, lon] (Leaflet).
      await waitFor(() =>
        expect(carte().getAttribute("data-troncons")).toBe("SHAPE:3|STRAIGHT:2"),
      );
    });

    it("distingue une portion approchée d'un tracé réel, et le DIT", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
      rendre();

      await chercher();

      // Un segment sur deux est approché : la description doit l'annoncer
      // sans pour autant nier le tracé réel de l'autre.
      const description = await screen.findByText(/1 portion dessinée/i);
      expect(description.textContent).toContain("pointillés");
      expect(description.textContent).toContain("n'y est pas le chemin réel");
    });

    it("annonce un tracé ENTIÈREMENT approché quand aucune géométrie n'existe", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([PROPRE]);
      rendre();

      await chercher();

      expect(
        await screen.findByText(/aucun tracé de voie n'est publié pour ce trajet/i),
      ).toBeDefined();
    });

    it("garde les étapes lisibles EN TEXTE, carte ou pas", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
      rendre();

      await chercher();

      // L'information essentielle ne dépend jamais de la carte : chaque étape
      // reste écrite, avec son mode et sa ligne.
      const liste = within(screen.getByRole("region", { name: /itinéraire/i }));
      // Une expression régulière : le texte du groupe porte aussi son
      // nombre d'arrêts, il n'est donc plus une correspondance exacte.
      expect(await liste.findByText(/Gare du Nord → Châtelet/)).toBeDefined();
      // `getAllBy` : « Métro 4 » apparaît DEUX fois, dans le résumé du trajet
      // et comme titre d'étape. Les deux sont légitimes.
      expect(liste.getAllByText(/Métro 4/).length).toBeGreaterThan(0);
      expect(liste.getByText("Châtelet → Bastille")).toBeDefined();
    });

    it("reste sans effet sur l'enregistrement du trajet", async () => {
      // La sélection sert la CARTE, pas l'enregistrement : celui-ci reçoit
      // toujours l'itinéraire de sa propre fiche (étape 5A-7).
      authentifier();
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE, COURT]);
      vi.mocked(enregistrerItineraire).mockResolvedValue({
        id: "route-1",
        originLat: 48.88,
        originLng: 2.355,
        destinationLat: 48.853,
        destinationLng: 2.369,
        requestedAt: "2026-08-25T09:30:00.000Z",
        totalDurationMin: 31,
        totalDistanceM: 3900,
        ecoScore: 90,
        carbonEstimate: 12,
        userId: PROFIL.id,
        segments: [],
      });
      rendre();
      const utilisateur = await chercher();

      // On met le SECOND itineraire sur la carte, puis on enregistre le
      // PREMIER : les deux gestes ne doivent pas se confondre.
      await utilisateur.click(screen.getAllByRole("button", { name: /afficher sur la carte/i })[0]);
      await utilisateur.click(
        await screen.findByRole("button", { name: /enregistrer le trajet le plus rapide/i }),
      );

      await waitFor(() => expect(enregistrerItineraire).toHaveBeenCalled());
      const [envoye] = vi.mocked(enregistrerItineraire).mock.calls[0];
      // Les segments envoyés sont ceux de l'itinéraire RAPIDE, dont la fiche
      // portait le bouton — pas ceux de l'itinéraire affiché sur la carte.
      expect(envoye.segments.map((segment) => segment.lineId)).toEqual(
        RAPIDE.segments.map((segment) => segment.lineId),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Empreinte carbone (Phase 4 : portée par l'itinéraire lui-même)
  // ---------------------------------------------------------------------------
  describe("empreinte carbone", () => {
    it("n'appelle JAMAIS le calcul carbone depuis cet écran", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
      rendre();

      await chercher();
      await screen.findByText("316 g");

      // ⚠️ L'ASSERTION CENTRALE DE CE BLOC. L'écran faisait un
      // `POST /api/carbone` par itinéraire APRÈS la recherche. Le backend
      // rend désormais l'empreinte AVEC chaque itinéraire : un aller-retour
      // de moins, et surtout plus aucun risque d'attribuer une estimation au
      // mauvais trajet.
      expect(estimerCarbone).not.toHaveBeenCalled();
    });

    it("affiche les chiffres rendus par le backend", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
      rendre();

      await chercher();

      // 316 g émis, 621 g économisés, éco-score arrondi à l'entier.
      expect(await screen.findByText("316 g")).toBeDefined();
      expect(screen.getByText("621 g")).toBeDefined();
      expect(screen.getByText("66/100")).toBeDefined();
    });

    it("garde l'itinéraire visible quand l'empreinte est indisponible", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([
        { ...RAPIDE, carbon: CARBONE_ABSENT },
      ]);
      rendre();

      await chercher();

      // LA RÈGLE, INCHANGÉE DEPUIS L'ÉTAPE 4D-2 : une panne du calcul carbone
      // ne fait pas disparaître un itinéraire valide.
      expect(await screen.findByText("Le plus rapide")).toBeDefined();
      expect(screen.getByText(/empreinte carbone indisponible/i)).toBeDefined();
    });

    it("affiche le motif rendu par le backend, sans le réécrire", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([
        {
          ...RAPIDE,
          carbon: {
            ...CARBONE_ABSENT,
            reason: "Aucun facteur d'émission pour le mode ESCOOTER.",
          },
        },
      ]);
      rendre();

      await chercher();

      const texte = await screen.findByText(/empreinte carbone indisponible/i);
      expect(texte.parentElement?.textContent).toContain("ESCOOTER");
    });

    it("n'affiche JAMAIS 0 g à la place d'une erreur", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([
        { ...RAPIDE, carbon: CARBONE_ABSENT },
      ]);
      rendre();

      await chercher();

      await screen.findByText(/empreinte carbone indisponible/i);
      // Zéro est une valeur LÉGITIME — un trajet entièrement à pied émet
      // réellement zéro. L'employer comme repli rendrait les deux cas
      // indiscernables.
      expect(screen.queryByText("0 g")).toBeNull();
    });

    it("n'attribue JAMAIS l'empreinte d'un itinéraire à un autre", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE, PROPRE]);
      rendre();

      await chercher();
      await screen.findByText("316 g");

      // Chaque carte est inspectée SÉPARÉMENT : les chiffres du plus rapide
      // ne doivent pas apparaître sous le plus écologique.
      const cartes = screen.getAllByRole("listitem");
      const carteRapide = cartes.find((c) => c.textContent?.includes("Le plus rapide"))!;
      const cartePropre = cartes.find((c) => c.textContent?.includes("Le plus écologique"))!;

      expect(within(carteRapide).getByText("316 g")).toBeDefined();
      expect(within(carteRapide).queryByText("200 g")).toBeNull();
      expect(within(cartePropre).getByText("200 g")).toBeDefined();
      expect(within(cartePropre).queryByText("316 g")).toBeNull();
    });

    it("laisse l'empreinte disponible visible quand l'AUTRE manque", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([
        RAPIDE,
        { ...PROPRE, carbon: CARBONE_ABSENT },
      ]);
      rendre();

      await chercher();

      // Les deux sorts sont indépendants : l'un manquant n'emporte pas
      // l'autre.
      expect(await screen.findByText("316 g")).toBeDefined();
      expect(screen.getByText(/empreinte carbone indisponible/i)).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Couche Vélib' (Phase 5)
  // ---------------------------------------------------------------------------
  describe("vélos en libre-service", () => {
    const STATION = {
      stationId: "213688169",
      stationCode: "16107",
      name: "Lobau - Hôtel de Ville",
      latitude: 48.8566,
      longitude: 2.3522,
      capacity: 55,
      mechanical: 35,
      electric: 0,
      bikesAvailable: 35,
      docksAvailable: 24,
      isRenting: true,
      isReturning: true,
      isInstalled: true,
      lastReported: "2026-09-02T21:50:00.000Z",
      freshness: "REALTIME" as const,
      distanceM: 88,
    };

    const reponse = (stations: (typeof STATION)[]) => ({
      stations,
      total: stations.length,
      fetchedAt: "2026-09-02T21:54:28.893Z",
      attribution: "Source : Vélib’ Métropole (Smovengo) — Licence Ouverte",
    });

    const activer = async () => {
      const utilisateur = userEvent.setup();
      await utilisateur.click(
        await screen.findByRole("button", { name: /vélos en libre-service/i }),
      );
      return utilisateur;
    };

    it("ne charge RIEN tant que la couche est masquée", async () => {
      rendre();

      await screen.findByTestId("carte-leaflet");

      // ⚠️ Charger 1 519 stations pour quelqu'un qui cherche un trajet en
      // métro serait un appel inutile et une carte illisible.
      expect(velibProches).not.toHaveBeenCalled();
      expect(screen.getByTestId("carte-leaflet").getAttribute("data-velib")).toBe("aucun");
    });

    it("charge les stations AUTOUR du centre quand on active la couche", async () => {
      vi.mocked(velibProches).mockResolvedValue(reponse([STATION]));
      rendre();
      await screen.findByTestId("carte-leaflet");

      await activer();

      await waitFor(() =>
        expect(velibProches).toHaveBeenCalledWith(
          expect.any(Number),
          expect.any(Number),
          expect.objectContaining({ radiusM: expect.any(Number) }),
          expect.anything(),
        ),
      );
    });

    it("dessine les stations et annonce l'heure du relevé", async () => {
      vi.mocked(velibProches).mockResolvedValue(reponse([STATION]));
      rendre();
      await screen.findByTestId("carte-leaflet");

      await activer();

      await waitFor(() =>
        expect(screen.getByTestId("carte-leaflet").getAttribute("data-velib")).toBe("1"),
      );
      // ⚠️ La fraîcheur est TOUJOURS dite : sans elle, une donnée d'il y a une
      // heure serait indiscernable d'une donnée de l'instant.
      expect(screen.getByText(/relevé lu à/i)).toBeDefined();
    });

    it("affiche l'attribution imposée par la licence", async () => {
      vi.mocked(velibProches).mockResolvedValue(reponse([STATION]));
      rendre();
      await screen.findByTestId("carte-leaflet");

      await activer();

      // ⚠️ L'attribution vient du FLUX (`system_information.json`), pas du
      // code : on vérifie qu'elle est affichée, sans présumer du nom de
      // l'exploitant — il change avec le territoire.
      expect(await screen.findByText(reponse([STATION]).attribution)).toBeDefined();
    });

    it("dit franchement qu'il n'y a aucune station ici", async () => {
      vi.mocked(velibProches).mockResolvedValue(reponse([]));
      rendre();
      await screen.findByTestId("carte-leaflet");

      await activer();

      expect(await screen.findByText(/aucune station de vélos/i)).toBeDefined();
    });

    it("annonce une panne du fournisseur SANS inventer de station", async () => {
      vi.mocked(velibProches).mockRejectedValue(
        new ApiError(503, "Les données Vélib’ sont momentanément indisponibles."),
      );
      rendre();
      await screen.findByTestId("carte-leaflet");

      await activer();

      expect(await screen.findByText(/données des vélos en libre-service indisponibles/i)).toBeDefined();
      // La couche reste VIDE : aucune station fictive.
      expect(screen.getByTestId("carte-leaflet").getAttribute("data-velib")).toBe("aucun");
    });

    it("masque la couche et cesse de charger quand on la désactive", async () => {
      vi.mocked(velibProches).mockResolvedValue(reponse([STATION]));
      rendre();
      await screen.findByTestId("carte-leaflet");

      const utilisateur = await activer();
      await waitFor(() =>
        expect(screen.getByTestId("carte-leaflet").getAttribute("data-velib")).toBe("1"),
      );

      await utilisateur.click(screen.getByRole("button", { name: /vélos en libre-service/i }));

      await waitFor(() =>
        expect(screen.getByTestId("carte-leaflet").getAttribute("data-velib")).toBe("aucun"),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Honnêteté sur la durée annoncée
  // ---------------------------------------------------------------------------
  describe("horaires et temps d'attente", () => {
    // ⚠️ CE BLOC A ÉTÉ RÉÉCRIT AU SPRINT SOUTENANCE, et le changement mérite
    // d'être expliqué.
    //
    // Il vérifiait auparavant qu'une PHRASE D'EXCUSE apparaissait dès qu'il y
    // avait une correspondance : « durée hors temps d'attente ». Elle était
    // honnête et impuissante — elle nommait un manque sans le combler.
    //
    // Depuis l'import du calendrier GTFS, l'attente est CONNUE. Ce qu'on
    // vérifie n'est donc plus qu'on avertit d'un manque, mais qu'on affiche
    // la bonne heure — et qu'on retombe sur la bonne phrase dans chacun des
    // deux cas où l'horaire reste inconnu.

    it("affiche l’HEURE D’ARRIVÉE, attente comprise", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([
        {
          ...RAPIDE,
          schedule: {
            status: "SCHEDULE_AVAILABLE",
            departureAt: "2026-09-03T06:00:00.000Z",
            arrivalAt: "2026-09-03T06:25:00.000Z",
            totalWaitMin: 7,
            reason: null,
          },
        },
      ]);
      rendre();

      await chercher();

      // L'attente est DITE, et non fondue dans le total : un usager doit
      // pouvoir savoir combien de temps il passera sur le quai.
      expect(
        await screen.findByText(/dont 7 min d’attente/i),
      ).toBeDefined();
    });

    it("distingue « ces lignes ne passent pas » de « pas d’horaires »", async () => {
      // ⚠️ LES DEUX PHRASES APPELLENT DEUX DÉCISIONS OPPOSÉES. « Aucun passage
      // dans les prochaines heures » veut dire « ne partez pas maintenant » ;
      // « les horaires ne sont pas importés » veut dire « nous n'en savons
      // rien, le tram passe peut-être ». Les confondre est un mensonge par
      // imprécision.
      vi.mocked(rechercherItineraires).mockResolvedValue([
        {
          ...RAPIDE,
          schedule: {
            status: "SCHEDULE_UNKNOWN",
            departureAt: null,
            arrivalAt: null,
            totalWaitMin: null,
            reason: "Aucun passage prévu.",
          },
        },
      ]);
      rendre();

      await chercher();

      expect(
        await screen.findByText(/aucun horaire n’est connu pour ces lignes/i),
      ).toBeDefined();
      expect(
        screen.queryByText(/ne sont pas importés pour ce réseau/i),
      ).toBeNull();
    });

    it("le dit quand le réseau n’a AUCUN horaire importé", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([
        {
          ...RAPIDE,
          schedule: {
            status: "SCHEDULE_UNAVAILABLE",
            departureAt: null,
            arrivalAt: null,
            totalWaitMin: null,
            reason: "Aucun horaire importé.",
          },
        },
      ]);
      rendre();

      await chercher();

      expect(
        await screen.findByText(/ne sont pas importés pour ce réseau/i),
      ).toBeDefined();
    });

    it("N’AFFICHE AUCUNE HEURE quand le backend n’en fournit pas", async () => {
      // Un itinéraire relu depuis l'historique n'a pas de champ `schedule` :
      // il décrit un trajet passé, dont l'attente n'a plus de sens. Le bloc
      // doit alors se taire, et surtout ne pas inventer « arrivée à ».
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
      rendre();

      await chercher();
      await screen.findByText("Le plus rapide");

      expect(screen.queryByText(/arrivée prévue/i)).toBeNull();
      expect(screen.queryByText(/horaire/i)).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Filtres de modes (Phase 7)
  // ---------------------------------------------------------------------------
  describe("filtres de modes", () => {
    it("n'affiche AUCUN filtre avant une recherche", async () => {
      rendre();

      await screen.findByRole("heading", { name: /rechercher un itinéraire/i });

      // Des boutons de filtre sans rien à filtrer seraient du bruit.
      expect(screen.queryByRole("heading", { name: /modes de transport/i })).toBeNull();
    });

    it("propose les modes RÉELLEMENT présents dans le réseau", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
      rendre();

      await chercher();

      // Le réseau simulé porte tram, bus et marche.
      expect(await screen.findByRole("button", { name: "Tram" })).toBeDefined();
      expect(screen.getByRole("button", { name: "Bus" })).toBeDefined();
    });

    it("N’OFFRE AUCUN BOUTON pour un mode absent du réseau", async () => {
      // ⚠️ CE TEST A ÉTÉ INVERSÉ AU SPRINT SOUTENANCE. Il vérifiait
      // auparavant qu'un bouton GRISÉ portait son motif. À l'usage, sur
      // l'Eurométropole, cela donnait quatre boutons gris sur six — l'usager
      // y lisait une application à moitié cassée.
      //
      // Les modes absents sont donc passés dans un repli explicatif, avec
      // leur motif. Ce que ce test protège, c'est qu'ils ne sont ni proposés
      // comme filtres, ni effacés en silence.
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
      rendre();

      await chercher();
      await screen.findByRole("button", { name: /bus/i });

      expect(
        screen.queryByRole("button", { name: /^🚇 Métro$/ }),
      ).toBeNull();
    });

    it("DIT POURQUOI un mode absent l’est, sans le masquer", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
      rendre();

      await chercher();

      // Le repli est fermé, mais son contenu est dans le DOM : c'est ce qui
      // permet à un lecteur d'écran de le parcourir, et à cette assertion de
      // le trouver.
      // `findAllByText` : le réseau simulé n'a ni métro ni train, et chacun
      // porte le même motif. Un `findByText` échouerait sur l'ambiguïté — et
      // pour la bonne raison, ce qui est la pire façon d'échouer.
      expect(
        (await screen.findAllByText(/n’existe pas sur le réseau de ce territoire/i))
          .length,
      ).toBeGreaterThan(0);
    });

    it("EXPLIQUE que le vélo attend un routeur, pas une ligne", async () => {
      // ⚠️ DEUX MANQUES DIFFÉRENTS, DEUX PHRASES DIFFÉRENTES. Le métro
      // n'existe pas sur ce territoire ; le vélo existerait si un routeur
      // cyclable était configuré. Le même gris les confondait.
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
      rendre();

      await chercher();

      expect(
        await screen.findByText(/routage détaillé n’est pas configuré/i),
      ).toBeDefined();
    });

    it("MASQUE les itinéraires qui empruntent un mode écarté", async () => {
      // RAPIDE emprunte le métro ; PROPRE le bus.
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE, PROPRE]);
      vi.mocked(modesDuReseau).mockResolvedValue({
        modes: [
          { mode: "METRO", lineCount: 4 },
          { mode: "BUS", lineCount: 41 },
          { mode: "WALK", lineCount: 1 },
        ],
      });
      rendre();

      const utilisateur = await chercher();
      await screen.findByText("Le plus rapide");

      await utilisateur.click(screen.getByRole("button", { name: "Bus" }));

      await waitFor(() =>
        expect(screen.queryByText("Le plus écologique")).toBeNull(),
      );
      // L'autre reste : le filtre masque, il ne vide pas.
      expect(screen.getByText("Le plus rapide")).toBeDefined();
    });

    it("N’OFFRE PAS D’ÉCARTER LA MARCHE — elle est inécartable", async () => {
      // ⚠️ La marche relie l'origine à l'arrêt et l'arrêt à la destination :
      // tout itinéraire en comporte, et l'exclure viderait la liste quoi
      // qu'on choisisse.
      //
      // La version précédente affichait un bouton « Marche » GRISÉ, ce qui
      // laissait croire à une panne. Elle figure désormais dans le repli
      // explicatif, avec sa vraie raison — qui n'est pas une indisponibilité.
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
      rendre();

      await chercher();
      await screen.findByText("Le plus rapide");

      expect(screen.queryByRole("button", { name: /^🚶 Marche$/ })).toBeNull();
      expect(
        screen.getByText(/fait partie de tout itinéraire/i),
      ).toBeDefined();
    });

    it("distingue « rien trouvé » de « tout masqué »", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([PROPRE]);
      vi.mocked(modesDuReseau).mockResolvedValue({
        modes: [
          { mode: "BUS", lineCount: 41 },
          { mode: "WALK", lineCount: 1 },
        ],
      });
      rendre();

      const utilisateur = await chercher();
      await screen.findByText("Le plus écologique");

      await utilisateur.click(screen.getByRole("button", { name: "Bus" }));

      // ⚠️ DEUX VIDES, DEUX GESTES OPPOSÉS : reformuler la recherche, ou
      // réactiver un mode. Les confondre ferait chercher un trajet qui
      // existe déjà.
      expect(await screen.findByText(/réactivez-en un/i)).toBeDefined();
    });

    it("dit ce que le filtre fait RÉELLEMENT", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
      rendre();

      await chercher();

      // Sans cette phrase, décocher « Bus » laisserait attendre de meilleures
      // propositions sans bus, qui ne viendront pas.
      expect(await screen.findByText(/ne relancent pas la recherche/i)).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Passage au détail du trajet
  // ---------------------------------------------------------------------------
  describe("voir le trajet", () => {
    beforeEach(() => {
      window.sessionStorage.clear();
      pousser.mockClear();
    });

    it("mémorise l'itinéraire choisi et ouvre /itineraire", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE, PROPRE]);
      rendre();
      const utilisateur = await chercher();

      await utilisateur.click(
        await screen.findByRole("button", {
          name: /voir le trajet — le plus écologique/i,
        }),
      );

      expect(pousser).toHaveBeenCalledWith("/itineraire");

      // ⚠️ C'EST BIEN L'ITINÉRAIRE CLIQUÉ qui est mémorisé, pas celui affiché
      // sur la carte : chaque carte porte son propre bouton.
      const memorise = JSON.parse(
        window.sessionStorage.getItem("urbanflow.itineraire")!,
      ) as { itineraire: { criterion: string } };

      expect(memorise.itineraire.criterion).toBe("LOWEST_CO2");
    });

    it("mémorise les LIBELLÉS saisis, pas les noms d'arrêts", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
      rendre();
      const utilisateur = await chercher();

      await utilisateur.click(
        await screen.findByRole("button", { name: /voir le trajet — le plus rapide/i }),
      );

      const memorise = JSON.parse(
        window.sessionStorage.getItem("urbanflow.itineraire")!,
      ) as { origine: { latitude: number }; destination: { latitude: number } };

      // Les coordonnées sont celles RÉELLEMENT envoyées à la recherche.
      expect(memorise.origine.latitude).toBe(48.88);
      expect(memorise.destination.latitude).toBe(48.853);
    });

    it("un bouton par itinéraire, nommé sans ambiguïté", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE, PROPRE]);
      rendre();

      await chercher();

      // Trois boutons « Voir le trajet » identiques seraient indistinguables
      // au lecteur d'écran : chacun porte le nom de SON critère.
      expect(
        await screen.findByRole("button", { name: /voir le trajet — le plus rapide/i }),
      ).toBeDefined();
      expect(
        screen.getByRole("button", { name: /voir le trajet — le plus écologique/i }),
      ).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Comparaison écologique — l'identité du produit
  // ---------------------------------------------------------------------------
  describe("comparaison écologique", () => {
    it("chiffre le compromis par rapport au plus rapide", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE, PROPRE]);
      rendre();

      await chercher();

      // 31 − 24 = 7 minutes de plus ; 316 − 200 = 116 g de moins. C'est LA
      // phrase qui permet de choisir.
      // La phrase est composée de plusieurs fragments : on lit le paragraphe
      // entier, qui est ce que l'usager voit.
      const compromis = (await screen.findByText(/par rapport au plus rapide/i)).closest("p")!;
      expect(compromis.textContent).toContain("7 min de plus");
      expect(compromis.textContent).toContain("116 g");
      expect(compromis.textContent).toContain("en moins");
    });

    it("ne compare PAS l'itinéraire de référence à lui-même", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE, PROPRE]);
      rendre();

      await chercher();
      await screen.findByText(/par rapport au plus rapide/i);

      const cartes = screen.getAllByRole("listitem");
      const carteRapide = cartes.find((c) => c.textContent?.includes("Le plus rapide"))!;

      expect(within(carteRapide).queryByText(/par rapport au plus rapide/i)).toBeNull();
    });

    it("ne chiffre AUCUN écart quand une empreinte manque", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([
        RAPIDE,
        { ...PROPRE, carbon: CARBONE_ABSENT },
      ]);
      rendre();

      await chercher();

      // L'écart de temps reste calculable et affiché ; l'écart de CO₂, non —
      // le calculer sur une valeur manquante serait un chiffre inventé.
      const compromis = (await screen.findByText(/par rapport au plus rapide/i)).closest("p")!;
      expect(compromis.textContent).toContain("7 min de plus");
      expect(compromis.textContent).not.toContain("de CO₂");
    });

    it("marque le trajet écologique d'un badge, et lui seul", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE, PROPRE]);
      rendre();

      await chercher();

      const badge = await screen.findByText(/meilleur pour le climat/i);
      const cartes = screen.getAllByRole("listitem");
      const cartePropre = cartes.find((c) => c.textContent?.includes("Le plus écologique"))!;
      const carteRapide = cartes.find((c) => c.textContent?.includes("Le plus rapide"))!;

      expect(cartePropre.contains(badge)).toBe(true);
      expect(within(carteRapide).queryByText(/meilleur pour le climat/i)).toBeNull();
    });

    it("annonce le nombre de changements rendu par le backend", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([
        { ...RAPIDE, numberOfTransfers: 2 },
      ]);
      rendre();

      await chercher();

      expect(await screen.findByText(/2 changements/i)).toBeDefined();
    });

    it("dit « sans changement » plutôt que « 0 changement »", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
      rendre();

      await chercher();

      expect(await screen.findByText(/sans changement/i)).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Enregistrement d'un itinéraire (étape 5A-7)
  // ---------------------------------------------------------------------------
  describe("enregistrement", () => {
    /// Le bouton d'UN itinéraire, désigné par son libellé.
    const boutonEnregistrer = (critere: "rapide" | "écologique") =>
      screen.getByRole("button", {
        name: new RegExp(`enregistrer le trajet le plus ${critere}`, "i"),
      });

    describe("visiteur non authentifié", () => {
      it("propose la connexion au lieu du bouton", async () => {
        vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
        rendre();

        await chercher();

        expect(await screen.findByText(/connectez-vous pour enregistrer/i)).toBeDefined();
        expect(screen.getByRole("link", { name: /se connecter/i })).toBeDefined();
      });

      it("n'appelle JAMAIS POST /api/routes", async () => {
        vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
        rendre();

        await chercher();
        await screen.findByText(/connectez-vous pour enregistrer/i);

        // Inutile de déranger le backend : il répondrait 401.
        expect(enregistrerItineraire).not.toHaveBeenCalled();
      });

      it("laisse la recherche entièrement lisible", async () => {
        vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
        rendre();

        await chercher();

        // Seul l'ENREGISTREMENT demande un compte ; la recherche est publique.
        expect(await screen.findByText("Le plus rapide")).toBeDefined();
        expect(screen.getByText(/Gare du Nord → Châtelet/)).toBeDefined();
      });
    });

    describe("usager authentifié", () => {
      beforeEach(() => {
        authentifier();
      });

      it("propose un bouton par itinéraire", async () => {
        vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE, COURT]);
        rendre();

        await chercher();

        // Deux boutons DISTINCTS : leur nom dit ce qu'ils enregistrent.
        expect(await screen.findByRole("button", { name: /enregistrer le trajet le plus rapide/i })).toBeDefined();
        expect(screen.getByRole("button", { name: /enregistrer le trajet le plus écologique/i })).toBeDefined();
      });

      it("envoie le corps EXACT attendu par le backend", async () => {
        vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
        vi.mocked(enregistrerItineraire).mockResolvedValue({} as never);
        rendre();
        const utilisateur = await chercher();

        await utilisateur.click(await screen.findByRole("button", { name: /enregistrer le trajet le plus rapide/i }));

        // Coordonnées des arrêts CHOISIS, et pour chaque segment le seul
        // triplet du réseau. Ni durée, ni distance, ni CO2, ni éco-score :
        // le ValidationPipe les rejetterait en 400.
        await waitFor(() =>
          expect(enregistrerItineraire).toHaveBeenCalledWith(
            {
              originLat: 48.88,
              originLng: 2.355,
              destinationLat: 48.853,
              destinationLng: 2.369,
              segments: [
                {
                  lineId: "ligne-4",
                  fromStopId: ARRETS[0].id,
                  toStopId: ARRETS[1].id,
                },
                {
                  lineId: "ligne-marche",
                  fromStopId: ARRETS[1].id,
                  toStopId: ARRETS[2].id,
                },
              ],
            },
            "jeton-valide",
          ),
        );
      });

      it("envoie un itinéraire à UN seul segment", async () => {
        vi.mocked(rechercherItineraires).mockResolvedValue([COURT]);
        vi.mocked(enregistrerItineraire).mockResolvedValue({} as never);
        rendre();
        const utilisateur = await chercher();

        await utilisateur.click(await screen.findByRole("button", { name: /enregistrer le trajet le plus écologique/i }));

        await waitFor(() => {
          const corps = vi.mocked(enregistrerItineraire).mock.calls[0][0];
          expect(corps.segments).toEqual([
            {
              lineId: "ligne-38",
              fromStopId: ARRETS[0].id,
              toStopId: ARRETS[2].id,
            },
          ]);
        });
      });

      it("n'envoie JAMAIS les segments de l'autre itinéraire", async () => {
        vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE, COURT]);
        vi.mocked(enregistrerItineraire).mockResolvedValue({} as never);
        rendre();
        const utilisateur = await chercher();

        // On clique sur le SECOND bouton.
        await utilisateur.click(await screen.findByRole("button", { name: /enregistrer le trajet le plus écologique/i }));

        await waitFor(() => {
          const corps = vi.mocked(enregistrerItineraire).mock.calls[0][0];
          // Un seul segment, celui du plus écologique — jamais les deux du plus
          // rapide. C'est ce que garantit l'absence d'état « sélection ».
          expect(corps.segments).toHaveLength(1);
          expect(corps.segments[0].lineId).toBe("ligne-38");
        });
      });

      it("n'envoie AUCUN champ calculé côté frontend", async () => {
        vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
        vi.mocked(enregistrerItineraire).mockResolvedValue({} as never);
        rendre();
        const utilisateur = await chercher();

        await utilisateur.click(await screen.findByRole("button", { name: /enregistrer le trajet le plus rapide/i }));

        await waitFor(() => {
          // Passage par `unknown` : le type du corps n'a pas de signature
          // d'index, et c'est justement ce qu'on veut inspecter — la liste
          // EXACTE des clés envoyées.
          const corps = vi.mocked(enregistrerItineraire).mock.calls[0][0] as unknown as Record<
            string,
            unknown
          >;
          // Ces champs ont été RETIRÉS du contrat en 4E-3B : les envoyer
          // rouvrirait la faille d'intégrité qu'ils avaient créée.
          expect(corps.totalDurationMin).toBeUndefined();
          expect(corps.totalDistanceM).toBeUndefined();
          expect(corps.ecoScore).toBeUndefined();
          expect(corps.carbonEstimate).toBeUndefined();
          expect(Object.keys(corps).sort()).toEqual([
            "destinationLat",
            "destinationLng",
            "originLat",
            "originLng",
            "segments",
          ]);
        });
      });

      it("désactive le bouton pendant l'envoi", async () => {
        vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
        vi.mocked(enregistrerItineraire).mockReturnValue(new Promise(() => {}));
        rendre();
        const utilisateur = await chercher();

        await utilisateur.click(await screen.findByRole("button", { name: /enregistrer le trajet le plus rapide/i }));

        // Sans ce verrou, un double clic créerait deux trajets identiques.
        await waitFor(() =>
          expect(
            screen.getByRole("button", { name: /enregistrement/i }).hasAttribute("disabled"),
          ).toBe(true),
        );
      });

      it("n'annonce le succès QU'APRÈS la réponse du serveur", async () => {
        let libere: () => void = () => {};
        vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
        vi.mocked(enregistrerItineraire).mockReturnValue(
          new Promise((resolve) => {
            libere = () => resolve({} as never);
          }),
        );
        rendre();
        const utilisateur = await chercher();

        await utilisateur.click(await screen.findByRole("button", { name: /enregistrer le trajet le plus rapide/i }));

        // Pendant l'envoi : aucune confirmation.
        await screen.findByRole("button", { name: /enregistrement/i });
        expect(screen.queryByText(/trajet enregistré/i)).toBeNull();

        libere();

        expect(await screen.findByText(/trajet enregistré/i)).toBeDefined();
      });

      it("confirme l'enregistrement sans masquer l'itinéraire", async () => {
        vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
        vi.mocked(enregistrerItineraire).mockResolvedValue({} as never);
        rendre();
        const utilisateur = await chercher();

        await utilisateur.click(await screen.findByRole("button", { name: /enregistrer le trajet le plus rapide/i }));

        expect(await screen.findByText(/trajet enregistré/i)).toBeDefined();
        expect(screen.getByText("Le plus rapide")).toBeDefined();
      });

      it("n'enregistre QUE l'itinéraire cliqué", async () => {
        vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE, COURT]);
        vi.mocked(enregistrerItineraire).mockResolvedValue({} as never);
        rendre();
        const utilisateur = await chercher();

        await utilisateur.click(await screen.findByRole("button", { name: /enregistrer le trajet le plus rapide/i }));
        await screen.findByText(/trajet enregistré/i);

        // L'autre carte garde son bouton : elle n'a pas été enregistrée.
        expect(boutonEnregistrer("écologique")).toBeDefined();
        expect(enregistrerItineraire).toHaveBeenCalledTimes(1);
      });

      describe("erreurs", () => {
        const echouerAvec = async (erreur: unknown) => {
          vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
          vi.mocked(enregistrerItineraire).mockRejectedValue(erreur);
          rendre();
          const utilisateur = await chercher();
          await utilisateur.click(await screen.findByRole("button", { name: /enregistrer le trajet le plus rapide/i }));
          return screen.findByRole("alert");
        };

        it("signale un refus de validation (400)", async () => {
          const alerte = await echouerAvec(new ApiError(400, "Les segments ne senchainent pas"));

          expect(alerte.textContent).toContain("senchainent");
        });

        it("signale une session expirée (401)", async () => {
          const alerte = await echouerAvec(new ApiError(401, "Token invalide ou expiré"));

          expect(alerte.textContent).toContain("expiré");
        });

        it("signale un refus de calcul carbone (422)", async () => {
          const alerte = await echouerAvec(
            new ApiError(422, "Aucun facteur d emission pour le mode ESCOOTER"),
          );

          expect(alerte.textContent).toContain("ESCOOTER");
        });

        it("signale un microservice indisponible (503)", async () => {
          const alerte = await echouerAvec(
            new ApiError(503, "Service de calcul carbone indisponible"),
          );

          expect(alerte.textContent).toContain("indisponible");
        });

        it("signale une panne réseau", async () => {
          const alerte = await echouerAvec(new NetworkError("Le serveur est injoignable."));

          expect(alerte.textContent).toContain("injoignable");
        });

        it("n'annonce JAMAIS un succès après un échec", async () => {
          await echouerAvec(new ApiError(503, "Panne"));

          expect(screen.queryByText(/trajet enregistré/i)).toBeNull();
        });

        it("garde l'itinéraire visible malgré l'échec", async () => {
          await echouerAvec(new ApiError(503, "Panne"));

          // Une erreur d'enregistrement n'invalide pas le trajet trouvé.
          expect(screen.getByText("Le plus rapide")).toBeDefined();
          expect(screen.getByText(/Gare du Nord → Châtelet/)).toBeDefined();
        });

        it("laisse réessayer après un échec", async () => {
          await echouerAvec(new ApiError(503, "Panne"));

          expect(boutonEnregistrer("rapide").hasAttribute("disabled")).toBe(false);
        });
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Absence de résultat et erreurs
  // ---------------------------------------------------------------------------
  describe("absence de résultat et erreurs", () => {
    it("annonce l'absence d'itinéraire SANS la présenter comme une panne", async () => {
      // Le backend répond 200 avec un tableau vide : « aucun itinéraire » est
      // une réponse, pas une erreur.
      vi.mocked(rechercherItineraires).mockResolvedValue([]);
      rendre();

      await chercher();

      expect(await screen.findByText(/aucun itinéraire trouvé/i)).toBeDefined();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("affiche l'erreur de validation renvoyée par le backend", async () => {
      vi.mocked(rechercherItineraires).mockRejectedValue(
        new ApiError(400, "fromLat must be a latitude string or number"),
      );
      rendre();

      await chercher();

      const alerte = await screen.findByRole("alert");
      expect(alerte.textContent).toContain("fromLat");
    });

    it("affiche un message lisible en cas de panne réseau", async () => {
      vi.mocked(rechercherItineraires).mockRejectedValue(
        new NetworkError("Le serveur est injoignable."),
      );
      rendre();

      await chercher();

      const alerte = await screen.findByRole("alert");
      expect(alerte.textContent).toContain("injoignable");
    });

    it("ne laisse JAMAIS fuir une erreur inattendue", async () => {
      vi.mocked(rechercherItineraires).mockRejectedValue(
        new TypeError("Cannot read properties of undefined"),
      );
      rendre();

      await chercher();

      const alerte = await screen.findByRole("alert");
      expect(alerte.textContent).toContain("erreur inattendue");
      expect(alerte.textContent).not.toContain("Cannot read properties");
    });

    it("efface les anciens résultats quand la recherche échoue", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValueOnce([RAPIDE]);
      rendre();
      const utilisateur = await chercher();
      await screen.findByText("Le plus rapide");

      vi.mocked(rechercherItineraires).mockRejectedValueOnce(new ApiError(500, "Erreur interne"));
      await utilisateur.click(screen.getByRole("button", { name: /rechercher/i }));

      // Les laisser sous un message d'erreur laisserait croire qu'ils
      // correspondent à la dernière recherche.
      await screen.findByRole("alert");
      expect(screen.queryByText("Le plus rapide")).toBeNull();
    });

    it("réactive le bouton après un échec", async () => {
      vi.mocked(rechercherItineraires).mockRejectedValue(new ApiError(500, "Erreur interne"));
      rendre();

      await chercher();
      await screen.findByRole("alert");

      expect(screen.getByRole("button", { name: /rechercher/i }).hasAttribute("disabled")).toBe(
        false,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Adresses favorites (bloc 7-8)
  // ---------------------------------------------------------------------------
  describe("adresses favorites", () => {
    const DOMICILE: FavoriteAddress = {
      id: "aaaaaaaa-0000-0000-0000-000000000001",
      type: "HOME",
      address: "12 rue des Lilas, Paris",
      latitude: 48.11,
      longitude: 2.11,
      createdAt: "2026-08-30T10:00:00.000Z",
    };

    const TRAVAIL: FavoriteAddress = {
      id: "bbbbbbbb-0000-0000-0000-000000000002",
      type: "WORK",
      address: "3 avenue de la Gare, Lyon",
      latitude: 45.22,
      longitude: 4.22,
      createdAt: "2026-08-30T11:00:00.000Z",
    };

    const avecAdresses = () => {
      vi.mocked(listerAdresses).mockResolvedValue([DOMICILE, TRAVAIL]);
      authentifier();
      rendre();
    };

    it("un VISITEUR ne voit aucune adresse, et rien n'est demande", async () => {
      rendre();
      await screen.findByLabelText("Depart".replace("Depart", "Départ"));

      // La recherche reste en libre acces : un visiteur ne doit declencher
      // AUCUN appel supplementaire sur cette page publique.
      expect(listerAdresses).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: "Domicile" })).toBeNull();
    });

    it("un usager connecte voit ses adresses dans les DEUX listes", async () => {
      avecAdresses();

      // On part de chez soi le matin, on y rentre le soir : n'en offrir qu'au
      // depart obligerait a ressaisir le retour.
      // Un bouton par favori et par champ : départ ET arrivée.
      await waitFor(() => {
        expect(screen.getAllByRole("button", { name: "Domicile" })).toHaveLength(2);
      });
      expect(screen.getAllByRole("button", { name: "Travail" })).toHaveLength(2);
    });

    it("affiche le LIBELLE francais, jamais HOME ni WORK", async () => {
      avecAdresses();

      await waitFor(() => {
        expect(screen.getAllByRole("button", { name: "Domicile" })).toHaveLength(2);
      });
      // « HOME » ne se montre jamais à un usager.
      expect(screen.queryByRole("button", { name: /HOME/ })).toBeNull();
    });

    it("DOMICILE en depart envoie SES coordonnees", async () => {
      avecAdresses();
      vi.mocked(rechercherItineraires).mockResolvedValue([]);

      const utilisateur = userEvent.setup();
      await waitFor(() => {
        expect(screen.getAllByRole("button", { name: "Domicile" })).toHaveLength(2);
      });

      await utilisateur.click(screen.getAllByRole("button", { name: "Domicile" })[0]);
      await utilisateur.selectOptions(
        screen.getByLabelText("Arrêt d'arrivée"),
        screen.getAllByRole("option", { name: /Bastille/ })[1],
      );
      await utilisateur.click(screen.getByRole("button", { name: /rechercher/i }));

      await waitFor(() => {
        expect(rechercherItineraires).toHaveBeenCalled();
      });
      const corps = vi.mocked(rechercherItineraires).mock.calls[0][0];
      expect(corps.fromLat).toBe(48.11);
      expect(corps.fromLon).toBe(2.11);
      // ⚠️ ET SURTOUT PAS celles du travail.
      expect(corps.fromLat).not.toBe(45.22);
    });

    it("TRAVAIL en arrivee envoie SES coordonnees, pas celles du depart", async () => {
      avecAdresses();
      vi.mocked(rechercherItineraires).mockResolvedValue([]);

      const utilisateur = userEvent.setup();
      await waitFor(() => {
        expect(screen.getAllByRole("button", { name: "Travail" })).toHaveLength(2);
      });

      await utilisateur.click(screen.getAllByRole("button", { name: "Domicile" })[0]);
      await utilisateur.click(screen.getAllByRole("button", { name: "Travail" })[1]);
      await utilisateur.click(screen.getByRole("button", { name: /rechercher/i }));

      await waitFor(() => {
        expect(rechercherItineraires).toHaveBeenCalled();
      });

      // LE TEST QUI COMPTE : les deux points sont resolus SEPAREMENT. Une
      // inversion enverrait le domicile en arrivee sans que rien ne le dise.
      expect(vi.mocked(rechercherItineraires).mock.calls[0][0]).toEqual({
        fromLat: 48.11,
        fromLon: 2.11,
        toLat: 45.22,
        toLon: 4.22,
      });
    });

    it("n'envoie JAMAIS d'identifiant d'usager", async () => {
      avecAdresses();
      vi.mocked(rechercherItineraires).mockResolvedValue([]);

      const utilisateur = userEvent.setup();
      await waitFor(() => {
        expect(screen.getAllByRole("button", { name: "Domicile" })).toHaveLength(2);
      });

      await utilisateur.click(screen.getAllByRole("button", { name: "Domicile" })[0]);
      await utilisateur.click(screen.getAllByRole("button", { name: "Travail" })[1]);
      await utilisateur.click(screen.getByRole("button", { name: /rechercher/i }));

      await waitFor(() => {
        expect(rechercherItineraires).toHaveBeenCalled();
      });
      // `POST /routes/search` n'a jamais accepte autre chose que quatre
      // coordonnees. Aucun nouvel endpoint, aucun champ supplementaire.
      expect(Object.keys(vi.mocked(rechercherItineraires).mock.calls[0][0]).sort()).toEqual([
        "fromLat",
        "fromLon",
        "toLat",
        "toLon",
      ]);
    });

    it("CONSERVE les arrets et « Ma position »", async () => {
      avecAdresses();

      await waitFor(() => {
        expect(screen.getAllByRole("button", { name: "Domicile" })).toHaveLength(2);
      });

      // Les options S'AJOUTENT : rien de ce qui existait n'a disparu.
      await ouvrirArrets();
      expect(screen.getAllByRole("option", { name: /Gare du Nord/ }).length).toBeGreaterThan(0);
      expect(screen.getByRole("button", { name: "Ma position" })).toBeDefined();
    });

    it("un echec de chargement des adresses NE CASSE PAS la recherche", async () => {
      vi.mocked(listerAdresses).mockRejectedValue(new Error("indisponible"));
      authentifier();
      rendre();

      // Les adresses favorites sont un RACCOURCI : leur absence n'empeche ni
      // de chercher, ni de choisir un arret. Aucune erreur ne s'affiche.
      await waitFor(() => {
        expect(screen.getAllByRole("option", { name: /Gare du Nord/ }).length).toBeGreaterThan(0);
      });
      expect(screen.queryByRole("button", { name: "Domicile" })).toBeNull();
      expect(screen.getByRole("button", { name: /rechercher/i })).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Recherche d'adresses en saisie libre (Phase 3A)
  // ---------------------------------------------------------------------------
  describe("recherche d'adresses", () => {
    const TOUR_EIFFEL = {
      label: "Tour Eiffel, Paris",
      latitude: 48.8584,
      longitude: 2.2945,
    };
    const GARE_DU_NORD = {
      label: "Gare du Nord, Paris",
      latitude: 48.8809,
      longitude: 2.3553,
    };

    const geocoder = (items: (typeof TOUR_EIFFEL)[]) =>
      vi.mocked(rechercherAdresses).mockResolvedValue({
        items,
        attribution: "© Contributeurs OpenStreetMap",
      });

    /// Saisit dans un champ, attend le débounce, et choisit une proposition.
    const choisirAdresse = async (
      utilisateur: ReturnType<typeof userEvent.setup>,
      champ: "Départ" | "Arrivée",
      texte: string,
      libelleChoisi: string,
    ) => {
      await utilisateur.type(await screen.findByLabelText(champ), texte);
      await waitFor(() => expect(rechercherAdresses).toHaveBeenCalled());
      await utilisateur.click(await screen.findByText(libelleChoisi));
    };

    it("les DEUX champs sont des saisies libres", async () => {
      rendre();

      // La liste déroulante d'arrêts n'est plus l'entrée principale.
      expect(await screen.findByLabelText("Départ")).toHaveProperty("tagName", "INPUT");
      expect(screen.getByLabelText("Arrivée")).toHaveProperty("tagName", "INPUT");
    });

    it("EMPÊCHE de chercher tant qu'aucune proposition n'est choisie", async () => {
      geocoder([TOUR_EIFFEL]);
      const utilisateur = userEvent.setup();
      rendre();

      await utilisateur.type(await screen.findByLabelText("Départ"), "Tour Eiffel");
      await utilisateur.type(screen.getByLabelText("Arrivée"), "Gare du Nord");

      // LE POINT CENTRAL : deux champs remplis ne suffisent pas. Un texte
      // saisi n'a aucune coordonnée tant qu'il n'a pas été résolu.
      expect(screen.getByRole("button", { name: /rechercher/i })).toHaveProperty("disabled", true);
    });

    it("transmet les COORDONNÉES des deux adresses choisies", async () => {
      geocoder([TOUR_EIFFEL, GARE_DU_NORD]);
      vi.mocked(rechercherItineraires).mockResolvedValue([]);
      const utilisateur = userEvent.setup();
      rendre();

      await choisirAdresse(utilisateur, "Départ", "Tour", "Tour Eiffel, Paris");
      await choisirAdresse(utilisateur, "Arrivée", "Gare", "Gare du Nord, Paris");
      await utilisateur.click(screen.getByRole("button", { name: /rechercher/i }));

      // ⚠️ AUCUNE INVERSION : le départ porte les coordonnées de la Tour
      // Eiffel, l'arrivée celles de la Gare du Nord — et pas le contraire.
      await waitFor(() => expect(rechercherItineraires).toHaveBeenCalled());
      expect(vi.mocked(rechercherItineraires).mock.calls[0][0]).toEqual({
        fromLat: 48.8584,
        fromLon: 2.2945,
        toLat: 48.8809,
        toLon: 2.3553,
      });
    });

    it("n'envoie NI adresse textuelle NI identifiant d'usager", async () => {
      geocoder([TOUR_EIFFEL, GARE_DU_NORD]);
      vi.mocked(rechercherItineraires).mockResolvedValue([]);
      const utilisateur = userEvent.setup();
      authentifier();
      rendre();

      await choisirAdresse(utilisateur, "Départ", "Tour", "Tour Eiffel, Paris");
      await choisirAdresse(utilisateur, "Arrivée", "Gare", "Gare du Nord, Paris");
      await utilisateur.click(screen.getByRole("button", { name: /rechercher/i }));

      await waitFor(() => expect(rechercherItineraires).toHaveBeenCalled());
      // Le moteur n'a jamais accepté autre chose que quatre coordonnées.
      expect(Object.keys(vi.mocked(rechercherItineraires).mock.calls[0][0]).sort()).toEqual([
        "fromLat",
        "fromLon",
        "toLat",
        "toLon",
      ]);
    });

    it("MODIFIER le texte après sélection REDÉSACTIVE la recherche", async () => {
      geocoder([TOUR_EIFFEL, GARE_DU_NORD]);
      const utilisateur = userEvent.setup();
      rendre();

      await choisirAdresse(utilisateur, "Départ", "Tour", "Tour Eiffel, Paris");
      await choisirAdresse(utilisateur, "Arrivée", "Gare", "Gare du Nord, Paris");

      await waitFor(() =>
        expect(screen.getByRole("button", { name: /rechercher/i })).toHaveProperty(
          "disabled",
          false,
        ),
      );

      await utilisateur.type(screen.getByLabelText("Départ"), "x");

      // Sans cette règle, on partirait avec les coordonnées de la Tour Eiffel
      // en affichant un tout autre texte à l'usager.
      expect(screen.getByRole("button", { name: /rechercher/i })).toHaveProperty("disabled", true);
    });

    it("reste utilisable par un VISITEUR non connecté", async () => {
      geocoder([TOUR_EIFFEL]);
      const utilisateur = userEvent.setup();
      rendre();

      await choisirAdresse(utilisateur, "Départ", "Tour", "Tour Eiffel, Paris");

      // Aucun jeton n'est requis : la recherche est en libre accès.
      expect(rechercherAdresses).toHaveBeenCalled();
      expect(screen.getByLabelText("Départ")).toHaveProperty("value", "Tour Eiffel, Paris");
    });

    it("un FAVORI remplit le champ SANS géocodage", async () => {
      const DOMICILE = {
        id: "aaaaaaaa-0000-0000-0000-000000000001",
        type: "HOME" as const,
        address: "12 rue des Lilas, Paris",
        latitude: 48.11,
        longitude: 2.11,
        createdAt: "2026-08-30T10:00:00.000Z",
      };
      vi.mocked(listerAdresses).mockResolvedValue([DOMICILE]);
      vi.mocked(rechercherItineraires).mockResolvedValue([]);
      geocoder([GARE_DU_NORD]);
      const utilisateur = userEvent.setup();
      authentifier();
      rendre();

      await utilisateur.click((await screen.findAllByRole("button", { name: "Domicile" }))[0]);

      // Le favori porte DÉJÀ ses coordonnées : le géocoder serait un appel
      // réseau pour réapprendre ce qu'on sait.
      expect(rechercherAdresses).not.toHaveBeenCalled();
      expect(screen.getByLabelText("Départ")).toHaveProperty("value", "12 rue des Lilas, Paris");

      await choisirAdresse(utilisateur, "Arrivée", "Gare", "Gare du Nord, Paris");
      await utilisateur.click(screen.getByRole("button", { name: /rechercher/i }));

      await waitFor(() => expect(rechercherItineraires).toHaveBeenCalled());
      expect(vi.mocked(rechercherItineraires).mock.calls[0][0]).toMatchObject({
        fromLat: 48.11,
        fromLon: 2.11,
      });
    });

    it("un ARRÊT du réseau reste choisissable", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([]);
      const utilisateur = userEvent.setup();
      rendre();

      await ouvrirArrets();
      await utilisateur.selectOptions(screen.getByLabelText("Arrêt de départ"), ARRETS[0].id);

      // Rien de ce qui existait n'a disparu : l'arrêt remplit le champ de
      // départ avec SES coordonnées.
      expect(screen.getByLabelText("Départ")).toHaveProperty("value", ARRETS[0].name);
    });
  });

  // ---------------------------------------------------------------------------
  // Regroupement des étapes (refonte UX)
  // ---------------------------------------------------------------------------
  describe("regroupement des étapes", () => {
    /// Cinq tronçons consécutifs sur la même ligne — le cas qui a motivé le
    /// regroupement : sans lui, cinq lignes « Métro 8 » se suivaient.
    const LIGNE_8: Itinerary = {
      criterion: "FASTEST",
      totalDistanceM: 4000,
      totalDurationMin: 10,
      numberOfTransfers: 0,
      carbon: carbone(16, 872, 856, 98.2),
      segments: Array.from({ length: 5 }, (_, i) => ({
        fromStopId: `s${i}`,
        fromStopName: `Arrêt ${i}`,
        fromStopLat: 48.85 + i * 0.001,
        fromStopLon: 2.35 + i * 0.001,
        toStopId: `s${i + 1}`,
        toStopName: `Arrêt ${i + 1}`,
        toStopLat: 48.85 + (i + 1) * 0.001,
        toStopLon: 2.35 + (i + 1) * 0.001,
        mode: "METRO" as const,
        lineName: "8",
        operator: "RATP",
        lineId: "ligne-8",
        gtfsLineId: null,
        distanceM: 800,
        durationMin: 2,
        geometry: null,
        geometrySource: "STRAIGHT" as const,
      })),
    };

    it("affiche UNE étape pour cinq tronçons de la même ligne", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([LIGNE_8]);
      rendre();

      await chercher();

      // UNE seule étape, et non cinq : c'est le cœur du regroupement. Le
      // groupe annonce son premier et son dernier arrêt, avec le compte
      // entre les deux.
      expect(await screen.findByText(/Arrêt 0 → Arrêt 5/)).toBeDefined();
      // Deux occurrences légitimes : le compte de l'étape, et le libellé du
      // dépliage « Voir les 5 arrêts ».
      expect(screen.getAllByText(/5 arrêts/).length).toBeGreaterThan(0);
      // Le détail est REPLIÉ tant qu'on ne le demande pas.
      //
      // ⚠️ On vérifie l'attribut `open`, PAS l'absence du texte : le contenu
      // d'un `<details>` reste dans le DOM quand il est fermé — c'est ce qui
      // le rend indexable et accessible. Chercher « Arrêt 3 » le trouverait.
      const depliage = screen.getByText("Voir les 5 arrêts").closest("details");
      expect((depliage as HTMLDetailsElement).open).toBe(false);
    });

    it("CONSERVE le détail derrière un dépliage", async () => {
      const utilisateur = userEvent.setup();
      vi.mocked(rechercherItineraires).mockResolvedValue([LIGNE_8]);
      rendre();

      await chercher();

      // ⚠️ Le regroupement est un choix d'AFFICHAGE, pas une perte
      // d'information : l'usager doit pouvoir savoir où il passe.
      await utilisateur.click(await screen.findByText("Voir les 5 arrêts"));

      for (const nom of ["Arrêt 1", "Arrêt 2", "Arrêt 3", "Arrêt 4", "Arrêt 5"]) {
        expect(screen.getByText(nom)).toBeDefined();
      }
    });

    it("NE PROPOSE PAS de dépliage pour un tronçon unique", async () => {
      vi.mocked(rechercherItineraires).mockResolvedValue([RAPIDE]);
      rendre();

      await chercher();

      await screen.findByText("Métro 4");
      // Ouvrir un détail d'une seule ligne n'apprendrait rien.
      expect(screen.queryByText(/Voir les 1 arrêts/)).toBeNull();
    });
  });
});
