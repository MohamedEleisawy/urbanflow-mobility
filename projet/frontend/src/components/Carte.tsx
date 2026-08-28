"use client";

import dynamic from "next/dynamic";
import type { PointCarte } from "@/lib/carte";

// =============================================================================
// Carte interactive (bloc 5B)
// =============================================================================
// LA FRONTIÈRE CLIENT. Leaflet manipule `window` dès son import : le laisser
// entrer dans le rendu serveur ferait échouer `next build`. Le guide de cette
// version (`node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md`)
// prévoit exactement ce cas :
//
//   « If you want to disable prerendering for a Client Component, you can use
//     the `ssr` option set to `false` »
//
// et précise que `ssr: false` n'est autorisé que DANS un composant client —
// d'où le « use client » de ce fichier, alors qu'il n'a ni état ni événement.
//
// Effet secondaire recherché : Leaflet et sa feuille de style ne sont
// téléchargés QUE sur les écrans qui montrent une carte. Les pages
// d'authentification, l'espace personnel et l'historique n'en paient rien.
// =============================================================================

const CarteLeaflet = dynamic(() => import("./CarteLeaflet"), {
  ssr: false,
  loading: () => (
    <div
      className="flex h-full w-full items-center justify-center bg-neutral-100 text-sm text-neutral-600"
      // Le chargement de la carte n'est pas une information : l'usager a déjà
      // les étapes sous les yeux. L'annoncer interromprait sa lecture.
      aria-hidden="true"
    >
      Chargement de la carte…
    </div>
  ),
});

export interface CarteProps {
  /** Titre visible, qui nomme ce que la carte montre. */
  titre: string;
  /**
   * Équivalent textuel du contenu de la carte, affiché sous elle.
   *
   * ⚠️ AFFICHÉ, pas caché : ce n'est pas un `alt` réservé aux lecteurs
   * d'écran. Une carte est illisible pour bien d'autres raisons que la cécité
   * — tuiles bloquées, connexion coupée, écran minuscule.
   */
  description: string;
  arrets: readonly PointCarte[];
  /** Trajet mis en avant, ou `null` si aucun n'est sélectionné. */
  trace?: readonly PointCarte[] | null;
}

/**
 * Cadre autour de la carte : titre, hauteur, équivalent textuel, attribution.
 *
 * NE FAIT AUCUN APPEL RÉSEAU et ne connaît aucun itinéraire. Elle reçoit des
 * points déjà résolus — c'est aux pages, qui disposent déjà des arrêts, de les
 * lui fournir. La carte reste ainsi un COMPLÉMENT : la retirer ne ferait
 * perdre aucune information.
 */
export function Carte({ titre, description, arrets, trace = null }: CarteProps) {
  return (
    <section aria-labelledby="carte" className="space-y-2">
      <h2 id="carte" className="text-ink text-lg font-semibold">
        {titre}
      </h2>

      {/* HAUTEUR EXPLICITE, et en unités relatives à l'écran : un conteneur
          Leaflet sans hauteur mesurable ne dessine rien du tout. Plus basse
          sur mobile, où l'écran doit rester utilisable sous la carte. */}
      <div className="h-64 w-full overflow-hidden rounded-lg border border-neutral-200 sm:h-96">
        {arrets.length === 0 && !trace ? (
          <p className="flex h-full w-full items-center justify-center bg-neutral-100 px-6 text-center text-sm text-neutral-600">
            Aucun arrêt à afficher sur la carte.
          </p>
        ) : (
          <CarteLeaflet arrets={arrets} trace={trace} />
        )}
      </div>

      <p className="text-sm text-neutral-600">{description}</p>
    </section>
  );
}
