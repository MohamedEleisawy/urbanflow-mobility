"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { Card } from "@/components/Card";
import { Container } from "@/components/Container";
import { useAuth } from "@/components/AuthProvider";

// Composant CLIENT : formulaire, état local, appel réseau au clic.
//
// Pas de `metadata` exportée ici — une page client n'en accepte pas. Le titre
// reste celui du layout racine ; un titre par page viendra si le besoin s'en
// fait sentir.
export default function ConnexionPage() {
  const { connexion } = useAuth();
  const router = useRouter();

  return (
    <Container>
      <section className="mx-auto max-w-md py-12 sm:py-16">
        <Card>
          <AuthForm
            titre="Se connecter"
            intituleBouton="Se connecter"
            autoCompleteMotDePasse="current-password"
            onSubmit={async (email, motDePasse) => {
              await connexion(email, motDePasse);
              // `replace` et non `push` : revenir en arrière ne doit pas
              // ramener sur un formulaire de connexion déjà utilisé.
              router.replace("/");
            }}
            bas={
              <>
                {/* ⚠️ « MOT DE PASSE OUBLIÉ » EN PREMIER, et sur sa propre
                    ligne. Quelqu'un qui arrive ici après un échec de connexion
                    cherche cela ; le noyer à la suite de « créer un compte »
                    le ferait chercher, puis abandonner — ou créer un second
                    compte avec la même adresse, qui échouerait aussi. */}
                <Link
                  href="/mot-de-passe-oublie"
                  className="text-brand font-medium underline underline-offset-2"
                >
                  Mot de passe oublié ?
                </Link>

                <span className="mt-2 block">
                  Pas encore de compte ?{" "}
                  <Link
                    href="/inscription"
                    className="text-brand font-medium underline"
                  >
                    Créer un compte
                  </Link>
                </span>
              </>
            }
          />
        </Card>
      </section>
    </Container>
  );
}
