import { Module } from '@nestjs/common';
import { GtfsReaderService } from './gtfs-reader.service';
import { GtfsImportService } from './gtfs-import.service';
import { NetworkBuilderService } from './network-builder.service';
import { GtfsSourceService } from './gtfs-source.service';

// Module de lecture des flux GTFS (étape 4C-4-2).
//
// Il n'expose AUCUN controller : il n'y a pas d'endpoint HTTP d'import à ce
// stade. Le dossier de conception prévoit à terme un endpoint réservé à
// l'administrateur (UC10), mais cela suppose le rôle ADMIN, hors périmètre.
//
// GtfsReaderService est exporté pour que l'étape 4C-4-3 puisse l'injecter
// dans le service d'import qui, lui, écrira en base.
// GtfsImportService a besoin de PrismaService : celui-ci est disponible
// partout grâce à PrismaModule, déclaré @Global() depuis l'étape 2A.
@Module({
  providers: [
    GtfsReaderService,
    GtfsImportService,
    NetworkBuilderService,
    GtfsSourceService,
  ],
  exports: [
    GtfsReaderService,
    GtfsImportService,
    NetworkBuilderService,
    GtfsSourceService,
  ],
})
export class GtfsModule {}
