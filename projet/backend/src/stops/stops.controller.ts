import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { StopsService } from './stops.service';
import { CreateStopDto } from './dto/create-stop.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('stops')
export class StopsController {
  constructor(private readonly stopsService: StopsService) {}

  // Écriture protégée : ajouter un arrêt modifie les données de référence du
  // réseau, ce ne doit pas être possible anonymement.
  //
  // (Le dossier réserve à terme cette action à l'administrateur — "UC10
  // Importer des flux de données". La distinction des rôles USER/ADMIN n'est
  // pas encore implémentée : pour l'instant tout usager connecté peut le
  // faire. À restreindre lors de l'étape consacrée aux rôles.)
  @Post()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateStopDto) {
    return this.stopsService.create(dto);
  }

  // Lecture PUBLIQUE (pas de @UseGuards) : le diagramme de cas d'utilisation
  // place "UC07 Consulter la carte" et "UC01 Rechercher un itinéraire" dans
  // le bloc "Mobilité (Libre accès)". Un visiteur non connecté doit donc
  // pouvoir consulter les arrêts. Ces données ne sont pas personnelles.
  @Get()
  findAll() {
    return this.stopsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.stopsService.findOne(id);
  }
}
