import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CarbonTrackingService } from './carbon-tracking.service';
import { WeeklyTrackingQueryDto } from './dto/weekly-tracking-query.dto';
import { WeekQueryDto } from './dto/week-query.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.type';

// Suivi carbone personnel (étape 4E-5A).
//
// TOUJOURS AUTHENTIFIÉ, contrairement à POST /api/carbone qui est public :
// celui-ci calcule sans rien connaître de personne, celui-là lit
// l'historique d'un usager précis. Le diagramme de cas d'utilisation place
// d'ailleurs "UC03 Calculer & Suivre son CO₂" dans l'Espace Personnel.
//
// Racine distincte de `carbone` : deux contrôleurs sur le même préfixe
// seraient acceptés par NestJS, mais on chercherait la route dans le
// mauvais fichier. Une racine, un module.
@Controller('suivi-carbone')
export class CarbonTrackingController {
  constructor(private readonly carbonTrackingService: CarbonTrackingService) {}

  // `userId` ne peut venir QUE du jeton. Un `?userId=` glissé dans l'URL est
  // rejeté en 400 par le ValidationPipe global : il n'est pas déclaré dans
  // WeeklyTrackingQueryDto, et forbidNonWhitelisted s'applique aussi aux
  // paramètres d'URL.
  @Get()
  @UseGuards(JwtAuthGuard)
  findWeekly(
    @CurrentUser() user: JwtPayload,
    @Query() query: WeeklyTrackingQueryDto,
  ) {
    return this.carbonTrackingService.findWeeklyForUser(user.sub, query);
  }

  // Budget d'une semaine et son état de consommation (étape 4E-5B).
  //
  // Sans `?year=&week=`, la semaine EN COURS est utilisée : c'est ce qu'un
  // usager consulte le plus souvent, et cela évite au client de calculer
  // lui-même une semaine ISO — un calcul dont l'étape 4E-5A a montré les
  // pièges (l'année d'une semaine n'est pas toujours celle de la date).
  @Get('budget')
  @UseGuards(JwtAuthGuard)
  findBudget(@CurrentUser() user: JwtPayload, @Query() query: WeekQueryDto) {
    return this.carbonTrackingService.findBudgetForUser(user.sub, query);
  }
}
