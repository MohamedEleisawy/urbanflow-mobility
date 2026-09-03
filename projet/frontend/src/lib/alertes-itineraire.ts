import type { Alert, ItinerarySegment } from "./types";

// =============================================================================
// Perturbations d'UN itinéraire (Phase 5)
// =============================================================================
// ⚠️ CE MODULE EXISTE POUR NE PAS TOUT AFFICHER. Le réseau compte 2 021 lignes
// et l'endpoint d'alertes en rend jusqu'à 200 : les déverser sur chaque
// itinéraire noierait l'information utile sous des perturbations qui ne
// concernent pas l'usager, et lui ferait ignorer celles qui le concernent.
//
// ⚠️ LE RAPPROCHEMENT SE FAIT SUR L'IDENTIFIANT DU FLUX, jamais sur le NOM.
// Le réseau contient des lignes homonymes — un « 4 » de métro et un « 4 » de
// bus — et rapprocher sur le nom afficherait la perturbation du métro 4 à
// quelqu'un qui prend le bus 4.
//
// C'est pour cela que `ItinerarySegment` porte `gtfsLineId` : notre `lineId`
// est un UUID interne, que les flux GTFS-RT ne connaissent pas.
// =============================================================================

/** Une perturbation, et les lignes de l'itinéraire qu'elle touche. */
export interface AlerteItineraire {
  alerte: Alert;
  /** Noms d'affichage des lignes concernées, dans l'ordre du trajet. */
  lignes: string[];
}

/**
 * Les perturbations qui concernent RÉELLEMENT cet itinéraire.
 *
 * Une alerte est retenue si l'une de ses lignes figure parmi celles que le
 * trajet emprunte. L'ordre d'entrée est conservé : le backend classe déjà par
 * gravité décroissante, et retrier ici produirait un ordre différent de celui
 * qu'il documente et teste.
 *
 * ⚠️ UN SEGMENT SANS `gtfsLineId` N'EST JAMAIS RAPPROCHÉ. C'est le cas de la
 * marche et des lignes saisies à la main : elles n'existent dans aucun flux,
 * donc aucune alerte ne peut les désigner. Les rapprocher sur autre chose
 * serait deviner.
 */
export function alertesDeLItineraire(
  alertes: readonly Alert[],
  segments: readonly ItinerarySegment[],
): AlerteItineraire[] {
  // Identifiant de flux → nom d'affichage, dans l'ordre du trajet.
  const empruntees = new Map<string, string>();

  for (const segment of segments) {
    if (segment.gtfsLineId !== null && !empruntees.has(segment.gtfsLineId)) {
      empruntees.set(segment.gtfsLineId, segment.lineName);
    }
  }

  if (empruntees.size === 0) {
    return [];
  }

  const retenues: AlerteItineraire[] = [];

  for (const alerte of alertes) {
    const concernees = alerte.lines
      .filter((ligne) => empruntees.has(ligne.id))
      // Le nom vient de NOTRE référentiel quand l'alerte n'en porte pas :
      // « RER D » est plus utile que l'identifiant brut du flux.
      .map((ligne) => ligne.name ?? empruntees.get(ligne.id) ?? ligne.id);

    if (concernees.length > 0) {
      retenues.push({ alerte, lignes: concernees });
    }
  }

  return retenues;
}
