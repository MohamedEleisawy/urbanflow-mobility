"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Container } from "@/components/Container";
import { EmptyState } from "@/components/EmptyState";
import { ErrorMessage } from "@/components/ErrorMessage";
import { Spinner } from "@/components/Spinner";
import { messageDErreur } from "@/lib/api";
import {
  enregistrerItineraire,
  listerArrets,
  rechercherItineraires,
  versRequeteEnregistrement,
} from "@/lib/itineraires-api";
import { useAuth } from "@/components/AuthProvider";
import { ButtonLink } from "@/components/Button";
import { estimerCarbone } from "@/lib/carbone-api";
import { formaterCo2, formaterDistance, formaterDuree } from "@/lib/format";
import type { CarbonResult, Itinerary, ItineraryCriterion, Stop, TransportMode } from "@/lib/types";

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
  const [arrets, setArrets] = useState<Stop[] | null>(null);
  const [erreurArrets, setErreurArrets] = useState<string | null>(null);

  const [depart, setDepart] = useState<Choix>("");
  const [arrivee, setArrivee] = useState<Choix>("");

  const [resultats, setResultats] = useState<Itinerary[] | null>(null);
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
    origine: Stop;
    destination: Stop;
  } | null>(null);

  const { statut: statutAuth, jeton } = useAuth();

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

    const origine = arrets?.find((a) => a.id === depart);
    const destination = arrets?.find((a) => a.id === arrivee);

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
  const peutChercher = depart !== "" && arrivee !== "" && !memeArret;

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
                  <ChoixArret
                    id={idDepart}
                    libelle="Départ"
                    valeur={depart}
                    arrets={arrets}
                    onChange={setDepart}
                    decritPar={memeArret ? idErreur : undefined}
                  />
                  <ChoixArret
                    id={idArrivee}
                    libelle="Arrivée"
                    valeur={arrivee}
                    arrets={arrets}
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

          <Resultats
            resultats={resultats}
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
}: {
  id: string;
  libelle: string;
  valeur: string;
  arrets: Stop[];
  onChange: (valeur: string) => void;
  decritPar?: string;
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
}: {
  resultats: Itinerary[] | null;
  recherche: boolean;
  erreur: string | null;
  carbone: Partial<Record<ItineraryCriterion, EtatCarbone>>;
  enregistrements: Partial<Record<ItineraryCriterion, EtatEnregistrement>>;
  peutEnregistrer: boolean;
  onEnregistrer: (itineraire: Itinerary) => void;
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

/// Libellés français des modes, pour ne pas afficher « WALK » à un usager.
const MODES: Record<TransportMode, string> = {
  WALK: "Marche",
  BUS: "Bus",
  TRAM: "Tram",
  METRO: "Métro",
  BIKE: "Vélo",
  ESCOOTER: "Trottinette",
  CAR: "Voiture",
};

function ItineraireCarte({
  itineraire,
  carbone,
  enregistrement,
  peutEnregistrer,
  onEnregistrer,
}: {
  itineraire: Itinerary;
  carbone?: EtatCarbone;
  enregistrement?: EtatEnregistrement;
  peutEnregistrer: boolean;
  onEnregistrer: (itineraire: Itinerary) => void;
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
                {MODES[segment.mode]} {segment.lineName} · {segment.operator}
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
