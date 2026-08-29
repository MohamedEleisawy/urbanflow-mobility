"use client";

import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { messageDErreur } from "@/lib/api";
import { enregistrerFichier, nomDuFichier, telechargerExport } from "@/lib/export-api";

// =============================================================================
// Export des données personnelles (bloc 5F-5)
// =============================================================================
// Le dossier promet à l'usager de « télécharger à tout moment un fichier
// contenant l'intégralité de ses informations personnelles ».
//
// ⚠️ CE COMPOSANT N'AFFICHE JAMAIS LES DONNÉES. Elles transitent en mémoire le
// temps d'être écrites dans un fichier, et rien de plus. Les montrer à l'écran
// les exposerait à quiconque regarde par-dessus l'épaule, les laisserait dans
// l'historique de la page, et n'apporterait rien : l'usager veut un fichier,
// pas une lecture.
// =============================================================================

/**
 * Où en est le téléchargement.
 *
 * « succes » n'est atteint QU'APRÈS que le fichier a été remis au navigateur :
 * annoncer un téléchargement avant serait une promesse en l'air.
 */
type EtatExport =
  | { statut: "repos" }
  | { statut: "preparation" }
  | { statut: "succes"; nom: string }
  | { statut: "echec"; message: string };

export function ExportDonnees() {
  const { jeton } = useAuth();
  const [etat, setEtat] = useState<EtatExport>({ statut: "repos" });

  const enCours = etat.statut === "preparation";

  const exporter = async () => {
    // Le composant vit sous `RequireAuth`, mais un jeton absent reste
    // possible le temps d'un rendu : mieux vaut ne rien faire que d'appeler
    // l'API avec `null` et récolter un 401 inexplicable.
    if (!jeton || enCours) {
      return;
    }

    setEtat({ statut: "preparation" });

    try {
      const donnees = await telechargerExport(jeton);
      const nom = nomDuFichier(donnees.exportedAt);

      enregistrerFichier(donnees, nom);

      // Le nom est repris dans la confirmation : sur un téléphone, le fichier
      // atterrit dans un dossier que l'usager devra retrouver.
      setEtat({ statut: "succes", nom });
    } catch (echec) {
      setEtat({ statut: "echec", message: messageDErreur(echec) });
    }
  };

  return (
    <section aria-labelledby="donnees-personnelles">
      <h2 id="donnees-personnelles" className="text-ink text-lg font-semibold">
        Mes données personnelles
      </h2>

      <div className="mt-3">
        <Card>
          <p className="text-sm leading-relaxed text-neutral-700">
            Vous pouvez télécharger à tout moment l&apos;intégralité des informations que
            l&apos;application conserve à votre sujet : votre compte, vos préférences, vos trajets
            enregistrés et leurs étapes, ainsi que vos empreintes carbone.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-neutral-700">
            {/* Dire ce qui n'y est PAS est aussi utile que dire ce qui y est :
                un usager qui ne trouve pas son mot de passe dans le fichier
                doit comprendre que c'est voulu. */}
            Le fichier est au format JSON. Votre mot de passe n&apos;y figure pas : il n&apos;est
            conservé que sous forme chiffrée, et ne peut pas être restitué.
          </p>

          <div className="mt-4 flex flex-col gap-3 border-t border-neutral-200 pt-4 sm:flex-row sm:items-center">
            <Button
              type="button"
              // Désactivé pendant la préparation : deux clics lanceraient deux
              // requêtes et deux téléchargements du même fichier.
              disabled={enCours}
              onClick={() => void exporter()}
              className="w-full sm:w-auto"
            >
              {enCours ? "Préparation du fichier…" : "Télécharger mes données"}
            </Button>

            {/* PAS d'`aria-live` sur ce conteneur : `role="status"` et
                `role="alert"` en SONT déjà. Les imbriquer ferait tout annoncer
                deux fois — l'erreur commise puis corrigée au bloc 5C-3. */}
            <div className="text-sm">
              {etat.statut === "succes" && (
                <p role="status" className="text-eco font-medium">
                  ✓ Fichier téléchargé : {etat.nom}
                </p>
              )}
              {etat.statut === "echec" && (
                <p role="alert" className="text-red-800">
                  <span className="font-medium">Le téléchargement a échoué.</span> {etat.message}
                </p>
              )}
            </div>
          </div>
        </Card>
      </div>
    </section>
  );
}
