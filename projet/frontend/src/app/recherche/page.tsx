"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Carte } from "@/components/Carte";
import { Container } from "@/components/Container";
import { EmptyState } from "@/components/EmptyState";
import { ErrorMessage } from "@/components/ErrorMessage";
import { Spinner } from "@/components/Spinner";
import { messageDErreur } from "@/lib/api";
import { haversineDistanceM } from "@/lib/geo";
import {
  CENTRE_DEFAUT,
  pointDepuisArret,
  pointsDuTrajet,
  tronconsDuTrajet,
  type PointCarte,
  type TronconTrace,
} from "@/lib/carte";
import type { RoleArret } from "@/components/CarteLeaflet";
import { velibProches, type VelibStation } from "@/lib/velib-api";
import { territoire, type Territoire } from "@/lib/territoire-api";
import { ErreurGeolocalisation, positionActuelle, type Coordonnees } from "@/lib/geolocalisation";
import { listerAdresses } from "@/lib/adresses-api";
import { regrouperSegments, resumerModes, type GroupeEtapes } from "@/lib/itineraire";
import { memoriserSelection } from "@/lib/itineraire-selection";
import { ChampAdresse, type PointChoisi } from "@/components/ChampAdresse";
import { EtapeMarche } from "@/components/EtapeMarche";
import type { FavoriteAddress, FavoriteAddressType } from "@/lib/types";
import {
  enregistrerItineraire,
  listerArrets,
  modesDuReseau,
  rechercherItineraires,
  versRequeteEnregistrement,
} from "@/lib/itineraires-api";
import { FiltresModes } from "@/components/FiltresModes";
import { capacites, type Capacites } from "@/lib/capacites-api";
import { useAuth } from "@/components/AuthProvider";
import { useTraduction } from "@/components/LangueProvider";
import type { Textes } from "@/lib/i18n/dictionnaire";
import { ButtonLink } from "@/components/Button";
import {
  formaterCo2,
  formaterDistance,
  formaterDuree,
  formaterHeure,
  LIBELLES_MODES,
} from "@/lib/format";
import type {
  Itinerary,
  ItineraryCarbon,
  ItineraryCriterion,
  ModeVoyage,
  Stop,
  TransportMode,
} from "@/lib/types";
import { SelecteurModeVoyage } from "@/components/SelecteurModeVoyage";

// =============================================================================
// Recherche d'itinéraire (étape 5A-5, UC01)
// =============================================================================
// PUBLIQUE : aucune authentification. Le dossier place cette fonctionnalité
// dans le bloc « Mobilité (Libre accès) », et le backend ne pose aucun guard
// sur `POST /api/routes/search`.
//
// L'ÉTAT RESTE LOCAL, il n'est pas synchronisé dans l'URL. Conséquence
// assumée : recharger la page efface les résultats, et un itinéraire ne se
// partage pas par lien. Mettre les paramètres dans l'URL rendrait la
// recherche partageable — c'est une vraie amélioration, mais elle suppose de
// lire l'URL au montage, de la réécrire à chaque recherche et de gérer le
// retour arrière. Pour un formulaire à deux listes déroulantes dont le
// résultat se recalcule en une requête, la complexité ne se justifie pas
// encore.
// =============================================================================

/**
 * Valeur du champ « Départ » quand l'usager choisit sa position (bloc 5D-1).
 *
 * Un identifiant d'arrêt est un UUID : cette valeur ne peut donc jamais entrer
 * en collision avec un arrêt réel.
 */
const POSITION = "__ma-position__";

/**
 * Préfixe des valeurs désignant une adresse favorite (bloc 7-8).
 *
 * `adresse:<uuid>`. Un identifiant d'arrêt est un UUID nu : la collision est
 * donc impossible, comme pour `POSITION`.
 *
 * Un préfixe plutôt qu'une seconde liste déroulante : l'usager choisit UN
 * point de départ, et il doit le faire au même endroit quelle que soit sa
 * nature — un arrêt, sa position, ou son domicile.
 */
const PREFIXE_ADRESSE = "adresse:";

/**
 * Rayon des arrêts chargés autour du centre de la carte, en mètres.
 *
 * ⚠️ IL FAUT UN RAYON, ET NON « TOUS LES ARRÊTS ». `GET /api/stops` est borné
 * depuis la Phase 4 : le réseau compte 1 934 arrêts aujourd'hui et en comptera
 * plus de 35 000 avec le bus. La carte montre donc ce qui entoure ce qu'on
 * regarde, et se recharge quand on la déplace.
 *
 * 1 500 m couvre largement la vue par défaut sans ramener un pâté d'arrêts
 * illisible ; le backend plafonne de toute façon à 5 km.
 */
const RAYON_CARTE_M = 1500;

/**
 * Délai d'inactivité après un déplacement de carte avant de recharger.
 *
 * Un glissement produit un `moveend` par relâchement, mais un usager qui
 * explore en enchaîne plusieurs par seconde. Sans ce délai, chacun
 * déclencherait une requête dont la réponse arriverait déjà périmée.
 */
const DELAI_RECHARGEMENT_MS = 400;

/**
 * Rayon des stations Vélib' chargées autour du centre de la carte.
 *
 * Plus serré que celui des arrêts : le réseau compte 1 519 stations, bien plus
 * denses que les gares. 800 m couvre un quartier sans noyer la carte.
 */
const RAYON_VELIB_M = 800;

/**
 * Déplacement minimal du centre à partir duquel on recharge les arrêts.
 *
 * ═══ CE N'EST PAS UNE OPTIMISATION, C'EST UN VERROU ANTI-BOUCLE ═══
 *
 * Sans lui, `setCentreCarte({ latitude, longitude })` fabriquait un objet NEUF
 * à chaque `moveend`, même pour un centre identique au précédent. Le nouvel
 * objet re-rendait la page, la page re-rendait la carte, la carte se recadrait,
 * le recadrage émettait un `moveend`… « Maximum update depth exceeded ».
 *
 * En rendant l'état INCHANGÉ sous ce seuil, React abandonne le rendu : la
 * boucle ne peut plus se refermer, quelle que soit l'origine de l'appel.
 *
 * 50 m est très inférieur au rayon chargé (1 500 m) — aucun arrêt utile ne
 * peut donc échapper à l'affichage — et bien au-dessus du bruit d'arrondi de
 * Leaflet.
 */
const SEUIL_RECHARGEMENT_M = 50;

/// Libellés français des deux emplacements. `HOME` ne se montre pas.
const LIBELLES_ADRESSES: Record<FavoriteAddressType, string> = {
  HOME: "Domicile",
  WORK: "Travail",
};

/**
 * Où en est la demande de position.
 *
 * « echec » conserve le message ET la cause : un refus de permission se
 * répare dans les réglages, un délai dépassé se réessaie. Les confondre
 * laisserait l'usager sans rien à faire.
 */
type EtatPosition =
  | { statut: "repos" }
  | { statut: "localisation" }
  | { statut: "ok"; coordonnees: Coordonnees }
  | { statut: "echec"; message: string };

/// Ce que le formulaire connaît d'un point : l'arrêt choisi.

/**
 * Sort de l'enregistrement d'UN itinéraire (étape 5A-7).
 *
 * L'absence de clé signifie « rien de tenté ». Les trois états sont
 * distincts : on n'annonce jamais « enregistré » avant la réponse du serveur.
 */
type EtatEnregistrement =
  { statut: "envoi" } | { statut: "enregistre" } | { statut: "echec"; message: string };

export default function RecherchePage() {
  /**
   * Adresses favorites de l'usager connecté (bloc 7-8).
   *
   * ⚠️ TABLEAU VIDE PAR DÉFAUT, jamais `null` : un visiteur non connecté n'a
   * pas d'adresses, et ce n'est pas un chargement en cours. L'écran ne doit
   * RIEN attendre pour lui — la recherche reste en libre accès, comme le
   * dossier l'exige.
   */
  const [adressesFav, setAdressesFav] = useState<FavoriteAddress[]>([]);
  const [arrets, setArrets] = useState<Stop[] | null>(null);

  /**
   * Centre courant de la carte. Il commande le chargement des arrêts affichés.
   *
   * Initialisé sur `CENTRE_DEFAUT` : la carte doit montrer quelque chose AVANT
   * toute recherche et sans demander la position de l'usager — une invite de
   * permission au chargement est une invite qu'on refuse par réflexe.
   */
  const [centreCarte, setCentreCarte] = useState({
    latitude: CENTRE_DEFAUT[0],
    longitude: CENTRE_DEFAUT[1],
  });

  /**
   * Le territoire desservi, ou `null` tant qu'on ne le sait pas.
   *
   * ⚠️ IL COMMANDE LE CENTRE DE LA CARTE. Sans lui, celle-ci s'ouvrirait sur
   * une ville codée en dur — le défaut que ce recadrage corrige.
   */
  const [zone, setZone] = useState<Territoire | null>(null);

  /**
   * Le centre du territoire, sous une identité STABLE.
   *
   * ⚠️ SANS CE `useMemo`, l'expression `[zone.centerLat, zone.centerLon]`
   * écrite dans le JSX fabriquait un tableau neuf à chaque rendu. La carte le
   * recevait comme une valeur « changée » et se recadrait — ce qui provoquait
   * un rendu, donc un nouveau tableau, donc un nouveau recadrage.
   *
   * `CarteLeaflet` se protège désormais aussi de son côté (il compare deux
   * nombres, pas un tuple) ; les deux gardes sont volontairement conservées :
   * la carte ne doit pas dépendre de la discipline de chacun de ses appelants.
   */
  const centreDuTerritoire = useMemo<[number, number] | null>(
    () => (zone ? [zone.centerLat, zone.centerLon] : null),
    [zone],
  );

  /**
   * La carte a bougé : on recharge les arrêts autour du nouveau centre.
   *
   * ⚠️ STABLE (`useCallback` sans dépendance) ET IDEMPOTENT. La mise à jour
   * passe par la forme fonctionnelle et rend l'état INCHANGÉ quand le centre
   * n'a pas bougé de plus de `SEUIL_RECHARGEMENT_M` : React abandonne alors le
   * rendu. C'est ce qui rend structurellement impossible la boucle
   * rendu → recadrage → `moveend` → `setState` → rendu.
   */
  const surCentreDeplace = useCallback((latitude: number, longitude: number) => {
    setCentreCarte((actuel) => {
      const ecartM = haversineDistanceM(
        actuel.latitude,
        actuel.longitude,
        latitude,
        longitude,
      );

      return ecartM < SEUIL_RECHARGEMENT_M ? actuel : { latitude, longitude };
    });
  }, []);

  /**
   * Modes présents dans le réseau, ou `null` tant qu'on ne les connaît pas.
   *
   * ⚠️ VIENT DU BACKEND, jamais de l'enum. `TransportMode` compte huit
   * valeurs ; le réseau chargé n'en a peut-être que deux.
   */
  const [modesReseau, setModesReseau] = useState<TransportMode[] | null>(null);

  /**
   * Ce que cette installation sait faire, ou `null` tant qu'on l'ignore.
   *
   * ⚠️ DISTINCT DES MODES DU RÉSEAU, et il faut le garder distinct. Le tram
   * dépend du GTFS importé ; le vélo dépend d'un routeur cyclable configuré.
   * Les confondre ferait apparaître un filtre vélo parce que le tram circule.
   */
  const [capacitesInstallation, setCapacites] = useState<Capacites | null>(
    null,
  );

  useEffect(() => {
    const controleur = new AbortController();

    capacites(controleur.signal)
      .then(setCapacites)
      .catch(() => {
        // Silencieux, et surtout PAS OPTIMISTE : `null` est traité comme
        // « rien n'est configuré ». Un échec réseau ne doit jamais faire
        // apparaître un filtre dont la source est absente.
      });

    return () => controleur.abort();
  }, []);

  /**
   * Modes que l'usager a écartés.
   *
   * ⚠️ UN FILTRE D'AFFICHAGE, PAS UN CRITÈRE DE RECHERCHE. Il masque des
   * itinéraires DÉJÀ calculés — il ne relance rien. Le dire est indispensable :
   * sans cela, décocher « Bus » laisserait attendre de meilleures propositions
   * sans bus, qui ne viendront pas.
   */
  const [modesExclus, setModesExclus] = useState<ReadonlySet<TransportMode>>(
    new Set(),
  );

  useEffect(() => {
    const controleur = new AbortController();

    modesDuReseau(controleur.signal)
      .then((reponse) => setModesReseau(reponse.modes.map((m) => m.mode)))
      .catch(() => {
        // Silencieux : sans cette liste, les filtres ne s'affichent pas. Un
        // message d'erreur pour une commodité n'apprendrait rien.
      });

    return () => controleur.abort();
  }, []);

  useEffect(() => {
    const controleur = new AbortController();

    territoire(controleur.signal)
      .then((trouve) => {
        setZone(trouve);
        setCentreCarte({
          latitude: trouve.centerLat,
          longitude: trouve.centerLon,
        });
      })
      .catch(() => {
        // Silencieux : la carte reste sur son repli, et l'usager peut la
        // déplacer. Un message d'erreur pour un centrage n'apprendrait rien.
      });

    return () => controleur.abort();
  }, []);

  /**
   * Couche Vélib' : masquée par défaut.
   *
   * ⚠️ MASQUÉE, ET C'EST DÉLIBÉRÉ. Charger 1 519 stations pour quelqu'un qui
   * cherche un trajet en métro serait un appel réseau inutile et une carte
   * illisible. La couche s'affiche sur demande, comme un calque.
   */
  const [velibVisible, setVelibVisible] = useState(false);

  /**
   * Sort du chargement Vélib'.
   *
   * Quatre états DISTINCTS, parce qu'ils appellent quatre réponses
   * différentes : ne rien afficher, patienter, montrer les stations, ou dire
   * franchement que le fournisseur est indisponible.
   */
  const [velib, setVelib] = useState<
    | { statut: "masque" }
    | { statut: "chargement" }
    | { statut: "ok"; stations: VelibStation[]; luA: string; attribution: string }
    | { statut: "echec"; message: string }
  >({ statut: "masque" });
  const [erreurArrets, setErreurArrets] = useState<string | null>(null);

  /**
   * Points RÉELLEMENT retenus (Phase 3A).
   *
   * ⚠️ `null` tant qu'aucune proposition n'a été choisie. Le texte tapé vit
   * dans `ChampAdresse` et n'arrive JAMAIS jusqu'ici : seule une sélection
   * explicite produit des coordonnées. C'est ce qui rend impossible de lancer
   * une recherche sur une saisie libre non résolue.
   */
  const [depart, setDepart] = useState<PointChoisi | null>(null);
  const [position, setPosition] = useState<EtatPosition>({ statut: "repos" });
  const [arrivee, setArrivee] = useState<PointChoisi | null>(null);

  const [resultats, setResultats] = useState<Itinerary[] | null>(null);

  /**
   * Itinéraire mis en avant sur la carte (bloc 5B).
   *
   * `null` NE VEUT PAS DIRE « aucun » : il veut dire « l'usager n'a pas encore
   * choisi », auquel cas on retient le premier résultat. Sans cela, la carte
   * resterait vide après une recherche réussie, ce qui donnerait l'impression
   * qu'elle est cassée.
   */
  /**
   * Mode de déplacement choisi : transports (défaut), à pied, ou à vélo.
   *
   * ⚠️ « À pied » et « à vélo » NE SONT PAS des filtres d'affichage. Ils
   * changent la requête envoyée au backend, qui renvoie alors un trajet d'une
   * seule pièce — sans arrêt, sans correspondance. Une nouvelle recherche est
   * donc nécessaire à chaque changement, comme pour le départ ou l'arrivée.
   */
  const [modeVoyage, setModeVoyage] = useState<ModeVoyage>("TRANSIT");

  const [selection, setSelection] = useState<ItineraryCriterion | null>(null);
  const [recherche, setRecherche] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  /// Enregistrements, indexés de la même façon (étape 5A-7).
  const [enregistrements, setEnregistrements] = useState<
    Partial<Record<ItineraryCriterion, EtatEnregistrement>>
  >({});

  /**
   * Arrêts EFFECTIVEMENT utilisés par la dernière recherche.
   *
   * Distincts de `depart`/`arrivee`, qui suivent les listes déroulantes :
   * l'usager peut changer un choix sans relancer la recherche. Enregistrer
   * avec les valeurs courantes attribuerait alors au trajet une origine qui
   * n'est pas la sienne.
   */
  const [pointsRecherches, setPointsRecherches] = useState<{
    origine: Coordonnees;
    destination: Coordonnees;
  } | null>(null);

  const { statut: statutAuth, jeton } = useAuth();

  useEffect(() => {
    // Aucun jeton : rien à demander. Un visiteur ne déclenche donc AUCUN
    // appel supplémentaire sur cette page publique.
    if (!jeton) {
      setAdressesFav([]);
      return;
    }

    const controleur = new AbortController();

    listerAdresses(jeton, controleur.signal)
      .then(setAdressesFav)
      .catch(() => {
        // ÉCHEC SILENCIEUX, et c'est délibéré : les adresses favorites sont
        // un RACCOURCI. Leur absence n'empêche ni de chercher un itinéraire,
        // ni de choisir un arrêt. Afficher une erreur en tête d'une page
        // publique pour un confort indisponible serait disproportionné.
        setAdressesFav([]);
      });

    return () => {
      controleur.abort();
    };
  }, [jeton]);

  // --- Données géographiques (bloc 5B, refondu Phase 4) ---------------------
  //
  // ⚠️ PLUS AUCUNE RÉSOLUTION D'IDENTIFIANT. Chaque segment porte désormais
  // les NOMS, les COORDONNÉES et le TRACÉ RÉEL de ses deux arrêts. La carte
  // n'a donc plus besoin ni de la liste des arrêts, ni d'un index — et
  // surtout, plus besoin de charger le réseau entier pour dessiner un trajet.

  // Dérivée, jamais stockée : un état « sélection » et un état « résultats »
  // qui se contrediraient laisseraient la carte afficher un trajet absent de
  // la liste.
  /**
   * Les itinéraires réellement affichés, après filtrage par mode.
   *
   * ⚠️ UN ITINÉRAIRE EST ÉCARTÉ DÈS QU'IL EMPRUNTE UN MODE EXCLU — et non
   * seulement s'il n'emprunte QUE des modes exclus. Quelqu'un qui refuse le bus
   * refuse un trajet qui en comporte, même partiellement.
   *
   * ⚠️ LA MARCHE NE FAIT JAMAIS ÉCARTER. Tout itinéraire de transport en
   * comporte — rejoindre l'arrêt, en sortir — et l'exclure viderait la liste
   * quoi qu'on choisisse.
   */
  const resultatsAffiches = useMemo(() => {
    if (!resultats || modesExclus.size === 0) {
      return resultats;
    }

    return resultats.filter((itineraire) =>
      itineraire.segments.every(
        (segment) =>
          segment.mode === "WALK" || !modesExclus.has(segment.mode),
      ),
    );
  }, [resultats, modesExclus]);

  const selectionne =
    resultatsAffiches?.find((itineraire) => itineraire.criterion === selection) ??
    resultatsAffiches?.[0] ??
    null;

  // Les repères DU TRAJET : le départ demandé, les arrêts traversés, la
  // destination demandée. ⚠️ LES DEUX BOUTS SONT DES POINTS DEMANDÉS, pas des
  // arrêts — un trajet entièrement à pied n'en traverse aucun, et n'aurait
  // sinon rien du tout à montrer sur la carte.
  const trace = useMemo(
    () =>
      selectionne
        ? pointsDuTrajet(
            selectionne,
            pointsRecherches
              ? { label: depart?.label ?? "Départ", ...pointsRecherches.origine }
              : null,
            pointsRecherches
              ? {
                  label: arrivee?.label ?? "Arrivée",
                  ...pointsRecherches.destination,
                }
              : null,
          )
        : null,
    [selectionne, pointsRecherches, depart?.label, arrivee?.label],
  );

  // Le tracé RÉEL, un tronçon par segment, coloré par mode — MARCHE COMPRISE.
  // Les tronçons dépourvus de géométrie sont marqués `STRAIGHT`, la marche
  // `WALK_ESTIMATE`, et tous deux sont dessinés en pointillés : une droite ne
  // doit jamais passer pour le chemin réel.
  const troncons = useMemo(
    () => (selectionne ? tronconsDuTrajet(selectionne) : null),
    [selectionne],
  );

  /**
   * Ce que la carte dessine en fond.
   *
   * Les arrêts du TRAJET quand il y en a un — ils sont alors mis en avant et
   * le reste du réseau n'apporterait que du bruit. Sinon les arrêts alentour,
   * pour que la carte montre quelque chose et reste cliquable dès l'arrivée
   * sur la page.
   */
  const pointsCarte = useMemo(
    () => trace ?? (arrets ?? []).map(pointDepuisArret),
    [trace, arrets],
  );

  /**
   * L'usager a cliqué sur un arrêt de la carte.
   *
   * ⚠️ CE POINT VAUT EXACTEMENT COMME UNE ADRESSE SAISIE : il porte un
   * libellé et des coordonnées RÉELLES, et il remplit le champ correspondant.
   * Il n'existe donc aucun chemin où la carte imposerait un départ que le
   * formulaire ne montrerait pas.
   */
  const choisirDepuisLaCarte = (point: PointCarte, role: RoleArret) => {
    const choisi = {
      label: point.nom,
      latitude: point.latitude,
      longitude: point.longitude,
      origine: "arret" as const,
    };

    if (role === "depart") {
      poserDepart(choisi);
    } else {
      setArrivee(choisi);
    }
  };

  /**
   * Demande la position, et NE LA DEMANDE QU'À CE MOMENT.
   *
   * Déclenchée par le choix explicite de « Ma position » dans la liste, jamais
   * au chargement de la page : une invite de permission qui surgit sans geste
   * de l'usager est une invite qu'on refuse par réflexe.
   */
  const utiliserMaPosition = () => {
    setPosition({ statut: "localisation" });

    // ⚠️ `getCurrentPosition`, JAMAIS `watchPosition` : on demande la position
    // UNE fois, pour remplir un champ. Un suivi continu appartient à une
    // fonctionnalité de guidage, qui n'existe pas encore.
    positionActuelle()
      .then((coordonnees) => {
        setPosition({ statut: "ok", coordonnees });
        setDepart({
          label: "Ma position actuelle",
          latitude: coordonnees.latitude,
          longitude: coordonnees.longitude,
          origine: "position",
        });
      })
      .catch((echec: unknown) => {
        // La position échoue : le départ reste vide plutôt que de garder des
        // coordonnées périmées d'une tentative précédente.
        setDepart(null);
        setPosition({
          statut: "echec",
          message:
            echec instanceof ErreurGeolocalisation
              ? echec.message
              : "Votre position n'a pas pu être déterminée.",
        });
      });
  };

  /**
   * Pose le point de départ ET oublie la position si elle n'est plus la
   * source (bloc 5D, minimisation).
   *
   * ⚠️ Choisir une adresse ou un favori après avoir utilisé « Ma position »
   * doit EFFACER la position mémorisée : la garder conserverait une donnée de
   * géolocalisation dont plus rien n'a besoin. C'est une exigence de 5D que
   * la refonte du champ ne doit pas emporter.
   */
  const poserDepart = (point: PointChoisi | null) => {
    setDepart(point);

    if (point?.origine !== "position") {
      setPosition({ statut: "repos" });
    }
  };

  /// Remplit un champ depuis une adresse favorite — SANS géocodage : le
  /// favori porte déjà ses coordonnées, les redemander serait un appel réseau
  /// pour réapprendre ce qu'on sait.
  const choisirFavori = (poser: (point: PointChoisi) => void, adresse: FavoriteAddress) =>
    poser({
      label: adresse.address,
      latitude: adresse.latitude,
      longitude: adresse.longitude,
      origine: "favori",
    });

  const { t } = useTraduction();
  const routeur = useRouter();

  const idDepart = useId();
  const idArrivee = useId();
  const idErreur = useId();

  // --- Chargement des arrêts ------------------------------------------------
  useEffect(() => {
    let abandonne = false;

    // ⚠️ LES ARRÊTS AUTOUR DU CENTRE, PAS LE RÉSEAU (Phase 4).
    //
    // `GET /api/stops` est borné : on demande le VOISINAGE de ce que la carte
    // montre. Se déplacer recharge donc la liste, et le sélecteur replié comme
    // la carte affichent les mêmes arrêts — ceux qui sont sous les yeux.
    //
    // Le délai évite qu'un glissement continu ne produise une rafale de
    // requêtes dont les réponses arriveraient dans le désordre.
    const minuterie = setTimeout(() => {
      listerArrets({
        lat: centreCarte.latitude,
        lon: centreCarte.longitude,
        radiusM: RAYON_CARTE_M,
        limit: 200,
      })
        .then((page) => {
          if (abandonne) return;
          setArrets(page.items);
          setErreurArrets(null);
        })
        .catch((echec: unknown) => {
          if (abandonne) return;
          setErreurArrets(messageDErreur(echec));
        });
    }, DELAI_RECHARGEMENT_MS);

    return () => {
      abandonne = true;
      clearTimeout(minuterie);
    };
  }, [centreCarte]);

  // --- Stations Vélib', autour du centre de la carte (Phase 5) --------------
  //
  // ⚠️ MÊME DÉLAI QUE LES ARRÊTS, et pour la même raison : un glissement
  // continu déclencherait sinon une requête par relâchement.
  useEffect(() => {
    if (!velibVisible) {
      setVelib({ statut: "masque" });
      return;
    }

    let abandonne = false;
    const controleur = new AbortController();

    setVelib({ statut: "chargement" });

    const minuterie = setTimeout(() => {
      velibProches(
        centreCarte.latitude,
        centreCarte.longitude,
        { radiusM: RAYON_VELIB_M, limit: 300 },
        controleur.signal,
      )
        .then((reponse) => {
          if (abandonne) return;
          setVelib({
            statut: "ok",
            stations: reponse.stations,
            luA: reponse.fetchedAt,
            attribution: reponse.attribution,
          });
        })
        .catch((echec: unknown) => {
          // Une requête annulée n'est pas un échec : l'usager a simplement
          // déplacé la carte avant la fin.
          if (abandonne || controleur.signal.aborted) return;
          setVelib({ statut: "echec", message: messageDErreur(echec) });
        });
    }, DELAI_RECHARGEMENT_MS);

    return () => {
      abandonne = true;
      controleur.abort();
      clearTimeout(minuterie);
    };
  }, [velibVisible, centreCarte]);

  // ⚠️ IL N'Y A PLUS D'APPEL CARBONE ICI (Phase 4).
  //
  // L'écran faisait un `POST /api/carbone` par itinéraire, APRÈS la recherche.
  // Le backend fait désormais ce calcul lui-même et rend l'empreinte AVEC
  // chaque itinéraire : un aller-retour de moins, et surtout plus aucun risque
  // d'attribuer une estimation au mauvais trajet.
  //
  // La garantie qui comptait est préservée, et elle l'est mieux : quand le
  // microservice est en panne, le backend rend `carbon.status =
  // CARBON_UNAVAILABLE` avec des champs à `null` — l'itinéraire, lui, arrive
  // intact.

  /**
   * Ouvre le détail d'un itinéraire.
   *
   * ⚠️ L'ITINÉRAIRE EST MÉMORISÉ AVANT LA NAVIGATION, jamais mis dans l'URL :
   * un trajet réel pèse plusieurs kilo-octets une fois sa géométrie incluse.
   * Voir `lib/itineraire-selection.ts` pour le raisonnement complet.
   *
   * ⚠️ ON NAVIGUE MÊME SI LA MÉMORISATION ÉCHOUE. `sessionStorage` peut être
   * indisponible ; l'écran suivant dira alors franchement qu'il n'a rien
   * trouvé, ce qui vaut mieux qu'un bouton qui ne fait rien (§45).
   */
  const voirLeTrajet = (itineraire: Itinerary) => {
    if (pointsRecherches) {
      memoriserSelection({
        itineraire,
        origine: {
          label: depart?.label ?? "Départ",
          latitude: pointsRecherches.origine.latitude,
          longitude: pointsRecherches.origine.longitude,
        },
        destination: {
          label: arrivee?.label ?? "Arrivée",
          latitude: pointsRecherches.destination.latitude,
          longitude: pointsRecherches.destination.longitude,
        },
        choisiA: new Date().toISOString(),
      });
    }

    routeur.push("/itineraire");
  };

  const soumettre = async (evenement: FormEvent) => {
    evenement.preventDefault();

    // L'origine est SOIT un arrêt choisi, SOIT la position de l'usager. Dans
    // les deux cas, seules des coordonnées partent au backend : le contrat de
    // `POST /api/routes/search` n'a jamais accepté autre chose.
    // Phase 3A : plus aucune résolution ici. Chaque champ ne peut contenir
    // qu'un point DÉJÀ résolu — adresse choisie, favori, ou position — et
    // porte ses propres coordonnées. Une inversion départ / arrivée est donc
    // structurellement impossible : ce sont deux états distincts.
    const origine: Coordonnees | undefined = depart ?? undefined;
    const destination: Coordonnees | undefined = arrivee ?? undefined;

    if (!origine || !destination) {
      return;
    }

    setErreur(null);
    setRecherche(true);
    // Les enregistrements précédents n'ont plus d'objet : les conserver
    // afficherait un « Trajet enregistré » de l'ancienne recherche sous les
    // nouveaux itinéraires.
    setEnregistrements({});

    try {
      // Le backend attend des COORDONNÉES : il cherche lui-même l'arrêt le
      // plus proche de chaque point. On lui transmet donc celles des arrêts
      // choisis, jamais leur identifiant — que le contrat ne prévoit pas.
      const trouves = await rechercherItineraires({
        fromLat: origine.latitude,
        fromLon: origine.longitude,
        toLat: destination.latitude,
        toLon: destination.longitude,
        // ⚠️ `mode` N'EST TRANSMIS QUE S'IL DIFFÈRE DU DÉFAUT. `TRANSIT` est la
        // valeur par défaut du contrat : l'envoyer explicitement n'ajoute
        // rien et alourdirait chaque requête pour rien.
        ...(modeVoyage === "TRANSIT" ? {} : { mode: modeVoyage }),
      });

      // Les deux vont ENSEMBLE : les résultats et les points qui les ont
      // produits. C'est ce couple qui sera enregistré.
      setPointsRecherches({ origine, destination });
      setResultats(trouves);
      // La sélection repart de zéro : garder « LOWEST_CO2 » d'une recherche
      // précédente mettrait en avant un critère que la nouvelle réponse ne
      // contient peut-être pas — deux critères désignant souvent le même
      // trajet, le backend n'en rend qu'un.
      setSelection(null);
    } catch (echec) {
      setErreur(messageDErreur(echec));
      // Les anciens résultats sont effacés : les laisser à l'écran sous un
      // message d'erreur laisserait croire qu'ils correspondent à la
      // dernière recherche.
      setResultats(null);
      setPointsRecherches(null);
    } finally {
      setRecherche(false);
    }
  };

  /**
   * Enregistre UN itinéraire désigné (étape 5A-7).
   *
   * L'itinéraire est passé en argument, jamais lu depuis un état « sélection
   * courante » : c'est ce qui rend structurellement impossible d'envoyer les
   * segments d'une proposition sous le critère d'une autre.
   */
  const enregistrer = async (itineraire: Itinerary) => {
    if (!jeton || !pointsRecherches) {
      return;
    }

    const critere = itineraire.criterion;

    setEnregistrements((precedent) => ({
      ...precedent,
      [critere]: { statut: "envoi" },
    }));

    try {
      await enregistrerItineraire(
        // La transformation vit dans la couche API : la page ne fabrique
        // aucun corps de requête à la main.
        versRequeteEnregistrement(
          itineraire.segments,
          pointsRecherches.origine,
          pointsRecherches.destination,
        ),
        jeton,
      );

      // « Enregistré » N'EST ANNONCÉ QU'APRÈS la réponse du serveur.
      setEnregistrements((precedent) => ({
        ...precedent,
        [critere]: { statut: "enregistre" },
      }));
    } catch (echec) {
      setEnregistrements((precedent) => ({
        ...precedent,
        [critere]: { statut: "echec", message: messageDErreur(echec) },
      }));
    }
  };

  // VALIDATION MINIMALE, et uniquement ce qui est évident : deux arrêts
  // choisis, et deux arrêts DIFFÉRENTS. Le backend reste l'autorité — il
  // rendrait d'ailleurs une liste vide pour deux points identiques, mais
  // faire un aller-retour réseau pour l'apprendre serait discourtois.
  const memeArret =
    depart !== null &&
    arrivee !== null &&
    depart.latitude === arrivee.latitude &&
    depart.longitude === arrivee.longitude;

  // Chercher avec « Ma position » exige que la position soit RÉELLEMENT
  // arrivée : partir pendant la localisation enverrait des coordonnées
  // absentes, et le backend répondrait 400.
  // ⚠️ On exige des POINTS, pas des champs remplis. Un texte saisi sans
  // proposition choisie ne vaut rien : il n'a aucune coordonnée, et le
  // bouton doit rester inactif tant que l'usager n'a pas tranché.
  const peutChercher = depart !== null && arrivee !== null && !memeArret;

  return (
    <Container>
      <section className="py-10 sm:py-14">
        <h1 className="text-ink text-2xl font-semibold tracking-tight sm:text-3xl">
          {t.rechercheTitre}
        </h1>
        <p className="mt-3 max-w-2xl text-neutral-700">{t.rechercheIntro}</p>

        {/* Le territoire est NOMMÉ, jamais supposé. Un usager doit savoir quel
            réseau l'application connaît avant de s'étonner qu'une adresse
            lointaine ne rende rien. */}
        {zone && (
          <p className="mt-1 text-sm text-neutral-600">
            <span aria-hidden="true">📍</span> {zone.displayName}
          </p>
        )}

        <div className="mt-8 space-y-8">
          {erreurArrets ? (
            <ErrorMessage title="Le réseau n'a pas pu être chargé">{erreurArrets}</ErrorMessage>
          ) : !arrets ? (
            <Spinner label="Chargement des arrêts…" />
          ) : (
            <Card>
              <form onSubmit={soumettre} noValidate className="space-y-5">
                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <ChampAdresse
                      libelle={t.depart}
                      placeholder={t.departPlaceholder}
                      valeur={depart}
                      onChoisir={poserDepart}
                      actions={
                        <>
                          {/* Options SECONDAIRES : la saisie libre est
                              l'expérience principale, mais rien de ce qui
                              existait n'a disparu. */}
                          <BoutonSecondaire onClick={utiliserMaPosition}>
                            {t.maPosition}
                          </BoutonSecondaire>
                          {adressesFav.map((favori) => (
                            <BoutonSecondaire
                              key={favori.id}
                              onClick={() => choisirFavori(poserDepart, favori)}
                            >
                              {LIBELLES_ADRESSES[favori.type]}
                            </BoutonSecondaire>
                          ))}
                        </>
                      }
                    />
                    <EtatDeLaPosition etat={position} onReessayer={utiliserMaPosition} />
                  </div>

                  <ChampAdresse
                    libelle={t.arrivee}
                    placeholder={t.arriveePlaceholder}
                    valeur={arrivee}
                    onChoisir={setArrivee}
                    actions={adressesFav.map((favori) => (
                      <BoutonSecondaire
                        key={favori.id}
                        onClick={() => choisirFavori(setArrivee, favori)}
                      >
                        {LIBELLES_ADRESSES[favori.type]}
                      </BoutonSecondaire>
                    ))}
                  />
                </div>

                <SelecteurModeVoyage
                  valeur={modeVoyage}
                  onChanger={setModeVoyage}
                  veloDisponible={
                    capacitesInstallation?.bikeRouting.status === "CONFIGURED"
                  }
                />

                {/* Les arrêts du réseau restent accessibles, en RETRAIT : le
                    réseau réel en compte 1 383, et une liste de cette taille
                    ne peut pas être l'entrée principale. Repliée par défaut,
                    elle ne coûte rien à qui ne l'ouvre pas. */}
                {arrets.length > 0 && (
                  <details className="rounded-md border border-neutral-200 px-3 py-2">
                    <summary className="cursor-pointer text-sm text-neutral-700">
                      Choisir directement un arrêt du réseau
                    </summary>
                    {/* ⚠️ CE N'EST PLUS TOUT LE RÉSEAU (Phase 4). `GET
                        /api/stops` est borné : cette liste montre les arrêts
                        du VOISINAGE de la carte, les mêmes que ceux qu'elle
                        dessine. Déplacer la carte la met à jour. */}
                    <p className="mt-2 text-xs text-neutral-600">
                      Les {arrets.length} arrêts affichés sur la carte, du plus proche de son
                      centre au plus éloigné. Déplacez la carte pour en voir d&apos;autres.
                    </p>
                    <div className="mt-3 grid gap-4 sm:grid-cols-2">
                      <ChoixArret
                        id={idDepart}
                        libelle="Arrêt de départ"
                        valeur=""
                        arrets={arrets}
                        onChange={(id) => poserDepart(depuisArret(arrets, id))}
                      />
                      <ChoixArret
                        id={idArrivee}
                        libelle="Arrêt d'arrivée"
                        valeur=""
                        arrets={arrets}
                        onChange={(id) => setArrivee(depuisArret(arrets, id))}
                      />
                    </div>
                  </details>
                )}

                {/* Message lié aux DEUX champs par `aria-describedby` : un
                    lecteur d'écran l'annonce en atteignant l'un ou l'autre. */}
                {memeArret && (
                  <p id={idErreur} role="alert" className="text-sm text-red-800">
                    {t.memePoint}
                  </p>
                )}

                <Button
                  type="submit"
                  // Désactivé pendant l'envoi : sans cela, un double clic
                  // lancerait deux recherches concurrentes, et la plus lente
                  // écraserait la plus rapide.
                  disabled={!peutChercher || recherche}
                  className="w-full sm:w-auto"
                >
                  {recherche ? t.rechercheEnCours : t.rechercher}
                </Button>
              </form>
            </Card>
          )}

          {/* La carte vient APRÈS le formulaire et AVANT les résultats :
              elle situe le réseau avant toute recherche, puis le trajet
              retenu. Elle reste un complément — les étapes détaillées, en
              dessous, se lisent sans elle. */}
          <div className="space-y-3">
            <CoucheVelib
              visible={velibVisible}
              onBasculer={() => setVelibVisible((actuel) => !actuel)}
              etat={velib}
            />

            <Carte
              titre={
                selectionne ? "Le trajet retenu sur la carte" : "Les arrêts autour de vous"
              }
              description={descriptionCarte(selectionne, troncons, pointsCarte.length, t)}
              arrets={pointsCarte}
              trace={trace}
              troncons={troncons}
              onChoisirArret={choisirDepuisLaCarte}
              onCentreDeplace={surCentreDeplace}
              velib={velib.statut === "ok" ? velib.stations : null}
              centre={centreDuTerritoire}
              // ⚠️ LE POINT BLEU APPARAÎT DÈS QUE LA POSITION EST CONNUE, et
              // pas seulement en navigation : « Ma position » demandait la
              // permission, remplissait le champ… et ne montrait rien sur la
              // carte. L'usager ne pouvait pas vérifier que le point retenu
              // était le bon.
              //
              // `accuracyM` vient de l'appareil : un halo de précision est
              // dessiné quand il l'annonce, aucun halo quand il ne le donne
              // pas (`null`) — jamais un cercle inventé.
              position={
                position.statut === "ok"
                  ? {
                      latitude: position.coordonnees.latitude,
                      longitude: position.coordonnees.longitude,
                      accuracyM: position.coordonnees.accuracyM ?? null,
                    }
                  : null
              }
            />
          </div>

          {resultats !== null && (
            <FiltresModes
              disponibles={modesReseau}
              capacites={capacitesInstallation}
              exclus={modesExclus}
              onBasculer={(mode) =>
                setModesExclus((actuels) => {
                  const suivants = new Set(actuels);

                  if (suivants.has(mode)) {
                    suivants.delete(mode);
                  } else {
                    suivants.add(mode);
                  }

                  return suivants;
                })
              }
            />
          )}

          <Resultats
            resultats={resultatsAffiches}
            filtreActif={modesExclus.size > 0}
            selection={selectionne?.criterion ?? null}
            onSelectionner={setSelection}
            recherche={recherche}
            erreur={erreur}
            enregistrements={enregistrements}
            peutEnregistrer={statutAuth === "authentifie"}
            onEnregistrer={enregistrer}
            onVoirLeTrajet={voirLeTrajet}
          />
        </div>
      </section>
    </Container>
  );
}

// ---------------------------------------------------------------------------
// Couche Vélib' (Phase 5)
// ---------------------------------------------------------------------------

/**
 * Interrupteur de la couche Vélib', et son état.
 *
 * ⚠️ QUATRE ÉTATS, JAMAIS CONFONDUS. « masqué », « en cours », « affiché » et
 * « indisponible » appellent quatre réponses différentes de l'usager. Les
 * fondre en un seul booléen laisserait quelqu'un devant une carte sans
 * stations sans savoir s'il doit attendre, réessayer, ou conclure qu'il n'y en
 * a aucune.
 *
 * ⚠️ AUCUNE STATION INVENTÉE en cas de panne : on le dit, et la couche reste
 * vide.
 */
function CoucheVelib({
  visible,
  onBasculer,
  etat,
}: {
  visible: boolean;
  onBasculer: () => void;
  etat:
    | { statut: "masque" }
    | { statut: "chargement" }
    | { statut: "ok"; stations: VelibStation[]; luA: string; attribution: string }
    | { statut: "echec"; message: string };
}) {
  const { t } = useTraduction();

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {/* `aria-pressed` : c'est un INTERRUPTEUR, pas une navigation. Un
          lecteur d'écran annonce donc « activé » — l'information ne repose pas
          seulement sur la couleur du bouton. */}
      <button
        type="button"
        aria-pressed={visible}
        onClick={onBasculer}
        className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
          visible
            ? "border-eco bg-eco text-white"
            : "text-ink border-neutral-300 bg-white hover:bg-neutral-50"
        }`}
      >
        <span aria-hidden="true">🚲</span> {t.stationsVelib}
      </button>

      {/* `role="status"` : le résultat arrive de façon asynchrone après un
          geste de l'usager. Sans zone d'état, un lecteur d'écran ne saurait
          jamais que les stations sont arrivées — ni qu'elles manquent. */}
      <p role="status" className="text-sm text-neutral-700">
        {etat.statut === "chargement" && t.velibChargement}

        {etat.statut === "ok" &&
          (etat.stations.length === 0
            ? t.velibAucune
            : `${etat.stations.length} station${
                etat.stations.length > 1 ? "s" : ""
              } · relevé lu à ${new Date(etat.luA).toLocaleTimeString("fr-FR", {
                hour: "2-digit",
                minute: "2-digit",
              })}`)}

        {etat.statut === "echec" && (
          <>
            <span className="font-medium">{t.velibIndisponible}</span> {etat.message}
          </>
        )}
      </p>

      {/* Attribution imposée par la licence du fournisseur. */}
      {etat.statut === "ok" && etat.stations.length > 0 && (
        <p className="w-full text-xs text-neutral-500">{etat.attribution}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Choix d'un arrêt
// ---------------------------------------------------------------------------

/**
 * Une liste déroulante d'arrêts.
 *
 * POURQUOI PAS UN CHAMP DE SAISIE LIBRE. Le backend n'expose aucune
 * recherche d'arrêt par nom, et aucun géocodage : rien ne transforme
 * « Châtelet » en coordonnées. Une liste est donc la seule façon d'obtenir
 * des coordonnées valides sans inventer un contrat.
 *
 * Un vrai `<select>` — et non une liste bricolée en `<div>` : il est
 * navigable au clavier, utilisable au lecteur d'écran, et un téléphone
 * l'affiche avec son sélecteur natif.
 */
function ChoixArret({
  id,
  libelle,
  valeur,
  arrets,
  onChange,
  decritPar,
  optionPosition = false,
  adresses = [],
}: {
  id: string;
  libelle: string;
  valeur: string;
  arrets: Stop[];
  onChange: (valeur: string) => void;
  decritPar?: string;
  /** Propose « Ma position » en tête de liste (bloc 5D-1, départ seulement). */
  optionPosition?: boolean;
  /**
   * Adresses favorites de l'usager connecté (bloc 7-8).
   *
   * Proposées aux DEUX champs : on part de chez soi le matin, on y rentre le
   * soir. N'en offrir qu'au départ obligerait à ressaisir le retour.
   */
  adresses?: FavoriteAddress[];
}) {
  return (
    <div>
      <label htmlFor={id} className="text-ink block text-sm font-medium">
        {libelle}
      </label>
      <select
        id={id}
        value={valeur}
        onChange={(e) => onChange(e.target.value)}
        required
        aria-describedby={decritPar}
        className="focus:border-brand mt-1.5 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-base outline-none"
      >
        <option value="">Choisir un arrêt…</option>
        {optionPosition && (
          // EN TÊTE DE LISTE : c'est le choix le plus courant depuis un
          // téléphone, et le plus coûteux à atteindre s'il est enterré sous
          // des milliers d'arrêts.
          <option value={POSITION}>Ma position actuelle</option>
        )}
        {adresses.length > 0 && (
          // `<optgroup>` : un lecteur d'écran annonce le nom du groupe avant
          // chaque option, si bien que « Domicile » ne se confond pas avec un
          // arrêt qui porterait le même nom.
          <optgroup label="Mes adresses favorites">
            {adresses.map((adresse) => (
              <option key={adresse.id} value={`${PREFIXE_ADRESSE}${adresse.id}`}>
                {LIBELLES_ADRESSES[adresse.type]} — {adresse.address}
              </option>
            ))}
          </optgroup>
        )}
        {arrets.map((arret) => (
          <option key={arret.id} value={arret.id}>
            {arret.name}
            {/* L'accessibilité PMR est une donnée réelle du modèle : elle
                intéresse directement une partie des usagers. */}
            {arret.pmrAccessible ? " ♿" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Résultats
// ---------------------------------------------------------------------------

function Resultats({
  resultats,
  filtreActif,
  recherche,
  erreur,
  enregistrements,
  peutEnregistrer,
  onEnregistrer,
  onVoirLeTrajet,
  selection,
  onSelectionner,
}: {
  resultats: Itinerary[] | null;
  /** Vrai si l'usager a écarté au moins un mode. */
  filtreActif: boolean;
  recherche: boolean;
  erreur: string | null;
  enregistrements: Partial<Record<ItineraryCriterion, EtatEnregistrement>>;
  peutEnregistrer: boolean;
  onEnregistrer: (itineraire: Itinerary) => void;
  onVoirLeTrajet: (itineraire: Itinerary) => void;
  selection: ItineraryCriterion | null;
  onSelectionner: (critere: ItineraryCriterion) => void;
}) {
  const { t } = useTraduction();

  if (recherche) {
    return <Spinner label={t.rechercheIndicateur} />;
  }

  if (erreur) {
    return <ErrorMessage title="La recherche a échoué">{erreur}</ErrorMessage>;
  }

  // `null` = aucune recherche n'a encore été lancée. À distinguer d'un
  // tableau vide, qui signifie « cherché, rien trouvé ».
  if (resultats === null) {
    return null;
  }

  if (resultats.length === 0) {
    // ⚠️ DEUX VIDES DIFFÉRENTS, DEUX MESSAGES DIFFÉRENTS. « Le réseau n'offre
    // rien » et « vos filtres ont tout masqué » appellent deux gestes
    // opposés : reformuler la recherche, ou réactiver un mode. Les confondre
    // ferait chercher un trajet qui existe déjà.
    return (
      <EmptyState
        title={t.aucunItineraire}
        description={
          filtreActif ? t.aucunItineraireApresFiltre : t.aucunItineraireDetail
        }
      />
    );
  }

  return (
    <section aria-labelledby="resultats">
      <h2 id="resultats" className="text-ink text-lg font-semibold">
        {resultats.length === 1
          ? "1 itinéraire proposé"
          : `${resultats.length} itinéraires proposés`}
      </h2>

      {/* ⚠️ `uf-cascade` DÉCALE L'APPARITION DES TROIS CARTES de 60 ms. Trois
          cartes qui apparaissent exactement ensemble se lisent comme un seul
          bloc ; décalées, l'œil les compte. C'est une aide à la lecture, pas
          un effet.

          Les deux classes sont définies dans `globals.css`, sans aucune
          bibliothèque, et sont neutralisées par `prefers-reduced-motion`. */}
      <ul className="uf-cascade mt-4 space-y-4">
        {resultats.map((itineraire) => (
          <li key={itineraire.criterion} className="uf-apparait">
            <ItineraireCarte
              itineraire={itineraire}
              // La référence de comparaison est TOUJOURS le plus rapide :
              // c'est par rapport à lui qu'on annonce « +3 min, −5 g ».
              reference={resultats[0]}
              // Chaque carte reçoit SON enregistrement, désigné par son
              // propre critère : aucune ne peut afficher celui d'une autre.
              enregistrement={enregistrements[itineraire.criterion]}
              peutEnregistrer={peutEnregistrer}
              onEnregistrer={onEnregistrer}
              onVoirLeTrajet={onVoirLeTrajet}
              // Un seul itinéraire porte la carte à la fois : la comparaison
              // n'aurait plus de sens si les deux tracés se superposaient.
              selectionne={itineraire.criterion === selection}
              onSelectionner={onSelectionner}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Libellés des trois critères produits par le backend.
 *
 * ⚠️ LES TROIS NE SONT PAS TOUJOURS PRÉSENTS. Deux critères désignant le même
 * trajet, le backend ne le rend qu'une fois — sous le premier de cette liste.
 * L'interface n'affiche donc que ce qu'elle reçoit.
 */
const criteres = (t: Textes): Record<ItineraryCriterion, string> => ({
  FASTEST: t.critereFastest,
  SHORTEST: t.critereShortest,
  FEWEST_TRANSFERS: t.critereFewestTransfers,
  LOWEST_CO2: t.critereLowestCo2,
});

/// Ce que chaque critère promet, en une phrase.
const explications = (t: Textes): Record<ItineraryCriterion, string> => ({
  FASTEST: t.explicationFastest,
  SHORTEST: t.explicationShortest,
  FEWEST_TRANSFERS: t.explicationFewestTransfers,
  LOWEST_CO2: t.explicationLowestCo2,
});

/**
 * L'heure d'arrivée réelle, attente comprise — ou la raison de son absence.
 *
 * ═══ CE QUE CE BLOC A REMPLACÉ ═══
 *
 * Une phrase fixe : « la durée n'inclut pas le temps d'attente ». Elle était
 * honnête et impuissante — elle nommait un manque sans le combler, et
 * laissait l'usager faire le calcul lui-même sans lui en donner les moyens.
 *
 * Depuis l'import du calendrier GTFS, l'attente est CONNUE : le backend
 * cherche le prochain passage de chaque ligne empruntée et fait courir une
 * horloge le long du trajet. La phrase d'excuse ne subsiste donc que dans les
 * deux cas où elle reste vraie.
 *
 * ═══ LES TROIS CAS, ET TROIS PHRASES DIFFÉRENTES ═══
 *
 *   `SCHEDULE_AVAILABLE`    → l'heure d'arrivée, et l'attente qu'elle inclut
 *   `SCHEDULE_UNKNOWN`      → ces lignes ne passent pas dans la fenêtre
 *   `SCHEDULE_UNAVAILABLE`  → ce réseau n'a pas d'horaires importés
 *
 * ⚠️ LES CONFONDRE SERAIT UN MENSONGE PAR IMPRÉCISION. « Pas de passage
 * aujourd'hui » et « nous ne connaissons pas les horaires » appellent deux
 * décisions opposées de la part de quelqu'un qui s'apprête à partir.
 */
function Horaires({ itineraire }: { itineraire: Itinerary }) {
  const { t } = useTraduction();
  const horaire = itineraire.schedule;

  // Un itinéraire relu depuis l'historique n'a pas d'horaires : il décrit un
  // trajet passé, dont l'attente n'a plus de sens.
  if (!horaire) {
    return null;
  }

  if (horaire.status === "SCHEDULE_AVAILABLE" && horaire.arrivalAt) {
    const attente = horaire.totalWaitMin;

    return (
      <p className="mt-2 flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="text-neutral-600">{t.arriveePrevue}</span>
        {/* ⚠️ L'HEURE D'ARRIVÉE EST LA SEULE VALEUR QUI RÉPOND À LA QUESTION
            POSÉE. `totalDurationMin`, affiché plus haut, ne compte que le
            temps de parcours : lire « 12 min » et arriver 25 minutes plus
            tard n'est pas être mal informé, c'est être trompé. D'où le poids
            typographique, égal à celui de la durée. */}
        <span className="text-ink font-semibold">
          {formaterHeure(horaire.arrivalAt)}
        </span>
        <span className="text-xs text-neutral-500">
          {attente === null || attente === 0
            ? t.attenteSansAttente
            : t.attenteTotale.replace("{n}", String(attente))}
        </span>
      </p>
    );
  }

  return (
    <p className="mt-2 text-xs text-neutral-500">
      {horaire.status === "SCHEDULE_UNAVAILABLE"
        ? t.horaireNonImporte
        : t.horaireIndisponible}
    </p>
  );
}

function ItineraireCarte({
  itineraire,
  reference,
  enregistrement,
  peutEnregistrer,
  onEnregistrer,
  onVoirLeTrajet,
  selectionne,
  onSelectionner,
}: {
  itineraire: Itinerary;
  /** Itinéraire de référence — le plus rapide — pour chiffrer le compromis. */
  reference: Itinerary;
  enregistrement?: EtatEnregistrement;
  peutEnregistrer: boolean;
  onEnregistrer: (itineraire: Itinerary) => void;
  onVoirLeTrajet: (itineraire: Itinerary) => void;
  selectionne: boolean;
  onSelectionner: (critere: ItineraryCriterion) => void;
}) {
  const { t } = useTraduction();
  const CRITERES = criteres(t);
  const EXPLICATIONS = explications(t);

  // Le regroupement est une pure LECTURE des segments : aucune donnée n'est
  // inventée, seulement présentée autrement. Le détail reste accessible.
  const groupes = regrouperSegments(itineraire.segments);

  // ⚠️ UN TRAJET SANS AUCUN TRONÇON EST UN TRAJET À PIED, pas un trajet vide.
  // `resumerModes` rendrait une chaîne vide et la carte de résultat n'aurait
  // plus de titre de trajet du tout.
  const resume =
    groupes.length === 0
      ? t.itineraireToutAPied
      : resumerModes(groupes, LIBELLES_MODES);

  // ⚠️ LE NOMBRE DE CHANGEMENTS VIENT DU BACKEND, qui en est la source depuis
  // la Phase 4. Le recalculer ici ferait deux implémentations d'une même
  // règle — « la marche n'est pas une correspondance » — qui divergeraient au
  // premier changement de l'une des deux.
  const changements = itineraire.numberOfTransfers;

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* ⚠️ `text-brand` (#1E3A5F) ET NON `text-ink`. La charte réserve le
              bleu de marque à ce qui identifie — ligne, mode, critère — et
              l'encre neutre au corps de texte. Sur `#F5F5F5`, le rapport de
              contraste est de 10,5:1, soit AAA. */}
          <h3 className="text-brand text-base font-semibold">
            {CRITERES[itineraire.criterion]}
          </h3>
          {itineraire.criterion === "LOWEST_CO2" && (
            // Le badge n'apparaît QUE sur le critère écologique, et seulement
            // quand le backend l'a effectivement proposé — donc jamais sur un
            // trajet qui n'a été comparé à rien.
            <span className="bg-eco/10 text-eco rounded-full px-2.5 py-0.5 text-xs font-semibold">
              {t.badgeClimat}
            </span>
          )}
        </div>
        <p className="text-sm text-neutral-700">
          <span className="text-ink font-medium">{formaterDuree(itineraire.totalDurationMin)}</span>{" "}
          · {formaterDistance(itineraire.totalDistanceM)} ·{" "}
          {changements === 0
            ? t.sansChangement
            : `${changements} ${t.changements.toLowerCase()}`}
        </p>
      </div>

      <p className="mt-1 text-sm text-neutral-600">{EXPLICATIONS[itineraire.criterion]}</p>

      <Horaires itineraire={itineraire} />

      <Compromis itineraire={itineraire} reference={reference} />

      {/* Le résumé du trajet EN UNE LIGNE — « Marche + Métro 8 ». C'est la
          première chose qu'on lit pour comparer deux propositions, bien
          avant le détail des arrêts. */}
      <p className="text-ink mt-1 font-medium">{resume}</p>

      {/* Une liste ORDONNÉE de GROUPES : l'ordre est celui du trajet.
          Cinq tronçons sur la ligne 8 forment UNE étape lisible, pas cinq —
          et un lecteur d'écran n'entend plus cinq fois « Métro 8 ».

          ⚠️ LA MARCHE DES DEUX BOUTS ENCADRE LA LISTE. Sans elle, le trajet
          commençait à un arrêt que l'usager n'avait pas demandé, sans jamais
          dire comment l'atteindre. */}
      <ol className="mt-4 space-y-3">
        {itineraire.walkAccess && (
          <li>
            <EtapeMarche marche={itineraire.walkAccess} sens="acces" />
          </li>
        )}

        {groupes.map((groupe, index) => (
          <EtapeGroupee
            key={`${groupe.lineId}-${groupe.segments[0].fromStopId}-${index}`}
            groupe={groupe}
            rang={index + 1}
            total={groupes.length}
          />
        ))}

        {itineraire.walkEgress && (
          <li>
            <EtapeMarche marche={itineraire.walkEgress} sens="sortie" />
          </li>
        )}
      </ol>

      {/* UN VRAI BOUTON, avec `aria-pressed` : c'est un interrupteur, pas
          une navigation. Un lecteur d'écran annonce donc « activé » sur
          l'itinéraire porté par la carte — l'information ne repose pas que
          sur la couleur du tracé. */}
      <div className="mt-4 flex flex-wrap gap-3">
        <Button
          type="button"
          onClick={() => onVoirLeTrajet(itineraire)}
          // Le libellé nomme l'itinéraire : trois boutons « Voir le trajet »
          // identiques sur la même page seraient indistinguables au lecteur
          // d'écran.
          aria-label={`${t.voirLeTrajet} — ${CRITERES[itineraire.criterion]}`}
        >
          {t.voirLeTrajet}
        </Button>

        <button
          type="button"
          aria-pressed={selectionne}
          onClick={() => onSelectionner(itineraire.criterion)}
          className={`rounded-md border px-4 py-2 text-sm font-medium transition-colors ${
            selectionne
              ? "border-eco bg-eco text-white"
              : "text-ink border-neutral-300 bg-white hover:bg-neutral-50"
          }`}
        >
          {selectionne ? "Affiché sur la carte" : "Afficher sur la carte"}
        </button>
      </div>

      {/*
        L'empreinte arrive AVEC l'itinéraire depuis la Phase 4. Quand elle
        manque, c'est l'itinéraire lui-même qui le dit — et il reste affiché.
      */}
      <div className="mt-4 border-t border-neutral-200 pt-4">
        <Carbone carbone={itineraire.carbon} />
      </div>

      <div className="mt-4 border-t border-neutral-200 pt-4">
        <Enregistrement
          itineraire={itineraire}
          etat={enregistrement}
          peutEnregistrer={peutEnregistrer}
          onEnregistrer={onEnregistrer}
        />
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Empreinte carbone d'un itinéraire (étape 5A-6)
// ---------------------------------------------------------------------------

/**
 * Le compromis entre cet itinéraire et le plus rapide, en toutes lettres.
 *
 * ═══ C'EST LE CŒUR DU PRODUIT ═══
 *
 * « 3 min de plus, 5 g de CO₂ en moins » est la phrase qui permet de CHOISIR.
 * Sans elle, l'usager voit trois itinéraires et aucune raison de préférer
 * l'un à l'autre.
 *
 * ⚠️ RIEN N'EST AFFICHÉ QUAND RIEN N'EST COMPARABLE :
 *   - sur l'itinéraire de référence lui-même (se comparer à soi n'apprend
 *     rien) ;
 *   - quand l'une des deux empreintes est indisponible — un écart calculé sur
 *     une valeur manquante serait un chiffre inventé.
 */
function Compromis({
  itineraire,
  reference,
}: {
  itineraire: Itinerary;
  reference: Itinerary;
}) {
  if (itineraire.criterion === reference.criterion) {
    return null;
  }

  const minutes = itineraire.totalDurationMin - reference.totalDurationMin;
  const ici = itineraire.carbon.co2Grams;
  const la = reference.carbon.co2Grams;

  // Les deux empreintes doivent exister : sinon l'écart n'est pas calculable,
  // et l'inventer serait exactement ce que ce projet refuse.
  const grammes = ici !== null && la !== null ? ici - la : null;

  if (minutes === 0 && (grammes === null || grammes === 0)) {
    return null;
  }

  const temps =
    minutes === 0
      ? "même durée"
      : minutes > 0
        ? `${formaterDuree(minutes)} de plus`
        : `${formaterDuree(-minutes)} de moins`;

  return (
    <p className="mt-2 text-sm">
      <span className="text-neutral-700">Par rapport au plus rapide : {temps}</span>
      {grammes !== null && grammes !== 0 && (
        <>
          <span className="text-neutral-700">, </span>
          <span className={grammes < 0 ? "text-eco font-medium" : "text-neutral-700"}>
            {formaterCo2(Math.abs(grammes))} de CO₂ {grammes < 0 ? "en moins" : "en plus"}
          </span>
        </>
      )}
      <span className="text-neutral-700">.</span>
    </p>
  );
}

// ---------------------------------------------------------------------------
// Empreinte carbone d'un itinéraire
// ---------------------------------------------------------------------------

/**
 * Deux affichages pour deux situations, jamais confondues.
 *
 *   `CARBON_UNAVAILABLE` → le calcul n'a pas abouti, et on le DIT
 *   `CARBON_AVAILABLE`   → les chiffres réellement calculés
 *
 * CE QUI N'EST JAMAIS FAIT : afficher « 0 g » à la place d'une erreur. Zéro
 * est une valeur légitime — un trajet entièrement à pied émet réellement
 * zéro — et l'employer comme valeur de repli rendrait les deux cas
 * indiscernables.
 */
function Carbone({ carbone }: { carbone: ItineraryCarbon }) {
  const { t } = useTraduction();

  if (carbone.status === "CARBON_UNAVAILABLE") {
    return (
      <p className="text-sm text-neutral-700">
        {/* Ni rouge alarmant ni silence : l'itinéraire reste valable, c'est
            seulement son empreinte qui manque. Le texte porte l'information,
            pas la couleur. */}
        <span className="font-medium">{t.carboneIndisponible}</span>{" "}
        {carbone.reason ?? ""}
      </p>
    );
  }

  const { co2Grams, savedVsCarGrams, ecoScore } = carbone;

  // Le statut promet ces trois valeurs. Si l'une manquait malgré tout, mieux
  // vaut le dire que d'afficher « NaN/100 ».
  if (co2Grams === null || savedVsCarGrams === null || ecoScore === null) {
    return (
      <p className="text-sm text-neutral-700">
        <span className="font-medium">Empreinte carbone incomplète.</span> Les chiffres ne sont pas
        exploitables pour ce trajet.
      </p>
    );
  }

  return (
    <dl className="grid gap-4 sm:grid-cols-3">
      <div>
        <dt className="text-sm text-neutral-600">{t.co2Emis}</dt>
        {/* ⚠️ LE VERT ÉCO (#2D7D46) SUR TOUT CE QUI TOUCHE AU CARBONE, y
            compris les émissions elles-mêmes — pas seulement les gains. C'est
            l'identité du produit : le chiffre qui compte doit se repérer d'un
            coup d'œil. 5,08:1 sur blanc, soit AA. */}
        <dd className="text-eco mt-0.5 font-semibold">{formaterCo2(co2Grams)}</dd>
      </div>
      <div>
        <dt className="text-sm text-neutral-600">{t.co2Economise}</dt>
        <dd className="text-eco mt-0.5 font-semibold">{formaterCo2(savedVsCarGrams)}</dd>
      </div>
      <div>
        <dt className="text-sm text-neutral-600">{t.ecoScore}</dt>
        <dd className="text-eco mt-0.5 font-semibold">
          {/* Le score est calculé par le MICROSERVICE, pas ici : c'est le
              pourcentage d'émissions évitées par rapport à la voiture
              individuelle. Le recalculer côté interface cacherait une règle
              métier dans l'affichage. */}
          {Math.round(ecoScore)}/100
          <span className="sr-only">
            {" "}
            — pourcentage d&apos;émissions évitées par rapport à la voiture
          </span>
        </dd>
      </div>
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Enregistrement d'un itinéraire (étape 5A-7)
// ---------------------------------------------------------------------------

/**
 * Bouton d'enregistrement, rattaché à UN itinéraire.
 *
 * POURQUOI IL N'Y A AUCUN ÉTAT « SÉLECTION COURANTE ». Chaque carte porte son
 * propre bouton, qui rappelle SON itinéraire. Il n'existe donc aucun moment
 * où le programme doive se demander « lequel était sélectionné ? » — et donc
 * aucune façon d'envoyer les segments d'une proposition sous le critère d'une
 * autre.
 *
 * LE VISITEUR N'EST PAS BLOQUÉ : la recherche reste entière, seul
 * l'enregistrement demande un compte. On lui propose la connexion plutôt
 * qu'un bouton qui échouerait en 401.
 */
function Enregistrement({
  itineraire,
  etat,
  peutEnregistrer,
  onEnregistrer,
}: {
  itineraire: Itinerary;
  etat?: EtatEnregistrement;
  peutEnregistrer: boolean;
  onEnregistrer: (itineraire: Itinerary) => void;
}) {
  const { t } = useTraduction();
  const CRITERES = criteres(t);

  if (!peutEnregistrer) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-neutral-700">Connectez-vous pour enregistrer ce trajet.</p>
        <ButtonLink href="/connexion" variant="secondary">
          Se connecter
        </ButtonLink>
      </div>
    );
  }

  if (etat?.statut === "enregistre") {
    return (
      // `role="status"` : l'annonce est faite au lecteur d'écran sans
      // interrompre ce qu'il était en train de lire — contrairement à
      // `role="alert"`, réservé aux erreurs.
      <p role="status" className="text-eco text-sm font-medium">
        Trajet enregistré. Vous le retrouverez dans votre espace.
      </p>
    );
  }

  const envoi = etat?.statut === "envoi";

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="secondary"
        // Désactivé pendant l'envoi : c'est ce qui empêche un double clic de
        // créer deux trajets identiques. Le backend reste l'autorité — il
        // n'existe aucune déduplication côté client.
        disabled={envoi}
        onClick={() => onEnregistrer(itineraire)}
        className="w-full sm:w-auto"
      >
        {/* Le nom du bouton dit CE QU'IL ENREGISTRE : deux boutons
            « Enregistrer » identiques sur la même page seraient
            indistinguables au lecteur d'écran. */}
        {envoi
          ? "Enregistrement…"
          : `Enregistrer le trajet ${CRITERES[itineraire.criterion].toLowerCase()}`}
      </Button>

      {etat?.statut === "echec" && (
        <p role="alert" className="text-sm text-red-800">
          <span className="font-medium">Le trajet n&apos;a pas pu être enregistré.</span>{" "}
          {etat.message}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Équivalent textuel de la carte (bloc 5B)
// ---------------------------------------------------------------------------

/**
 * Décrit en toutes lettres ce que la carte montre.
 *
 * DIT LA VÉRITÉ SUR LE TRACÉ. Le backend ne stocke aucune géométrie de voie —
 * seulement la position des arrêts. La ligne dessinée relie donc les arrêts
 * en segments droits : c'est un schéma, pas le chemin du véhicule, et le
 * texte le dit plutôt que de laisser croire le contraire.
 *
 * Signale aussi le cas où AUCUN tracé n'a pu être dessiné — un arrêt sans
 * position connue, par exemple — au lieu de laisser une carte muette.
 */
/**
 * Équivalent textuel de la carte — AFFICHÉ, pas réservé aux lecteurs d'écran.
 *
 * ⚠️ IL DIT D'OÙ VIENT LE TRACÉ. Depuis la Phase 4 la carte dessine la voie
 * réelle publiée par l'opérateur… mais seulement là où elle existe : 2 858 des
 * 6 676 liaisons du réseau en ont une. Les autres sont reliées en droite.
 *
 * Annoncer « le tracé suit la voie » serait donc faux une fois sur deux, et
 * annoncer « c'est un schéma » serait injuste pour le reste. La phrase change
 * donc selon ce qui est RÉELLEMENT dessiné.
 */
function descriptionCarte(
  selectionne: Itinerary | null,
  troncons: readonly TronconTrace[] | null,
  nombreArrets: number,
  t: Textes,
): string {
  const CRITERES = criteres(t);

  if (!selectionne || !troncons || troncons.length === 0) {
    if (nombreArrets === 0) {
      return "Aucun arrêt dans cette zone. Déplacez la carte pour en voir d'autres.";
    }

    return `${nombreArrets} ${
      nombreArrets === 1 ? "arrêt est affiché" : "arrêts sont affichés"
    } autour du centre de la carte. Cliquez sur l'un d'eux pour en faire votre départ ou votre destination ; déplacez la carte pour en voir d'autres.`;
  }

  const etapes = selectionne.segments.length;
  const entete = `${CRITERES[selectionne.criterion]} : ${etapes} ${
    etapes === 1 ? "étape" : "étapes"
  }, ${formaterDistance(selectionne.totalDistanceM)} en ${formaterDuree(
    selectionne.totalDurationMin,
  )}.`;

  // ⚠️ MARCHE ET VÉLO NE SONT PAS DES VÉHICULES D'OPÉRATEUR. Un trajet
  // « À pied » ou « À vélo » ne se décrit ni par « la voie publiée par
  // l'opérateur », ni par « le chemin suivi par le véhicule ».
  const marcheEstimee = troncons.some((troncon) => troncon.source === "WALK_ESTIMATE");

  if (selectionne.segments.length === 0) {
    const detail = marcheEstimee ? t.tracePietonEstimeDetail : t.tracePietonReelDetail;
    return `${entete} ${t.itineraireToutAPied} ${detail}`;
  }

  const toutAVelo =
    selectionne.segments.length === 1 && selectionne.segments[0].mode === "BIKE";

  if (toutAVelo) {
    const veloEstime = troncons.some(
      (troncon) => troncon.mode === "BIKE" && troncon.source === "STRAIGHT",
    );
    return `${entete} ${t.itineraireToutAVelo} ${
      veloEstime ? t.traceVeloEstime : t.traceVeloReel
    }`;
  }

  const approche = troncons.filter((troncon) => troncon.source === "STRAIGHT").length;

  if (approche === 0) {
    return `${entete} Le tracé suit la voie réelle publiée par l'opérateur. Le détail des étapes est listé ci-dessous.`;
  }

  if (approche === troncons.length) {
    return `${entete} Aucun tracé de voie n'est publié pour ce trajet : les arrêts sont reliés en ligne droite, ce qui n'est PAS le chemin suivi par le véhicule. Le détail des étapes est listé ci-dessous.`;
  }

  return `${entete} Le tracé suit la voie réelle, sauf sur ${approche} ${
    approche === 1 ? "portion dessinée" : "portions dessinées"
  } en pointillés, où aucune géométrie n'est publiée — la ligne droite n'y est pas le chemin réel. Le détail des étapes est listé ci-dessous.`;
}

// ---------------------------------------------------------------------------
// État de la géolocalisation (bloc 5D-1)
// ---------------------------------------------------------------------------

/**
 * Dit où en est la demande de position, et quoi faire quand elle échoue.
 *
 * `role="status"` : le résultat arrive de façon asynchrone, après un geste de
 * l'usager. Sans zone d'état, un lecteur d'écran ne saurait jamais que la
 * position a été obtenue — ni pourquoi le bouton « Rechercher » reste
 * désactivé.
 *
 * ⚠️ CETTE ZONE NE CONTIENT AUCUN `Spinner` NI `ErrorMessage` : tous deux
 * portent déjà leur propre rôle live, et les imbriquer ferait tout annoncer
 * deux fois — l'erreur commise puis corrigée au bloc 5C-3.
 */
function EtatDeLaPosition({ etat, onReessayer }: { etat: EtatPosition; onReessayer: () => void }) {
  if (etat.statut === "repos") {
    return null;
  }

  return (
    <div role="status" className="mt-2 text-sm">
      {etat.statut === "localisation" && <p className="text-neutral-600">Localisation en cours…</p>}

      {etat.statut === "ok" && (
        <p className="text-eco">
          {/* Le mot porte l'information, pas la couleur verte (WCAG 1.4.1). */}
          Position trouvée. Le trajet partira de l&apos;arrêt le plus proche.
        </p>
      )}

      {etat.statut === "echec" && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2">
          <p className="text-red-900">{etat.message}</p>
          {/* Un échec de localisation se réessaie : refuser une fois par
              mégarde ne doit pas condamner la fonctionnalité pour la
              session. */}
          <button
            type="button"
            onClick={onReessayer}
            className="text-brand mt-1 font-medium underline"
          >
            Réessayer
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Un arrêt du réseau, converti en point utilisable (Phase 3A).
 *
 * Rend `null` sur un identifiant vide ou inconnu : le champ redevient alors
 * non sélectionné, plutôt que de conserver un point qui ne correspond à rien.
 */
function depuisArret(arrets: Stop[], id: string): PointChoisi | null {
  const arret = arrets.find((a) => a.id === id);

  return arret
    ? {
        label: arret.name,
        latitude: arret.latitude,
        longitude: arret.longitude,
        origine: "adresse",
      }
    : null;
}

/// Petit bouton d'option secondaire — « Ma position », « Domicile ».
function BoutonSecondaire({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-ink rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium transition-colors hover:bg-neutral-50"
    >
      {children}
    </button>
  );
}

/**
 * Une étape regroupée — « Métro 8 · 5 arrêts », avec son détail repliable.
 *
 * ⚠️ LE DÉTAIL N'EST JAMAIS PERDU, seulement replié. Le regroupement est un
 * choix d'AFFICHAGE : un usager qui veut savoir où il passe doit pouvoir le
 * lire, et `<details>` le permet nativement — au clavier, et annoncé par un
 * lecteur d'écran, sans une ligne de JavaScript.
 */
function EtapeGroupee({
  groupe,
  rang,
  total,
}: {
  groupe: GroupeEtapes;
  rang: number;
  total: number;
}) {
  // La marche n'a pas de numéro de ligne : « Marche Correspondance » n'aurait
  // aucun sens. Les autres modes se disent par leur ligne — « Métro 8 ».
  const titre =
    groupe.mode === "WALK"
      ? LIBELLES_MODES.WALK
      : `${LIBELLES_MODES[groupe.mode]} ${groupe.lineName}`;

  return (
    <li className="border-brand/40 border-l-2 pl-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-ink font-medium">
          {titre}
          <span className="sr-only">
            , étape {rang} sur {total}
          </span>
        </p>
        <p className="text-sm text-neutral-600">{formaterDuree(groupe.durationMin)}</p>
      </div>

      <p className="mt-0.5 text-sm text-neutral-600">
        {groupe.depart} → {groupe.arrivee}
        {/* Le nombre d'arrêts ne s'annonce QUE pour un véhicule : « 3 arrêts
            à pied » ne veut rien dire. */}
        {groupe.mode !== "WALK" && (
          <>
            {" · "}
            {groupe.nombreArrets} arrêt{groupe.nombreArrets > 1 ? "s" : ""}
          </>
        )}
      </p>

      {/* Replié au-delà d'un seul tronçon : ouvrir un détail d'une ligne
          n'apprendrait rien. */}
      {groupe.segments.length > 1 && (
        <details className="mt-1">
          <summary className="text-brand cursor-pointer text-sm">
            Voir les {groupe.segments.length} arrêts
          </summary>
          <ol className="mt-2 space-y-1 pl-4">
            {groupe.segments.map((segment) => (
              <li
                key={`${segment.fromStopId}-${segment.toStopId}`}
                className="list-decimal text-sm text-neutral-600"
              >
                {segment.toStopName}
              </li>
            ))}
          </ol>
        </details>
      )}
    </li>
  );
}
