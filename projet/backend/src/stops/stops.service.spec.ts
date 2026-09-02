import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StopsService } from './stops.service';
import { FindStopsQueryDto } from './dto/find-stops-query.dto';

describe('StopsService', () => {
  let service: StopsService;
  let prisma: {
    stop: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      count: jest.Mock;
    };
  };

  const arret = (
    id: string,
    name: string,
    latitude: number,
    longitude: number,
  ) => ({
    id,
    name,
    latitude,
    longitude,
    pmrAccessible: true,
    operatorCode: 'RATP',
  });

  const gareDuNord = arret('stop-1', 'Gare du Nord', 48.8809, 2.3553);
  const gareDeLyon = arret('stop-2', 'Gare de Lyon', 48.8443, 2.3743);
  const chatelet = arret('stop-3', 'Châtelet', 48.8583, 2.347);

  /// Les valeurs par défaut du DTO, comme si le client n'avait rien envoyé.
  const requete = (partielle: Partial<FindStopsQueryDto> = {}) =>
    Object.assign(new FindStopsQueryDto(), partielle);

  /// Le `where` réellement transmis à Prisma, typé — `mock.calls` est `any`.
  interface CadreSpatial {
    where: {
      latitude: { gte: number; lte: number };
      longitude: { gte: number; lte: number };
      name?: { contains: string; mode: string };
    };
  }

  const premierAppel = (): CadreSpatial =>
    (prisma.stop.findMany.mock.calls as CadreSpatial[][])[0][0];

  beforeEach(() => {
    prisma = {
      stop: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    service = new StopsService(prisma as unknown as PrismaService);
  });

  it('crée un arrêt', async () => {
    prisma.stop.create.mockResolvedValue(gareDuNord);

    const dto = {
      name: 'Gare du Nord',
      latitude: 48.8809,
      longitude: 2.3553,
      pmrAccessible: true,
      operatorCode: 'RATP',
    };

    const result = await service.create(dto);

    // Les données transmises à Prisma sont exactement celles reçues.
    expect(prisma.stop.create).toHaveBeenCalledWith({ data: dto });
    expect(result).toEqual(gareDuNord);
  });

  // ---------------------------------------------------------------------------
  // Phase 4 : la liste est TOUJOURS bornée
  // ---------------------------------------------------------------------------
  describe('findAll — parcours paginé', () => {
    it('demande une PAGE à PostgreSQL, jamais toute la table', async () => {
      prisma.stop.findMany.mockResolvedValue([gareDuNord]);
      prisma.stop.count.mockResolvedValue(1934);

      await service.findAll(requete({ page: 3, limit: 20 }));

      expect(prisma.stop.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 40, take: 20 }),
      );
    });

    it('trie sur DEUX clés : le réseau est plein de noms en double', async () => {
      // Un même nom désigne un quai par ligne. Sans ordre TOTAL, la page 2
      // pourrait réafficher une ligne de la page 1, ou en sauter une.
      await service.findAll(requete());

      expect(prisma.stop.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        }),
      );
    });

    it('rend le total, la page et la limite avec les résultats', async () => {
      prisma.stop.findMany.mockResolvedValue([gareDuNord]);
      prisma.stop.count.mockResolvedValue(1934);

      const page = await service.findAll(requete({ page: 2, limit: 50 }));

      expect(page).toMatchObject({ page: 2, limit: 50, total: 1934 });
      expect(page.items).toHaveLength(1);
    });

    it('rend distanceM à null quand aucun point n’est demandé', async () => {
      prisma.stop.findMany.mockResolvedValue([gareDuNord]);

      const page = await service.findAll(requete());

      // `null` et non 0 : il n'y a pas de distance à annoncer, et « 0 »
      // voudrait dire « vous y êtes ».
      expect(page.items[0].distanceM).toBeNull();
    });

    it('filtre par nom, insensible à la casse', async () => {
      await service.findAll(requete({ query: 'gare' }));

      expect(prisma.stop.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { name: { contains: 'gare', mode: 'insensitive' } },
        }),
      );
    });

    it('compte sur le MÊME filtre que la liste', async () => {
      // Un total calculé sans le filtre annoncerait 1 934 résultats pour une
      // recherche qui n'en rend que trois.
      await service.findAll(requete({ query: 'gare' }));

      expect(prisma.stop.count).toHaveBeenCalledWith({
        where: { name: { contains: 'gare', mode: 'insensitive' } },
      });
    });

    it('ne filtre rien quand aucune recherche n’est demandée', async () => {
      await service.findAll(requete());

      expect(prisma.stop.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it('ne transmet JAMAIS la saisie comme du SQL', async () => {
      // Prisma paramètre la requête : ces caractères sont des caractères,
      // pas de la syntaxe.
      await service.findAll(requete({ query: "100%';--" }));

      expect(prisma.stop.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { name: { contains: "100%';--", mode: 'insensitive' } },
        }),
      );
    });
  });

  describe('findAll — voisinage', () => {
    beforeEach(() => {
      prisma.stop.findMany.mockResolvedValue([
        gareDuNord,
        gareDeLyon,
        chatelet,
      ]);
    });

    it('borne la requête SQL par un RECTANGLE', async () => {
      await service.findAll(
        requete({ lat: 48.8583, lon: 2.347, radiusM: 1000 }),
      );

      const appel = premierAppel();

      expect(appel.where.latitude.gte).toBeLessThan(48.8583);
      expect(appel.where.latitude.lte).toBeGreaterThan(48.8583);
      expect(appel.where.longitude.gte).toBeLessThan(2.347);
      expect(appel.where.longitude.lte).toBeGreaterThan(2.347);
    });

    it('élargit le rectangle en LONGITUDE sous nos latitudes', async () => {
      // Un degré de longitude vaut 73 km à Paris contre 111 km à l'équateur.
      // Une marge identique sur les deux axes couperait le cercle en largeur,
      // et des arrêts pourtant dans le rayon manqueraient à l'appel.
      await service.findAll(
        requete({ lat: 48.8583, lon: 2.347, radiusM: 1000 }),
      );

      const appel = premierAppel();

      const margeLat = appel.where.latitude.lte - 48.8583;
      const margeLon = appel.where.longitude.lte - 2.347;

      expect(margeLon).toBeGreaterThan(margeLat);
    });

    it('exclut les arrêts du rectangle mais HORS du cercle', async () => {
      // Rayon volontairement serré autour de Châtelet : les deux gares, à
      // plus de 2 km, tombent dans le rectangle mais pas dans le cercle.
      const page = await service.findAll(
        requete({ lat: 48.8583, lon: 2.347, radiusM: 300 }),
      );

      expect(page.items.map((s) => s.id)).toEqual(['stop-3']);
      // Le total est celui du CERCLE, pas celui du rectangle : un chiffre
      // faux affiché à l'usager serait pire que pas de chiffre du tout.
      expect(page.total).toBe(1);
    });

    it('ordonne du plus proche au plus éloigné', async () => {
      const page = await service.findAll(
        requete({ lat: 48.8583, lon: 2.347, radiusM: 5000 }),
      );

      const distances = page.items.map((s) => s.distanceM ?? 0);

      expect(page.items[0].id).toBe('stop-3');
      expect([...distances].sort((a, b) => a - b)).toEqual(distances);
    });

    it('renseigne la distance réelle de chaque arrêt', async () => {
      const page = await service.findAll(
        requete({ lat: 48.8583, lon: 2.347, radiusM: 5000 }),
      );

      const chatelet = page.items.find((s) => s.id === 'stop-3');
      const nord = page.items.find((s) => s.id === 'stop-1');

      expect(chatelet?.distanceM).toBe(0);
      // Châtelet → Gare du Nord : environ 2,5 km à vol d'oiseau.
      expect(nord?.distanceM).toBeGreaterThan(2000);
      expect(nord?.distanceM).toBeLessThan(3000);
    });

    it('pagine aussi le voisinage', async () => {
      const page = await service.findAll(
        requete({ lat: 48.8583, lon: 2.347, radiusM: 5000, page: 2, limit: 1 }),
      );

      expect(page.items).toHaveLength(1);
      expect(page.total).toBe(3);
      // Deuxième plus proche, pas le premier.
      expect(page.items[0].id).not.toBe('stop-3');
    });

    it('combine la recherche par nom et le voisinage', async () => {
      await service.findAll(
        requete({ lat: 48.8583, lon: 2.347, query: 'gare' }),
      );

      // Le cadre spatial ET le filtre de nom, dans la MÊME requête : c'est
      // ce qui permet de chercher « gare » autour de soi.
      const appel = premierAppel();

      expect(appel.where.name).toEqual({
        contains: 'gare',
        mode: 'insensitive',
      });
      expect(appel.where.latitude).toBeDefined();
    });

    it('ne fait AUCUN comptage SQL séparé pour le voisinage', async () => {
      // Le total exact se lit sur l'ensemble déjà chargé : une seconde
      // requête ne saurait de toute façon pas compter un cercle.
      await service.findAll(requete({ lat: 48.8583, lon: 2.347 }));

      expect(prisma.stop.count).not.toHaveBeenCalled();
    });

    it('rend une page vide, et non une erreur, quand rien n’est proche', async () => {
      prisma.stop.findMany.mockResolvedValue([]);

      const page = await service.findAll(
        requete({ lat: 0, lon: 0, radiusM: 500 }),
      );

      expect(page.items).toEqual([]);
      expect(page.total).toBe(0);
    });
  });

  it('renvoie un arrêt existant', async () => {
    prisma.stop.findUnique.mockResolvedValue(gareDuNord);

    await expect(service.findOne('stop-1')).resolves.toEqual(gareDuNord);
  });

  it("lève 404 quand l'arrêt n'existe pas", async () => {
    prisma.stop.findUnique.mockResolvedValue(null);

    await expect(service.findOne('inconnu')).rejects.toThrow(NotFoundException);
  });
});
