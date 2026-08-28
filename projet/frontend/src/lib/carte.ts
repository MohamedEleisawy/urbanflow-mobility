// =============================================================================
// Données géographiques de la carte (bloc 5B)
// =============================================================================
// Ce module ne contient AUCUN code Leaflet. Il traduit les données du backend
// en points et en tracés — des nombres, testables sans DOM ni navigateur.
//
// ⚠️ CE QUE LE BACKEND NE FOURNIT PAS. Il n'existe nulle part de géométrie de
// voie : ni `shapes.txt` GTFS, ni colonne PostGIS de type `LineString`, ni
// champ `geometry` sur `NetworkLink`. Les seules coordonnées du modèle sont
// `Stop.latitude` / `Stop.longitude`.
//
// Un tracé ne peut donc relier que des ARRÊTS RÉELS, en ligne droite. Ce n'est
// pas le chemin emprunté par le véhicule, et l'interface doit le dire — d'où
// le vocabulaire « schématique » employé partout dans la carte.
// =============================================================================

import type { Stop } from "./types";

/** Un point affichable : une position réelle, portant un nom réel. */
export interface PointCarte {
  id: string;
  nom: string;
  latitude: number;
  longitude: number;
}

/**
 * Centre de repli, utilisé UNIQUEMENT quand il n'y a rien à cadrer.
 *
 * Dès qu'un point existe, la carte s'ajuste sur les points eux-mêmes : cette
 * valeur ne sert alors jamais. Ce n'est pas une donnée métier, c'est une
 * position de caméra par défaut.
 */
export const CENTRE_DEFAUT: [number, number] = [48.8566, 2.3522];

/** Traduit un arrêt du backend en point affichable. */
export function pointDepuisArret(arret: Stop): PointCarte {
  return {
    id: arret.id,
    nom: arret.name,
    latitude: arret.latitude,
    longitude: arret.longitude,
  };
}

/**
 * Index `id interne → point`, construit UNE FOIS depuis la liste des arrêts.
 *
 * ⚠️ Indexé par `id`, jamais par `gtfsStopId` : ce dernier est nul pour tout
 * arrêt saisi à la main, et les segments désignent de toute façon l'`id`
 * interne (`fromStopId`, `toStopId`).
 *
 * C'est ce qui évite un N+1 réseau : la carte ne résout jamais un arrêt par un
 * appel individuel à `GET /api/stops/:id`.
 */
export function indexerArrets(arrets: readonly Stop[]): Map<string, PointCarte> {
  return new Map(arrets.map((arret) => [arret.id, pointDepuisArret(arret)]));
}

/** Ce dont le tracé a besoin d'un segment — commun à la recherche et à l'historique. */
export interface SegmentGeographique {
  fromStopId: string;
  toStopId: string;
}

/**
 * Suite ordonnée des arrêts desservis par une liste de segments.
 *
 * Rend `null` — et donc AUCUN tracé — dans trois cas, tous volontaires :
 *
 *  1. aucun segment : il n'y a rien à relier ;
 *  2. un arrêt introuvable dans l'index : relier ses voisins directement
 *     dessinerait une ligne qui saute une étape réelle, donc un mensonge ;
 *  3. des segments qui ne s'enchaînent pas (`toStopId` ≠ `fromStopId` du
 *     suivant) : la ligne franchirait un vide inventé.
 *
 * Mieux vaut ne rien tracer que tracer faux : les étapes restent lisibles en
 * texte, qui reste la source d'information de référence.
 */
export function traceDepuisSegments(
  segments: readonly SegmentGeographique[],
  index: ReadonlyMap<string, PointCarte>,
): PointCarte[] | null {
  if (segments.length === 0) {
    return null;
  }

  const points: PointCarte[] = [];

  for (const [rang, segment] of segments.entries()) {
    // Les segments doivent former une chaîne continue. Le backend l'impose à
    // l'enregistrement, et Dijkstra la produit naturellement à la recherche —
    // mais on ne dessine pas sur la foi d'une invariante non vérifiée.
    if (rang > 0 && segments[rang - 1].toStopId !== segment.fromStopId) {
      return null;
    }

    const depart = index.get(segment.fromStopId);
    const arrivee = index.get(segment.toStopId);

    if (!depart || !arrivee) {
      return null;
    }

    if (rang === 0) {
      points.push(depart);
    }
    points.push(arrivee);
  }

  return points;
}
