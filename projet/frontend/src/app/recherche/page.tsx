import type { Metadata } from "next";
import { ButtonLink } from "@/components/Button";
import { Container } from "@/components/Container";
import { EmptyState } from "@/components/EmptyState";

export const metadata: Metadata = {
  title: "Recherche d'itinéraire — UrbanFlow Mobility",
};

// Route en attente (étape 5A-2).
//
// La page existe pour que la navigation soit RÉELLE dès maintenant : un lien
// du menu qui mène à un 404 donne l'impression d'une application cassée, ce
// qui est pire que d'annoncer honnêtement qu'une fonctionnalité arrive.
//
// AUCUN APPEL BACKEND ici — c'est la règle de l'étape.
//
// Le raccordement (5A-4) demandera : GET /api/stops pour proposer les arrêts,
// puis POST /api/routes/search. Ce dernier attend des COORDONNÉES, d'où le
// choix par arrêt plutôt qu'un champ de saisie libre.
export default function RecherchePage() {
  return (
    <Container>
      <section className="py-12 sm:py-16">
        <h1 className="text-ink text-2xl font-semibold tracking-tight sm:text-3xl">
          Rechercher un itinéraire
        </h1>
        <p className="mt-3 max-w-2xl text-neutral-700">
          Choisissez un point de départ et une destination pour comparer les trajets les plus
          rapides et les plus courts.
        </p>

        <div className="mt-8">
          <EmptyState
            title="Cet écran arrive à la prochaine étape"
            description="Le moteur de recherche multimodal fonctionne déjà côté serveur : il reste à lui brancher cette interface."
            action={<ButtonLink href="/">Revenir à l&apos;accueil</ButtonLink>}
          />
        </div>
      </section>
    </Container>
  );
}
