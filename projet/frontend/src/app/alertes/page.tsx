import type { Metadata } from "next";
import { ButtonLink } from "@/components/Button";
import { Container } from "@/components/Container";
import { EmptyState } from "@/components/EmptyState";

export const metadata: Metadata = {
  title: "Perturbations — UrbanFlow Mobility",
};

// Route en attente (étape 5A-2). Mêmes raisons que /recherche.
//
// Le raccordement lira GET /api/alerts : endpoint PUBLIC, déjà en place, qui
// rend les perturbations en cours triées par gravité avec le texte publié par
// l'opérateur. Aucun appel n'est fait ici.
export default function AlertesPage() {
  return (
    <Container>
      <section className="py-12 sm:py-16">
        <h1 className="text-ink text-2xl font-semibold tracking-tight sm:text-3xl">
          Perturbations en cours
        </h1>
        <p className="mt-3 max-w-2xl text-neutral-700">
          Retards, pannes et travaux signalés sur le réseau, tels que publiés par les opérateurs.
        </p>

        <div className="mt-8">
          <EmptyState
            title="Cet écran arrive à la prochaine étape"
            description="Les alertes sont déjà importées et exposées par l'API ; l'affichage sera branché ensuite."
            action={<ButtonLink href="/">Revenir à l&apos;accueil</ButtonLink>}
          />
        </div>
      </section>
    </Container>
  );
}
