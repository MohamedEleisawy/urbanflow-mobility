"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Container } from "@/components/Container";
import { useTraduction } from "@/components/LangueProvider";
import { territoire, type Territoire } from "@/lib/territoire-api";

// =============================================================================
// Page d'accueil (sprint soutenance)
// =============================================================================
// ═══ CE QUI A REMPLACÉ QUOI, ET POURQUOI DEUX FOIS ═══
//
// Trois versions se sont succédé, et l'aller-retour vaut d'être expliqué :
//
//   1. UNE PLAQUETTE — un titre, quatre encadrés, un bouton vers la recherche.
//   2. UNE REDIRECTION vers `/recherche`, au motif qu'un usager veut un
//      itinéraire, pas la liste des fonctionnalités.
//   3. CETTE PAGE.
//
// Le raisonnement de l'étape 2 était juste pour un USAGER HABITUÉ, et faux
// pour tous les autres. Une application de mobilité n'est pas un outil qu'on a
// déjà choisi : quelqu'un qui arrive doit comprendre en trois secondes ce
// qu'elle fait de plus qu'un plan de réseau — et ici, c'est le carbone.
//
// Rediriger interdisait aussi toute identité visuelle : le produit s'ouvrait
// sur un formulaire, et rien ne disait ce qu'il était.
//
// ⚠️ LA REDIRECTION AVAIT UN ARGUMENT QUE CETTE PAGE DOIT HONORER : ne pas
// mettre un écran entre l'usager et sa recherche. D'où un appel à l'action
// UNIQUE et dominant, au-dessus de la ligne de flottaison sur mobile. Le reste
// se lit en faisant défiler, ou pas du tout.
//
// ⚠️ AUCUN CHIFFRE N'EST AFFICHÉ ICI. Une page d'accueil de produit annonce
// volontiers « 1 348 arrêts », « 47 lignes ». Ces nombres dépendent de
// l'import et deviendraient faux au premier changement de territoire, sans que
// personne ne s'en aperçoive. Le nom du territoire, lui, vient de l'API.
// =============================================================================

/**
 * Le nom du territoire, ou un repli neutre.
 *
 * ⚠️ LE REPLI NE NOMME AUCUNE VILLE. Écrire « Strasbourg » en dur pendant le
 * chargement afficherait le mauvais nom une demi-seconde sur un déploiement
 * lyonnais — et l'erreur passerait inaperçue en développement, où le
 * territoire répond instantanément.
 */
function useNomDuTerritoire(): string | null {
  const [zone, setZone] = useState<Territoire | null>(null);

  useEffect(() => {
    const controleur = new AbortController();

    territoire(controleur.signal)
      .then(setZone)
      .catch(() => {
        // Silencieux : le titre a une formulation de repli qui se suffit.
      });

    return () => controleur.abort();
  }, []);

  return zone?.displayName ?? null;
}

export default function AccueilPage() {
  const { t } = useTraduction();
  const nom = useNomDuTerritoire();

  // Le titre nomme le territoire quand on le connaît, et reste une phrase
  // complète quand on ne le connaît pas encore.
  const titre = nom
    ? t.accueilTitre.replace("{territoire}", nom)
    : t.accueilTitre.replace("{territoire}", "votre métropole");

  return (
    <>
      {/* ═══ BANDEAU PRINCIPAL ═══ */}
      <section className="from-brand/8 relative overflow-hidden bg-linear-to-b to-transparent">
        {/*
          Décor cartographique : une grille de lignes très pâles, évoquant un
          plan de réseau.

          ⚠️ EN CSS PUR, SANS IMAGE NI BIBLIOTHÈQUE. Une trame de fond ne vaut
          pas une requête réseau ni un kilo-octet de JavaScript — et sur une
          page d'accueil, c'est précisément ce qui retarde le premier affichage.

          ⚠️ `aria-hidden` ET `pointer-events-none` : purement décoratif, il ne
          doit ni être annoncé, ni intercepter un clic destiné au bouton.
        */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(var(--color-brand) 1px, transparent 1px), linear-gradient(90deg, var(--color-brand) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />

        <Container>
          <div className="relative py-14 sm:py-20">
            <p className="text-eco text-sm font-semibold tracking-wide uppercase">
              {t.accueilBaseline}
            </p>

            <h1 className="text-ink mt-3 max-w-3xl text-3xl font-bold tracking-tight text-balance sm:text-4xl lg:text-5xl">
              {titre}
            </h1>

            <p className="mt-4 max-w-2xl text-lg text-neutral-700">
              {t.accueilIntro}
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              {/*
                UN SEUL appel à l'action dominant. Deux boutons de même poids
                obligeraient à choisir avant d'avoir compris, et c'est
                exactement ce qu'une page d'accueil doit épargner.

                Le halo (`shadow-brand/25`) tient lieu de mise en avant : il
                détache le bouton du fond sans introduire de couleur nouvelle.
              */}
              <Link
                href="/recherche"
                className="bg-brand hover:bg-brand-dark shadow-brand/25 rounded-lg px-6 py-3 text-base font-semibold text-white shadow-lg transition-all hover:shadow-xl motion-safe:hover:-translate-y-0.5"
              >
                {t.accueilCta}
              </Link>

              <Link
                href="/perturbations"
                className="text-ink rounded-lg border border-neutral-300 bg-white px-5 py-3 text-base font-medium transition-colors hover:bg-neutral-50"
              >
                {t.accueilCtaSecondaire}
              </Link>
            </div>
          </div>
        </Container>
      </section>

      {/* ═══ CE QUE LE PRODUIT FAIT ═══ */}
      <Container>
        <section aria-labelledby="atouts" className="py-12">
          {/* Le titre existe pour la structure du document — un lecteur
              d'écran doit pouvoir sauter cette section — mais il n'apporte
              rien visuellement au-dessus de trois cartes explicites. */}
          <h2 id="atouts" className="sr-only">
            Ce qu&apos;UrbanFlow apporte
          </h2>

          <ul className="grid gap-4 sm:grid-cols-3">
            <Atout
              picto="🌱"
              titre={t.accueilAtoutCarboneTitre}
              texte={t.accueilAtoutCarboneTexte}
              accent
            />
            <Atout
              picto="🚋"
              titre={t.accueilAtoutReseauTitre}
              texte={t.accueilAtoutReseauTexte}
            />
            <Atout
              picto="🧭"
              titre={t.accueilAtoutGuidageTitre}
              texte={t.accueilAtoutGuidageTexte}
            />
          </ul>
        </section>

        {/* ═══ LA PROMESSE D'HONNÊTETÉ ═══
            Elle vient en dernier et sur toute la largeur, parce que c'est la
            seule affirmation de cette page qui engage le produit sur ce qu'il
            NE fait PAS. */}
        <section
          aria-labelledby="honnetete"
          className="border-brand/20 bg-brand/5 mb-12 rounded-xl border p-6 sm:p-8"
        >
          <h2
            id="honnetete"
            className="text-brand text-lg font-semibold sm:text-xl"
          >
            {t.accueilHonneteteTitre}
          </h2>
          <p className="mt-2 max-w-3xl text-neutral-700">
            {t.accueilHonneteteTexte}
          </p>
        </section>
      </Container>
    </>
  );
}

function Atout({
  picto,
  titre,
  texte,
  accent = false,
}: {
  picto: string;
  titre: string;
  texte: string;
  /** Le carbone porte l'accent vert : c'est l'identité du produit. */
  accent?: boolean;
}) {
  return (
    <li
      className={`rounded-xl border bg-white p-5 transition-shadow hover:shadow-md ${
        accent ? "border-eco/30" : "border-neutral-200"
      }`}
    >
      {/* Décoratif : le titre juste en dessous porte le sens. */}
      <span aria-hidden="true" className="text-2xl">
        {picto}
      </span>

      <h3
        className={`mt-2 text-base font-semibold ${
          accent ? "text-eco" : "text-ink"
        }`}
      >
        {titre}
      </h3>

      <p className="mt-1 text-sm text-neutral-700">{texte}</p>
    </li>
  );
}
