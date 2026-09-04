"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Container } from "@/components/Container";
import { ErrorMessage } from "@/components/ErrorMessage";
import { useTraduction } from "@/components/LangueProvider";
import { messageDErreur } from "@/lib/api";
import { demanderReinitialisation } from "@/lib/auth-api";

// =============================================================================
// Mot de passe oublié (war room)
// =============================================================================
// ═══ LA SEULE RÈGLE QUI COMPTE SUR CET ÉCRAN ═══
//
// ⚠️ LE MESSAGE DE SUCCÈS EST LE MÊME POUR UNE ADRESSE INSCRITE ET POUR UNE
// ADRESSE INCONNUE. Le backend répond identiquement dans les deux cas ; cette
// page ne doit surtout pas essayer de distinguer plus finement.
//
// Ce n'est pas une précaution abstraite : un écran qui dirait « adresse
// inconnue » se laisserait soumettre une liste d'adresses et répondrait,
// pour chacune, si elle a un compte ici. Ces listes se revendent, et servent
// à l'hameçonnage ciblé.
//
// C'est aussi pourquoi la phrase est EXPLIQUÉE à l'usager, plutôt que laissée
// à sa perplexité : sans explication, « si un compte existe » se lit comme une
// dérobade.
//
// ⚠️ ON N'ÉCRIT NULLE PART « EMAIL ENVOYÉ ». Aucun transport de courriel n'est
// configuré sur cette installation. Le lien est PRÉPARÉ — et, en
// développement, journalisé côté serveur. Annoncer un envoi serait le genre de
// mensonge qui laisse quelqu'un attendre devant une boîte vide.
// =============================================================================

export default function MotDePasseOubliePage() {
  const { t } = useTraduction();

  const [email, setEmail] = useState("");
  const [etat, setEtat] = useState<"saisie" | "envoi" | "fait">("saisie");
  const [erreur, setErreur] = useState<string | null>(null);

  const soumettre = async (evenement: FormEvent) => {
    evenement.preventDefault();
    setErreur(null);
    setEtat("envoi");

    try {
      await demanderReinitialisation(email);
      setEtat("fait");
    } catch (echec: unknown) {
      // ⚠️ SEULE UNE ADRESSE MAL FORMÉE PEUT ÉCHOUER (400). Une adresse
      // inconnue rend 200 : le backend s'y engage, et c'est ce qui protège
      // contre l'énumération.
      setErreur(messageDErreur(echec));
      setEtat("saisie");
    }
  };

  return (
    <Container>
      <div className="mx-auto max-w-md py-10 sm:py-16">
        <Card>
          <h1 className="text-ink text-2xl font-semibold tracking-tight">
            {t.mdpOublieTitre}
          </h1>

          {etat === "fait" ? (
            <>
              {/*
                `role="status"` et non `role="alert"` : c'est une confirmation
                attendue, pas une interruption. Un lecteur d'écran l'annonce
                poliment, à la fin de sa lecture en cours.
              */}
              <p
                role="status"
                className="border-eco/30 bg-eco/5 text-eco mt-4 rounded-md border px-4 py-3 text-sm"
              >
                {/* ⚠️ LE TEXTE VIENT DU BACKEND, mot pour mot. Le reformuler
                    ici ferait deux versions d'une même promesse, qui
                    divergeraient au premier changement de l'une des deux. */}
                Si un compte existe pour cette adresse, un lien de
                réinitialisation a été préparé.
              </p>

              <p className="mt-3 text-sm text-neutral-600">
                {t.mdpOublieConfidentialite}
              </p>

              <div className="mt-6">
                <Link
                  href="/connexion"
                  className="text-brand text-sm font-medium underline underline-offset-2"
                >
                  {t.mdpOublieRetour}
                </Link>
              </div>
            </>
          ) : (
            <>
              <p className="mt-2 text-sm text-neutral-700">
                {t.mdpOublieIntro}
              </p>

              {erreur && (
                <div className="mt-4">
                  <ErrorMessage>{erreur}</ErrorMessage>
                </div>
              )}

              <form onSubmit={soumettre} className="mt-6 space-y-4" noValidate>
                <div>
                  {/* Un vrai `<label>` lié par `htmlFor` : un `placeholder`
                      seul disparaît à la saisie et n'est pas un nom
                      accessible. */}
                  <label
                    htmlFor="email"
                    className="text-ink block text-sm font-medium"
                  >
                    {t.mdpOublieChamp}
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    // `autoFocus` : c'est le seul champ de la page, et
                    // l'usager y vient pour le remplir.
                    autoFocus
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="text-ink mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
                  />
                </div>

                <Button type="submit" disabled={etat === "envoi"}>
                  {etat === "envoi" ? t.mdpOublieEnCours : t.mdpOublieEnvoyer}
                </Button>
              </form>

              <p className="mt-6 text-sm text-neutral-600">
                <Link
                  href="/connexion"
                  className="text-brand font-medium underline underline-offset-2"
                >
                  {t.mdpOublieRetour}
                </Link>
              </p>
            </>
          )}
        </Card>
      </div>
    </Container>
  );
}
