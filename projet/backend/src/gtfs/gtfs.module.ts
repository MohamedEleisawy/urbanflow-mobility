import { Module } from '@nestjs/common';
import { GtfsReaderService } from './gtfs-reader.service';

// Module de lecture des flux GTFS (étape 4C-4-2).
//
// Il n'expose AUCUN controller : il n'y a pas d'endpoint HTTP d'import à ce
// stade. Le dossier de conception prévoit à terme un endpoint réservé à
// l'administrateur (UC10), mais cela suppose le rôle ADMIN, hors périmètre.
//
// GtfsReaderService est exporté pour que l'étape 4C-4-3 puisse l'injecter
// dans le service d'import qui, lui, écrira en base.
@Module({
  providers: [GtfsReaderService],
  exports: [GtfsReaderService],
})
export class GtfsModule {}
