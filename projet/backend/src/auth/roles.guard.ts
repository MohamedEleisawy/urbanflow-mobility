import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleEnum } from '@prisma/client';
import { CLE_ROLES } from './roles.decorator';
import { AuthenticatedRequest } from './jwt-payload.type';

// Guard de rôle (étape 6-1).
//
// ═══ IL NE REMPLACE PAS JwtAuthGuard, IL LE COMPLÈTE ═══
//
// Ce guard ne vérifie AUCUNE signature et ne touche PAS à la base : il lit le
// rôle d'un jeton que `JwtAuthGuard` a déjà validé, et qu'il a déposé sur la
// requête. Refaire ici la vérification cryptographique la ferait exécuter deux
// fois par requête, pour un résultat identique.
//
// L'ORDRE COMPTE :
//
//     @UseGuards(JwtAuthGuard, RolesGuard)
//
// NestJS les exécute de gauche à droite. Inversés, `RolesGuard` s'exécuterait
// avant que `request.user` n'existe — et répondrait 401 là où 403 était juste,
// ou pire, laisserait passer si on avait choisi de ne rien faire sans usager.
//
// ═══ 401 ET 403 NE DISENT PAS LA MÊME CHOSE ═══
//
//   401 « je ne sais pas qui vous êtes »   → JwtAuthGuard, jeton absent/invalide
//   403 « je sais qui vous êtes, et non »  → RolesGuard, rôle insuffisant
//
// Les confondre priverait le client de l'information qui lui dit quoi faire :
// se reconnecter (401) n'a aucun sens face à un 403.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // `getAllAndOverride` regarde la MÉTHODE d'abord, puis la CLASSE : un
    // `@Roles` posé sur une route l'emporte sur celui du contrôleur entier.
    // C'est ce qui permettra un jour d'ouvrir une seule route d'un contrôleur
    // par ailleurs réservé aux administrateurs.
    const requis = this.reflector.getAllAndOverride<RoleEnum[] | undefined>(
      CLE_ROLES,
      [context.getHandler(), context.getClass()],
    );

    // AUCUNE EXIGENCE DÉCLARÉE → ON NE FAIT RIEN. Ce guard n'est pas une
    // autorisation par défaut : une route sans `@Roles` garde exactement le
    // comportement qu'elle avait avant l'étape 6-1. C'est ce qui rend son
    // ajout sûr sur un contrôleur existant.
    if (!requis || requis.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (!user) {
      // Ne devrait jamais arriver : ce serait un `RolesGuard` employé sans
      // `JwtAuthGuard`, ou placé avant lui. On refuse en 401 plutôt qu'en 403
      // — sans jeton validé, on ne sait pas QUI demande, donc on ne peut pas
      // dire que c'est interdit à cette personne-là.
      throw new UnauthorizedException('Token manquant');
    }

    // `user.role` est typé `string` dans le JWT (il traverse une
    // sérialisation JSON, qui ne connaît pas les énumérations). La
    // comparaison porte donc sur la valeur, qui est bien celle de `RoleEnum`
    // écrite par `AuthService.login`.
    if (!requis.includes(user.role as RoleEnum)) {
      throw new ForbiddenException(
        'Cette action est réservée aux administrateurs.',
      );
    }

    return true;
  }
}
