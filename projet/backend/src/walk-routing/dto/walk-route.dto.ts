import { LineStringGeoJson } from '../../gtfs/shape-geometry';

/**
 * Un trajet à pied calculé par un vrai moteur de routage piéton.
 *
 * ⚠️ TOUT VIENT DU MOTEUR, RIEN N'EST DÉDUIT. La distance est celle des rues
 * réellement empruntées — systématiquement SUPÉRIEURE au vol d'oiseau — et la
 * durée celle que le moteur calcule sur son propre profil piéton, pente et
 * type de voie compris. Recalculer l'une à partir de l'autre reviendrait à
 * remplacer une mesure par une estimation.
 */
export interface WalkRouteDto {
  /** Longueur du chemin RÉELLEMENT parcouru, en mètres. */
  distanceM: number;

  /** Durée annoncée par le moteur, en minutes. */
  durationMin: number;

  /**
   * Tracé rue par rue, en GeoJSON `LineString` (`[longitude, latitude]`).
   *
   * ⚠️ C'EST CE QUI DISTINGUE `ROUTED` D'`ESTIMATE`. Une droite entre deux
   * points traverse les immeubles ; ce tracé suit les trottoirs, les passages
   * et les traversées que la base OpenStreetMap décrit.
   */
  geometry: LineStringGeoJson;
}
