import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ModeTransport, Stop } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CarbonService } from '../carbon/carbon.service';
import { CarbonResultDto } from '../carbon/dto/carbon-result.dto';
import { CreateRouteDto, RouteSegmentDto } from './dto/create-route.dto';
import { PaginationQueryDto } from './dto/pagination-query.dto';
import { SearchRouteDto } from './dto/search-route.dto';
import {
  ItineraryCriterion,
  ItineraryDto,
  ItinerarySegmentDto,
} from './dto/itinerary.dto';
import { haversineDistanceM } from '../common/geo/distance.util';

// Une "arête" du graphe : un déplacement possible d'un arrêt vers un autre.
interface GraphEdge {
  toStopId: string;
  mode: ModeTransport;
  // Nom et exploitant de la ligne, transportés depuis TransitLine (étape
  // 4E-2). Ils ne servent PAS au calcul du chemin — Dijkstra ne pondère que
  // durationMin et distanceM — mais l'arête est le seul endroit où
  // l'information survit entre la requête et la réponse.
  lineName: string;
  operator: string;
  // Identifiant de la ligne (étape 4E-3A). Comme les deux champs
  // ci-dessus, il n'entre PAS dans le calcul : Dijkstra ne pondère que
  // durationMin et distanceM. Il est seulement transporté, pour que le
  // client puisse désigner sans ambiguïté la liaison qu'il a retenue.
  lineId: string;
  distanceM: number;
  durationMin: number;
}

// Le graphe : pour chaque arrêt, la liste des déplacements qui en partent.
type Graph = Map<string, GraphEdge[]>;

// Un maillon du chemin reconstruit par Dijkstra.
interface PathStep {
  fromStopId: string;
  edge: GraphEdge;
}

// Distance maximale acceptée entre le point saisi par l'usager et l'arrêt
// le plus proche (étape 4C-2).
//
// Sans cette limite, une recherche depuis Tokyo s'accrocherait à un arrêt
// parisien et proposerait un itinéraire absurde. 2 km correspond à une
// distance de marche raisonnable à l'échelle d'une métropole : au-delà,
// on considère qu'aucun arrêt ne dessert le point demandé.
const RAYON_RECHERCHE_MAX_M = 2000;

/**
 * Marge ajoutée au cadre de recherche, en degrés.
 *
 * 0,07° ≈ 8 km sous nos latitudes — bien au-delà du rayon de rattachement de
 * 2 km, et assez large pour absorber les détours réels d'un itinéraire
 * urbain.
 */
const MARGE_CADRE_DEG = 0.07;

/**
 * Nombre maximal de quais retenus comme point d'entrée ou de sortie.
 *
 * Sur un pôle d'échange dense, une vingtaine de quais tombent dans le rayon
 * de recherche. Les six plus proches couvrent tous les modes d'un même lieu —
 * à Gare de Lyon : métro 1, métro 14, RER A, RER D, TER — sans faire grossir
 * le graphe inutilement.
 */
const PLAFOND_QUAIS = 6;

/**
 * Rayon dans lequel plusieurs quais forment UN MÊME LIEU.
 *
 * ⚠️ BIEN PLUS PETIT que `RAYON_RECHERCHE_MAX_M`, et c'est essentiel. Le
 * rattachement multi-quai sert à ne pas se tromper de quai DANS une station,
 * pas à autoriser le moteur à démarrer n'importe où dans un rayon de deux
 * kilomètres : il ferait sinon commencer un trajet à 1,5 km de l'usager sans
 * jamais compter cette marche.
 *
 * 300 m est mesuré sur les données réelles : les cinq quais de Gare de Lyon
 * s'étalent de 84 à 183 m du point d'adresse, ceux de Gare du Nord de 183 à
 * 202 m.
 */
const RAYON_QUAIS_M = 300;

/// Sommets fictifs du Dijkstra multi-source / multi-cible. Le préfixe rend
/// toute collision avec un UUID d'arrêt impossible.
const ORIGINE_VIRTUELLE = '__urbanflow_origine__';
const DESTINATION_VIRTUELLE = '__urbanflow_destination__';

// Le réseau exprime des durées en minutes, JavaScript des instants en
// millisecondes : la conversion est isolée pour qu'elle soit visible.
const MILLISECONDES_PAR_MINUTE = 60_000;

/// Deux décimales, comme partout ailleurs pour les grammes de CO2
/// (convention posée à l'étape 4D-1).
const arrondir = (grammes: number) => Math.round(grammes * 100) / 100;

@Injectable()
export class RoutesService {
  private readonly logger = new Logger(RoutesService.name);

  constructor(
    private readonly prisma: PrismaService,
    // Injecté à l'étape 4E-3B, rendu possible par le câblage de 4E-3A.
    //
    // ⚠️ Cette dépendance ne concerne QUE create(). searchRoutes() ne doit
    // JAMAIS appeler le microservice : une panne du calcul carbone rendrait
    // sinon la recherche d'itinéraire indisponible, ce que toute l'étape
    // 4D-2 s'est employée à éviter. Un test verrouille cette propriété.
    private readonly carbonService: CarbonService,
  ) {}

  /**
   * Enregistre un itinéraire choisi par l'usager (étape 4E-3B).
   *
   * PRINCIPE : le client DÉSIGNE des liaisons, il ne les DÉCRIT pas.
   *
   * Jusqu'à cette étape, il fournissait lui-même `ecoScore` et
   * `carbonEstimate`. Le serveur reconstruit désormais TOUTES les valeurs
   * significatives à partir du réseau public, puis fait calculer le carbone
   * par le microservice. Le client ne décide plus que de deux choses : d'où
   * il part et quelles liaisons il a empruntées.
   *
   * CE N'EST PAS UN SECOND MOTEUR D'ITINÉRAIRE. Aucun Dijkstra, aucun plus
   * court chemin : on vérifie seulement que chaque tronçon revendiqué est une
   * arête réelle du réseau, et que ces arêtes s'enchaînent.
   *
   * userId vient TOUJOURS du JWT, jamais du corps de la requête.
   */
  async create(userId: string, dto: CreateRouteDto) {
    // UN SEUL instant pour toute l'opération : il horodate la route ET
    // chacun de ses enregistrements carbone. Laisser les @default(now())
    // de Prisma s'en charger produirait des instants distincts de quelques
    // millisecondes — de quoi ranger un trajet et son carbone dans deux
    // journées différentes à minuit, dans un futur tableau de bord.
    const requestedAt = new Date();

    const liaisons = await this.resoudreLiaisons(dto.segments);
    this.verifierChainage(liaisons);

    const totalDistanceM = liaisons.reduce(
      (somme, l) => somme + l.distanceM,
      0,
    );
    const totalDurationMin = liaisons.reduce(
      (somme, l) => somme + l.durationMin,
      0,
    );

    // APPEL RÉSEAU AVANT LA TRANSACTION, et c'est délibéré : une requête HTTP
    // à l'intérieur d'une transaction PostgreSQL tiendrait des verrous
    // ouverts pendant tout son délai (5 s au maximum ici), et entrerait en
    // concurrence avec le délai propre à la transaction Prisma.
    //
    // Le mode et la distance envoyés sont ceux du RÉSEAU, jamais ceux du
    // client : c'est ce qui rend le résultat infalsifiable.
    const carbone = await this.carbonService.calculate({
      segments: liaisons.map((l) => ({
        mode: l.line.mode,
        distanceM: l.distanceM,
      })),
    });

    // Le breakdown est apparié POSITIONNELLEMENT aux segments envoyés. Cette
    // propriété appartient au microservice ; on refuse de deviner si elle
    // n'est pas tenue, plutôt que d'associer un CO2 au mauvais segment.
    if (carbone.breakdown.length !== liaisons.length) {
      this.logger.error(
        `Breakdown carbone incohérent : ${carbone.breakdown.length} entrées ` +
          `pour ${liaisons.length} segments`,
      );
      throw new ServiceUnavailableException(
        'Service de calcul carbone indisponible',
      );
    }

    const segments = this.estimerHoraires(liaisons, requestedAt);

    const routeId = await this.prisma.$transaction(async (tx) => {
      const route = await tx.route.create({
        data: {
          originLat: dto.originLat,
          originLng: dto.originLng,
          destinationLat: dto.destinationLat,
          destinationLng: dto.destinationLng,
          requestedAt,
          totalDistanceM,
          totalDurationMin,
          // Les deux valeurs autrefois déclarées par le client.
          carbonEstimate: carbone.totalCo2Grams,
          ecoScore: carbone.ecoScore,
          userId,
        },
      });

      await tx.segment.createMany({
        data: segments.map((segment) => ({ ...segment, routeId: route.id })),
      });

      // Un CarbonRecord par SEGMENT (décision 4E) : c'est la seule
      // granularité où `mode` et `distanceM` ont un sens exact.
      await tx.carbonRecord.createMany({
        data: liaisons.map((liaison, index) => ({
          date: requestedAt,
          mode: liaison.line.mode,
          distanceM: liaison.distanceM,
          co2Grams: carbone.breakdown[index].co2Grams,
          savedVsCarGrams: this.economieDuSegment(
            liaison.distanceM,
            totalDistanceM,
            carbone,
            index,
          ),
          userId,
          routeId: route.id,
        })),
      });

      return route.id;
    });

    // Relecture APRÈS commit : la transaction n'a plus rien à garantir ici.
    // orderBy explicite (leçon 4C-2) : sans lui, PostgreSQL ne promet aucun
    // ordre de lignes, et les segments pourraient revenir mélangés.
    return this.prisma.route.findUniqueOrThrow({
      where: { id: routeId },
      include: { segments: { orderBy: { departureTime: 'asc' } } },
    });
  }

  /**
   * Retrouve, pour chaque segment demandé, la liaison réelle du réseau.
   *
   * UNE seule requête, quel que soit le nombre de segments : charger les
   * liaisons une par une serait le N+1 classique. Les résultats sont ensuite
   * indexés en mémoire par leur clé métier `(lineId, fromStopId, toStopId)`,
   * celle-là même que Prisma déclare unique.
   *
   * L'indexation traite naturellement le cas d'un même triplet répété par le
   * client : chaque occurrence retrouve la même liaison, et l'ordre demandé
   * est conservé.
   */
  private async resoudreLiaisons(demandes: RouteSegmentDto[]) {
    const liaisons = await this.prisma.networkLink.findMany({
      where: {
        OR: demandes.map(({ lineId, fromStopId, toStopId }) => ({
          lineId,
          fromStopId,
          toStopId,
        })),
      },
      include: { line: true },
    });

    const parCle = new Map(
      liaisons.map((liaison) => [
        this.cleLiaison(liaison.lineId, liaison.fromStopId, liaison.toStopId),
        liaison,
      ]),
    );

    return demandes.map((demande, index) => {
      const liaison = parCle.get(
        this.cleLiaison(demande.lineId, demande.fromStopId, demande.toStopId),
      );

      if (!liaison) {
        // 400 et non 404 : c'est le corps de la requête qui est invalide,
        // pas une ressource identifiée par l'URL qui manquerait.
        throw new BadRequestException(
          `Segment ${index + 1} : aucune liaison du réseau ne relie ces deux ` +
            'arrêts sur cette ligne',
        );
      }

      return liaison;
    });
  }

  private cleLiaison(lineId: string, fromStopId: string, toStopId: string) {
    return `${lineId}|${fromStopId}|${toStopId}`;
  }

  /**
   * Un itinéraire doit être CONTINU : on ne se téléporte pas entre deux
   * segments. Vérifié avant toute écriture, pour ne jamais laisser en base
   * un historique manifestement incohérent.
   */
  private verifierChainage(
    liaisons: { fromStopId: string; toStopId: string }[],
  ) {
    for (let i = 0; i < liaisons.length - 1; i++) {
      if (liaisons[i].toStopId !== liaisons[i + 1].fromStopId) {
        throw new BadRequestException(
          `Segments ${i + 1} et ${i + 2} : le trajet est interrompu, ` +
            "l'arrivée de l'un doit être le départ du suivant",
        );
      }
    }
  }

  /**
   * Fabrique les horaires de chaque segment par cumul des durées du réseau.
   *
   * ⚠️ CE SONT DES HORAIRES ESTIMÉS, ET NON DES HORAIRES GTFS RÉELS.
   *
   * `Segment` exige un départ et une arrivée (sa durée est leur différence,
   * il n'a pas de champ `durationMin`), alors que le réseau ne connaît que
   * des durées de parcours MÉDIANES (étape 4C-4-4). On les reconstruit donc
   * en chaîne à partir de l'instant d'enregistrement :
   *
   *     départ(1) = requestedAt
   *     arrivée(i) = départ(i) + durée(i)
   *     départ(i+1) = arrivée(i)
   *
   * C'est exactement la même raison qui fait rester `gtfsTripId` à NULL
   * (étape 4E-1) : aucun passage réel ne correspond à ce trajet.
   */
  private estimerHoraires(
    liaisons: {
      distanceM: number;
      durationMin: number;
      fromStopId: string;
      toStopId: string;
      line: { mode: ModeTransport; name: string; operator: string };
    }[],
    requestedAt: Date,
  ) {
    let curseur = requestedAt;

    return liaisons.map((liaison) => {
      const departureTime = curseur;
      const arrivalTime = new Date(
        departureTime.getTime() +
          liaison.durationMin * MILLISECONDES_PAR_MINUTE,
      );
      curseur = arrivalTime;

      return {
        // Tout vient du RÉSEAU, rien du client.
        mode: liaison.line.mode,
        operator: liaison.line.operator,
        line: liaison.line.name,
        distanceM: liaison.distanceM,
        fromStopId: liaison.fromStopId,
        toStopId: liaison.toStopId,
        departureTime,
        arrivalTime,
        // `gtfsTripId` n'est VOLONTAIREMENT pas mentionné : il restera NULL.
      };
    });
  }

  /**
   * Économie de CO2 d'un segment, par rapport à la voiture.
   *
   * Le microservice ne fournit `savedVsCarGrams` que pour le TOTAL. On le
   * répartit ici proportionnellement à la distance :
   *
   *     économie(i) = carCo2Grams × distance(i) / distanceTotale − co2(i)
   *
   * Ce n'est pas une approximation : les émissions d'une voiture étant
   * strictement proportionnelles à la distance, cette part EST la référence
   * voiture du segment.
   *
   * POURQUOI PAS `(218 − facteur) × km` ? Parce que 218 est un facteur
   * d'émission, et que les facteurs vivent dans le microservice. Le coder ici
   * créerait une seconde source de vérité, exactement ce que nous avons
   * refusé pour ESCOOTER (4D-1) et pour la formule d'EcoScore (4D-3-2).
   * La formule ci-dessus n'utilise QUE des valeurs renvoyées par FastAPI.
   */
  private economieDuSegment(
    distanceM: number,
    totalDistanceM: number,
    carbone: CarbonResultDto,
    index: number,
  ): number {
    // Trajet de distance nulle : aucune voiture à comparer, donc aucune
    // économie. Convention explicite, qui évite surtout la division par zéro.
    if (totalDistanceM === 0) {
      return 0;
    }

    const referenceVoiture = carbone.carCo2Grams * (distanceM / totalDistanceM);

    return arrondir(referenceVoiture - carbone.breakdown[index].co2Grams);
  }

  // Ne renvoie que les itinéraires de cet usager : le filtre "where" est la
  // garantie qu'aucune donnée d'un autre usager ne peut apparaître ici.
  /**
   * Historique paginé d'un usager (étape 4E-4A).
   *
   * POURQUOI UNE PAGINATION. Sans elle, la requête n'était bornée par rien
   * et grossissait indéfiniment avec l'usage. À noter pour la soutenance :
   * le dossier de conception ne la mentionne pas — « pagination » n'y
   * apparaît pas une seule fois. C'est une décision de conception.
   *
   * POURQUOI DEUX CLÉS DE TRI, et pas seulement `requestedAt`. Ce n'est pas
   * une question de confort : sans ORDRE TOTAL, PostgreSQL ne garantit rien
   * pour deux itinéraires enregistrés au même instant. Combiné à
   * skip/take, cela ne rend pas seulement l'ordre instable — la page 2 peut
   * RÉAFFICHER une ligne de la page 1, ou en SAUTER une. La pagination
   * deviendrait fausse.
   *
   * L'identifiant est un UUID : son ordre n'a aucun sens métier, mais il est
   * total et stable, et c'est tout ce qu'un départage demande. Même
   * raisonnement qu'à l'étape 4C-2, où Dijkstra départage ses égalités par
   * le plus petit identifiant.
   *
   * AUCUNE RELATION N'EST CHARGÉE : une liste est un RÉSUMÉ. Charger les
   * segments d'une page de 20 trajets ramènerait des dizaines de lignes que
   * cette vue n'affiche pas. Le détail est le travail de GET /api/routes/:id.
   */
  async findAllForUser(userId: string, pagination: PaginationQueryDto) {
    const { page, limit } = pagination;

    // Les deux requêtes sont indépendantes : les lancer en parallèle évite
    // d'attendre deux allers-retours successifs vers PostgreSQL.
    const [total, items] = await Promise.all([
      this.prisma.route.count({ where: { userId } }),
      this.prisma.route.findMany({
        where: { userId },
        orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return { items, page, limit, total };
  }

  async findOneForUser(id: string, userId: string) {
    const route = await this.prisma.route.findUnique({ where: { id } });

    // Deux cas volontairement traités de la même façon :
    //   - l'itinéraire n'existe pas ;
    //   - il existe mais appartient à quelqu'un d'autre.
    // On renvoie 404 (et non 403) dans les deux cas pour ne pas révéler
    // l'existence d'un itinéraire qui ne nous appartient pas — même
    // principe que le login, qui ne dit jamais si un email existe.
    if (!route || route.userId !== userId) {
      throw new NotFoundException(`Itinéraire ${id} introuvable`);
    }

    return route;
  }

  /**
   * Détail complet d'un trajet enregistré (étape 4E-4B).
   *
   * POURQUOI UNE MÉTHODE SÉPARÉE, plutôt qu'enrichir findOneForUser().
   * Celle-ci sert de GARDE DE PROPRIÉTÉ à quatre appelants : ce détail,
   * remove(), et trois méthodes de SegmentsService. Y ajouter des `include`
   * ferait charger à tous des relations dont ils n'ont que faire — le
   * `remove()` chargerait les segments juste avant de les supprimer.
   *
   * Le contrôle de propriété reste donc écrit à UN SEUL endroit, et c'est
   * lui qu'on appelle en premier : la relecture enrichie n'a lieu qu'après.
   * Un usager qui demande le trajet d'un autre reçoit son 404 sans qu'aucune
   * donnée n'ait été chargée.
   */
  async findOneDetailedForUser(id: string, userId: string) {
    // 1) La règle de propriété, inchangée depuis l'étape 4A. Lève 404 si
    //    l'itinéraire n'existe pas OU appartient à quelqu'un d'autre.
    await this.findOneForUser(id, userId);

    // 2) Seulement ensuite, la relecture avec les relations.
    return this.prisma.route.findUniqueOrThrow({
      where: { id },
      include: {
        // Ordre CHRONOLOGIQUE : c'est celui dans lequel on parcourt
        // réellement le trajet. Sans orderBy explicite, PostgreSQL ne
        // promet aucun ordre de lignes (leçon 4C-2) et l'itinéraire
        // pourrait revenir mélangé — illisible.
        segments: { orderBy: { departureTime: 'asc' } },
        // Les enregistrements carbone n'ont AUCUN ordre naturel : ils
        // partagent tous la même `date` (étape 4E-3B). On en impose donc
        // un, arbitraire mais TOTAL : le plus gros contributeur d'abord,
        // départagé par identifiant.
        //
        // ⚠️ Cet ordre ne prétend PAS correspondre à celui des segments.
        // `CarbonRecord` n'a pas de `segmentId` : rapprocher les deux
        // tableaux position par position serait une association inventée.
        // L'usage fiable est l'agrégation par mode.
        carbonRecords: { orderBy: [{ distanceM: 'desc' }, { id: 'asc' }] },
      },
    });
  }

  async remove(id: string, userId: string) {
    // Réutilise la vérification ci-dessus : impossible de supprimer
    // l'itinéraire d'un autre usager (404 avant d'atteindre le delete).
    await this.findOneForUser(id, userId);

    await this.prisma.route.delete({ where: { id } });
  }

  // ---------------------------------------------------------------------------
  // Recherche d'itinéraire (étape 4C-1)
  // ---------------------------------------------------------------------------

  /**
   * Cherche des itinéraires entre deux points géographiques.
   *
   * Principe en 4 temps :
   *   1. trouver l'arrêt le plus proche du départ et celui le plus proche
   *      de l'arrivée (formule de Haversine) ;
   *   2. construire un graphe : les arrêts (Stop) sont les sommets, les
   *      liaisons du RÉSEAU PUBLIC (NetworkLink) sont les arêtes ;
   *   3. appliquer Dijkstra deux fois : une fois en minimisant la durée,
   *      une fois en minimisant la distance ;
   *   4. mettre en forme les résultats.
   *
   * Renvoie un tableau vide si aucun itinéraire n'est possible.
   *
   * IMPORTANT (étape 4C-3) : cette méthode ne lit QUE des données publiques.
   * Elle n'interroge ni Route ni Segment, qui appartiennent aux usagers.
   * Jusqu'à l'étape 4C-2, le graphe était construit à partir des segments
   * des itinéraires personnels : la recherche, pourtant publique, dérivait
   * donc de données privées, et n'importe quel usager pouvait y injecter
   * des liaisons fantaisistes. La table NetworkLink, qui n'a aucun
   * propriétaire, supprime ces deux problèmes par construction.
   */
  async searchRoutes(dto: SearchRouteDto): Promise<ItineraryDto[]> {
    // ⚠️ LE GRAPHE EST BORNÉ SPATIALEMENT, et ce n'est pas une optimisation
    // prématurée : c'est ce qui rend l'ajout du bus et du RER possible.
    //
    // Ces deux requêtes chargeaient TOUT le réseau à CHAQUE recherche. Sur le
    // périmètre métro + tram (1 383 arrêts, 4 436 liaisons) c'était mesurable
    // mais tenable — 0,09 s. Le réseau complet d'Île-de-France compte environ
    // 50 000 arrêts et plus de 100 000 liaisons : le même code aurait balayé
    // trente-cinq fois plus de lignes, à chaque appel.
    //
    // orderBy reste INDISPENSABLE (étape 4C-2) : sans ORDER BY, PostgreSQL ne
    // garantit aucun ordre de lignes. Cet ordre se propagerait jusqu'au
    // départage des égalités dans Dijkstra, et deux recherches identiques
    // pourraient renvoyer deux chemins différents (de coût pourtant égal).
    //
    // include: { line: true } (étape 4C-4-1) : le mode est porté par la
    // LIGNE. Une seule requête suffit, Prisma joint les deux tables.
    const cadre = this.cadreDeRecherche(dto);

    const [stops, links] = await Promise.all([
      this.prisma.stop.findMany({ where: cadre, orderBy: { id: 'asc' } }),
      this.prisma.networkLink.findMany({
        // Les DEUX extrémités doivent tomber dans le cadre : une liaison dont
        // l'autre bout est hors zone mènerait à un sommet absent du graphe.
        where: { fromStop: cadre, toStop: cadre },
        orderBy: { id: 'asc' },
        include: { line: true },
      }),
    ]);

    if (stops.length === 0) {
      return [];
    }

    // ⚠️ TOUS LES QUAIS D'UN MÊME LIEU SONT ACCEPTABLES, pas seulement le
    // plus proche.
    //
    // Île-de-France Mobilités publie UN ARRÊT PAR QUAI : « Gare de Lyon »
    // existe en cinq exemplaires — métro 1, métro 14, RER A, RER D, TER.
    // Fixer le plus proche (le quai du métro 14, à 84 m) forçait le moteur à
    // payer une correspondance de 5 minutes pour rejoindre le RER, puis une
    // seconde à l'arrivée pour ressortir côté métro.
    //
    // Mesuré AVANT correction : Gare de Lyon → Gare du Nord rendait
    // « métro 14 + métro 4 » en 15 min, alors que le RER D relie les deux
    // gares en 7 minutes dans nos propres données. Le trajet n'était pas
    // faux, il était artificiellement contraint.
    const origines = this.arretsProches(stops, dto.fromLat, dto.fromLon);
    const destinations = this.arretsProches(stops, dto.toLat, dto.toLon);

    if (origines.length === 0 || destinations.length === 0) {
      return [];
    }

    // Deux points rattachés aux mêmes quais : il n'y a pas de trajet à
    // proposer, seulement quelques pas.
    if (origines.every((o) => destinations.some((d) => d.id === o.id))) {
      return [];
    }

    const graph = this.buildGraph(links);
    const stopsById = new Map(stops.map((stop) => [stop.id, stop]));

    // Sommets VIRTUELS reliés à coût nul à chaque quai candidat : la façon la
    // plus simple d'obtenir un Dijkstra multi-source / multi-cible sans
    // toucher à l'algorithme lui-même.
    this.brancherSommetsVirtuels(graph, origines, destinations);

    const fastest = this.nettoyerCheminVirtuel(
      this.dijkstra(
        graph,
        ORIGINE_VIRTUELLE,
        DESTINATION_VIRTUELLE,
        (edge) => edge.durationMin,
      ),
    );
    const shortest = this.nettoyerCheminVirtuel(
      this.dijkstra(
        graph,
        ORIGINE_VIRTUELLE,
        DESTINATION_VIRTUELLE,
        (edge) => edge.distanceM,
      ),
    );

    const itineraries: ItineraryDto[] = [];

    if (fastest) {
      itineraries.push(this.toItinerary('FASTEST', fastest, stopsById));
    }

    if (shortest) {
      const candidate = this.toItinerary('SHORTEST', shortest, stopsById);
      // Si le trajet le plus court est aussi le plus rapide, inutile de
      // renvoyer deux fois le même itinéraire.
      const isDuplicate =
        itineraries.length > 0 &&
        this.signature(itineraries[0]) === this.signature(candidate);

      if (!isDuplicate) {
        itineraries.push(candidate);
      }
    }

    return itineraries;
  }

  /**
   * Cadre géographique dans lequel chercher (bornage spatial).
   *
   * Le rectangle contenant l'origine et la destination, élargi de
   * `MARGE_CADRE_DEG`.
   *
   * ⚠️ LA MARGE EST UN COMPROMIS ASSUMÉ, pas une vérité. Un itinéraire
   * optimal peut légitimement sortir du rectangle direct — contourner la
   * Seine, passer par une gare de correspondance excentrée. Un détour
   * au-delà de la marge ne serait pas trouvé.
   *
   * La valeur retenue couvre très largement les détours réels à l'échelle
   * d'une agglomération, tout en ramenant le graphe à une taille à peu près
   * constante quel que soit le réseau importé.
   */
  private cadreDeRecherche(dto: SearchRouteDto): {
    latitude: { gte: number; lte: number };
    longitude: { gte: number; lte: number };
  } {
    return {
      latitude: {
        gte: Math.min(dto.fromLat, dto.toLat) - MARGE_CADRE_DEG,
        lte: Math.max(dto.fromLat, dto.toLat) + MARGE_CADRE_DEG,
      },
      longitude: {
        gte: Math.min(dto.fromLon, dto.toLon) - MARGE_CADRE_DEG,
        lte: Math.max(dto.fromLon, dto.toLon) + MARGE_CADRE_DEG,
      },
    };
  }

  /**
   * Tous les quais rattachables à un point, du plus proche au plus éloigné.
   *
   * ⚠️ REMPLACE `findNearestStop` dans la recherche. Un lieu comme « Gare de
   * Lyon » compte cinq quais distincts en base ; n'en retenir qu'un obligeait
   * le moteur à payer des correspondances qu'un voyageur ne ferait jamais —
   * il entre directement par le quai qui l'arrange.
   *
   * Le rayon reste `RAYON_RECHERCHE_MAX_M` : c'est la même règle métier
   * qu'avant, appliquée à un ensemble plutôt qu'à un singleton.
   *
   * `PLAFOND_QUAIS` borne le résultat : sur un pôle d'échange dense, une
   * vingtaine de quais entreraient dans le rayon sans rien apporter — les
   * plus proches suffisent, et le coût du Dijkstra reste maîtrisé.
   */
  private arretsProches(
    stops: Stop[],
    latitude: number,
    longitude: number,
  ): Stop[] {
    const candidats = stops
      .map((stop) => ({
        stop,
        distance: haversineDistanceM(
          latitude,
          longitude,
          stop.latitude,
          stop.longitude,
        ),
      }))
      .filter(({ distance }) => distance <= RAYON_RECHERCHE_MAX_M)
      // Départage par identifiant à distance égale : deux recherches
      // identiques doivent rendre le même résultat (déterminisme, 4C-2).
      .sort(
        (a, b) => a.distance - b.distance || a.stop.id.localeCompare(b.stop.id),
      );

    if (candidats.length === 0) {
      return [];
    }

    // Les quais du MÊME LIEU que le plus proche. On mesure depuis ce quai-là,
    // et non depuis le point demandé : une adresse peut être excentrée par
    // rapport à la station sans que ses quais cessent d'être voisins.
    const [plusProche] = candidats;

    const memeLieu = candidats.filter(
      ({ stop }) =>
        haversineDistanceM(
          plusProche.stop.latitude,
          plusProche.stop.longitude,
          stop.latitude,
          stop.longitude,
        ) <= RAYON_QUAIS_M,
    );

    return memeLieu.slice(0, PLAFOND_QUAIS).map(({ stop }) => stop);
  }

  /**
   * Relie les sommets virtuels aux quais candidats, à coût nul.
   *
   * Les arêtes portent un mode `WALK` et une durée nulle : elles ne
   * représentent AUCUN déplacement réel, seulement le fait qu'entrer par
   * l'un ou l'autre quai revient au même. `nettoyerCheminVirtuel` les retire
   * avant que le chemin ne devienne un itinéraire.
   */
  private brancherSommetsVirtuels(
    graph: Graph,
    origines: Stop[],
    destinations: Stop[],
  ): void {
    const areteNulle = (toStopId: string): GraphEdge => ({
      toStopId,
      mode: ModeTransport.WALK,
      lineName: '',
      operator: '',
      lineId: '',
      distanceM: 0,
      durationMin: 0,
    });

    graph.set(
      ORIGINE_VIRTUELLE,
      origines.map((stop) => areteNulle(stop.id)),
    );

    for (const stop of destinations) {
      const sortantes = graph.get(stop.id) ?? [];
      graph.set(stop.id, [...sortantes, areteNulle(DESTINATION_VIRTUELLE)]);
    }
  }

  /**
   * Retire du chemin les deux arêtes fictives.
   *
   * Sans ce nettoyage, l'itinéraire rendu au client commencerait et finirait
   * par un segment de zéro mètre sur une ligne sans nom.
   */
  private nettoyerCheminVirtuel(chemin: PathStep[] | null): PathStep[] | null {
    if (!chemin) {
      return null;
    }

    const reel = chemin.filter(
      (etape) =>
        etape.fromStopId !== ORIGINE_VIRTUELLE &&
        etape.edge.toStopId !== DESTINATION_VIRTUELLE,
    );

    return reel.length > 0 ? reel : null;
  }

  /**
   * Arrêt dont la distance à vol d'oiseau est la plus faible.
   *
   * Renvoie null si le point demandé n'est desservi par aucun arrêt à moins
   * de RAYON_RECHERCHE_MAX_M (étape 4C-2).
   */
  private findNearestStop(
    stops: Stop[],
    latitude: number,
    longitude: number,
  ): Stop | null {
    let nearest: Stop | null = null;
    let smallestDistance = Infinity;

    for (const stop of stops) {
      const distance = haversineDistanceM(
        latitude,
        longitude,
        stop.latitude,
        stop.longitude,
      );

      // Départage EXPLICITE en cas d'égalité parfaite : on retient l'arrêt
      // dont l'identifiant est le plus petit. Sans cette règle, le gagnant
      // serait "le premier rencontré", donc dépendrait de l'ordre de la
      // liste — et le résultat ne serait pas déterministe.
      const estMeilleur =
        distance < smallestDistance ||
        (distance === smallestDistance &&
          nearest !== null &&
          stop.id < nearest.id);

      if (estMeilleur) {
        smallestDistance = distance;
        nearest = stop;
      }
    }

    // Trop loin de tout : le point n'est desservi par aucun arrêt.
    if (smallestDistance > RAYON_RECHERCHE_MAX_M) {
      return null;
    }

    return nearest;
  }

  // Transforme les liaisons du réseau public en graphe orienté.
  //
  // Le graphe est ORIENTÉ : une liaison va de fromStop vers toStop et ne peut
  // pas être empruntée en sens inverse. C'est fidèle à la réalité (une ligne
  // de bus a un sens) — le trajet retour existe comme une liaison distincte.
  //
  // Depuis l'étape 4C-3, la durée est lue directement sur la liaison
  // (durationMin) au lieu d'être calculée à partir de deux horaires absolus :
  // un réseau décrit une durée de parcours typique, pas l'heure d'un trajet
  // particulier. Cette méthode s'en trouve nettement simplifiée.
  private buildGraph(
    links: {
      fromStopId: string;
      toStopId: string;
      distanceM: number;
      durationMin: number;
      // Depuis 4C-4-1, le mode vient de la ligne qui exploite le tronçon.
      // Depuis 4E-2, son nom et son exploitant en viennent aussi : la
      // requête charge déjà la ligne ENTIÈRE (include: { line: true }), donc
      // lire trois champs au lieu d'un ne coûte pas une requête de plus.
      line: { mode: ModeTransport; name: string; operator: string };
      // Clé étrangère brute de la liaison (étape 4E-3A) : déjà présente
      // dans le résultat de findMany, aucune requête ni jointure de plus.
      lineId: string;
    }[],
  ): Graph {
    const graph: Graph = new Map();

    for (const link of links) {
      const edges = graph.get(link.fromStopId) ?? [];
      edges.push({
        toStopId: link.toStopId,
        mode: link.line.mode,
        lineName: link.line.name,
        operator: link.line.operator,
        lineId: link.lineId,
        distanceM: link.distanceM,
        durationMin: link.durationMin,
      });
      graph.set(link.fromStopId, edges);
    }

    return graph;
  }

  /**
   * Algorithme de Dijkstra : plus court chemin dans un graphe dont les
   * arêtes ont un poids positif.
   *
   * Le paramètre `weightOf` définit ce qu'on cherche à minimiser : la durée
   * ou la distance. C'est le même algorithme dans les deux cas, seul le
   * "coût" d'une arête change.
   *
   * Renvoie la liste ordonnée des étapes, ou null si l'arrivée n'est pas
   * atteignable depuis le départ.
   */
  private dijkstra(
    graph: Graph,
    startStopId: string,
    endStopId: string,
    weightOf: (edge: GraphEdge) => number,
  ): PathStep[] | null {
    // Meilleur coût connu pour atteindre chaque arrêt depuis le départ.
    const bestCost = new Map<string, number>([[startStopId, 0]]);
    // Par où on est arrivé au meilleur coût : sert à reconstruire le chemin.
    const cameFrom = new Map<string, PathStep>();
    // Arrêts dont le coût minimal est définitivement connu.
    const settled = new Set<string>();

    for (;;) {
      // On choisit l'arrêt non traité au coût le plus faible. C'est le cœur
      // de Dijkstra : ce coût ne pourra plus jamais être amélioré, puisque
      // tout autre chemin passerait par un arrêt déjà plus coûteux.
      let current: string | undefined;
      let currentCost = Infinity;

      for (const [stopId, cost] of bestCost) {
        if (settled.has(stopId)) {
          continue;
        }

        // Départage EXPLICITE à coût égal : le plus petit identifiant gagne
        // (étape 4C-2). Sinon l'arrêt retenu dépendrait de l'ordre
        // d'insertion dans la Map, donc de l'ordre des lignes en base, et
        // deux recherches identiques pourraient donner deux chemins
        // différents — de même coût, mais pas les mêmes.
        const estMeilleur =
          cost < currentCost ||
          (cost === currentCost && current !== undefined && stopId < current);

        if (estMeilleur) {
          current = stopId;
          currentCost = cost;
        }
      }

      // Plus rien à explorer : l'arrivée est inatteignable.
      if (current === undefined) {
        return null;
      }

      // Arrivée atteinte au coût minimal : on peut s'arrêter.
      if (current === endStopId) {
        break;
      }

      settled.add(current);

      // "Relâchement" : on essaie d'améliorer le coût des arrêts voisins.
      for (const edge of graph.get(current) ?? []) {
        if (settled.has(edge.toStopId)) {
          continue;
        }

        const candidateCost = currentCost + weightOf(edge);

        if (candidateCost < (bestCost.get(edge.toStopId) ?? Infinity)) {
          bestCost.set(edge.toStopId, candidateCost);
          cameFrom.set(edge.toStopId, { fromStopId: current, edge });
        }
      }
    }

    // Reconstruction du chemin, de l'arrivée vers le départ.
    const steps: PathStep[] = [];
    let cursor = endStopId;

    while (cursor !== startStopId) {
      const step = cameFrom.get(cursor);

      if (!step) {
        return null;
      }

      steps.unshift(step);
      cursor = step.fromStopId;
    }

    return steps;
  }

  // Met en forme le chemin brut pour la réponse HTTP.
  private toItinerary(
    criterion: ItineraryCriterion,
    steps: PathStep[],
    stopsById: Map<string, Stop>,
  ): ItineraryDto {
    const segments: ItinerarySegmentDto[] = steps.map((step) => ({
      fromStopId: step.fromStopId,
      fromStopName: stopsById.get(step.fromStopId)?.name ?? '',
      toStopId: step.edge.toStopId,
      toStopName: stopsById.get(step.edge.toStopId)?.name ?? '',
      mode: step.edge.mode,
      // Transmis TELS QUELS depuis TransitLine : aucune valeur par défaut,
      // aucun repli, aucun traitement particulier selon le mode. La marche
      // fonctionne comme le reste, parce qu'elle est elle aussi portée par
      // une ligne du réseau (« À pied », voir le seed).
      lineName: step.edge.lineName,
      operator: step.edge.operator,
      lineId: step.edge.lineId,
      distanceM: step.edge.distanceM,
      durationMin: step.edge.durationMin,
    }));

    return {
      criterion,
      totalDistanceM: segments.reduce((sum, s) => sum + s.distanceM, 0),
      totalDurationMin: segments.reduce((sum, s) => sum + s.durationMin, 0),
      segments,
    };
  }

  // Identité d'un itinéraire : la suite des arrêts empruntés et des modes.
  // Sert uniquement à repérer deux itinéraires identiques.
  private signature(itinerary: ItineraryDto): string {
    return itinerary.segments
      .map((s) => `${s.fromStopId}>${s.toStopId}:${s.mode}`)
      .join('|');
  }
}
