// =============================================================================
// Formes des données lues dans un flux GTFS (étape 4C-4-2)
// =============================================================================
// Ces interfaces décrivent les lignes VALIDÉES que le lecteur produit, une
// fois les champs bruts convertis (nombres, entiers, booléens).
//
// On ne conserve QUE les colonnes dont UrbanFlow a besoin. Un flux GTFS réel
// contient des dizaines de colonnes supplémentaires (couleurs, URL, fuseaux,
// tarifs...) : les stocker alourdirait la mémoire sans aucun usage.
// =============================================================================

/// Un arrêt (stops.txt).
export interface GtfsStop {
  stopId: string;
  stopName: string;
  latitude: number;
  longitude: number;
  /// wheelchair_boarding : 1 → true, 2 → false, 0 ou absent → false.
  /// ATTENTION : notre modèle Prisma stocke un booléen, donc "inconnu" (0)
  /// est représenté comme false. C'est une APPROXIMATION assumée : on
  /// n'affirme jamais qu'un arrêt est accessible sans information.
  pmrAccessible: boolean;
}

/// Une ligne de transport (routes.txt).
export interface GtfsRoute {
  routeId: string;
  /// Nom court ("4", "38") — souvent celui affiché à l'usager.
  shortName: string;
  /// Nom long ("Porte de Clignancourt - Mairie de Montrouge").
  longName: string;
  /// Type GTFS BRUT (0 = tram, 1 = métro, 3 = bus...). La conversion vers
  /// notre enum ModeTransport appartient à l'étape 4C-4-3 : à ce stade on ne
  /// filtre rien et on ne traduit rien.
  routeType: number;
  agencyId: string;
}

/// Un trajet (trips.txt). Sert de pont : trip_id → route_id.
export interface GtfsTrip {
  tripId: string;
  routeId: string;
  serviceId: string;
  /// Sens de circulation. Conservé pour information : le graphe n'en a pas
  /// besoin, puisque le sens est porté par fromStop → toStop.
  directionId: number | null;
  /// Parcours géographique emprunté (`shapes.txt`), ou `null`.
  ///
  /// Ajouté à la Phase 1B. FACULTATIF dans la spécification GTFS, et
  /// réellement absent de certains flux — dont le jeu de démonstration du
  /// projet. `null` n'est donc pas une anomalie : c'est un flux sans
  /// géométrie, et l'import doit continuer sans elle.
  shapeId: string | null;
}

/// Un point du tracé d'un parcours (`shapes.txt`).
///
/// ⚠️ Latitude et longitude sont lues DANS L'ORDRE DU FICHIER GTFS
/// (`shape_pt_lat`, `shape_pt_lon`). La bascule vers l'ordre GeoJSON
/// [longitude, latitude] n'a lieu qu'au tout dernier moment, dans
/// `shape-geometry.ts`.
export interface GtfsShapePoint {
  shapeId: string;
  latitude: number;
  longitude: number;
  sequence: number;
}

/// Un passage à un arrêt (stop_times.txt). C'est le fichier le plus
/// volumineux d'un flux GTFS — d'où l'importance de la lecture en flux.
export interface GtfsStopTime {
  tripId: string;
  stopId: string;
  stopSequence: number;
  /// Horaires exprimés en SECONDES DEPUIS MINUIT, et non en objets Date :
  /// GTFS autorise des heures supérieures à 24h pour les services de nuit
  /// (25:10:00 = 1h10 le lendemain). Voir gtfs-time.util.ts.
  arrivalTimeSec: number;
  departureTimeSec: number;
}

/**
 * Une correspondance entre deux arrêts (`transfers.txt`, Phase 1).
 *
 * GTFS décrit ici ce que le graphe ne peut pas deviner : qu'on peut passer à
 * pied du quai A au quai B. Sans ces lignes, chaque ligne de métro forme un
 * chemin ISOLÉ — un usager ne peut jamais changer.
 */
export interface GtfsTransfer {
  fromStopId: string;
  toStopId: string;
  /**
   * Type GTFS. Seul le **3** est disqualifiant : il signifie « correspondance
   * IMPOSSIBLE ». Les autres (0 recommandée, 1 garantie, 2 durée minimale)
   * décrivent tous une correspondance praticable.
   */
  transferType: number;
  /**
   * Durée minimale, en secondes — telle que l'opérateur la publie.
   *
   * `null` quand elle n'est pas fournie : GTFS ne l'impose que pour le type 2.
   * Sur le flux d'Île-de-France Mobilités, les 191 816 correspondances sont
   * toutes de type 2 et portent toutes leur durée — aucune n'est à inventer.
   */
  minTransferTimeSec: number | null;
}
