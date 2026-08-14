import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthenticatedRequest, JwtPayload } from './jwt-payload.type';

// Décorateur de paramètre : permet d'écrire dans un controller
//
//   findMe(@CurrentUser() user: JwtPayload) { ... }
//
// au lieu de manipuler directement l'objet Request d'Express. Le controller
// reste ainsi lisible et ne dépend pas des détails du transport HTTP.
//
// Il lit la propriété "user" que JwtAuthGuard a attachée à la requête après
// avoir validé le token : il ne fonctionne donc que sur une route protégée
// par ce guard.
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): JwtPayload => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!request.user) {
      // Ne devrait jamais arriver : ce serait un oubli de @UseGuards().
      // On préfère une erreur explicite à un "undefined" silencieux qui
      // provoquerait un bug difficile à diagnostiquer plus loin.
      throw new UnauthorizedException('Utilisateur non authentifié');
    }

    return request.user;
  },
);
