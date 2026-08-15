// Distance "à vol d'oiseau" entre deux points de la Terre (formule de
// Haversine). Utilisée pour trouver l'arrêt le plus proche des coordonnées
// saisies par l'usager.
//
// Pourquoi Haversine et pas une simple soustraction de coordonnées ?
// Parce que la Terre est une sphère : 1 degré de longitude ne fait pas la
// même distance à l'équateur et près des pôles. Haversine en tient compte.
//
// PostGIS sait faire ce calcul (ST_Distance), mais l'exploitation avancée de
// PostGIS n'est pas encore au programme : quelques lignes de mathématiques
// suffisent ici et restent faciles à expliquer et à tester.

const RAYON_TERRE_M = 6_371_000;

function enRadians(degres: number): number {
  return (degres * Math.PI) / 180;
}

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
    Math.cos(enRadians(lat1)) *
      Math.cos(enRadians(lat2)) *
      Math.sin(dLon / 2) ** 2;

  return 2 * RAYON_TERRE_M * Math.asin(Math.sqrt(a));
}
