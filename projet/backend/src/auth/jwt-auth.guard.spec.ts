import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthenticatedRequest } from './jwt-payload.type';

// On utilise un VRAI JwtService (avec un secret de test) plutôt qu'un mock :
// on vérifie ainsi le comportement réel de la signature et de l'expiration,
// ce qu'un mock ne prouverait pas.
const jwtService = new JwtService({ secret: 'secret-de-test-uniquement' });

// Fabrique une fausse requête Express avec l'en-tête demandé.
function fakeRequest(authorization?: string): AuthenticatedRequest {
  return { headers: { authorization } } as AuthenticatedRequest;
}

// Fabrique un faux ExecutionContext HTTP autour de cette requête.
// Le guard n'utilise que switchToHttp().getRequest() : inutile de simuler
// le reste du contexte NestJS.
function fakeContext(request: AuthenticatedRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;

  const validPayload = {
    sub: 'user-1',
    email: 'lena@example.com',
    role: 'USER',
  };

  beforeEach(() => {
    guard = new JwtAuthGuard(jwtService);
  });

  it('laisse passer une requête avec un token valide', async () => {
    const token = jwtService.sign(validPayload);

    await expect(
      guard.canActivate(fakeContext(fakeRequest(`Bearer ${token}`))),
    ).resolves.toBe(true);
  });

  it('attache le payload du token à la requête', async () => {
    const token = jwtService.sign(validPayload);
    const request = fakeRequest(`Bearer ${token}`);

    await guard.canActivate(fakeContext(request));

    expect(request.user).toMatchObject(validPayload);
  });

  it('rejette une requête sans en-tête Authorization (401)', async () => {
    await expect(
      guard.canActivate(fakeContext(fakeRequest(undefined))),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejette un en-tête sans le schéma Bearer (401)', async () => {
    // Schéma "Basic" au lieu de "Bearer" : refusé même si le token est
    // parfaitement valide par ailleurs.
    const token = jwtService.sign(validPayload);

    await expect(
      guard.canActivate(fakeContext(fakeRequest(`Basic ${token}`))),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejette un token invalide / mal formé (401)', async () => {
    await expect(
      guard.canActivate(
        fakeContext(fakeRequest('Bearer ceci-nest-pas-un-jwt')),
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejette un token signé avec un autre secret (401)', async () => {
    // Simule un attaquant qui forge son propre token en se donnant le rôle
    // ADMIN : sans notre JWT_SECRET, la signature ne correspond pas.
    const attaquant = new JwtService({ secret: 'secret-d-un-attaquant' });
    const token = attaquant.sign({ ...validPayload, role: 'ADMIN' });

    await expect(
      guard.canActivate(fakeContext(fakeRequest(`Bearer ${token}`))),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejette un token expiré (401)', async () => {
    // expiresIn négatif = token déjà expiré au moment de sa création.
    const token = jwtService.sign(validPayload, { expiresIn: '-1s' });

    await expect(
      guard.canActivate(fakeContext(fakeRequest(`Bearer ${token}`))),
    ).rejects.toThrow(UnauthorizedException);
  });
});
