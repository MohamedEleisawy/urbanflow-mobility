// Charge projet/backend/.env (DATABASE_URL, JWT_SECRET...).
import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { semaineIso } from './../src/common/date/iso-week.util';

// Tests de bout en bout de GET /api/suivi-carbone (étape 4E-5A), sur
// PostgreSQL réel.
//
// ⚠️ LES DATES SONT RELATIVES À « MAINTENANT », jamais absolues. La fenêtre
// de suivi se compte en semaines écoulées : un jeu de test daté d'août 2026
// sortirait de la fenêtre s'il était rejoué un an plus tard, et la suite
// deviendrait rouge sans qu'aucun code n'ait changé.
//
// Les cas limites du calendrier (31 décembre, semaine 53, frontière
// lundi/dimanche) sont testés ailleurs, sur dates ABSOLUES, dans
// iso-week.util.spec.ts — là où ils sont déterministes.
describe('GET /api/suivi-carbone (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const userIds: string[] = [];

  let jetonA: string;
  let userA: string;
  let jetonB: string;
  let userB: string;

  const JOUR = 86_400_000;

  /** Mardi (midi UTC) de la semaine située `semaines` avant la courante. */
  const mardiIlYA = (semaines: number) => {
    const maintenant = new Date();
    const jourIso = maintenant.getUTCDay() === 0 ? 7 : maintenant.getUTCDay();
    const lundi = new Date(
      Date.UTC(
        maintenant.getUTCFullYear(),
        maintenant.getUTCMonth(),
        maintenant.getUTCDate(),
      ) -
        (jourIso - 1) * JOUR,
    );
    // Mardi 12 h : au cœur de la semaine, loin de toute frontière.
    return new Date(lundi.getTime() - semaines * 7 * JOUR + JOUR + JOUR / 2);
  };

  interface Suivi {
    weeks: {
      year: number;
      week: number;
      co2Grams: number;
      savedVsCarGrams: number;
      tripCount: number;
    }[];
    weeksRequested: number;
  }

  const creerUsager = async (suffixe: string) => {
    const email = `e2e-4e5a-${suffixe}-${Date.now()}@example.com`;
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

  /** Crée une Route et ses `segments` enregistrements carbone, tous datés pareil. */
  const creerTrajet = async (
    userId: string,
    date: Date,
    segments: { co2Grams: number; savedVsCarGrams: number }[],
  ) => {
    const route = await prisma.route.create({
      data: {
        userId,
        requestedAt: date,
        originLat: 45.0,
        originLng: 5.0,
        destinationLat: 45.01,
        destinationLng: 5.0,
        totalDurationMin: 22,
        totalDistanceM: 3800,
        ecoScore: 56.3,
        carbonEstimate: 361.6,
      },
    });

    await prisma.carbonRecord.createMany({
      data: segments.map((segment) => ({
        routeId: route.id,
        userId,
        date,
        mode: 'BUS',
        distanceM: 1000,
        co2Grams: segment.co2Grams,
        savedVsCarGrams: segment.savedVsCarGrams,
      })),
    });

    return route.id;
  };

  const suivi = async (jeton: string, requete = '') => {
    const reponse = await request(app.getHttpServer())
      .get(`/api/suivi-carbone${requete}`)
      .set('Authorization', `Bearer ${jeton}`)
      .expect(200);

    return reponse.body as Suivi;
  };

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

    const a = await creerUsager('a');
    jetonA = a.jeton;
    userA = a.id;
    const b = await creerUsager('b');
    jetonB = b.jeton;
    userB = b.id;
  });

  afterEach(async () => {
    // Filtré par NOS identifiants : les suites e2e partagent la base.
    await prisma.carbonRecord.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.route.deleteMany({ where: { userId: { in: userIds } } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  // ===========================================================================
  // Agrégation
  // ===========================================================================
  describe('agrégation hebdomadaire', () => {
    it('renvoie le bilan d’une semaine', async () => {
      const date = mardiIlYA(1);
      await creerTrajet(userA, date, [
        { co2Grams: 0, savedVsCarGrams: 130.8 },
        { co2Grams: 361.6, savedVsCarGrams: 336.0 },
      ]);

      const corps = await suivi(jetonA);
      const attendue = semaineIso(date);

      expect(corps.weeks).toHaveLength(1);
      expect(corps.weeks[0]).toEqual({
        year: attendue.year,
        week: attendue.week,
        co2Grams: 361.6,
        savedVsCarGrams: 466.8,
        tripCount: 1,
      });
    });

    it('sépare les semaines et les trie de la plus récente à la plus ancienne', async () => {
      await creerTrajet(userA, mardiIlYA(1), [
        { co2Grams: 100, savedVsCarGrams: 200 },
      ]);
      await creerTrajet(userA, mardiIlYA(3), [
        { co2Grams: 50, savedVsCarGrams: 80 },
      ]);

      const corps = await suivi(jetonA);

      expect(corps.weeks).toHaveLength(2);
      const recente = semaineIso(mardiIlYA(1));
      expect(corps.weeks[0]).toMatchObject({
        year: recente.year,
        week: recente.week,
        co2Grams: 100,
      });
      expect(corps.weeks[1].co2Grams).toBe(50);
    });

    it('n’invente aucune semaine vide entre deux trajets', async () => {
      // Trajets à 1 et 4 semaines : les semaines 2 et 3 sont absentes, non
      // renvoyées à zéro (décision de conception validée).
      await creerTrajet(userA, mardiIlYA(1), [
        { co2Grams: 10, savedVsCarGrams: 10 },
      ]);
      await creerTrajet(userA, mardiIlYA(4), [
        { co2Grams: 10, savedVsCarGrams: 10 },
      ]);

      const corps = await suivi(jetonA);

      expect(corps.weeks).toHaveLength(2);
    });
  });

  // ===========================================================================
  // tripCount : un trajet = une Route
  // ===========================================================================
  describe('comptage des trajets', () => {
    it('compte UN trajet pour trois enregistrements de la même route', async () => {
      // LE test de cette étape : il existe un CarbonRecord par SEGMENT.
      // Compter les lignes donnerait 3 trajets au lieu d'1.
      await creerTrajet(userA, mardiIlYA(1), [
        { co2Grams: 0, savedVsCarGrams: 130.8 },
        { co2Grams: 361.6, savedVsCarGrams: 336.0 },
        { co2Grams: 0, savedVsCarGrams: 109.0 },
      ]);

      const corps = await suivi(jetonA);

      expect(corps.weeks[0].tripCount).toBe(1);
      // Les sommes, elles, portent bien sur les TROIS enregistrements.
      expect(corps.weeks[0].savedVsCarGrams).toBe(575.8);
    });

    it('compte trois trajets distincts dans la même semaine', async () => {
      const date = mardiIlYA(1);
      await creerTrajet(userA, date, [{ co2Grams: 10, savedVsCarGrams: 10 }]);
      await creerTrajet(userA, date, [{ co2Grams: 10, savedVsCarGrams: 10 }]);
      await creerTrajet(userA, date, [{ co2Grams: 10, savedVsCarGrams: 10 }]);

      const corps = await suivi(jetonA);

      expect(corps.weeks[0].tripCount).toBe(3);
      expect(corps.weeks[0].co2Grams).toBe(30);
    });
  });

  // ===========================================================================
  // Fenêtre
  // ===========================================================================
  describe('fenêtre de suivi', () => {
    it('applique 12 semaines par défaut', async () => {
      const corps = await suivi(jetonA);

      expect(corps.weeksRequested).toBe(12);
    });

    it('exclut les trajets antérieurs à la fenêtre', async () => {
      await creerTrajet(userA, mardiIlYA(1), [
        { co2Grams: 10, savedVsCarGrams: 10 },
      ]);
      // 10 semaines en arrière : dans la fenêtre par défaut, hors d'une
      // fenêtre de 2.
      await creerTrajet(userA, mardiIlYA(10), [
        { co2Grams: 99, savedVsCarGrams: 99 },
      ]);

      expect((await suivi(jetonA, '?weeks=12')).weeks).toHaveLength(2);

      const etroite = await suivi(jetonA, '?weeks=2');
      expect(etroite.weeks).toHaveLength(1);
      expect(etroite.weeks[0].co2Grams).toBe(10);
      expect(etroite.weeksRequested).toBe(2);
    });

    it('inclut la semaine courante avec weeks=1', async () => {
      await creerTrajet(userA, mardiIlYA(0), [
        { co2Grams: 42, savedVsCarGrams: 8 },
      ]);
      await creerTrajet(userA, mardiIlYA(1), [
        { co2Grams: 99, savedVsCarGrams: 99 },
      ]);

      const corps = await suivi(jetonA, '?weeks=1');

      expect(corps.weeks).toHaveLength(1);
      expect(corps.weeks[0].co2Grams).toBe(42);
    });

    it('accepte la fenêtre maximale de 52 semaines', async () => {
      const corps = await suivi(jetonA, '?weeks=52');

      expect(corps.weeksRequested).toBe(52);
    });

    it('renvoie une liste vide pour un usager sans trajet', async () => {
      const corps = await suivi(jetonA);

      expect(corps).toEqual({ weeks: [], weeksRequested: 12 });
    });
  });

  // ===========================================================================
  // Validation des paramètres
  // ===========================================================================
  describe('validation des paramètres', () => {
    const refuse = (requete: string) =>
      request(app.getHttpServer())
        .get(`/api/suivi-carbone${requete}`)
        .set('Authorization', `Bearer ${jetonA}`)
        .expect(400);

    // Aucun rabotage silencieux : une valeur hors bornes est REFUSÉE.
    it('refuse weeks=0', () => refuse('?weeks=0'));
    it('refuse weeks=53', () => refuse('?weeks=53'));
    it('refuse weeks=-1', () => refuse('?weeks=-1'));
    it('refuse une valeur non numérique', () => refuse('?weeks=douze'));
    it('refuse une valeur décimale', () => refuse('?weeks=2.5'));

    it('refuse un paramètre inconnu comme ?userId=', async () => {
      // Tenter de lire le suivi d'autrui par l'URL.
      await refuse(`?userId=${userB}`);
    });
  });

  // ===========================================================================
  // Cloisonnement
  // ===========================================================================
  describe('ownership', () => {
    it('ne renvoie à chacun que SES propres données', async () => {
      const date = mardiIlYA(1);
      await creerTrajet(userA, date, [{ co2Grams: 100, savedVsCarGrams: 200 }]);
      await creerTrajet(userB, date, [{ co2Grams: 999, savedVsCarGrams: 999 }]);
      await creerTrajet(userB, date, [{ co2Grams: 999, savedVsCarGrams: 999 }]);

      const chezA = await suivi(jetonA);
      const chezB = await suivi(jetonB);

      // Aucune donnée de B ne fuit chez A : ni dans les sommes, ni dans le
      // nombre de trajets.
      expect(chezA.weeks[0]).toMatchObject({ co2Grams: 100, tripCount: 1 });
      expect(chezB.weeks[0]).toMatchObject({ co2Grams: 1998, tripCount: 2 });
    });

    it('refuse la requête sans jeton', async () => {
      await request(app.getHttpServer()).get('/api/suivi-carbone').expect(401);
    });
  });
});
