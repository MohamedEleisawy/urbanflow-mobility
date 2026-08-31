// Charge projet/backend/.env (DATABASE_URL, JWT_SECRET...).
import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { UsersService } from './../src/users/users.service';

// Modération administrative des comptes (étape 6-4).
//
// PostgreSQL est RÉEL, et c'est indispensable : ce qu'on veut prouver n'est
// pas qu'une méthode appelle une autre — les tests unitaires le font — mais
// que la CHAÎNE COMPLÈTE tient :
//
//   ADMIN supprime B → `deletedAt` posé → B ne peut plus se connecter
//   → son jeton encore valide est refusé partout → SES DONNÉES SURVIVENT
//   → C n'est pas affecté
//
// Les cascades Prisma en particulier ne se prouvent qu'en base : quatre
// relations portent `onDelete: Cascade`, et la seule façon de démontrer
// qu'elles ne se déclenchent JAMAIS est de compter les lignes après coup.
describe('DELETE /api/admin/users/:id (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let users: UsersService;

  const userIds: string[] = [];
  const routeIds: string[] = [];
  const PREFIXE = `e2e-6c4-${Date.now()}`;

  const MOT_DE_PASSE = 'motdepasse-de-test';

  interface Comptes {
    adminA: { id: string; email: string; jeton: string };
    userB: { id: string; email: string; jeton: string };
    userC: { id: string; email: string; jeton: string };
    adminD: { id: string; email: string; jeton: string };
  }
  let c: Comptes;

  const creerUsager = async (suffixe: string, admin = false) => {
    const email = `${PREFIXE}-${suffixe}@example.com`;

    await request(app.getHttpServer())
      .post('/api/users')
      .send({ email, password: MOT_DE_PASSE })
      .expect(201);

    const cree = await prisma.user.findUniqueOrThrow({ where: { email } });
    userIds.push(cree.id);

    // ⚠️ La promotion doit précéder le login : le rôle est signé DANS le
    // jeton (étape 6-2).
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

  /// Peuple un compte : préférences, trajet, segment, empreinte carbone.
  const peupler = async (userId: string, jeton: string) => {
    await request(app.getHttpServer())
      .patch('/api/users/me/preferences')
      .set('Authorization', `Bearer ${jeton}`)
      .send({ co2BudgetWeekly: 5000 })
      .expect(200);

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
        totalDistanceM: 4300,
        ecoScore: 82,
        carbonEstimate: 310,
        segments: {
          create: {
            mode: 'METRO',
            operator: 'RATP',
            line: '4',
            departureTime: new Date('2026-08-25T09:30:00.000Z'),
            arrivalTime: new Date('2026-08-25T09:39:00.000Z'),
            distanceM: 4300,
            fromStopId: arret.id,
            toStopId: arret.id,
          },
        },
      },
    });
    routeIds.push(route.id);

    await prisma.carbonRecord.create({
      data: {
        userId,
        routeId: route.id,
        co2Grams: 6,
        mode: 'METRO',
        distanceM: 4300,
        savedVsCarGrams: 321,
      },
    });

    return route.id;
  };

  const supprimer = (jeton: string, id: string) =>
    request(app.getHttpServer())
      .delete(`/api/admin/users/${id}`)
      .set('Authorization', `Bearer ${jeton}`);

  const roleEnBase = async (id: string) =>
    (await prisma.user.findUniqueOrThrow({ where: { id } })).deletedAt;

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
  });

  beforeEach(async () => {
    // Des comptes NEUFS à chaque test : une suppression est irréversible, un
    // compte désactivé ne peut donc pas resservir.
    c = {
      adminA: await creerUsager('admin-a', true),
      userB: await creerUsager('user-b'),
      userC: await creerUsager('user-c'),
      adminD: await creerUsager('admin-d', true),
    };
  });

  afterEach(async () => {
    await prisma.route.deleteMany({ where: { id: { in: routeIds } } });
    routeIds.length = 0;
    // Suppression PHYSIQUE ici seulement : ce sont des comptes de test.
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    userIds.length = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  // ===========================================================================
  // Protection
  // ===========================================================================
  describe('protection', () => {
    it('anonyme → 401', async () => {
      await request(app.getHttpServer())
        .delete(`/api/admin/users/${c.userB.id}`)
        .expect(401);

      expect(await roleEnBase(c.userB.id)).toBeNull();
    });

    it('jeton invalide → 401', async () => {
      await request(app.getHttpServer())
        .delete(`/api/admin/users/${c.userB.id}`)
        .set('Authorization', 'Bearer pas-un-vrai-jeton')
        .expect(401);
    });

    it('USER authentifié → 403', async () => {
      const reponse = await supprimer(c.userC.jeton, c.userB.id).expect(403);

      expect(JSON.stringify(reponse.body)).toMatch(/administrateurs/i);
      // Le guard rejette AVANT le contrôleur : rien n'a pu être écrit.
      expect(await roleEnBase(c.userB.id)).toBeNull();
    });

    it('un USER ne peut pas non plus supprimer un ADMIN', async () => {
      await supprimer(c.userB.jeton, c.adminA.id).expect(403);

      expect(await roleEnBase(c.adminA.id)).toBeNull();
    });
  });

  // ===========================================================================
  // Suppression
  // ===========================================================================
  describe('suppression', () => {
    it('répond 204 sans corps', async () => {
      const reponse = await supprimer(c.adminA.jeton, c.userB.id).expect(204);

      expect(reponse.body).toEqual({});
      expect(reponse.text).toBeFalsy();
    });

    it('POSE réellement une date en base', async () => {
      await supprimer(c.adminA.jeton, c.userB.id).expect(204);

      expect(await roleEnBase(c.userB.id)).toBeInstanceOf(Date);
    });

    it('NE SUPPRIME PAS physiquement la ligne', async () => {
      await supprimer(c.adminA.jeton, c.userB.id).expect(204);

      // Le schéma le prescrit : « jamais de DELETE physique sur ce compte ».
      const compte = await prisma.user.findUnique({
        where: { id: c.userB.id },
      });
      expect(compte).not.toBeNull();
      expect(compte?.email).toBe(c.userB.email);
    });

    it("un identifiant qui N'EST PAS UN UUID → 400", async () => {
      await supprimer(c.adminA.jeton, 'pas-un-uuid').expect(400);
    });

    it('un compte INEXISTANT → 404', async () => {
      // L'administrateur doit savoir que son identifiant était faux, plutôt
      // que de croire avoir agi. C'est un écart assumé avec
      // `DELETE /users/me`, silencieusement idempotent.
      await supprimer(
        c.adminA.jeton,
        'ffffffff-ffff-4fff-8fff-ffffffffffff',
      ).expect(404);
    });
  });

  // ===========================================================================
  // Le compte devient inutilisable
  // ===========================================================================
  describe('après suppression', () => {
    beforeEach(async () => {
      await peupler(c.userB.id, c.userB.jeton);
      await supprimer(c.adminA.jeton, c.userB.id).expect(204);
    });

    it('B NE PEUT PLUS SE RECONNECTER', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: c.userB.email, password: MOT_DE_PASSE })
        .expect(401);
    });

    it('LE JETON DE B, encore valide, est refusé partout', async () => {
      // Le jeton reste cryptographiquement valide une heure : seule la
      // vérification en base de `JwtAuthGuard` (5G) le rend inopérant.
      const entete = { Authorization: `Bearer ${c.userB.jeton}` };
      const serveur = app.getHttpServer();

      await request(serveur).get('/api/users/me').set(entete).expect(401);
      await request(serveur).get('/api/routes').set(entete).expect(401);
      await request(serveur)
        .get('/api/users/me/export')
        .set(entete)
        .expect(401);
      await request(serveur)
        .patch('/api/users/me/preferences')
        .set(entete)
        .send({ co2BudgetWeekly: 1 })
        .expect(401);
    });

    it('SES DONNÉES SURVIVENT toutes', async () => {
      // Quatre relations portent `onDelete: Cascade`. La suppression étant
      // LOGIQUE, aucune ne se déclenche — et c'est ce qui préserve
      // l'historique et l'export.
      expect(
        await prisma.userPreferences.findUnique({
          where: { userId: c.userB.id },
        }),
      ).not.toBeNull();
      expect(await prisma.route.count({ where: { userId: c.userB.id } })).toBe(
        1,
      );
      expect(
        await prisma.segment.count({ where: { routeId: routeIds[0] } }),
      ).toBe(1);
      expect(
        await prisma.carbonRecord.count({ where: { userId: c.userB.id } }),
      ).toBe(1);
    });
  });

  // ===========================================================================
  // Auto-suppression
  // ===========================================================================
  describe('auto-suppression', () => {
    it('un ADMIN ne peut PAS se supprimer lui-même → 400', async () => {
      const reponse = await supprimer(c.adminA.jeton, c.adminA.id).expect(400);

      expect(JSON.stringify(reponse.body)).toMatch(/votre propre compte/i);
    });

    it('son compte reste INTACT', async () => {
      await supprimer(c.adminA.jeton, c.adminA.id).expect(400);

      expect(await roleEnBase(c.adminA.id)).toBeNull();
      // Et il peut toujours agir.
      await request(app.getHttpServer())
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${c.adminA.jeton}`)
        .expect(200);
    });
  });

  // ===========================================================================
  // ADMIN → ADMIN
  // ===========================================================================
  describe('un ADMIN peut désactiver un autre ADMIN', () => {
    it('A supprime D', async () => {
      // Aucune règle du dossier ne l'interdit : en inventer une trancherait
      // une question d'organisation qui ne nous appartient pas.
      await supprimer(c.adminA.jeton, c.adminD.id).expect(204);

      expect(await roleEnBase(c.adminD.id)).toBeInstanceOf(Date);
    });

    it('D perd immédiatement ses droits', async () => {
      await supprimer(c.adminA.jeton, c.adminD.id).expect(204);

      await request(app.getHttpServer())
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${c.adminD.jeton}`)
        .expect(401);
    });
  });

  // ===========================================================================
  // Idempotence
  // ===========================================================================
  describe('compte déjà supprimé', () => {
    it('une seconde suppression RÉUSSIT encore', async () => {
      await supprimer(c.adminA.jeton, c.userB.id).expect(204);

      // Le résultat attendu — « ce compte est désactivé » — est vrai dans
      // les deux cas.
      await supprimer(c.adminA.jeton, c.userB.id).expect(204);
    });

    it("la date initiale N'EST PAS REDATÉE", async () => {
      await supprimer(c.adminA.jeton, c.userB.id).expect(204);
      const premiere = await roleEnBase(c.userB.id);

      await new Promise((r) => setTimeout(r, 20));
      await supprimer(c.adminA.jeton, c.userB.id).expect(204);

      // C'est la seule trace de QUAND le compte a été désactivé.
      expect((await roleEnBase(c.userB.id))?.getTime()).toBe(
        premiere?.getTime(),
      );
    });
  });

  // ===========================================================================
  // Cloisonnement et non-régression
  // ===========================================================================
  describe('cloisonnement', () => {
    it("la suppression de B n'affecte EN RIEN C", async () => {
      await peupler(c.userC.id, c.userC.jeton);

      await supprimer(c.adminA.jeton, c.userB.id).expect(204);

      expect(await roleEnBase(c.userC.id)).toBeNull();
      await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Authorization', `Bearer ${c.userC.jeton}`)
        .expect(200);
      expect(
        await prisma.carbonRecord.count({ where: { userId: c.userC.id } }),
      ).toBe(1);
    });

    it('C peut toujours se reconnecter', async () => {
      await supprimer(c.adminA.jeton, c.userB.id).expect(204);

      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: c.userC.email, password: MOT_DE_PASSE })
        .expect(200);
    });
  });

  describe('non-régression', () => {
    it('GET /api/admin/users fonctionne toujours', async () => {
      await supprimer(c.adminA.jeton, c.userB.id).expect(204);

      const reponse = await request(app.getHttpServer())
        .get('/api/admin/users?limit=50')
        .set('Authorization', `Bearer ${c.adminA.jeton}`)
        .expect(200);

      const corps = reponse.body as {
        items: { id: string; deletedAt: string | null }[];
        total: number;
      };
      // Le compte désactivé reste VISIBLE, marqué par `deletedAt` — c'est le
      // contrat retenu à l'étape 6-3.
      const b = corps.items.find((u) => u.id === c.userB.id);
      expect(b).toBeDefined();
      expect(b?.deletedAt).not.toBeNull();
      expect(corps.total).toBe(await prisma.user.count());
    });

    it('DELETE /api/users/me fonctionne toujours', async () => {
      // La méthode partagée a été renommée à l'étape 6-4 : cette route doit
      // continuer de fonctionner exactement comme avant.
      await request(app.getHttpServer())
        .delete('/api/users/me')
        .set('Authorization', `Bearer ${c.userC.jeton}`)
        .expect(204);

      expect(await roleEnBase(c.userC.id)).toBeInstanceOf(Date);
    });

    it('les routes publiques restent publiques', async () => {
      await supprimer(c.adminA.jeton, c.userB.id).expect(204);

      await request(app.getHttpServer()).get('/api/stops').expect(200);
      await request(app.getHttpServer()).get('/api/alerts').expect(200);
    });
  });
});
