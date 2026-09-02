// =============================================================================
// Géométrie des liaisons, découpée depuis shapes.txt (Phase 1B)
// =============================================================================
// Fonctions PURES : aucune base, aucun réseau, aucun état. Tout ce fichier se
// teste avec des tableaux de nombres — c'est ce qui permet de verrouiller
// l'ordre des coordonnées et la découpe sans monter une application.
//
// ═══ LE PROBLÈME QUE CE FICHIER RÉSOUT ═══
//
// `shapes.txt` décrit le tracé COMPLET d'un parcours, point par point. Un
// `NetworkLink`, lui, ne relie que DEUX arrêts consécutifs. Il faut donc
// extraire la portion du tracé comprise entre ces deux arrêts.
//
// ⚠️ Le flux d'Île-de-France Mobilités NE FOURNIT PAS `shape_dist_traveled`,
// ni dans `stop_times.txt`, ni dans `shapes.txt`. GTFS le rend facultatif, et
// c'est précisément la colonne qui dirait où chaque arrêt tombe le long du
// tracé. Sans elle, la position de l'arrêt sur le tracé doit être DÉDUITE.
//
// La déduction retenue est la plus simple qui soit défendable : le point du
// tracé le plus proche de l'arrêt. Mesuré sur 240 arrêts du réseau réel, cet
// écart vaut 12,5 m en médiane, 54,5 m au 95ᵉ centile — l'ordre de grandeur
// d'un quai. C'est une APPROXIMATION, elle est documentée comme telle, et
// elle porte sur le point de coupe : jamais sur le tracé lui-même, qui reste
// exactement celui publié par l'opérateur.
// =============================================================================

/** Un point géographique tel que le lit `shapes.txt` : latitude d'abord. */
export interface PointTrace {
  latitude: number;
  longitude: number;
}

/**
 * LineString GeoJSON (RFC 7946).
 *
 * ⚠️ `coordinates` est une suite de `[longitude, latitude]` — l'inverse de
 * l'usage courant, et l'inverse de Leaflet. C'est la source d'erreur la plus
 * classique de la cartographie : une inversion place Paris en Somalie sans
 * lever la moindre exception. `versGeoJson` est le SEUL endroit du projet qui
 * effectue cette bascule, et un test la verrouille.
 */
export interface LineStringGeoJson {
  type: 'LineString';
  coordinates: [number, number][];
}

/// Rayon terrestre moyen, en mètres.
const RAYON_TERRE_M = 6_371_000;

/**
 * Distance approchée entre deux points, en mètres.
 *
 * Projection équirectangulaire plutôt que haversine : à l'échelle d'une
 * agglomération — quelques dizaines de kilomètres — l'écart entre les deux
 * est très inférieur au mètre, pour un coût de calcul bien moindre. Cette
 * fonction est appelée des millions de fois pendant un import.
 *
 * Elle ne sert qu'à COMPARER des distances (trouver le point le plus proche),
 * jamais à afficher une valeur à un usager.
 */
export function distanceM(a: PointTrace, b: PointTrace): number {
  const latMoyenne = ((a.latitude + b.latitude) / 2) * (Math.PI / 180);
  const dx =
    (b.longitude - a.longitude) *
    (Math.PI / 180) *
    Math.cos(latMoyenne) *
    RAYON_TERRE_M;
  const dy = (b.latitude - a.latitude) * (Math.PI / 180) * RAYON_TERRE_M;

  return Math.hypot(dx, dy);
}

/**
 * Indice du point du tracé le plus proche d'une position.
 *
 * `depuis` permet de n'explorer que l'AVAL du tracé. C'est ce qui règle le
 * cas des lignes qui repassent près d'un même endroit — une boucle, un
 * terminus rebroussant : sans cette borne, l'arrêt d'arrivée pourrait être
 * projeté AVANT celui de départ, et la découpe rendrait un tracé à l'envers.
 */
export function indicePlusProche(
  trace: readonly PointTrace[],
  position: PointTrace,
  depuis = 0,
): { indice: number; distanceM: number } {
  let meilleureDistance = Number.POSITIVE_INFINITY;
  let meilleurIndice = depuis;

  for (let i = depuis; i < trace.length; i++) {
    const d = distanceM(trace[i], position);
    if (d < meilleureDistance) {
      meilleureDistance = d;
      meilleurIndice = i;
    }
  }

  return { indice: meilleurIndice, distanceM: meilleureDistance };
}

/**
 * Portion du tracé comprise entre deux arrêts.
 *
 * Rend `null` — et non un tracé approximatif — dans deux cas :
 *
 *   - le tracé compte moins de deux points, il n'y a rien à découper ;
 *   - l'arrivée se projette AVANT le départ, ou au même point.
 *
 * Le second cas signale une incohérence réelle entre `stop_times.txt` et
 * `shapes.txt` : l'ordre des arrêts ne suit pas celui du tracé. Fabriquer
 * quand même une ligne reviendrait à inventer un parcours. L'appelant
 * retombera sur le tracé arrêt → arrêt, en le disant.
 */
export function decouperTrace(
  trace: readonly PointTrace[],
  depart: PointTrace,
  arrivee: PointTrace,
): PointTrace[] | null {
  if (trace.length < 2) {
    return null;
  }

  const debut = indicePlusProche(trace, depart);
  // ⚠️ `depuis: debut.indice` : la recherche de l'arrivée ne remonte jamais
  // en amont du départ.
  const fin = indicePlusProche(trace, arrivee, debut.indice);

  if (fin.indice <= debut.indice) {
    return null;
  }

  return trace.slice(debut.indice, fin.indice + 1);
}

/**
 * Convertit un tracé en LineString GeoJSON.
 *
 * ⚠️ C'EST ICI, ET NULLE PART AILLEURS, QUE L'ORDRE BASCULE.
 * `[longitude, latitude]`, comme l'impose la RFC 7946.
 *
 * Rend `null` pour un tracé de moins de deux points : un LineString d'un seul
 * point n'est pas un GeoJSON valide, et le stocker produirait une géométrie
 * que rien ne saurait dessiner.
 */
export function versGeoJson(
  trace: readonly PointTrace[],
): LineStringGeoJson | null {
  if (trace.length < 2) {
    return null;
  }

  return {
    type: 'LineString',
    coordinates: trace.map((point) => [point.longitude, point.latitude]),
  };
}

/**
 * Choisit le tracé à retenir quand plusieurs `shape_id` desservent la même
 * paire d'arrêts.
 *
 * ═══ POURQUOI IL FAUT CHOISIR ═══
 *
 * Une même ligne publie plusieurs parcours : service partiel, branche,
 * variante de terminus. Sur le réseau réel, **87,6 % des paires d'arrêts
 * consécutifs sont desservies par plusieurs `shape_id`** (1 371 paires
 * mesurées, jusqu'à 10 tracés pour une seule paire).
 *
 * ═══ POURQUOI CE CHOIX EST SANS CONSÉQUENCE ═══
 *
 * Ces variantes diffèrent sur L'ENSEMBLE de la ligne, pas ENTRE DEUX ARRÊTS
 * CONSÉCUTIFS — deux parcours qui desservent A puis B empruntent la même
 * voie entre A et B. Mesuré sur 120 paires tirées au sort : écart de
 * longueur nul en médiane comme au 95ᵉ centile, et **99,2 % des tracés
 * découpés coïncident à moins de 5 mètres**.
 *
 * Le seul cas divergent de l'échantillon (0,8 %) correspond à une vraie
 * variante de voie ; la règle ci-dessous en retient alors la plus fréquente,
 * c'est-à-dire celle réellement parcourue par le plus grand nombre de
 * trajets.
 *
 * ═══ LA RÈGLE ═══
 *
 * Le `shape_id` porté par le PLUS GRAND NOMBRE de trajets, les égalités
 * étant départagées par l'ordre alphabétique. Deux imports du même flux
 * rendent donc exactement le même résultat.
 */
export function choisirShape(
  occurrences: ReadonlyMap<string, number>,
): string | null {
  let retenu: string | null = null;
  let meilleur = -1;

  for (const [shapeId, nombre] of occurrences) {
    if (
      nombre > meilleur ||
      (nombre === meilleur && retenu !== null && shapeId < retenu)
    ) {
      retenu = shapeId;
      meilleur = nombre;
    }
  }

  return retenu;
}
