import { Module } from '@nestjs/common';
import { ScheduleController } from './schedule.controller';
import { ScheduleService } from './schedule.service';

// Calendrier de service et horaires théoriques (sprint soutenance).
//
// `ScheduleService` est EXPORTÉ : le moteur d'itinéraires en a besoin pour
// écarter les lignes qui ne circulent pas et pour compter l'attente.
@Module({
  controllers: [ScheduleController],
  providers: [ScheduleService],
  exports: [ScheduleService],
})
export class ScheduleModule {}
