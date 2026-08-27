"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { Card } from "@/components/Card";
import { Container } from "@/components/Container";
import { useAuth } from "@/components/AuthProvider";

export default function InscriptionPage() {
  const { inscription } = useAuth();
  const router = useRouter();

  return (
    <Container>
      <section className="mx-auto max-w-md py-12 sm:py-16">
        <Card>
          <AuthForm
            titre="Créer un compte"
            intituleBouton="Créer mon compte"
            autoCompleteMotDePasse="new-password"
            onSubmit={async (email, motDePasse) => {
              // `inscription` enchaîne la création PUIS la connexion :
              // personne ne souhaite ressaisir ce qu'il vient de taper.
              await inscription(email, motDePasse);
              router.replace("/");
            }}
            bas={
              <>
                Vous avez déjà un compte ?{" "}
                <Link href="/connexion" className="text-brand font-medium underline">
                  Se connecter
                </Link>
              </>
            }
          />
        </Card>
      </section>
    </Container>
  );
}
