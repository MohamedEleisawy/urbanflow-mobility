// Charge projet/backend/.env (DATABASE_URL, JWT_SECRET...).
// Indispensable ici : en test end-to-end on importe AppModule directement,
// donc main.ts — qui fait normalement ce chargement — n'est jamais exécuté.
import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

// Test d'INTÉGRATION : contrairement aux tests unitaires, on démarre
// réellement l'application et on écrit dans PostgreSQL. Il vérifie donc
// aussi la validation HTTP, le routage et les requêtes Prisma.
describe('POST /api/routes/search (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  // Identifiants des données créées pour ce test, afin de ne supprimer
  // QUE celles-ci à la fin (et pas les données de développement).
  const stopIds: string[] = [];
  let routeId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // On reproduit la configuration de main.ts, sinon la validation et le
    // préfixe /api ne s'appliqueraient pas et le test ne refléterait pas
    // le comportement réel de l'application.
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

    // --- Jeu de données ---------------------------------------------------
    // Coordonnées volontairement placées au large de l'Atlantique (0,0) :
    // aucun risque de collision avec de vraies données de développement.
    const a = await prisma.stop.create({
      data: {
        name: 'E2E Arret A',
        latitude: 0.0,
        longitude: 0.0,
        operatorCode: 'E2E',
      },
    });
    const b = await prisma.stop.create({
      data: {
        name: 'E2E Arret B',
        latitude: 0.01,
        longitude: 0.0,
        operatorCode: 'E2E',
      },
    });
    const c = await prisma.stop.create({
      data: {
        name: 'E2E Arret C',
        latitude: 0.02,
        longitude: 0.0,
        operatorCode: 'E2E',
      },
    });
    stopIds.push(a.id, b.id, c.id);

    // Un segment doit appartenir à une Route (clé étrangère obligatoire).
    // On en crée une sans propriétaire (userId null), ce que le schéma
    // autorise depuis l'étape 4A.
    const route = await prisma.route.create({
      data: {
        originLat: 0,
        originLng: 0,
        destinationLat: 0.02,
        destinationLng: 0,
        totalDurationMin: 0,
        totalDistanceM: 0,
        ecoScore: 0,
        carbonEstimate: 0,
      },
    });
    routeId = route.id;

    const base = new Date('2026-08-15T08:00:00.000Z').getTime();
    const plus = (minutes: number) => new Date(base + minutes * 60_000);

    await prisma.segment.createMany({
      data: [
        // A → B : 10 min, 600 m
        {
          routeId,
          fromStopId: a.id,
          toStopId: b.id,
          mode: 'WALK',
          operator: 'E2E',
          line: '-',
          gtfsTripId: 'e2e-ab',
          distanceM: 600,
          departureTime: plus(0),
          arrivalTime: plus(10),
        },
        // B → C : 10 min, 3200 m   => A→B→C = 20 min / 3800 m
        {
          routeId,
          fromStopId: b.id,
          toStopId: c.id,
          mode: 'BUS',
          operator: 'E2E',
          line: 'Bus 12',
          gtfsTripId: 'e2e-bc',
          distanceM: 3200,
          departureTime: plus(10),
          arrivalTime: plus(20),
        },
        // A → C direct : 30 min, 3000 m  => plus long en temps, plus court
        {
          routeId,
          fromStopId: a.id,
          toStopId: c.id,
          mode: 'BUS',
          operator: 'E2E',
          line: 'Bus 99',
          gtfsTripId: 'e2e-ac',
          distanceM: 3000,
          departureTime: plus(0),
          arrivalTime: plus(30),
        },
      ],
    });
  });

  afterAll(async () => {
    // Nettoyage : segments puis route puis arrêts (ordre imposé par les
    // clés étrangères). On ne supprime que nos propres données.
    if (routeId) {
      await prisma.segment.deleteMany({ where: { routeId } });
      await prisma.route.delete({ where: { id: routeId } });
    }
    if (stopIds.length > 0) {
      await prisma.stop.deleteMany({ where: { id: { in: stopIds } } });
    }
    await app.close();
  });

  it('est accessible SANS authentification et renvoie 200', () => {
    return request(app.getHttpServer())
      .post('/api/routes/search')
      .send({ fromLat: 0, fromLon: 0, toLat: 0.02, toLon: 0 })
      .expect(200);
  });

  it('renvoie deux itinéraires : le plus rapide et le plus court', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/routes/search')
      .send({ fromLat: 0, fromLon: 0, toLat: 0.02, toLon: 0 })
      .expect(200);

    const itineraires = response.body as {
      criterion: string;
      totalDistanceM: number;
      totalDurationMin: number;
      segments: { fromStopName: string; toStopName: string }[];
    }[];

    expect(itineraires).toHaveLength(2);

    const rapide = itineraires.find((i) => i.criterion === 'FASTEST');
    const court = itineraires.find((i) => i.criterion === 'SHORTEST');

    // Le plus rapide passe par B (20 min) plutôt que le direct (30 min).
    expect(rapide?.totalDurationMin).toBe(20);
    expect(rapide?.totalDistanceM).toBe(3800);
    expect(rapide?.segments).toHaveLength(2);

    // Le plus court est le trajet direct (3000 m).
    expect(court?.totalDistanceM).toBe(3000);
    expect(court?.segments).toHaveLength(1);
  });

  it('renvoie le nom des arrêts dans chaque segment', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/routes/search')
      .send({ fromLat: 0, fromLon: 0, toLat: 0.02, toLon: 0 })
      .expect(200);

    const rapide = (
      response.body as {
        criterion: string;
        segments: { fromStopName: string }[];
      }[]
    ).find((i) => i.criterion === 'FASTEST');

    expect(rapide?.segments[0].fromStopName).toBe('E2E Arret A');
  });

  it('ne divulgue aucune donnée personnelle (routeId, userId, horaires)', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/routes/search')
      .send({ fromLat: 0, fromLon: 0, toLat: 0.02, toLon: 0 });

    const json = JSON.stringify(response.body);
    expect(json).not.toContain('routeId');
    expect(json).not.toContain('userId');
    expect(json).not.toContain('departureTime');
  });

  it('renvoie 400 si une coordonnée est hors intervalle', () => {
    return request(app.getHttpServer())
      .post('/api/routes/search')
      .send({ fromLat: 95, fromLon: 0, toLat: 0.02, toLon: 500 })
      .expect(400);
  });

  it('renvoie 400 si une coordonnée est manquante', () => {
    return request(app.getHttpServer())
      .post('/api/routes/search')
      .send({ fromLat: 0, fromLon: 0 })
      .expect(400);
  });

  it('renvoie 400 si un champ inconnu est envoyé', () => {
    return request(app.getHttpServer())
      .post('/api/routes/search')
      .send({
        fromLat: 0,
        fromLon: 0,
        toLat: 0.02,
        toLon: 0,
        userId: 'tentative-injection',
      })
      .expect(400);
  });

  it('renvoie 200 et [] quand aucun itinéraire n’est possible', async () => {
    // On cherche dans le sens inverse : aucun segment ne remonte de C vers A.
    const response = await request(app.getHttpServer())
      .post('/api/routes/search')
      .send({ fromLat: 0.02, fromLon: 0, toLat: 0, toLon: 0 })
      .expect(200);

    expect(response.body).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Étape 4C-2 : bornes, typage strict, rayon de recherche, déterminisme
  // ---------------------------------------------------------------------------

  it('accepte les coordonnées aux bornes exactes (±90 / ±180)', () => {
    // Ces valeurs sont valides : elles doivent passer la validation.
    // Aucun arrêt ne s'y trouve, donc la réponse est un tableau vide —
    // mais surtout PAS une erreur 400.
    return request(app.getHttpServer())
      .post('/api/routes/search')
      .send({ fromLat: 90, fromLon: 180, toLat: -90, toLon: -180 })
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual([]);
      });
  });

  it('refuse une coordonnée envoyée en chaîne de caractères', () => {
    // Le contrat déclare des nombres : "0" doit être refusé (@IsNumber).
    return request(app.getHttpServer())
      .post('/api/routes/search')
      .send({ fromLat: '0', fromLon: 0, toLat: 0.02, toLon: 0 })
      .expect(400);
  });

  it('renvoie [] quand le point demandé est trop éloigné du réseau', async () => {
    // Les arrêts du test sont autour de (0,0). Ce point en est distant de
    // plusieurs centaines de kilomètres : au-delà du rayon de 2 km, on
    // considère qu'aucun arrêt ne le dessert.
    const response = await request(app.getHttpServer())
      .post('/api/routes/search')
      .send({ fromLat: 10, fromLon: 10, toLat: 0.02, toLon: 0 })
      .expect(200);

    expect(response.body).toEqual([]);
  });

  it('renvoie exactement le même résultat pour deux appels identiques', async () => {
    const critere = { fromLat: 0, fromLon: 0, toLat: 0.02, toLon: 0 };

    const premier = await request(app.getHttpServer())
      .post('/api/routes/search')
      .send(critere)
      .expect(200);

    const second = await request(app.getHttpServer())
      .post('/api/routes/search')
      .send(critere)
      .expect(200);

    expect(second.body).toEqual(premier.body);
  });

  it('renvoie des segments chaînés de l’origine vers la destination', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/routes/search')
      .send({ fromLat: 0, fromLon: 0, toLat: 0.02, toLon: 0 })
      .expect(200);

    const rapide = (
      response.body as {
        criterion: string;
        segments: { fromStopId: string; toStopId: string }[];
      }[]
    ).find((i) => i.criterion === 'FASTEST');

    const segments = rapide?.segments ?? [];
    expect(segments.length).toBeGreaterThan(1);

    // Chaque segment repart exactement là où le précédent s'arrête.
    for (let i = 0; i < segments.length - 1; i++) {
      expect(segments[i].toStopId).toBe(segments[i + 1].fromStopId);
    }
  });
});
