import { Injectable, NotFoundException } from '@nestjs/common';
import { ModeTransport, Stop } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRouteDto } from './dto/create-route.dto';
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

@Injectable()
export class RoutesService {
  constructor(private readonly prisma: PrismaService) {}

  // userId vient TOUJOURS du JWT (jamais du corps de la requête).
  create(userId: string, dto: CreateRouteDto) {
    return this.prisma.route.create({
      data: { ...dto, userId },
    });
  }

  // Ne renvoie que les itinéraires de cet usager : le filtre "where" est la
  // garantie qu'aucune donnée d'un autre usager ne peut apparaître ici.
  findAllForUser(userId: string) {
    return this.prisma.route.findMany({
      where: { userId },
      // Le plus récent en premier : c'est l'ordre attendu d'un historique.
      orderBy: { requestedAt: 'desc' },
    });
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
   *   2. construire un graphe : les arrêts sont les sommets, les segments
   *      enregistrés en base sont les arêtes ;
   *   3. appliquer Dijkstra deux fois : une fois en minimisant la durée,
   *      une fois en minimisant la distance ;
   *   4. mettre en forme les résultats.
   *
   * Renvoie un tableau vide si aucun itinéraire n'est possible.
   */
  async searchRoutes(dto: SearchRouteDto): Promise<ItineraryDto[]> {
    // On charge tout en mémoire : le calcul se fait ensuite en TypeScript.
    // Acceptable tant que le réseau reste petit (voir "limites" du carnet).
    //
    // orderBy est INDISPENSABLE (étape 4C-2) : sans ORDER BY, PostgreSQL ne
    // garantit aucun ordre de lignes. Cet ordre se propagerait jusqu'au
    // départage des égalités dans Dijkstra, et deux recherches identiques
    // pourraient renvoyer deux chemins différents (de coût pourtant égal).
    const [stops, segments] = await Promise.all([
      this.prisma.stop.findMany({ orderBy: { id: 'asc' } }),
      this.prisma.segment.findMany({ orderBy: { id: 'asc' } }),
    ]);

    if (stops.length === 0) {
      return [];
    }

    const origin = this.findNearestStop(stops, dto.fromLat, dto.fromLon);
    const destination = this.findNearestStop(stops, dto.toLat, dto.toLon);

    // Si les deux points sont plus proches du même arrêt, il n'y a pas de
    // trajet à proposer.
    if (!origin || !destination || origin.id === destination.id) {
      return [];
    }

    const graph = this.buildGraph(segments);
    const stopsById = new Map(stops.map((stop) => [stop.id, stop]));

    // Deux exécutions de Dijkstra, avec deux "poids" différents : c'est ce
    // qui produit deux propositions d'itinéraire.
    const fastest = this.dijkstra(
      graph,
      origin.id,
      destination.id,
      (edge) => edge.durationMin,
    );
    const shortest = this.dijkstra(
      graph,
      origin.id,
      destination.id,
      (edge) => edge.distanceM,
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

  // Transforme la liste des segments en graphe orienté.
  //
  // Le graphe est ORIENTÉ : un segment va de fromStop vers toStop et ne peut
  // pas être emprunté en sens inverse. C'est fidèle aux données (un trajet de
  // bus a un sens) — le trajet retour doit exister comme un segment distinct.
  private buildGraph(
    segments: {
      fromStopId: string;
      toStopId: string;
      mode: ModeTransport;
      distanceM: number;
      departureTime: Date;
      arrivalTime: Date;
    }[],
  ): Graph {
    const graph: Graph = new Map();

    for (const segment of segments) {
      // Le modèle stocke deux horaires absolus, pas une durée : on la
      // calcule. Math.max évite une durée négative si les données sont
      // incohérentes.
      const durationMin = Math.max(
        0,
        Math.round(
          (segment.arrivalTime.getTime() - segment.departureTime.getTime()) /
            60_000,
        ),
      );

      const edges = graph.get(segment.fromStopId) ?? [];
      edges.push({
        toStopId: segment.toStopId,
        mode: segment.mode,
        distanceM: segment.distanceM,
        durationMin,
      });
      graph.set(segment.fromStopId, edges);
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
