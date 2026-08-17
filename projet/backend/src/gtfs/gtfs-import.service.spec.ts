import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { ModeTransport } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GtfsImportService } from './gtfs-import.service';
import { GtfsReaderService } from './gtfs-reader.service';

// Le service journalise son bilan, ce qui est voulu en exploitation mais
// noierait la sortie des tests. On coupe le logger : le contenu du bilan
// reste vérifié par les assertions sur report.toLines().
beforeAll(() => {
  Logger.overrideLogger(false);
});

// On utilise le VRAI lecteur (déjà testé en 4C-4-2) sur les fixtures, et on
// simule uniquement Prisma : ces tests vérifient donc l'enchaînement complet
// lecture → mapping → écriture, sans jamais toucher à PostgreSQL.
const FIXTURES = join(__dirname, '..', '..', 'test', 'fixtures', 'gtfs');

interface UpsertArg {
  where: Record<string, string>;
  update: Record<string, unknown>;
  create: Record<string, unknown>;
}

describe('GtfsImportService', () => {
  let service: GtfsImportService;
  // Les mocks sont typés sur leurs arguments : `mock.calls[n][0]` est alors
  // un UpsertArg et non un `any`, ce qui rend les assertions vérifiées par
  // le compilateur.
  type UpsertMock = jest.Mock<Promise<unknown>, [UpsertArg]>;
  let prisma: {
    stop: { upsert: UpsertMock };
    transitLine: { upsert: UpsertMock };
  };

  beforeEach(() => {
    prisma = {
      stop: { upsert: jest.fn<Promise<unknown>, [UpsertArg]>() },
      transitLine: { upsert: jest.fn<Promise<unknown>, [UpsertArg]>() },
    };
    service = new GtfsImportService(
      prisma as unknown as PrismaService,
      new GtfsReaderService(),
    );
  });

  // Récupère les arguments du n-ième appel à upsert, correctement typés.
  const appel = (mock: UpsertMock, index: number): UpsertArg =>
    mock.mock.calls[index][0];

  describe('arrêts', () => {
    it('écrit les 4 arrêts valides des fixtures', async () => {
      const report = await service.importReferential(FIXTURES, 'RATP');

      expect(prisma.stop.upsert).toHaveBeenCalledTimes(4);
      expect(report.imported.stops).toBe(4);
    });

    it('rapproche les arrêts sur gtfsStopId, pas sur notre UUID interne', async () => {
      await service.importReferential(FIXTURES, 'RATP');

      // C'est cette clé qui rend l'import idempotent.
      expect(appel(prisma.stop.upsert, 0).where).toEqual({ gtfsStopId: 'S1' });
    });

    it('transmet les données de l’arrêt et le code exploitant', async () => {
      await service.importReferential(FIXTURES, 'RATP');
      const premier = appel(prisma.stop.upsert, 0);

      expect(premier.create).toEqual({
        gtfsStopId: 'S1',
        name: 'Gare du Nord',
        latitude: 48.8809,
        longitude: 2.3553,
        pmrAccessible: true,
        // stops.txt ne contient aucune information d'exploitant : elle vient
        // de la ligne de commande.
        operatorCode: 'RATP',
      });
    });

    it('ne réécrit jamais gtfsStopId lors d’une mise à jour', async () => {
      await service.importReferential(FIXTURES, 'RATP');

      // L'identifiant sert de clé de recherche : le modifier n'aurait pas
      // de sens et risquerait de casser le rapprochement.
      expect(appel(prisma.stop.upsert, 0).update).not.toHaveProperty(
        'gtfsStopId',
      );
    });
  });

  describe('lignes', () => {
    it('écrit uniquement les lignes dont le mode a un équivalent', async () => {
      const report = await service.importReferential(FIXTURES, 'RATP');

      // routes.txt contient 4 lignes valides : R1 (métro), R2 (bus),
      // R3 (train, type 2) et R4 (tram). Seule R3 n'est pas importable.
      expect(prisma.transitLine.upsert).toHaveBeenCalledTimes(3);
      expect(report.imported.transitLines).toBe(3);
    });

    it('traduit route_type en ModeTransport', async () => {
      await service.importReferential(FIXTURES, 'RATP');

      const modes = prisma.transitLine.upsert.mock.calls.map(
        (appelUpsert) => appelUpsert[0].create.mode,
      );

      expect(modes).toEqual([
        ModeTransport.METRO, // R1, route_type 1
        ModeTransport.BUS, // R2, route_type 3
        ModeTransport.TRAM, // R4, route_type 0
      ]);
    });

    it('compte et détaille les route_type non supportés', async () => {
      const report = await service.importReferential(FIXTURES, 'RATP');

      // R3 est de type 2 (train) : comptée, jamais ignorée en silence.
      expect(report.unsupportedRouteTypes).toEqual({ 2: 1 });
    });

    it('utilise le nom court, puis le nom long en repli', async () => {
      await service.importReferential(FIXTURES, 'RATP');

      // R1 a un nom court "4".
      expect(appel(prisma.transitLine.upsert, 0).create.name).toBe('4');
      // R4 n'en a pas : on retombe sur le nom long.
      expect(appel(prisma.transitLine.upsert, 2).create.name).toBe(
        'Ligne sans nom court',
      );
    });

    it('reprend agency_id comme exploitant de la ligne', async () => {
      await service.importReferential(FIXTURES, 'RATP');

      // Contrairement aux arrêts, routes.txt porte bien cette information.
      expect(appel(prisma.transitLine.upsert, 0).create.operator).toBe('RATP');
    });

    it('rapproche les lignes sur gtfsRouteId', async () => {
      await service.importReferential(FIXTURES, 'RATP');

      expect(appel(prisma.transitLine.upsert, 0).where).toEqual({
        gtfsRouteId: 'R1',
      });
    });
  });

  describe('bilan', () => {
    it('distingue les lignes LUES des entités ÉCRITES', async () => {
      const report = await service.importReferential(FIXTURES, 'RATP');

      // 4 lignes de routes.txt sont valides à la lecture...
      expect(report.files.routes.valid).toBe(4);
      // ...mais seulement 3 sont importables. La différence est expliquée
      // par le compteur des types non supportés.
      expect(report.imported.transitLines).toBe(3);
      expect(report.unsupportedRouteTypes[2]).toBe(1);
    });

    it('conserve l’invariant de lecture total = valid + ignored + filtered', async () => {
      const report = await service.importReferential(FIXTURES, 'RATP');

      expect(report.isConsistent()).toBe(true);
    });

    it('mentionne les entités écrites et les modes non supportés dans le résumé', async () => {
      const report = await service.importReferential(FIXTURES, 'RATP');
      const resume = report.toLines().join('\n');

      expect(resume).toContain('Écrits en base');
      expect(resume).toContain('route_type 2 (train)');
    });

    it("n'importe QUE le référentiel : stop_times n'est pas lu", async () => {
      const report = await service.importReferential(FIXTURES, 'RATP');

      // La construction des liaisons appartient à 4C-4-4 : à ce stade,
      // stop_times.txt et trips.txt ne sont même pas ouverts.
      expect(report.files.stopTimes.total).toBe(0);
      expect(report.files.trips.total).toBe(0);
    });
  });

  it('échoue proprement si le dossier ne contient pas les fichiers', async () => {
    await expect(
      service.importReferential(join(FIXTURES, 'dossier-inexistant')),
    ).rejects.toThrow(/Lecture impossible du fichier GTFS/);
  });
});
