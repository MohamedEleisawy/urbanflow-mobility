import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRouteDto } from './dto/create-route.dto';

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
}
