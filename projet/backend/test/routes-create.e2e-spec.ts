// Charge projet/backend/.env (DATABASE_URL, JWT_SECRET...).
import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

// Tests de bout en bout de POST /api/routes (étape 4E-3C).
//
// C'est la première couverture e2e de cet endpoint, qui existe pourtant
// depuis l'étape 4A : jusqu'ici, rien ne prouvait qu'il se comportait
// réellement comme annoncé.
//
// PostgreSQL est RÉEL : après chaque création, on interroge la base pour
// vérifier ce qui y a été écrit — et surtout, dans les cas d'erreur, ce qui
// ne l'a PAS été.
//
// SEUL l'appel réseau vers FastAPI est simulé, en remplaçant `fetch`. Ce
// choix est délibéré : CarbonService reste le VRAI service, avec sa
// traduction des 422 et des 503. Remplacer le service entier par un faux
// aurait testé le test plutôt que le code.
describe('POST /api/routes (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  // Identifiants créés par cette suite, pour ne nettoyer QUE nos données.
  const stopIds: string[] = [];
  const lineIds: string[] = [];
  const userIds: string[] = [];

  let stopA: string;
  let stopB: string;
  let stopC: string;
  let stopD: string;
  let stopE: string;
  let ligneMarche: string;
  let ligneBus: string;
  let ligneIsolee: string;
  let ligneTrottinette: string;

  let jetonA: string;
  let userA: string;
  let jetonB: string;
  let userB: string;

  // ---------------------------------------------------------------------------
  // Réponse type du microservice pour 600 m à pied puis 3200 m en bus.
  //
  // Ce sont les valeurs RÉELLEMENT mesurées à l'étape 4D-1. Elles servent de
  // fixture : les tests ne recalculent aucun facteur d'émission, la seule
  // source de vérité restant le microservice.
  // ---------------------------------------------------------------------------
  const REPONSE_FASTAPI = {
    total_distance_m: 3800,
    total_co2_g: 361.6,
    car_co2_g: 828.4,
    saved_g: 466.8,
    eco_score: 56.3,
    breakdown: [
      { mode: 'WALK', distance_m: 600, co2_g: 0.0 },
      { mode: 'BUS', distance_m: 3200, co2_g: 361.6 },
    ],
  };

  const simulerFastApi = (corps: unknown, status = 200) =>
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(corps), { status }));

  const corpsValide = () => ({
    originLat: 12.0,
    originLng: 100.0,
    destinationLat: 12.02,
    destinationLng: 100.0,
    segments: [
      { lineId: ligneMarche, fromStopId: stopA, toStopId: stopB },
      { lineId: ligneBus, fromStopId: stopB, toStopId: stopC },
    ],
  });

  // Compte ce qui appartient à un usager donné : c'est ainsi qu'on prouve
  // qu'un échec n'a RIEN laissé derrière lui.
  const compter = async (userId: string) => ({
    routes: await prisma.route.count({ where: { userId } }),
    segments: await prisma.segment.count({ where: { route: { userId } } }),
    carbonRecords: await prisma.carbonRecord.count({ where: { userId } }),
  });

  const creerUsager = async (suffixe: string) => {
    const email = `e2e-4e3c-${suffixe}-${Date.now()}@example.com`;
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

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    // logger: false — les tests d'erreur journalisent VOLONTAIREMENT.
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

    // Arrêts placés au large du golfe de Thaïlande : les suites e2e tournent
    // EN PARALLÈLE et `findNearestStop` parcourt TOUS les arrêts. Trop près
    // de ceux d'une autre suite, ils fausseraient sa recherche (leçon 4C-4-4).
    const creerArret = async (nom: string, latitude: number) => {
      const arret = await prisma.stop.create({
        data: { name: nom, latitude, longitude: 100.0, operatorCode: '4E3C' },
      });
      stopIds.push(arret.id);
      return arret.id;
    };

    stopA = await creerArret('4E3C Arret A', 12.0);
    stopB = await creerArret('4E3C Arret B', 12.01);
    stopC = await creerArret('4E3C Arret C', 12.02);
    stopD = await creerArret('4E3C Arret D', 12.5);
    stopE = await creerArret('4E3C Arret E', 12.51);

    const creerLigne = async (
      name: string,
      mode: 'WALK' | 'BUS' | 'ESCOOTER',
      operator: string,
    ) => {
      const ligne = await prisma.transitLine.create({
        data: { name, mode, operator },
      });
      lineIds.push(ligne.id);
      return ligne.id;
    };

    ligneMarche = await creerLigne('4E3C À pied', 'WALK', 'RATP');
    ligneBus = await creerLigne('4E3C Bus 38', 'BUS', 'Transdev');
    ligneIsolee = await creerLigne('4E3C Bus isolé', 'BUS', 'RATP');
    // ESCOOTER existe dans l'enum Prisma mais n'a AUCUN facteur d'émission
    // côté microservice (étape 4D-1) : le réseau l'accepte, le calcul non.
    ligneTrottinette = await creerLigne('4E3C Trottinette', 'ESCOOTER', 'Tier');

    await prisma.networkLink.createMany({
      data: [
        // A → B → C : le trajet nominal (600 m / 10 min, puis 3200 m / 12 min)
        {
          lineId: ligneMarche,
          fromStopId: stopA,
          toStopId: stopB,
          distanceM: 600,
          durationMin: 10,
        },
        {
          lineId: ligneBus,
          fromStopId: stopB,
          toStopId: stopC,
          distanceM: 3200,
          durationMin: 12,
        },
        // D → E : valide en soi, mais sans lien avec A → B (test du chaînage)
        {
          lineId: ligneIsolee,
          fromStopId: stopD,
          toStopId: stopE,
          distanceM: 1000,
          durationMin: 5,
        },
        // A → B en trottinette : liaison RÉELLE, mais incalculable
        {
          lineId: ligneTrottinette,
          fromStopId: stopA,
          toStopId: stopB,
          distanceM: 500,
          durationMin: 3,
        },
      ],
    });

    const a = await creerUsager('a');
    jetonA = a.jeton;
    userA = a.id;
    const b = await creerUsager('b');
    jetonB = b.jeton;
    userB = b.id;
  });

  afterEach(async () => {
    jest.restoreAllMocks();

    // Chaque test repart d'un historique vide, sans jamais toucher aux
    // données des autres suites : tout est filtré par NOS identifiants.
    await prisma.carbonRecord.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.segment.deleteMany({
      where: { route: { userId: { in: userIds } } },
    });
    await prisma.route.deleteMany({ where: { userId: { in: userIds } } });
  });

  afterAll(async () => {
    // Ordre imposé par les clés étrangères.
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.networkLink.deleteMany({
      where: { fromStopId: { in: stopIds } },
    });
    await prisma.stop.deleteMany({ where: { id: { in: stopIds } } });
    await prisma.transitLine.deleteMany({ where: { id: { in: lineIds } } });
    await app.close();
  });

  // ===========================================================================
  // Cas nominal
  // ===========================================================================
  describe('création nominale', () => {
    it('renvoie 201 avec la route et ses segments', async () => {
      simulerFastApi(REPONSE_FASTAPI);

      const reponse = await request(app.getHttpServer())
        .post('/api/routes')
        .set('Authorization', `Bearer ${jetonA}`)
        .send(corpsValide())
        .expect(201);

      const route = reponse.body as Record<string, unknown>;

      expect(route).toMatchObject({
        originLat: 12.0,
        originLng: 100.0,
        destinationLat: 12.02,
        destinationLng: 100.0,
        // Calculés par le SERVEUR : 600 + 3200 et 10 + 12.
        totalDistanceM: 3800,
        totalDurationMin: 22,
        // Venus du microservice, plus jamais du client.
        carbonEstimate: 361.6,
        ecoScore: 56.3,
        userId: userA,
      });
      expect(route.id).toEqual(expect.any(String));
      expect(route.requestedAt).toEqual(expect.any(String));
      expect(route.segments).toHaveLength(2);
    });

    it('écrit bien 1 route, 2 segments et 2 enregistrements carbone', async () => {
      simulerFastApi(REPONSE_FASTAPI);

      await request(app.getHttpServer())
        .post('/api/routes')
        .set('Authorization', `Bearer ${jetonA}`)
        .send(corpsValide())
        .expect(201);

      expect(await compter(userA)).toEqual({
        routes: 1,
        segments: 2,
        carbonRecords: 2,
      });
    });

    it('reprend les données du RÉSEAU pour chaque segment', async () => {
      simulerFastApi(REPONSE_FASTAPI);

      const reponse = await request(app.getHttpServer())
        .post('/api/routes')
        .set('Authorization', `Bearer ${jetonA}`)
        .send(corpsValide())
        .expect(201);

      const routeId = (reponse.body as { id: string }).id;
      const segments = await prisma.segment.findMany({
        where: { routeId },
        orderBy: { departureTime: 'asc' },
      });

      expect(segments[0]).toMatchObject({
        routeId,
        mode: 'WALK',
        line: '4E3C À pied',
        operator: 'RATP',
        distanceM: 600,
        fromStopId: stopA,
        toStopId: stopB,
        // Un itinéraire bâti sur des liaisons AGRÉGÉES ne correspond à aucun
        // passage GTFS précis (étapes 4C-4-4 et 4E-1).
        gtfsTripId: null,
      });
      expect(segments[1]).toMatchObject({
        routeId,
        mode: 'BUS',
        line: '4E3C Bus 38',
        operator: 'Transdev',
        distanceM: 3200,
        fromStopId: stopB,
        toStopId: stopC,
        gtfsTripId: null,
      });
    });

    it("n'envoie au microservice que le mode et la distance du réseau", async () => {
      const appel = simulerFastApi(REPONSE_FASTAPI);

      await request(app.getHttpServer())
        .post('/api/routes')
        .set('Authorization', `Bearer ${jetonA}`)
        .send(corpsValide())
        .expect(201);

      const corps: unknown = JSON.parse(appel.mock.calls[0][1]?.body as string);
      expect(corps).toEqual({
        segments: [
          { mode: 'WALK', distance_m: 600 },
          { mode: 'BUS', distance_m: 3200 },
        ],
      });
    });
  });

  // ===========================================================================
  // Horaires estimés
  // ===========================================================================
  describe('horaires estimés', () => {
    it('enchaîne les horaires depuis requestedAt, sans trou', async () => {
      // ⚠️ Ce sont des horaires ESTIMÉS, reconstruits à partir des durées
      // MÉDIANES du réseau — jamais des horaires GTFS réels.
      simulerFastApi(REPONSE_FASTAPI);

      const reponse = await request(app.getHttpServer())
        .post('/api/routes')
        .set('Authorization', `Bearer ${jetonA}`)
        .send(corpsValide())
        .expect(201);

      const routeId = (reponse.body as { id: string }).id;
      const route = await prisma.route.findUniqueOrThrow({
        where: { id: routeId },
      });
      const [premier, second] = await prisma.segment.findMany({
        where: { routeId },
        orderBy: { departureTime: 'asc' },
      });

      // Le trajet commence à l'instant de l'enregistrement.
      expect(premier.departureTime.getTime()).toBe(route.requestedAt.getTime());
      // Chaque segment dure exactement ce que dit le réseau.
      expect(
        premier.arrivalTime.getTime() - premier.departureTime.getTime(),
      ).toBe(10 * 60_000);
      expect(
        second.arrivalTime.getTime() - second.departureTime.getTime(),
      ).toBe(12 * 60_000);
      // Et le suivant repart EXACTEMENT à l'arrivée du précédent : pas de trou.
      expect(second.departureTime.getTime()).toBe(
        premier.arrivalTime.getTime(),
      );
    });
  });

  // ===========================================================================
  // Enregistrements carbone
  // ===========================================================================
  describe('enregistrements carbone', () => {
    it('crée un enregistrement par segment, dans le bon ordre', async () => {
      simulerFastApi(REPONSE_FASTAPI);

      const reponse = await request(app.getHttpServer())
        .post('/api/routes')
        .set('Authorization', `Bearer ${jetonA}`)
        .send(corpsValide())
        .expect(201);

      const routeId = (reponse.body as { id: string }).id;
      const enregistrements = await prisma.carbonRecord.findMany({
        where: { routeId },
        orderBy: { distanceM: 'asc' },
      });

      expect(enregistrements).toHaveLength(2);
      // Une inversion associerait les 361,6 g du bus au segment à pied.
      expect(enregistrements[0]).toMatchObject({
        mode: 'WALK',
        distanceM: 600,
        co2Grams: 0,
        userId: userA,
        routeId,
      });
      expect(enregistrements[1]).toMatchObject({
        mode: 'BUS',
        distanceM: 3200,
        co2Grams: 361.6,
        userId: userA,
        routeId,
      });
    });

    it('répartit l’économie proportionnellement à la distance', async () => {
      simulerFastApi(REPONSE_FASTAPI);

      const reponse = await request(app.getHttpServer())
        .post('/api/routes')
        .set('Authorization', `Bearer ${jetonA}`)
        .send(corpsValide())
        .expect(201);

      const enregistrements = await prisma.carbonRecord.findMany({
        where: { routeId: (reponse.body as { id: string }).id },
        orderBy: { distanceM: 'asc' },
      });

      // Référence voiture du segment = car_co2_g x (distance / distance totale),
      // valeurs venant TOUTES du microservice (aucun facteur recopié ici) :
      //   à pied : 828,4 x 600/3800  = 130,8  ->  130,8 - 0     = 130,8
      //   bus    : 828,4 x 3200/3800 = 697,6  ->  697,6 - 361,6 = 336,0
      expect(enregistrements[0].savedVsCarGrams).toBeCloseTo(130.8, 2);
      expect(enregistrements[1].savedVsCarGrams).toBeCloseTo(336.0, 2);

      // La somme retrouve le total renvoyé par le microservice, à l'arrondi
      // près : les co2Grams du breakdown sont déjà arrondis à 2 décimales.
      const somme = enregistrements.reduce(
        (total, e) => total + e.savedVsCarGrams,
        0,
      );
      expect(somme).toBeCloseTo(REPONSE_FASTAPI.saved_g, 1);
    });

    it('horodate la route et son carbone au MÊME instant', async () => {
      simulerFastApi(REPONSE_FASTAPI);

      const reponse = await request(app.getHttpServer())
        .post('/api/routes')
        .set('Authorization', `Bearer ${jetonA}`)
        .send(corpsValide())
        .expect(201);

      const routeId = (reponse.body as { id: string }).id;
      const route = await prisma.route.findUniqueOrThrow({
        where: { id: routeId },
      });
      const enregistrements = await prisma.carbonRecord.findMany({
        where: { routeId },
      });

      // Vérifié APRÈS un aller-retour en base : c'est l'instant réellement
      // stocké par PostgreSQL qui est comparé, pas l'objet JavaScript.
      for (const enregistrement of enregistrements) {
        expect(enregistrement.date.getTime()).toBe(route.requestedAt.getTime());
      }
    });
  });

  // ===========================================================================
  // Le contrat : le client ne déclare plus les valeurs dérivées
  // ===========================================================================
  describe('contrat', () => {
    it('REFUSE les anciens champs carbone du client', async () => {
      const appel = simulerFastApi(REPONSE_FASTAPI);

      // C'est la faille refermée par 4E-3B : n'importe qui pouvait
      // enregistrer un trajet en voiture avec ecoScore = 100.
      await request(app.getHttpServer())
        .post('/api/routes')
        .set('Authorization', `Bearer ${jetonA}`)
        .send({
          ...corpsValide(),
          totalDistanceM: 1,
          totalDurationMin: 1,
          ecoScore: 100,
          carbonEstimate: 0,
        })
        .expect(400);

      expect(appel).not.toHaveBeenCalled();
      expect(await compter(userA)).toEqual({
        routes: 0,
        segments: 0,
        carbonRecords: 0,
      });
    });

    it('REFUSE les champs descriptifs de segment', async () => {
      const appel = simulerFastApi(REPONSE_FASTAPI);

      // Le client DÉSIGNE une liaison, il ne la DÉCRIT pas.
      await request(app.getHttpServer())
        .post('/api/routes')
        .set('Authorization', `Bearer ${jetonA}`)
        .send({
          ...corpsValide(),
          segments: [
            {
              lineId: ligneMarche,
              fromStopId: stopA,
              toStopId: stopB,
              mode: 'WALK',
              distanceM: 99999,
              durationMin: 1,
              lineName: 'Ligne inventée',
              operator: 'Moi-même',
            },
          ],
        })
        .expect(400);

      expect(appel).not.toHaveBeenCalled();
    });

    it('REFUSE un userId envoyé dans le corps', async () => {
      await request(app.getHttpServer())
        .post('/api/routes')
        .set('Authorization', `Bearer ${jetonA}`)
        .send({ ...corpsValide(), userId: userB })
        .expect(400);
    });

    it('REFUSE une liste de segments vide', async () => {
      await request(app.getHttpServer())
        .post('/api/routes')
        .set('Authorization', `Bearer ${jetonA}`)
        .send({ ...corpsValide(), segments: [] })
        .expect(400);
    });

    it('REFUSE un identifiant qui n’est pas un UUID', async () => {
      await request(app.getHttpServer())
        .post('/api/routes')
        .set('Authorization', `Bearer ${jetonA}`)
        .send({
          ...corpsValide(),
          segments: [
            { lineId: 'pas-un-uuid', fromStopId: stopA, toStopId: stopB },
          ],
        })
        .expect(400);
    });

    it('REFUSE une requête sans jeton', async () => {
      await request(app.getHttpServer())
        .post('/api/routes')
        .send(corpsValide())
        .expect(401);
    });
  });

  // ===========================================================================
  // Intégrité vis-à-vis du réseau
  // ===========================================================================
  describe('intégrité du trajet', () => {
    it('REFUSE une liaison qui n’existe pas dans le réseau', async () => {
      const appel = simulerFastApi(REPONSE_FASTAPI);

      // Triplet syntaxiquement valide, mais absent du réseau : c'est la
      // ligne de bus qui est demandée entre A et B, or elle relie B à C.
      await request(app.getHttpServer())
        .post('/api/routes')
        .set('Authorization', `Bearer ${jetonA}`)
        .send({
          ...corpsValide(),
          segments: [{ lineId: ligneBus, fromStopId: stopA, toStopId: stopB }],
        })
        .expect(400);

      expect(appel).not.toHaveBeenCalled();
      expect(await compter(userA)).toEqual({
        routes: 0,
        segments: 0,
        carbonRecords: 0,
      });
    });

    it('REFUSE un trajet interrompu', async () => {
      const appel = simulerFastApi(REPONSE_FASTAPI);

      // A → B puis D → E : deux liaisons réelles, mais on ne se téléporte
      // pas de B à D.
      await request(app.getHttpServer())
        .post('/api/routes')
        .set('Authorization', `Bearer ${jetonA}`)
        .send({
          ...corpsValide(),
          segments: [
            { lineId: ligneMarche, fromStopId: stopA, toStopId: stopB },
            { lineId: ligneIsolee, fromStopId: stopD, toStopId: stopE },
          ],
        })
        .expect(400);

      expect(appel).not.toHaveBeenCalled();
      expect(await compter(userA)).toEqual({
        routes: 0,
        segments: 0,
        carbonRecords: 0,
      });
    });
  });

  // ===========================================================================
  // Erreurs venant du calcul carbone
  // ===========================================================================
  describe('erreurs du calcul carbone', () => {
    it('relaie un 422 quand un mode est incalculable (ESCOOTER)', async () => {
      // La liaison EXISTE bel et bien dans le réseau : l'échec survient plus
      // loin, au moment du calcul, faute de facteur d'émission (4D-1).
      simulerFastApi(
        {
          detail: [
            {
              msg: "Value error, Mode 'ESCOOTER' non supporte : aucun facteur d'emission valide",
            },
          ],
        },
        422,
      );

      const reponse = await request(app.getHttpServer())
        .post('/api/routes')
        .set('Authorization', `Bearer ${jetonA}`)
        .send({
          ...corpsValide(),
          segments: [
            { lineId: ligneTrottinette, fromStopId: stopA, toStopId: stopB },
          ],
        })
        .expect(422);

      expect(JSON.stringify(reponse.body)).toContain('ESCOOTER');
      expect(await compter(userA)).toEqual({
        routes: 0,
        segments: 0,
        carbonRecords: 0,
      });
    });

    it('renvoie 503 et n’écrit RIEN si le microservice est injoignable', async () => {
      jest
        .spyOn(global, 'fetch')
        .mockRejectedValue(new TypeError('fetch failed'));

      const reponse = await request(app.getHttpServer())
        .post('/api/routes')
        .set('Authorization', `Bearer ${jetonA}`)
        .send(corpsValide())
        .expect(503);

      expect(reponse.body).toMatchObject({
        message: 'Service de calcul carbone indisponible',
      });
      // LA preuve que l'appel réseau précède toute écriture : il n'y a rien
      // à annuler, parce que rien n'a été écrit.
      expect(await compter(userA)).toEqual({
        routes: 0,
        segments: 0,
        carbonRecords: 0,
      });
    });
  });

  // ===========================================================================
  // Propriété des données
  // ===========================================================================
  describe('ownership', () => {
    it('attache le trajet à l’usager du JETON, pas à un autre', async () => {
      simulerFastApi(REPONSE_FASTAPI);

      const reponse = await request(app.getHttpServer())
        .post('/api/routes')
        .set('Authorization', `Bearer ${jetonB}`)
        .send(corpsValide())
        .expect(201);

      const routeId = (reponse.body as { id: string }).id;
      const route = await prisma.route.findUniqueOrThrow({
        where: { id: routeId },
      });
      const enregistrements = await prisma.carbonRecord.findMany({
        where: { routeId },
      });

      expect(route.userId).toBe(userB);
      expect(enregistrements.every((e) => e.userId === userB)).toBe(true);

      // Et l'usager A n'a rien gagné au passage.
      expect((await compter(userA)).routes).toBe(0);
    });

    it('ne laisse pas B enregistrer un trajet au nom de A', async () => {
      simulerFastApi(REPONSE_FASTAPI);

      // Deux protections se cumulent : le champ userId est refusé par le
      // ValidationPipe, et le service ne lit de toute façon que le jeton.
      await request(app.getHttpServer())
        .post('/api/routes')
        .set('Authorization', `Bearer ${jetonB}`)
        .send({ ...corpsValide(), userId: userA })
        .expect(400);

      expect((await compter(userA)).routes).toBe(0);
      expect((await compter(userB)).routes).toBe(0);
    });
  });

  // ===========================================================================
  // Atomicité : le test central de cette étape
  // ===========================================================================
  describe('atomicité', () => {
    it('annule TOUT si une écriture échoue après la création de la route', async () => {
      simulerFastApi(REPONSE_FASTAPI);

      // On ne simule PAS la transaction : elle est bien ouverte par
      // PostgreSQL, la route y est réellement insérée, et seule l'écriture
      // des segments est remplacée par une panne. Le rollback qui suit est
      // celui de PostgreSQL, pas un nettoyage de notre part.
      //
      // Espionner `prisma.segment.createMany` ne servirait à rien : le
      // service écrit via le client de transaction `tx`, pas via `prisma`.
      let routeVueDansLaTransaction: unknown = null;

      const vraieTransaction = prisma.$transaction.bind(prisma) as (
        rappel: (tx: Prisma.TransactionClient) => Promise<unknown>,
      ) => Promise<unknown>;

      jest
        .spyOn(prisma, '$transaction')
        .mockImplementation(
          (rappel: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
            vraieTransaction(async (tx) => {
              const txPiegee = new Proxy(tx, {
                get(cible, propriete, recepteur) {
                  if (propriete === 'segment') {
                    return {
                      createMany: async () => {
                        // Preuve que la route EST déjà écrite dans la
                        // transaction au moment où la panne survient.
                        routeVueDansLaTransaction = await tx.route.findFirst({
                          where: { userId: userA },
                        });
                        throw new Error('panne simulée pendant la transaction');
                      },
                    };
                  }
                  return Reflect.get(cible, propriete, recepteur) as unknown;
                },
              });

              return rappel(txPiegee);
            }),
        );

      await request(app.getHttpServer())
        .post('/api/routes')
        .set('Authorization', `Bearer ${jetonA}`)
        .send(corpsValide())
        .expect(500);

      // 1. La route existait bien DANS la transaction...
      expect(routeVueDansLaTransaction).not.toBeNull();
      // 2. ...et PostgreSQL l'a entièrement annulée.
      expect(await compter(userA)).toEqual({
        routes: 0,
        segments: 0,
        carbonRecords: 0,
      });
    });
  });

  // ===========================================================================
  // Ordre des opérations
  // ===========================================================================
  describe('ordre des opérations', () => {
    it('appelle le microservice AVANT d’ouvrir la transaction', async () => {
      const ordre: string[] = [];

      jest.spyOn(global, 'fetch').mockImplementation(() => {
        ordre.push('carbone');
        return Promise.resolve(
          new Response(JSON.stringify(REPONSE_FASTAPI), { status: 200 }),
        );
      });

      const vraieTransaction = prisma.$transaction.bind(prisma) as (
        rappel: (tx: Prisma.TransactionClient) => Promise<unknown>,
      ) => Promise<unknown>;

      jest
        .spyOn(prisma, '$transaction')
        .mockImplementation(
          (rappel: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
            ordre.push('transaction');
            return vraieTransaction(rappel);
          },
        );

      await request(app.getHttpServer())
        .post('/api/routes')
        .set('Authorization', `Bearer ${jetonA}`)
        .send(corpsValide())
        .expect(201);

      // Un appel HTTP à l'intérieur d'une transaction tiendrait des verrous
      // PostgreSQL ouverts pendant toute sa durée (5 s au maximum ici).
      expect(ordre).toEqual(['carbone', 'transaction']);
    });
  });
});
