import { Module } from '@nestjs/common';
import { CarbonController } from './carbon.controller';
import { CarbonService } from './carbon.service';

// Ce module n'importe NI PrismaModule, NI AuthModule.
//
// Ce n'est pas un oubli, c'est la démonstration du périmètre de l'étape 4D :
// le calcul carbone ne touche pas à la base et ne connaît pas l'usager. La
// persistance (CarbonRecord, CarbonBudget) viendra à l'étape 4E, et c'est à
// ce moment-là que PrismaModule apparaîtra ici.
@Module({
  controllers: [CarbonController],
  providers: [CarbonService],
})
export class CarbonModule {}
