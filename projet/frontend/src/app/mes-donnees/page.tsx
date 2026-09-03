"use client";

import Link from "next/link";
import { Card } from "@/components/Card";
import { Container } from "@/components/Container";
import { ExportDonnees } from "@/components/ExportDonnees";
import { Preferences } from "@/components/Preferences";
import { RequireAuth } from "@/components/RequireAuth";
import { SupprimerCompte } from "@/components/SupprimerCompte";
import { useAuth } from "@/components/AuthProvider";

// =============================================================================
// Mes données (sprint soutenance)
// =============================================================================
// ═══ POURQUOI UNE PAGE À PART, ALORS QUE TOUT EXISTAIT DÉJÀ ═══
//
// L'export et la suppression de compte vivaient au fond de « Mon espace »,
// entre le tableau de bord carbone et les adresses favorites. Ils y étaient
// fonctionnels et introuvables.
//
// Or le RGPD ne demande pas seulement que ces droits soient exerçables : il
// demande que l'information soit « aisément accessible » (art. 12). Un droit
// qu'on ne trouve qu'en faisant défiler quatre sections n'est pas aisément
// accessible.
//
// ⚠️ AUCUNE DUPLICATION DE LOGIQUE. Cette page RÉUTILISE `ExportDonnees`,
// `Preferences` et `SupprimerCompte`. Recopier leur code donnerait deux
// implémentations à faire évoluer ensemble — et le jour où l'une change,
// l'autre ne suit pas.
//
// ═══ CE QUE CETTE PAGE AJOUTE VRAIMENT ═══
//
// L'INVENTAIRE. Avant de pouvoir exercer un droit sur ses données, il faut
// savoir lesquelles existent. Un bouton « Exporter » sans rien qui dise ce
// qu'il contient demande un acte de foi.
// =============================================================================

/**
 * Ce qui est réellement conservé, catégorie par catégorie.
 *
 * ⚠️ CETTE LISTE DÉCRIT LE SCHÉMA RÉEL — `User`, `UserPreferences`,
 * `FavoriteAddress`, `Route`, `Segment`, `CarbonRecord`, `CarbonBudget`. Elle
 * n'est pas un texte d'intention : chaque ligne correspond à une table.
 *
 * ⚠️ CE QUI N'EST PAS CONSERVÉ Y FIGURE AUSSI, et c'est au moins aussi
 * important. « Vos recherches ne sont pas enregistrées » répond à une
 * inquiétude que la liste des données conservées, seule, laisserait entière.
 */
const CONSERVE: { titre: string; detail: string }[] = [
  {
    titre: "Compte",
    detail:
      "Votre adresse électronique et l’empreinte de votre mot de passe. Le mot de passe lui-même n’est jamais stocké.",
  },
  {
    titre: "Préférences",
    detail:
      "Langue, thème, modes de transport préférés, mode accessibilité, budget carbone hebdomadaire, notifications.",
  },
  {
    titre: "Adresses favorites",
    detail:
      "Les lieux que vous avez nommés vous-même, avec leurs coordonnées.",
  },
  {
    titre: "Trajets enregistrés",
    detail:
      "Les itinéraires que vous avez explicitement sauvegardés, avec leurs segments et leurs horaires.",
  },
  {
    titre: "Empreinte carbone",
    detail:
      "Les émissions calculées pour ces trajets, et le suivi de votre budget hebdomadaire.",
  },
];

const NON_CONSERVE: string[] = [
  "Vos recherches d’itinéraires. Chercher ne laisse aucune trace dans votre compte.",
  "Votre position GPS. Elle vit en mémoire dans l’onglet pendant le guidage, et disparaît dès que vous l’arrêtez.",
  "Votre historique de navigation, votre adresse IP, tout identifiant publicitaire.",
];

export default function MesDonneesPage() {
  return (
    <RequireAuth>
      <Contenu />
    </RequireAuth>
  );
}

function Contenu() {
  const { utilisateur } = useAuth();

  return (
    <Container>
      <div className="max-w-3xl space-y-6 py-8">
        <header>
          <h1 className="text-ink text-3xl font-bold tracking-tight">
            Mes données
          </h1>
          <p className="mt-2 text-neutral-700">
            Ce qu’UrbanFlow conserve à votre sujet, et ce que vous pouvez en
            faire. Le détail des finalités et des durées figure dans la{" "}
            <Link
              href="/confidentialite"
              className="text-brand underline underline-offset-2"
            >
              politique de confidentialité
            </Link>
            .
          </p>
        </header>

        {/* ═══ L'INVENTAIRE ═══
            En premier, parce qu'on ne peut pas décider d'exporter ou de
            supprimer sans savoir de quoi il s'agit. */}
        <Card>
          <h2 className="text-ink text-lg font-semibold">
            Ce qui est conservé
          </h2>

          {utilisateur && (
            <p className="mt-1 text-sm text-neutral-600">
              Compte : <strong>{utilisateur.email}</strong>
            </p>
          )}

          {/* Une liste de définitions, et non des paragraphes : la relation
              « catégorie → contenu » est portée par la sémantique, donc
              annoncée par un lecteur d'écran. */}
          <dl className="mt-4 space-y-3">
            {CONSERVE.map(({ titre, detail }) => (
              <div key={titre}>
                <dt className="text-ink text-sm font-semibold">{titre}</dt>
                <dd className="text-sm text-neutral-700">{detail}</dd>
              </div>
            ))}
          </dl>

          <h3 className="text-ink mt-6 text-sm font-semibold">
            Ce qui n’est pas conservé
          </h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-neutral-700">
            {NON_CONSERVE.map((ligne) => (
              <li key={ligne}>{ligne}</li>
            ))}
          </ul>
        </Card>

        {/* ═══ PORTABILITÉ ═══ */}
        <Card>
          <h2 className="text-ink text-lg font-semibold">
            Exporter mes données
          </h2>
          <p className="mt-1 mb-4 text-sm text-neutral-700">
            Un fichier JSON contenant tout ce qui figure ci-dessus. C’est le
            droit à la portabilité, exercé sans avoir à écrire à quiconque.
          </p>
          <ExportDonnees />
        </Card>

        {/* ═══ RECTIFICATION ═══ */}
        <Card>
          <h2 className="text-ink text-lg font-semibold">
            Modifier mes préférences
          </h2>
          <p className="mt-1 mb-4 text-sm text-neutral-700">
            Ces réglages sont enregistrés sur votre compte et vous suivent d’un
            appareil à l’autre.
          </p>
          <Preferences />
        </Card>

        {/* ═══ EFFACEMENT ═══
            En dernier, et c'est délibéré : une action irréversible ne doit pas
            se trouver sur le chemin d'une action courante. */}
        <Card>
          <h2 className="text-ink text-lg font-semibold">
            Supprimer mon compte
          </h2>
          <p className="mt-1 mb-4 text-sm text-neutral-700">
            Cette action est irréversible. Si vous souhaitez conserver une
            trace de vos trajets, exportez vos données avant.
          </p>
          <SupprimerCompte />
        </Card>
      </div>
    </Container>
  );
}
