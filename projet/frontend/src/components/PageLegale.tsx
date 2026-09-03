"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Container } from "@/components/Container";
import { useTraduction } from "@/components/LangueProvider";
import { capacites, type IdentiteLegale } from "@/lib/capacites-api";

// =============================================================================
// Cadre commun aux pages légales (sprint soutenance)
// =============================================================================
// Les trois pages — confidentialité, mentions légales, accessibilité —
// partagent une mise en page et, surtout, UN PROBLÈME COMMUN : elles doivent
// nommer un responsable de traitement et une adresse de contact.
//
// ⚠️ CES COORDONNÉES NE SONT JAMAIS INVENTÉES. Une raison sociale ou une
// adresse fabriquée sur une page « Mentions légales » ne serait pas du texte
// de remplissage : ce serait une fausse identité de responsable de traitement,
// sur la page même dont c'est l'unique objet. Quand la configuration ne les
// fournit pas, un encadré le dit.
//
// Elles viennent de `GET /api/capabilities`, alimenté par `LEGAL_ENTITY_NAME`,
// `LEGAL_CONTACT_EMAIL` et `PRIVACY_CONTACT_EMAIL`.
// =============================================================================

/**
 * Les coordonnées légales, ou `null` tant qu'on ne les a pas.
 *
 * ⚠️ `null` COUVRE DEUX CAS QU'ON NE DISTINGUE PAS ICI : « pas encore
 * chargées » et « échec réseau ». Dans les deux, la page doit se comporter
 * comme si rien n'était configuré — jamais l'inverse.
 */
export function useIdentiteLegale(): IdentiteLegale | null {
  const [identite, setIdentite] = useState<IdentiteLegale | null>(null);

  useEffect(() => {
    const controleur = new AbortController();

    capacites(controleur.signal)
      .then((reponse) => setIdentite(reponse.legal))
      .catch(() => {
        // Silencieux : l'absence de coordonnées est déjà affichée comme
        // telle. Un message d'erreur en plus n'apprendrait rien.
      });

    return () => controleur.abort();
  }, []);

  return identite;
}

/**
 * L'encadré affiché quand une coordonnée obligatoire manque.
 *
 * Il ne s'excuse pas et ne promet rien : il constate. C'est ce qui distingue
 * une installation de démonstration assumée d'un site qui prétend être en
 * production.
 */
export function EncadreDemonstration({ children }: { children?: ReactNode }) {
  const { t } = useTraduction();

  return (
    <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <strong>{t.demoAvertissement}</strong>
      {children ? <span className="mt-1 block">{children}</span> : null}
    </p>
  );
}

export function PageLegale({
  titre,
  chapeau,
  children,
}: {
  titre: string;
  chapeau?: string;
  children: ReactNode;
}) {
  return (
    <Container>
      {/* `max-w-prose` : au-delà d'environ 70 caractères, l'œil perd la ligne
          en revenant à la marge. Une page de texte légal est déjà assez
          pénible à lire. */}
      <article className="max-w-prose py-8">
        <h1 className="text-ink text-3xl font-bold tracking-tight">{titre}</h1>

        {chapeau && <p className="mt-3 text-neutral-700">{chapeau}</p>}

        <div className="mt-6 space-y-6">{children}</div>
      </article>
    </Container>
  );
}

export function Section({
  titre,
  children,
}: {
  titre: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="text-ink text-xl font-semibold">{titre}</h2>
      <div className="mt-2 space-y-2 text-neutral-700">{children}</div>
    </section>
  );
}
