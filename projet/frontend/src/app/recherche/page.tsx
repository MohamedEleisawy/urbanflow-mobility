"use client";

import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Carte } from "@/components/Carte";
import { Container } from "@/components/Container";
import { EmptyState } from "@/components/EmptyState";
import { ErrorMessage } from "@/components/ErrorMessage";
import { Spinner } from "@/components/Spinner";
import { messageDErreur } from "@/lib/api";
import { indexerArrets, pointDepuisArret, traceDepuisSegments } from "@/lib/carte";
import { ErreurGeolocalisation, positionActuelle, type Coordonnees } from "@/lib/geolocalisation";
import { listerAdresses } from "@/lib/adresses-api";
import type { FavoriteAddress, FavoriteAddressType } from "@/lib/types";
import {
  enregistrerItineraire,
  listerArrets,
  rechercherItineraires,
  versRequeteEnregistrement,
} from "@/lib/itineraires-api";
import { useAuth } from "@/components/AuthProvider";
import { ButtonLink } from "@/components/Button";
import { estimerCarbone } from "@/lib/carbone-api";
import { formaterCo2, formaterDistance, formaterDuree, LIBELLES_MODES } from "@/lib/format";
import type { CarbonResult, Itinerary, ItineraryCriterion, Stop } from "@/lib/types";

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
type Choix = string;

/**
 * Sort de l'estimation carbone d'UN itinéraire (étape 5A-6).
 *
 * L'absence de clé signifie « en cours » : c'est un état DÉRIVÉ, non stocké.
 * Le distinguer d'un échec importe — « nous cherchons » et « nous n'avons pas
 * pu » ne disent pas la même chose à l'usager.
 */
type EtatCarbone = { statut: "ok"; resultat: CarbonResult } | { statut: "echec"; message: string };

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
  const [erreurArrets, setErreurArrets] = useState<string | null>(null);

  const [depart, setDepart] = useState<Choix>("");
  const [position, setPosition] = useState<EtatPosition>({ statut: "repos" });
  const [arrivee, setArrivee] = useState<Choix>("");

  const [resultats, setResultats] = useState<Itinerary[] | null>(null);

  /**
   * Itinéraire mis en avant sur la carte (bloc 5B).
   *
   * `null` NE VEUT PAS DIRE « aucun » : il veut dire « l'usager n'a pas encore
   * choisi », auquel cas on retient le premier résultat. Sans cela, la carte
   * resterait vide après une recherche réussie, ce qui donnerait l'impression
   * qu'elle est cassée.
   */
  const [selection, setSelection] = useState<ItineraryCriterion | null>(null);
  const [recherche, setRecherche] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  /// Estimations carbone, indexées par critère — la clé est unique dans une
  /// réponse, le backend dédupliquant les itinéraires identiques.
  const [carbone, setCarbone] = useState<Partial<Record<ItineraryCriterion, EtatCarbone>>>({});

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

  // --- Données géographiques (bloc 5B) --------------------------------------
  //
  // TOUT VIENT DE `arrets`, DÉJÀ CHARGÉ. La carte ne déclenche aucun appel :
  // ni pour les positions, ni pour les noms. Résoudre chaque étape par un
  // `GET /api/stops/:id` produirait exactement le N+1 réseau que le dossier
  // demande d'éviter.
  const pointsReseau = useMemo(() => (arrets ?? []).map(pointDepuisArret), [arrets]);
  const indexArrets = useMemo(() => indexerArrets(arrets ?? []), [arrets]);

  // Dérivée, jamais stockée : un état « sélection » et un état « résultats »
  // qui se contrediraient laisseraient la carte afficher un trajet absent de
  // la liste.
  const selectionne =
    resultats?.find((itineraire) => itineraire.criterion === selection) ?? resultats?.[0] ?? null;

  const trace = selectionne ? traceDepuisSegments(selectionne.segments, indexArrets) : null;

  /**
   * Demande la position, et NE LA DEMANDE QU'À CE MOMENT.
   *
   * Déclenchée par le choix explicite de « Ma position » dans la liste, jamais
   * au chargement de la page : une invite de permission qui surgit sans geste
   * de l'usager est une invite qu'on refuse par réflexe.
   */
  const choisirDepart = (valeur: Choix) => {
    setDepart(valeur);

    if (valeur !== POSITION) {
      // Revenir à un arrêt oublie la position : la garder en mémoire ferait
      // conserver une donnée de géolocalisation dont plus rien n'a besoin
      // (minimisation, C8).
      setPosition({ statut: "repos" });
      return;
    }

    setPosition({ statut: "localisation" });

    positionActuelle()
      .then((coordonnees) => setPosition({ statut: "ok", coordonnees }))
      .catch((echec: unknown) => {
        setPosition({
          statut: "echec",
          message:
            echec instanceof ErreurGeolocalisation
              ? echec.message
              : "Votre position n'a pas pu être déterminée.",
        });
      });
  };

  const idDepart = useId();
  const idArrivee = useId();
  const idErreur = useId();

  // --- Chargement des arrêts ------------------------------------------------
  useEffect(() => {
    let abandonne = false;

    listerArrets()
      .then((liste) => {
        if (abandonne) return;
        setArrets(liste);
      })
      .catch((echec: unknown) => {
        if (abandonne) return;
        setErreurArrets(messageDErreur(echec));
      });

    return () => {
      abandonne = true;
    };
  }, []);

  // --- Estimation carbone des itinéraires trouvés (étape 5A-6) -------------
  //
  // DEUX NIVEAUX DE DONNÉES, DEUX SORTS INDÉPENDANTS. Un itinéraire valide ne
  // doit jamais disparaître parce que le microservice carbone est éteint : la
  // recherche a réussi, et ce qu'elle a trouvé reste vrai.
  //
  // D'où `allSettled` et non `all` : `all` rejette au premier échec, ce qui
  // effacerait l'estimation d'un itinéraire parfaitement calculable parce que
  // l'autre a échoué.
  useEffect(() => {
    if (!resultats || resultats.length === 0) {
      return;
    }

    let abandonne = false;

    // Un appel par itinéraire — au plus deux, le backend n'en rend jamais
    // davantage. Chaque appel porte l'itinéraire ENTIER : le contrat accepte
    // un tableau de segments et rend le bilan de l'ensemble.
    Promise.allSettled(resultats.map((itineraire) => estimerCarbone(itineraire.segments))).then(
      (sorts) => {
        if (abandonne) return;

        const etats: Partial<Record<ItineraryCriterion, EtatCarbone>> = {};

        sorts.forEach((sort, index) => {
          // L'index fait le lien entre la promesse et SON itinéraire :
          // `allSettled` préserve l'ordre du tableau d'entrée. C'est ce qui
          // garantit qu'une estimation n'est jamais attribuée au mauvais
          // itinéraire.
          const critere = resultats[index].criterion;

          etats[critere] =
            sort.status === "fulfilled"
              ? { statut: "ok", resultat: sort.value }
              : { statut: "echec", message: messageDErreur(sort.reason) };
        });

        setCarbone(etats);
      },
    );

    return () => {
      abandonne = true;
    };
  }, [resultats]);

  const soumettre = async (evenement: FormEvent) => {
    evenement.preventDefault();

    // L'origine est SOIT un arrêt choisi, SOIT la position de l'usager. Dans
    // les deux cas, seules des coordonnées partent au backend : le contrat de
    // `POST /api/routes/search` n'a jamais accepté autre chose.
    // UN SEUL ENDROIT traduit un choix en coordonnées, et il sert aux DEUX
    // champs. C'est ce qui garantit qu'« arrivée = Travail » ne peut pas
    // recevoir par accident les coordonnées du départ : la fonction ne
    // connaît que la valeur qu'on lui passe.
    const resoudre = (choix: Choix): Coordonnees | undefined => {
      if (choix === POSITION) {
        return position.statut === "ok" ? position.coordonnees : undefined;
      }

      if (choix.startsWith(PREFIXE_ADRESSE)) {
        return adressesFav.find((a) => a.id === choix.slice(PREFIXE_ADRESSE.length));
      }

      return arrets?.find((a) => a.id === choix);
    };

    const origine = resoudre(depart);
    const destination = resoudre(arrivee);

    if (!origine || !destination) {
      return;
    }

    setErreur(null);
    setRecherche(true);
    // Les estimations et enregistrements précédents n'ont plus d'objet : les
    // conserver afficherait le carbone — ou un « Trajet enregistré » — de
    // l'ancienne recherche sous les nouveaux itinéraires.
    setCarbone({});
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
      });

      // Les deux vont ENSEMBLE : les résultats et les points qui les ont
      // produits. C'est ce couple qui sera enregistré.
      setPointsRecherches({ origine, destination });
      setResultats(trouves);
      // La sélection repart de zéro : garder « SHORTEST » d'une recherche
      // précédente mettrait en avant un critère que la nouvelle réponse ne
      // contient peut-être pas.
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
  const memeArret = depart !== "" && depart === arrivee;

  // Chercher avec « Ma position » exige que la position soit RÉELLEMENT
  // arrivée : partir pendant la localisation enverrait des coordonnées
  // absentes, et le backend répondrait 400.
  const positionPrete = depart !== POSITION || position.statut === "ok";
  const peutChercher = depart !== "" && arrivee !== "" && !memeArret && positionPrete;

  return (
    <Container>
      <section className="py-10 sm:py-14">
        <h1 className="text-ink text-2xl font-semibold tracking-tight sm:text-3xl">
          Rechercher un itinéraire
        </h1>
        <p className="mt-3 max-w-2xl text-neutral-700">
          Choisissez un point de départ et une destination pour comparer le trajet le plus rapide et
          le plus court.
        </p>

        <div className="mt-8 space-y-8">
          {erreurArrets ? (
            <ErrorMessage title="Le réseau n'a pas pu être chargé">{erreurArrets}</ErrorMessage>
          ) : !arrets ? (
            <Spinner label="Chargement des arrêts…" />
          ) : (
            <Card>
              <form onSubmit={soumettre} noValidate className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <ChoixArret
                      id={idDepart}
                      libelle="Départ"
                      valeur={depart}
                      arrets={arrets}
                      adresses={adressesFav}
                      onChange={choisirDepart}
                      decritPar={memeArret ? idErreur : undefined}
                      // Une OPTION de la liste, et non un bouton à côté :
                      // l'usager garde un seul contrôle, navigable au clavier
                      // et affiché par le sélecteur natif du téléphone.
                      optionPosition
                    />
                    <EtatDeLaPosition etat={position} onReessayer={() => choisirDepart(POSITION)} />
                  </div>
                  <ChoixArret
                    id={idArrivee}
                    libelle="Arrivée"
                    valeur={arrivee}
                    arrets={arrets}
                    adresses={adressesFav}
                    onChange={setArrivee}
                    decritPar={memeArret ? idErreur : undefined}
                  />
                </div>

                {/* Message lié aux DEUX champs par `aria-describedby` : un
                    lecteur d'écran l'annonce en atteignant l'un ou l'autre. */}
                {memeArret && (
                  <p id={idErreur} role="alert" className="text-sm text-red-800">
                    Le départ et l&apos;arrivée doivent être différents.
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
                  {recherche ? "Recherche en cours…" : "Rechercher"}
                </Button>
              </form>
            </Card>
          )}

          {/* La carte vient APRÈS le formulaire et AVANT les résultats :
              elle situe le réseau avant toute recherche, puis le trajet
              retenu. Elle reste un complément — les étapes détaillées, en
              dessous, se lisent sans elle. */}
          <Carte
            titre={selectionne ? "Le trajet retenu sur la carte" : "Les arrêts du réseau"}
            description={descriptionCarte(selectionne, trace !== null, pointsReseau.length)}
            arrets={pointsReseau}
            trace={trace}
          />

          <Resultats
            resultats={resultats}
            selection={selectionne?.criterion ?? null}
            onSelectionner={setSelection}
            recherche={recherche}
            erreur={erreur}
            carbone={carbone}
            enregistrements={enregistrements}
            peutEnregistrer={statutAuth === "authentifie"}
            onEnregistrer={enregistrer}
          />
        </div>
      </section>
    </Container>
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
  recherche,
  erreur,
  carbone,
  enregistrements,
  peutEnregistrer,
  onEnregistrer,
  selection,
  onSelectionner,
}: {
  resultats: Itinerary[] | null;
  recherche: boolean;
  erreur: string | null;
  carbone: Partial<Record<ItineraryCriterion, EtatCarbone>>;
  enregistrements: Partial<Record<ItineraryCriterion, EtatEnregistrement>>;
  peutEnregistrer: boolean;
  onEnregistrer: (itineraire: Itinerary) => void;
  selection: ItineraryCriterion | null;
  onSelectionner: (critere: ItineraryCriterion) => void;
}) {
  if (recherche) {
    return <Spinner label="Recherche d'itinéraires…" />;
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
    return (
      <EmptyState
        title="Aucun itinéraire trouvé"
        description="Le réseau ne propose pas de trajet entre ces deux points. Essayez deux arrêts plus proches l'un de l'autre, ou desservis par une même ligne."
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

      <ul className="mt-4 space-y-4">
        {resultats.map((itineraire) => (
          <li key={itineraire.criterion}>
            <ItineraireCarte
              itineraire={itineraire}
              // Chaque carte reçoit SON estimation et SON enregistrement,
              // désignés par son propre critère : aucune ne peut afficher
              // ceux d'une autre.
              carbone={carbone[itineraire.criterion]}
              enregistrement={enregistrements[itineraire.criterion]}
              peutEnregistrer={peutEnregistrer}
              onEnregistrer={onEnregistrer}
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

/// Libellés des deux critères produits par le backend.
const CRITERES = {
  FASTEST: "Le plus rapide",
  SHORTEST: "Le plus court",
} as const;

function ItineraireCarte({
  itineraire,
  carbone,
  enregistrement,
  peutEnregistrer,
  onEnregistrer,
  selectionne,
  onSelectionner,
}: {
  itineraire: Itinerary;
  carbone?: EtatCarbone;
  enregistrement?: EtatEnregistrement;
  peutEnregistrer: boolean;
  onEnregistrer: (itineraire: Itinerary) => void;
  selectionne: boolean;
  onSelectionner: (critere: ItineraryCriterion) => void;
}) {
  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h3 className="text-ink font-semibold">{CRITERES[itineraire.criterion]}</h3>
        <p className="text-sm text-neutral-700">
          <span className="text-ink font-medium">{formaterDuree(itineraire.totalDurationMin)}</span>{" "}
          · {formaterDistance(itineraire.totalDistanceM)} · {itineraire.segments.length}{" "}
          {itineraire.segments.length === 1 ? "étape" : "étapes"}
        </p>
      </div>

      {/* Une liste ORDONNÉE : l'ordre des étapes est celui du trajet, ce
          n'est pas une simple énumération. */}
      <ol className="mt-4 space-y-3">
        {itineraire.segments.map((segment, index) => (
          <li
            key={`${segment.lineId}-${segment.fromStopId}-${segment.toStopId}`}
            className="flex gap-3 border-l-2 border-neutral-200 pl-4"
          >
            <div className="min-w-0 flex-1">
              <p className="text-ink text-sm font-medium">
                {segment.fromStopName} → {segment.toStopName}
              </p>
              <p className="mt-0.5 text-sm text-neutral-600">
                {/* Le mode ET la ligne : « Bus 38 » plutôt que « BUS ».
                    C'est l'exigence posée en 4E-2 côté backend. */}
                {LIBELLES_MODES[segment.mode]} {segment.lineName} · {segment.operator}
              </p>
            </div>
            <p className="shrink-0 text-sm text-neutral-600">
              {formaterDuree(segment.durationMin)}
              <span className="sr-only">
                , étape {index + 1} sur {itineraire.segments.length}
              </span>
            </p>
          </li>
        ))}
      </ol>

      {/* UN VRAI BOUTON, avec `aria-pressed` : c'est un interrupteur, pas
          une navigation. Un lecteur d'écran annonce donc « activé » sur
          l'itinéraire porté par la carte — l'information ne repose pas que
          sur la couleur du tracé. */}
      <div className="mt-4">
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
        L'empreinte vient d'un SECOND appel : `POST /api/routes/search` ne
        renvoie ni CO₂ ni éco-score. Elle est donc affichée à part, et son
        échec n'efface jamais l'itinéraire ci-dessus (étape 5A-6).
      */}
      <div className="mt-4 border-t border-neutral-200 pt-4">
        <Carbone carbone={carbone} />
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
 * Trois affichages pour trois situations, jamais confondues.
 *
 *   `undefined` → l'estimation est en cours
 *   `echec`     → le calcul n'a pas abouti, et on le DIT
 *   `ok`        → les chiffres réellement calculés
 *
 * CE QUI N'EST JAMAIS FAIT : afficher « 0 g » à la place d'une erreur. Zéro
 * est une valeur légitime — un trajet entièrement à pied émet réellement
 * zéro — et l'employer comme valeur de repli rendrait les deux cas
 * indiscernables.
 */
function Carbone({ carbone }: { carbone?: EtatCarbone }) {
  if (!carbone) {
    return <Spinner label="Estimation de l'empreinte carbone…" />;
  }

  if (carbone.statut === "echec") {
    return (
      <p className="text-sm text-neutral-700">
        {/* Ni rouge alarmant ni silence : l'itinéraire reste valable, c'est
            seulement son empreinte qui manque. Le texte porte l'information,
            pas la couleur. */}
        <span className="font-medium">Empreinte carbone indisponible.</span> {carbone.message}
      </p>
    );
  }

  const { totalCo2Grams, savedVsCarGrams, ecoScore } = carbone.resultat;

  return (
    <dl className="grid gap-4 sm:grid-cols-3">
      <div>
        <dt className="text-sm text-neutral-600">CO₂ émis</dt>
        <dd className="text-ink mt-0.5 font-semibold">{formaterCo2(totalCo2Grams)}</dd>
      </div>
      <div>
        <dt className="text-sm text-neutral-600">Économisé vs voiture</dt>
        <dd className="text-eco mt-0.5 font-semibold">{formaterCo2(savedVsCarGrams)}</dd>
      </div>
      <div>
        <dt className="text-sm text-neutral-600">Éco-score</dt>
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
function descriptionCarte(
  selectionne: Itinerary | null,
  traceDessine: boolean,
  nombreArrets: number,
): string {
  if (!selectionne) {
    return nombreArrets === 1
      ? "1 arrêt du réseau est localisé sur la carte. Lancez une recherche pour y voir un trajet."
      : `${nombreArrets} arrêts du réseau sont localisés sur la carte. Lancez une recherche pour y voir un trajet.`;
  }

  const etapes = selectionne.segments.length;
  const entete = `${CRITERES[selectionne.criterion]} : ${etapes} ${
    etapes === 1 ? "étape" : "étapes"
  }, ${formaterDistance(selectionne.totalDistanceM)} en ${formaterDuree(
    selectionne.totalDurationMin,
  )}.`;

  if (!traceDessine) {
    return `${entete} Le tracé ne peut pas être dessiné : la position d'au moins un arrêt de ce trajet est inconnue. Les étapes restent listées ci-dessous.`;
  }

  return `${entete} Le tracé relie les arrêts desservis en ligne droite : c'est un schéma du trajet, pas le chemin exact suivi par le véhicule. Le détail des étapes est listé ci-dessous.`;
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
