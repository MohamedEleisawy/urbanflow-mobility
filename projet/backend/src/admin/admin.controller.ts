import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RoleEnum } from '@prisma/client';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
// "import type" est requis : JwtPayload est une interface (elle n'existe pas
// à l'exécution) et apparaît dans la signature d'une méthode décorée.
import type { JwtPayload } from '../auth/jwt-payload.type';
import { PaginationQueryDto } from '../routes/dto/pagination-query.dto';
import { AdminUsersPageDto } from './dto/admin-user.dto';
import { AdminStatsDto } from './dto/admin-stats.dto';

// Back-office (étape 6-3).
//
// ═══ LES GUARDS SONT SUR LA CLASSE, PAS SUR LA MÉTHODE ═══
//
// C'est le seul contrôleur du projet dont TOUTES les routes, présentes et à
// venir, doivent être réservées aux administrateurs. Poser la protection au
// niveau de la classe la rend impossible à oublier : une route ajoutée demain
// sera protégée sans que personne n'y pense.
//
// `RolesGuard` lit la metadata avec `getAllAndOverride`, qui regarde la
// méthode PUIS la classe : `@Roles` posé ici s'applique donc à tout, et une
// route particulière pourra un jour le surcharger si le besoin apparaît.
//
// Le préfixe `admin` sépare aussi clairement les URL : `/api/admin/*` ne se
// confond avec aucune route d'usager.
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RoleEnum.ADMIN)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  /**
   * Liste paginée des comptes.
   *
   *   GET /api/admin/users?page=1&limit=20
   *
   * ⚠️ Le DTO de pagination est CELUI DE `GET /api/routes` (4E-4A), réutilisé
   * tel quel : mêmes bornes (page ≥ 1, limit 1 à 50, 20 par défaut), même
   * forme de réponse. En écrire un second obligerait chaque appelant à se
   * souvenir de quelle convention s'applique où — et les deux finiraient par
   * diverger.
   *
   * Réponses : 200 pour un ADMIN, 403 pour un USER authentifié, 401 sans
   * jeton valide. Aucun identifiant n'est accepté : cette route ne cible
   * personne en particulier.
   */
  @Get('users')
  listUsers(
    @Query() pagination: PaginationQueryDto,
  ): Promise<AdminUsersPageDto> {
    return this.adminService.listUsers(pagination);
  }

  /**
   * Désactive logiquement un compte (étape 6-4).
   *
   *   DELETE /api/admin/users/:id
   *
   * ⚠️ LA SEULE ROUTE DU PROJET QUI ACCEPTE UN IDENTIFIANT DÉSIGNANT
   * QUELQU'UN D'AUTRE. Toutes les autres visent `/me` précisément pour qu'il
   * n'y ait rien à contrôler. Ici, l'identifiant EST le sujet de l'action :
   * c'est une interface de modération, elle ne peut pas agir sur soi.
   *
   * La protection ne repose donc plus sur l'absence de paramètre, mais sur
   * deux choses :
   *
   *   - le RÔLE de l'appelant, qui vient du jeton et de nulle part ailleurs
   *     (`@Roles(RoleEnum.ADMIN)` sur la classe) ;
   *   - son IDENTITÉ, prise dans `@CurrentUser().sub` — jamais dans le corps
   *     ni dans une query — pour refuser l'auto-suppression.
   *
   * Le corps de la requête est ignoré : il n'y a aucun DTO, donc aucun champ
   * qu'un client pourrait glisser pour se faire passer pour un autre.
   *
   * `204 No Content`, comme `DELETE /users/me` (5G) et `DELETE /routes/:id`
   * (5A-9) : la suppression a réussi, il n'y a rien à renvoyer. Trois
   * suppressions qui répondraient différemment obligeraient le frontend à
   * s'en souvenir.
   *
   * Réponses : 204 (succès, y compris sur un compte déjà supprimé),
   * 400 (auto-suppression, ou identifiant qui n'est pas un UUID),
   * 401 (jeton absent ou invalide), 403 (usager non administrateur),
   * 404 (compte inexistant).
   */
  @Delete('users/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteUser(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: JwtPayload,
  ): Promise<void> {
    await this.adminService.deleteUser(id, admin.sub);
  }

  /**
   * Tableau de bord anonymisé (étape 6-5).
   *
   *   GET /api/admin/stats
   *
   * Le dossier le décrit ainsi : « Accès à des tableaux de bord anonymisés
   * sur l'utilisation de l'application, permettant d'analyser les habitudes
   * de déplacement dans la ville. » (§3.2.1)
   *
   * AUCUN PARAMÈTRE. Le dossier ne demande ni période, ni filtre : les
   * statistiques sont GLOBALES. Ajouter `?from=&to=` parce que c'est possible
   * inventerait un besoin, et il faudrait ensuite décider ce que signifie une
   * borne — la date du trajet ? de l'enregistrement carbone ? de la création
   * du compte ? Trois réponses différentes pour trois sections.
   *
   * Protégé par les guards de la CLASSE : 200 pour un ADMIN, 403 pour un
   * USER, 401 sans jeton valide.
   */
  @Get('stats')
  getStats(): Promise<AdminStatsDto> {
    return this.adminService.getStats();
  }
}
