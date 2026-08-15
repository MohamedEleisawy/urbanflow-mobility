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
    stop: { findMany: jest.Mock };
    segment: { findMany: jest.Mock };
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
      stop: { findMany: jest.fn() },
      segment: { findMany: jest.fn() },
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

  // ---------------------------------------------------------------------------
  // Recherche d'itinéraire (étape 4C-1)
  // ---------------------------------------------------------------------------
  describe('searchRoutes', () => {
    // Petit réseau de test :
    //
    //        A ──WALK 600 m / 10 min──> B ──BUS 3200 m / 10 min──> C
    //        └──────────── BUS 3000 m / 30 min ───────────────────>┘
    //        D (isolé, aucun segment)
    //
    // Donc : le plus RAPIDE = A→B→C (20 min, 3800 m)
    //        le plus COURT  = A→C   (30 min, 3000 m)
    const A = {
      id: 'stop-a',
      name: 'Gare du Nord',
      latitude: 48.8809,
      longitude: 2.3553,
      pmrAccessible: true,
      operatorCode: 'RATP',
    };
    const B = {
      id: 'stop-b',
      name: 'Magenta',
      latitude: 48.877,
      longitude: 2.359,
      pmrAccessible: false,
      operatorCode: 'RATP',
    };
    const C = {
      id: 'stop-c',
      name: 'Chatelet',
      latitude: 48.8583,
      longitude: 2.347,
      pmrAccessible: true,
      operatorCode: 'RATP',
    };
    const D = {
      id: 'stop-d',
      name: 'Arret isole',
      latitude: 48.95,
      longitude: 2.45,
      pmrAccessible: false,
      operatorCode: 'RATP',
    };

    // Fabrique un segment en exprimant sa durée en minutes.
    const segment = (
      fromStopId: string,
      toStopId: string,
      mode: 'WALK' | 'BUS',
      distanceM: number,
      durationMin: number,
    ) => ({
      fromStopId,
      toStopId,
      mode,
      distanceM,
      departureTime: new Date('2026-08-15T08:00:00.000Z'),
      arrivalTime: new Date(
        new Date('2026-08-15T08:00:00.000Z').getTime() + durationMin * 60_000,
      ),
    });

    const aVersB = segment(A.id, B.id, 'WALK', 600, 10);
    const bVersC = segment(B.id, C.id, 'BUS', 3200, 10);
    const aVersC = segment(A.id, C.id, 'BUS', 3000, 30);

    // Coordonnées de recherche : volontairement décalées de quelques mètres
    // pour prouver que le service retrouve bien l'arrêt LE PLUS PROCHE.
    const depuisA = { fromLat: 48.8807, fromLon: 2.3551 };
    const versC = { toLat: 48.8585, toLon: 2.3472 };

    it('renvoie un itinéraire direct quand un seul segment relie les deux arrêts', async () => {
      prisma.stop.findMany.mockResolvedValue([A, C]);
      prisma.segment.findMany.mockResolvedValue([aVersC]);

      const result = await service.searchRoutes({ ...depuisA, ...versC });

      // Le plus rapide et le plus court sont ici le même trajet : on ne le
      // renvoie qu'une fois.
      expect(result).toHaveLength(1);
      expect(result[0].segments).toHaveLength(1);
      expect(result[0].segments[0]).toMatchObject({
        fromStopId: A.id,
        fromStopName: 'Gare du Nord',
        toStopId: C.id,
        toStopName: 'Chatelet',
        mode: 'BUS',
        distanceM: 3000,
        durationMin: 30,
      });
      expect(result[0].totalDistanceM).toBe(3000);
      expect(result[0].totalDurationMin).toBe(30);
    });

    it('enchaîne deux segments quand il n’existe pas de liaison directe', async () => {
      prisma.stop.findMany.mockResolvedValue([A, B, C]);
      prisma.segment.findMany.mockResolvedValue([aVersB, bVersC]);

      const result = await service.searchRoutes({ ...depuisA, ...versC });

      expect(result).toHaveLength(1);
      expect(result[0].segments).toHaveLength(2);
      expect(result[0].segments.map((s) => s.toStopName)).toEqual([
        'Magenta',
        'Chatelet',
      ]);
      // Les totaux sont bien la somme des segments.
      expect(result[0].totalDistanceM).toBe(3800);
      expect(result[0].totalDurationMin).toBe(20);
    });

    it('propose deux itinéraires distincts : le plus rapide et le plus court', async () => {
      prisma.stop.findMany.mockResolvedValue([A, B, C]);
      prisma.segment.findMany.mockResolvedValue([aVersB, bVersC, aVersC]);

      const result = await service.searchRoutes({ ...depuisA, ...versC });

      expect(result).toHaveLength(2);

      const rapide = result.find((i) => i.criterion === 'FASTEST');
      const court = result.find((i) => i.criterion === 'SHORTEST');

      // Le plus rapide passe par B : 20 min au lieu de 30.
      expect(rapide?.totalDurationMin).toBe(20);
      expect(rapide?.totalDistanceM).toBe(3800);
      expect(rapide?.segments).toHaveLength(2);

      // Le plus court est le trajet direct : 3000 m au lieu de 3800.
      expect(court?.totalDistanceM).toBe(3000);
      expect(court?.totalDurationMin).toBe(30);
      expect(court?.segments).toHaveLength(1);
    });

    it("renvoie [] quand l'arrivée n'est reliée à rien", async () => {
      prisma.stop.findMany.mockResolvedValue([A, B, C, D]);
      prisma.segment.findMany.mockResolvedValue([aVersB, bVersC]);

      // On cherche vers D, qui n'a aucun segment entrant.
      const result = await service.searchRoutes({
        ...depuisA,
        toLat: D.latitude,
        toLon: D.longitude,
      });

      expect(result).toEqual([]);
    });

    it('renvoie [] quand la base ne contient aucun arrêt', async () => {
      prisma.stop.findMany.mockResolvedValue([]);
      prisma.segment.findMany.mockResolvedValue([]);

      const result = await service.searchRoutes({ ...depuisA, ...versC });

      expect(result).toEqual([]);
    });

    it('renvoie [] quand le départ et l’arrivée pointent vers le même arrêt', async () => {
      prisma.stop.findMany.mockResolvedValue([A, C]);
      prisma.segment.findMany.mockResolvedValue([aVersC]);

      const result = await service.searchRoutes({
        fromLat: A.latitude,
        fromLon: A.longitude,
        toLat: A.latitude,
        toLon: A.longitude,
      });

      expect(result).toEqual([]);
    });

    it('ne renvoie jamais de données personnelles (ni routeId, ni userId, ni horaires)', async () => {
      prisma.stop.findMany.mockResolvedValue([A, C]);
      prisma.segment.findMany.mockResolvedValue([aVersC]);

      const result = await service.searchRoutes({ ...depuisA, ...versC });

      const json = JSON.stringify(result);
      expect(json).not.toContain('routeId');
      expect(json).not.toContain('userId');
      expect(json).not.toContain('departureTime');
      expect(json).not.toContain('arrivalTime');
    });
  });
});
