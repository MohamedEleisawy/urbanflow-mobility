"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "@/components/AuthProvider";
import { Container } from "@/components/Container";
import { Spinner } from "@/components/Spinner";

/**
 * N'affiche ses enfants qu'à un usager authentifié (étape 5A-4).
 *
 * POURQUOI UNE PROTECTION CÔTÉ CLIENT, ET PAS UN `proxy.ts`
 *
 * Next.js 16 a renommé `middleware` en `proxy`, et son guide d'authentification
 * propose d'y faire des « vérifications optimistes » : lire la session et
 * rediriger avant même le rendu. Cette approche est INAPPLICABLE ici, et pour
 * une raison structurelle, non par commodité :
 *
 *   le proxy s'exécute sur le SERVEUR et ne voit que les cookies et
 *   les en-têtes — or notre jeton est dans `localStorage`, que le
 *   serveur ne peut pas lire.
 *
 * Le proxy ne saurait donc jamais si quelqu'un est connecté. Ce n'est pas une
 * limite de Next.js : c'est la conséquence directe du choix de stockage fait
 * en 5A-3, avec sa contrepartie assumée. Le jour où le jeton passerait dans
 * un cookie `HttpOnly`, une protection serveur deviendrait à la fois possible
 * et préférable.
 *
 * CE QUE CETTE PROTECTION EST — ET N'EST PAS
 *
 * C'est du CONFORT, pas de la sécurité. Elle évite d'afficher une page vide à
 * qui n'est pas connecté, et amène l'usager là où il peut agir. Elle
 * n'empêche personne d'appeler l'API : n'importe qui peut ouvrir la console
 * et lancer la requête lui-même.
 *
 * La VRAIE barrière est ailleurs, et elle existe déjà : `JwtAuthGuard` côté
 * backend refuse toute requête sans jeton valide (401). Aucune donnée
 * personnelle ne dépend de ce composant.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { statut } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (statut === "anonyme") {
      // `replace` et non `push` : revenir en arrière depuis la connexion ne
      // doit pas ramener sur une page qu'on n'a pas le droit de voir.
      router.replace("/connexion");
    }
  }, [statut, router]);

  // `chargement` : on ignore encore si un jeton stocké est valable. Afficher
  // « vous n'êtes pas connecté » à ce moment-là serait faux une fois sur
  // deux — et rediriger, franchement hostile.
  if (statut === "chargement") {
    return (
      <Container>
        <div className="py-16">
          <Spinner label="Vérification de votre session…" />
        </div>
      </Container>
    );
  }

  // `anonyme` : la redirection est en cours. On ne rend rien plutôt qu'un
  // message qui disparaîtrait aussitôt.
  if (statut === "anonyme") {
    return null;
  }

  return <>{children}</>;
}
