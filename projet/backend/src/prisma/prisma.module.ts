import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// @Global() : PrismaService devient disponible dans n'importe quel autre
// module Nest sans avoir à réimporter PrismaModule à chaque fois — un seul
// point d'accès à la base de données pour toute l'application.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
