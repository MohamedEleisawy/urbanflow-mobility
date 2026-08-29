import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
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
  let prisma: { user: { findUnique: jest.Mock } };

  const validPayload = {
    sub: 'user-1',
    email: 'lena@example.com',
    role: 'USER',
  };

  beforeEach(() => {
    // Le guard consulte la base depuis l'étape 5G : un jeton authentique ne
    // suffit plus, encore faut-il que le compte existe toujours.
    prisma = { user: { findUnique: jest.fn() } };
    // Par défaut, un compte actif — les tests antérieurs vérifient la
    // signature et l'expiration, pas le cycle de vie du compte.
    prisma.user.findUnique.mockResolvedValue({ deletedAt: null });

    guard = new JwtAuthGuard(jwtService, prisma as unknown as PrismaService);
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

  // ---------------------------------------------------------------------------
  // Compte supprimé (étape 5G)
  // ---------------------------------------------------------------------------
  describe('compte supprimé', () => {
    const jetonValide = () => `Bearer ${jwtService.sign(validPayload)}`;

    it('REFUSE un jeton dont le compte a été supprimé', async () => {
      prisma.user.findUnique.mockResolvedValue({ deletedAt: new Date() });

      await expect(
        guard.canActivate(fakeContext(fakeRequest(jetonValide()))),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("REFUSE un jeton dont le compte n'existe plus", async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        guard.canActivate(fakeContext(fakeRequest(jetonValide()))),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('ne RÉVÈLE PAS que le compte a été supprimé', async () => {
      prisma.user.findUnique.mockResolvedValue({ deletedAt: new Date() });

      const echec = await guard
        .canActivate(fakeContext(fakeRequest(jetonValide())))
        .catch((e: unknown) => e);

      // Même message que pour un jeton falsifié : distinguer les deux
      // apprendrait à un attaquant qu'un compte a existé.
      expect((echec as UnauthorizedException).message).toBe(
        'Token invalide ou expiré',
      );
    });

    it("interroge la base sur le `sub` DU JETON, et rien d'autre", async () => {
      await guard.canActivate(fakeContext(fakeRequest(jetonValide())));

      // Le tableau d'appels est typé AVANT d'être indexé : `mock.calls` est
      // `any`, et l'indexer directement laisserait passer une faute de frappe
      // dans un nom de champ.
      const appels = prisma.user.findUnique.mock.calls as {
        where: { id: string };
        select: Record<string, boolean>;
      }[][];
      const appel = appels[0][0];
      expect(appel.where).toEqual({ id: 'user-1' });
      // Une seule colonne : on ne charge pas l'usager entier — et surtout
      // jamais `passwordHash` — à chaque requête authentifiée.
      expect(appel.select).toEqual({ deletedAt: true });
    });

    it("N'INTERROGE PAS la base si le jeton est déjà invalide", async () => {
      await expect(
        guard.canActivate(fakeContext(fakeRequest('Bearer pas-un-jeton'))),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      // La signature se vérifie sans réseau ni base : inutile de payer une
      // requête pour un jeton falsifié.
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
  });
});
