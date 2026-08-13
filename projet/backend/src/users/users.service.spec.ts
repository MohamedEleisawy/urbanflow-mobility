import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

// PrismaService n'est pas une vraie base de données ici : on simule
// uniquement les deux méthodes utilisées par UsersService (user.create et
// user.findUnique). C'est un test unitaire, pas un test d'intégration.
describe('UsersService', () => {
  let service: UsersService;
  let prisma: { user: { create: jest.Mock; findUnique: jest.Mock } };

  beforeEach(() => {
    prisma = {
      user: {
        create: jest.fn(),
        findUnique: jest.fn(),
      },
    };
    service = new UsersService(prisma as unknown as PrismaService);
  });

  describe('create', () => {
    it('crée un utilisateur et ne renvoie jamais passwordHash', async () => {
      prisma.user.create.mockResolvedValue({
        id: 'user-1',
        email: 'lena@example.com',
        passwordHash: 'sel:hash',
        role: 'USER',
        createdAt: new Date(),
        deletedAt: null,
        preferences: null,
      });

      const result = await service.create({
        email: 'lena@example.com',
        password: 'motdepasse123',
      });

      expect(result).not.toHaveProperty('passwordHash');
      expect(result.email).toBe('lena@example.com');
    });

    it('transforme une violation de contrainte unique (email) en ConflictException', async () => {
      prisma.user.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '6.19.3',
        }),
      );

      await expect(
        service.create({ email: 'lena@example.com', password: 'motdepasse123' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findById', () => {
    it("lève NotFoundException si l'utilisateur n'existe pas", async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.findById('id-inexistant')).rejects.toThrow(NotFoundException);
    });

    it('renvoie un utilisateur sans passwordHash quand il existe', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'lena@example.com',
        passwordHash: 'sel:hash',
        role: 'USER',
        createdAt: new Date(),
        deletedAt: null,
        preferences: null,
      });

      const result = await service.findById('user-1');

      expect(result).not.toHaveProperty('passwordHash');
      expect(result.id).toBe('user-1');
    });
  });
});
