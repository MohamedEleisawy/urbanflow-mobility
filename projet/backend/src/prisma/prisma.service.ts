import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// PrismaClient est généré à partir de prisma/schema.prisma (npx prisma generate).
// On l'étend ici pour le brancher sur le cycle de vie de Nest : la connexion à
// PostgreSQL s'ouvre au démarrage du module et se ferme proprement à l'arrêt.
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
