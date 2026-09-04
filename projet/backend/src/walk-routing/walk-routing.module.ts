import { Module } from '@nestjs/common';
import { WalkRoutingService } from './walk-routing.service';

// Aucun import : ce module ne touche pas la base. Il ne fait qu'interroger un
// moteur de routage extérieur, et rend `null` quand il n'y en a pas.
@Module({
  providers: [WalkRoutingService],
  exports: [WalkRoutingService],
})
export class WalkRoutingModule {}
