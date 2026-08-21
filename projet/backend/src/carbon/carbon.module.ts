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
  // Exporté à l'étape 4E-3A pour que RoutesService puisse s'en servir en
  // 4E-3B, au moment d'enregistrer un trajet : le serveur calculera alors
  // lui-même le CO2 et l'EcoScore au lieu de croire le client sur parole.
  //
  // Une SEULE implémentation de l'appel au microservice, réutilisée — le
  // même principe que RoutesService.findOneForUser(), exporté pour que
  // SegmentsService ne redéfinisse pas la vérification de propriété.
  //
  // Aucun cycle possible : ce module n'importe rien.
  exports: [CarbonService],
})
export class CarbonModule {}
