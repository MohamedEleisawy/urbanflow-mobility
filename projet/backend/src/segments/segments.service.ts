import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RoutesService } from '../routes/routes.service';
import { CreateSegmentDto } from './dto/create-segment.dto';

@Injectable()
export class SegmentsService {
  constructor(
    private readonly prisma: PrismaService,
    // Réutilise la vérification de propriété écrite à l'étape 4A plutôt que
    // de la réécrire ici : une seule implémentation de cette règle de
    // sécurité, donc un seul endroit à corriger si elle doit évoluer.
    private readonly routesService: RoutesService,
  ) {}

  async create(routeId: string, userId: string, dto: CreateSegmentDto) {
    // 1) La route existe-t-elle ET m'appartient-elle ? Lève 404 sinon.
    //    Cette ligne est la garantie qu'on ne peut pas ajouter un segment
    //    dans l'itinéraire d'un autre usager.
    await this.routesService.findOneForUser(routeId, userId);

    // 2) Règle métier : on ne peut pas arriver avant d'être parti.
    if (dto.arrivalTime <= dto.departureTime) {
      throw new BadRequestException(
        "L'heure d'arrivée doit être postérieure à l'heure de départ",
      );
    }

    try {
      return await this.prisma.segment.create({
        data: { ...dto, routeId },
      });
    } catch (error) {
      // P2003 = violation de clé étrangère : fromStopId ou toStopId ne
      // correspond à aucun arrêt existant. Sans ce garde-fou, Prisma
      // remonterait une erreur brute et Nest répondrait 500.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException(
          'fromStopId ou toStopId ne correspond à aucun arrêt existant',
        );
      }
      throw error;
    }
  }

  async findAllForRoute(routeId: string, userId: string) {
    await this.routesService.findOneForUser(routeId, userId);

    return this.prisma.segment.findMany({
      where: { routeId },
      // Ordre chronologique : c'est l'ordre dans lequel on parcourt
      // réellement l'itinéraire (marche, puis bus, puis métro...).
      orderBy: { departureTime: 'asc' },
      // On renvoie les arrêts complets (nom, coordonnées) et pas seulement
      // leurs identifiants : c'est ce dont une carte a besoin pour afficher
      // le trajet, sans avoir à faire une requête par arrêt.
      include: { fromStop: true, toStop: true },
    });
  }

  async findOneForRoute(routeId: string, id: string, userId: string) {
    await this.routesService.findOneForUser(routeId, userId);

    const segment = await this.prisma.segment.findUnique({
      where: { id },
      include: { fromStop: true, toStop: true },
    });

    // On vérifie aussi que le segment appartient bien à CETTE route : sinon
    // on pourrait lire le segment d'un autre itinéraire en passant l'id
    // d'une route qui nous appartient.
    if (!segment || segment.routeId !== routeId) {
      throw new NotFoundException(`Segment ${id} introuvable`);
    }

    return segment;
  }
}
