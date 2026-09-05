// =============================================================================
// Données géographiques de la carte (bloc 5B)
// =============================================================================
// Ce module ne contient AUCUN code Leaflet. Il traduit les données du backend
// en points et en tracés — des nombres, testables sans DOM ni navigateur.
//
// ⚠️ CE QUI A CHANGÉ EN PHASE 4. Le commentaire d'origine disait, à juste
// titre pour l'époque : « il n'existe nulle part de géométrie de voie ». C'est
// désormais FAUX. `NetworkLink.geometry` porte le tracé réel issu de
// `shapes.txt`, et chaque segment d'itinéraire le transporte jusqu'ici.
//
// Mais SEULEMENT 2 858 des 6 676 liaisons en ont un. Les deux cas coexistent
// donc, et l'interface ne doit jamais les confondre :
//
//   `SHAPE`    le tracé réel de la voie, tel que publié par l'opérateur ;
//   `STRAIGHT` une droite entre deux arrêts, faute de mieux — ce n'est PAS le
//              chemin emprunté par le véhicule, et il faut le dire.
//
// C'est `geometrySource` qui porte la distinction, et `tronconsDItineraire`
// qui la fait remonter jusqu'au dessin.
// =============================================================================

import type {
  GeoJsonLineString,
  ItinerarySegment,
  ItineraryWalkLeg,
  Stop,
  TransportMode,
} from "./types";

/** Un point affichable : une position réelle, portant un nom réel. */
export interface PointCarte {
  id: string;
  nom: string;
  latitude: number;
  longitude: number;
}

/**
 * Centre de repli, utilisé UNIQUEMENT en dernier recours.
 *
 * ⚠️ CE N'EST PLUS LE CENTRE DU TERRITOIRE. Il l'était — c'étaient les
 * coordonnées de Paris, écrites en dur — et c'est précisément ce qui enfermait
 * le produit dans une métropole. Le centre réel vient désormais du backend
 * (`GET /api/territory`), seule source de vérité.
 *
 * Cette constante ne sert donc plus que dans les deux instants où le
 * territoire n'est pas encore connu : le tout premier rendu, et un échec de
 * l'appel. Elle vise le centre de la France métropolitaine — un repli neutre,
 * qui n'affirme aucune ville.
 *
 * Ce n'est pas une donnée métier, c'est une position de caméra.
 */
export const CENTRE_DEFAUT: [number, number] = [46.6, 2.5];

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

// =============================================================================
// Tracés d'itinéraire (Phase 4)
// =============================================================================

/**
 * Un tronçon dessinable : une suite de points, et ce qu'il faut savoir pour
 * le représenter honnêtement.
 *
 * ⚠️ `points` est en **[latitude, longitude]** — l'ordre de Leaflet, et
 * l'INVERSE de GeoJSON. La conversion se fait ici, une fois pour toutes :
 * c'est le seul endroit du frontend où l'ordre GeoJSON existe.
 */
export interface TronconTrace {
  /** Segment d'origine, pour la légende et l'infobulle. */
  cle: string;
  points: [number, number][];
  mode: TransportMode;
  lineName: string;
  /**
   * D'où vient le tracé — trois provenances, jamais confondues :
   *
   *   `SHAPE`         la voie réelle, publiée par l'opérateur.
   *   `STRAIGHT`      une droite entre deux ARRÊTS, faute de `shapes.txt`.
   *   `WALK_ROUTED`   un vrai chemin piéton, rue par rue, calculé par un
   *                   moteur de routage sur les données OpenStreetMap.
   *   `WALK_ESTIMATE` une droite entre deux POINTS À PIED, faute de moteur.
   *                   Ce n'est PAS un itinéraire piéton : elle traverse les
   *                   immeubles et minore la distance. L'interface doit le dire.
   */
  source: "SHAPE" | "ROUTED" | "STRAIGHT" | "WALK_ROUTED" | "WALK_ESTIMATE";
}

/**
 * Vérifie qu'une valeur venue du backend est bien un LineString utilisable.
 *
 * ⚠️ POURQUOI CETTE VÉRIFICATION EXISTE. `NetworkLink.geometry` est une
 * colonne `Json` : PostgreSQL n'en contrôle pas la forme, et le contrat la
 * transporte en `unknown`. Faire confiance au type déclaré ferait planter la
 * carte sur une donnée malformée, au lieu de la dessiner sans ce tronçon.
 *
 * Deux points au minimum : une « ligne » d'un seul point ne se dessine pas.
 */
function estLineString(valeur: unknown): valeur is GeoJsonLineString {
  if (typeof valeur !== "object" || valeur === null) {
    return false;
  }

  const objet = valeur as { type?: unknown; coordinates?: unknown };

  if (objet.type !== "LineString" || !Array.isArray(objet.coordinates)) {
    return false;
  }

  return (
    objet.coordinates.length >= 2 &&
    objet.coordinates.every(
      (point) =>
        Array.isArray(point) &&
        point.length >= 2 &&
        typeof point[0] === "number" &&
        typeof point[1] === "number" &&
        Number.isFinite(point[0]) &&
        Number.isFinite(point[1]),
    )
  );
}

/**
 * Traduit les segments d'un itinéraire en tronçons dessinables.
 *
 * UN TRONÇON PAR SEGMENT, et non une seule polyligne pour tout le trajet :
 * c'est ce qui permet de colorer chaque portion selon son mode, et de
 * distinguer visuellement un tracé réel d'une droite de repli.
 *
 * ⚠️ REPLI EXPLICITE. Quand la géométrie manque ou est malformée, on relie les
 * deux arrêts en droite ET on marque le tronçon `STRAIGHT`. On ne renonce pas
 * à dessiner — l'usager verrait un trou dans son trajet — mais on ne fait pas
 * passer la droite pour un tracé.
 */
export function tronconsDItineraire(
  segments: readonly ItinerarySegment[],
): TronconTrace[] {
  return segments.map((segment, rang) => {
    const commun = {
      // Le rang fait partie de la clé : une même liaison peut apparaître deux
      // fois dans un aller-retour, et React exige des clés uniques.
      cle: `${rang}-${segment.lineId}-${segment.fromStopId}-${segment.toStopId}`,
      mode: segment.mode,
      lineName: segment.lineName,
    };

    // ⚠️ `SHAPE` (opérateur) ET `ROUTED` (moteur de routage, cas du vélo) sont
    // tous deux de VRAIS tracés : ils se dessinent en trait plein. Seule
    // l'infobulle les distingue.
    if (
      (segment.geometrySource === "SHAPE" ||
        segment.geometrySource === "ROUTED") &&
      estLineString(segment.geometry)
    ) {
      return {
        ...commun,
        // GeoJSON dit [lon, lat] ; Leaflet veut [lat, lon].
        points: segment.geometry.coordinates.map(
          ([lon, lat]) => [lat, lon] as [number, number],
        ),
        source: segment.geometrySource === "ROUTED" ? ("ROUTED" as const) : ("SHAPE" as const),
      };
    }

    return {
      ...commun,
      points: [
        [segment.fromStopLat, segment.fromStopLon],
        [segment.toStopLat, segment.toStopLon],
      ],
      source: "STRAIGHT" as const,
    };
  });
}

/**
 * Les arrêts desservis par un itinéraire, dans l'ordre, sans doublon.
 *
 * Sert aux marqueurs et au cadrage. Aucune résolution d'identifiant : depuis
 * la Phase 4, chaque segment porte les noms et les coordonnées de ses deux
 * arrêts.
 */
export function arretsDItineraire(
  segments: readonly ItinerarySegment[],
): PointCarte[] {
  const points: PointCarte[] = [];
  const vus = new Set<string>();

  const ajouter = (id: string, nom: string, latitude: number, longitude: number) => {
    // Le `toStopId` d'un segment est le `fromStopId` du suivant : sans cette
    // garde, chaque arrêt intermédiaire serait dessiné deux fois.
    if (vus.has(id)) return;
    vus.add(id);
    points.push({ id, nom, latitude, longitude });
  };

  for (const segment of segments) {
    ajouter(
      segment.fromStopId,
      segment.fromStopName,
      segment.fromStopLat,
      segment.fromStopLon,
    );
    ajouter(
      segment.toStopId,
      segment.toStopName,
      segment.toStopLat,
      segment.toStopLon,
    );
  }

  return points;
}

/**
 * Vrai si au moins un tronçon est une droite de repli.
 *
 * L'interface s'en sert pour l'annoncer, une fois, sous la carte — plutôt que
 * de laisser croire que tout le tracé est exact.
 */
export function comporteUnRepli(troncons: readonly TronconTrace[]): boolean {
  return troncons.some((troncon) => troncon.source === "STRAIGHT");
}

/**
 * Tracé d'une marche, entre deux points connus.
 *
 * ═══ CE QUE CETTE FONCTION N'EST PAS ═══
 *
 * ⚠️ CE N'EST PAS UN CALCUL D'ITINÉRAIRE PIÉTON. Aucun routeur n'est
 * configuré : on ne connaît ni les rues, ni les traversées, ni les ponts. Le
 * segment rendu ici est la DROITE entre les deux points — de quoi montrer
 * la direction et l'échelle, rien de plus. L'appeler « itinéraire piéton »
 * serait un mensonge, et c'est pourquoi le tronçon qui la porte sort marqué
 * `WALK_ESTIMATE` et se dessine en pointillés.
 *
 * ⚠️ REND `null` QUAND LES DEUX POINTS SONT CONFONDUS. Une « ligne » d'un
 * seul point ne se dessine pas, et Leaflet en ferait un cadrage de largeur
 * nulle — donc un zoom maximal sur un point, ce qui déroute plus que ça
 * n'informe.
 */
export function geometrieMarcheEstimee(
  depuis: { latitude: number; longitude: number },
  vers: { latitude: number; longitude: number },
): [number, number][] | null {
  if (depuis.latitude === vers.latitude && depuis.longitude === vers.longitude) {
    return null;
  }

  return [
    [depuis.latitude, depuis.longitude],
    [vers.latitude, vers.longitude],
  ];
}

/**
 * Tronçon dessinable d'une marche d'approche ou de sortie.
 *
 * Rend `null` quand il n'y a rien à tracer — marche absente, ou deux points
 * confondus.
 */
export function tronconDeMarche(
  marche: ItineraryWalkLeg | null,
  cle: string,
  libelle: string,
): TronconTrace | null {
  if (marche === null) {
    return null;
  }

  // ═══ LE VRAI CHEMIN D'ABORD ═══
  //
  // ⚠️ QUAND LE BACKEND A CALCULÉ UN ITINÉRAIRE PIÉTON, ON LE DESSINE — et on
  // ne retombe JAMAIS sur la droite. C'est toute la différence entre un tracé
  // qui suit les trottoirs et un trait qui traverse un pâté de maisons.
  if (marche.source === "ROUTED" && marche.geometry) {
    return {
      cle,
      // GeoJSON dit [lon, lat] ; Leaflet veut [lat, lon].
      points: marche.geometry.coordinates.map(
        ([lon, lat]) => [lat, lon] as [number, number],
      ),
      mode: "WALK",
      lineName: libelle,
      source: "WALK_ROUTED",
    };
  }

  const points = geometrieMarcheEstimee(
    { latitude: marche.fromLat, longitude: marche.fromLon },
    { latitude: marche.toLat, longitude: marche.toLon },
  );

  if (points === null) {
    return null;
  }

  return {
    cle,
    points,
    mode: "WALK",
    lineName: libelle,
    source: "WALK_ESTIMATE",
  };
}

/**
 * TOUS les tronçons d'un itinéraire : la marche d'approche, les tronçons du
 * réseau, la marche de sortie.
 *
 * ⚠️ C'EST CETTE FONCTION QUE LA CARTE DOIT UTILISER, et non
 * `tronconsDItineraire` seule. Un trajet entièrement à pied n'a AUCUN tronçon
 * de réseau : la carte restait donc vide, et l'usager voyait un fond
 * cartographique sans le moindre trait — comme si le trajet n'existait pas.
 */
export function tronconsDuTrajet(itineraire: {
  segments: readonly ItinerarySegment[];
  walkAccess: ItineraryWalkLeg | null;
  walkEgress: ItineraryWalkLeg | null;
}): TronconTrace[] {
  const acces = tronconDeMarche(
    itineraire.walkAccess,
    "marche-acces",
    "Marche",
  );
  const sortie = tronconDeMarche(
    itineraire.walkEgress,
    "marche-sortie",
    "Marche",
  );

  return [
    ...(acces ? [acces] : []),
    ...tronconsDItineraire(itineraire.segments),
    ...(sortie ? [sortie] : []),
  ];
}

/**
 * Les points à marquer sur la carte pour un itinéraire : le départ demandé,
 * les arrêts traversés, la destination demandée.
 *
 * ⚠️ LE DÉPART ET L'ARRIVÉE SONT DES POINTS DEMANDÉS, PAS DES ARRÊTS. Leurs
 * identifiants sont synthétiques et ne servent QU'à l'affichage : ils ne sont
 * jamais renvoyés au serveur, où ils ne correspondraient à aucune ligne de la
 * table des arrêts.
 */
export function pointsDuTrajet(
  itineraire: {
    segments: readonly ItinerarySegment[];
    walkAccess: ItineraryWalkLeg | null;
    walkEgress: ItineraryWalkLeg | null;
  },
  origine: { label: string; latitude: number; longitude: number } | null,
  destination: { label: string; latitude: number; longitude: number } | null,
): PointCarte[] {
  const points: PointCarte[] = [];

  // ⚠️ UN REPÈRE DE DÉPART N'EST AJOUTÉ QUE S'IL EST DISTINCT DU PREMIER
  // ARRÊT — et la donnée le dit sans ambiguïté : une marche d'approche existe
  // exactement quand le point demandé n'est pas le premier arrêt. Sans cette
  // condition, choisir « Homme de Fer » comme départ dessinait DEUX marqueurs
  // superposés portant le même nom.
  //
  // Un trajet sans aucun tronçon est le cas limite : ses deux bouts sont les
  // seuls repères qu'il possède.
  const aPied = itineraire.segments.length === 0;

  if (origine && (aPied || itineraire.walkAccess !== null)) {
    points.push({
      id: "__origine__",
      nom: origine.label,
      latitude: origine.latitude,
      longitude: origine.longitude,
    });
  }

  points.push(...arretsDItineraire(itineraire.segments));

  if (destination && (aPied || itineraire.walkEgress !== null)) {
    points.push({
      id: "__destination__",
      nom: destination.label,
      latitude: destination.latitude,
      longitude: destination.longitude,
    });
  }

  return points;
}
