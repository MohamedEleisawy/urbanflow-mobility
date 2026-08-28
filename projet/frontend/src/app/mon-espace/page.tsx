"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { Card } from "@/components/Card";
import { Container } from "@/components/Container";
import { EmptyState } from "@/components/EmptyState";
import { ErrorMessage } from "@/components/ErrorMessage";
import { RequireAuth } from "@/components/RequireAuth";
import { Spinner } from "@/components/Spinner";
import { ButtonLink } from "@/components/Button";
import { messageDErreur } from "@/lib/api";
import { budgetHebdomadaire, historiqueTrajets, suiviCarbone } from "@/lib/espace-api";
import { formaterCo2, formaterDate, formaterDistance, formaterDuree } from "@/lib/format";
import type { PaginatedRoutes, WeeklyCarbonBudget, WeeklyCarbonTracking } from "@/lib/types";

/// Fenêtre du suivi carbone affichée ici. Quatre semaines : assez pour voir
/// une tendance, assez court pour tenir sur un écran de téléphone. Le backend
/// accepte 1 à 52.
const SEMAINES = 4;

/// Nombre de trajets récents listés. La page complète de l'historique
/// viendra plus tard ; ici on donne un aperçu.
const TRAJETS_RECENTS = 5;

interface Donnees {
  suivi: WeeklyCarbonTracking;
  budget: WeeklyCarbonBudget;
  trajets: PaginatedRoutes;
}

export default function MonEspacePage() {
  // La protection enveloppe le contenu plutôt que d'être appelée dedans : le
  // corps ci-dessous n'est monté QUE pour un usager authentifié, et n'a donc
  // jamais à se demander si le jeton existe.
  return (
    <RequireAuth>
      <ContenuEspace />
    </RequireAuth>
  );
}

function ContenuEspace() {
  const { utilisateur, jeton, deconnexion } = useAuth();

  const [donnees, setDonnees] = useState<Donnees | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    if (!jeton) {
      return;
    }

    let abandonne = false;

    // TROIS APPELS EN PARALLÈLE, et c'est le choix le plus simple — pas une
    // optimisation prématurée. Les trois routes rendent des données
    // DISTINCTES : aucune n'est redondante, aucune ne dépend d'une autre. Les
    // enchaîner les rendrait trois fois plus lents pour exactement le même
    // résultat.
    //
    // Le profil, lui, ne fait PAS l'objet d'un quatrième appel : il est déjà
    // dans le contexte d'authentification, qui l'a relu au chargement de la
    // page. Le redemander serait le seul appel réellement inutile.
    Promise.all([
      suiviCarbone(jeton, SEMAINES),
      budgetHebdomadaire(jeton),
      historiqueTrajets(jeton, TRAJETS_RECENTS),
    ])
      .then(([suivi, budget, trajets]) => {
        if (abandonne) return;
        setDonnees({ suivi, budget, trajets });
      })
      .catch((echec: unknown) => {
        if (abandonne) return;
        // `Promise.all` rejette dès le PREMIER échec : une seule route en
        // panne rend donc toute la page indisponible. C'est assumé à ce
        // stade — un affichage partiel demanderait de distinguer trois états
        // d'erreur, pour un écran qui n'a de sens que complet.
        setErreur(messageDErreur(echec));
      });

    return () => {
      abandonne = true;
    };
  }, [jeton]);

  return (
    <Container>
      <section className="py-10 sm:py-14">
        <h1 className="text-ink text-2xl font-semibold tracking-tight sm:text-3xl">Mon espace</h1>

        <div className="mt-8 space-y-8">
          <Profil
            email={utilisateur?.email ?? ""}
            role={utilisateur?.role ?? "USER"}
            onDeconnexion={deconnexion}
          />

          {erreur && (
            <ErrorMessage title="Vos données n'ont pas pu être chargées">{erreur}</ErrorMessage>
          )}

          {!erreur && !donnees && (
            <div className="py-4">
              <Spinner label="Chargement de vos données…" />
            </div>
          )}

          {donnees && (
            <>
              <Budget budget={donnees.budget} />
              <Carbone suivi={donnees.suivi} />
              <Trajets trajets={donnees.trajets} />
            </>
          )}
        </div>
      </section>
    </Container>
  );
}

// ---------------------------------------------------------------------------
// Profil
// ---------------------------------------------------------------------------

/**
 * Le modèle `User` ne porte NI prénom NI nom : seulement `email`, `role`,
 * `createdAt` et `deletedAt`. On affiche donc l'email — inventer un champ
 * « nom » supposerait de le demander, donc de modifier le backend.
 */
function Profil({
  email,
  role,
  onDeconnexion,
}: {
  email: string;
  role: string;
  onDeconnexion: () => void;
}) {
  return (
    <Card>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-ink text-lg font-semibold">Mon compte</h2>
          {/* <dl> : ce sont des paires étiquette/valeur, et un lecteur
              d'écran les annonce comme telles. */}
          <dl className="mt-3 space-y-1 text-sm">
            <div className="flex gap-2">
              <dt className="text-neutral-600">Email</dt>
              <dd className="text-ink font-medium">{email}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-neutral-600">Rôle</dt>
              <dd className="text-ink font-medium">
                {role === "ADMIN" ? "Administrateur" : "Usager"}
              </dd>
            </div>
          </dl>
        </div>

        <button
          type="button"
          onClick={onDeconnexion}
          className="text-ink self-start rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-neutral-50"
        >
          Se déconnecter
        </button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Budget hebdomadaire
// ---------------------------------------------------------------------------

function Budget({ budget }: { budget: WeeklyCarbonBudget }) {
  // Les trois champs sont nuls ENSEMBLE : sans budget fixé, il n'y a ni
  // reste ni dépassement à annoncer.
  const sansBudget = budget.weeklyBudgetGrams === null;

  return (
    <section aria-labelledby="budget">
      <h2 id="budget" className="text-ink text-lg font-semibold">
        Budget carbone de la semaine
      </h2>

      <div className="mt-3">
        {sansBudget ? (
          <EmptyState
            title="Aucun budget défini"
            description="Fixez un budget hebdomadaire dans vos préférences pour suivre votre consommation par rapport à un objectif."
          />
        ) : (
          <Card>
            <div className="grid gap-4 sm:grid-cols-3">
              <Chiffre libelle="Budget" valeur={formaterCo2(budget.weeklyBudgetGrams!)} />
              <Chiffre libelle="Consommé" valeur={formaterCo2(budget.consumedGrams)} />
              <Chiffre
                libelle={budget.exceeded ? "Dépassement" : "Restant"}
                valeur={formaterCo2(Math.abs(budget.remainingGrams!))}
                // Le vert du dossier désigne le carbone maîtrisé ; un
                // dépassement n'est pas une bonne nouvelle, il ne le porte
                // donc pas. Et le mot change en même temps que la couleur :
                // la couleur seule ne dit rien à qui ne la voit pas.
                accent={budget.exceeded ? "alerte" : "eco"}
              />
            </div>
          </Card>
        )}
      </div>
    </section>
  );
}

function Chiffre({
  libelle,
  valeur,
  accent,
}: {
  libelle: string;
  valeur: string;
  accent?: "eco" | "alerte";
}) {
  const couleur = accent === "eco" ? "text-eco" : accent === "alerte" ? "text-red-700" : "text-ink";

  return (
    <div>
      <p className="text-sm text-neutral-600">{libelle}</p>
      <p className={`mt-1 text-xl font-semibold ${couleur}`}>{valeur}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Suivi carbone
// ---------------------------------------------------------------------------

function Carbone({ suivi }: { suivi: WeeklyCarbonTracking }) {
  return (
    <section aria-labelledby="carbone">
      <h2 id="carbone" className="text-ink text-lg font-semibold">
        Vos {suivi.weeksRequested} dernières semaines
      </h2>

      <div className="mt-3">
        {suivi.weeks.length === 0 ? (
          <EmptyState
            title="Aucun trajet enregistré sur la période"
            description="Votre empreinte carbone apparaîtra ici dès votre premier trajet enregistré."
          />
        ) : (
          <Card>
            {/* Le tableau déborde horizontalement sur mobile plutôt que de
                comprimer ses colonnes jusqu'à l'illisible. */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Émissions de CO₂ par semaine</caption>
                <thead>
                  <tr className="text-left text-neutral-600">
                    {/* `scope="col"` : indispensable pour qu'un lecteur
                        d'écran associe chaque cellule à son en-tête. */}
                    <th scope="col" className="pb-2 font-medium">
                      Semaine
                    </th>
                    <th scope="col" className="pb-2 font-medium">
                      Trajets
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
                  {suivi.weeks.map((semaine) => (
                    <tr
                      key={`${semaine.year}-${semaine.week}`}
                      className="border-t border-neutral-200"
                    >
                      <th scope="row" className="text-ink py-2 pr-4 text-left font-medium">
                        S{semaine.week} {semaine.year}
                      </th>
                      <td className="py-2 pr-4">{semaine.tripCount}</td>
                      <td className="py-2 pr-4">{formaterCo2(semaine.co2Grams)}</td>
                      <td className="text-eco py-2 font-medium">
                        {formaterCo2(semaine.savedVsCarGrams)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Trajets récents
// ---------------------------------------------------------------------------

function Trajets({ trajets }: { trajets: PaginatedRoutes }) {
  return (
    <section aria-labelledby="trajets">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="trajets" className="text-ink text-lg font-semibold">
          Trajets récents
        </h2>
        <div className="flex items-baseline gap-4">
          {trajets.total > trajets.items.length && (
            <p className="text-sm text-neutral-600">
              {trajets.items.length} sur {trajets.total}
            </p>
          )}
          {/* Vers l'historique complet (étape 5A-8) : cet aperçu se limite
              aux cinq derniers trajets. */}
          {trajets.total > 0 && (
            <Link href="/historique" className="text-brand text-sm font-medium underline">
              Voir tout l&apos;historique
            </Link>
          )}
        </div>
      </div>

      <div className="mt-3">
        {trajets.items.length === 0 ? (
          <EmptyState
            title="Aucun trajet enregistré"
            description="Recherchez un itinéraire puis enregistrez-le pour le retrouver ici."
            action={<ButtonLink href="/recherche">Rechercher un itinéraire</ButtonLink>}
          />
        ) : (
          <ul className="space-y-3">
            {trajets.items.map((trajet) => (
              <li key={trajet.id}>
                <Card>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      {/* `<time>` avec `dateTime` : la date reste lisible par
                          une machine tout en étant écrite en français. */}
                      <time dateTime={trajet.requestedAt} className="text-ink font-medium">
                        {formaterDate(trajet.requestedAt)}
                      </time>
                      <p className="mt-1 text-sm text-neutral-600">
                        {formaterDistance(trajet.totalDistanceM)} ·{" "}
                        {formaterDuree(trajet.totalDurationMin)}
                      </p>
                    </div>

                    <div className="flex gap-6 text-sm sm:text-right">
                      <div>
                        <p className="text-neutral-600">CO₂</p>
                        <p className="text-ink font-medium">{formaterCo2(trajet.carbonEstimate)}</p>
                      </div>
                      <div>
                        <p className="text-neutral-600">Éco-score</p>
                        <p className="text-eco font-medium">{Math.round(trajet.ecoScore)}/100</p>
                      </div>
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/*
        Aucun lien vers le détail d'un trajet : la route `/mon-espace/trajets/:id`
        n'existe pas encore. Un lien mort donnerait l'impression d'une
        application cassée — c'est le raisonnement tenu en 5A-2 pour les
        routes en attente.
      */}
    </section>
  );
}
