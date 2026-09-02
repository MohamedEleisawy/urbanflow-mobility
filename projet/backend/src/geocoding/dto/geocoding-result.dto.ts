/**
 * Un lieu trouvé (Phase 3A).
 *
 * ⚠️ TROIS CHAMPS, PAS UN DE PLUS. Nominatim rend une vingtaine de propriétés
 * par résultat — `osm_id`, `licence`, `boundingbox`, `place_rank`,
 * `importance`, `address` détaillée… Les relayer ferait circuler des données
 * dont le frontend n'a aucun usage, et lierait notre contrat public à celui
 * d'un fournisseur qu'on doit pouvoir remplacer.
 *
 * Le frontend n'a besoin que de QUOI AFFICHER et QUOI ENVOYER au moteur
 * d'itinéraire. C'est exactement ce qu'il reçoit.
 */
export interface GeocodingResultDto {
  /** Libellé affichable — « Tour Eiffel, Paris ». */
  label: string;
  latitude: number;
  longitude: number;
}

/**
 * Réponse de `GET /api/geocoding/search`.
 *
 * Un objet plutôt qu'un tableau nu : cela laisse la place à un champ futur
 * (attribution, plafond atteint…) sans casser les clients — même raison que
 * `AlertsResponse` (5C).
 */
export interface GeocodingResponseDto {
  items: GeocodingResultDto[];
  /**
   * Mention d'attribution à afficher, imposée par la licence des données.
   *
   * Elle voyage AVEC les résultats plutôt que d'être écrite en dur dans le
   * frontend : le jour où le fournisseur change, l'attribution change avec
   * lui, au même endroit.
   */
  attribution: string;
}
