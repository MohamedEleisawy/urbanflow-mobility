import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RoutesService } from './routes.service';
import { CreateRouteDto } from './dto/create-route.dto';
import { SearchRouteDto } from './dto/search-route.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.type';

// Le guard était posé sur la CLASSE jusqu'à l'étape 4B. Il a été déplacé
// sur chaque méthode à l'étape 4C-1, car la recherche d'itinéraire doit
// être PUBLIQUE : le diagramme de cas d'utilisation place "UC01 Rechercher
// un itinéraire" dans le bloc "Mobilité (Libre accès)".
//
// Un guard de classe ne peut pas être désactivé pour une seule méthode :
// il fallait donc soit ce déplacement, soit un décorateur @Public() associé
// à une modification du guard. Le déplacement est plus simple et rend la
// protection de chaque route visible directement au-dessus d'elle.
@Controller('routes')
export class RoutesController {
  constructor(private readonly routesService: RoutesService) {}

  // PUBLIC : aucune authentification requise (aucun @UseGuards ici).
  // Déclaré avant les autres pour que le chemin littéral "search" soit
  // lisible en premier.
  @Post('search')
  // 200 et non 201 : cette requête ne crée rien, elle interroge. On utilise
  // POST plutôt que GET car les critères de recherche sont un objet JSON.
  @HttpCode(HttpStatus.OK)
  search(@Body() dto: SearchRouteDto) {
    return this.routesService.searchRoutes(dto);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateRouteDto) {
    // user.sub = id de l'usager, extrait du token vérifié par le guard.
    return this.routesService.create(user.sub, dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  findAll(@CurrentUser() user: JwtPayload) {
    return this.routesService.findAllForUser(user.sub);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.routesService.findOneForUser(id, user.sub);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  // 204 No Content : la suppression a réussi, il n'y a rien à renvoyer.
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.routesService.remove(id, user.sub);
  }
}
