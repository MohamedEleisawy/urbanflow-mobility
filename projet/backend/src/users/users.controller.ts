import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserPreferencesDto } from './dto/update-user-preferences.dto';
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

  /**
   * Met à jour les préférences de l'usager authentifié (étape 5E-1).
   *
   * PATCH ET NON PUT : le corps décrit ce qui CHANGE. Un PUT exigerait
   * l'objet entier à chaque fois — l'usager qui bascule son thème en sombre
   * devrait redonner son budget carbone et ses modes favoris, et tout oubli
   * les effacerait.
   *
   * `/me/preferences` ET NON `/:id/preferences` : il n'existe aucun
   * identifiant à passer. Une route qui en accepterait un obligerait à
   * vérifier à chaque appel qu'il correspond bien au porteur du jeton — un
   * contrôle qu'on peut oublier. Ici, il n'y a rien à oublier.
   *
   * ⚠️ Ordre de déclaration : cette route ne peut PAS entrer en conflit avec
   * `@Get(':id')` ci-dessous, les méthodes HTTP étant différentes. En
   * revanche, si un `@Patch(':id')` était ajouté un jour, il devrait venir
   * APRÈS celle-ci — pour la raison expliquée plus haut à propos de
   * `@Get('me')`.
   *
   * Réponses : 200 avec les préférences réellement enregistrées (le client
   * réaffiche ce que le serveur a retenu, pas ce qu'il croit avoir envoyé),
   * 400 en cas de validation, 401 sans jeton valide.
   *
   * Ni 403 ni 404 : on n'atteint jamais que ses propres préférences, et
   * `user.sub` provient d'un jeton vérifié.
   */
  @Patch('me/preferences')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  updateMyPreferences(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateUserPreferencesDto,
  ) {
    // `user.sub` est le SEUL identifiant transmis au service. Le corps n'en
    // contient aucun, et le DTO n'en déclare aucun.
    return this.usersService.updatePreferences(user.sub, dto);
  }

  /**
   * Export RGPD des données personnelles (étape 5F).
   *
   * Le dossier promet à l'usager de « télécharger à tout moment un fichier
   * contenant l'intégralité de ses informations personnelles ».
   *
   * `/me/export` ET NON `/:id/export` : la route n'accepte AUCUN
   * identifiant. Une route paramétrée obligerait à vérifier à chaque appel
   * qu'il correspond au porteur du jeton — un contrôle qu'on peut oublier, et
   * dont l'oubli livrerait le compte entier de quelqu'un d'autre.
   *
   * ⚠️ Déclarée AVANT `@Get(':id')`, et cette fois l'ordre COMPTE VRAIMENT :
   * les deux sont des `@Get`. Placée après, l'URL `/users/me/export` ne
   * correspondrait à rien — mais surtout, `/users/me` a déjà dû être déclarée
   * avant `:id` pour la même raison (voir plus haut).
   *
   * `Content-Disposition: attachment` fait TÉLÉCHARGER le fichier plutôt que
   * l'afficher, y compris pour un appel direct depuis la barre d'adresse. Le
   * nom est statique : il ne peut pas être lu par le frontend, car
   * `Content-Disposition` n'est pas un en-tête exposé par défaut en CORS, et
   * l'exposer supposerait de toucher la configuration CORS pour un simple
   * confort. Le frontend compose donc son propre nom de fichier à partir
   * d'`exportedAt`, présent dans le corps.
   */
  @Get('me/export')
  @UseGuards(JwtAuthGuard)
  @Header('Content-Type', 'application/json; charset=utf-8')
  @Header(
    'Content-Disposition',
    'attachment; filename="urbanflow-donnees-personnelles.json"',
  )
  exportMyData(@CurrentUser() user: JwtPayload) {
    // `user.sub` est le SEUL identifiant transmis : il vient d'un jeton signé
    // et vérifié par JwtAuthGuard.
    return this.usersService.exportPersonalData(user.sub);
  }

  /**
   * Supprime le compte de l'usager authentifié (étape 5G).
   *
   * `DELETE /users/me` — le verbe dit l'intention, et `/me` n'accepte AUCUN
   * identifiant. Même raisonnement qu'en 5E et 5F : une route paramétrée
   * obligerait à vérifier à chaque appel qu'elle vise bien son auteur, et
   * l'oubli de ce contrôle supprimerait le compte de quelqu'un d'autre.
   *
   * `204 No Content`, comme `DELETE /routes/:id` (étape 5A-9) : la
   * suppression a réussi, il n'y a rien à renvoyer. La cohérence compte —
   * deux suppressions qui répondraient différemment obligeraient le frontend
   * à s'en souvenir.
   *
   * IDEMPOTENT : rappeler cette route sur un compte déjà supprimé répond
   * encore 204. Le résultat attendu est atteint dans les deux cas.
   *
   * ⚠️ En pratique, un second appel n'arrivera jamais jusqu'ici : depuis
   * cette même étape, `JwtAuthGuard` refuse les jetons des comptes supprimés
   * et répondrait 401. L'idempotence du service reste néanmoins garantie —
   * une propriété ne doit pas dépendre d'une autre couche pour être vraie.
   */
  @Delete('me')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMyAccount(@CurrentUser() user: JwtPayload): Promise<void> {
    await this.usersService.deleteMyAccount(user.sub);
  }

  @Get(':id')
  // ParseUUIDPipe : si :id n'est pas un UUID valide, NestJS renvoie 400 tout
  // seul, avant même d'interroger la base (id est une colonne @db.Uuid).
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findById(id);
  }
}
