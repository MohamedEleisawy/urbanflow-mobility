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
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
// "import type" est requis ici : JwtPayload est une interface (elle n'existe
// pas à l'exécution) et elle apparaît dans la signature d'une méthode
// décorée. Voir l'option isolatedModules du tsconfig.
import type { JwtPayload } from '../auth/jwt-payload.type';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  // ATTENTION À L'ORDRE : cette route doit être déclarée AVANT @Get(':id').
  // NestJS teste les routes dans leur ordre de déclaration ; si ':id' venait
  // en premier, l'URL /users/me lui correspondrait, et ParseUUIDPipe
  // rejetterait "me" avec une erreur 400 au lieu d'appeler cette méthode.
  @Get('me')
  // @UseGuards : la requête doit passer par JwtAuthGuard avant d'arriver
  // ici. Sans token valide, le guard lève une 401 et findMe n'est jamais
  // exécutée.
  @UseGuards(JwtAuthGuard)
  findMe(@CurrentUser() user: JwtPayload) {
    // user.sub = l'id de l'utilisateur, extrait du token vérifié. On relit
    // l'utilisateur en base plutôt que de renvoyer le contenu du token :
    // celui-ci a pu être émis il y a jusqu'à une heure et ne reflète donc
    // pas forcément les données actuelles (préférences modifiées, etc.).
    return this.usersService.findById(user.sub);
  }

  @Get(':id')
  // ParseUUIDPipe : si :id n'est pas un UUID valide, NestJS renvoie 400 tout
  // seul, avant même d'interroger la base (id est une colonne @db.Uuid).
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findById(id);
  }
}
