// Charge projet/backend/.env (DATABASE_URL, JWT_SECRET...).
import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import {
  bornesSemaineIso,
  semaineIso,
} from './../src/common/date/iso-week.util';

// Tests de bout en bout de GET /api/suivi-carbone/budget (étape 4E-5B), sur
// PostgreSQL réel.
//
// Contrairement au suivi de 4E-5A, cet endpoint interroge une semaine
// DÉSIGNÉE : les fixtures peuvent donc utiliser des dates ABSOLUES sans
// risque de sortir d'une fenêtre glissante. On profite de cette stabilité
// pour couvrir une semaine à cheval sur deux années.
describe('GET /api/suivi-carbone/budget (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const userIds: string[] = [];

  // A a un budget, B en a un autre, C n'a AUCUNE préférence.
  let jetonA: string;
  let userA: string;
  let jetonB: string;
  let userB: string;
  let jetonC: string;
  let userC: string;

  const BUDGET_A = 5000;
  const BUDGET_B = 1000;

  // Semaine 35 de 2026 : lundi 24 → dimanche 30 août.
  const SEMAINE = { year: 2026, week: 35 };
  const MARDI = new Date('2026-08-25T12:00:00.000Z');
  const DIMANCHE_SOIR = new Date('2026-08-30T23:00:00.000Z');
  const LUNDI_SUIVANT = new Date('2026-08-31T00:30:00.000Z');

  interface Budget {
    year: number;
    week: number;
    weeklyBudgetGrams: number | null;
    consumedGrams: number;
    remainingGrams: number | null;
    exceeded: boolean | null;
    tripCount: number;
  }

  const creerUsager = async (suffixe: string, budget?: number) => {
    const email = `e2e-4e5b-${suffixe}-${Date.now()}@example.com`;
    const motDePasse = 'motdepasse-de-test';

    await request(app.getHttpServer())
      .post('/api/users')
      .send({
        email,
        password: motDePasse,
        // Sans `preferences`, l'usager n'a AUCUNE préférence : la relation
        // User → UserPreferences est optionnelle.
        ...(budget === undefined
          ? {}
          : { preferences: { co2BudgetWeekly: budget } }),
      })
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
    co2ParSegment: number[],
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
      data: co2ParSegment.map((co2Grams) => ({
        routeId: route.id,
        userId,
        date,
        mode: 'BUS',
        distanceM: 1000,
        co2Grams,
        savedVsCarGrams: 0,
      })),
    });

    return route.id;
  };

  const budget = async (jeton: string, requete = '') => {
    const reponse = await request(app.getHttpServer())
      .get(`/api/suivi-carbone/budget${requete}`)
      .set('Authorization', `Bearer ${jeton}`)
      .expect(200);

    return reponse.body as Budget;
  };

  const semaine35 = (jeton: string) =>
    budget(jeton, `?year=${SEMAINE.year}&week=${SEMAINE.week}`);

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

    const a = await creerUsager('a', BUDGET_A);
    jetonA = a.jeton;
    userA = a.id;
    const b = await creerUsager('b', BUDGET_B);
    jetonB = b.jeton;
    userB = b.id;
    // C : aucune préférence, donc aucun budget.
    const c = await creerUsager('c');
    jetonC = c.jeton;
    userC = c.id;
  });

  afterEach(async () => {
    await prisma.carbonRecord.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.route.deleteMany({ where: { userId: { in: userIds } } });
  });

  afterAll(async () => {
    // La cascade sur User emporte préférences, routes et carbone.
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  // ===========================================================================
  // Comparaison budget / consommation
  // ===========================================================================
  describe('comparaison', () => {
    it('renvoie le reste quand la consommation est sous le plafond', async () => {
      await creerTrajet(userA, MARDI, [1000, 800]);

      const corps = await semaine35(jetonA);

      expect(corps).toEqual({
        year: 2026,
        week: 35,
        weeklyBudgetGrams: BUDGET_A,
        consumedGrams: 1800,
        remainingGrams: 3200,
        exceeded: false,
        tripCount: 1,
      });
    });

    it('ne considère PAS un budget exactement atteint comme dépassé', async () => {
      // Le cas frontière : `>` et non `>=`. Consommer exactement son
      // budget, c'est le respecter.
      await creerTrajet(userA, MARDI, [BUDGET_A]);

      const corps = await semaine35(jetonA);

      expect(corps.exceeded).toBe(false);
      expect(corps.remainingGrams).toBe(0);
    });

    it('signale un dépassement sans jamais renvoyer de reste négatif', async () => {
      await creerTrajet(userA, MARDI, [6200]);

      const corps = await semaine35(jetonA);

      expect(corps.exceeded).toBe(true);
      expect(corps.consumedGrams).toBe(6200);
      // On ne « doit » pas du carbone : le reste est borné à 0.
      expect(corps.remainingGrams).toBe(0);
    });

    it('renvoie le budget intact quand la semaine est vide', async () => {
      const corps = await semaine35(jetonA);

      expect(corps).toMatchObject({
        weeklyBudgetGrams: BUDGET_A,
        consumedGrams: 0,
        remainingGrams: BUDGET_A,
        exceeded: false,
        tripCount: 0,
      });
    });
  });

  // ===========================================================================
  // tripCount : un trajet = une Route
  // ===========================================================================
  describe('comptage des trajets', () => {
    it('compte UN trajet pour trois enregistrements de la même route', async () => {
      // LE test qui tue la mutation `tripCount = COUNT(CarbonRecord)` :
      // il existe un CarbonRecord par SEGMENT (décision 4E).
      await creerTrajet(userA, MARDI, [100, 200, 300]);

      const corps = await semaine35(jetonA);

      expect(corps.tripCount).toBe(1);
      // Les sommes, elles, portent bien sur les TROIS enregistrements.
      expect(corps.consumedGrams).toBe(600);
    });

    it('compte trois trajets distincts dans la même semaine', async () => {
      await creerTrajet(userA, MARDI, [100, 100]);
      await creerTrajet(userA, MARDI, [100]);
      await creerTrajet(userA, DIMANCHE_SOIR, [100]);

      const corps = await semaine35(jetonA);

      expect(corps.tripCount).toBe(3);
      expect(corps.consumedGrams).toBe(400);
    });
  });

  // ===========================================================================
  // Bornes de la semaine
  // ===========================================================================
  describe('bornes de la semaine', () => {
    it('inclut le dimanche soir et EXCLUT le lundi suivant', async () => {
      // La frontière ISO : la semaine court du lundi 00 h au dimanche
      // 23 h 59, bornes calculées en UTC.
      await creerTrajet(userA, DIMANCHE_SOIR, [500]);
      await creerTrajet(userA, LUNDI_SUIVANT, [9999]);

      const corps = await semaine35(jetonA);

      expect(corps.consumedGrams).toBe(500);
      expect(corps.tripCount).toBe(1);
    });

    it('lit une semaine à cheval sur deux années civiles', async () => {
      // La semaine 1 de 2026 commence le 29 décembre 2025.
      const { debut } = bornesSemaineIso(2026, 1);
      expect(debut.toISOString()).toBe('2025-12-29T00:00:00.000Z');

      await creerTrajet(userA, new Date('2025-12-30T12:00:00.000Z'), [700]);
      await creerTrajet(userA, new Date('2026-01-02T12:00:00.000Z'), [300]);

      const corps = await budget(jetonA, '?year=2026&week=1');

      // Deux dates d'années civiles différentes, une seule semaine ISO.
      expect(corps.consumedGrams).toBe(1000);
      expect(corps.tripCount).toBe(2);
    });

    it('utilise la semaine EN COURS quand aucune n’est demandée', async () => {
      const corps = await budget(jetonA);
      const attendue = semaineIso(new Date());

      expect(corps.year).toBe(attendue.year);
      expect(corps.week).toBe(attendue.week);
      expect(corps.weeklyBudgetGrams).toBe(BUDGET_A);
    });
  });

  // ===========================================================================
  // Usager sans préférences
  // ===========================================================================
  describe('usager sans préférences', () => {
    it('renvoie 200 avec des nulls, sans inventer de plafond', async () => {
      await creerTrajet(userC, MARDI, [1800]);

      const corps = await semaine35(jetonC);

      expect(corps.weeklyBudgetGrams).toBeNull();
      expect(corps.remainingGrams).toBeNull();
      // `false` signifierait « non dépassé » : une affirmation fausse.
      expect(corps.exceeded).toBeNull();
      // La consommation, elle, reste une information valable.
      expect(corps.consumedGrams).toBe(1800);
      expect(corps.tripCount).toBe(1);
    });

    it('renvoie les trois champs de budget nuls ENSEMBLE', async () => {
      const corps = await semaine35(jetonC);

      // Ils sont indissociables : jamais l'un sans les autres.
      expect([
        corps.weeklyBudgetGrams,
        corps.remainingGrams,
        corps.exceeded,
      ]).toEqual([null, null, null]);
    });
  });

  // ===========================================================================
  // Cloisonnement
  // ===========================================================================
  describe('ownership', () => {
    it('ne mélange ni les budgets ni les consommations', async () => {
      await creerTrajet(userA, MARDI, [1000]);
      await creerTrajet(userB, MARDI, [900]);
      await creerTrajet(userB, MARDI, [900]);

      const chezA = await semaine35(jetonA);
      const chezB = await semaine35(jetonB);

      expect(chezA).toMatchObject({
        weeklyBudgetGrams: BUDGET_A,
        consumedGrams: 1000,
        tripCount: 1,
        exceeded: false,
      });
      // B a un budget plus faible ET plus de trajets : il dépasse.
      expect(chezB).toMatchObject({
        weeklyBudgetGrams: BUDGET_B,
        consumedGrams: 1800,
        tripCount: 2,
        exceeded: true,
      });
    });

    it('refuse la requête sans jeton', async () => {
      await request(app.getHttpServer())
        .get('/api/suivi-carbone/budget')
        .expect(401);
    });
  });

  // ===========================================================================
  // Validation des paramètres
  // ===========================================================================
  describe('validation des paramètres', () => {
    const refuse = (requete: string) =>
      request(app.getHttpServer())
        .get(`/api/suivi-carbone/budget${requete}`)
        .set('Authorization', `Bearer ${jetonA}`)
        .expect(400);

    it('refuse week=0', () => refuse('?year=2026&week=0'));
    it('refuse week=54', () => refuse('?year=2026&week=54'));
    it('refuse une année aberrante', () => refuse('?year=1000&week=1'));
    it('refuse une valeur non numérique', () => refuse('?year=2026&week=abc'));
    it('refuse une valeur décimale', () => refuse('?year=2026&week=2.5'));

    // Les deux paramètres vont PAR PAIRE : une année sans semaine, ou
    // l'inverse, ne désigne aucune période.
    it('refuse une année sans semaine', () => refuse('?year=2026'));
    it('refuse une semaine sans année', () => refuse('?week=35'));

    it('refuse un paramètre inconnu comme ?userId=', async () => {
      await refuse(`?userId=${userB}`);
    });

    it('accepte la semaine 53 d’une année qui n’en compte que 52', async () => {
      // 2025 ne compte que 52 semaines : la 53 est simplement vide, ce
      // n'est pas une erreur de saisie.
      const corps = await budget(jetonA, '?year=2025&week=53');

      expect(corps.consumedGrams).toBe(0);
      expect(corps.tripCount).toBe(0);
    });
  });
});
