"use client";

import { useMemo, useSyncExternalStore } from "react";
import Link from "next/link";
import { ButtonLink } from "@/components/Button";
import { Card } from "@/components/Card";
import { Carte } from "@/components/Carte";
import { Container } from "@/components/Container";
import { EmptyState } from "@/components/EmptyState";
import { Spinner } from "@/components/Spinner";
import { arretsDItineraire, tronconsDItineraire } from "@/lib/carte";
import { formaterCo2, formaterDistance, formaterDuree, LIBELLES_MODES } from "@/lib/format";
import { regrouperSegments, type GroupeEtapes } from "@/lib/itineraire";
import {
  analyserSelection,
  instantaneServeur,
  lireBrut,
  souscrireSelection,
  type SelectionItineraire,
} from "@/lib/itineraire-selection";
import type { ItineraryCarbon, ItineraryCriterion } from "@/lib/types";

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
const CRITERES: Record<ItineraryCriterion, string> = {
  FASTEST: "Le plus rapide",
  FEWEST_TRANSFERS: "Le moins de changements",
  LOWEST_CO2: "Le plus écologique",
};

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
  const { itineraire, origine, destination } = selection;

  const groupes = useMemo(() => regrouperSegments(itineraire.segments), [itineraire]);
  const arrets = useMemo(() => arretsDItineraire(itineraire.segments), [itineraire]);
  const troncons = useMemo(() => tronconsDItineraire(itineraire.segments), [itineraire]);

  const approches = troncons.filter((troncon) => troncon.source === "STRAIGHT").length;

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
            description={descriptionCarte(troncons.length, approches)}
            arrets={arrets}
            trace={arrets}
            troncons={troncons}
          />

          <Timeline groupes={groupes} destination={destination.label} />
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
  return (
    <Card>
      <dl className="grid gap-4 sm:grid-cols-4">
        <Chiffre libelle="Durée" valeur={formaterDuree(durationMin)} />
        <Chiffre libelle="Distance" valeur={formaterDistance(distanceM)} />
        <Chiffre
          libelle="Changements"
          valeur={changements === 0 ? "Aucun" : String(changements)}
        />
        {/* ⚠️ « Indisponible », JAMAIS « 0 g ». Zéro est une valeur légitime —
            un trajet à pied émet réellement zéro — et l'employer comme repli
            rendrait les deux cas indiscernables. */}
        <Chiffre
          libelle="CO₂ émis"
          valeur={carbone.co2Grams === null ? "Indisponible" : formaterCo2(carbone.co2Grams)}
          accent={carbone.co2Grams !== null}
        />
      </dl>

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
          <span className="font-medium">Empreinte carbone indisponible.</span>{" "}
          {carbone.reason ?? ""}
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
 * Le déroulé du trajet, étape par étape.
 *
 * UNE ÉTAPE PAR LIGNE EMPRUNTÉE, jamais une par tronçon : cinq stations de la
 * ligne 8 forment UNE étape lisible. Le détail des arrêts reste accessible,
 * replié — la vue principale répond d'abord à « que dois-je faire ? ».
 */
function Timeline({ groupes, destination }: { groupes: GroupeEtapes[]; destination: string }) {
  return (
    <section aria-labelledby="deroule">
      <h2 id="deroule" className="text-ink text-lg font-semibold">
        Le déroulé du trajet
      </h2>

      {/* Une liste ORDONNÉE : l'ordre est celui du trajet, et un lecteur
          d'écran annonce « 2 sur 4 ». */}
      <ol className="mt-4 space-y-3">
        {groupes.map((groupe, index) => (
          <li key={`${groupe.lineId}-${groupe.segments[0].fromStopId}-${index}`}>
            <Etape groupe={groupe} rang={index + 1} total={groupes.length} />
          </li>
        ))}

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
        <p className="text-ink font-semibold">
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
function descriptionCarte(total: number, approches: number): string {
  if (approches === 0) {
    return "Le tracé suit la voie réelle publiée par l'opérateur de transport.";
  }

  if (approches === total) {
    return "Aucun tracé de voie n'est publié pour ce trajet : les arrêts sont reliés en ligne droite, ce qui n'est PAS le chemin suivi par le véhicule.";
  }

  return `Le tracé suit la voie réelle, sauf sur ${approches} ${
    approches === 1 ? "portion dessinée" : "portions dessinées"
  } en pointillés, où aucune géométrie n'est publiée — la ligne droite n'y est pas le chemin réel.`;
}
