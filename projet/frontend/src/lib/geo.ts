// =============================================================================
// Distances géographiques (Phase 5)
// =============================================================================
// ⚠️ POURQUOI CETTE FONCTION EXISTE AUSSI CÔTÉ FRONTEND, alors que le backend
// en a déjà une (`src/common/geo/distance.util.ts`).
//
// Ce n'est pas une duplication de RÈGLE MÉTIER : c'est une formule de
// géométrie sphérique, universelle et immuable, pas une décision du projet.
// Le rayon terrestre ne changera pas, et les deux implémentations ne peuvent
// pas « diverger » au sens où deux barèmes de tarif divergeraient.
//
// L'alternative — demander au serveur la distance entre la position GPS et le
// trajet — coûterait un aller-retour réseau PAR RELEVÉ GPS, soit plusieurs par
// seconde pendant toute la navigation. C'est exactement ce que
// l'éco-conception du projet interdit.
// =============================================================================

/**
 * Rayon moyen de la Terre, en mètres (IUGG).
 *
 * La Terre n'est pas une sphère : ce rayon moyen introduit une erreur de
 * l'ordre de 0,3 %, soit 3 m sur 1 km. Très en deçà de la précision d'un GPS
 * de téléphone, qui se compte en dizaines de mètres.
 */
const RAYON_TERRE_M = 6_371_008.8;

const enRadians = (degres: number) => (degres * Math.PI) / 180;

/**
 * Distance à vol d'oiseau entre deux points, en mètres (formule de Haversine).
 *
 * ⚠️ ORDRE DES ARGUMENTS : latitude PUIS longitude, pour chaque point. C'est
 * l'ordre usuel — et l'inverse de GeoJSON, qui écrit `[longitude, latitude]`.
 * Les intervertir ne lèverait aucune erreur : cela rendrait simplement une
 * distance fausse.
 */
export function haversineDistanceM(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = enRadians(lat2 - lat1);
  const dLon = enRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(enRadians(lat1)) * Math.cos(enRadians(lat2)) * Math.sin(dLon / 2) ** 2;

  return 2 * RAYON_TERRE_M * Math.asin(Math.min(1, Math.sqrt(a)));
}
