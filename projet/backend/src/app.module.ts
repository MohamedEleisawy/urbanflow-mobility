import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { RoutesModule } from './routes/routes.module';
import { StopsModule } from './stops/stops.module';
import { SegmentsModule } from './segments/segments.module';
import { GtfsModule } from './gtfs/gtfs.module';
import { CarbonModule } from './carbon/carbon.module';

@Module({
  imports: [
    PrismaModule,
    UsersModule,
    AuthModule,
    RoutesModule,
    StopsModule,
    SegmentsModule,
    // Aucun endpoint HTTP : le module sert le script d'import en ligne de
    // commande (npm run gtfs:import).
    GtfsModule,
    // Proxy vers le microservice FastAPI. Aucune dépendance vers
    // RoutesModule : la recherche d'itinéraire n'appelle jamais le calcul
    // carbone, et reste donc utilisable si le microservice est en panne.
    CarbonModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
