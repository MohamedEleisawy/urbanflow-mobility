import { Module } from '@nestjs/common';
import { CarbonTrackingController } from './carbon-tracking.controller';
import { CarbonTrackingService } from './carbon-tracking.service';
import { AuthModule } from '../auth/auth.module';

// Suivi carbone personnel (étape 4E-5A).
//
// POURQUOI UN MODULE SÉPARÉ DE CarbonModule, alors que les deux parlent de
// CO2 ? Parce qu'ils n'ont ni les mêmes dépendances, ni le même public :
//
//   CarbonModule          CALCULE      sans état, anonyme, appelle FastAPI
//   CarbonTrackingModule  CONSULTE     lit la base, exige un jeton
//
// CarbonModule n'importe volontairement NI PrismaModule NI AuthModule —
// c'est écrit dans ses commentaires depuis l'étape 4D, et c'est la
// démonstration que le calcul carbone ne touche pas la base et ne connaît
// pas l'usager. Y ajouter une lecture authentifiée aurait détruit cette
// propriété que quatre sous-étapes ont servi à établir.
//
// AuthModule est importé pour son export JwtService, dont JwtAuthGuard a
// besoin (même raison que dans RoutesModule et UsersModule). PrismaService
// est global, il n'a pas à être importé.
@Module({
  imports: [AuthModule],
  controllers: [CarbonTrackingController],
  providers: [CarbonTrackingService],
})
export class CarbonTrackingModule {}
