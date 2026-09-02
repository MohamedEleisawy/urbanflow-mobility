import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RoleEnum } from '@prisma/client';
import { StopsService } from './stops.service';
import { CreateStopDto } from './dto/create-stop.dto';
import { FindStopsQueryDto } from './dto/find-stops-query.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('stops')
export class StopsController {
  constructor(private readonly stopsService: StopsService) {}

  // ÉCRITURE RÉSERVÉE AUX ADMINISTRATEURS (étape 6-1).
  //
  // Un arrêt est une DONNÉE DE RÉFÉRENCE DU RÉSEAU : il est visible de tous,
  // sert de sommet au calcul d'itinéraire, et un arrêt fantaisiste fausserait
  // les trajets de tout le monde. Ce n'est pas une donnée personnelle, et
  // aucun cloisonnement par `userId` ne peut donc la protéger — seul le rôle
  // le peut.
  //
  // C'est la dette que le commentaire précédent annonçait : « pour l'instant
  // tout usager connecté peut le faire. À restreindre lors de l'étape
  // consacrée aux rôles. » Elle est levée ici.
  //
  // Le dossier le demande explicitement (§3.2.1, bloc Administration :
  // « Importer des flux de données », et §3.3 : « le système distingue
  // plusieurs profils afin de contrôler précisément les autorisations »).
  //
  // ⚠️ LES DEUX GUARDS, ET DANS CET ORDRE. `JwtAuthGuard` établit QUI demande
  // (401 sinon) ; `RolesGuard` décide si cette personne-là a le droit (403
  // sinon). Inversés, le second s'exécuterait avant que `request.user`
  // n'existe.
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleEnum.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateStopDto) {
    return this.stopsService.create(dto);
  }

  // Lecture PUBLIQUE (pas de @UseGuards) : le diagramme de cas d'utilisation
  // place "UC07 Consulter la carte" et "UC01 Rechercher un itinéraire" dans
  // le bloc "Mobilité (Libre accès)". Un visiteur non connecté doit donc
  // pouvoir consulter les arrêts. Ces données ne sont pas personnelles.
  // ⚠️ TOUJOURS BORNÉ (Phase 4). Il n'existe plus aucun moyen d'obtenir la
  // totalité des arrêts en une requête : voir StopsService.findAll() pour la
  // raison, et FindStopsQueryDto pour les trois façons de demander.
  //
  // Un paramètre non déclaré dans le DTO est rejeté en 400 par le
  // ValidationPipe global (`forbidNonWhitelisted`), qui s'applique aussi aux
  // paramètres d'URL.
  @Get()
  findAll(@Query() query: FindStopsQueryDto) {
    return this.stopsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.stopsService.findOne(id);
  }
}
