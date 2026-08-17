import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GtfsReaderService } from './gtfs-reader.service';
import { GtfsImportReport } from './gtfs-import-report';
import { GtfsStopTime, GtfsTrip } from './gtfs-row.types';
import { NetworkBuilderService } from './network-builder.service';

beforeAll(() => {
  Logger.overrideLogger(false);
});

// Ces tests simulent le lecteur ET Prisma : on maîtrise ainsi exactement les
// horaires de chaque passage, ce qui est indispensable pour vérifier le
// calcul de la médiane. Le lecteur lui-même est déjà testé en 4C-4-2.
describe('NetworkBuilderService', () => {
  // Trois arrêts alignés, espacés d'environ 1,1 km chacun.
  const ARRETS_BASE = [
    { id: 'uuid-a', gtfsStopId: 'A', latitude: 48.0, longitude: 2.0 },
    { id: 'uuid-b', gtfsStopId: 'B', latitude: 48.01, longitude: 2.0 },
    { id: 'uuid-c', gtfsStopId: 'C', latitude: 48.02, longitude: 2.0 },
  ];
  const LIGNES_BASE = [{ id: 'uuid-l1', gtfsRouteId: 'L1' }];

  interface UpsertLiaison {
    where: {
      lineId_fromStopId_toStopId: {
        lineId: string;
        fromStopId: string;
        toStopId: string;
      };
    };
    update: { durationMin: number; distanceM: number };
    create: Record<string, unknown>;
  }

  let prisma: {
    stop: { findMany: jest.Mock };
    transitLine: { findMany: jest.Mock };
    networkLink: { upsert: jest.Mock<Promise<unknown>, [UpsertLiaison]> };
  };
  let reader: {
    readTrips: jest.Mock;
    readStopTimes: jest.Mock;
  };
  let service: NetworkBuilderService;
  let report: GtfsImportReport;

  // Transforme un tableau en générateur asynchrone, comme le vrai lecteur.
  function fluxDe<T>(elements: T[]) {
    return async function* () {
      for (const element of elements) {
        yield await Promise.resolve(element);
      }
    };
  }

  // Fabrique un passage : minute de départ et minute d'arrivée.
  const passage = (
    tripId: string,
    stopId: string,
    stopSequence: number,
    arriveeMin: number,
    departMin = arriveeMin,
  ): GtfsStopTime => ({
    tripId,
    stopId,
    stopSequence,
    arrivalTimeSec: arriveeMin * 60,
    departureTimeSec: departMin * 60,
  });

  const trajet = (tripId: string, routeId = 'L1'): GtfsTrip => ({
    tripId,
    routeId,
    serviceId: 'SEM',
    directionId: null,
  });

  function preparer(
    trajets: GtfsTrip[],
    passages: GtfsStopTime[],
    options: {
      arrets?: typeof ARRETS_BASE;
      lignes?: typeof LIGNES_BASE;
    } = {},
  ) {
    prisma.stop.findMany.mockResolvedValue(options.arrets ?? ARRETS_BASE);
    prisma.transitLine.findMany.mockResolvedValue(
      options.lignes ?? LIGNES_BASE,
    );
    reader.readTrips.mockImplementation(fluxDe(trajets));
    reader.readStopTimes.mockImplementation(fluxDe(passages));
  }

  // Toutes les liaisons écrites, sous une forme lisible.
  const liaisonsEcrites = () =>
    prisma.networkLink.upsert.mock.calls.map((appel) => {
      const cle = appel[0].where.lineId_fromStopId_toStopId;
      return {
        lineId: cle.lineId,
        from: cle.fromStopId,
        to: cle.toStopId,
        durationMin: appel[0].update.durationMin,
        distanceM: appel[0].update.distanceM,
      };
    });

  beforeEach(() => {
    prisma = {
      stop: { findMany: jest.fn() },
      transitLine: { findMany: jest.fn() },
      networkLink: { upsert: jest.fn<Promise<unknown>, [UpsertLiaison]>() },
    };
    reader = { readTrips: jest.fn(), readStopTimes: jest.fn() };
    service = new NetworkBuilderService(
      prisma as unknown as PrismaService,
      reader as unknown as GtfsReaderService,
    );
    report = new GtfsImportReport();
  });

  describe('paires consécutives', () => {
    it('ne relie que des arrêts CONSÉCUTIFS, jamais le départ à l’arrivée', async () => {
      // Un trajet A → B → C doit donner A→B et B→C, mais surtout PAS A→C :
      // ce n'est pas un tronçon du réseau.
      preparer(
        [trajet('T1')],
        [
          passage('T1', 'A', 1, 0),
          passage('T1', 'B', 2, 5),
          passage('T1', 'C', 3, 12),
        ],
      );

      await service.buildNetwork('/flux', report);

      expect(liaisonsEcrites().map((l) => `${l.from}→${l.to}`)).toEqual([
        'uuid-a→uuid-b',
        'uuid-b→uuid-c',
      ]);
    });

    it('ordonne les arrêts par stop_sequence, pas par ordre du fichier', async () => {
      // Les passages arrivent dans le désordre : c'est stop_sequence qui
      // fait foi.
      preparer(
        [trajet('T1')],
        [
          passage('T1', 'C', 3, 12),
          passage('T1', 'A', 1, 0),
          passage('T1', 'B', 2, 5),
        ],
      );

      await service.buildNetwork('/flux', report);

      expect(liaisonsEcrites().map((l) => `${l.from}→${l.to}`)).toEqual([
        'uuid-a→uuid-b',
        'uuid-b→uuid-c',
      ]);
    });

    it('ignore un trajet ne desservant qu’un seul arrêt', async () => {
      preparer([trajet('T1')], [passage('T1', 'A', 1, 0)]);

      await service.buildNetwork('/flux', report);

      expect(prisma.networkLink.upsert).not.toHaveBeenCalled();
    });
  });

  describe('regroupement', () => {
    it('deux trajets identiques donnent 2 liaisons, pas 4', async () => {
      // C'est LE test du regroupement : une ligne qui passe deux fois sur
      // le même parcours ne crée pas deux fois les mêmes tronçons.
      preparer(
        [trajet('T1'), trajet('T2')],
        [
          passage('T1', 'A', 1, 0),
          passage('T1', 'B', 2, 5),
          passage('T1', 'C', 3, 12),
          passage('T2', 'A', 1, 60),
          passage('T2', 'B', 2, 65),
          passage('T2', 'C', 3, 72),
        ],
      );

      await service.buildNetwork('/flux', report);

      expect(prisma.networkLink.upsert).toHaveBeenCalledTimes(2);
      expect(report.imported.networkLinks).toBe(2);
      // En revanche, les 4 paires ont bien été observées.
      expect(report.pairs.valid).toBe(4);
    });

    it('deux lignes différentes sur A→B donnent 2 liaisons distinctes', async () => {
      preparer(
        [trajet('T1', 'L1'), trajet('T2', 'L2')],
        [
          passage('T1', 'A', 1, 0),
          passage('T1', 'B', 2, 5),
          passage('T2', 'A', 1, 30),
          passage('T2', 'B', 2, 40),
        ],
        {
          lignes: [
            { id: 'uuid-l1', gtfsRouteId: 'L1' },
            { id: 'uuid-l2', gtfsRouteId: 'L2' },
          ],
        },
      );

      await service.buildNetwork('/flux', report);

      const liaisons = liaisonsEcrites();
      expect(liaisons).toHaveLength(2);
      // Même couple d'arrêts, mais deux lignes : la clé unique contient
      // lineId, donc les deux coexistent.
      expect(liaisons.map((l) => l.lineId).sort()).toEqual([
        'uuid-l1',
        'uuid-l2',
      ]);
      expect(liaisons[0].durationMin).toBe(5);
      expect(liaisons[1].durationMin).toBe(10);
    });

    it('crée des liaisons dans les DEUX SENS pour un aller et un retour', async () => {
      preparer(
        [trajet('T_ALLER'), trajet('T_RETOUR')],
        [
          passage('T_ALLER', 'A', 1, 0),
          passage('T_ALLER', 'B', 2, 5),
          passage('T_ALLER', 'C', 3, 12),
          passage('T_RETOUR', 'C', 1, 40),
          passage('T_RETOUR', 'B', 2, 47),
          passage('T_RETOUR', 'A', 3, 53),
        ],
      );

      await service.buildNetwork('/flux', report);

      const sens = liaisonsEcrites().map((l) => `${l.from}→${l.to}`);
      expect(sens).toContain('uuid-a→uuid-b');
      expect(sens).toContain('uuid-b→uuid-a');
      expect(sens).toHaveLength(4);
      // direction_id n'a jamais été consulté : le sens vient de l'ordre des
      // arrêts.
    });
  });

  describe('durée représentative', () => {
    it('retient la médiane des durées observées (8, 10, 12 → 10)', async () => {
      preparer(
        [trajet('T1'), trajet('T2'), trajet('T3')],
        [
          passage('T1', 'A', 1, 0),
          passage('T1', 'B', 2, 8),
          passage('T2', 'A', 1, 100),
          passage('T2', 'B', 2, 110),
          passage('T3', 'A', 1, 200),
          passage('T3', 'B', 2, 212),
        ],
      );

      await service.buildNetwork('/flux', report);

      expect(liaisonsEcrites()[0].durationMin).toBe(10);
    });

    it('arrondit AU PLUS PROCHE une médiane décimale (9, 10, 11, 60 → 10,5 → 11)', async () => {
      // durationMin est un entier en base. La convention retenue est
      // l'arrondi au plus proche : arrondir systématiquement vers le haut
      // ajouterait un biais qui s'accumule sur un itinéraire multi-tronçons.
      preparer(
        [trajet('T1'), trajet('T2'), trajet('T3'), trajet('T4')],
        [
          passage('T1', 'A', 1, 0),
          passage('T1', 'B', 2, 9),
          passage('T2', 'A', 1, 100),
          passage('T2', 'B', 2, 110),
          passage('T3', 'A', 1, 200),
          passage('T3', 'B', 2, 211),
          passage('T4', 'A', 1, 300),
          passage('T4', 'B', 2, 360),
        ],
      );

      await service.buildNetwork('/flux', report);

      expect(liaisonsEcrites()[0].durationMin).toBe(11);
    });

    it('mesure la durée du DÉPART de A à l’ARRIVÉE en B', async () => {
      // Arrivée en A à 0, départ de A à 2, arrivée en B à 10.
      // La durée du tronçon est 10 − 2 = 8, et non 10 − 0.
      preparer(
        [trajet('T1')],
        [passage('T1', 'A', 1, 0, 2), passage('T1', 'B', 2, 10)],
      );

      await service.buildNetwork('/flux', report);

      expect(liaisonsEcrites()[0].durationMin).toBe(8);
    });

    it('calcule la distance à vol d’oiseau entre les deux arrêts', async () => {
      preparer(
        [trajet('T1')],
        [passage('T1', 'A', 1, 0), passage('T1', 'B', 2, 5)],
      );

      await service.buildNetwork('/flux', report);

      // 0,01° de latitude ≈ 1,11 km. stop_times ne fournit aucune distance :
      // elle est calculée par Haversine.
      const distance = liaisonsEcrites()[0].distanceM;
      expect(distance).toBeGreaterThan(1000);
      expect(distance).toBeLessThan(1200);
    });
  });

  describe('robustesse', () => {
    it('écarte et compte une paire dont l’arrivée précède le départ', async () => {
      preparer(
        [trajet('T1')],
        [
          passage('T1', 'A', 1, 0, 20), // départ à 20
          passage('T1', 'B', 2, 10), // arrivée à 10 : impossible
          passage('T1', 'C', 3, 30),
        ],
      );

      await service.buildNetwork('/flux', report);

      // La paire A→B est écartée, mais B→C reste exploitée : une donnée
      // aberrante n'interrompt pas la construction.
      expect(report.pairs.invalidDuration).toBe(1);
      expect(report.pairs.valid).toBe(1);
      expect(liaisonsEcrites().map((l) => `${l.from}→${l.to}`)).toEqual([
        'uuid-b→uuid-c',
      ]);
    });

    it('signale un stop_times.txt non groupé par trajet', async () => {
      // T1 réapparaît après T2 : le fichier n'est pas groupé, ce que la
      // spécification GTFS recommande pourtant.
      preparer(
        [trajet('T1'), trajet('T2')],
        [
          passage('T1', 'A', 1, 0),
          passage('T1', 'B', 2, 5),
          passage('T2', 'A', 1, 60),
          passage('T2', 'B', 2, 70),
          passage('T1', 'B', 2, 5),
          passage('T1', 'C', 3, 12),
        ],
      );

      await service.buildNetwork('/flux', report);

      expect(report.anomalies.unsortedStopTimes).toBe(1);
    });

    it('ne fait rien si le référentiel n’a pas encore été importé', async () => {
      preparer([], [], { arrets: [], lignes: [] });

      await service.buildNetwork('/flux', report);

      expect(prisma.networkLink.upsert).not.toHaveBeenCalled();
      // Les fichiers ne sont même pas ouverts.
      expect(reader.readTrips).not.toHaveBeenCalled();
    });
  });

  describe('idempotence', () => {
    it('utilise upsert sur la clé (ligne, départ, arrivée)', async () => {
      preparer(
        [trajet('T1')],
        [passage('T1', 'A', 1, 0), passage('T1', 'B', 2, 5)],
      );

      await service.buildNetwork('/flux', report);

      // C'est cette clé, posée à l'étape 4C-4-1, qui rend l'import
      // réexécutable sans créer de doublon.
      expect(prisma.networkLink.upsert.mock.calls[0][0].where).toEqual({
        lineId_fromStopId_toStopId: {
          lineId: 'uuid-l1',
          fromStopId: 'uuid-a',
          toStopId: 'uuid-b',
        },
      });
    });
  });
});
