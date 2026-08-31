"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { Card } from "@/components/Card";
import { Container } from "@/components/Container";
import { EmptyState } from "@/components/EmptyState";
import { ErrorMessage } from "@/components/ErrorMessage";
import { RequireAdmin } from "@/components/RequireAdmin";
import { Spinner } from "@/components/Spinner";
import { messageDErreur } from "@/lib/api";
import {
  desactiverUtilisateurAdmin,
  listerUtilisateursAdmin,
  recupererStatsAdmin,
} from "@/lib/admin-api";
import { formaterCo2, formaterDate, formaterDistance, LIBELLES_MODES } from "@/lib/format";
import type { AdminStats, AdminUser, AdminUsersPage } from "@/lib/types";

// =============================================================================
// Back-office administrateur (bloc 6-6)
// =============================================================================
// Premier écran du bloc « Administration » du dossier (§3.2.1). Il donne accès
// aux trois routes protégées par `RolesGuard` : les statistiques anonymisées,
// la liste des comptes, et leur désactivation.
//
// ═══ DEUX SECTIONS INDÉPENDANTES, ET C'EST LE POINT DE STRUCTURE ═══
//
// Statistiques et utilisateurs ont chacun leur état de chargement et leur
// état d'erreur. Ce n'est pas de la symétrie décorative : si `/admin/stats`
// tombe, la liste des comptes doit rester utilisable, et un administrateur
// doit pouvoir continuer à modérer. Un unique `if (erreur) return` en tête de
// page ferait disparaître l'un pour la panne de l'autre.
//
// Les deux appels partent EN PARALLÈLE, parce que deux composants frères
// montés ensemble déclenchent leurs effets ensemble. Aucune orchestration
// n'est nécessaire, et aucune n'a été écrite.
//
// ═══ CE QUI N'EST PAS AFFICHÉ ═══
//
// Rien n'a été ajouté au-delà de ce que les deux endpoints rendent. Pas de
// courbe d'évolution — le backend ne rend aucune série temporelle ; pas de
// « trajets par utilisateur » — ce ratio n'est pas fourni, et le calculer ici
// à partir de deux totaux produirait un chiffre que personne n'a défini.
// =============================================================================

/// Comptes par page. Le backend plafonne `limit` à 50 ; 20 est sa valeur par
/// défaut, et remplit un écran de back-office sans défilement interminable.
const PAR_PAGE = 20;

export default function AdminPage() {
  return (
    <RequireAdmin>
      <ContenuAdmin />
    </RequireAdmin>
  );
}

function ContenuAdmin() {
  return (
    <Container>
      <div className="py-10 sm:py-14">
        <h1 className="text-ink text-2xl font-semibold tracking-tight sm:text-3xl">
          Administration
        </h1>
        <p className="mt-3 max-w-2xl text-neutral-700">
          Tableau de bord anonymisé et gestion des comptes. Les statistiques ne contiennent aucune
          donnée nominative.
        </p>

        <div className="mt-8 space-y-10">
          <SectionStatistiques />
          <SectionUtilisateurs />
        </div>
      </div>
    </Container>
  );
}

// ---------------------------------------------------------------------------
// Statistiques
// ---------------------------------------------------------------------------

function SectionStatistiques() {
  const { jeton } = useAuth();

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    if (!jeton) {
      return;
    }

    // `AbortController` : si l'administrateur quitte la page avant la
    // réponse, la requête est annulée plutôt que d'aboutir dans le vide.
    const controleur = new AbortController();

    recupererStatsAdmin(jeton, controleur.signal)
      .then((reponse) => {
        setStats(reponse);
        setErreur(null);
      })
      .catch((echec: unknown) => {
        if (controleur.signal.aborted) return;
        setErreur(messageDErreur(echec));
      });

    return () => {
      controleur.abort();
    };
  }, [jeton]);

  return (
    <section aria-labelledby="titre-statistiques">
      <h2 id="titre-statistiques" className="text-ink text-lg font-semibold">
        Statistiques
      </h2>

      <div className="mt-3">
        {erreur ? (
          // L'erreur reste CONFINÉE à cette section : la liste des comptes
          // ci-dessous continue de se charger et de fonctionner.
          <ErrorMessage title="Les statistiques n'ont pas pu être chargées">{erreur}</ErrorMessage>
        ) : !stats ? (
          <Spinner label="Chargement des statistiques…" />
        ) : (
          <TableauDeBord stats={stats} />
        )}
      </div>
    </section>
  );
}

function TableauDeBord({ stats }: { stats: AdminStats }) {
  return (
    <div className="space-y-4">
      {/* Une liste de définitions, et non un tableau : ce sont des paires
          libellé/valeur indépendantes, pas des lignes comparables entre
          elles. La sémantique dit ce que la mise en page suggère. */}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Indicateur libelle="Comptes actifs" valeur={formaterNombre(stats.users.active)} />
        <Indicateur libelle="Comptes désactivés" valeur={formaterNombre(stats.users.deleted)} />
        <Indicateur libelle="Trajets enregistrés" valeur={formaterNombre(stats.routes.total)} />
        <Indicateur
          libelle="Distance cumulée"
          valeur={formaterDistance(stats.routes.totalDistanceM)}
        />
        <Indicateur libelle="CO₂ émis" valeur={formaterCo2(stats.carbon.totalCo2Grams)} />
        <Indicateur
          libelle="CO₂ évité"
          valeur={formaterCo2(stats.carbon.totalSavedVsCarGrams)}
          accentue
        />
      </dl>

      <Card>
        <h3 className="text-ink font-medium">Répartition des modes de transport</h3>

        {stats.modeUsage.length === 0 ? (
          // Absence de données, pas panne : aucun trajet n'a encore été
          // enregistré. Le dire d'un ton neutre, comme partout ailleurs.
          <p className="mt-2 text-sm text-neutral-600">
            Aucune étape de trajet n&apos;a encore été enregistrée.
          </p>
        ) : (
          <>
            {/* ⚠️ « ÉTAPES », JAMAIS « TRAJETS ». Le backend compte des
                SEGMENTS, et le champ s'appelle `segmentCount` précisément
                pour l'empêcher d'être lu comme un nombre de trajets : un
                trajet est multimodal, il n'a pas un mode. Écrire « trajets »
                ici retournerait le mensonge que le backend s'est appliqué à
                éviter. */}
            <p className="mt-1 text-sm text-neutral-600">
              Nombre d&apos;étapes empruntant chaque mode. Un trajet multimodal compte une étape par
              mode utilisé.
            </p>

            <ul className="mt-4 space-y-2">
              {stats.modeUsage.map((usage) => (
                <li
                  key={usage.mode}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-neutral-100 pb-2 last:border-0 last:pb-0"
                >
                  <span className="text-ink text-sm font-medium">{LIBELLES_MODES[usage.mode]}</span>
                  <span className="text-sm text-neutral-600">
                    {formaterNombre(usage.segmentCount)} étape
                    {usage.segmentCount > 1 ? "s" : ""} · {formaterDistance(usage.totalDistanceM)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      {/* Le nombre d'enregistrements carbone est donné en note, pas en
          indicateur : il dit sur combien de mesures portent les deux sommes
          ci-dessus. Le présenter au même rang laisserait croire à un nombre
          de trajets — ce qu'il n'est pas. */}
      <p className="text-sm text-neutral-600">
        Les valeurs de CO₂ portent sur {formaterNombre(stats.carbon.recordCount)} enregistrement
        {stats.carbon.recordCount > 1 ? "s" : ""} carbone. Un trajet en produit un par mode
        emprunté.
      </p>
    </div>
  );
}

function Indicateur({
  libelle,
  valeur,
  accentue = false,
}: {
  libelle: string;
  valeur: string;
  accentue?: boolean;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-4 py-3">
      <dt className="text-sm text-neutral-600">{libelle}</dt>
      {/* Le vert désigne le gain carbone, conformément au dossier — et il ne
          porte JAMAIS le sens à lui seul : le libellé le dit déjà. */}
      <dd className={`mt-1 text-xl font-semibold ${accentue ? "text-eco" : "text-ink"}`}>
        {valeur}
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Utilisateurs
// ---------------------------------------------------------------------------

function SectionUtilisateurs() {
  const { jeton, utilisateur } = useAuth();

  const [page, setPage] = useState(1);
  const [donnees, setDonnees] = useState<AdminUsersPage | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  // Incrémenté après une désactivation réussie pour relancer l'effet.
  //
  // POURQUOI RECHARGER PLUTÔT QUE DE MODIFIER LA LIGNE SUR PLACE. Poser
  // `deletedAt` localement obligerait à INVENTER une date — le serveur seul
  // sait à quelle seconde il a désactivé le compte. Un aller-retour, contre
  // une donnée fabriquée affichée comme un fait : le choix est vite fait.
  const [rechargement, setRechargement] = useState(0);

  useEffect(() => {
    if (!jeton) {
      return;
    }

    const controleur = new AbortController();

    listerUtilisateursAdmin(jeton, page, PAR_PAGE, controleur.signal)
      .then((reponse) => {
        setDonnees(reponse);
        setErreur(null);
      })
      .catch((echec: unknown) => {
        if (controleur.signal.aborted) return;
        setErreur(messageDErreur(echec));
        // Les données de la page précédente ne correspondent plus à la page
        // demandée : les garder afficherait une liste trompeuse.
        setDonnees(null);
      });

    return () => {
      controleur.abort();
    };
  }, [jeton, page, rechargement]);

  const recharger = useCallback(() => {
    setRechargement((n) => n + 1);
  }, []);

  return (
    <section aria-labelledby="titre-utilisateurs">
      <h2 id="titre-utilisateurs" className="text-ink text-lg font-semibold">
        Utilisateurs
      </h2>

      <div className="mt-3">
        {erreur ? (
          <ErrorMessage title="La liste des comptes n'a pas pu être chargée">{erreur}</ErrorMessage>
        ) : !donnees ? (
          <Spinner label="Chargement des comptes…" />
        ) : donnees.total === 0 ? (
          <EmptyState title="Aucun compte" description="La base ne contient aucun utilisateur." />
        ) : (
          <>
            <TableauUtilisateurs
              donnees={donnees}
              jeton={jeton}
              idCourant={utilisateur?.id ?? null}
              onDesactive={recharger}
            />
            <Pagination donnees={donnees} onChanger={setPage} />
          </>
        )}
      </div>
    </section>
  );
}

/**
 * Où en est la désactivation en cours, et sur quel compte.
 *
 * UN SEUL ÉTAT POUR TOUTE LA LISTE, plutôt qu'un état par ligne : une seule
 * confirmation peut être ouverte à la fois, ce qui évite qu'un administrateur
 * en laisse trois entrouvertes et confirme la mauvaise.
 */
type EtatModeration =
  | { statut: "repos" }
  | { statut: "confirmation"; id: string }
  | { statut: "envoi"; id: string }
  | { statut: "echec"; id: string; message: string }
  | { statut: "succes"; email: string };

function TableauUtilisateurs({
  donnees,
  jeton,
  idCourant,
  onDesactive,
}: {
  donnees: AdminUsersPage;
  jeton: string | null;
  idCourant: string | null;
  onDesactive: () => void;
}) {
  const [etat, setEtat] = useState<EtatModeration>({ statut: "repos" });

  const confirmer = async (compte: AdminUser) => {
    if (!jeton) {
      return;
    }

    setEtat({ statut: "envoi", id: compte.id });

    try {
      await desactiverUtilisateurAdmin(jeton, compte.id);
      setEtat({ statut: "succes", email: compte.email });
      onDesactive();
    } catch (echec) {
      // LA LISTE N'EST PAS TOUCHÉE : l'échec ne vit que dans cet état local,
      // et `donnees` reste affiché tel quel. Un administrateur ne perd pas sa
      // page parce qu'une suppression a échoué.
      setEtat({ statut: "echec", id: compte.id, message: messageDErreur(echec) });
    }
  };

  return (
    <>
      {/* `role="status"` pour un succès, `role="alert"` pour un échec : le
          premier attend une pause dans la lecture, le second interrompt. */}
      {etat.statut === "succes" && (
        <p
          role="status"
          className="mb-4 rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-700"
        >
          Le compte <span className="font-medium">{etat.email}</span> a été désactivé. Il apparaît
          désormais comme désactivé dans la liste : la suppression est logique, les données ne sont
          pas détruites.
        </p>
      )}

      {etat.statut === "echec" && (
        <div className="mb-4">
          <ErrorMessage title="Le compte n'a pas pu être désactivé">
            {etat.message} La liste est inchangée.
          </ErrorMessage>
        </div>
      )}

      {/*
        RESPONSIVE : un défilement horizontal, pas des colonnes masquées.

        Le rôle et la date de création comptent autant sur téléphone que sur
        écran large — les faire disparaître obligerait un administrateur à
        changer d'appareil pour modérer. La région est `tabIndex={0}` et
        nommée : sans cela, un usager au clavier ne pourrait pas la faire
        défiler, et un lecteur d'écran ne l'annoncerait pas.
      */}
      <div
        role="region"
        aria-label="Liste des comptes utilisateurs"
        tabIndex={0}
        className="overflow-x-auto rounded-lg border border-neutral-200 bg-white"
      >
        <table className="w-full min-w-[46rem] border-collapse text-left text-sm">
          <caption className="sr-only">
            Comptes utilisateurs, du plus récemment créé au plus ancien. Page {donnees.page},{" "}
            {donnees.total} compte{donnees.total > 1 ? "s" : ""} au total.
          </caption>
          <thead>
            <tr className="border-b border-neutral-200">
              {/* `scope="col"` : sans lui, un lecteur d'écran ne rattache pas
                  les cellules à leur en-tête, et chaque valeur est annoncée
                  sans dire de quoi elle est la valeur. */}
              <th scope="col" className="text-ink px-4 py-3 font-medium">
                Adresse e-mail
              </th>
              <th scope="col" className="text-ink px-4 py-3 font-medium">
                Rôle
              </th>
              <th scope="col" className="text-ink px-4 py-3 font-medium">
                Création
              </th>
              <th scope="col" className="text-ink px-4 py-3 font-medium">
                Statut
              </th>
              <th scope="col" className="text-ink px-4 py-3 font-medium">
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {donnees.items.map((compte) => (
              <LigneUtilisateur
                key={compte.id}
                compte={compte}
                estMoi={compte.id === idCourant}
                etat={etat}
                onDemander={() => setEtat({ statut: "confirmation", id: compte.id })}
                onAnnuler={() => setEtat({ statut: "repos" })}
                onConfirmer={() => void confirmer(compte)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function LigneUtilisateur({
  compte,
  estMoi,
  etat,
  onDemander,
  onAnnuler,
  onConfirmer,
}: {
  compte: AdminUser;
  estMoi: boolean;
  etat: EtatModeration;
  onDemander: () => void;
  onAnnuler: () => void;
  onConfirmer: () => void;
}) {
  const annulerRef = useRef<HTMLButtonElement>(null);

  const cible = "id" in etat && etat.id === compte.id;
  const enConfirmation = cible && (etat.statut === "confirmation" || etat.statut === "echec");
  const enCours = cible && etat.statut === "envoi";
  const desactive = compte.deletedAt !== null;

  useEffect(() => {
    // Le focus va sur ANNULER, jamais sur Confirmer — même règle que la
    // suppression de son propre compte (bloc 5G) : sur une action lourde, le
    // geste par défaut doit être celui qui ne détruit rien.
    if (enConfirmation) {
      annulerRef.current?.focus();
    }
  }, [enConfirmation]);

  return (
    <tr className="border-b border-neutral-100 last:border-0">
      <th scope="row" className="text-ink px-4 py-3 font-normal">
        {compte.email}
        {/* Un administrateur doit pouvoir repérer SA PROPRE ligne : c'est la
            seule qu'il ne pourra pas désactiver. */}
        {estMoi && <span className="ml-2 text-xs text-neutral-500">(vous)</span>}
      </th>

      <td className="px-4 py-3 text-neutral-700">
        {compte.role === "ADMIN" ? "Administrateur" : "Utilisateur"}
      </td>

      <td className="px-4 py-3 text-neutral-700">
        <time dateTime={compte.createdAt}>{formaterDate(compte.createdAt)}</time>
      </td>

      <td className="px-4 py-3">
        {/* LE STATUT EST UN MOT, pas une pastille de couleur : « Désactivé »
            se lit aussi bien par un lecteur d'écran que par un usager
            daltonien (WCAG 1.4.1). */}
        {compte.deletedAt !== null ? (
          <span className="text-neutral-600">
            Désactivé le <time dateTime={compte.deletedAt}>{formaterDate(compte.deletedAt)}</time>
          </span>
        ) : (
          <span className="text-eco font-medium">Actif</span>
        )}
      </td>

      <td className="px-4 py-3">
        <CelluleAction
          compte={compte}
          estMoi={estMoi}
          desactive={desactive}
          enConfirmation={enConfirmation}
          enCours={enCours}
          annulerRef={annulerRef}
          onDemander={onDemander}
          onAnnuler={onAnnuler}
          onConfirmer={onConfirmer}
        />
      </td>
    </tr>
  );
}

function CelluleAction({
  compte,
  estMoi,
  desactive,
  enConfirmation,
  enCours,
  annulerRef,
  onDemander,
  onAnnuler,
  onConfirmer,
}: {
  compte: AdminUser;
  estMoi: boolean;
  desactive: boolean;
  enConfirmation: boolean;
  enCours: boolean;
  annulerRef: React.RefObject<HTMLButtonElement | null>;
  onDemander: () => void;
  onAnnuler: () => void;
  onConfirmer: () => void;
}) {
  // Compte déjà désactivé : le backend répondrait 204 sans rien changer.
  // Offrir un bouton qui ne fait rien serait une fausse promesse.
  if (desactive) {
    return <span className="text-sm text-neutral-500">—</span>;
  }

  // SON PROPRE COMPTE. Ce n'est PAS une duplication de la règle métier :
  // comparer deux identifiants n'est pas rejouer la décision du backend, qui
  // reste seul à trancher — et qui refuse en 400 si l'appel lui parvient
  // quand même. On évite simplement de proposer une action dont on sait
  // qu'elle sera refusée, et on écrit pourquoi.
  //
  // Le rôle de la CIBLE, lui, n'est jamais consulté : le backend autorise un
  // administrateur à en désactiver un autre, et bloquer cela ici inventerait
  // une règle qui n'existe nulle part.
  if (estMoi) {
    return <span className="text-sm text-neutral-500">Votre compte</span>;
  }

  if (!enConfirmation && !enCours) {
    return (
      <button
        type="button"
        onClick={onDemander}
        // Le libellé visible est court — la colonne est étroite — mais chaque
        // bouton doit être distinguable hors contexte : sans cela, un lecteur
        // d'écran annonce vingt fois « Désactiver », sans dire de quel compte.
        //
        // `aria-label` PLUTÔT QU'UN `sr-only`, et c'est une leçon de ce bloc :
        // le calcul du nom accessible rogne les espaces de bord de chaque
        // nœud, si bien que « Désactiver » et « le compte… » se collaient en
        // « Désactiverle compte… ». Un libellé explicite ne dépend d'aucun
        // détail de mise en forme.
        //
        // Le nom accessible CONTIENT le libellé visible (WCAG 2.5.3) : une
        // commande vocale « cliquer sur Désactiver » fonctionne toujours.
        aria-label={`Désactiver le compte ${compte.email}`}
        className="text-ink rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-neutral-50"
      >
        Désactiver
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* LE PREMIER CLIC N'APPELLE RIEN : il ouvre cette confirmation. C'est
          le modèle repris de la suppression de compte (5G) et du trajet
          (5A-9) — une action destructive ne part jamais du premier geste. */}
      <p className="text-ink text-sm font-medium">Désactiver ce compte ?</p>

      <div className="flex gap-2">
        <button
          ref={annulerRef}
          type="button"
          disabled={enCours}
          onClick={onAnnuler}
          className="text-ink rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Annuler
        </button>

        <button
          type="button"
          // Empêche la double soumission : deux DELETE concurrents feraient
          // répondre 204 puis 204 — sans dommage, mais l'interface
          // afficherait deux fois le même message.
          disabled={enCours}
          onClick={onConfirmer}
          aria-label={
            enCours
              ? `Désactivation de ${compte.email} en cours`
              : `Confirmer la désactivation de ${compte.email}`
          }
          className="rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {enCours ? "Désactivation…" : "Confirmer"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

/**
 * Même modèle que l'historique (5A-8) : `total` et `limit` viennent du
 * backend, le nombre de pages s'en déduit. La page courante reste dans
 * l'état local — un back-office ne se partage pas par lien.
 */
function Pagination({
  donnees,
  onChanger,
}: {
  donnees: AdminUsersPage;
  onChanger: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(donnees.total / donnees.limit));
  const premiere = donnees.page <= 1;
  const derniere = donnees.page >= pages;

  if (pages === 1) {
    return null;
  }

  return (
    <nav aria-label="Pages des comptes" className="mt-6 flex items-center justify-between gap-4">
      <button
        type="button"
        // Désactivé aux extrémités : demander une page 0 ou au-delà du total
        // serait refusé en 400 par le backend.
        disabled={premiere}
        onClick={() => onChanger(donnees.page - 1)}
        className="text-ink rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Précédent
      </button>

      <p aria-live="polite" className="text-sm text-neutral-700">
        Page {donnees.page} sur {pages}
        <span className="sr-only">
          , {donnees.total} compte{donnees.total > 1 ? "s" : ""} au total
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

// ---------------------------------------------------------------------------

/// Séparateur de milliers français : « 12 480 » plutôt que « 12480 ».
/// Reste ici plutôt que dans `format.ts` : aucun autre écran n'affiche de
/// grands nombres bruts.
function formaterNombre(valeur: number): string {
  return valeur.toLocaleString("fr-FR");
}
