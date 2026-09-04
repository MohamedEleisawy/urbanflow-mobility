// =============================================================================
// Décodage d'une polyligne encodée — logique PURE
// =============================================================================
// ═══ POURQUOI CE FICHIER EXISTE ═══
//
// Les moteurs de routage ne rendent pas la géométrie en GeoJSON : ils la
// compressent dans le format « encoded polyline » de Google, qui divise par
// dix le poids d'un tracé de plusieurs centaines de points. Valhalla l'emploie
// avec une précision de 10⁻⁶ degré (~11 cm).
//
// C'est un ALGORITHME, pas une règle métier : il ne dépend d'aucun choix du
// projet, et se vérifie sur des valeurs connues. Il vit donc à part du service
// qui appelle le réseau, et se teste sans le moindre `fetch`.
// =============================================================================

/**
 * Décode une polyligne encodée en une suite de `[latitude, longitude]`.
 *
 * ⚠️ LA PRÉCISION N'EST PAS UNE CONVENTION UNIVERSELLE. Google et OSRM
 * encodent au 10⁻⁵ ; Valhalla au 10⁻⁶. Se tromper d'un facteur dix ne lève
 * aucune erreur : le tracé se retrouve simplement à dix degrés de là — au
 * milieu de la mer du Nord pour un trajet strasbourgeois. Le paramètre est
 * donc EXPLICITE, sans valeur par défaut à deviner.
 *
 * ⚠️ REND UN TABLEAU VIDE SUR UNE ENTRÉE ILLISIBLE, jamais une exception ni
 * des coordonnées partielles : un fournisseur externe peut changer de format
 * sans prévenir, et l'appelant doit pouvoir retomber sur son estimation.
 */
export function decoderPolyligne(
  encodee: string,
  precision: number,
): [number, number][] {
  if (typeof encodee !== 'string' || encodee.length === 0) {
    return [];
  }

  const facteur = 10 ** precision;
  const points: [number, number][] = [];

  let index = 0;
  let latitude = 0;
  let longitude = 0;

  // Chaque coordonnée est une VARIATION par rapport à la précédente, encodée
  // en base 64 par groupes de cinq bits. C'est ce delta qui rend le format
  // compact : deux points voisins ne diffèrent que de quelques unités.
  const prochaineVariation = (): number | null => {
    let resultat = 0;
    let decalage = 0;
    let octet: number;

    do {
      if (index >= encodee.length) {
        return null;
      }

      octet = encodee.charCodeAt(index++) - 63;

      if (octet < 0) {
        return null;
      }

      resultat |= (octet & 0x1f) << decalage;
      decalage += 5;
      // Le bit de poids fort signale qu'un autre groupe suit.
    } while (octet >= 0x20);

    // Le bit de poids faible porte le SIGNE : les valeurs sont en complément
    // à deux décalé d'un rang.
    return resultat & 1 ? ~(resultat >> 1) : resultat >> 1;
  };

  while (index < encodee.length) {
    const dLat = prochaineVariation();
    const dLon = prochaineVariation();

    if (dLat === null || dLon === null) {
      // Chaîne tronquée : on rend ce qui a été lu jusque-là plutôt que de
      // fabriquer un point à partir d'une variation manquante.
      break;
    }

    latitude += dLat;
    longitude += dLon;

    points.push([latitude / facteur, longitude / facteur]);
  }

  return points;
}
