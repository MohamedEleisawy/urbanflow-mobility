import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StopsService } from './stops.service';
import { ScheduleService } from '../schedule/schedule.service';
import { FindStopsQueryDto } from './dto/find-stops-query.dto';

describe('StopsService', () => {
  let schedule: {
    horairesDisponibles: jest.Mock;
    prochainsPassages: jest.Mock;
  };
  let service: StopsService;
  let prisma: {
    stop: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      count: jest.Mock;
    };
    transitLine: { groupBy: jest.Mock };
    networkLink: {
      findMany: jest.Mock<
        Promise<unknown[]>,
        [{ where: { line: { mode: { not: string } } } }]
      >;
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
      transitLine: { groupBy: jest.fn().mockResolvedValue([]) },
      networkLink: {
        findMany: jest
          .fn<
            Promise<unknown[]>,
            [{ where: { line: { mode: { not: string } } } }]
          >()
          .mockResolvedValue([]),
      },
    };

    // ⚠️ UN DOUBLE QUI DIT « AUCUN HORAIRE ». C'est l'état d'un réseau sans
    // `calendar.txt`, et c'est le plus exigeant pour ces tests : « Autour de
    // moi » doit alors rendre `departuresFreshness: 'UNKNOWN'` plutôt que de
    // laisser croire qu'aucun véhicule ne passe.
    schedule = {
      horairesDisponibles: jest.fn().mockResolvedValue(false),
      prochainsPassages: jest.fn().mockResolvedValue([]),
    };

    service = new StopsService(
      prisma as unknown as PrismaService,
      schedule as unknown as ScheduleService,
    );
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

  // ---------------------------------------------------------------------------
  // Modes réellement présents dans le réseau
  // ---------------------------------------------------------------------------
  describe('findNetworkModes', () => {
    it('ne rend QUE les modes présents, avec leur nombre de lignes', async () => {
      // Réseau de la CTS : du tram et du bus, rien d'autre.
      prisma.transitLine.groupBy.mockResolvedValue([
        { mode: 'BUS', _count: { _all: 41 } },
        { mode: 'TRAM', _count: { _all: 6 } },
      ]);

      const reponse = await service.findNetworkModes();

      expect(reponse.modes).toEqual([
        { mode: 'BUS', lineCount: 41 },
        { mode: 'TRAM', lineCount: 6 },
      ]);
    });

    it("n'invente AUCUN mode absent du réseau", async () => {
      prisma.transitLine.groupBy.mockResolvedValue([
        { mode: 'TRAM', _count: { _all: 6 } },
      ]);

      const reponse = await service.findNetworkModes();

      // ⚠️ L'enum en compte huit ; le réseau chargé n'en a qu'un. Proposer un
      // filtre « Métro » sur un réseau qui n'en a pas ferait chercher à
      // l'usager quelque chose qui ne rendra jamais rien.
      expect(reponse.modes.map((m) => m.mode)).toEqual(['TRAM']);
    });

    it('rend une liste VIDE sur un réseau non importé', async () => {
      prisma.transitLine.groupBy.mockResolvedValue([]);

      // Une liste vide est une réponse — « aucun réseau chargé » — pas une
      // panne.
      await expect(service.findNetworkModes()).resolves.toEqual({ modes: [] });
    });

    it('BORNE le comptage au territoire desservi', async () => {
      await service.findNetworkModes();

      // ⚠️ SANS CE FILTRE, une base contenant DEUX réseaux — l'import étant
      // additif — répondait « METRO : 16 lignes » sur une installation
      // strasbourgeoise, et l'interface proposait un filtre qui n'aurait
      // jamais rien rendu.
      interface FiltreLignes {
        where: { links: { some: { fromStop: { latitude?: unknown } } } };
      }

      const appels = prisma.transitLine.groupBy.mock.calls as FiltreLignes[][];

      expect(appels[0][0].where.links.some.fromStop.latitude).toBeDefined();
    });

    it('compte les LIGNES, pas les arrêts', async () => {
      await service.findNetworkModes();

      // Un arrêt ne porte aucun mode : c'est la ligne qui en a un.
      expect(prisma.transitLine.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ by: ['mode'] }),
      );
      expect(prisma.stop.findMany).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // « Autour de moi » (war room)
  // ---------------------------------------------------------------------------
  describe('findNearby', () => {
    const quai = (id: string, name: string, lat: number, lon: number) => ({
      id,
      name,
      latitude: lat,
      longitude: lon,
      pmrAccessible: false,
      operatorCode: 'IDFM',
      gtfsStopId: id,
    });

    const POINT = { lat: 48.8443, lon: 2.3743 };

    const liaison = (
      fromStopId: string,
      toStopId: string,
      lineId: string,
      name: string,
      mode: string,
    ) => ({ fromStopId, toStopId, line: { id: lineId, name, mode } });

    it('REGROUPE les quais du meme lieu en une seule entree', async () => {
      // Ile-de-France Mobilites publie UN ARRET PAR QUAI : « Gare de Lyon »
      // existe en vingt et un exemplaires. Une liste qui les enumere dit
      // vingt et une fois la meme chose a quelqu'un qui veut savoir ou aller.
      prisma.stop.findMany.mockResolvedValue([
        quai('q1', 'Gare de Lyon', 48.8443, 2.3743),
        quai('q2', 'Gare de Lyon', 48.8444, 2.3744),
        quai('q3', 'Bercy', 48.8401, 2.3795),
      ]);
      prisma.networkLink.findMany.mockResolvedValue([
        liaison('q1', 'q9', 'l-63', '63', 'BUS'),
        liaison('q2', 'q9', 'l-14', '14', 'METRO'),
        liaison('q3', 'q9', 'l-6', '6', 'METRO'),
      ]);

      const reponse = await service.findNearby({
        ...POINT,
        radiusM: 800,
        limit: 10,
      });

      expect(reponse.stops.map((s) => s.name)).toEqual([
        'Gare de Lyon',
        'Bercy',
      ]);
    });

    it('FUSIONNE les lignes des quais regroupes', async () => {
      // Ne garder que celles du quai le plus proche afficherait
      // « Gare de Lyon - 63 » et tairait le metro 14, qui part du quai d'a
      // cote. C'est precisement l'information qu'on vient chercher.
      prisma.stop.findMany.mockResolvedValue([
        quai('q1', 'Gare de Lyon', 48.8443, 2.3743),
        quai('q2', 'Gare de Lyon', 48.8444, 2.3744),
      ]);
      prisma.networkLink.findMany.mockResolvedValue([
        liaison('q1', 'q9', 'l-63', '63', 'BUS'),
        liaison('q2', 'q9', 'l-14', '14', 'METRO'),
      ]);

      const reponse = await service.findNearby({
        ...POINT,
        radiusM: 800,
        limit: 10,
      });

      expect(reponse.stops[0].lines.map((l) => l.name)).toEqual(['14', '63']);
    });

    it('ECARTE la ligne interne de correspondance a pied', async () => {
      // DEFAUT REEL, CONSTATE A L'ECRAN : « Gare de Lyon - Correspondance »
      // apparaissait a cote du metro 14, comme si l'on pouvait prendre la
      // correspondance.
      //
      // Cette « ligne » est un ARTEFACT : l'import fabrique une ligne WALK
      // pour porter les liaisons pietonnes entre quais. Elle a sa place dans
      // le graphe, aucune sur un panneau.
      prisma.stop.findMany.mockResolvedValue([
        quai('q1', 'Gare de Lyon', 48.8443, 2.3743),
      ]);

      await service.findNearby({ ...POINT, radiusM: 800, limit: 10 });

      const requete = prisma.networkLink.findMany.mock.calls[0][0];

      expect(requete.where.line.mode.not).toBe('WALK');
    });

    it('annonce UNKNOWN quand aucun passage n est connu POUR CES ARRETS', async () => {
      // LE BOGUE QUE CE TEST VERROUILLE. La premiere version demandait
      // `horairesDisponibles()`, qui repond « oui » des qu'UN reseau de la
      // base est horodate. Sur une installation portant deux reseaux - l'un
      // avec horaires, l'autre sans - elle annoncait `STATIC` sur des arrets
      // dont aucun passage n'etait connu.
      //
      // Le resultat se lisait « ces lignes ne circulent plus », alors que la
      // phrase exacte etait « nous ne connaissons pas leurs horaires ».
      prisma.stop.findMany.mockResolvedValue([
        quai('q1', 'Gare de Lyon', 48.8443, 2.3743),
      ]);
      schedule.prochainsPassages.mockResolvedValue([]);

      const reponse = await service.findNearby({
        ...POINT,
        radiusM: 800,
        limit: 10,
      });

      expect(reponse.departuresFreshness).toBe('UNKNOWN');
      expect(reponse.stops[0].nextDeparture).toBeNull();
    });

    it('rattache le prochain passage A LA BONNE LIGNE', async () => {
      // `prochainsPassages` est appele pour TOUS les arrets a la fois. Sans
      // filtre par ligne, un arret afficherait le prochain passage d'un arret
      // voisin - plausible, et faux.
      prisma.stop.findMany.mockResolvedValue([
        quai('q1', 'Gare de Lyon', 48.8443, 2.3743),
        quai('q3', 'Bercy', 48.8401, 2.3795),
      ]);
      prisma.networkLink.findMany.mockResolvedValue([
        liaison('q1', 'q9', 'l-14', '14', 'METRO'),
        liaison('q3', 'q9', 'l-6', '6', 'METRO'),
      ]);
      schedule.prochainsPassages.mockResolvedValue([
        {
          lineId: 'l-6',
          lineName: '6',
          mode: 'METRO',
          headsign: 'Nation',
          departureAt: new Date('2026-09-03T08:00:00Z'),
          waitMin: 2,
        },
        {
          lineId: 'l-14',
          lineName: '14',
          mode: 'METRO',
          headsign: 'Olympiades',
          departureAt: new Date('2026-09-03T08:05:00Z'),
          waitMin: 7,
        },
      ]);

      const reponse = await service.findNearby({
        ...POINT,
        radiusM: 800,
        limit: 10,
      });

      const gareDeLyon = reponse.stops.find((s) => s.name === 'Gare de Lyon');
      const bercy = reponse.stops.find((s) => s.name === 'Bercy');

      // Le passage de la ligne 6 est le PLUS PROCHE dans le temps, mais il ne
      // concerne pas Gare de Lyon.
      expect(gareDeLyon?.nextDeparture?.lineName).toBe('14');
      expect(bercy?.nextDeparture?.lineName).toBe('6');
    });

    it('ESTIME la marche, sans jamais annoncer zero minute', async () => {
      // « 0 min de marche » se lit comme « vous y etes », ce qui est faux a
      // cinquante metres d'un quai.
      prisma.stop.findMany.mockResolvedValue([
        quai('q1', 'Gare de Lyon', 48.8443, 2.3743),
      ]);

      const reponse = await service.findNearby({
        ...POINT,
        radiusM: 800,
        limit: 10,
      });

      expect(reponse.stops[0].distanceM).toBe(0);
      expect(reponse.stops[0].walkMin).toBe(1);
    });

    it('ECARTE les arrets hors du rayon demande', async () => {
      // Le rectangle circonscrit ramene les coins ; le cercle les ecarte.
      prisma.stop.findMany.mockResolvedValue([
        quai('q1', 'Gare de Lyon', 48.8443, 2.3743),
        quai('loin', 'Trop loin', 48.85, 2.39),
      ]);

      const reponse = await service.findNearby({
        ...POINT,
        radiusM: 200,
        limit: 10,
      });

      expect(reponse.stops.map((s) => s.name)).toEqual(['Gare de Lyon']);
    });

    it('n interroge NI les lignes NI le calendrier quand rien n est proche', async () => {
      // Deux allers-retours en base pour une liste vide seraient du gaspillage
      // pur - et cet endpoint est appele a chaque deplacement de carte.
      prisma.stop.findMany.mockResolvedValue([]);

      const reponse = await service.findNearby({
        ...POINT,
        radiusM: 800,
        limit: 10,
      });

      expect(reponse.stops).toEqual([]);
      expect(reponse.departuresFreshness).toBe('UNKNOWN');
      expect(prisma.networkLink.findMany).not.toHaveBeenCalled();
      expect(schedule.prochainsPassages).not.toHaveBeenCalled();
    });
  });
});
