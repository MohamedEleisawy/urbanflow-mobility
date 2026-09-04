// =============================================================================
// Marche à pied — estimation
// =============================================================================
// ═══ POURQUOI CE MODULE EXISTE ═══
//
// La marche est le LIANT de toute la multimodalité : elle relie une adresse à
// un quai, un quai à une adresse, et parfois une adresse à une autre sans
// prendre le moindre véhicule. Sans elle, un itinéraire commence au milieu de
// nulle part — « prenez le tram E à Jardiniers » sans jamais dire comment
// atteindre Jardiniers, ni compter les minutes qu'il faut pour cela.
//
// La règle de conversion « des mètres → des minutes » était écrite en privé
// dans `StopsService`, où le moteur d'itinéraires ne pouvait pas l'atteindre.
// Deux copies auraient divergé : le même trajet aurait affiché deux durées de
// marche différentes selon l'écran.
//
// ═══ CE QUE CE MODULE NE PRÉTEND PAS ÊTRE ═══
//
// ⚠️ CE N'EST PAS UN ROUTEUR PIÉTON. Il ne connaît ni les rues, ni les
// traversées, ni les passerelles, ni le dénivelé. Il applique une vitesse à
// une distance À VOL D'OISEAU — et une voie ferrée ou un fleuve entre les deux
// points peut doubler le trajet réel.
//
// C'est pour cela que toute marche produite ici sort marquée `ESTIMATE`, et
// que l'interface a le devoir de le dire. Un routeur configuré
// (`WALK_ROUTING_PROVIDER`) produirait des trajets `ROUTED` — mais tant qu'il
// n'y en a pas, une estimation honnête vaut infiniment mieux que le silence :
// « marche indisponible » ferait croire qu'on ne peut pas marcher.
// =============================================================================

/**
 * Provenance d'une distance de marche.
 *
 * ⚠️ LES DEUX NE SE VALENT PAS ET NE DOIVENT JAMAIS ÊTRE CONFONDUES :
 *
 *   `ESTIMATE` distance à vol d'oiseau × vitesse moyenne. Minorée par
 *              construction : le chemin réel est toujours plus long.
 *   `ROUTED`   itinéraire rue par rue rendu par un routeur piéton.
 *
 * Aucune valeur `ROUTED` n'est produite tant qu'aucun routeur n'est
 * configuré ; le type existe pour que l'interface soit écrite dès maintenant
 * pour les deux cas, et que brancher un routeur ne demande pas de la réécrire.
 */
export type SourceMarche = 'ESTIMATE' | 'ROUTED';

/**
 * Vitesse de marche retenue, en mètres par minute (4,5 km/h).
 *
 * Elle n'est pas inventée ici : c'est la vitesse d'un adulte en milieu urbain
 * retenue par la plupart des calculateurs d'itinéraires. Ce qui est approximé,
 * c'est la DISTANCE à laquelle on l'applique, pas la vitesse elle-même.
 */
export const METRES_PAR_MINUTE = 75;

/**
 * Temps de marche estimé pour une distance à vol d'oiseau, en minutes.
 *
 * ⚠️ MINIMUM UNE MINUTE. « 0 min de marche » se lit comme « vous y êtes », ce
 * qui est faux à cinquante mètres d'un quai — et ferait disparaître l'étape de
 * l'affichage alors qu'il faut bel et bien traverser une place.
 *
 * ⚠️ UNE DISTANCE NULLE RESTE UNE MINUTE, et non zéro : le seul cas où elle se
 * produit est un point rigoureusement confondu avec un arrêt, ce qui
 * n'arrive pas dans la vie réelle. Rendre zéro là créerait une étape
 * « 0 m, 0 min » que rien ne distinguerait d'une donnée manquante.
 */
export function minutesDeMarche(distanceM: number): number {
  if (!Number.isFinite(distanceM) || distanceM <= 0) {
    return 1;
  }

  return Math.max(1, Math.round(distanceM / METRES_PAR_MINUTE));
}
