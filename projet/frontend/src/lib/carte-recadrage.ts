// =============================================================================
// Origine d'un déplacement de carte — logique PURE
// =============================================================================
// ═══ LE BUG QUE CE MODULE EXISTE POUR RENDRE IMPOSSIBLE ═══
//
// Leaflet émet le MÊME événement `moveend` que l'usager ait glissé la carte au
// doigt ou que le code l'ait recadrée par `setView`, `fitBounds` ou `panTo`.
//
// Rapporter les seconds au parent comme s'ils venaient de l'usager referme une
// boucle de rendu :
//
//   rendu → recadrage → `moveend` → `onCentreDeplace` → `setState`
//         → rendu → recadrage → …
//
// Elle s'est réellement produite : « Maximum update depth exceeded », le
// processeur à 100 %, la machine qui chauffe.
//
// ═══ POURQUOI UN MODULE À PART, SANS REACT NI LEAFLET ═══
//
// Parce que c'est la seule partie de l'affaire qui soit une RÈGLE, et qu'une
// règle doit pouvoir s'éprouver sans navigateur, sans DOM et sans carte. Le
// composant, lui, ne fait plus que brancher des événements dessus.
//
// C'est la même séparation que `navigation-suivi.ts` : les mathématiques d'un
// côté, le branchement de l'autre.
// =============================================================================

import { haversineDistanceM } from "./geo";

/**
 * Écart en deçà duquel un `moveend` est attribué à un recadrage programmé.
 *
 * ⚠️ IL NE PEUT PAS ÊTRE ZÉRO. `fitBounds` arrondit au niveau de zoom et à la
 * grille de pixels : la vue finale tombe à quelques mètres de la cible
 * calculée, jamais exactement dessus.
 *
 * 25 m est très au-dessus de cet arrondi, et bien en dessous du seuil à partir
 * duquel un parent recharge ses données (50 m côté recherche) : aucun geste
 * réel de l'usager ne peut être avalé par cette tolérance.
 */
export const TOLERANCE_RECADRAGE_M = 25;

/** Un point de la carte, tel que Leaflet le nomme. */
export interface CentreCarte {
  lat: number;
  lng: number;
}

/**
 * Mémoire de ce que le CODE a demandé à la carte, pour reconnaître l'écho de
 * ses propres recadrages.
 *
 * ═══ DEUX GARDE-FOUS, PARCE QUE LEAFLET A DEUX RÉGIMES ═══
 *
 *   `enCours`  vrai pendant l'appel. Couvre les mouvements NON ANIMÉS, dont le
 *              `moveend` part de façon SYNCHRONE, à l'intérieur de l'appel.
 *   `cible`    la position visée. Rattrape les mouvements ANIMÉS (`panTo` du
 *              suivi GPS), dont le `moveend` n'arrive qu'à la fin de
 *              l'animation.
 *
 * ⚠️ AUCUN DES DEUX NE PEUT SE BLOQUER — et c'est la raison de ne PAS avoir
 * pris un compteur. Un compteur se désynchronise le jour où Leaflet n'émet
 * aucun événement (recadrage sur la position déjà courante) : il resterait
 * positif, et tous les déplacements suivants de l'usager seraient ignorés en
 * silence, la carte cessant de recharger ses données.
 *
 * Ici, le drapeau retombe toujours (`finally`) et la cible est oubliée au
 * premier `moveend` qui lui correspond.
 */
export class SuiviRecadrage {
  private enCours = false;
  private cible: CentreCarte | null = null;

  /**
   * Exécute un recadrage en le marquant comme programmé.
   *
   * Tout `setView` / `fitBounds` / `panTo` doit passer par ici : c'est le seul
   * endroit qui arme les deux garde-fous.
   *
   * @param cible position visée par le recadrage
   * @param action le déplacement lui-même
   */
  programmer(cible: CentreCarte, action: () => void): void {
    this.cible = cible;
    this.enCours = true;

    try {
      action();
    } finally {
      // ⚠️ `finally` : même si Leaflet lève, le drapeau retombe. Le laisser
      // levé ferait ignorer tous les déplacements suivants de l'usager.
      this.enCours = false;
    }
  }

  /**
   * Ce `moveend` est-il l'écho d'un recadrage programmé ?
   *
   * ⚠️ CONSOMME la cible quand elle correspond : le prochain glissement de
   * l'usager vers ce même point doit, lui, être rapporté.
   *
   * @param vue centre de la carte au moment de l'événement
   */
  estEcho(vue: CentreCarte): boolean {
    // Régime synchrone : l'événement part pendant l'appel, le drapeau est
    // encore levé.
    if (this.enCours) {
      this.cible = null;
      return true;
    }

    const cible = this.cible;

    if (cible === null) {
      return false;
    }

    // Régime animé : l'événement arrive plus tard. On reconnaît alors le
    // recadrage à sa DESTINATION.
    const atteinte =
      haversineDistanceM(vue.lat, vue.lng, cible.lat, cible.lng) <=
      TOLERANCE_RECADRAGE_M;

    if (atteinte) {
      this.cible = null;
    }

    return atteinte;
  }
}
