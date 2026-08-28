"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { ButtonLink } from "@/components/Button";
import { Card } from "@/components/Card";
import { Container } from "@/components/Container";
import { EmptyState } from "@/components/EmptyState";
import { ErrorMessage } from "@/components/ErrorMessage";
import { RequireAuth } from "@/components/RequireAuth";
import { Spinner } from "@/components/Spinner";
import { ApiError, messageDErreur } from "@/lib/api";
import { detailTrajet } from "@/lib/espace-api";
import { listerArrets } from "@/lib/itineraires-api";
import { formaterCo2, formaterDate, formaterDistance, formaterDuree } from "@/lib/format";
import type { RouteDetail, TransportMode } from "@/lib/types";

// =============================================================================
// Détail d'un trajet enregistré (étape 5A-8)
// =============================================================================
// L'IDENTIFIANT VIENT DE `useParams`, PAS DE LA PROPRIÉTÉ `params`.
//
// Dans cette version de Next.js, `params` est une PROMESSE — une rupture par
// rapport aux versions antérieures, où c'était un objet simple. Un composant
// client ne pouvant pas être `async`, il faudrait la dérouler avec `use()`…
// ce qui SUSPEND le composant, et exige donc une frontière Suspense au-dessus.
//
// `useParams` est le hook prévu pour les composants clients : il rend
// l'identifiant directement, sans suspension ni frontière à prévoir. Cette
// page étant entièrement cliente — elle a besoin du jeton, donc du
// navigateur — c'est la forme adaptée.
// =============================================================================

/// Libellés français des modes : « WALK » ne se montre pas à un usager.
const MODES: Record<TransportMode, string> = {
  WALK: "Marche",
  BUS: "Bus",
  TRAM: "Tram",
  METRO: "Métro",
  BIKE: "Vélo",
  ESCOOTER: "Trottinette",
  CAR: "Voiture",
};

export default function DetailTrajetPage() {
  // Typé par le générique : `id` est le nom du segment dynamique du dossier
  // `[id]`. Il peut manquer si la route change un jour de forme — d'où le
  // repli sur une chaîne vide, qui produira un 404 explicite plutôt qu'un
  // appel à `/routes/undefined`.
  const { id } = useParams<{ id: string }>();

  return (
    <RequireAuth>
      <ContenuDetail id={id ?? ""} />
    </RequireAuth>
  );
}

function ContenuDetail({ id }: { id: string }) {
  const { jeton } = useAuth();

  const [trajet, setTrajet] = useState<RouteDetail | null>(null);
  /// Identifiant interne d'arrêt → son nom, pour rendre les segments
  /// lisibles : ceux-ci ne portent que des identifiants.
  const [arrets, setArrets] = useState<Map<string, string>>(new Map());
  const [erreur, setErreur] = useState<string | null>(null);
  const [introuvable, setIntrouvable] = useState(false);

  useEffect(() => {
    if (!jeton) {
      return;
    }

    let abandonne = false;

    // Deux appels en parallèle : le trajet et le référentiel des arrêts.
    // Le second sert uniquement à traduire des identifiants en noms, et son
    // échec ne doit pas empêcher d'afficher le trajet — d'où `allSettled`,
    // comme en 5A-6 pour l'empreinte carbone.
    Promise.allSettled([detailTrajet(jeton, id), listerArrets()]).then(
      ([sortTrajet, sortArrets]) => {
        if (abandonne) return;

        if (sortTrajet.status === "fulfilled") {
          setTrajet(sortTrajet.value);
          setErreur(null);
          setIntrouvable(false);
        } else {
          const echec: unknown = sortTrajet.reason;
          // 404 : le trajet n'existe pas, OU appartient à quelqu'un d'autre.
          // Le backend répond délibérément la MÊME chose dans les deux cas —
          // dire « ce trajet appartient à un autre usager » révélerait son
          // existence. Le frontend ne doit donc pas non plus faire la
          // différence.
          setIntrouvable(echec instanceof ApiError && echec.status === 404);
          setErreur(messageDErreur(echec));
          setTrajet(null);
        }

        if (sortArrets.status === "fulfilled") {
          // Indexé par `id` INTERNE, car c'est lui que portent les segments
          // (`fromStopId`, `toStopId`). Surtout PAS par `gtfsStopId` : celui-ci
          // est nul pour tout arrêt saisi à la main, qui perdrait alors son
          // nom sans raison.
          setArrets(new Map(sortArrets.value.map((arret) => [arret.id, arret.name])));
        }
      },
    );

    return () => {
      abandonne = true;
    };
  }, [jeton, id]);

  return (
    <Container>
      <section className="py-10 sm:py-14">
        <p className="text-sm">
          <Link href="/historique" className="text-brand font-medium underline">
            ← Retour à l&apos;historique
          </Link>
        </p>

        {introuvable ? (
          <div className="mt-8">
            <EmptyState
              title="Trajet introuvable"
              description="Ce trajet n'existe pas, ou n'est plus disponible."
              action={<ButtonLink href="/historique">Revenir à l&apos;historique</ButtonLink>}
            />
          </div>
        ) : erreur ? (
          <div className="mt-8">
            <ErrorMessage title="Ce trajet n'a pas pu être chargé">{erreur}</ErrorMessage>
          </div>
        ) : !trajet ? (
          <div className="mt-8">
            <Spinner label="Chargement du trajet…" />
          </div>
        ) : (
          <div className="mt-6 space-y-8">
            <Resume trajet={trajet} arrets={arrets} />
            <Segments trajet={trajet} arrets={arrets} />
            <Carbone trajet={trajet} />
          </div>
        )}
      </section>
    </Container>
  );
}

// ---------------------------------------------------------------------------
// Résumé
// ---------------------------------------------------------------------------

/**
 * Informations générales.
 *
 * LE DÉPART ET L'ARRIVÉE VIENNENT DES SEGMENTS, pas de `originLat`/`originLng`.
 * Le modèle `Route` ne stocke que les coordonnées SAISIES ; les arrêts
 * réellement empruntés sont ceux du premier et du dernier segment. Ce sont
 * eux qui ont un nom, donc un sens pour l'usager.
 */
function Resume({ trajet, arrets }: { trajet: RouteDetail; arrets: Map<string, string> }) {
  const premier = trajet.segments[0];
  const dernier = trajet.segments[trajet.segments.length - 1];

  const depart = premier ? (arrets.get(premier.fromStopId) ?? null) : null;
  const arrivee = dernier ? (arrets.get(dernier.toStopId) ?? null) : null;

  return (
    <div>
      <h1 className="text-ink text-2xl font-semibold tracking-tight sm:text-3xl">
        {depart && arrivee ? `${depart} → ${arrivee}` : "Trajet enregistré"}
      </h1>
      <p className="mt-2 text-neutral-700">
        <time dateTime={trajet.requestedAt}>{formaterDate(trajet.requestedAt)}</time>
      </p>

      <Card>
        <dl className="mt-0 grid gap-4 sm:grid-cols-4">
          <Chiffre libelle="Durée" valeur={formaterDuree(trajet.totalDurationMin)} />
          <Chiffre libelle="Distance" valeur={formaterDistance(trajet.totalDistanceM)} />
          <Chiffre libelle="CO₂ émis" valeur={formaterCo2(trajet.carbonEstimate)} />
          <Chiffre libelle="Éco-score" valeur={`${Math.round(trajet.ecoScore)}/100`} eco />
        </dl>
      </Card>
    </div>
  );
}

function Chiffre({ libelle, valeur, eco }: { libelle: string; valeur: string; eco?: boolean }) {
  return (
    <div>
      <dt className="text-sm text-neutral-600">{libelle}</dt>
      <dd className={`mt-0.5 font-semibold ${eco ? "text-eco" : "text-ink"}`}>{valeur}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

/**
 * Les étapes, dans l'ordre du trajet.
 *
 * Le backend les rend triés par `departureTime` croissant — un `orderBy`
 * explicite, parce que « sans lui, PostgreSQL ne promet aucun ordre de
 * lignes ». On les affiche donc tels quels, dans une liste ORDONNÉE.
 */
function Segments({ trajet, arrets }: { trajet: RouteDetail; arrets: Map<string, string> }) {
  /// Heure seule : la date figure déjà dans le résumé.
  const heure = (iso: string) =>
    new Date(iso).toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <section aria-labelledby="etapes">
      <h2 id="etapes" className="text-ink text-lg font-semibold">
        Étapes du trajet
      </h2>

      <ol className="mt-3 space-y-3">
        {trajet.segments.map((segment) => (
          <li key={segment.id}>
            <Card>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-ink font-medium">
                    {arrets.get(segment.fromStopId) ?? "Arrêt inconnu"} →{" "}
                    {arrets.get(segment.toStopId) ?? "Arrêt inconnu"}
                  </p>
                  <p className="mt-1 text-sm text-neutral-600">
                    {/* `line` et `operator` sont RECOPIÉS dans le segment au
                        moment de l'enregistrement : ils décrivent le réseau
                        tel qu'il était ce jour-là. */}
                    {MODES[segment.mode]} {segment.line} · {segment.operator}
                  </p>
                </div>

                <p className="text-sm text-neutral-600 sm:text-right">
                  <time dateTime={segment.departureTime}>{heure(segment.departureTime)}</time>
                  {" → "}
                  <time dateTime={segment.arrivalTime}>{heure(segment.arrivalTime)}</time>
                  <br />
                  {formaterDistance(segment.distanceM)}
                </p>
              </div>
            </Card>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Empreinte carbone
// ---------------------------------------------------------------------------

/**
 * Les enregistrements carbone, présentés SÉPARÉMENT des étapes.
 *
 * ⚠️ C'EST LA PRÉCAUTION CENTRALE DE CETTE PAGE. Il serait tentant d'afficher
 * `carbonRecords[i]` sous `segments[i]`. **Cette association n'existe pas** :
 * un `CarbonRecord` ne porte aucun `segmentId`, et le backend les trie par
 * distance décroissante — un ordre « arbitraire mais TOTAL », choisi pour être
 * déterministe, non pour refléter le trajet.
 *
 * Les aligner attribuerait donc un CO₂ à la mauvaise étape, sans qu'aucune
 * erreur ne se voie. On les présente pour ce qu'ils sont : la répartition par
 * MODE et par distance de l'empreinte du trajet.
 */
function Carbone({ trajet }: { trajet: RouteDetail }) {
  if (trajet.carbonRecords.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="carbone">
      <h2 id="carbone" className="text-ink text-lg font-semibold">
        Répartition de l&apos;empreinte carbone
      </h2>
      <p className="mt-1 text-sm text-neutral-600">
        Ces enregistrements décrivent l&apos;empreinte du trajet par mode et par distance. Ils ne
        correspondent pas un à un aux étapes ci-dessus.
      </p>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Émissions de CO₂ par mode de transport</caption>
            <thead>
              <tr className="text-left text-neutral-600">
                <th scope="col" className="pb-2 font-medium">
                  Mode
                </th>
                <th scope="col" className="pb-2 font-medium">
                  Distance
                </th>
                <th scope="col" className="pb-2 font-medium">
                  CO₂ émis
                </th>
                <th scope="col" className="pb-2 font-medium">
                  Économisé
                </th>
              </tr>
            </thead>
            <tbody>
              {trajet.carbonRecords.map((record) => (
                <tr key={record.id} className="border-t border-neutral-200">
                  <th scope="row" className="text-ink py-2 pr-4 text-left font-medium">
                    {MODES[record.mode]}
                  </th>
                  <td className="py-2 pr-4">{formaterDistance(record.distanceM)}</td>
                  <td className="py-2 pr-4">{formaterCo2(record.co2Grams)}</td>
                  <td className="text-eco py-2 font-medium">
                    {formaterCo2(record.savedVsCarGrams)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </section>
  );
}
