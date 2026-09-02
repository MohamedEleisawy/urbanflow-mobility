import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AddressesModule } from './addresses/addresses.module';
import { GeocodingModule } from './geocoding/geocoding.module';
import { AdminModule } from './admin/admin.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { RoutesModule } from './routes/routes.module';
import { StopsModule } from './stops/stops.module';
import { SegmentsModule } from './segments/segments.module';
import { GtfsModule } from './gtfs/gtfs.module';
import { GtfsRtModule } from './gtfs-rt/gtfs-rt.module';
import { AlertsModule } from './alerts/alerts.module';
import { CarbonModule } from './carbon/carbon.module';
import { CarbonTrackingModule } from './carbon-tracking/carbon-tracking.module';

@Module({
  imports: [
    PrismaModule,
    UsersModule,
    AuthModule,
    // Back-office réservé aux administrateurs (étape 6-3).
    AdminModule,
    // Adresses favorites Domicile / Travail (bloc 7).
    AddressesModule,
    // Recherche d'adresses en saisie libre (Phase 3A). Publique.
    GeocodingModule,
    RoutesModule,
    StopsModule,
    SegmentsModule,
    // Aucun endpoint HTTP : le module sert le script d'import en ligne de
    // commande (npm run gtfs:import).
    GtfsModule,
    // Lecture des flux GTFS-Realtime (étape 4F-1B). Distinct de GtfsModule :
    // celui-ci lit un réseau statique livré en archive, celui-là un flux
    // binaire rafraîchi en continu. Aucun endpoint non plus à ce stade.
    GtfsRtModule,
    // Lecture publique des perturbations (UC02, étape 4F-2B). Distinct de
    // GtfsRtModule : celui-ci importe un flux binaire, celui-là sert une
    // liste à un voyageur. Aucune dépendance entre les deux.
    AlertsModule,
    // Proxy vers le microservice FastAPI. Aucune dépendance vers
    // RoutesModule : la recherche d'itinéraire n'appelle jamais le calcul
    // carbone, et reste donc utilisable si le microservice est en panne.
    CarbonModule,
    // Consultation du suivi carbone personnel (étape 4E-5A). Distinct de
    // CarbonModule : celui-ci calcule sans état, celui-là lit l'historique
    // d'un usager authentifié.
    CarbonTrackingModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
