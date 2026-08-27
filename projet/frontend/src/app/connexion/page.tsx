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
                Pas encore de compte ?{" "}
                <Link href="/inscription" className="text-brand font-medium underline">
                  Créer un compte
                </Link>
              </>
            }
          />
        </Card>
      </section>
    </Container>
  );
}
