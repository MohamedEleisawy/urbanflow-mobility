import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { GtfsRtSourceService } from './gtfs-rt-source.service';
import { GtfsRtDecoderService } from './gtfs-rt-decoder.service';
import { GtfsRtImportService } from './gtfs-rt-import.service';

// Module de lecture des flux GTFS-Realtime (étape 4F-1B).
//
// Comme GtfsModule, il n'expose AUCUN controller : à ce stade rien n'est
// écrit en base et aucun endpoint n'est ouvert. Ce module ne fait que
// rapporter des octets (GtfsRtSourceService) et les décoder
// (GtfsRtDecoderService).
//
// GtfsRtImportService s'y est ajouté à l'étape 4F-1C : il enchaîne les deux
// briques précédentes et écrit les alertes en base. C'est lui, et lui seul,
// qui a besoin de PrismaService.
//
// POURQUOI PrismaModule EST IMPORTÉ EXPLICITEMENT, alors qu'il est @Global()
// depuis l'étape 2A. Le @Global() ne vaut que si le module a été chargé
// quelque part dans le graphe — ce qui est vrai au démarrage de
// l'application, mais faux dans un test qui compile GtfsRtModule seul. Sans
// cet import, le module n'est utilisable qu'à travers AppModule : le
// déclarer ici le rend autonome, et c'est ce qui permet au test d'import de
// n'assembler que ce dont il a besoin.
//
// La source et le décodeur, eux, ne touchent toujours pas à la base : c'est
// ce qui permet de les tester sans PostgreSQL.
@Module({
  imports: [PrismaModule],
  providers: [GtfsRtSourceService, GtfsRtDecoderService, GtfsRtImportService],
  exports: [GtfsRtSourceService, GtfsRtDecoderService, GtfsRtImportService],
})
export class GtfsRtModule {}
