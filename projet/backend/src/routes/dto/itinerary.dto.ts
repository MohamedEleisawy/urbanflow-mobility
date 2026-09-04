import { ModeTransport } from '@prisma/client';
import { LineStringGeoJson } from '../../gtfs/shape-geometry';

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

  /**
   * Identifiant de la ligne DANS LE FLUX DE L'OPÉRATEUR (`routes.txt`,
   * `route_id`), ou `null` pour une ligne créée à la main.
   *
   * ⚠️ POURQUOI CE TROISIÈME IDENTIFIANT. `lineId` est notre UUID interne :
   * il ne veut rien dire hors de notre base. Or les perturbations GTFS-RT
   * désignent les lignes par LEUR identifiant à eux — celui du flux.
   *
   * Sans ce champ, associer une alerte à un segment supposerait une requête
   * de traduction par ligne empruntée, ou pire, un rapprochement sur le NOM
   * d'affichage — que le réseau rend ambigu, plusieurs lignes portant le même
   * (« 4 » de métro et « 4 » de bus).
   *
   * C'est donc lui, et lui seul, qui permet de n'afficher sur un itinéraire
   * que les alertes des lignes RÉELLEMENT empruntées — plutôt que toutes
   * celles d'Île-de-France.
   */
  gtfsLineId: string | null;

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

  /**
   * Minutes d'attente AVANT de monter dans ce segment.
   *
   * ⚠️ PRÉSENT UNIQUEMENT SUR UNE MONTÉE, et `undefined` — jamais 0 — sur les
   * tronçons suivants d'une même ligne. Rester assis dans le tram sur cinq
   * arrêts n'a pas de temps d'attente ; écrire « 0 min d'attente » cinq fois
   * de suite laisserait croire à cinq correspondances instantanées.
   *
   * `undefined` aussi quand aucun horaire n'est connu : voir
   * `ItineraryScheduleDto`.
   */
  waitMin?: number;

  /**
   * Heure de départ et d'arrivée de ce tronçon, en ISO 8601.
   *
   * ⚠️ CALCULÉES À PARTIR DES HORAIRES THÉORIQUES publiés par l'opérateur, et
   * jamais observées. Un retard ne s'y voit pas. `undefined` quand le
   * calendrier ne permet pas de les établir.
   */
  departureAt?: string;
  arrivalAt?: string;
}

/**
 * Critère selon lequel l'itinéraire a été optimisé.
 *
 * ═══ LES TROIS CRITÈRES PRODUITS ═══
 *
 *   FASTEST     ⚡ le plus rapide      → minimise la durée totale estimée
 *   LOWEST_CO2  🌱 le plus écologique  → minimise les émissions estimées
 *   SHORTEST    📏 le plus court       → minimise la distance parcourue
 *
 * ═══ POURQUOI `SHORTEST` EST DE RETOUR ═══
 *
 * Il avait été retiré en phase 4 au motif que « le plus court en mètres » et
 * « le plus rapide » désignaient presque toujours le même trajet, produisant
 * un doublon aussitôt dédupliqué.
 *
 * Ce raisonnement valait sur un réseau de métro dense — celui d'Île-de-France
 * — où la vitesse commerciale varie peu d'une ligne à l'autre. Il ne vaut plus
 * sur l'Eurométropole de Strasbourg, où le tram file en site propre et le bus
 * serpente : le trajet le plus court en mètres y emprunte volontiers un bus
 * direct que le tram contourne, et le plus rapide un tram qui rallonge.
 *
 * Le critère est donc rétabli, ET LA DÉDUPLICATION LE PROTÈGE : s'il désigne
 * malgré tout le même trajet, il n'est simplement pas renvoyé. Aucune carte
 * n'est jamais remplie pour faire nombre.
 *
 * ⚠️ `FEWEST_TRANSFERS` RESTE UNE VALEUR VALIDE DU TYPE, bien qu'aucune
 * recherche ne la produise plus. Des itinéraires enregistrés par les usagers
 * la portent en base : la retirer du type ferait échouer la relecture de leur
 * historique, c'est-à-dire détruirait une donnée qui leur appartient.
 */
export type ItineraryCriterion =
  'FASTEST' | 'LOWEST_CO2' | 'SHORTEST' | 'FEWEST_TRANSFERS';

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

/**
 * Disponibilité des horaires pour un itinéraire.
 *
 *   `SCHEDULE_AVAILABLE`    heures de départ et d'arrivée établies ;
 *   `SCHEDULE_UNKNOWN`      le calendrier existe, mais aucune de ces lignes
 *                           ne passe dans la fenêtre consultée — un bus de
 *                           nuit cherché à 14 h, typiquement ;
 *   `SCHEDULE_UNAVAILABLE`  aucun horaire n'est importé sur cette
 *                           installation.
 *
 * ⚠️ LES TROIS CAS APPELLENT TROIS PHRASES DIFFÉRENTES À L'ÉCRAN. Les
 * confondre ferait dire « pas de passage aujourd'hui » à un usager dont le
 * réseau n'a simplement jamais été horodaté.
 */
export type ScheduleStatus =
  'SCHEDULE_AVAILABLE' | 'SCHEDULE_UNKNOWN' | 'SCHEDULE_UNAVAILABLE';

export interface ItineraryScheduleDto {
  status: ScheduleStatus;

  /// Instant de départ retenu, en ISO 8601. `null` hors du cas disponible.
  departureAt: string | null;

  /**
   * Heure d'arrivée estimée, ATTENTE COMPRISE.
   *
   * ⚠️ C'EST LA SEULE VALEUR QUI RÉPOND À LA QUESTION POSÉE. `totalDurationMin`
   * ne compte que le temps de parcours : un usager qui lit « 12 min » et
   * arrive 25 minutes plus tard n'a pas été mal informé, il a été trompé.
   */
  arrivalAt: string | null;

  /**
   * Somme des attentes sur le quai, en minutes.
   *
   * ⚠️ `null` ET NON 0 QUAND ELLE EST INCONNUE. Zéro annoncerait un
   * enchaînement parfait, ce qui est exactement le contraire de « je ne sais
   * pas ».
   */
  totalWaitMin: number | null;

  /// Pourquoi l'horaire n'a pas pu être établi. `null` quand il l'a été.
  reason: string | null;
}

/**
 * Une marche entre un point demandé par l'usager et le réseau.
 *
 * ═══ POURQUOI CE N'EST PAS UN `ItinerarySegmentDto` ═══
 *
 * Un segment relie deux ARRÊTS : il porte deux `stopId` qui sont des clés
 * étrangères réelles, et c'est ce qui permet d'enregistrer un trajet dans
 * l'historique. Or une marche d'approche part d'une ADRESSE — « 15 rue
 * Adler » n'est pas un arrêt et n'a aucun identifiant en base.
 *
 * Lui en fabriquer un serait inventer une donnée, et surtout casser
 * l'enregistrement : `POST /routes/:id/segments` résout chaque segment en
 * `NetworkLink` réel et refuserait un arrêt qui n'existe pas.
 *
 * ⚠️ CES MINUTES ET CES MÈTRES SONT DANS `totalDistanceM` ET
 * `totalDurationMin`. C'est tout l'objet de ce champ : avant lui, un trajet
 * « 15 min » en cachait trois de plus à pied, et son premier arrêt tombait du
 * ciel. La durée annoncée n'était pas approximative, elle était fausse.
 */
export interface ItineraryWalkLegDto {
  /// Point de départ de la marche (l'adresse à l'aller, l'arrêt au retour).
  fromLat: number;
  fromLon: number;
  /// Point d'arrivée de la marche (l'arrêt à l'aller, l'adresse au retour).
  toLat: number;
  toLon: number;

  /**
   * Nom de l'arrêt situé à l'extrémité RÉSEAU de cette marche.
   *
   * C'est le seul des deux bouts qui porte un nom : l'autre est le point que
   * l'usager a désigné, et c'est LUI qui sait comment il s'appelle.
   */
  stopName: string;

  distanceM: number;
  durationMin: number;

  /**
   * ⚠️ D'OÙ VIENT CETTE DISTANCE, ET L'INTERFACE DOIT LE DIRE.
   *
   *   `ESTIMATE` vol d'oiseau × 4,5 km/h. MINORÉE par construction : ni rue,
   *              ni traversée, ni pont ne sont connus.
   *   `ROUTED`   trajet rue par rue d'un vrai routeur piéton.
   *
   * Aucune valeur `ROUTED` n'est produite tant que `WALK_ROUTING_PROVIDER`
   * n'est pas configuré. Annoncer une estimation comme un itinéraire serait
   * exactement le genre de fausse précision que ce projet refuse.
   */
  source: 'ESTIMATE' | 'ROUTED';

  /**
   * Tracé rue par rue, en GeoJSON `LineString` (`[longitude, latitude]`).
   *
   * ⚠️ `null` QUAND `source` VAUT `ESTIMATE`, et les deux vont toujours
   * ensemble : sans moteur piéton, il n'existe aucun tracé — seulement deux
   * points. Dessiner la droite qui les relie est le repli du CLIENT, qui doit
   * alors la marquer comme telle ; ce n'est pas une géométrie que le serveur
   * fabriquerait.
   */
  geometry: LineStringGeoJson | null;
}

export interface ItineraryDto {
  // Permet au client de savoir à quelle question cet itinéraire répond,
  // sans avoir à comparer les totaux lui-même.
  criterion: ItineraryCriterion;
  totalDistanceM: number;

  /**
   * ⚠️ CE QUE LA DURÉE ANNONCÉE NE CONTIENT PAS : LE TEMPS D'ATTENTE.
   *
   * `totalDurationMin` est la somme des durées de parcours des liaisons —
   * elles-mêmes des MÉDIANES observées dans le flux GTFS (étape 4C-4-4) — plus
   * les temps de correspondance à pied publiés dans `transfers.txt`.
   *
   * Il y manque l'attente du véhicule à chaque montée, que notre modèle ne
   * connaît pas : nous importons le réseau, pas les horaires. `stop_times.txt`
   * est agrégé en durées typiques, et aucune table ne porte de passage précis.
   *
   * ═══ POURQUOI CELA COMPTE VRAIMENT, MESURÉ SUR LE RÉSEAU RÉEL ═══
   *
   * Tant que le réseau ne contenait que métro, tram et RER, l'écart restait
   * marginal — ces modes passent souvent et les itinéraires comptaient une ou
   * deux correspondances.
   *
   * Depuis l'import du bus (1 963 lignes), le moteur peut enchaîner douze
   * tronçons de bus et CINQ changements pour « 17 minutes », là où le RER met
   * 19 minutes sans aucun changement. Les durées de chaque tronçon sont
   * exactes ; c'est leur SOMME qui promet l'impossible, puisqu'elle suppose
   * cinq correspondances instantanées.
   *
   * ⚠️ CE N'EST PAS UNE DONNÉE INVENTÉE, C'EST UNE DONNÉE MANQUANTE. La
   * réponse honnête n'est pas d'ajouter une pénalité au jugé — un nombre que
   * rien ne justifierait — mais de DIRE ce que la durée recouvre. L'interface
   * l'annonce dès qu'un itinéraire comporte une correspondance, et
   * `numberOfTransfers` permet au client de pondérer lui-même.
   *
   * La correction de fond suppose d'importer `calendar`, `trips` et
   * `stop_times` pour calculer de vrais prochains passages.
   */
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

  /**
   * Horaires réels de cet itinéraire, attente comprise.
   *
   * FACULTATIF dans le type parce qu'il est posé APRÈS la construction de
   * l'itinéraire, par `enrichirHoraires()`. Il est toujours présent dans une
   * réponse de `POST /api/routes/search`.
   */
  schedule?: ItineraryScheduleDto;

  /// Empreinte de cet itinéraire, ou l'aveu qu'elle est incalculable.
  carbon: ItineraryCarbonDto;

  /**
   * Marche d'approche : du point de départ demandé au premier arrêt.
   *
   * `null` quand l'usager part déjà d'un arrêt — et seulement dans ce cas.
   */
  walkAccess: ItineraryWalkLegDto | null;

  /**
   * Marche finale : du dernier arrêt à la destination demandée.
   *
   * `null` quand la destination EST l'arrêt d'arrivée.
   */
  walkEgress: ItineraryWalkLegDto | null;

  /**
   * Les tronçons empruntés sur le réseau, d'arrêt à arrêt.
   *
   * ⚠️ PEUT ÊTRE VIDE, ET C'EST UN RÉSULTAT LÉGITIME : deux points à trois
   * cents mètres l'un de l'autre se rejoignent à pied, et l'itinéraire se
   * réduit alors à `walkAccess`. Rendre une liste vide de propositions dans ce
   * cas — ce que faisait le moteur — revenait à répondre « impossible » à
   * quelqu'un qui n'avait qu'une rue à traverser.
   */
  segments: ItinerarySegmentDto[];
}
