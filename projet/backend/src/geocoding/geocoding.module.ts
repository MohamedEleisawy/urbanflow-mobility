import { Module } from '@nestjs/common';
import { GeocodingController } from './geocoding.controller';
import { GeocodingService } from './geocoding.service';

// Recherche d'adresses (Phase 3A).
//
// AUCUN import : ce module ne touche ni à la base — pas de Prisma, pas de
// table, pas de migration — ni à l'authentification, la route étant publique.
// Il n'a qu'une dépendance, et elle est externe : le fournisseur de géocodage,
// appelé par le seul service.
@Module({
  controllers: [GeocodingController],
  providers: [GeocodingService],
})
export class GeocodingModule {}
