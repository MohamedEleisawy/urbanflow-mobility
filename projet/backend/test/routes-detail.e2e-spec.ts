// Charge projet/backend/.env (DATABASE_URL, JWT_SECRET...).
import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

// Tests de bout en bout de GET /api/routes/:id et de DELETE /api/routes/:id
// (étape 4E-4B), sur PostgreSQL réel.
//
// Deux choses ne se prouvent QUE sur une vraie base : l'ordre réellement
// rendu par un `orderBy`, et les suppressions en cascade — qui sont des
// contraintes PostgreSQL, pas du code applicatif.
describe('GET / DELETE /api/routes/:id (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const userIds: string[] = [];
  const stopIds: string[] = [];

  let jetonA: string;
  let userA: string;
  let jetonB: string;
  let stopA: string;
  let stopB: string;
  let stopC: string;

  const T0 = new Date('2026-08-10T08:00:00.000Z');
  const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

  interface RouteDetaillee {
    id: string;
    segments: { id: string; line: string; departureTime: string }[];
    carbonRecords: { id: string; mode: string; distanceM: number }[];
  }

  const creerUsager = async (suffixe: string) => {
    const email = `e2e-4e4b-${suffixe}-${Date.now()}@example.com`;
    const motDePasse = 'motdepasse-de-test';

    await request(app.getHttpServer())
      .post('/api/users')
      .send({ email, password: motDePasse })
      .expect(201);

    const connexion = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: motDePasse })
      .expect(200);

    const usager = await prisma.user.findUniqueOrThrow({ where: { email } });
    userIds.push(usager.id);

    return {
      jeton: (connexion.body as { accessToken: string }).accessToken,
      id: usager.id,
    };
  };

  /**
   * Crée un trajet de trois segments, ses trois enregistrements carbone.
   *
   * ⚠️ Les segments sont insérés dans le DÉSORDRE volontairement : le
   * dernier du trajet d'abord, le premier en dernier. Sans cette précaution,
   * un `orderBy` manquant passerait inaperçu — PostgreSQL rendrait
   * probablement les lignes dans l'ordre d'insertion, qui serait alors le
   * bon par accident.
   */
  const creerTrajet = async (userId: string) => {
    const route = await prisma.route.create({
      data: {
        userId,
        requestedAt: T0,
        originLat: 45.0,
        originLng: 5.0,
        destinationLat: 45.01,
        destinationLng: 5.0,
        totalDurationMin: 30,
        totalDistanceM: 4300,
        ecoScore: 56.3,
        carbonEstimate: 361.6,
      },
    });

    const segment = (
      line: string,
      minuteDepart: number,
      minuteArrivee: number,
      fromStopId: string,
      toStopId: string,
      distanceM: number,
    ) =>
      prisma.segment.create({
        data: {
          routeId: route.id,
          mode: 'BUS',
          operator: '4E4B',
          line,
          distanceM,
          fromStopId,
          toStopId,
          departureTime: minutes(minuteDepart),
          arrivalTime: minutes(minuteArrivee),
        },
      });

    // Insertion : TROISIÈME, PREMIER, DEUXIÈME.
    await segment('3-dernier', 20, 30, stopC, stopA, 500);
    await segment('1-premier', 0, 10, stopA, stopB, 600);
    await segment('2-milieu', 10, 20, stopB, stopC, 3200);

    await prisma.carbonRecord.createMany({
      data: [
        {
          routeId: route.id,
          userId,
          date: T0,
          mode: 'WALK',
          distanceM: 600,
          co2Grams: 0,
          savedVsCarGrams: 130.8,
        },
        {
          routeId: route.id,
          userId,
          date: T0,
          mode: 'BUS',
          distanceM: 3200,
          co2Grams: 361.6,
          savedVsCarGrams: 336.0,
        },
        {
          routeId: route.id,
          userId,
          date: T0,
          mode: 'WALK',
          distanceM: 500,
          co2Grams: 0,
          savedVsCarGrams: 109.0,
        },
      ],
    });

    return route.id;
  };

  const compter = async (routeId: string) => ({
    routes: await prisma.route.count({ where: { id: routeId } }),
    segments: await prisma.segment.count({ where: { routeId } }),
    carbonRecords: await prisma.carbonRecord.count({ where: { routeId } }),
  });

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

    // Arrêts placés au large de l'Atlantique Sud : les suites e2e tournent
    // EN PARALLÈLE et `findNearestStop` parcourt TOUS les arrêts (leçon
    // 4C-4-4).
    const creerArret = async (nom: string, latitude: number) => {
      const arret = await prisma.stop.create({
        data: { name: nom, latitude, longitude: -30.0, operatorCode: '4E4B' },
      });
      stopIds.push(arret.id);
      return arret.id;
    };

    stopA = await creerArret('4E4B Arret A', -25.0);
    stopB = await creerArret('4E4B Arret B', -25.01);
    stopC = await creerArret('4E4B Arret C', -25.02);

    const a = await creerUsager('a');
    jetonA = a.jeton;
    userA = a.id;
    // Seul le JETON de B sert ici : cette suite teste ce que B ne peut PAS
    // faire, jamais ce qu'il possède.
    jetonB = (await creerUsager('b')).jeton;
  });

  afterEach(async () => {
    await prisma.carbonRecord.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.segment.deleteMany({
      where: { route: { userId: { in: userIds } } },
    });
    await prisma.route.deleteMany({ where: { userId: { in: userIds } } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    // Les segments référencent les arrêts en RESTRICT : ils doivent avoir
    // disparu avant, ce que la cascade sur les usagers a déjà fait.
    await prisma.stop.deleteMany({ where: { id: { in: stopIds } } });
    await app.close();
  });

  // ===========================================================================
  // Le détail
  // ===========================================================================
  describe('lecture du détail', () => {
    it('renvoie 200 avec la route, ses segments et son carbone', async () => {
      const routeId = await creerTrajet(userA);

      const reponse = await request(app.getHttpServer())
        .get(`/api/routes/${routeId}`)
        .set('Authorization', `Bearer ${jetonA}`)
        .expect(200);

      const detail = reponse.body as RouteDetaillee;

      expect(detail.id).toBe(routeId);
      expect(detail.segments).toHaveLength(3);
      expect(detail.carbonRecords).toHaveLength(3);
    });

    it('renvoie les segments dans l’ordre CHRONOLOGIQUE', async () => {
      // Les segments ont été insérés dans le désordre (3, 1, 2) : si
      // l'orderBy disparaissait, PostgreSQL les rendrait probablement dans
      // cet ordre d'insertion, et ce test le verrait.
      const routeId = await creerTrajet(userA);

      const reponse = await request(app.getHttpServer())
        .get(`/api/routes/${routeId}`)
        .set('Authorization', `Bearer ${jetonA}`)
        .expect(200);

      const detail = reponse.body as RouteDetaillee;

      expect(detail.segments.map((s) => s.line)).toEqual([
        '1-premier',
        '2-milieu',
        '3-dernier',
      ]);

      // Et chaque segment repart bien après l'arrivée du précédent.
      const departs = detail.segments.map((s) =>
        new Date(s.departureTime).getTime(),
      );
      expect(departs[0]).toBeLessThan(departs[1]);
      expect(departs[1]).toBeLessThan(departs[2]);
    });

    it('renvoie les enregistrements carbone dans un ordre DÉTERMINISTE', async () => {
      const routeId = await creerTrajet(userA);

      const premier = await request(app.getHttpServer())
        .get(`/api/routes/${routeId}`)
        .set('Authorization', `Bearer ${jetonA}`)
        .expect(200);
      const second = await request(app.getHttpServer())
        .get(`/api/routes/${routeId}`)
        .set('Authorization', `Bearer ${jetonA}`)
        .expect(200);

      const distances = (r: { body: unknown }) =>
        (r.body as RouteDetaillee).carbonRecords.map((c) => c.distanceM);

      // Le plus gros contributeur d'abord, et deux appels identiques
      // donnent exactement le même ordre.
      expect(distances(premier)).toEqual([3200, 600, 500]);
      expect(distances(second)).toEqual(distances(premier));
    });

    it('garde les enregistrements carbone dans un tableau SÉPARÉ', async () => {
      // `CarbonRecord` n'a pas de `segmentId` : rapprocher les deux
      // tableaux position par position serait une association inventée.
      // L'usage fiable est l'agrégation par mode.
      const routeId = await creerTrajet(userA);

      const reponse = await request(app.getHttpServer())
        .get(`/api/routes/${routeId}`)
        .set('Authorization', `Bearer ${jetonA}`)
        .expect(200);

      const detail = reponse.body as RouteDetaillee;

      for (const segment of detail.segments) {
        expect(segment).not.toHaveProperty('carbonRecord');
        expect(segment).not.toHaveProperty('co2Grams');
      }

      // L'agrégation par mode, elle, est exacte.
      const parMode = new Map<string, number>();
      for (const enregistrement of detail.carbonRecords) {
        parMode.set(
          enregistrement.mode,
          (parMode.get(enregistrement.mode) ?? 0) + enregistrement.distanceM,
        );
      }
      expect(parMode.get('WALK')).toBe(1100);
      expect(parMode.get('BUS')).toBe(3200);
    });
  });

  // ===========================================================================
  // Sécurité de la lecture
  // ===========================================================================
  describe('sécurité de la lecture', () => {
    it('renvoie EXACTEMENT la même 404 pour un trajet inexistant et pour celui d’un autre', async () => {
      const routeDeA = await creerTrajet(userA);
      const inexistante = '00000000-0000-4000-8000-000000000000';

      const chezAutrui = await request(app.getHttpServer())
        .get(`/api/routes/${routeDeA}`)
        .set('Authorization', `Bearer ${jetonB}`)
        .expect(404);

      const introuvable = await request(app.getHttpServer())
        .get(`/api/routes/${inexistante}`)
        .set('Authorization', `Bearer ${jetonB}`)
        .expect(404);

      // Deux messages différents révéleraient qu'un itinéraire existe bel
      // et bien — et donc à quelqu'un d'autre.
      expect((chezAutrui.body as { message: string }).message).toBe(
        `Itinéraire ${routeDeA} introuvable`,
      );
      expect((introuvable.body as { message: string }).message).toBe(
        `Itinéraire ${inexistante} introuvable`,
      );
    });

    it('refuse la requête sans jeton', async () => {
      const routeId = await creerTrajet(userA);

      await request(app.getHttpServer())
        .get(`/api/routes/${routeId}`)
        .expect(401);
    });

    it('refuse un identifiant qui n’est pas un UUID', async () => {
      await request(app.getHttpServer())
        .get('/api/routes/pas-un-uuid')
        .set('Authorization', `Bearer ${jetonA}`)
        .expect(400);
    });
  });

  // ===========================================================================
  // Suppression et cascades — l'angle mort comblé
  // ===========================================================================
  describe('suppression', () => {
    it('supprime la route ET tout ce qui en dépend', async () => {
      const routeId = await creerTrajet(userA);

      // Avant : tout est là.
      expect(await compter(routeId)).toEqual({
        routes: 1,
        segments: 3,
        carbonRecords: 3,
      });

      await request(app.getHttpServer())
        .delete(`/api/routes/${routeId}`)
        .set('Authorization', `Bearer ${jetonA}`)
        .expect(204);

      // Après : PostgreSQL a tout emporté. Le service ne supprime QUE la
      // route ; les segments et le carbone disparaissent par les cascades
      // déclarées sur leurs clés étrangères.
      expect(await compter(routeId)).toEqual({
        routes: 0,
        segments: 0,
        carbonRecords: 0,
      });
    });

    it('empêche B de supprimer le trajet de A, et NE TOUCHE À RIEN', async () => {
      const routeDeA = await creerTrajet(userA);

      await request(app.getHttpServer())
        .delete(`/api/routes/${routeDeA}`)
        .set('Authorization', `Bearer ${jetonB}`)
        .expect(404);

      // Le point capital : un 404 ne suffit pas à prouver l'innocuité.
      // On vérifie que rien n'a bougé en base.
      expect(await compter(routeDeA)).toEqual({
        routes: 1,
        segments: 3,
        carbonRecords: 3,
      });
    });

    it('refuse la suppression sans jeton', async () => {
      const routeId = await creerTrajet(userA);

      await request(app.getHttpServer())
        .delete(`/api/routes/${routeId}`)
        .expect(401);

      expect((await compter(routeId)).routes).toBe(1);
    });
  });
});
