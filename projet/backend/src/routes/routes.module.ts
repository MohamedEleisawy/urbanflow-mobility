import { Module } from '@nestjs/common';
import { RoutesController } from './routes.controller';
import { RoutesService } from './routes.service';
import { AuthModule } from '../auth/auth.module';
import { CarbonModule } from '../carbon/carbon.module';

@Module({
  // AuthModule est importé pour son export JwtService, dont JwtAuthGuard a
  // besoin pour vérifier les tokens (même raison que dans UsersModule).
  //
  // CarbonModule est importé à l'étape 4E-3A en PRÉPARATION de 4E-3B :
  // l'enregistrement d'un trajet devra faire calculer le CO2 par le
  // microservice. RoutesService ne l'injecte pas encore, faute d'usage —
  // ajouter une dépendance inutilisée à son constructeur ne rendrait service
  // à personne et casserait les tests unitaires qui l'instancient à la main.
  //
  // ATTENTION pour 4E-3B : cette dépendance ne concernera QUE create().
  // searchRoutes() ne doit JAMAIS appeler FastAPI, sans quoi une panne du
  // microservice rendrait la recherche d'itinéraire indisponible.
  imports: [AuthModule, CarbonModule],
  controllers: [RoutesController],
  providers: [RoutesService],
  // Exporté pour que SegmentsService puisse réutiliser findOneForUser() et
  // vérifier la propriété d'une Route, au lieu de dupliquer cette logique
  // de sécurité à un deuxième endroit.
  exports: [RoutesService],
})
export class RoutesModule {}
