import { Module } from '@nestjs/common';
import { VelibController } from './velib.controller';
import { VelibService } from './velib.service';

// Stations Velib' (Phase 5). Aucun import : ce module ne touche pas la base,
// il relaie un flux public et le met en cache en memoire.
@Module({
  controllers: [VelibController],
  providers: [VelibService],
  exports: [VelibService],
})
export class VelibModule {}
