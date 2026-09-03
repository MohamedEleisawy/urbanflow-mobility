"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { useTraduction } from "@/components/LangueProvider";
import { SelecteurLangue } from "@/components/SelecteurLangue";
import { SelecteurTheme } from "@/components/SelecteurTheme";

// =============================================================================
// En-tête global (sprint soutenance — refonte)
// =============================================================================
// ═══ CE QUI CHANGE, ET POURQUOI ═══
//
//   1. LE THÈME ET LA LANGUE SONT ICI, donc accessibles sans compte. Ils
//      n'étaient réglables que dans l'espace personnel : une préférence
//      d'affichage était devenue une récompense d'inscription.
//
//   2. UN VRAI MENU MOBILE. La version précédente laissait les liens
//      s'enrouler sur deux ou trois lignes sous 400 px, poussant le contenu
//      d'autant. Les sélecteurs de thème et de langue auraient rendu la chose
//      intenable.
//
//   3. « IMPACT CARBONE » APPARAÎT. La page existait — c'est le tableau de
//      bord de l'espace personnel — mais rien n'y menait depuis la navigation.
//
// ⚠️ AUCUN LIEN NE MÈNE À UNE PAGE QUI REDIRIGERAIT VERS LA CONNEXION. Les
// entrées réservées aux comptes n'apparaissent qu'une fois connecté : une
// porte fermée affichée est une promesse non tenue. Ce n'est PAS une mesure de
// sécurité — `RequireAuth` et les guards du backend s'en chargent.
// =============================================================================

interface Lien {
  href: string;
  libelle: string;
}

export function Header() {
  const chemin = usePathname();
  const { statut, utilisateur, deconnexion } = useAuth();
  const { t } = useTraduction();
  const router = useRouter();

  const [menuOuvert, setMenuOuvert] = useState(false);
  const idMenu = useId();

  // ⚠️ REFERMER LE MENU À CHAQUE NAVIGATION. Sans cela, le panneau reste
  // ouvert par-dessus la page qu'on vient d'atteindre — et sur mobile, il la
  // recouvre entièrement.
  //
  // ⚠️ PATRON « AJUSTER L'ÉTAT PENDANT LE RENDU », documenté par React, et non
  // un `useEffect`. Un effet provoquerait un rendu supplémentaire à chaque
  // navigation — le menu resterait visible une frame de trop, bien visible sur
  // mobile — et déclencherait `react-hooks/set-state-in-effect` du compilateur
  // React.
  const [cheminVu, setCheminVu] = useState(chemin);

  if (chemin !== cheminVu) {
    setCheminVu(chemin);
    setMenuOuvert(false);
  }

  /// L'accueil ne doit correspondre QU'À "/" : `startsWith` le marquerait
  /// actif sur toutes les pages du site.
  const estActif = (href: string) =>
    href === "/" ? chemin === "/" : chemin.startsWith(href);

  const liens: Lien[] = [
    { href: "/", libelle: t.navAccueil },
    { href: "/recherche", libelle: t.navRecherche },
    { href: "/perturbations", libelle: t.navPerturbations },
  ];

  if (statut === "authentifie" && utilisateur) {
    liens.push({ href: "/mon-espace", libelle: t.navImpact });

    if (utilisateur.role === "ADMIN") {
      liens.push({ href: "/admin", libelle: t.navAdministration });
    }
  }

  const classesLien = (actif: boolean) =>
    `block rounded-md px-3 py-2 text-sm font-medium transition-colors ${
      actif
        ? "bg-brand/10 text-brand"
        : "text-neutral-700 hover:bg-neutral-100"
    }`;

  const navigation = (
    <ul className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-1">
      {liens.map(({ href, libelle }) => (
        <li key={href}>
          <Link
            href={href}
            // `aria-current="page"` : l'équivalent sémantique du repère
            // visuel. La couleur seule ne suffirait pas.
            aria-current={estActif(href) ? "page" : undefined}
            className={classesLien(estActif(href))}
          >
            {libelle}
          </Link>
        </li>
      ))}
    </ul>
  );

  const compte = (
    <>
      {/*
        `chargement` est rendu comme un ESPACE RÉSERVÉ, pas comme un vide : au
        premier rendu, on ignore encore si l'usager est connecté — le jeton est
        dans localStorage, et il faut demander au backend s'il est toujours
        valable. Afficher « Connexion » entre-temps ferait scintiller l'en-tête
        sous les yeux d'un usager déjà connecté.
      */}
      {statut === "chargement" && (
        <span
          aria-hidden="true"
          className="h-9 w-24 animate-pulse rounded-md bg-neutral-100"
        />
      )}

      {statut === "anonyme" && (
        <Link
          href="/connexion"
          className="bg-brand hover:bg-brand-dark rounded-md px-3 py-2 text-sm font-medium text-white transition-colors"
        >
          {t.navConnexion}
        </Link>
      )}

      {statut === "authentifie" && utilisateur && (
        <>
          {/* L'email n'est pas décoratif : c'est ce qui permet de vérifier
              d'un coup d'œil SOUS QUEL COMPTE on agit. */}
          <span className="hidden max-w-[14rem] truncate text-sm text-neutral-600 lg:inline">
            {utilisateur.email}
          </span>
          {/* Un vrai <button> : se déconnecter AGIT sur la page, cela ne
              navigue pas. */}
          <button
            type="button"
            onClick={() => {
              deconnexion();
              router.push("/");
            }}
            className="text-ink rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium transition-colors hover:bg-neutral-50"
          >
            {t.navDeconnexion}
          </button>
        </>
      )}
    </>
  );

  return (
    <header className="border-b border-neutral-200 bg-white">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link
          href="/"
          className="text-ink text-lg font-semibold tracking-tight whitespace-nowrap"
        >
          Urban<span className="text-brand">Flow</span>
        </Link>

        {/* --- Barre complète, à partir de `sm` --- */}
        <nav aria-label={t.navPrincipale} className="hidden sm:block">
          {navigation}
        </nav>

        <div className="hidden items-center gap-2 sm:flex">
          <SelecteurTheme compact />
          <SelecteurLangue />
          {compte}
        </div>

        {/* --- Bouton du menu, sous `sm` --- */}
        <button
          type="button"
          // ⚠️ `aria-expanded` ET `aria-controls` : sans eux, un lecteur
          // d'écran annonce un bouton dont rien ne dit qu'il ouvre un panneau,
          // ni lequel, ni s'il est déjà ouvert.
          aria-expanded={menuOuvert}
          aria-controls={idMenu}
          aria-label={menuOuvert ? t.navFermerMenu : t.navOuvrirMenu}
          onClick={() => setMenuOuvert((ouvert) => !ouvert)}
          className="text-ink rounded-md border border-neutral-300 px-3 py-2 sm:hidden"
        >
          <span aria-hidden="true">{menuOuvert ? "✕" : "☰"}</span>
        </button>
      </div>

      {/* --- Panneau mobile --- */}
      {/*
        ⚠️ `hidden` PLUTÔT QU'UN RENDU CONDITIONNEL. `aria-controls` désigne un
        élément par son identifiant : s'il n'existe pas dans le DOM quand le
        menu est fermé, la référence pointe dans le vide et certains lecteurs
        d'écran annoncent le bouton comme cassé.
      */}
      <div
        id={idMenu}
        hidden={!menuOuvert}
        className="border-t border-neutral-200 px-4 py-3 sm:hidden"
      >
        <nav aria-label={t.navPrincipale}>{navigation}</nav>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-neutral-200 pt-3">
          <SelecteurTheme />
          <SelecteurLangue />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">{compte}</div>
      </div>
    </header>
  );
}
