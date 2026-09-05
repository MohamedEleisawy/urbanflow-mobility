"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ButtonLink } from "@/components/Button";
import { Card } from "@/components/Card";
import { Carte } from "@/components/Carte";
import { Container } from "@/components/Container";
import { EmptyState } from "@/components/EmptyState";
import { Spinner } from "@/components/Spinner";
import { useTraduction } from "@/components/LangueProvider";
import type { Textes } from "@/lib/i18n/dictionnaire";
import { pointsDuTrajet, tronconsDuTrajet } from "@/lib/carte";
import {
  formaterCo2,
  formaterDistance,
  formaterDuree,
  formaterHeure,
  LIBELLES_MODES,
} from "@/lib/format";
import { regrouperSegments, type GroupeEtapes } from "@/lib/itineraire";
import { EtapeMarche } from "@/components/EtapeMarche";
import type { ItineraryWalkLeg } from "@/lib/types";
import {
  analyserSelection,
  instantaneServeur,
  lireBrut,
  souscrireSelection,
  type SelectionItineraire,
} from "@/lib/itineraire-selection";
import type { Alert, ItineraryCarbon, ItineraryCriterion } from "@/lib/types";
import { listerAlertes } from "@/lib/alertes-api";
import { alertesDeLItineraire, type AlerteItineraire } from "@/lib/alertes-itineraire";

// =============================================================================
// Le trajet retenu, en détail (Phase 4)
// =============================================================================
// ⚠️ CET ÉCRAN NE FAIT AUCUN APPEL RÉSEAU. Tout ce qu'il affiche a été calculé
// par `POST /api/routes/search` et transmis par `sessionStorage` : les
// segments, les noms d'arrêts, les coordonnées, la géométrie et l'empreinte
// carbone. Relancer la recherche ici risquerait de rendre un AUTRE trajet que
// celui que l'usager a choisi.
//
// Conséquence assumée : l'écran ne survit pas à la fermeture de l'onglet, et
// son adresse ne se partage pas. Il le dit alors franchement, avec un chemin
// de retour — plutôt que d'afficher une page cassée (§54 du cahier des
// charges).
// =============================================================================

/// Libellés des critères — les mêmes que sur l'écran de recherche.
const criteres = (t: Textes): Record<ItineraryCriterion, string> => ({
  FASTEST: t.critereFastest,
  SHORTEST: t.critereShortest,
  FEWEST_TRANSFERS: t.critereFewestTransfers,
  LOWEST_CO2: t.critereLowestCo2,
});

export default function ItinerairePage() {
  /**
   * ⚠️ `useSyncExternalStore`, ET NON un `useEffect` QUI POSE UN ÉTAT.
   *
   * Deux raisons, dans cet ordre :
   *
   *   1. `sessionStorage` n'existe pas au rendu serveur. Le lire pendant le
   *      rendu ferait échouer le prérendu de `next build`.
   *   2. Le poser depuis un effet déclenche `react-hooks/set-state-in-effect`
   *      du compilateur React, et provoque un rendu supplémentaire à chaque
   *      chargement.
   *
   * Ce hook est fait exactement pour ça : lire une source EXTÉRIEURE à React,
   * avec un instantané distinct pour le serveur. L'instantané serveur rend
   * `undefined` — « pas encore lu » — que l'on distingue soigneusement de
   * `null`, qui voudrait dire « rien de mémorisé ».
   *
   * L'instantané est la CHAÎNE brute, jamais l'objet analysé : le hook exige
   * une valeur stable au sens de `Object.is`, et un objet neuf à chaque appel
   * ferait boucler React indéfiniment.
   */
  const brut = useSyncExternalStore(souscrireSelection, lireBrut, instantaneServeur);

  const selection = useMemo(
    () => (brut === undefined ? null : analyserSelection(brut)),
    [brut],
  );

  if (brut === undefined) {
    return (
      <Container>
        <section className="py-10 sm:py-14">
          <Spinner label="Chargement du trajet…" />
        </section>
      </Container>
    );
  }

  if (selection === null) {
    return (
      <Container>
        <section className="py-10 sm:py-14">
          <EmptyState
            title="Cet itinéraire n'est plus disponible"
            description="Le détail d'un trajet n'est conservé que le temps de votre visite. Relancez la recherche pour le retrouver."
            action={<ButtonLink href="/recherche">Revenir à la recherche</ButtonLink>}
          />
        </section>
      </Container>
    );
  }

  return <Detail selection={selection} />;
}

function Detail({ selection }: { selection: SelectionItineraire }) {
  const { t } = useTraduction();
  const CRITERES = criteres(t);

  const { itineraire, origine, destination } = selection;

  const groupes = useMemo(() => regrouperSegments(itineraire.segments), [itineraire]);

  // ⚠️ LE TRAJET COMPLET, MARCHE COMPRISE. `tronconsDItineraire(segments)`
  // seule rendait un tableau VIDE pour un trajet entièrement à pied : la carte
  // n'affichait alors aucun trait, comme si le trajet n'existait pas.
  const troncons = useMemo(() => tronconsDuTrajet(itineraire), [itineraire]);

  // Les repères : le départ demandé, les arrêts traversés, la destination
  // demandée. Un trajet à pied n'a aucun arrêt — il a quand même deux bouts.
  const points = useMemo(
    () => pointsDuTrajet(itineraire, origine, destination),
    [itineraire, origine, destination],
  );

  const approches = troncons.filter(
    (troncon) => troncon.source === "STRAIGHT",
  ).length;
  const marcheEstimee = troncons.some(
    (troncon) => troncon.source === "WALK_ESTIMATE",
  );
  // Un trajet SANS aucun tronçon de réseau : il n'y a que de la marche.
  const toutAPied = itineraire.segments.length === 0;
  // Un trajet d'UN SEUL segment vélo : le bouton « Vélo uniquement ». Le vélo
  // n'est PAS un véhicule d'opérateur — sa description ne peut pas parler de
  // « voie publiée par l'opérateur » ni de suffixe de marche.
  const toutAVelo =
    itineraire.segments.length === 1 && itineraire.segments[0].mode === "BIKE";
  const veloEstime = troncons.some(
    (troncon) => troncon.mode === "BIKE" && troncon.source === "STRAIGHT",
  );

  /**
   * Perturbations en cours, ou `null` tant qu'on ne sait pas.
   *
   * ⚠️ SON ÉCHEC N'EMPORTE PAS L'ÉCRAN. Un itinéraire reste parfaitement
   * utilisable sans la liste des perturbations ; l'inverse serait absurde. On
   * n'affiche donc rien plutôt qu'un message d'erreur qui inquiéterait sans
   * rien apprendre.
   */
  const [alertes, setAlertes] = useState<Alert[] | null>(null);

  useEffect(() => {
    const controleur = new AbortController();

    listerAlertes(controleur.signal)
      .then((reponse) => setAlertes(reponse.items))
      .catch(() => {
        // Silencieux, et c'est délibéré : voir ci-dessus.
      });

    return () => controleur.abort();
  }, []);

  const perturbations = useMemo(
    () => (alertes ? alertesDeLItineraire(alertes, itineraire.segments) : []),
    [alertes, itineraire.segments],
  );

  return (
    <Container>
      <section className="py-10 sm:py-14">
        <p className="text-sm">
          <Link href="/recherche" className="text-brand font-medium underline">
            ← Retour à la recherche
          </Link>
        </p>

        <h1 className="text-ink mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">
          {origine.label} → {destination.label}
        </h1>

        <p className="mt-2 text-neutral-700">{CRITERES[itineraire.criterion]}</p>

        <div className="mt-8 space-y-8">
          <Chiffres
            durationMin={itineraire.totalDurationMin}
            distanceM={itineraire.totalDistanceM}
            changements={itineraire.numberOfTransfers}
            carbone={itineraire.carbon}
          />

          <Carte
            titre="Le trajet sur la carte"
            description={descriptionCarte(
              troncons.length,
              approches,
              marcheEstimee,
              toutAPied,
              toutAVelo,
              veloEstime,
              t,
            )}
            arrets={points}
            trace={points}
            troncons={troncons}
            messageVide={t.itineraireToutAPied}
          />

          {perturbations.length > 0 && <Perturbations items={perturbations} />}

          <Timeline
            groupes={groupes}
            destination={destination.label}
            walkAccess={itineraire.walkAccess}
            walkEgress={itineraire.walkEgress}
          />

          {/* ⚠️ CE BOUTON FAIT QUELQUE CHOSE. `/navigation` lit le MÊME
              itinéraire mémorisé : il n'y a rien à transmettre, et rien ne
              peut se perdre entre les deux écrans. */}
          <div className="flex flex-wrap gap-3 border-t border-neutral-200 pt-6">
            <ButtonLink href="/navigation">{t.commencerTrajet}</ButtonLink>
            <ButtonLink href="/recherche" variant="secondary">
              Choisir un autre itinéraire
            </ButtonLink>
          </div>
        </div>
      </section>
    </Container>
  );
}

/**
 * Les quatre chiffres qui répondent aux quatre questions du voyageur :
 * combien de temps, quelle distance, combien de changements, combien de CO₂.
 */
function Chiffres({
  durationMin,
  distanceM,
  changements,
  carbone,
}: {
  durationMin: number;
  distanceM: number;
  changements: number;
  carbone: ItineraryCarbon;
}) {
  const { t } = useTraduction();

  return (
    <Card>
      <dl className="grid gap-4 sm:grid-cols-4">
        <Chiffre libelle={t.duree} valeur={formaterDuree(durationMin)} />
        <Chiffre libelle={t.distance} valeur={formaterDistance(distanceM)} />
        <Chiffre
          libelle={t.changements}
          valeur={changements === 0 ? t.aucun : String(changements)}
        />
        {/* ⚠️ « Indisponible », JAMAIS « 0 g ». Zéro est une valeur légitime —
            un trajet à pied émet réellement zéro — et l'employer comme repli
            rendrait les deux cas indiscernables. */}
        <Chiffre
          libelle={t.co2Emis}
          valeur={carbone.co2Grams === null ? t.indisponible : formaterCo2(carbone.co2Grams)}
          accent={carbone.co2Grams !== null}
        />
      </dl>

      {/* Voir la note sur `Itinerary.totalDurationMin` : la durée additionne
          des temps de parcours réels, mais aucun temps d'attente. */}
      {changements > 0 && (
        <p className="mt-3 text-xs text-neutral-500">
          Durée hors temps d&apos;attente aux correspondances : nous importons le réseau, pas
          les horaires de passage.
        </p>
      )}

      {carbone.status === "CARBON_AVAILABLE" &&
        carbone.savedVsCarGrams !== null &&
        carbone.ecoScore !== null && (
          <p className="text-eco mt-4 border-t border-neutral-200 pt-4 text-sm font-medium">
            🌱 {formaterCo2(carbone.savedVsCarGrams)} de CO₂ évités par rapport à la voiture —
            éco-score {Math.round(carbone.ecoScore)}/100.
          </p>
        )}

      {carbone.status === "CARBON_UNAVAILABLE" && (
        <p className="mt-4 border-t border-neutral-200 pt-4 text-sm text-neutral-700">
          <span className="font-medium">{t.carboneIndisponible}</span> {carbone.reason ?? ""}
        </p>
      )}
    </Card>
  );
}

function Chiffre({
  libelle,
  valeur,
  accent = false,
}: {
  libelle: string;
  valeur: string;
  accent?: boolean;
}) {
  return (
    <div>
      <dt className="text-sm text-neutral-600">{libelle}</dt>
      <dd className={`mt-0.5 font-semibold ${accent ? "text-eco" : "text-ink"}`}>{valeur}</dd>
    </div>
  );
}

/**
 * Les perturbations qui touchent CE trajet, et elles seules.
 *
 * ⚠️ N'APPARAÎT QUE S'IL Y EN A. Un encadré « aucune perturbation » sur
 * chaque itinéraire serait du bruit permanent pour une information qui ne sert
 * que par exception.
 */
function Perturbations({ items }: { items: AlerteItineraire[] }) {
  const { t } = useTraduction();

  return (
    <section aria-labelledby="perturbations">
      <h2 id="perturbations" className="text-ink text-lg font-semibold">
        {t.perturbationsTrajet}
      </h2>

      <ul className="mt-3 space-y-3">
        {items.map(({ alerte, lignes }) => (
          <li key={alerte.id}>
            <Card>
              <p className="text-ink font-semibold">
                <span aria-hidden="true">⚠</span> {lignes.join(", ")}
              </p>

              {/* Le texte de l'OPÉRATEUR, tel qu'il l'a publié. On ne le
                  reformule pas : ce serait faire passer notre interprétation
                  pour sa parole. */}
              {alerte.headerText && (
                <p className="mt-1 text-neutral-700">{alerte.headerText}</p>
              )}

              {alerte.descriptionText && (
                <p className="mt-1 text-sm text-neutral-600">{alerte.descriptionText}</p>
              )}

              {/* Quand l'opérateur n'a publié aucun texte, on montre le
                  vocabulaire GTFS-RT plutôt que rien — c'est peu lisible, mais
                  c'est vrai. */}
              {!alerte.headerText && !alerte.descriptionText && (
                <p className="mt-1 text-sm text-neutral-600">
                  {alerte.cause} · {alerte.effect}
                </p>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Le déroulé du trajet, étape par étape.
 *
 * UNE ÉTAPE PAR LIGNE EMPRUNTÉE, jamais une par tronçon : cinq stations de la
 * ligne 8 forment UNE étape lisible. Le détail des arrêts reste accessible,
 * replié — la vue principale répond d'abord à « que dois-je faire ? ».
 */
function Timeline({
  groupes,
  destination,
  walkAccess,
  walkEgress,
}: {
  groupes: GroupeEtapes[];
  destination: string;
  walkAccess: ItineraryWalkLeg | null;
  walkEgress: ItineraryWalkLeg | null;
}) {
  const { t } = useTraduction();

  return (
    <section aria-labelledby="deroule">
      <h2 id="deroule" className="text-ink text-lg font-semibold">
        {t.derouleTrajet}
      </h2>

      {/* Une liste ORDONNÉE : l'ordre est celui du trajet, et un lecteur
          d'écran annonce « 2 sur 4 ».

          ⚠️ LA MARCHE OUVRE ET FERME LE DÉROULÉ. Sans elle, la première étape
          était « prenez le tram E à Jardiniers » sans jamais dire comment
          atteindre Jardiniers depuis l'adresse demandée. */}
      <ol className="mt-4 space-y-3">
        {walkAccess && (
          <li>
            <Card>
              <EtapeMarche marche={walkAccess} sens="acces" />
            </Card>
          </li>
        )}

        {groupes.map((groupe, index) => (
          <li key={`${groupe.lineId}-${groupe.segments[0].fromStopId}-${index}`}>
            <Etape groupe={groupe} rang={index + 1} total={groupes.length} />
          </li>
        ))}

        {walkEgress && (
          <li>
            <Card>
              <EtapeMarche marche={walkEgress} sens="sortie" />
            </Card>
          </li>
        )}

        <li>
          <Card>
            <p className="text-eco font-semibold">🏁 Arrivée · {destination}</p>
          </Card>
        </li>
      </ol>
    </section>
  );
}

/// Pictogramme par mode. Décoratif : le mode est TOUJOURS écrit à côté.
const PICTOS: Record<string, string> = {
  WALK: "🚶",
  BUS: "🚌",
  TRAM: "🚊",
  METRO: "🚇",
  TRAIN: "🚆",
  BIKE: "🚲",
  ESCOOTER: "🛴",
  CAR: "🚗",
};

/**
 * Les heures de passage d'une étape — « 08:35 → 08:43 », et l'attente avant.
 *
 * ═══ POURQUOI SUR CHAQUE ÉTAPE, ET PAS SEULEMENT EN TÊTE DE PAGE ═══
 *
 * L'heure d'arrivée globale répond à « puis-je y être à temps ? ». Les heures
 * par étape répondent à une autre question, qu'on se pose EN ROUTE : « ai-je
 * raté ma correspondance ? ». Ce sont deux usages, à deux moments.
 *
 * ⚠️ NE S'AFFICHE QUE SI LES DEUX HEURES EXISTENT. Le backend les pose
 * ensemble ou pas du tout — un itinéraire partiellement horodaté est refusé
 * en amont — mais s'en remettre à cette garantie ici rendrait l'affichage
 * dépendant d'une invariante distante. La vérification coûte une ligne.
 *
 * ⚠️ L'ATTENTE EST DITE SÉPARÉMENT, jamais fondue dans l'intervalle. « 08:35
 * → 08:43 » précédé de « 6 min d'attente » informe ; « 08:29 → 08:43 » sans
 * autre précision laisse croire à un trajet de quatorze minutes.
 */
function HorairesEtape({ groupe }: { groupe: GroupeEtapes }) {
  const { t } = useTraduction();

  const premier = groupe.segments[0];
  const dernier = groupe.segments[groupe.segments.length - 1];

  if (!premier.departureAt || !dernier.arrivalAt) {
    return null;
  }

  return (
    <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-sm">
      <span className="text-ink font-medium tabular-nums">
        {formaterHeure(premier.departureAt)} → {formaterHeure(dernier.arrivalAt)}
      </span>

      {premier.waitMin !== undefined && premier.waitMin > 0 && (
        <span className="text-xs text-neutral-500">
          {t.attenteTotale.replace("{n}", String(premier.waitMin))}
        </span>
      )}
    </p>
  );
}

function Etape({
  groupe,
  rang,
  total,
}: {
  groupe: GroupeEtapes;
  rang: number;
  total: number;
}) {
  const mode = LIBELLES_MODES[groupe.mode];

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        {/* ⚠️ `text-brand` ET NON `text-ink`. La charte réserve le bleu de
            marque à ce qui IDENTIFIE — une ligne, un mode — et l'encre neutre
            au corps de texte. Sur un déroulé de trajet, c'est le nom de ligne
            qu'on cherche des yeux, et c'est lui qui doit ressortir. */}
        <p className="text-brand font-semibold">
          {/* `aria-hidden` : le pictogramme double une information déjà
              écrite. Le faire lire ajouterait « émoji train » avant chaque
              étape. */}
          <span aria-hidden="true">{PICTOS[groupe.mode] ?? "•"}</span> {mode}
          {groupe.lineName && ` ${groupe.lineName}`}
        </p>
        <p className="text-sm text-neutral-700">
          {formaterDuree(groupe.durationMin)}
          {groupe.mode !== "WALK" && (
            <>
              {" · "}
              {groupe.nombreArrets} arrêt{groupe.nombreArrets > 1 ? "s" : ""}
            </>
          )}
          {" · "}
          {formaterDistance(groupe.distanceM)}
        </p>
      </div>

      <p className="mt-1 text-sm text-neutral-700">
        {groupe.depart} → {groupe.arrivee}
      </p>

      <HorairesEtape groupe={groupe} />

      <p className="sr-only">
        Étape {rang} sur {total}.
      </p>

      {/* Le détail arrêt par arrêt, REPLIÉ. Il n'a d'intérêt qu'en cours de
          trajet — « suis-je descendu trop tôt ? » — et l'afficher d'emblée
          noierait les étapes sous des dizaines de lignes. */}
      {groupe.segments.length > 1 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-neutral-700">
            Voir les {groupe.segments.length} arrêts desservis
          </summary>
          <ol className="mt-2 space-y-1 border-l-2 border-neutral-200 pl-4 text-sm text-neutral-700">
            {groupe.segments.map((segment, index) => (
              <li key={`${segment.fromStopId}-${segment.toStopId}-${index}`}>
                {segment.toStopName}
              </li>
            ))}
          </ol>
        </details>
      )}
    </Card>
  );
}

/**
 * Équivalent textuel de la carte — AFFICHÉ, pas réservé aux lecteurs d'écran.
 *
 * ⚠️ IL DIT D'OÙ VIENT LE TRACÉ. Seules 2 858 des 6 676 liaisons du réseau
 * portent une géométrie réelle ; les autres sont reliées en droite. Annoncer
 * « le tracé suit la voie » serait donc faux une fois sur deux.
 */
function descriptionCarte(
  total: number,
  approches: number,
  marcheEstimee: boolean,
  toutAPied: boolean,
  toutAVelo: boolean,
  veloEstime: boolean,
  t: Textes,
): string {
  // ⚠️ UN TRAJET SANS AUCUN TRONÇON DE RÉSEAU EST UN TRAJET À PIED. Le décrire
  // par « aucun tracé de voie n'est publié » laisserait croire à une donnée
  // manquante, alors qu'il n'y a simplement aucun véhicule.
  //
  // ⚠️ ET LES DEUX CAS NE SE DISENT PAS PAREIL. Un chemin calculé rue par rue
  // est un VRAI itinéraire ; une droite entre deux points n'en est pas un. Les
  // annoncer de la même façon reviendrait soit à s'excuser d'une donnée
  // exacte, soit à faire passer une estimation pour un parcours.
  if (toutAPied) {
    return marcheEstimee
      ? `${t.itineraireToutAPied} ${t.tracePietonEstimeDetail}`
      : `${t.itineraireToutAPied} ${t.tracePietonReelDetail}`;
  }

  // ⚠️ LE VÉLO N'EST PAS UN VÉHICULE D'OPÉRATEUR. Pas de « voie publiée par
  // l'opérateur », pas de suffixe de marche : un trajet vélo va d'un bout à
  // l'autre, son tracé vient d'un routeur (OSM) ou n'est qu'une estimation.
  if (toutAVelo) {
    return veloEstime
      ? `${t.itineraireToutAVelo} ${t.traceVeloEstime}`
      : `${t.itineraireToutAVelo} ${t.traceVeloReel}`;
  }

  const suffixe = marcheEstimee
    ? ` ${t.tracePietonEstimeDetail}`
    : ` ${t.tracePietonReelDetail}`;

  if (approches === 0) {
    return (
      "Le tracé suit la voie réelle publiée par l'opérateur de transport." +
      suffixe
    );
  }

  if (approches === total) {
    return (
      "Aucun tracé de voie n'est publié pour ce trajet : les arrêts sont reliés en ligne droite, ce qui n'est PAS le chemin suivi par le véhicule." +
      suffixe
    );
  }

  return (
    `Le tracé suit la voie réelle, sauf sur ${approches} ${
      approches === 1 ? "portion dessinée" : "portions dessinées"
    } en pointillés, où aucune géométrie n'est publiée — la ligne droite n'y est pas le chemin réel.` + suffixe
  );
}
