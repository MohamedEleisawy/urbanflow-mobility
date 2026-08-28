"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/Card";
import { Container } from "@/components/Container";
import { EmptyState } from "@/components/EmptyState";
import { ErrorMessage } from "@/components/ErrorMessage";
import { Spinner } from "@/components/Spinner";
import { messageDErreur } from "@/lib/api";
import { listerAlertes } from "@/lib/alertes-api";
import { formaterDateHeure } from "@/lib/format";
import type { Alert, AlertSeverity, AlertsResponse, TransportMode } from "@/lib/types";

// =============================================================================
// Perturbations en cours (bloc 5C-3, UC02)
// =============================================================================
// PUBLIQUE : aucun jeton, aucune redirection, aucun `RequireAuth`. Le dossier
// demande que l'application reste utilisable sans compte lorsque celui-ci
// n'est pas nécessaire, et `AlertsController` ne pose effectivement aucun
// guard. Un visiteur doit pouvoir savoir si sa ligne est coupée.
//
// AUCUN TRI, AUCUN FILTRE, AUCUNE PAGINATION côté client :
//   - l'ordre est celui du serveur (gravité, puis date de début) ;
//   - l'endpoint n'expose ni `page` ni `offset` — une pagination inventée ici
//     ne ramènerait jamais les alertes omises par le plafond ;
//   - un filtre par mode ou par ligne n'a pas de sens sur une liste qui, en
//     exploitation normale, tient en quelques éléments.
// =============================================================================

/**
 * Gravités, du plus grave au plus anodin.
 *
 * LE LIBELLÉ PORTE L'INFORMATION, PAS LA COULEUR. Un usager daltonien, une
 * impression en noir et blanc ou un lecteur d'écran doivent distinguer une
 * coupure totale d'une simple information — d'où un mot, pas seulement une
 * pastille rouge (WCAG 1.4.1).
 */
const GRAVITES: Record<AlertSeverity, { libelle: string; classes: string }> = {
  SEVERE: {
    libelle: "Perturbation majeure",
    classes: "border-red-300 bg-red-50 text-red-900",
  },
  WARNING: {
    libelle: "Perturbation",
    classes: "border-amber-300 bg-amber-50 text-amber-900",
  },
  INFO: {
    libelle: "Information",
    classes: "border-brand/30 bg-brand/5 text-brand",
  },
};

/// Libellés français des modes : « METRO » ne se montre pas à un usager.
const MODES: Record<TransportMode, string> = {
  WALK: "Marche",
  BUS: "Bus",
  TRAM: "Tram",
  METRO: "Métro",
  BIKE: "Vélo",
  ESCOOTER: "Trottinette",
  CAR: "Voiture",
};

/**
 * Vocabulaire GTFS-Realtime traduit — pour les CHAMPS « Cause » et
 * « Conséquence », jamais pour fabriquer un titre.
 *
 * ⚠️ LA NUANCE EST IMPORTANTE. L'étape 4F-2A s'interdit de composer un texte
 * à partir de `cause` et `effect` : « MAINTENANCE » + « REDUCED_SERVICE »
 * donnerait une phrase, mais présentée comme la parole de l'opérateur alors
 * qu'elle serait la nôtre. Les afficher dans deux champs ÉTIQUETÉS ne pose pas
 * ce problème : le libellé dit d'où vient l'information.
 *
 * Toute valeur inconnue est rendue TELLE QUELLE plutôt que masquée : un flux
 * peut publier une valeur que cette table ne prévoit pas.
 */
const CAUSES: Record<string, string> = {
  UNKNOWN_CAUSE: "Cause non communiquée",
  OTHER_CAUSE: "Autre cause",
  TECHNICAL_PROBLEM: "Problème technique",
  STRIKE: "Grève",
  DEMONSTRATION: "Manifestation",
  ACCIDENT: "Accident",
  HOLIDAY: "Jour férié",
  WEATHER: "Conditions météo",
  MAINTENANCE: "Maintenance",
  CONSTRUCTION: "Travaux",
  POLICE_ACTIVITY: "Intervention des forces de l'ordre",
  MEDICAL_EMERGENCY: "Urgence médicale",
};

const EFFETS: Record<string, string> = {
  NO_SERVICE: "Service interrompu",
  REDUCED_SERVICE: "Service réduit",
  SIGNIFICANT_DELAYS: "Retards importants",
  DETOUR: "Itinéraire dévié",
  ADDITIONAL_SERVICE: "Service renforcé",
  MODIFIED_SERVICE: "Service modifié",
  OTHER_EFFECT: "Autre conséquence",
  UNKNOWN_EFFECT: "Conséquence non communiquée",
  STOP_MOVED: "Arrêt déplacé",
  NO_EFFECT: "Aucune conséquence sur le service",
  ACCESSIBILITY_ISSUE: "Accessibilité perturbée",
};

export default function AlertesPage() {
  const [reponse, setReponse] = useState<AlertsResponse | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    const controleur = new AbortController();

    listerAlertes(controleur.signal)
      .then(setReponse)
      .catch((echec: unknown) => {
        // Une requête annulée au démontage n'est pas une panne : l'afficher
        // ferait clignoter une erreur à chaque navigation rapide.
        if (controleur.signal.aborted) return;
        setErreur(messageDErreur(echec));
      });

    return () => controleur.abort();
  }, []);

  return (
    <Container>
      <section className="py-10 sm:py-14">
        <h1 className="text-ink text-2xl font-semibold tracking-tight sm:text-3xl">
          Perturbations en cours
        </h1>
        <p className="mt-3 max-w-2xl text-neutral-700">
          Retards, pannes et travaux signalés sur le réseau, tels que publiés par les opérateurs.
          Aucun compte n&apos;est nécessaire pour les consulter.
        </p>

        {/*
          UNE SEULE ZONE « LIVE », ET ELLE NE CONTIENT QUE CETTE PHRASE.

          `Spinner` porte déjà `role="status"` et `ErrorMessage` `role="alert"`
          : le chargement et les erreurs s'annoncent donc tout seuls. Englober
          l'ensemble dans un `aria-live` supplémentaire les ferait annoncer
          DEUX FOIS, une fois poliment et une fois par-dessus la lecture en
          cours.

          Ce qui manquait est l'arrivée du contenu quand tout se passe bien —
          d'où cette ligne, et elle seule. Visuellement masquée : le titre
          juste en dessous dit déjà la même chose à l'écran.
        */}
        <p role="status" className="sr-only">
          {annonce(reponse)}
        </p>

        <div className="mt-8">
          {erreur ? (
            <ErrorMessage title="Les perturbations n'ont pas pu être chargées">
              {erreur}
            </ErrorMessage>
          ) : !reponse ? (
            <Spinner label="Chargement des perturbations…" />
          ) : reponse.items.length === 0 ? (
            // Une liste vide est une BONNE nouvelle, pas un état d'erreur :
            // elle mérite d'être formulée comme telle.
            <EmptyState
              title="Aucune perturbation en cours"
              description="Le réseau circule normalement, d'après les dernières informations publiées par les opérateurs."
            />
          ) : (
            <Perturbations reponse={reponse} />
          )}
        </div>
      </section>
    </Container>
  );
}

/**
 * Ce qu'un lecteur d'écran entend une fois le chargement terminé.
 *
 * Vide tant que rien n'est arrivé : une zone d'état vide n'annonce rien, ce
 * qui laisse le `Spinner` faire son travail sans concurrence.
 */
function annonce(reponse: AlertsResponse | null): string {
  if (!reponse) {
    return "";
  }

  if (reponse.items.length === 0) {
    return "Aucune perturbation en cours sur le réseau.";
  }

  return reponse.items.length === 1
    ? "1 perturbation signalée."
    : `${reponse.items.length} perturbations signalées.`;
}

// ---------------------------------------------------------------------------
// Liste
// ---------------------------------------------------------------------------

function Perturbations({ reponse }: { reponse: AlertsResponse }) {
  return (
    <section aria-labelledby="liste">
      <h2 id="liste" className="text-ink text-lg font-semibold">
        {reponse.items.length === 1
          ? "1 perturbation signalée"
          : `${reponse.items.length} perturbations signalées`}
      </h2>

      {/* LA TRONCATURE SE DIT. Le serveur plafonne à `limit` et signale par
          `truncated` que des alertes ont été omises. Se taire laisserait
          croire que la liste est complète — et l'endpoint n'offre aucune
          pagination pour aller chercher le reste. */}
      {reponse.truncated && (
        <p
          // PAS de `role="alert"` : ce message apparaît EN MÊME TEMPS que la
          // liste, il n'interrompt donc rien et n'a pas à être crié. Le mot
          // « incomplète », en gras et en tête de phrase, suffit — la couleur
          // ambre ne fait que le renforcer (WCAG 1.4.1).
          className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          <span className="font-medium">Cette liste est incomplète.</span> Le réseau signale plus de{" "}
          {reponse.limit} perturbations ; seules les {reponse.limit} plus graves sont affichées.
        </p>
      )}

      {/* Une liste ORDONNÉE : l'ordre est porteur de sens — les perturbations
          les plus graves viennent en premier, ce n'est pas une énumération
          quelconque. L'ordre vient du serveur et n'est jamais retrié ici. */}
      <ol className="mt-4 space-y-4">
        {reponse.items.map((alerte) => (
          <li key={alerte.id}>
            <Perturbation alerte={alerte} />
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Une perturbation
// ---------------------------------------------------------------------------

function Perturbation({ alerte }: { alerte: Alert }) {
  const gravite = GRAVITES[alerte.severity];

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        {/* Le mot « Perturbation majeure » est lu ET vu : la couleur ne fait
            que renforcer une information déjà écrite. */}
        <span className={`rounded-full border px-3 py-0.5 text-xs font-medium ${gravite.classes}`}>
          {gravite.libelle}
        </span>
        <span className="text-xs text-neutral-600">{MODES[alerte.mode]}</span>
      </div>

      {/*
        LE TITRE EST CELUI DE L'OPÉRATEUR, ou rien.

        `headerText` est nul quand le flux n'a publié aucun texte. On affiche
        alors un titre NEUTRE, qui ne prétend rien : composer « Maintenance —
        service réduit » ferait passer notre phrase pour la sienne. La cause et
        la conséquence restent affichées plus bas, dans des champs étiquetés.
      */}
      <h3 className="text-ink mt-3 font-semibold">
        {alerte.headerText ?? `Perturbation signalée sur le réseau ${MODES[alerte.mode]}`}
      </h3>

      {alerte.descriptionText && (
        <p className="mt-2 text-sm leading-relaxed text-neutral-700">{alerte.descriptionText}</p>
      )}

      <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Champ libelle="Cause">{CAUSES[alerte.cause] ?? alerte.cause}</Champ>
        <Champ libelle="Conséquence">{EFFETS[alerte.effect] ?? alerte.effect}</Champ>

        <Champ libelle="Depuis">
          {/* `<time>` porte la date lisible par une machine ; le texte reste
              lisible par un humain. */}
          <time dateTime={alerte.startTime}>{formaterDateHeure(alerte.startTime)}</time>
        </Champ>

        <Champ libelle="Jusqu'au">
          {alerte.endTime ? (
            <time dateTime={alerte.endTime}>{formaterDateHeure(alerte.endTime)}</time>
          ) : (
            // AUCUNE DATE N'EST INVENTÉE quand l'opérateur n'en annonce pas :
            // afficher une échéance arbitraire serait un mensonge, et rien ne
            // la distinguerait ensuite d'une vraie.
            "Aucune fin annoncée"
          )}
        </Champ>

        {alerte.lines.length > 0 && (
          <Champ libelle={alerte.lines.length === 1 ? "Ligne concernée" : "Lignes concernées"}>
            {/* Le NOM quand nous le connaissons, l'identifiant sinon : une
                ligne absente de notre référentiel vaut mieux affichée que
                passée sous silence. */}
            {alerte.lines.map((ligne) => ligne.name ?? ligne.id).join(", ")}
          </Champ>
        )}

        {alerte.stopIds.length > 0 && (
          <Champ libelle={alerte.stopIds.length === 1 ? "Arrêt concerné" : "Arrêts concernés"}>
            {alerte.stopIds.length}
          </Champ>
        )}
      </dl>
    </Card>
  );
}

/// Un couple libellé / valeur, dans une vraie liste de définitions.
function Champ({ libelle, children }: { libelle: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-neutral-600">{libelle}</dt>
      <dd className="text-ink mt-0.5">{children}</dd>
    </div>
  );
}
