import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { hashPassword } from '../common/crypto/password.util';

// Comme pour UsersService : PrismaService est simulé, seule la méthode
// utilisée par AuthService (user.findUnique) est mockée. JwtService reste le
// vrai service de @nestjs/jwt, avec un secret de test, pour vérifier un
// vrai comportement de signature plutôt qu'un mock qui ne prouverait rien.
describe('AuthService', () => {
  let service: AuthService;
  let prisma: { user: { findUnique: jest.Mock } };
  const jwtService = new JwtService({ secret: 'secret-de-test-uniquement' });

  const existingUser = {
    id: 'user-1',
    email: 'lena@example.com',
    passwordHash: hashPassword('motdepasse123'),
    role: 'USER',
    createdAt: new Date(),
    deletedAt: null,
  };

  beforeEach(() => {
    prisma = { user: { findUnique: jest.fn() } };
    service = new AuthService(prisma as unknown as PrismaService, jwtService);
  });

  it('connecte un utilisateur avec les bons identifiants et renvoie un accessToken', async () => {
    prisma.user.findUnique.mockResolvedValue(existingUser);

    const result = await service.login({
      email: 'lena@example.com',
      password: 'motdepasse123',
    });

    expect(result.accessToken).toEqual(expect.any(String));
    expect(result.user).toEqual({
      id: 'user-1',
      email: 'lena@example.com',
      role: 'USER',
    });
  });

  it('ne renvoie jamais passwordHash dans la réponse', async () => {
    prisma.user.findUnique.mockResolvedValue(existingUser);

    const result = await service.login({
      email: 'lena@example.com',
      password: 'motdepasse123',
    });

    expect(result.user).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(result)).not.toContain(existingUser.passwordHash);
  });

  it("rejette avec 401 si l'utilisateur n'existe pas", async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.login({ email: 'inconnu@example.com', password: 'peu-importe' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejette avec 401 si le mot de passe est incorrect', async () => {
    prisma.user.findUnique.mockResolvedValue(existingUser);

    await expect(
      service.login({
        email: 'lena@example.com',
        password: 'mauvais-mot-de-passe',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });
});
