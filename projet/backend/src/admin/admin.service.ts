import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { PaginationQueryDto } from '../routes/dto/pagination-query.dto';
import { AdminUsersPageDto } from './dto/admin-user.dto';

// Service d'administration (étape 6-3).
//
// ═══ POURQUOI UN MODULE À PART, ET NON UNE MÉTHODE DE UsersService ═══
//
// Ce n'est pas une question de rangement. `UsersService` est bâti sur une
// règle constante depuis l'étape 5E : TOUTE méthode agit sur `user.sub`,
// l'identifiant du demandeur. Préférences, export, suppression — aucune ne
// peut atteindre le compte d'autrui, par construction.
//
// Une méthode d'administration fait exactement l'inverse : elle lit TOUS les
// comptes. La glisser au milieu des autres briserait l'invariant qui rend ce
// service facile à relire, et le jour où quelqu'un ajouterait une méthode en
// s'inspirant de sa voisine, il aurait une chance sur deux de se tromper de
// modèle.
//
// La frontière est donc dans l'arborescence, là où on la voit.
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    // Injecté à l'étape 6-4 pour réutiliser `softDeleteAccount` : la
    // suppression logique n'a qu'UNE implémentation, celle de l'étape 5G.
    private readonly usersService: UsersService,
  ) {}

  /**
   * Liste paginée de tous les comptes (étape 6-3).
   *
   * ⚠️ CETTE MÉTHODE LIT LES DONNÉES DE TOUT LE MONDE. C'est la première du
   * projet dans ce cas, et c'est pourquoi elle vit derrière
   * `@Roles(RoleEnum.ADMIN)` — la seule protection possible ici, puisque
   * aucun cloisonnement par `userId` n'a de sens quand le but EST de tout
   * voir.
   *
   * ═══ `select` EXPLICITE, JAMAIS UN `include` ═══
   *
   * Cinq colonnes nommées à la main. `passwordHash` n'est pas dans la liste,
   * et ne peut donc pas y entrer par accident le jour où une colonne
   * s'ajoutera au modèle — c'est la même règle qu'à l'étape 5F pour l'export.
   *
   * ═══ DEUX REQUÊTES, EN PARALLÈLE ═══
   *
   * `count` et `findMany` sont indépendants : les enchaîner ferait attendre
   * deux allers-retours vers PostgreSQL au lieu d'un. Même forme que
   * `RoutesService.findAllForUser` (4E-4A).
   *
   * La pagination est faite PAR LA BASE (`skip`/`take`) : charger tous les
   * comptes pour n'en garder vingt annulerait tout l'intérêt de l'exercice.
   */
  async listUsers(pagination: PaginationQueryDto): Promise<AdminUsersPageDto> {
    const { page, limit } = pagination;

    const [total, items] = await Promise.all([
      // AUCUN `where` : les comptes supprimés sont comptés comme les autres,
      // sans quoi `total` ne correspondrait pas à ce que la liste montre.
      this.prisma.user.count(),
      this.prisma.user.findMany({
        // ORDRE DÉTERMINISTE, et le second critère n'est pas décoratif :
        // sans lui, deux comptes créés dans la même milliseconde — ce qui
        // arrive lors d'un import ou d'un test — pourraient changer de place
        // entre deux requêtes, et l'un d'eux apparaîtrait deux fois pendant
        // qu'un autre disparaîtrait. C'est la convention posée en 4E-4A.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          email: true,
          role: true,
          createdAt: true,
          deletedAt: true,
        },
      }),
    ]);

    return { items, page, limit, total };
  }

  /**
   * Désactive logiquement le compte d'un usager (étape 6-4).
   *
   * ═══ QUI DÉCIDE, QUI EXÉCUTE ═══
   *
   * Cette méthode porte les RÈGLES de l'administration ; l'écriture elle-même
   * revient à `UsersService.softDeleteAccount`, seule implémentation de la
   * suppression logique depuis l'étape 5G. La dupliquer ici créerait deux
   * vérités à maintenir.
   *
   * ═══ TROIS DÉCISIONS, ET CHACUNE A SA RAISON ═══
   *
   * 1. UN ADMINISTRATEUR NE PEUT PAS SE SUPPRIMER LUI-MÊME.
   *
   *    Vérifié EN PREMIER, avant même de consulter la base : c'est le cas le
   *    moins cher à détecter, et le message le plus précis à rendre.
   *
   *    `BadRequestException` (400) et non `ForbiddenException` (403), et la
   *    nuance suit la convention du projet : 403 signifie « vous n'avez pas
   *    ce droit » — or l'administrateur A BIEN le droit de supprimer des
   *    comptes. C'est la CIBLE qui est invalide, donc une règle métier sur
   *    l'entrée : 400, comme le refus de promouvoir un compte supprimé
   *    (étape 6-2).
   *
   *    Sans cette règle, le dernier administrateur pourrait se retirer d'un
   *    clic et laisser l'application sans back-office — il faudrait alors
   *    repasser par la ligne de commande de l'étape 6-2.
   *
   * 2. UN COMPTE INEXISTANT LÈVE 404.
   *
   *    C'est un ÉCART ASSUMÉ avec `DELETE /users/me`, qui reste
   *    silencieusement idempotent. Là-bas, distinguer « inexistant » de
   *    « supprimé » apprendrait à un attaquant qu'un compte a existé. Ici,
   *    l'appelant est un administrateur : il peut déjà lister tous les
   *    comptes (`GET /api/admin/users`), donc l'argument de la fuite ne tient
   *    plus — et il a besoin de savoir que son identifiant était faux, plutôt
   *    que de croire avoir agi.
   *
   * 3. UN COMPTE DÉJÀ SUPPRIMÉ RÉUSSIT, SANS RIEN REDATER.
   *
   *    L'idempotence vient du filtre `deletedAt: null` de
   *    `softDeleteAccount` : la date initiale est la seule trace de QUAND le
   *    droit a été exercé, et la réécrire la perdrait. Le résultat attendu —
   *    « ce compte est désactivé » — est vrai dans les deux cas.
   *
   * ═══ CE QU'ELLE NE FAIT PAS ═══
   *
   * Aucune règle particulière pour un compte ADMINISTRATEUR. Le dossier n'en
   * définit aucune, et en inventer une — « un administrateur en protège un
   * autre » — trancherait une question d'organisation qui ne nous appartient
   * pas. Un administrateur peut donc en désactiver un autre, mais jamais
   * lui-même.
   */
  async deleteUser(idCible: string, idAppelant: string): Promise<void> {
    if (idCible === idAppelant) {
      throw new BadRequestException(
        'Vous ne pouvez pas supprimer votre propre compte depuis cette interface.',
      );
    }

    const cible = await this.prisma.user.findUnique({
      where: { id: idCible },
      // Une seule colonne : on vérifie une existence, on ne lit pas un
      // profil — et surtout jamais `passwordHash`.
      select: { id: true },
    });

    if (!cible) {
      throw new NotFoundException(`Utilisateur ${idCible} introuvable`);
    }

    await this.usersService.softDeleteAccount(idCible);
  }
}
