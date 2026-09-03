"use client";

import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { useTraduction } from "@/components/LangueProvider";

// =============================================================================
// Pied de page (sprint soutenance)
// =============================================================================
// ⚠️ LES LIENS LÉGAUX SONT UNE OBLIGATION, PAS UNE DÉCORATION. Le RGPD exige
// que l'information sur le traitement soit « aisément accessible » (art. 12) :
// une politique de confidentialité qu'on ne peut atteindre qu'en devinant son
// URL ne satisfait pas cette exigence.
//
// ⚠️ « MES DONNÉES » N'APPARAÎT QU'UNE FOIS CONNECTÉ, contrairement aux trois
// autres. Exporter ou supprimer SES données suppose un compte : le lien
// mènerait sinon à une redirection vers la connexion, c'est-à-dire à une
// porte fermée affichée comme ouverte.
//
// ⚠️ AUCUNE BANNIÈRE COOKIES. L'application ne dépose aucun traceur, aucun
// cookie tiers, aucune mesure d'audience : seuls un jeton d'authentification
// et deux préférences d'affichage vivent dans `localStorage`, tous
// strictement nécessaires au service demandé. Afficher un bandeau de
// consentement sans finalité à consentir serait un rituel trompeur.
// =============================================================================

export function PiedDePage() {
  const { t } = useTraduction();
  const { statut } = useAuth();

  const liens = [
    { href: "/confidentialite", libelle: t.piedConfidentialite },
    { href: "/mentions-legales", libelle: t.piedMentionsLegales },
    { href: "/accessibilite", libelle: t.piedAccessibilite },
    ...(statut === "authentifie"
      ? [{ href: "/mes-donnees", libelle: t.piedMesDonnees }]
      : []),
  ];

  return (
    <footer className="border-t border-neutral-200 bg-white">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-6 text-sm text-neutral-600 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <p className="max-w-md">
          UrbanFlow Mobility — projet de fin d&apos;études. Données de
          transport issues des standards ouverts GTFS et GBFS.
        </p>

        {/* `aria-label` distingue cette navigation de celle de l'en-tête pour
            un usager qui liste les repères de la page. */}
        <nav aria-label={t.piedSecondaire}>
          <ul className="flex flex-wrap gap-x-4 gap-y-2">
            {liens.map(({ href, libelle }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="hover:text-brand underline underline-offset-2 transition-colors"
                >
                  {libelle}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
