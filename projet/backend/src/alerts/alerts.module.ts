import { Module } from '@nestjs/common';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';

// Lecture publique des perturbations (étape 4F-2B).
//
// DISTINCT DE GtfsRtModule, délibérément. Celui-là récupère un flux binaire,
// le décode et l'importe ; celui-ci sert une liste à un voyageur. Deux
// métiers, deux modules : AlertsModule ne dépend d'aucun service GTFS-RT et
// ignore jusqu'à l'existence du protobuf.
//
// PrismaService suffit, et vient de PrismaModule, @Global() depuis l'étape 2A.
@Module({
  controllers: [AlertsController],
  providers: [AlertsService],
})
export class AlertsModule {}
