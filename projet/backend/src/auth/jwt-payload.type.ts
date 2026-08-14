import type { Request } from 'express';

// Contenu exact du JWT généré par AuthService.login().
// Ce type est le "contrat" entre trois fichiers :
//   - auth.service.ts   l'écrit  (jwtService.sign)
//   - jwt-auth.guard.ts le lit   (jwtService.verifyAsync)
//   - current-user.decorator.ts  l'expose au controller
export interface JwtPayload {
  // "sub" (subject) : convention JWT standard pour l'identifiant de
  // l'utilisateur concerné par le token. Ici, c'est User.id.
  sub: string;
  email: string;
  role: string;
  // Ajoutés automatiquement par la librairie au moment de la signature :
  // iat = date d'émission, exp = date d'expiration (en secondes Unix).
  iat?: number;
  exp?: number;
}

// La requête Express de base n'a pas de propriété "user" : c'est le guard
// qui l'ajoute après avoir validé le token. On la déclare donc ici pour
// éviter d'utiliser "any" dans le guard et le décorateur.
export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}
