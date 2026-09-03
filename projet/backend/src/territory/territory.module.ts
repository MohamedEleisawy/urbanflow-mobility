import { Module } from '@nestjs/common';
import { TerritoryController } from './territory.controller';
import { CapabilitiesController } from './capabilities.controller';

// Configuration territoriale (Phase 6). Aucun service, aucune base : ce module
// ne fait que publier des variables d'environnement deja validees.
@Module({ controllers: [TerritoryController, CapabilitiesController] })
export class TerritoryModule {}
