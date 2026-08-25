import { Module } from '@nestjs/common';
import { GtfsRtSourceService } from './gtfs-rt-source.service';
import { GtfsRtDecoderService } from './gtfs-rt-decoder.service';

// Module de lecture des flux GTFS-Realtime (étape 4F-1B).
//
// Comme GtfsModule, il n'expose AUCUN controller : à ce stade rien n'est
// écrit en base et aucun endpoint n'est ouvert. Ce module ne fait que
// rapporter des octets (GtfsRtSourceService) et les décoder
// (GtfsRtDecoderService).
//
// Les deux services sont exportés pour l'étape 4F-1C, qui extraira les
// alertes du FeedMessage et les traduira en modèle métier. Ils ne
// dépendent d'aucun autre module — pas même de PrismaModule, puisqu'ils
// ne touchent pas à la base.
@Module({
  providers: [GtfsRtSourceService, GtfsRtDecoderService],
  exports: [GtfsRtSourceService, GtfsRtDecoderService],
})
export class GtfsRtModule {}
