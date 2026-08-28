"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { ButtonLink } from "@/components/Button";
import { Card } from "@/components/Card";
import { Container } from "@/components/Container";
import { EmptyState } from "@/components/EmptyState";
import { ErrorMessage } from "@/components/ErrorMessage";
import { RequireAuth } from "@/components/RequireAuth";
import { Spinner } from "@/components/Spinner";
import { messageDErreur } from "@/lib/api";
import { historiqueTrajets } from "@/lib/espace-api";
import { formaterCo2, formaterDate, formaterDistance, formaterDuree } from "@/lib/format";
import type { PaginatedRoutes } from "@/lib/types";

// =============================================================================
// Historique paginé des trajets (étape 5A-8)
// =============================================================================
// Complète l'aperçu de `/mon-espace`, qui n'affiche que les cinq derniers
// trajets. Ici, tout l'historique est parcourable.
//
// LA PAGE COURANTE EST DANS L'ÉTAT LOCAL, pas dans l'URL. Conséquence
// assumée : `/historique` ramène toujours à la page 1, et une page précise ne
// se partage pas par lien. La synchroniser demanderait de lire les paramètres
// au montage, de les réécrire à chaque navigation et de gérer le retour
// arrière — pour un historique personnel, que personne ne partage, la
// complexité ne se justifie pas. Le choix est le même qu'en 5A-5 pour la
// recherche, et pour la même raison.
// =============================================================================

/// Trajets par page. 10 tient sur un écran de téléphone sans défilement
/// interminable ; le backend plafonne `limit` à 50.
const PAR_PAGE = 10;

export default function HistoriquePage() {
  return (
    <RequireAuth>
      <ContenuHistorique />
    </RequireAuth>
  );
}

function ContenuHistorique() {
  const { jeton } = useAuth();

  const [page, setPage] = useState(1);
  const [donnees, setDonnees] = useState<PaginatedRoutes | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    if (!jeton) {
      return;
    }

    let abandonne = false;

    historiqueTrajets(jeton, PAR_PAGE, page)
      .then((reponse) => {
        if (abandonne) return;
        setDonnees(reponse);
        setErreur(null);
      })
      .catch((echec: unknown) => {
        if (abandonne) return;
        setErreur(messageDErreur(echec));
        // Les données de la page précédente n'ont plus cours : les laisser
        // afficherait une liste qui ne correspond pas à la page demandée.
        setDonnees(null);
      });

    return () => {
      abandonne = true;
    };
  }, [jeton, page]);

  return (
    <Container>
      <section className="py-10 sm:py-14">
        <h1 className="text-ink text-2xl font-semibold tracking-tight sm:text-3xl">
          Mon historique
        </h1>
        <p className="mt-3 max-w-2xl text-neutral-700">
          Tous les trajets que vous avez enregistrés, du plus récent au plus ancien.
        </p>

        <div className="mt-8">
          {erreur ? (
            <ErrorMessage title="Votre historique n'a pas pu être chargé">{erreur}</ErrorMessage>
          ) : !donnees ? (
            <Spinner label="Chargement de votre historique…" />
          ) : donnees.total === 0 ? (
            <EmptyState
              title="Aucun trajet enregistré"
              description="Recherchez un itinéraire puis enregistrez-le : vous le retrouverez ici."
              action={<ButtonLink href="/recherche">Rechercher un itinéraire</ButtonLink>}
            />
          ) : (
            <>
              <ListeTrajets donnees={donnees} />
              <Pagination donnees={donnees} onChanger={setPage} />
            </>
          )}
        </div>
      </section>
    </Container>
  );
}

// ---------------------------------------------------------------------------
// Liste
// ---------------------------------------------------------------------------

/**
 * Une carte par trajet.
 *
 * CE QUI N'EST PAS AFFICHÉ, ET POURQUOI. `GET /api/routes` rend les
 * coordonnées de départ et d'arrivée, pas des NOMS de lieux : le modèle
 * `Route` ne stocke que des latitudes et longitudes. Afficher
 * « 48.880, 2.355 → 48.853, 2.369 » n'apprendrait rien à personne, et
 * retrouver les arrêts correspondants exigerait un appel par trajet — le
 * N+1 que la consigne interdit.
 *
 * Les noms d'arrêts existent dans les SEGMENTS, que seul le détail rend.
 * C'est donc là qu'ils sont affichés.
 */
function ListeTrajets({ donnees }: { donnees: PaginatedRoutes }) {
  return (
    <ul className="space-y-3">
      {donnees.items.map((trajet) => (
        <li key={trajet.id}>
          <Card>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                {/* `<time>` : la date reste lisible par une machine tout en
                    étant écrite en français. */}
                <time dateTime={trajet.requestedAt} className="text-ink font-medium">
                  {formaterDate(trajet.requestedAt)}
                </time>
                <p className="mt-1 text-sm text-neutral-600">
                  {formaterDistance(trajet.totalDistanceM)} ·{" "}
                  {formaterDuree(trajet.totalDurationMin)}
                </p>
              </div>

              <div className="flex items-center gap-6">
                <dl className="flex gap-6 text-sm">
                  <div>
                    <dt className="text-neutral-600">CO₂</dt>
                    <dd className="text-ink font-medium">{formaterCo2(trajet.carbonEstimate)}</dd>
                  </div>
                  <div>
                    <dt className="text-neutral-600">Éco-score</dt>
                    <dd className="text-eco font-medium">{Math.round(trajet.ecoScore)}/100</dd>
                  </div>
                </dl>

                {/* Un vrai lien : cela NAVIGUE, cela n'agit pas sur la page.
                    Le libellé nomme le trajet concerné — « Voir le détail »
                    répété dix fois serait indistinguable au lecteur d'écran. */}
                <Link
                  href={`/historique/${trajet.id}`}
                  className="text-brand shrink-0 text-sm font-medium underline"
                >
                  Voir le détail
                  <span className="sr-only"> du trajet du {formaterDate(trajet.requestedAt)}</span>
                </Link>
              </div>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

function Pagination({
  donnees,
  onChanger,
}: {
  donnees: PaginatedRoutes;
  onChanger: (page: number) => void;
}) {
  // Le backend rend `total` et `limit` : le nombre de pages s'en déduit, il
  // n'a pas à être stocké ni deviné.
  const pages = Math.max(1, Math.ceil(donnees.total / donnees.limit));
  const premiere = donnees.page <= 1;
  const derniere = donnees.page >= pages;

  if (pages === 1) {
    // Une seule page : des boutons tous deux désactivés n'apprendraient rien.
    return null;
  }

  return (
    <nav
      aria-label="Pages de l'historique"
      className="mt-6 flex items-center justify-between gap-4"
    >
      <button
        type="button"
        // Désactivé aux extrémités : cliquer demanderait une page 0 ou une
        // page au-delà du total, que le backend refuserait en 400.
        disabled={premiere}
        onClick={() => onChanger(donnees.page - 1)}
        className="text-ink rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Précédent
      </button>

      {/* `aria-live` : le changement de page est annoncé sans que l'usager
          ait à retrouver ce texte lui-même. */}
      <p aria-live="polite" className="text-sm text-neutral-700">
        Page {donnees.page} sur {pages}
        <span className="sr-only">
          , {donnees.total} trajet{donnees.total > 1 ? "s" : ""} au total
        </span>
      </p>

      <button
        type="button"
        disabled={derniere}
        onClick={() => onChanger(donnees.page + 1)}
        className="text-ink rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Suivant
      </button>
    </nav>
  );
}
