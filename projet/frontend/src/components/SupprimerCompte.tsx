"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { Button } from "@/components/Button";
import { messageDErreur } from "@/lib/api";
import { supprimerMonCompte } from "@/lib/compte-api";

// =============================================================================
// Zone de danger — suppression du compte (bloc 5G)
// =============================================================================
// L'ACTION LA PLUS DESTRUCTIVE DE L'APPLICATION : elle est irréversible, et
// aucune interface ne permettra de revenir en arrière. Elle mérite donc plus
// de précautions que la suppression d'un trajet (étape 5A-9), dont le modèle
// de confirmation est repris et renforcé.
//
// TROIS GARDE-FOUS, dans cet ordre :
//   1. le premier clic n'ouvre qu'une confirmation — aucun appel réseau ;
//   2. les conséquences sont écrites, pas seulement suggérées ;
//   3. le focus va sur « Annuler », jamais sur « Confirmer ».
// =============================================================================

/**
 * Où en est la suppression.
 *
 * Pas d'état « succès » : en cas de réussite, l'usager est déconnecté et
 * redirigé. Un message de confirmation n'aurait personne à qui s'adresser.
 */
type EtatSuppression =
  | { statut: "repos" }
  | { statut: "confirmation" }
  | { statut: "suppression" }
  | { statut: "echec"; message: string };

export function SupprimerCompte() {
  const { jeton, deconnexion } = useAuth();
  const router = useRouter();

  const [etat, setEtat] = useState<EtatSuppression>({ statut: "repos" });
  const annulerRef = useRef<HTMLButtonElement>(null);

  const enConfirmation = etat.statut === "confirmation" || etat.statut === "echec";
  const enCours = etat.statut === "suppression";

  useEffect(() => {
    // Le focus va sur ANNULER, jamais sur Confirmer : sur une action
    // irréversible, le geste par défaut doit être celui qui ne détruit rien.
    // Sans cela, un usager au clavier supprimerait son compte en appuyant sur
    // Entrée.
    if (etat.statut === "confirmation") {
      annulerRef.current?.focus();
    }
  }, [etat.statut]);

  const confirmer = async () => {
    if (!jeton) {
      return;
    }

    setEtat({ statut: "suppression" });

    try {
      await supprimerMonCompte(jeton);

      // ⚠️ L'ORDRE EST IMPORTANT, ET IL EST DÉLIBÉRÉ.
      //
      // Le jeton n'est effacé QU'APRÈS la confirmation du serveur : le
      // nettoyer avant laisserait l'usager déconnecté d'un compte toujours
      // actif en cas d'échec, sans moyen d'y revenir sans se reconnecter.
      //
      // Aussitôt après, en revanche, on ne traîne pas : le jeton ne vaut plus
      // rien — le backend le refuse désormais partout — et le garder en
      // mémoire ne ferait que produire des 401 déroutants.
      deconnexion();

      // `replace` et non `push` : revenir en arrière ramènerait sur un espace
      // personnel devenu inaccessible.
      router.replace("/");
    } catch (echec) {
      // LE COMPTE EST INTACT : rien n'a été supprimé côté serveur, et la
      // session est conservée. L'usager peut réessayer ou renoncer.
      setEtat({ statut: "echec", message: messageDErreur(echec) });
    }
  };

  return (
    <section aria-labelledby="zone-danger">
      {/* « Zone de danger » : le titre annonce la nature de ce qui suit, et il
          le fait par un MOT. Un simple encadré rouge ne dirait rien à qui ne
          perçoit pas la couleur (WCAG 1.4.1). */}
      <h2 id="zone-danger" className="text-ink text-lg font-semibold">
        Zone de danger
      </h2>

      <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-5 py-4">
        {!enConfirmation && !enCours ? (
          <>
            <p className="font-medium text-red-900">Supprimer mon compte</p>
            <p className="mt-1 text-sm text-red-800">
              Votre compte deviendra inutilisable et vous serez déconnecté.
            </p>
            <div className="mt-4">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setEtat({ statut: "confirmation" })}
                className="w-full sm:w-auto"
              >
                Supprimer mon compte
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="font-medium text-red-900">
              Confirmer la suppression définitive de votre compte ?
            </p>

            {/* LES CONSÉQUENCES SONT ÉCRITES, UNE PAR UNE. « Cette action est
                irréversible » est vrai mais vague : l'usager doit savoir
                exactement ce qu'il perd, et ce qu'il ne perd pas. */}
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-800">
              <li>Vous serez immédiatement déconnecté.</li>
              <li>Vous ne pourrez plus vous reconnecter avec cette adresse.</li>
              <li>
                Votre espace personnel, votre historique et votre suivi carbone ne seront plus
                accessibles.
              </li>
              <li>Cette action est définitive : aucun écran ne permet de revenir en arrière.</li>
            </ul>

            <p className="mt-3 text-sm text-red-800">
              {/* Un conseil utile ET honnête : l'export reste possible tant que
                  le compte est actif, et lui seul. */}
              Pensez à <span className="font-medium">télécharger vos données</span> avant de
              confirmer : l&apos;export ne sera plus accessible ensuite.
            </p>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <button
                ref={annulerRef}
                type="button"
                // Désactivé pendant l'envoi : annuler une suppression déjà
                // partie n'annulerait rien, et laisserait croire le contraire.
                disabled={enCours}
                onClick={() => setEtat({ statut: "repos" })}
                className="text-ink rounded-md border border-neutral-300 bg-white px-5 py-2.5 text-sm font-medium transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Annuler
              </button>

              <button
                type="button"
                // Empêche la double soumission : deux DELETE concurrents
                // feraient répondre 401 au second — le guard refusant déjà le
                // jeton — et afficheraient une erreur pour une suppression
                // pourtant réussie.
                disabled={enCours}
                onClick={() => void confirmer()}
                className="rounded-md bg-red-700 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {enCours ? "Suppression en cours…" : "Confirmer la suppression"}
              </button>
            </div>

            {etat.statut === "echec" && (
              <p role="alert" className="mt-4 text-sm text-red-900">
                <span className="font-medium">Le compte n&apos;a pas pu être supprimé.</span>{" "}
                {etat.message} Votre compte est toujours actif.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
