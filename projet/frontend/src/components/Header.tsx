"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";

// "use client" est nécessaire pour UNE seule raison : `usePathname`, qui
// marque le lien de la page courante. Tout le reste du layout demeure en
// composant serveur.
//
// Le jeu en vaut la chandelle : sans repère visuel, un usager ne sait pas où
// il se trouve, et `aria-current` est le seul moyen de le dire à un lecteur
// d'écran.

const LIENS = [
  { href: "/", libelle: "Accueil" },
  { href: "/recherche", libelle: "Recherche" },
  { href: "/alertes", libelle: "Perturbations" },
] as const;

export function Header() {
  const chemin = usePathname();
  const { statut, utilisateur, deconnexion } = useAuth();
  const router = useRouter();

  /// L'accueil ne doit correspondre QU'À "/" : `startsWith` le marquerait
  /// actif sur toutes les pages du site.
  const estActif = (href: string) => (href === "/" ? chemin === "/" : chemin.startsWith(href));

  return (
    <header className="border-b border-neutral-200 bg-white">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <Link href="/" className="text-ink text-lg font-semibold tracking-tight">
          Urban<span className="text-brand">Flow</span>
        </Link>

        {/* `aria-label` distingue cette navigation de celle du pied de page
            pour un usager qui liste les repères de la page. */}
        <nav aria-label="Navigation principale">
          <ul className="flex flex-wrap items-center gap-1 sm:gap-2">
            {LIENS.map(({ href, libelle }) => {
              const actif = estActif(href);

              return (
                <li key={href}>
                  <Link
                    href={href}
                    // `aria-current="page"` : l'équivalent sémantique du
                    // soulignement visuel. La couleur seule ne suffirait pas.
                    aria-current={actif ? "page" : undefined}
                    className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                      actif ? "bg-brand/10 text-brand" : "text-neutral-700 hover:bg-neutral-100"
                    }`}
                  >
                    {libelle}
                  </Link>
                </li>
              );
            })}

            {/*
              Accès au compte (étape 5A-3).

              `chargement` est rendu comme un ESPACE RÉSERVÉ, pas comme un
              vide : au premier rendu, on ignore encore si l'usager est
              connecté — le jeton est dans localStorage, et il faut demander
              au backend s'il est toujours valable. Afficher « Connexion »
              entre-temps ferait scintiller l'en-tête sous les yeux d'un
              usager déjà connecté.
            */}
            <li className="ml-1 flex items-center gap-2 sm:ml-3">
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
                  Connexion
                </Link>
              )}

              {statut === "authentifie" && utilisateur && (
                <>
                  {/* L'email n'est pas décoratif : c'est ce qui permet de
                      vérifier d'un coup d'œil SOUS QUEL COMPTE on agit.
                      Masqué sur mobile, où la place manque. */}
                  <span className="hidden text-sm text-neutral-600 sm:inline">
                    {utilisateur.email}
                  </span>
                  {/* Un vrai <button> : se déconnecter AGIT sur la page, cela
                      ne navigue pas. */}
                  <button
                    type="button"
                    onClick={() => {
                      deconnexion();
                      router.push("/");
                    }}
                    className="text-ink rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium transition-colors hover:bg-neutral-50"
                  >
                    Se déconnecter
                  </button>
                </>
              )}
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}
