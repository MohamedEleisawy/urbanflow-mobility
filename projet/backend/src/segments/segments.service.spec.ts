import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ModeTransport } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RoutesService } from '../routes/routes.service';
import { SegmentsService } from './segments.service';
import { CreateSegmentDto } from './dto/create-segment.dto';

describe('SegmentsService', () => {
  let service: SegmentsService;
  let prisma: {
    segment: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock };
  };
  // RoutesService est simulé : on teste ici que SegmentsService l'appelle
  // bien pour vérifier la propriété, pas le contenu de cette vérification
  // (déjà couvert par routes.service.spec.ts).
  let routesService: { findOneForUser: jest.Mock };

  const MOI = 'user-1';
  const MA_ROUTE = 'route-1';

  const dto: CreateSegmentDto = {
    mode: ModeTransport.BUS,
    operator: 'RATP',
    departureTime: new Date('2026-08-15T08:00:00.000Z'),
    arrivalTime: new Date('2026-08-15T08:20:00.000Z'),
    distanceM: 3200,
    line: 'Bus 12',
    gtfsTripId: 'trip-12-a',
    fromStopId: 'stop-1',
    toStopId: 'stop-2',
  };

  const segment = { id: 'segment-1', ...dto, routeId: MA_ROUTE };

  beforeEach(() => {
    prisma = {
      segment: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
    };
    routesService = { findOneForUser: jest.fn() };
    service = new SegmentsService(
      prisma as unknown as PrismaService,
      routesService as unknown as RoutesService,
    );
  });

  describe('create', () => {
    it("crée un segment rattaché à la route quand elle appartient à l'usager", async () => {
      routesService.findOneForUser.mockResolvedValue({ id: MA_ROUTE });
      prisma.segment.create.mockResolvedValue(segment);

      const result = await service.create(MA_ROUTE, MOI, dto);

      // La propriété de la route est bien vérifiée avant toute écriture.
      expect(routesService.findOneForUser).toHaveBeenCalledWith(MA_ROUTE, MOI);
      // Le segment est rattaché à la BONNE route (celle de l'URL).
      expect(prisma.segment.create).toHaveBeenCalledWith({
        data: { ...dto, routeId: MA_ROUTE },
      });
      expect(result).toEqual(segment);
    });

    it("refuse (404) et n'écrit rien si la route appartient à un autre usager", async () => {
      // findOneForUser lève 404 quand la route n'est pas à moi (étape 4A).
      routesService.findOneForUser.mockRejectedValue(new NotFoundException());

      await expect(service.create(MA_ROUTE, MOI, dto)).rejects.toThrow(
        NotFoundException,
      );
      // Le point essentiel : aucun segment n'a été créé.
      expect(prisma.segment.create).not.toHaveBeenCalled();
    });

    it("refuse (400) si l'heure d'arrivée précède l'heure de départ", async () => {
      routesService.findOneForUser.mockResolvedValue({ id: MA_ROUTE });

      const invalide = {
        ...dto,
        departureTime: new Date('2026-08-15T09:00:00.000Z'),
        arrivalTime: new Date('2026-08-15T08:00:00.000Z'),
      };

      await expect(service.create(MA_ROUTE, MOI, invalide)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.segment.create).not.toHaveBeenCalled();
    });
  });

  describe('findAllForRoute', () => {
    it("renvoie les segments de la route dans l'ordre chronologique", async () => {
      routesService.findOneForUser.mockResolvedValue({ id: MA_ROUTE });
      prisma.segment.findMany.mockResolvedValue([segment]);

      const result = await service.findAllForRoute(MA_ROUTE, MOI);

      expect(routesService.findOneForUser).toHaveBeenCalledWith(MA_ROUTE, MOI);
      expect(prisma.segment.findMany).toHaveBeenCalledWith({
        where: { routeId: MA_ROUTE },
        orderBy: { departureTime: 'asc' },
        include: { fromStop: true, toStop: true },
      });
      expect(result).toEqual([segment]);
    });

    it("refuse (404) la liste des segments d'une route d'un autre usager", async () => {
      routesService.findOneForUser.mockRejectedValue(new NotFoundException());

      await expect(service.findAllForRoute(MA_ROUTE, MOI)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.segment.findMany).not.toHaveBeenCalled();
    });
  });

  describe('findOneForRoute', () => {
    it('renvoie le segment quand il appartient bien à cette route', async () => {
      routesService.findOneForUser.mockResolvedValue({ id: MA_ROUTE });
      prisma.segment.findUnique.mockResolvedValue(segment);

      await expect(
        service.findOneForRoute(MA_ROUTE, 'segment-1', MOI),
      ).resolves.toEqual(segment);
    });

    it('lève 404 si le segment appartient à une AUTRE route', async () => {
      routesService.findOneForUser.mockResolvedValue({ id: MA_ROUTE });
      // Le segment existe, mais il fait partie d'un autre itinéraire.
      prisma.segment.findUnique.mockResolvedValue({
        ...segment,
        routeId: 'une-autre-route',
      });

      await expect(
        service.findOneForRoute(MA_ROUTE, 'segment-1', MOI),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
