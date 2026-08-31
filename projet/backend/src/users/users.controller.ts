import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
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

  // ⚠️ CE CONTRÔLEUR N'A PLUS AUCUNE ROUTE PARAMÉTRÉE depuis l'étape 6-3
  // (voir la note en fin de fichier). Toutes visent `/me`, donc l'ordre de
  // déclaration n'a plus d'importance entre elles.
  //
  // Il en retrouverait une le jour où un `@Get(':id')` reviendrait : il
  // devrait alors être déclaré APRÈS toutes les routes `/me`, sans quoi
  // l'URL `/users/me` lui correspondrait et `ParseUUIDPipe` rejetterait
  // « me » en 400.
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
   * ⚠️ Ordre de déclaration : sans objet depuis l'étape 6-3, ce contrôleur
   * n'ayant plus aucune route paramétrée. Si un `@Patch(':id')` était ajouté
   * un jour, il devrait venir APRÈS celle-ci — pour la raison expliquée plus
   * haut à propos de `@Get('me')`.
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
   * ⚠️ L'ordre de déclaration importait tant que `@Get(':id')` existait :
   * les deux étant des `@Get`, cette route placée après n'aurait
   * correspondu à rien. La route paramétrée a été supprimée à l'étape 6-3,
   * mais la contrainte reviendrait avec elle.
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
    await this.usersService.softDeleteAccount(user.sub);
  }

  // ═══ `GET /users/:id` A ÉTÉ SUPPRIMÉE À L'ÉTAPE 6-3 ═══
  //
  // Elle rendait le profil de n'importe quel usager à partir de son UUID.
  // Publique jusqu'à l'étape 6-1, puis protégée par `JwtAuthGuard` — mais un
  // usager authentifié pouvait encore lire l'adresse électronique, le rôle et
  // les préférences d'un autre.
  //
  // Sa suppression plutôt qu'un durcissement, pour trois raisons :
  //
  //   1. AUCUN CONSOMMATEUR. Ni le frontend, ni un service, ni un script.
  //      Les seuls appels étaient les tests qui l'éprouvaient elle-même.
  //   2. AUCUNE EXIGENCE. Le dossier confie la « gestion des utilisateurs »
  //      à l'administrateur — c'est `GET /api/admin/users`, pas une route
  //      d'usager.
  //   3. LA MEILLEURE FAÇON DE NE PAS SE TROMPER SUR UNE AUTORISATION EST DE
  //      N'AVOIR RIEN À AUTORISER. Une route qui n'existe pas ne peut pas
  //      voir sa protection oubliée lors d'un remaniement.
  //
  // `GET /users/me` reste inchangée : c'est elle que le frontend utilise, et
  // `UsersService.findById` continue de la servir.
}
