import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RoutesService } from './routes.service';
import { CreateRouteDto } from './dto/create-route.dto';

// Même approche que pour UsersService : PrismaService est simulé, seules
// les méthodes réellement utilisées sont mockées. Ce sont des tests
// unitaires, pas des tests d'intégration.
describe('RoutesService', () => {
  let service: RoutesService;
  let prisma: {
    route: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      delete: jest.Mock;
    };
  };

  const MOI = 'user-1';
  const QUELQU_UN_DAUTRE = 'user-2';

  const dto: CreateRouteDto = {
    originLat: 48.8566,
    originLng: 2.3522,
    destinationLat: 48.8738,
    destinationLng: 2.295,
    totalDurationMin: 25,
    totalDistanceM: 5400,
    ecoScore: 82,
    carbonEstimate: 610,
  };

  const maRoute = { id: 'route-1', ...dto, userId: MOI };

  beforeEach(() => {
    prisma = {
      route: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
    };
    service = new RoutesService(prisma as unknown as PrismaService);
  });

  describe('create', () => {
    it("enregistre l'itinéraire en l'attachant à l'usager du JWT", async () => {
      prisma.route.create.mockResolvedValue(maRoute);

      const result = await service.create(MOI, dto);

      // Le userId envoyé à Prisma doit être celui passé par le controller
      // (issu du token), pas une valeur venue du corps de la requête.
      expect(prisma.route.create).toHaveBeenCalledWith({
        data: { ...dto, userId: MOI },
      });
      expect(result).toEqual(maRoute);
    });
  });

  describe('findAllForUser', () => {
    it("ne demande à Prisma que les itinéraires de l'usager", async () => {
      prisma.route.findMany.mockResolvedValue([maRoute]);

      const result = await service.findAllForUser(MOI);

      expect(prisma.route.findMany).toHaveBeenCalledWith({
        where: { userId: MOI },
        orderBy: { requestedAt: 'desc' },
      });
      expect(result).toEqual([maRoute]);
    });
  });

  describe('findOneForUser', () => {
    it("renvoie l'itinéraire quand il appartient à l'usager", async () => {
      prisma.route.findUnique.mockResolvedValue(maRoute);

      await expect(service.findOneForUser('route-1', MOI)).resolves.toEqual(
        maRoute,
      );
    });

    it("lève 404 quand l'itinéraire n'existe pas", async () => {
      prisma.route.findUnique.mockResolvedValue(null);

      await expect(
        service.findOneForUser('route-inexistante', MOI),
      ).rejects.toThrow(NotFoundException);
    });

    it("lève 404 (et non 403) quand l'itinéraire appartient à un autre usager", async () => {
      // L'itinéraire existe bel et bien en base, mais pas pour moi :
      // on ne doit pas révéler son existence.
      prisma.route.findUnique.mockResolvedValue({
        ...maRoute,
        userId: QUELQU_UN_DAUTRE,
      });

      await expect(service.findOneForUser('route-1', MOI)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it("supprime l'itinéraire quand il appartient à l'usager", async () => {
      prisma.route.findUnique.mockResolvedValue(maRoute);
      prisma.route.delete.mockResolvedValue(maRoute);

      await service.remove('route-1', MOI);

      expect(prisma.route.delete).toHaveBeenCalledWith({
        where: { id: 'route-1' },
      });
    });

    it("lève 404 et NE SUPPRIME RIEN si l'itinéraire appartient à un autre usager", async () => {
      prisma.route.findUnique.mockResolvedValue({
        ...maRoute,
        userId: QUELQU_UN_DAUTRE,
      });

      await expect(service.remove('route-1', MOI)).rejects.toThrow(
        NotFoundException,
      );
      // Le point le plus important de ce test : aucun DELETE n'a été envoyé.
      expect(prisma.route.delete).not.toHaveBeenCalled();
    });
  });
});
