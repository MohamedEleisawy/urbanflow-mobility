import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStopDto } from './dto/create-stop.dto';

@Injectable()
export class StopsService {
  constructor(private readonly prisma: PrismaService) {}

  // Un Stop n'appartient à personne : c'est une donnée de référence du
  // réseau de transport, partagée par tous les usagers. Il n'y a donc pas
  // de vérification de propriété ici, contrairement aux Routes.
  create(dto: CreateStopDto) {
    return this.prisma.stop.create({ data: dto });
  }

  findAll() {
    return this.prisma.stop.findMany({ orderBy: { name: 'asc' } });
  }

  async findOne(id: string) {
    const stop = await this.prisma.stop.findUnique({ where: { id } });

    if (!stop) {
      throw new NotFoundException(`Arrêt ${id} introuvable`);
    }

    return stop;
  }
}
