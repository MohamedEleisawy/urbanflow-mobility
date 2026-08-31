"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { Button, ButtonLink } from "@/components/Button";
import { Card } from "@/components/Card";
import { Carte } from "@/components/Carte";
import { Container } from "@/components/Container";
import { EmptyState } from "@/components/EmptyState";
import { ErrorMessage } from "@/components/ErrorMessage";
import { RequireAuth } from "@/components/RequireAuth";
import { Spinner } from "@/components/Spinner";
import { ApiError, messageDErreur } from "@/lib/api";
import { indexerArrets, pointDepuisArret, traceDepuisSegments } from "@/lib/carte";
import { detailTrajet } from "@/lib/espace-api";
import { listerArrets, supprimerTrajet } from "@/lib/itineraires-api";
import {
  formaterCo2,
  formaterDate,
  formaterDistance,
  formaterDuree,
  LIBELLES_MODES,
} from "@/lib/format";
import type { RouteDetail, Stop } from "@/lib/types";

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

/**
 * Où en est la suppression (étape 5A-9).
 *
 * QUATRE ÉTATS, ET LE DEUXIÈME EST TOUT L'INTÉRÊT. « confirmation » n'a
 * déclenché AUCUN appel réseau : c'est un simple état d'interface, réversible
 * tant que l'usager n'a pas confirmé. Une action destructive ne doit jamais
 * partir sur un seul clic.
 *
 * « echec » conserve le message ET laisse les deux boutons : un échec doit
 * pouvoir se réessayer.
 */
type EtatSuppression =
  | { statut: "repos" }
  | { statut: "confirmation" }
  | { statut: "suppression" }
  | { statut: "echec"; message: string };

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
  /**
   * Arrêts du réseau, CONSERVÉS ENTIERS depuis le bloc 5B.
   *
   * Avant, seul le nom était retenu (`Map<id, nom>`). La carte a besoin des
   * coordonnées, présentes dans la MÊME réponse : les garder évite un second
   * appel — et surtout un appel par étape, soit le N+1 que le dossier
   * proscrit.
   */
  const [arrets, setArrets] = useState<Stop[]>([]);
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
          setArrets(sortArrets.value);
        }
      },
    );

    return () => {
      abandonne = true;
    };
  }, [jeton, id]);

  // Indexé par `id` INTERNE, car c'est lui que portent les segments
  // (`fromStopId`, `toStopId`). Surtout PAS par `gtfsStopId` : celui-ci est
  // nul pour tout arrêt saisi à la main, qui perdrait alors son nom.
  const index = useMemo(() => indexerArrets(arrets), [arrets]);
  const noms = useMemo(() => new Map(arrets.map((arret) => [arret.id, arret.name])), [arrets]);
  const pointsReseau = useMemo(() => arrets.map(pointDepuisArret), [arrets]);
  const trace = trajet ? traceDepuisSegments(trajet.segments, index) : null;

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
            <Resume trajet={trajet} arrets={noms} />
            <Carte
              titre="Ce trajet sur la carte"
              description={descriptionCarte(trajet, trace !== null)}
              arrets={pointsReseau}
              trace={trace}
            />
            <Segments trajet={trajet} arrets={noms} />
            <Carbone trajet={trajet} />
            <Suppression id={id} />
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
                    {LIBELLES_MODES[segment.mode]} {segment.line} · {segment.operator}
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
                    {LIBELLES_MODES[record.mode]}
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

// ---------------------------------------------------------------------------
// Suppression du trajet (étape 5A-9)
// ---------------------------------------------------------------------------

/**
 * Supprime le trajet, après une confirmation explicite.
 *
 * POURQUOI UNE CONFIRMATION EN LIGNE, ET NON UNE FENÊTRE MODALE. Une modale
 * accessible demande de piéger le focus, de gérer la touche Échap, de rendre
 * inerte le reste de la page — soit une bibliothèque, soit beaucoup de code
 * délicat. Une confirmation en ligne obtient la garantie recherchée — deux
 * gestes distincts au lieu d'un — avec les primitives déjà présentes.
 *
 * LE PREMIER CLIC NE SUPPRIME RIEN. Il ouvre l'état de confirmation, dans
 * lequel aucun appel réseau n'a encore eu lieu et d'où l'on peut revenir.
 */
function Suppression({ id }: { id: string }) {
  const { jeton } = useAuth();
  const router = useRouter();

  const [etat, setEtat] = useState<EtatSuppression>({ statut: "repos" });
  const annulerRef = useRef<HTMLButtonElement>(null);

  const enConfirmation = etat.statut === "confirmation" || etat.statut === "echec";
  const enCours = etat.statut === "suppression";

  useEffect(() => {
    // Le focus va sur ANNULER, jamais sur Confirmer : sur une action
    // destructive, le geste par défaut doit être celui qui ne détruit rien.
    // Sans cela, un usager au clavier confirmerait en appuyant sur Entrée.
    if (etat.statut === "confirmation") {
      annulerRef.current?.focus();
    }
  }, [etat.statut]);

  const confirmer = async () => {
    if (!jeton) {
      return;
    }

    setEtat({ statut: "suppression" });

    try {
      await supprimerTrajet(jeton, id);

      // On ne quitte la page QU'APRÈS la confirmation du serveur. `replace`
      // et non `push` : revenir en arrière ramènerait sur le détail d'un
      // trajet qui n'existe plus, donc sur un 404.
      router.replace("/historique");
    } catch (echec) {
      // Le trajet reste affiché : rien n'a été retiré localement, et il n'y
      // avait rien à remettre. L'usager peut réessayer ou renoncer.
      setEtat({ statut: "echec", message: messageDErreur(echec) });
    }
  };

  if (!enConfirmation && !enCours) {
    return (
      <section aria-labelledby="suppression">
        <h2 id="suppression" className="text-ink text-lg font-semibold">
          Supprimer ce trajet
        </h2>
        <p className="mt-1 text-sm text-neutral-600">
          Le trajet sera retiré de votre historique et de votre suivi carbone.
        </p>
        <div className="mt-3">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setEtat({ statut: "confirmation" })}
            className="w-full sm:w-auto"
          >
            Supprimer ce trajet
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="suppression">
      <h2 id="suppression" className="text-ink text-lg font-semibold">
        Supprimer ce trajet
      </h2>

      <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-5 py-4">
        {/* Le TEXTE porte l'avertissement, pas seulement le cadre rouge :
            un usager qui ne perçoit pas la couleur doit comprendre la même
            chose (WCAG 1.4.1). */}
        <p className="font-medium text-red-900">Confirmer la suppression de ce trajet ?</p>
        <p className="mt-1 text-sm text-red-800">
          Cette action est définitive. Le trajet et son empreinte carbone seront retirés de votre
          espace.
        </p>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <button
            ref={annulerRef}
            type="button"
            // Désactivé pendant l'envoi : annuler une suppression déjà partie
            // n'annulerait rien, et laisserait croire le contraire.
            disabled={enCours}
            onClick={() => setEtat({ statut: "repos" })}
            className="text-ink rounded-md border border-neutral-300 bg-white px-5 py-2.5 text-sm font-medium transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Annuler
          </button>

          <button
            type="button"
            // Empêche la double soumission : deux DELETE concurrents
            // feraient répondre 404 au second, et afficheraient une erreur
            // pour une suppression pourtant réussie.
            disabled={enCours}
            onClick={() => void confirmer()}
            className="rounded-md bg-red-700 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {enCours ? "Suppression en cours…" : "Confirmer la suppression"}
          </button>
        </div>

        {etat.statut === "echec" && (
          <p role="alert" className="mt-4 text-sm text-red-900">
            <span className="font-medium">Le trajet n&apos;a pas pu être supprimé.</span>{" "}
            {etat.message}
          </p>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Équivalent textuel de la carte (bloc 5B)
// ---------------------------------------------------------------------------

/**
 * Décrit en toutes lettres ce que la carte montre.
 *
 * Le backend ne stocke AUCUNE géométrie de voie — seulement la position des
 * arrêts. Le tracé relie donc les arrêts en segments droits : le texte le dit
 * clairement plutôt que de laisser prendre un schéma pour un relevé.
 */
function descriptionCarte(trajet: RouteDetail, traceDessine: boolean): string {
  const etapes = trajet.segments.length;
  const entete = `${etapes} ${etapes === 1 ? "étape" : "étapes"}, ${formaterDistance(
    trajet.totalDistanceM,
  )} en ${formaterDuree(trajet.totalDurationMin)}.`;

  if (!traceDessine) {
    return `${entete} Le tracé ne peut pas être dessiné : la position d'au moins un arrêt de ce trajet est inconnue. Les étapes restent listées ci-dessous.`;
  }

  return `${entete} Le tracé relie les arrêts desservis en ligne droite : c'est un schéma du trajet, pas le chemin exact suivi par le véhicule. Le détail des étapes est listé ci-dessous.`;
}
