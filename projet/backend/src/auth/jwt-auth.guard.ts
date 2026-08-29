import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedRequest, JwtPayload } from './jwt-payload.type';

// Un "Guard" NestJS s'exécute AVANT la méthode du controller. S'il renvoie
// true, la requête continue ; s'il lève une exception, le controller n'est
// jamais appelé. C'est le mécanisme standard de NestJS pour protéger une
// route.
//
// Ce guard vérifie qu'une requête possède bien un JWT valide, signé par
// notre serveur et non expiré — ET que le compte qu'il désigne existe
// toujours (étape 5G).
//
// ═══ POURQUOI LE CONTRÔLE DE SUPPRESSION VIT ICI, ET NULLE PART AILLEURS ═══
//
// Un JWT est AUTOPORTANT : une fois émis, il reste cryptographiquement valide
// jusqu'à son expiration, une heure plus tard. Supprimer un compte ne le rend
// donc pas magiquement inopérant.
//
// L'autre stratégie envisagée — « les endpoints finiront bien par consulter
// l'usager » — a été écartée après vérification du code RÉEL, et elle est
// fausse :
//
//   RoutesService              ne lit JAMAIS `User`
//   CarbonTrackingService      ne lit JAMAIS `User`
//   updatePreferences          écrit dans `UserPreferences` sans lire `User`
//
// Un compte supprimé aurait donc gardé, pendant une heure, le droit de
// modifier ses préférences, d'enregistrer des trajets et d'en supprimer.
//
// Une seule vérification ici couvre les dix routes protégées, sans recopier
// `deletedAt IS NULL` dans dix services — où l'oubli d'un seul rouvrirait le
// trou.
//
// COÛT : une requête par requête authentifiée. C'est un `findUnique` sur la
// clé primaire ne ramenant qu'une colonne — une lecture d'index. Le prix est
// réel mais modeste, et il achète une propriété que rien d'autre ne donne :
// une suppression prend effet IMMÉDIATEMENT, sans liste de révocation ni
// Redis.
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

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

      // Le jeton est authentique — reste à savoir si le compte l'est encore.
      await this.verifierCompteActif(payload.sub);

      // On attache le payload à la requête pour que le controller puisse le
      // lire ensuite via le décorateur @CurrentUser().
      request.user = payload;
      return true;
    } catch (erreur) {
      // Une UnauthorizedException levée par `verifierCompteActif` doit
      // traverser telle quelle : la réécrire en « Token invalide ou expiré »
      // serait inexact, et masquerait la vraie raison dans les journaux.
      if (erreur instanceof UnauthorizedException) {
        throw erreur;
      }
      // Même réponse pour un token mal formé, falsifié ou expiré : on ne
      // donne aucune indication exploitable à un attaquant.
      throw new UnauthorizedException('Token invalide ou expiré');
    }
  }

  /**
   * Refuse un jeton dont le compte a été supprimé ou n'existe plus.
   *
   * MÊME MESSAGE que pour un jeton invalide, et c'est délibéré : distinguer
   * « ce compte a été supprimé » de « ce jeton est invalide » apprendrait à
   * un attaquant qu'un compte a existé. Le principe est le même qu'au login,
   * où un email inconnu et un mot de passe faux donnent la même réponse.
   *
   * `select: { deletedAt: true }` : on ne charge pas l'usager entier à chaque
   * requête pour lire un seul champ — et surtout jamais `passwordHash`.
   */
  private async verifierCompteActif(userId: string): Promise<void> {
    const compte = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { deletedAt: true },
    });

    if (!compte || compte.deletedAt !== null) {
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
