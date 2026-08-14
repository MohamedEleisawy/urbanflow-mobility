import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthenticatedRequest, JwtPayload } from './jwt-payload.type';

// Un "Guard" NestJS s'exécute AVANT la méthode du controller. S'il renvoie
// true, la requête continue ; s'il lève une exception, le controller n'est
// jamais appelé. C'est le mécanisme standard de NestJS pour protéger une
// route.
//
// Ce guard vérifie qu'une requête possède bien un JWT valide, signé par
// notre serveur et non expiré.
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // ExecutionContext est générique (HTTP, WebSocket, gRPC...) : on précise
    // ici qu'on est dans un contexte HTTP pour récupérer la requête.
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractBearerToken(request.headers.authorization);

    if (!token) {
      throw new UnauthorizedException('Token manquant');
    }

    try {
      // verifyAsync fait deux vérifications d'un coup :
      //   1. il recalcule la signature avec JWT_SECRET — si le token a été
      //      modifié ne serait-ce que d'un caractère, elle ne correspond plus ;
      //   2. il compare la date d'expiration (exp) à l'heure actuelle.
      // Le secret vient de la configuration de JwtModule (auth.module.ts) :
      // pas besoin de relire process.env ici.
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);

      // On attache le payload à la requête pour que le controller puisse le
      // lire ensuite via le décorateur @CurrentUser().
      request.user = payload;
      return true;
    } catch {
      // Même réponse pour un token mal formé, falsifié ou expiré : on ne
      // donne aucune indication exploitable à un attaquant.
      throw new UnauthorizedException('Token invalide ou expiré');
    }
  }

  // Attend un en-tête au format exact "Authorization: Bearer <token>".
  // Renvoie undefined si l'en-tête est absent ou n'utilise pas ce schéma.
  private extractBearerToken(authorizationHeader?: string): string | undefined {
    const [scheme, token] = authorizationHeader?.split(' ') ?? [];
    return scheme === 'Bearer' ? token : undefined;
  }
}
