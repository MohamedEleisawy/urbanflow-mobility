"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Button, ButtonLink } from "@/components/Button";
import { Card } from "@/components/Card";
import { Carte } from "@/components/Carte";
import { Container } from "@/components/Container";
import { EmptyState } from "@/components/EmptyState";
import { Spinner } from "@/components/Spinner";
import { useTraduction } from "@/components/LangueProvider";
import type { Textes } from "@/lib/i18n/dictionnaire";
import { pointsDuTrajet, tronconsDuTrajet } from "@/lib/carte";
import {
  etapesDuTrajet,
  regrouperSegments,
  type GroupeEtapes,
} from "@/lib/itineraire";
import { formaterCo2, formaterDistance, formaterDuree, LIBELLES_MODES } from "@/lib/format";
import {
  analyserSelection,
  instantaneServeur,
  lireBrut,
  memoriserSelection,
  souscrireSelection,
  type SelectionItineraire,
} from "@/lib/itineraire-selection";
import { rechercherItineraires } from "@/lib/itineraires-api";
import { messageDErreur } from "@/lib/api";
import {
  avancement,
  estArrive,
  instructionCourante,
  type EtatNavigation,
  type LibellesInstruction,
  type PositionSuivie,
} from "@/lib/navigation-suivi";
import { decisionRecalcul } from "@/lib/recalcul-itineraire";
import {
  journaliserDecision,
  journaliserPosition,
  journaliserRecalcul,
} from "@/lib/journal-navigation";
import { useNavigationTracking } from "@/lib/useNavigationTracking";
import { useVoiceGuidance } from "@/lib/useVoiceGuidance";
import type { Itinerary } from "@/lib/types";

// =============================================================================
// Navigation guidée (Phase 5)
// =============================================================================
// ⚠️ CET ÉCRAN EST LE SEUL À SOLLICITER LE GPS, et seulement après un clic sur
// « Démarrer ». Rien ne se déclenche au chargement : une invite de permission
// qui surgit sans geste est une invite qu'on refuse par réflexe.
//
// ⚠️ AUCUNE TRACE N'EST CONSERVÉE NI ENVOYÉE. Seule la dernière position vit
// en mémoire, et elle sert à trois choses : se situer sur le trajet, décider
// s'il faut recalculer, et savoir qu'on est arrivé. Rien n'est écrit, rien
// n'est transmis — hormis les coordonnées d'un recalcul, que le moteur exige
// pour chercher un chemin depuis là où l'on est.
// =============================================================================

/**
 * Libellés des instructions, dans la langue courante.
 *
 * ⚠️ LES NOMS DE MODE RESTENT EN FRANÇAIS pour l'instant (`LIBELLES_MODES`) :
 * les traduire demanderait une clé par mode, et le dictionnaire n'en porte pas
 * encore. Un « Métro 4 » dans une phrase anglaise reste compréhensible ; une
 * clé manquante afficherait `undefined`.
 */
const libelles = (t: Textes): LibellesInstruction => ({
  mode: (mode) => LIBELLES_MODES[mode as keyof typeof LIBELLES_MODES] ?? mode,
  marcher: t.instructionMarcher,
  prendre: t.instructionPrendre,
  arrivee: t.vousEtesArrive,
  recalcul: t.recalcul,
});

export default function NavigationPage() {
  // Même lecture que `/itineraire` : l'itinéraire vient de `sessionStorage`,
  // jamais de l'URL — un trajet réel pèse plusieurs kilo-octets.
  const brut = useSyncExternalStore(souscrireSelection, lireBrut, instantaneServeur);

  const selection = useMemo(
    () => (brut === undefined ? null : analyserSelection(brut)),
    [brut],
  );

  if (brut === undefined) {
    return (
      <Container>
        <section className="py-10">
          <Spinner label="Chargement du trajet…" />
        </section>
      </Container>
    );
  }

  if (selection === null) {
    return (
      <Container>
        <section className="py-10">
          <EmptyState
            title="Aucun trajet à suivre"
            description="Le détail d'un trajet n'est conservé que le temps de votre visite. Relancez la recherche pour en choisir un."
            action={<ButtonLink href="/recherche">Revenir à la recherche</ButtonLink>}
          />
        </section>
      </Container>
    );
  }

  return <Guidage selection={selection} />;
}

function Guidage({ selection }: { selection: SelectionItineraire }) {
  const { t, etiquette } = useTraduction();

  // ⚠️ MÉMORISÉ : `instructionCourante` en dépend, et un objet reconstruit à
  // chaque rendu ferait recalculer l'instruction à chaque relevé GPS — puis
  // la ferait RÉÉNONCER, la clé changeant avec elle.
  const LIBELLES = useMemo(() => libelles(t), [t]);

  const { origine, destination } = selection;

  /**
   * L'itinéraire SUIVI, qui n'est plus forcément celui de départ : un recalcul
   * le remplace.
   */
  const [itineraire, setItineraire] = useState<Itinerary>(selection.itineraire);
  const [etat, setEtat] = useState<EtatNavigation>("idle");
  const [erreurRecalcul, setErreurRecalcul] = useState<string | null>(null);

  /**
   * La carte suit-elle la position ?
   *
   * ⚠️ SÉPARÉ DU SUIVI GPS. L'usager doit pouvoir déplacer la carte pour
   * regarder plus loin sans que le prochain relevé ne la ramène de force sous
   * ses pieds — et pouvoir revenir d'un clic.
   */
  const [recentrer, setRecentrer] = useState(true);

  const suivi = useNavigationTracking();
  // ⚠️ L'ÉTIQUETTE SUIT LA LANGUE. Une phrase espagnole lue par une voix
  // française est inintelligible.
  const voix = useVoiceGuidance(etiquette);

  /**
   * Horodatage GPS du dernier recalcul. `0` = jamais.
   *
   * ⚠️ L'HORLOGE EST CELLE DES MESURES, PAS CELLE DU MUR. Deux raisons, et la
   * seconde est la plus importante :
   *
   *   1. `Date.now()` est une fonction IMPURE : l'appeler pendant le rendu est
   *      interdit par le compilateur React, et à juste titre — un rendu doit
   *      pouvoir être rejoué à l'identique.
   *   2. C'est la bonne horloge. Le délai de garde sépare deux MESURES ; le
   *      temps écoulé pendant qu'un onglet dormait en arrière-plan ne doit pas
   *      autoriser un recalcul de plus.
   *
   * `position.timestamp` est fourni par l'appareil avec chaque relevé : c'est
   * une donnée, pas un appel système.
   */
  const [dernierRecalcul, setDernierRecalcul] = useState(0);

  /**
   * Point d'où le trajet actuellement affiché a été calculé.
   *
   * ⚠️ INDISPENSABLE POUR MESURER UN DÉPLACEMENT. Après un recalcul, la
   * nouvelle route PART de la position courante : l'usager n'est donc plus
   * jamais « hors trajet », même en sautant de plusieurs centaines de mètres.
   * Sans ce point de référence, un second déplacement ne déclencherait plus
   * rien — et la démonstration au capteur semblerait figée.
   *
   * `null` tant que le trajet vient de la recherche initiale.
   */
  const [origineDuCalcul, setOrigineDuCalcul] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);

  /**
   * Position déjà examinée.
   *
   * ⚠️ C'EST LE PATRON « AJUSTER L'ÉTAT PENDANT LE RENDU » documenté par
   * React, et non un `useEffect` qui poserait un état. La différence n'est pas
   * cosmétique : un effet provoquerait un rendu SUPPLÉMENTAIRE à chaque relevé
   * GPS — soit plusieurs par seconde pendant toute la navigation — et
   * déclencherait `react-hooks/set-state-in-effect`.
   */
  const [positionExaminee, setPositionExaminee] = useState<PositionSuivie | null>(
    null,
  );

  /**
   * Point depuis lequel un recalcul est demandé, ou `null`.
   *
   * Sépare la DÉCISION (prise au rendu, purement) de l'ACTION (l'appel réseau,
   * fait dans un effet). Sans cette séparation, le rendu déclencherait une
   * requête HTTP — un effet de bord interdit à cet endroit.
   */
  const [recalculDemande, setRecalculDemande] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);

  // ═══ LES ÉTAPES RÉELLEMENT PARCOURUES, MARCHE COMPRISE ═══
  //
  // ⚠️ `itineraire.segments` SEUL NE SUFFIT PAS AU GUIDAGE. Un trajet
  // entièrement à pied n'en contient AUCUN : le suivi ne pouvait alors ni
  // situer l'usager, ni conclure à l'arrivée, ni afficher la moindre étape.
  // Et même en tram, la marche jusqu'au premier arrêt n'était pas guidée.
  //
  // ⚠️ CES ÉTAPES NE SONT JAMAIS ENVOYÉES AU SERVEUR. Les deux extrémités
  // demandées portent des identifiants synthétiques ; l'enregistrement d'un
  // trajet continue de passer par `itineraire.segments`, seul à désigner des
  // liaisons réelles.
  const segments = useMemo(
    () => etapesDuTrajet(itineraire, origine, destination),
    [itineraire, origine, destination],
  );

  // --- La décision de suivi, prise au rendu ----------------------------------
  //
  // Trois issues possibles à un nouveau relevé : on est arrivé, on a dévié, ou
  // il n'y a rien à changer. Aucune ne fait d'effet de bord ici.
  if (suivi.position !== positionExaminee) {
    setPositionExaminee(suivi.position);

    const position = suivi.position;

    if (position && etat === "tracking") {
      journaliserPosition(position);

      if (estArrive(position, segments)) {
        setEtat("completed");
      } else {
        // ⚠️ TOUTES LES RÈGLES SONT DANS `decisionRecalcul`, et aucune ici :
        // écart au trajet, précision du GPS, délai de garde, recalcul déjà en
        // cours, déplacement franc. Elles se testent sur des nombres, sans
        // GPS ni horloge — et chaque refus porte sa cause, que le journal de
        // développement affiche.
        const decision = decisionRecalcul({
          position,
          segments,
          origineDuCalcul,
          // L'état `recalculating` est déjà exclu par `etat === "tracking"`
          // au-dessus ; on le passe explicitement pour que la fonction reste
          // vraie indépendamment de l'appelant.
          recalculEnCours: false,
          dernierRecalculMs: dernierRecalcul,
          maintenantMs: position.timestamp,
        });

        journaliserDecision(decision);

        if (decision.recalculer) {
          setDernierRecalcul(position.timestamp);
          setEtat("recalculating");
          setRecalculDemande({
            latitude: position.latitude,
            longitude: position.longitude,
          });
        }
      }
    }
  }

  const progression = useMemo(
    () => (suivi.position ? avancement(suivi.position, segments) : null),
    [suivi.position, segments],
  );

  // Le tracé complet : la marche est dessinée en pointillés, marquée
  // « tracé piéton estimé », et le trajet en transport garde sa géométrie.
  const troncons = useMemo(() => tronconsDuTrajet(itineraire), [itineraire]);
  const arrets = useMemo(
    () => pointsDuTrajet(itineraire, origine, destination),
    [itineraire, origine, destination],
  );

  /**
   * Les étapes lisibles, regroupées par ligne.
   *
   * ⚠️ LA MÊME LECTURE QUE `/itineraire`. Un déroulé qui changerait de forme
   * entre la préparation du trajet et son exécution obligerait l'usager à s'y
   * retrouver deux fois.
   */
  const groupes = useMemo(() => regrouperSegments(segments), [segments]);

  /**
   * Indice du GROUPE en cours, déduit de l'indice du SEGMENT courant.
   *
   * ⚠️ LES DEUX NE COÏNCIDENT PAS. Cinq tronçons consécutifs d'une même ligne
   * forment un seul groupe : surligner le groupe numéro 5 quand on est sur le
   * cinquième tronçon désignerait une étape qui n'existe pas.
   */
  const groupeCourant = useMemo(() => {
    if (progression === null) {
      return null;
    }

    let compte = 0;

    for (const [rang, groupe] of groupes.entries()) {
      compte += groupe.segments.length;

      if (progression.index < compte) {
        return rang;
      }
    }

    return groupes.length - 1;
  }, [groupes, progression]);

  const instruction = useMemo(
    () =>
      instructionCourante(
        etat,
        segments,
        progression?.index ?? 0,
        LIBELLES,
        formaterDistance,
      ),
    [etat, segments, progression, LIBELLES],
  );

  // --- L'appel réseau du recalcul, dans un effet ------------------------------
  //
  // ⚠️ AUCUN `setState` SYNCHRONE ICI. L'état `recalculating` a déjà été posé
  // au rendu ; tout ce qui suit n'arrive qu'APRÈS l'attente réseau.
  const arreterSuivi = suivi.arreter;

  useEffect(() => {
    if (!recalculDemande) {
      return;
    }

    let abandonne = false;
    const { latitude, longitude } = recalculDemande;

    rechercherItineraires({
      fromLat: latitude,
      fromLon: longitude,
      // ⚠️ LA DESTINATION NE CHANGE JAMAIS. On ne recalcule que le CHEMIN :
      // le but reste celui que l'usager a choisi.
      toLat: destination.latitude,
      toLon: destination.longitude,
    })
      .then((trouves) => {
        if (abandonne) return;

        const remplacant = trouves[0];

        if (!remplacant) {
          // ⚠️ « AUCUN ITINÉRAIRE » EST UNE RÉPONSE, PAS UNE PANNE. On garde
          // l'ancien affiché plutôt que de laisser l'usager sans rien : il
          // reste le meilleur guide dont on dispose.
          setErreurRecalcul(
            "Aucun itinéraire depuis votre position. L’itinéraire précédent reste affiché.",
          );
          setEtat("tracking");
          // ⚠️ ON DÉPLACE QUAND MÊME LA RÉFÉRENCE. Sans cela, chaque relevé
          // suivant reverrait le même déplacement « significatif » et
          // relancerait la même recherche vouée au même échec.
          setOrigineDuCalcul({ latitude, longitude });
          journaliserRecalcul("aucun-itineraire");
          return;
        }

        setItineraire(remplacant);
        setErreurRecalcul(null);
        setEtat("tracking");
        // ⚠️ LE NOUVEAU POINT DE RÉFÉRENCE. C'est lui qui permettra de mesurer
        // le PROCHAIN déplacement — sans quoi le second saut du capteur ne
        // déclencherait rien.
        setOrigineDuCalcul({ latitude, longitude });
        journaliserRecalcul("abouti");

        // ⚠️ ON MÉMORISE LE NOUVEAU CHEMIN. Sans cela, revenir sur
        // `/itineraire` montrerait le trajet d'ORIGINE — celui dont l'usager
        // s'est justement écarté — et le détail contredirait la navigation.
        memoriserSelection({
          ...selection,
          itineraire: remplacant,
          origine: { label: "Votre position", latitude, longitude },
          // Ici `new Date()` est légitime : on est dans un effet, après une
          // attente réseau — pas pendant un rendu.
          choisiA: new Date().toISOString(),
        });
      })
      .catch((echec: unknown) => {
        if (abandonne) return;
        setErreurRecalcul(messageDErreur(echec));
        setEtat("tracking");
      })
      .finally(() => {
        if (!abandonne) {
          setRecalculDemande(null);
        }
      });

    return () => {
      abandonne = true;
    };
  }, [recalculDemande, destination.latitude, destination.longitude, selection]);

  // --- Arrivée : on éteint la puce -------------------------------------------
  //
  // Effet de bord PUR (aucun `setState`) : c'est exactement ce qu'un effet
  // doit contenir.
  useEffect(() => {
    if (etat === "completed") {
      arreterSuivi();
    }
  }, [etat, arreterSuivi]);

  // --- Guidage vocal ---------------------------------------------------------
  const annoncer = voix.annoncer;

  useEffect(() => {
    if (instruction && etat !== "idle") {
      // La clé empêche la répétition : voir `useVoiceGuidance`.
      annoncer(instruction.cle, instruction.texte);
    }
  }, [instruction, etat, annoncer]);

  const demarrer = () => {
    setEtat("tracking");
    suivi.demarrer();
  };

  const terminer = () => {
    suivi.arreter();
    voix.taire();
    setEtat("idle");
  };

  return (
    <Container>
      <section className="py-6 sm:py-10">
        <p className="text-sm">
          <Link href="/itineraire" className="text-brand font-medium underline">
            ← Retour au trajet
          </Link>
        </p>

        <h1 className="text-ink mt-3 text-xl font-semibold sm:text-2xl">
          Vers {destination.label}
        </h1>

        {/* ⚠️ L'INSTRUCTION EST ÉNORME ET EN PREMIER. C'est la seule chose
            qu'on lit en marchant. Tout le reste est secondaire. */}
        <div className="mt-4">
          <Card>
            {/* `aria-live="polite"` : l'instruction change en cours de route,
                sans geste de l'usager. Sans cette zone, un lecteur d'écran ne
                l'annoncerait jamais. « polite » et non « assertive » : on
                n'interrompt pas ce qu'il est en train de lire. */}
            <p
              aria-live="polite"
              className="text-ink text-2xl leading-snug font-semibold sm:text-3xl"
            >
              {etat === "idle"
                ? t.pretAPartir
                : (instruction?.texte ?? t.recherchePosition)}
            </p>

            {progression && etat !== "idle" && (
              <p className="mt-3 text-neutral-700">
                {formaterDistance(progression.distanceRestanteM)} restants ·{" "}
                {formaterDuree(progression.dureeRestanteMin)} · étape{" "}
                {progression.index + 1} sur {segments.length}
              </p>
            )}
          </Card>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          {etat === "idle" ? (
            <Button type="button" onClick={demarrer}>
              {t.commencerTrajet}
            </Button>
          ) : (
            <Button type="button" variant="secondary" onClick={terminer}>
              {t.arreterSuivi}
            </Button>
          )}

          {voix.disponible && (
            <button
              type="button"
              aria-pressed={voix.actif}
              onClick={voix.basculer}
              className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                voix.actif
                  ? "border-eco bg-eco text-white"
                  : "text-ink border-neutral-300 bg-white hover:bg-neutral-50"
              }`}
            >
              <span aria-hidden="true">🔊</span>{" "}
              {voix.actif ? t.guidageVocalActif : t.guidageVocal}
            </button>
          )}

          {suivi.actif && (
            <button
              type="button"
              aria-pressed={recentrer}
              onClick={() => setRecentrer((actuel) => !actuel)}
              className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                recentrer
                  ? "border-brand text-brand bg-white"
                  : "text-ink border-neutral-300 bg-white hover:bg-neutral-50"
              }`}
            >
              {recentrer ? t.suiviCarteActif : t.recentrer}
            </button>
          )}
        </div>

        {/* Les états qui demandent quelque chose à l'usager, ou l'informent
            d'une limite. `role="status"` : ils arrivent de façon asynchrone. */}
        <div role="status" className="mt-3 space-y-2 text-sm">
          {suivi.erreur && (
            <p className="text-neutral-700">
              <span className="font-medium">{t.localisationIndisponible}</span> {suivi.erreur}
            </p>
          )}

          {erreurRecalcul && <p className="text-neutral-700">{erreurRecalcul}</p>}

          {etat === "tracking" && !suivi.position && !suivi.erreur && (
            <p className="text-neutral-700">{t.recherchePosition}</p>
          )}
        </div>

        {etat === "completed" && (
          <div className="mt-6">
            <ResumeArrivee itineraire={itineraire} destination={destination.label} />
          </div>
        )}

        {etat !== "idle" && groupes.length > 0 && (
          <div className="mt-6">
            <TimelineSuivie
              groupes={groupes}
              courant={groupeCourant}
              destination={destination.label}
            />
          </div>
        )}

        <div className="mt-6">
          <Carte
            titre="Votre position sur le trajet"
            description={
              suivi.position
                ? "Le point bleu est votre position, entourée de son incertitude quand l'appareil l'annonce."
                : "Votre position s'affichera ici une fois le suivi démarré."
            }
            arrets={arrets}
            trace={arrets}
            troncons={troncons}
            position={
              suivi.position
                ? {
                    latitude: suivi.position.latitude,
                    longitude: suivi.position.longitude,
                    accuracyM: suivi.position.accuracyM,
                  }
                : null
            }
            suivrePosition={recentrer && suivi.actif}
          />
        </div>
      </section>
    </Container>
  );
}

/**
 * Le déroulé du trajet, l'étape en cours mise en avant.
 *
 * ⚠️ L'ÉTAT NE REPOSE PAS QUE SUR LA COULEUR. L'étape courante porte aussi un
 * repère textuel lu par les lecteurs d'écran (« étape en cours »), un fond
 * distinct et une graisse plus forte : trois signaux, dont deux survivent à un
 * daltonisme ou à un écran en plein soleil (WCAG 1.4.1).
 *
 * ⚠️ LES ÉTAPES PASSÉES SONT BARRÉES ET ESTOMPÉES, jamais masquées. Quelqu'un
 * qui doute d'être descendu au bon arrêt doit pouvoir revenir en arrière du
 * regard.
 */
function TimelineSuivie({
  groupes,
  courant,
  destination,
}: {
  groupes: GroupeEtapes[];
  courant: number | null;
  destination: string;
}) {
  const { t } = useTraduction();

  return (
    <section aria-labelledby="deroule-suivi">
      <h2 id="deroule-suivi" className="text-ink text-lg font-semibold">
        {t.derouleTrajet}
      </h2>

      <ol className="mt-3 space-y-2">
        {groupes.map((groupe, index) => {
          const enCours = index === courant;
          const passee = courant !== null && index < courant;

          return (
            <li
              key={`${groupe.lineId}-${groupe.segments[0].fromStopId}-${index}`}
              // `aria-current="step"` est le mécanisme normalisé pour désigner
              // l'élément courant d'une progression. Un lecteur d'écran
              // l'annonce sans qu'on ait à inventer un libellé.
              aria-current={enCours ? "step" : undefined}
              className={`rounded-md border px-3 py-2 ${
                enCours
                  ? "border-brand bg-brand/5"
                  : passee
                    ? "border-neutral-200 bg-transparent opacity-60"
                    : "border-neutral-200 bg-white"
              }`}
            >
              <p
                className={`text-sm ${
                  enCours
                    ? "text-brand font-semibold"
                    : passee
                      ? "text-neutral-600 line-through"
                      : "text-ink font-medium"
                }`}
              >
                {LIBELLES_MODES[groupe.mode]}
                {groupe.lineName && ` ${groupe.lineName}`}
                {" · "}
                {formaterDuree(groupe.durationMin)}
              </p>

              <p className="text-xs text-neutral-600">
                {groupe.depart} → {groupe.arrivee}
              </p>

              {/* Le repère textuel : il double la couleur, il ne la remplace
                  pas. Invisible à l'écran, entendu par un lecteur. */}
              {enCours && <span className="sr-only">{t.etapeEnCours}</span>}
            </li>
          );
        })}

        <li className="px-3 py-2">
          <p className="text-eco text-sm font-semibold">🏁 {destination}</p>
        </li>
      </ol>
    </section>
  );
}

/**
 * Résumé d'arrivée.
 *
 * ⚠️ LES CHIFFRES SONT CEUX DE L'ITINÉRAIRE SUIVI, pas une mesure du trajet
 * réellement effectué. Nous ne chronométrons pas l'usager et ne conservons
 * aucune trace : annoncer « vous avez mis 27 minutes » supposerait une mesure
 * que nous refusons de faire. Le libellé dit donc « prévu ».
 */
function ResumeArrivee({
  itineraire,
  destination,
}: {
  itineraire: Itinerary;
  destination: string;
}) {
  const { carbon } = itineraire;

  return (
    <Card>
      <p className="text-eco text-xl font-semibold">Vous êtes arrivé 🌱</p>
      <p className="mt-1 text-neutral-700">{destination}</p>

      <dl className="mt-4 grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-sm text-neutral-600">Durée prévue</dt>
          <dd className="text-ink mt-0.5 font-semibold">
            {formaterDuree(itineraire.totalDurationMin)}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-neutral-600">Distance</dt>
          <dd className="text-ink mt-0.5 font-semibold">
            {formaterDistance(itineraire.totalDistanceM)}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-neutral-600">CO₂ évité vs voiture</dt>
          <dd className="text-eco mt-0.5 font-semibold">
            {/* « Indisponible », jamais « 0 g » : zéro est une valeur
                légitime, et l'employer comme repli rendrait les deux cas
                indiscernables. */}
            {carbon.savedVsCarGrams === null
              ? "Indisponible"
              : formaterCo2(carbon.savedVsCarGrams)}
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap gap-3 border-t border-neutral-200 pt-4">
        <ButtonLink href="/itineraire" variant="secondary">
          Revoir le trajet
        </ButtonLink>
        <ButtonLink href="/recherche">Nouvelle recherche</ButtonLink>
      </div>
    </Card>
  );
}
