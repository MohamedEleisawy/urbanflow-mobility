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
    // networkLink = le réseau public, seule source du graphe depuis 4C-3.
    networkLink: { findMany: jest.Mock };
    // segment reste simulé UNIQUEMENT pour pouvoir prouver, dans les tests
    // d'isolation, que la recherche ne l'interroge JAMAIS.
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
      networkLink: { findMany: jest.fn() },
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

    // Fabrique une liaison du réseau public.
    //   - depuis 4C-3, la durée est une donnée directe (durationMin) ;
    //   - depuis 4C-4-1, le mode est porté par la LIGNE, d'où l'objet
    //     `line` imbriqué qui reproduit ce que renvoie `include: { line }`.
    const segment = (
      fromStopId: string,
      toStopId: string,
      mode: 'WALK' | 'BUS',
      distanceM: number,
      durationMin: number,
      lineId = 'ligne-1',
    ) => ({
      fromStopId,
      toStopId,
      distanceM,
      durationMin,
      lineId,
      line: { id: lineId, name: 'Ligne de test', mode, operator: 'RATP' },
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
      prisma.networkLink.findMany.mockResolvedValue([aVersC]);

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
      prisma.networkLink.findMany.mockResolvedValue([aVersB, bVersC]);

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
      prisma.networkLink.findMany.mockResolvedValue([aVersB, bVersC, aVersC]);

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
      prisma.networkLink.findMany.mockResolvedValue([aVersB, bVersC]);

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
      prisma.networkLink.findMany.mockResolvedValue([]);

      const result = await service.searchRoutes({ ...depuisA, ...versC });

      expect(result).toEqual([]);
    });

    it('renvoie [] quand le départ et l’arrivée pointent vers le même arrêt', async () => {
      prisma.stop.findMany.mockResolvedValue([A, C]);
      prisma.networkLink.findMany.mockResolvedValue([aVersC]);

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
      prisma.networkLink.findMany.mockResolvedValue([aVersC]);

      const result = await service.searchRoutes({ ...depuisA, ...versC });

      const json = JSON.stringify(result);
      expect(json).not.toContain('routeId');
      expect(json).not.toContain('userId');
      expect(json).not.toContain('departureTime');
      expect(json).not.toContain('arrivalTime');
    });

    // -------------------------------------------------------------------------
    // Étape 4C-2 : déterminisme, rayon de recherche, chaînage
    // -------------------------------------------------------------------------

    it('garantit que les segments sont chaînés dans le bon ordre', async () => {
      prisma.stop.findMany.mockResolvedValue([A, B, C]);
      prisma.networkLink.findMany.mockResolvedValue([aVersB, bVersC]);

      const [itineraire] = await service.searchRoutes({
        ...depuisA,
        ...versC,
      });

      // Le premier segment part bien de l'origine...
      expect(itineraire.segments[0].fromStopId).toBe(A.id);
      // ...le dernier arrive bien à la destination...
      expect(itineraire.segments[itineraire.segments.length - 1].toStopId).toBe(
        C.id,
      );
      // ...et chaque segment repart exactement là où le précédent s'arrête.
      for (let i = 0; i < itineraire.segments.length - 1; i++) {
        expect(itineraire.segments[i].toStopId).toBe(
          itineraire.segments[i + 1].fromStopId,
        );
      }
    });

    it('renvoie exactement le même résultat pour deux appels identiques', async () => {
      prisma.stop.findMany.mockResolvedValue([A, B, C]);
      prisma.networkLink.findMany.mockResolvedValue([aVersB, bVersC, aVersC]);

      const premier = await service.searchRoutes({ ...depuisA, ...versC });
      const second = await service.searchRoutes({ ...depuisA, ...versC });

      expect(second).toEqual(premier);
    });

    it("choisit le même chemin même si l'ordre des segments change (départage déterministe)", async () => {
      // Deux chemins de coût STRICTEMENT identique : A→X→C et A→Y→C.
      // Sans règle de départage, le gagnant dépendrait de l'ordre des
      // lignes renvoyées par PostgreSQL. La règle retenue est : à coût
      // égal, l'identifiant le plus petit gagne — donc X ("stop-x").
      const X = { ...B, id: 'stop-x', name: 'Bifurcation X' };
      const Y = { ...B, id: 'stop-y', name: 'Bifurcation Y' };

      const aVersX = segment(A.id, X.id, 'WALK', 500, 5);
      const xVersC = segment(X.id, C.id, 'BUS', 500, 5);
      const aVersY = segment(A.id, Y.id, 'WALK', 500, 5);
      const yVersC = segment(Y.id, C.id, 'BUS', 500, 5);

      prisma.stop.findMany.mockResolvedValue([A, X, Y, C]);
      prisma.networkLink.findMany.mockResolvedValue([
        aVersX,
        xVersC,
        aVersY,
        yVersC,
      ]);
      const ordreNormal = await service.searchRoutes({ ...depuisA, ...versC });

      // Mêmes données, mais fournies dans l'ordre inverse.
      prisma.stop.findMany.mockResolvedValue([C, Y, X, A]);
      prisma.networkLink.findMany.mockResolvedValue([
        yVersC,
        aVersY,
        xVersC,
        aVersX,
      ]);
      const ordreInverse = await service.searchRoutes({ ...depuisA, ...versC });

      expect(ordreInverse).toEqual(ordreNormal);
      // Et c'est bien X qui a été retenu, conformément à la règle.
      expect(ordreNormal[0].segments[0].toStopId).toBe('stop-x');
    });

    it('choisit correctement parmi trois chemins possibles', async () => {
      // A→B→C  : 3800 m / 20 min  → le plus RAPIDE
      // A→C    : 3000 m / 30 min
      // A→E→C  : 2000 m / 50 min  → le plus COURT
      const E = { ...B, id: 'stop-e', name: 'Detour E' };
      const aVersE = segment(A.id, E.id, 'WALK', 1000, 25);
      const eVersC = segment(E.id, C.id, 'WALK', 1000, 25);

      prisma.stop.findMany.mockResolvedValue([A, B, C, E]);
      prisma.networkLink.findMany.mockResolvedValue([
        aVersB,
        bVersC,
        aVersC,
        aVersE,
        eVersC,
      ]);

      const result = await service.searchRoutes({ ...depuisA, ...versC });

      const rapide = result.find((i) => i.criterion === 'FASTEST');
      const court = result.find((i) => i.criterion === 'SHORTEST');

      // Le plus rapide est bien le minimum des trois durées (20 < 30 < 50).
      expect(rapide?.totalDurationMin).toBe(20);
      // Le plus court est bien le minimum des trois distances (2000 < 3000 < 3800).
      expect(court?.totalDistanceM).toBe(2000);
    });

    it('renvoie [] quand le point de départ est trop loin de tout arrêt', async () => {
      prisma.stop.findMany.mockResolvedValue([A, B, C]);
      prisma.networkLink.findMany.mockResolvedValue([aVersB, bVersC]);

      // 0,025° de latitude ≈ 2,8 km : au-delà du rayon de 2 km.
      const result = await service.searchRoutes({
        fromLat: A.latitude + 0.025,
        fromLon: A.longitude,
        ...versC,
      });

      expect(result).toEqual([]);
    });

    it('renvoie [] quand la destination est trop loin de tout arrêt', async () => {
      prisma.stop.findMany.mockResolvedValue([A, B, C]);
      prisma.networkLink.findMany.mockResolvedValue([aVersB, bVersC]);

      const result = await service.searchRoutes({
        ...depuisA,
        toLat: C.latitude + 0.025,
        toLon: C.longitude,
      });

      expect(result).toEqual([]);
    });

    it('accepte un point situé juste à l’intérieur du rayon de recherche', async () => {
      prisma.stop.findMany.mockResolvedValue([A, B, C]);
      prisma.networkLink.findMany.mockResolvedValue([aVersB, bVersC]);

      // 0,013° de latitude ≈ 1,45 km : à l'intérieur du rayon de 2 km.
      const result = await service.searchRoutes({
        fromLat: A.latitude + 0.013,
        fromLon: A.longitude,
        ...versC,
      });

      expect(result).toHaveLength(1);
      expect(result[0].segments[0].fromStopId).toBe(A.id);
    });

    // -------------------------------------------------------------------------
    // Étape 4C-4-1 : le mode vient de la ligne, pas de la liaison
    // -------------------------------------------------------------------------
    describe('lignes de transport (TransitLine)', () => {
      it('demande à Prisma de joindre la ligne à chaque liaison', async () => {
        prisma.stop.findMany.mockResolvedValue([A, C]);
        prisma.networkLink.findMany.mockResolvedValue([aVersC]);

        await service.searchRoutes({ ...depuisA, ...versC });

        // Sans include, le mode serait introuvable : cette requête est la
        // condition même du fonctionnement du graphe.
        expect(prisma.networkLink.findMany).toHaveBeenCalledWith({
          orderBy: { id: 'asc' },
          include: { line: true },
        });
      });

      it('lit le mode de transport depuis la ligne', async () => {
        // La liaison ne porte plus de mode : seule la ligne en a un.
        const liaison = segment(A.id, C.id, 'BUS', 3000, 30, 'ligne-bus-99');
        prisma.stop.findMany.mockResolvedValue([A, C]);
        prisma.networkLink.findMany.mockResolvedValue([liaison]);

        const result = await service.searchRoutes({ ...depuisA, ...versC });

        expect(result[0].segments[0].mode).toBe('BUS');
      });

      it('traite deux lignes différentes reliant les MÊMES arrêts comme deux liaisons distinctes', async () => {
        // Cas très courant dans un vrai réseau : un bus et un métro
        // desservent tous deux A→C. La contrainte unique du schéma porte sur
        // (lineId, fromStopId, toStopId), donc les deux coexistent.
        const parBus = segment(A.id, C.id, 'BUS', 3000, 30, 'ligne-bus');
        const parMarche = segment(A.id, C.id, 'WALK', 2000, 45, 'ligne-marche');

        prisma.stop.findMany.mockResolvedValue([A, C]);
        prisma.networkLink.findMany.mockResolvedValue([parBus, parMarche]);

        const result = await service.searchRoutes({ ...depuisA, ...versC });

        const rapide = result.find((i) => i.criterion === 'FASTEST');
        const court = result.find((i) => i.criterion === 'SHORTEST');

        // Le plus rapide est le bus (30 min), le plus court la marche (2000 m) :
        // les deux liaisons ont donc bien été prises en compte séparément.
        expect(rapide?.totalDurationMin).toBe(30);
        expect(rapide?.segments[0].mode).toBe('BUS');
        expect(court?.totalDistanceM).toBe(2000);
        expect(court?.segments[0].mode).toBe('WALK');
      });
    });

    // -------------------------------------------------------------------------
    // Étape 4C-3 : isolation entre réseau public et données personnelles
    // -------------------------------------------------------------------------
    describe('isolation des données personnelles', () => {
      it("n'interroge JAMAIS la table des segments personnels", async () => {
        prisma.stop.findMany.mockResolvedValue([A, C]);
        prisma.networkLink.findMany.mockResolvedValue([aVersC]);

        await service.searchRoutes({ ...depuisA, ...versC });

        // Preuve directe : la recherche ne touche pas aux données des usagers.
        expect(prisma.segment.findMany).not.toHaveBeenCalled();
        // ...et lit bien le réseau public à la place.
        expect(prisma.networkLink.findMany).toHaveBeenCalled();
      });

      it('ignore les trajets personnels : sans réseau public, aucun itinéraire', async () => {
        prisma.stop.findMany.mockResolvedValue([A, B, C]);
        // Le réseau public est VIDE...
        prisma.networkLink.findMany.mockResolvedValue([]);
        // ...alors qu'un usager a bien enregistré des segments entre ces
        // mêmes arrêts. Avant 4C-3, ces segments auraient alimenté le
        // graphe public. Ce ne doit plus être le cas.
        prisma.segment.findMany.mockResolvedValue([aVersB, bVersC]);

        const result = await service.searchRoutes({ ...depuisA, ...versC });

        expect(result).toEqual([]);
      });

      it("n'emprunte que des liaisons du réseau public, jamais celles d'un usager", async () => {
        prisma.stop.findMany.mockResolvedValue([A, B, C]);
        // Réseau public : uniquement le trajet direct A→C.
        prisma.networkLink.findMany.mockResolvedValue([aVersC]);
        // Un usager a enregistré un raccourci A→B→C bien plus rapide.
        // Il ne doit avoir AUCUNE influence sur le résultat.
        prisma.segment.findMany.mockResolvedValue([aVersB, bVersC]);

        const result = await service.searchRoutes({ ...depuisA, ...versC });

        expect(result).toHaveLength(1);
        expect(result[0].segments).toHaveLength(1);
        expect(result[0].segments[0].toStopId).toBe(C.id);
        // La durée est bien celle du réseau (30 min), et non celle du
        // raccourci personnel (20 min).
        expect(result[0].totalDurationMin).toBe(30);
      });

      it('fonctionne avec le réseau public seul, sans aucune donnée utilisateur', async () => {
        prisma.stop.findMany.mockResolvedValue([A, C]);
        prisma.networkLink.findMany.mockResolvedValue([aVersC]);
        // Aucune route, aucun segment, aucun usager en base.
        prisma.segment.findMany.mockResolvedValue([]);

        const result = await service.searchRoutes({ ...depuisA, ...versC });

        expect(result).toHaveLength(1);
        expect(result[0].segments[0].fromStopName).toBe('Gare du Nord');
      });
    });
  });
});
