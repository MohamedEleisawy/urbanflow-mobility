// Charge projet/backend/.env (DATABASE_URL, JWT_SECRET...).
import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { UsersService } from './../src/users/users.service';

// Statistiques administratives anonymisées (étape 6-5).
//
// PostgreSQL est RÉEL : `count`, `aggregate` et `groupBy` sont exécutés par la
// base. Un Prisma simulé validerait la simulation, pas SQL — et c'est
// justement l'agrégation qu'on veut éprouver.
//
// ═══ POURQUOI LES ASSERTIONS SONT DIFFÉRENTIELLES ═══
//
// La base est PARTAGÉE avec les autres suites, qui créent et suppriment des
// comptes pendant l'exécution. Assérer « total = 4 comptes » serait donc faux
// dès qu'une autre suite tourne.
//
// On mesure donc un ÉCART : un relevé avant, un relevé après, et l'on vérifie
// la DIFFÉRENCE produite par nos propres fixtures. C'est la seule façon
// honnête de tester des agrégats globaux sur une base partagée — et c'est la
// leçon du test intermittent de l'étape 5G.
describe('GET /api/admin/stats (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let users: UsersService;

  const userIds: string[] = [];
  const routeIds: string[] = [];
  const PREFIXE = `e2e-6c5-${Date.now()}`;

  const MOT_DE_PASSE = 'motdepasse-de-test';

  let jetonAdmin: string;
  let jetonUser: string;

  interface Stats {
    users: { active: number; deleted: number };
    routes: { total: number; totalDistanceM: number };
    carbon: {
      totalCo2Grams: number;
      totalSavedVsCarGrams: number;
      recordCount: number;
    };
    modeUsage: {
      mode: string;
      segmentCount: number;
      totalDistanceM: number;
    }[];
  }

  const creerUsager = async (suffixe: string, admin = false) => {
    const email = `${PREFIXE}-${suffixe}@example.com`;

    await request(app.getHttpServer())
      .post('/api/users')
      .send({ email, password: MOT_DE_PASSE })
      .expect(201);

    const cree = await prisma.user.findUniqueOrThrow({ where: { email } });
    userIds.push(cree.id);

    // La promotion précède le login : le rôle est signé DANS le jeton (6-2).
    if (admin) {
      await users.promoteToAdmin(email);
    }

    const connexion = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: MOT_DE_PASSE })
      .expect(200);

    return {
      id: cree.id,
      email,
      jeton: (connexion.body as { accessToken: string }).accessToken,
    };
  };

  /**
   * Crée un trajet MULTIMODAL : deux segments (métro + marche), deux
   * enregistrements carbone.
   *
   * ⚠️ C'est exactement la forme qui piège un compteur naïf : UN trajet, mais
   * DEUX `CarbonRecord`. Si `routes.total` comptait les enregistrements, il
   * vaudrait 2 au lieu de 1.
   */
  const creerTrajetMultimodal = async (userId: string) => {
    const arret = await prisma.stop.findFirst();
    if (!arret) {
      throw new Error(
        'Le jeu de démonstration doit contenir au moins un arrêt.',
      );
    }

    const route = await prisma.route.create({
      data: {
        userId,
        originLat: 48.88,
        originLng: 2.355,
        destinationLat: 48.853,
        destinationLng: 2.369,
        totalDurationMin: 24,
        totalDistanceM: 5000,
        ecoScore: 82,
        carbonEstimate: 310,
        segments: {
          create: [
            {
              mode: 'METRO',
              operator: 'RATP',
              line: '4',
              departureTime: new Date('2026-08-25T09:30:00.000Z'),
              arrivalTime: new Date('2026-08-25T09:39:00.000Z'),
              distanceM: 4000,
              fromStopId: arret.id,
              toStopId: arret.id,
            },
            {
              mode: 'WALK',
              operator: '—',
              line: 'À pied',
              departureTime: new Date('2026-08-25T09:39:00.000Z'),
              arrivalTime: new Date('2026-08-25T09:50:00.000Z'),
              distanceM: 1000,
              fromStopId: arret.id,
              toStopId: arret.id,
            },
          ],
        },
      },
    });
    routeIds.push(route.id);

    await prisma.carbonRecord.createMany({
      data: [
        {
          userId,
          routeId: route.id,
          co2Grams: 16,
          mode: 'METRO',
          distanceM: 4000,
          savedVsCarGrams: 856,
        },
        {
          userId,
          routeId: route.id,
          co2Grams: 0,
          mode: 'WALK',
          distanceM: 1000,
          savedVsCarGrams: 218,
        },
      ],
    });

    return route.id;
  };

  const relever = async (): Promise<Stats> => {
    const reponse = await request(app.getHttpServer())
      .get('/api/admin/stats')
      .set('Authorization', `Bearer ${jetonAdmin}`)
      .expect(200);

    return reponse.body as Stats;
  };

  const segmentsDuMode = (stats: Stats, mode: string) =>
    stats.modeUsage.find((m) => m.mode === mode)?.segmentCount ?? 0;

  const distanceDuMode = (stats: Stats, mode: string) =>
    stats.modeUsage.find((m) => m.mode === mode)?.totalDistanceM ?? 0;

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
    users = app.get(UsersService);

    jetonAdmin = (await creerUsager('admin-a', true)).jeton;
    jetonUser = (await creerUsager('user-temoin')).jeton;
  });

  afterEach(async () => {
    // Seules NOS lignes sont retirées, jamais celles des autres suites.
    await prisma.route.deleteMany({ where: { id: { in: routeIds } } });
    routeIds.length = 0;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  // ===========================================================================
  // Protection
  // ===========================================================================
  describe('protection', () => {
    it('anonyme → 401', async () => {
      await request(app.getHttpServer()).get('/api/admin/stats').expect(401);
    });

    it('jeton invalide → 401', async () => {
      await request(app.getHttpServer())
        .get('/api/admin/stats')
        .set('Authorization', 'Bearer pas-un-vrai-jeton')
        .expect(401);
    });

    it('USER authentifié → 403', async () => {
      const reponse = await request(app.getHttpServer())
        .get('/api/admin/stats')
        .set('Authorization', `Bearer ${jetonUser}`)
        .expect(403);

      expect(JSON.stringify(reponse.body)).toMatch(/administrateurs/i);
    });

    it('ADMIN → 200', async () => {
      await request(app.getHttpServer())
        .get('/api/admin/stats')
        .set('Authorization', `Bearer ${jetonAdmin}`)
        .expect(200);
    });

    it('IGNORE tout paramètre : les statistiques sont GLOBALES', async () => {
      // La route ne déclare AUCUN `@Query()` : il n'y a pas de DTO à valider,
      // donc `forbidNonWhitelisted` ne s'applique pas et les paramètres
      // inconnus sont simplement ignorés.
      //
      // Ce test le prouve autrement, et mieux : quel que soit le paramètre
      // envoyé, la réponse est IDENTIQUE. Aucun filtre caché ne se déclenche.
      const sansParametre = await relever();

      const avecParametre = await request(app.getHttpServer())
        .get('/api/admin/stats?from=2026-01-01&mode=BUS&userId=peu-importe')
        .set('Authorization', `Bearer ${jetonAdmin}`)
        .expect(200);

      expect(avecParametre.body).toEqual(sansParametre);
    });
  });

  // ===========================================================================
  // Forme de la réponse
  // ===========================================================================
  describe('forme', () => {
    it('rend les quatre sections', async () => {
      const stats = await relever();

      expect(Object.keys(stats).sort()).toEqual([
        'carbon',
        'modeUsage',
        'routes',
        'users',
      ]);
    });

    it('rend des NOMBRES, jamais `null`', async () => {
      const stats = await relever();

      for (const valeur of [
        stats.users.active,
        stats.users.deleted,
        stats.routes.total,
        stats.routes.totalDistanceM,
        stats.carbon.totalCo2Grams,
        stats.carbon.totalSavedVsCarGrams,
        stats.carbon.recordCount,
      ]) {
        expect(typeof valeur).toBe('number');
      }
    });
  });

  // ===========================================================================
  // Anonymisation — la garantie centrale
  // ===========================================================================
  describe('anonymisation', () => {
    beforeEach(async () => {
      await creerTrajetMultimodal(userIds[1]);
    });

    it('ne contient AUCUNE adresse électronique', async () => {
      const reponse = await request(app.getHttpServer())
        .get('/api/admin/stats')
        .set('Authorization', `Bearer ${jetonAdmin}`)
        .expect(200);

      expect(reponse.text).not.toContain(PREFIXE);
      expect(reponse.text).not.toContain('@');
    });

    it('ne contient AUCUN identifiant', async () => {
      const reponse = await request(app.getHttpServer())
        .get('/api/admin/stats')
        .set('Authorization', `Bearer ${jetonAdmin}`)
        .expect(200);

      // Ni userId, ni routeId, ni aucun UUID.
      expect(reponse.text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
      expect(reponse.text).not.toContain('userId');
      for (const id of [...userIds, ...routeIds]) {
        expect(reponse.text).not.toContain(id);
      }
    });

    it('ne contient AUCUN condensat de mot de passe', async () => {
      const reponse = await request(app.getHttpServer())
        .get('/api/admin/stats')
        .set('Authorization', `Bearer ${jetonAdmin}`)
        .expect(200);

      expect(reponse.text).not.toContain('passwordHash');
      const enBase = await prisma.user.findUniqueOrThrow({
        where: { id: userIds[1] },
      });
      expect(reponse.text).not.toContain(enBase.passwordHash);
    });

    it('ne contient AUCUNE ligne par usager', async () => {
      const stats = await relever();

      // Uniquement des comptes et des sommes : une statistique par usager
      // n'est pas une statistique, c'est un fichier.
      expect(Array.isArray(stats.modeUsage)).toBe(true);
      for (const ligne of stats.modeUsage) {
        expect(Object.keys(ligne).sort()).toEqual([
          'mode',
          'segmentCount',
          'totalDistanceM',
        ]);
      }
    });
  });

  // ===========================================================================
  // Comptes
  // ===========================================================================
  describe('utilisateurs', () => {
    it('un nouveau compte AUGMENTE les actifs de 1', async () => {
      const avant = await relever();

      await creerUsager('nouveau');
      const apres = await relever();

      expect(apres.users.active - avant.users.active).toBe(1);
    });

    it('une suppression DÉPLACE le compte des actifs vers les supprimés', async () => {
      const cible = await creerUsager('a-supprimer');
      const avant = await relever();

      await users.softDeleteAccount(cible.id);
      const apres = await relever();

      // Un compte désactivé ne peut plus rien faire (5G) : le compter parmi
      // les actifs surestimerait l'audience.
      expect(apres.users.active - avant.users.active).toBe(-1);
      expect(apres.users.deleted - avant.users.deleted).toBe(1);
    });
  });

  // ===========================================================================
  // Trajets — le piège Route / CarbonRecord
  // ===========================================================================
  describe('trajets', () => {
    it('UN trajet multimodal compte pour UN trajet', async () => {
      const avant = await relever();

      // Deux segments, DEUX enregistrements carbone, mais UN seul trajet.
      await creerTrajetMultimodal(userIds[1]);
      const apres = await relever();

      expect(apres.routes.total - avant.routes.total).toBe(1);
      // Et deux enregistrements carbone : c'est bien le piège.
      expect(apres.carbon.recordCount - avant.carbon.recordCount).toBe(2);
    });

    it('somme la distance des trajets', async () => {
      const avant = await relever();

      await creerTrajetMultimodal(userIds[1]);
      const apres = await relever();

      expect(apres.routes.totalDistanceM - avant.routes.totalDistanceM).toBe(
        5000,
      );
    });
  });

  // ===========================================================================
  // Carbone
  // ===========================================================================
  describe('carbone', () => {
    it('somme les valeurs ENREGISTRÉES', async () => {
      const avant = await relever();

      await creerTrajetMultimodal(userIds[1]);
      const apres = await relever();

      // 16 + 0 grammes, tels que le microservice les a calculés à
      // l'enregistrement. Aucun recalcul depuis les distances.
      expect(
        apres.carbon.totalCo2Grams - avant.carbon.totalCo2Grams,
      ).toBeCloseTo(16, 5);
      expect(
        apres.carbon.totalSavedVsCarGrams - avant.carbon.totalSavedVsCarGrams,
      ).toBeCloseTo(1074, 5); // 856 + 218
    });
  });

  // ===========================================================================
  // Répartition par mode
  // ===========================================================================
  describe('répartition par mode', () => {
    it('compte les SEGMENTS, pas les trajets', async () => {
      const avant = await relever();

      // UN trajet, mais un segment METRO et un segment WALK.
      await creerTrajetMultimodal(userIds[1]);
      const apres = await relever();

      expect(
        segmentsDuMode(apres, 'METRO') - segmentsDuMode(avant, 'METRO'),
      ).toBe(1);
      expect(
        segmentsDuMode(apres, 'WALK') - segmentsDuMode(avant, 'WALK'),
      ).toBe(1);
      // Deux lignes de mode pour UN trajet : « BUS = 3 trajets » n'aurait
      // aucun sens, d'où le nom `segmentCount`.
      expect(apres.routes.total - avant.routes.total).toBe(1);
    });

    it('somme la distance PAR MODE', async () => {
      const avant = await relever();

      await creerTrajetMultimodal(userIds[1]);
      const apres = await relever();

      expect(
        distanceDuMode(apres, 'METRO') - distanceDuMode(avant, 'METRO'),
      ).toBe(4000);
      expect(
        distanceDuMode(apres, 'WALK') - distanceDuMode(avant, 'WALK'),
      ).toBe(1000);
    });

    it('nomme le champ `segmentCount`', async () => {
      await creerTrajetMultimodal(userIds[1]);
      const stats = await relever();

      const [premier] = stats.modeUsage;
      expect(premier).toHaveProperty('segmentCount');
      expect(premier).not.toHaveProperty('tripCount');
    });

    it('TRIE du plus employé au moins employé', async () => {
      await creerTrajetMultimodal(userIds[1]);
      const stats = await relever();

      const comptes = stats.modeUsage.map((m) => m.segmentCount);
      for (let i = 1; i < comptes.length; i++) {
        expect(comptes[i]).toBeLessThanOrEqual(comptes[i - 1]);
      }
    });

    it('est DÉTERMINISTE : deux appels, même ordre', async () => {
      await creerTrajetMultimodal(userIds[1]);

      const premier = await relever();
      const second = await relever();

      // `groupBy` ne garantit aucun ordre : sans tri explicite, les lignes
      // changeraient de place à chaque rafraîchissement.
      expect(second.modeUsage.map((m) => m.mode)).toEqual(
        premier.modeUsage.map((m) => m.mode),
      );
    });
  });

  // ===========================================================================
  // Données des comptes supprimés
  // ===========================================================================
  describe('comptes supprimés', () => {
    it('leurs trajets et leur carbone RESTENT comptés', async () => {
      const cible = await creerUsager('supprime-avec-trajets');
      await creerTrajetMultimodal(cible.id);
      const avant = await relever();

      await users.softDeleteAccount(cible.id);
      const apres = await relever();

      // Ces déplacements ont réellement eu lieu : les retirer fausserait
      // l'analyse des « habitudes de déplacement dans la ville », et ferait
      // CHUTER les statistiques historiques à chaque départ.
      expect(apres.routes.total).toBe(avant.routes.total);
      expect(apres.carbon.recordCount).toBe(avant.carbon.recordCount);
      expect(apres.carbon.totalCo2Grams).toBeCloseTo(
        avant.carbon.totalCo2Grams,
        5,
      );
    });
  });
});
