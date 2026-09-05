import { Module } from '@nestjs/common';
import { WalkRoutingService } from './walk-routing.service';
import { BikeRoutingService } from './bike-routing.service';

// Routage rue par rue — piéton ET vélo. Aucun import : ces services ne
// touchent pas la base, ils interrogent un moteur extérieur (Valhalla) et
// rendent `null` quand il n'y en a pas.
//
// Le nom du fichier reste `walk-routing` pour ne pas casser les imports
// existants ; le module, lui, couvre les deux profils.
@Module({
  providers: [WalkRoutingService, BikeRoutingService],
  exports: [WalkRoutingService, BikeRoutingService],
})
export class WalkRoutingModule {}
