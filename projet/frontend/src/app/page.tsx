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
            {/* ═══ TOUT EST CENTRÉ ═══
                L'accueil ne raconte rien : il pose une question et donne un
                bouton pour y répondre. Un alignement à gauche disperserait le
                regard sur trois colonnes de texte ; centré, il n'y a qu'un
                seul endroit où poser les yeux. */}
            <div className="flex flex-col items-center text-center">
              <p className="text-eco text-sm font-semibold tracking-wide uppercase">
                {t.accueilBaseline}
              </p>

              <h1 className="text-ink mt-4 max-w-3xl text-3xl font-bold tracking-tight text-balance sm:text-4xl lg:text-5xl">
                {titre}
              </h1>

              {/* Le slogan, en deux temps. Court, il se retient ; c'est
                  l'identité du produit en quatre mots. */}
              <p className="text-ink mt-5 text-xl font-semibold sm:text-2xl">
                {t.accueilSlogan1}{" "}
                <span className="text-eco">{t.accueilSlogan2}</span>
              </p>

              <p className="mt-4 max-w-xl text-lg text-neutral-700">
                {t.accueilIntro}
              </p>

              {/* ═══ LE POINT FOCAL ═══
                  ⚠️ UN SEUL BOUTON DOMINANT. Deux appels à l'action de même
                  poids obligeraient à choisir avant d'avoir compris — et c'est
                  précisément ce qu'une page d'accueil doit épargner. Le lien
                  vers les perturbations existe toujours, en dessous et en
                  retrait typographique.

                  ⚠️ C'EST UN `<Link>`, DONC UN VRAI LIEN. Un `<div onClick>`
                  serait invisible au clavier, inouvrable dans un nouvel
                  onglet, et absent de la liste des liens d'un lecteur
                  d'écran. La taille et la couleur ne remplacent pas la
                  sémantique.

                  `uf-cta` : halo qui respire, défini dans `globals.css`,
                  neutralisé par `prefers-reduced-motion`. */}
              <Link
                href="/recherche"
                className="bg-brand hover:bg-brand-dark uf-cta mt-10 inline-flex items-center gap-3 rounded-2xl px-8 py-5 text-lg font-bold text-white transition-transform sm:px-12 sm:py-6 sm:text-xl motion-safe:hover:-translate-y-1"
              >
                <span aria-hidden="true">🚀</span>
                {t.accueilCtaPrincipal}
              </Link>

              {/* L'accroche sous le bouton, discrète : elle dit à quoi mène le
                  clic sans répéter le libellé. */}
              <p className="mt-4 text-sm text-neutral-600">
                {t.accueilCtaAccroche}
              </p>

              <Link
                href="/perturbations"
                className="hover:text-brand mt-8 text-sm font-medium text-neutral-600 underline underline-offset-4 transition-colors"
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
