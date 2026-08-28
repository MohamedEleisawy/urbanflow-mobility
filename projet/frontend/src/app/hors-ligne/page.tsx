import { ButtonLink } from "@/components/Button";
import { Container } from "@/components/Container";

// =============================================================================
// Page de repli hors ligne (bloc 5D-2)
// =============================================================================
// Servie par le service worker quand une navigation échoue faute de réseau —
// la contrainte C10 du sujet demande que l'application « fonctionne en
// mobilité avec connectivité variable ».
//
// ELLE N'AFFICHE AUCUNE DONNÉE, et c'est délibéré. Cette page est mise en
// cache à l'installation du service worker, donc potentiellement des semaines
// avant d'être vue : y placer des perturbations ou un historique reviendrait
// à montrer un état périmé sans moyen de le dater. Elle explique la situation,
// et rien d'autre.
//
// Composant SERVEUR, sans état ni effet : elle doit rester la page la plus
// légère de l'application.
// =============================================================================

export default function HorsLignePage() {
  return (
    <Container>
      <section className="py-16 text-center">
        <h1 className="text-ink text-2xl font-semibold tracking-tight sm:text-3xl">
          Vous êtes hors ligne
        </h1>

        <p className="mx-auto mt-4 max-w-xl text-neutral-700">
          UrbanFlow a besoin d&apos;une connexion pour calculer un itinéraire et lire les
          perturbations du réseau : ces informations changent trop souvent pour être conservées sur
          votre appareil.
        </p>

        <p className="mx-auto mt-3 max-w-xl text-sm text-neutral-600">
          Reconnectez-vous, puis réessayez. Rien de ce que vous aviez enregistré n&apos;est perdu.
        </p>

        <div className="mt-8 flex justify-center">
          {/* Un lien, et non un bouton « Réessayer » en JavaScript : une
              navigation ordinaire repasse par le service worker, qui tentera
              de nouveau le réseau. */}
          <ButtonLink href="/">Réessayer</ButtonLink>
        </div>
      </section>
    </Container>
  );
}
