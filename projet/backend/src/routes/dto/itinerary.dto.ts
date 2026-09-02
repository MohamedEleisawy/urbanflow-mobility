import { ModeTransport } from '@prisma/client';

// Formes des données RENVOYÉES par POST /api/routes/search.
// Ce sont de simples interfaces de sortie (pas de class-validator : on ne
// valide que ce qui ENTRE dans l'application, pas ce qui en sort).

// Une portion du trajet proposé, entre deux arrêts.
export interface ItinerarySegmentDto {
  fromStopId: string;
  fromStopName: string;
  fromStopLat: number;
  fromStopLon: number;
  toStopId: string;
  toStopName: string;
  toStopLat: number;
  toStopLon: number;
  mode: ModeTransport;

  // Nom et exploitant de la ligne empruntée (étape 4E-2), par exemple
  // "38" / "RATP". Sans eux, l'API disait "prenez un BUS" sans dire LEQUEL.
  //
  // OBLIGATOIRES, et non optionnels : un NetworkLink porte toujours une
  // ligne (relation requise), et TransitLine.name comme TransitLine.operator
  // sont non-nullables. Le modèle garantit ces valeurs, le contrat public
  // doit donc les garantir aussi.
  //
  // Ils seront recopiés tels quels dans Segment.line et Segment.operator au
  // moment d'enregistrer un trajet (étape 4E-3).
  lineName: string;
  operator: string;

  /**
   * Identifiant de la LIAISON choisie, via sa ligne (étape 4E-3A).
   *
   * Pourquoi ce champ alors que `lineName` existe déjà ? Parce qu'un nom ne
   * suffit pas à désigner une liaison sans ambiguïté : deux lignes peuvent
   * relier les mêmes arrêts, et rien n'interdit qu'elles portent le même
   * nom d'affichage (« Express » chez deux exploitants, un « 4 » de bus et
   * un « 4 » de métro...).
   *
   * `NetworkLink` est d'ailleurs unique sur `(lineId, fromStopId, toStopId)`
   * — et non sur le nom. Ce triplet est donc la SEULE façon de retrouver
   * exactement la liaison que l'usager a retenue.
   *
   * `lineName` reste destiné à l'AFFICHAGE, `lineId` à l'IDENTIFICATION —
   * c'est aussi lui, et jamais le nom, qui sert à regrouper les segments
   * d'une même ligne (le réseau contient des lignes homonymes).
   */
  lineId: string;

  distanceM: number;
  durationMin: number;

  /**
   * Tracé RÉEL de la voie entre les deux arrêts, en GeoJSON LineString
   * (Phase 4).
   *
   * ⚠️ TRANSMIS TEL QUEL DEPUIS `NetworkLink.geometry`, jamais reconstruit.
   * Il provient de `shapes.txt` du flux de l'opérateur.
   *
   * ⚠️ `null` EST UNE RÉPONSE, PAS UNE ERREUR : tous les flux GTFS ne
   * publient pas `shapes.txt`, et 2 858 de nos 6 676 liaisons seulement en
   * ont un. La carte doit alors tracer honnêtement une droite arrêt → arrêt
   * ET LE DIRE, plutôt que de laisser croire que c'est le trajet exact.
   * C'est `geometrySource` qui porte cette distinction.
   */
  geometry: unknown;

  /**
   * D'où vient le tracé que le client va dessiner.
   *
   * `SHAPE`    : géométrie réelle de l'opérateur, `geometry` est renseignée ;
   * `STRAIGHT` : aucune géométrie publiée, au client de relier les deux
   *              arrêts par une droite — qui n'est PAS le trajet réel.
   *
   * Ce champ existe pour que l'interface ne puisse pas présenter les deux
   * cas de la même façon. Sans lui, une droite passerait pour un tracé.
   */
  geometrySource: 'SHAPE' | 'STRAIGHT';
}

/**
 * Critère selon lequel l'itinéraire a été optimisé.
 *
 * ═══ CHANGEMENT DE CONTRAT (Phase 4) ═══
 *
 * `SHORTEST` (la plus courte distance) a été RETIRÉ, et remplacé par
 * `FEWEST_TRANSFERS` et `LOWEST_CO2`.
 *
 * Pourquoi. Dans un réseau de transport public, « le plus court en mètres »
 * et « le plus rapide » désignent presque toujours le même trajet : le
 * critère produisait un doublon que le service dédupliquait aussitôt. Il ne
 * répondait à aucune question que se pose un voyageur — personne ne choisit
 * un itinéraire de métro au mètre près.
 *
 * Les deux critères qui le remplacent, eux, répondent à des questions
 * réelles et opposables : « je ne veux pas courir dans les couloirs » et
 * « je veux le trajet le moins émetteur ». Le second est l'identité même du
 * produit.
 */
export type ItineraryCriterion = 'FASTEST' | 'FEWEST_TRANSFERS' | 'LOWEST_CO2';

/**
 * Disponibilité du calcul carbone pour un itinéraire.
 *
 * `CARBON_UNAVAILABLE` n'est PAS une valeur par défaut déguisée : quand le
 * microservice est injoignable ou refuse un mode, tous les champs chiffrés
 * valent `null`, jamais 0. Afficher « 0 g » à la place d'une panne
 * annoncerait un trajet parfaitement propre — le mensonge exact que ce
 * projet refuse depuis l'étape 4D-1.
 */
export type CarbonStatus = 'CARBON_AVAILABLE' | 'CARBON_UNAVAILABLE';

export interface ItineraryCarbonDto {
  status: CarbonStatus;

  /// Grammes de CO₂ équivalent émis par cet itinéraire.
  co2Grams: number | null;

  /// Ce que le MÊME trajet aurait émis en voiture individuelle.
  carCo2Grams: number | null;

  /// Économie par rapport à la voiture, jamais négative.
  savedVsCarGrams: number | null;

  /// Score environnemental de 0 (voiture) à 100 (mobilité douce).
  ecoScore: number | null;

  /**
   * Pourquoi le calcul n'a pas pu aboutir. `null` quand il a abouti.
   *
   * Message DESTINÉ À L'USAGER : il ne cite ni l'adresse interne du
   * microservice, ni le détail d'une exception.
   */
  reason: string | null;
}

export interface ItineraryDto {
  // Permet au client de savoir à quelle question cet itinéraire répond,
  // sans avoir à comparer les totaux lui-même.
  criterion: ItineraryCriterion;
  totalDistanceM: number;
  totalDurationMin: number;

  /**
   * Nombre de CHANGEMENTS DE LIGNE, et non de segments.
   *
   * ⚠️ LA MARCHE NE COMPTE PAS. Un trajet métro 4 → couloir à pied →
   * métro 4 est un trajet SANS changement : on ne change pas de ligne en
   * traversant un couloir. Le calcul ignore donc les segments `WALK` et ne
   * compte que les transitions entre deux lignes distinctes réellement
   * empruntées. C'est la même règle que celle appliquée côté frontend, et
   * elle est ici la SOURCE : le client n'a plus à la recalculer.
   */
  numberOfTransfers: number;

  /// Empreinte de cet itinéraire, ou l'aveu qu'elle est incalculable.
  carbon: ItineraryCarbonDto;

  segments: ItinerarySegmentDto[];
}
