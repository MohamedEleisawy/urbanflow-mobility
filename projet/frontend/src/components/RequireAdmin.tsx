"use client";

import type { ReactNode } from "react";
import { useAuth } from "@/components/AuthProvider";
import { ButtonLink } from "@/components/Button";
import { Container } from "@/components/Container";
import { RequireAuth } from "@/components/RequireAuth";

/**
 * N'affiche ses enfants qu'à un administrateur (bloc 6-6).
 *
 * ═══ IL SE COMPOSE AVEC `RequireAuth`, IL NE LE REMPLACE PAS ═══
 *
 * « Être administrateur » suppose « être connecté » : recopier ici la lecture
 * du statut, l'écran d'attente et la redirection vers la connexion créerait
 * deux implémentations de la même règle, qui divergeraient au premier
 * changement. `RequireAuth` traite donc l'anonyme, et ce composant ne traite
 * QUE le rôle.
 *
 * ═══ LE RÔLE VIENT DU PROFIL, JAMAIS DE `localStorage` NI DU JWT DÉCODÉ ═══
 *
 * Le jeton contient bien un champ `role`, et il serait tentant de le décoder
 * ici. Ce serait une SECONDE source de vérité : un compte promu — ou rétrogradé
 * — porterait encore l'ancien rôle dans son jeton jusqu'à expiration, et
 * l'interface contredirait le backend.
 *
 * `utilisateur.role` vient de `GET /api/users/me`, que le provider a déjà
 * demandé et que le backend a répondu à l'instant. Un seul endroit sait qui
 * est connecté, et avec quel rôle.
 *
 * ═══ CE COMPOSANT N'EST PAS UNE SÉCURITÉ ═══
 *
 * Comme `RequireAuth`, c'est du CONFORT : il évite d'afficher un écran vide
 * et trois erreurs 403 à qui n'a rien à faire là. N'importe qui peut ouvrir
 * la console et appeler `/api/admin/*` lui-même.
 *
 * La vraie barrière est `RolesGuard` côté backend (étape 6-1), qui refuse
 * toute requête dont le jeton ne porte pas `ADMIN`. Aucune donnée ne dépend
 * de ce fichier.
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <GardeRole>{children}</GardeRole>
    </RequireAuth>
  );
}

function GardeRole({ children }: { children: ReactNode }) {
  const { utilisateur } = useAuth();

  // `RequireAuth` ne rend ses enfants qu'au statut « authentifié », où le
  // profil est nécessairement chargé. La garde reste écrite parce que le type
  // l'autorise à être nul — et parce qu'un `!` ici mentirait au lecteur.
  if (!utilisateur) {
    return null;
  }

  if (utilisateur.role !== "ADMIN") {
    // ON EXPLIQUE, ON NE REDIRIGE PAS. Renvoyer silencieusement vers
    // l'accueil laisserait croire à un lien cassé, et ferait recommencer.
    // Dire « cet espace est réservé » répond à la question posée.
    //
    // Cela ne révèle rien : l'existence de `/admin` n'est pas un secret, et
    // le backend refuserait de toute façon chaque requête.
    return (
      <Container>
        <section className="py-16" aria-labelledby="acces-refuse">
          {/* `role="alert"` : l'usager arrive sur cette page en pensant y
              avoir accès. C'est le message le plus important de l'écran, il
              doit être annoncé sans qu'on ait à le chercher. */}
          <div role="alert" className="rounded-lg border border-neutral-200 bg-white px-6 py-8">
            <h1 id="acces-refuse" className="text-ink text-2xl font-semibold tracking-tight">
              Accès réservé aux administrateurs
            </h1>
            <p className="mt-3 max-w-xl text-neutral-700">
              Votre compte est bien connecté, mais il ne dispose pas des droits nécessaires pour
              consulter l&apos;administration.
            </p>
            <div className="mt-6">
              <ButtonLink href="/mon-espace" variant="secondary">
                Retourner à mon espace
              </ButtonLink>
            </div>
          </div>
        </section>
      </Container>
    );
  }

  return <>{children}</>;
}
