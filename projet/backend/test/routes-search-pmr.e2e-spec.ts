// Charge projet/backend/.env (DATABASE_URL, JWT_SECRET, CARBON_SERVICE_URL...).
import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

// =============================================================================
// POST /api/routes/search — `pmr: true` (accessibilité fauteuil) (e2e)
// =============================================================================
// Réseau de test (au large du golfe de Guinée, aucune collision) :
//
//   A (accessible) ──WALK 10 min──> B (NON renseigné) ──BUS 10 min──> C (accessible)
//   A (accessible) ──────────────── BUS 30 min ───────────────────> C
//
// Sans contrainte, le plus rapide est A→B→C (20 min). Avec `pmr: true`, B est
// écarté et c'est le direct A→C (30 min) qui est rendu — plus lent, mais tout
// accessible. Quand aucun trajet garanti n'existe, le repli est honnête.
//
// SEUL `fetch` est simulé (microservice carbone) : la suite ne dépend d'aucun
// service Python.
// =============================================================================

const CARBONE = {
  total_distance_m: 3000,
  total_co2_g: 339,
  car_co2_g: 654,
  saved_g: 315,
  eco_score: 48,
  breakdown: [{ mode: 'BUS', distance_m: 3000, co2_g: 339 }],
};

describe('POST /api/routes/search — pmr (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const stopIds: string[] = [];
  const lineIds: string[] = [];

  // Points de recherche, à quelques mètres de A et de C.
  const DEPART = { fromLat: 3.0001, fromLon: 9.0 };
  const ARRIVEE = { toLat: 3.02, toLon: 9.0001 };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ logger: false });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.setGlobalPrefix('api');
    await app.init();
    prisma = app.get(PrismaService);

    const a = await prisma.stop.create({
      data: {
        name: 'PMR Arret A',
        latitude: 3.0,
        longitude: 9.0,
        operatorCode: 'PMR',
        pmrAccessible: true,
      },
    });
    const b = await prisma.stop.create({
      data: {
        name: 'PMR Arret B',
        latitude: 3.01,
        longitude: 9.0,
        operatorCode: 'PMR',
        // pmrAccessible omis → false → « non renseigné »
      },
    });
    const c = await prisma.stop.create({
      data: {
        name: 'PMR Arret C',
        latitude: 3.02,
        longitude: 9.0,
        operatorCode: 'PMR',
        pmrAccessible: true,
      },
    });
    stopIds.push(a.id, b.id, c.id);

    const ligneMarche = await prisma.transitLine.create({
      data: { name: 'PMR À pied', mode: 'WALK', operator: 'PMR' },
    });
    const ligneBus = await prisma.transitLine.create({
      data: { name: 'PMR Bus rapide', mode: 'BUS', operator: 'PMR' },
    });
    const ligneDirect = await prisma.transitLine.create({
      data: { name: 'PMR Bus direct', mode: 'BUS', operator: 'PMR' },
    });
    lineIds.push(ligneMarche.id, ligneBus.id, ligneDirect.id);

    await prisma.networkLink.createMany({
      data: [
        {
          lineId: ligneMarche.id,
          fromStopId: a.id,
          toStopId: b.id,
          distanceM: 600,
          durationMin: 10,
        },
        {
          lineId: ligneBus.id,
          fromStopId: b.id,
          toStopId: c.id,
          distanceM: 3200,
          durationMin: 10,
        },
        {
          lineId: ligneDirect.id,
          fromStopId: a.id,
          toStopId: c.id,
          distanceM: 3000,
          durationMin: 30,
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.networkLink.deleteMany({
      where: { fromStopId: { in: stopIds } },
    });
    await prisma.stop.deleteMany({ where: { id: { in: stopIds } } });
    await prisma.transitLine.deleteMany({ where: { id: { in: lineIds } } });
    await app.close();
  });

  beforeEach(() => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify(CARBONE), { status: 200 }),
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sans `pmr` : le plus rapide passe par B, et AUCUN bloc `accessibility`', async () => {
    const reponse = await request(app.getHttpServer())
      .post('/api/routes/search')
      .send({ ...DEPART, ...ARRIVEE })
      .expect(200);

    const itineraires = reponse.body as {
      segments: { toStopName: string }[];
      accessibility?: unknown;
    }[];

    const rapide = itineraires[0];
    expect(rapide.segments.map((s) => s.toStopName)).toContain('PMR Arret B');
    for (const it of itineraires) {
      expect(it.accessibility).toBeUndefined();
    }
  });

  it('avec `pmr: true` : le trajet GARANTI est rendu, même plus lent', async () => {
    const reponse = await request(app.getHttpServer())
      .post('/api/routes/search')
      .send({ ...DEPART, ...ARRIVEE, pmr: true })
      .expect(200);

    const itineraires = reponse.body as {
      segments: { toStopName: string }[];
      totalDurationMin: number;
      accessibility: {
        requested: boolean;
        guaranteed: boolean;
        uncertainStops: string[];
      };
    }[];

    expect(itineraires.length).toBeGreaterThanOrEqual(1);
    const trajet = itineraires[0];

    // Le direct A→C : il ne touche jamais B.
    expect(trajet.segments.map((s) => s.toStopName)).toEqual(['PMR Arret C']);
    expect(trajet.accessibility).toEqual({
      requested: true,
      guaranteed: true,
      uncertainStops: [],
    });
  });

  it('`pmr: true` mais aucun trajet garanti : repli honnête, jamais « aucun itinéraire »', async () => {
    // On retire la liaison directe : le seul chemin restant passe par B.
    await prisma.networkLink.deleteMany({
      where: { line: { name: 'PMR Bus direct' } },
    });

    try {
      const reponse = await request(app.getHttpServer())
        .post('/api/routes/search')
        .send({ ...DEPART, ...ARRIVEE, pmr: true })
        .expect(200);

      const [trajet] = reponse.body as {
        segments: { toStopName: string }[];
        accessibility: { guaranteed: boolean; uncertainStops: string[] };
      }[];

      expect(trajet.segments.map((s) => s.toStopName)).toEqual([
        'PMR Arret B',
        'PMR Arret C',
      ]);
      expect(trajet.accessibility.guaranteed).toBe(false);
      expect(trajet.accessibility.uncertainStops).toContain('PMR Arret B');
    } finally {
      // Remettre la liaison directe pour les tests suivants (ordre non garanti).
      const ligneDirect = await prisma.transitLine.findFirst({
        where: { name: 'PMR Bus direct' },
      });
      if (ligneDirect) {
        await prisma.networkLink.create({
          data: {
            lineId: ligneDirect.id,
            fromStopId: stopIds[0],
            toStopId: stopIds[2],
            distanceM: 3000,
            durationMin: 30,
          },
        });
      }
    }
  });

  it('rejette un `pmr` non booléen en 400', async () => {
    await request(app.getHttpServer())
      .post('/api/routes/search')
      .send({ ...DEPART, ...ARRIVEE, pmr: 'oui' })
      .expect(400);
  });
});
