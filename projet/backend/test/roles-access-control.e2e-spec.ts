// Charge projet/backend/.env (DATABASE_URL, JWT_SECRET...).
import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { RoleEnum } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

// Contrôle d'accès par rôle (étape 6-1).
//
// PostgreSQL est RÉEL, et c'est indispensable : le rôle voyage dans un JWT
// SIGNÉ, émis par le vrai `AuthService` à partir de la vraie colonne
// `User.role`. Simuler le jeton ne prouverait rien de la chaîne complète —
// base → login → signature → guard.
//
// ═══ LA FIXTURE ADMIN EST DE TEST, ET SEULEMENT DE TEST ═══
//
// Aucun mécanisme de promotion n'existe encore (c'est l'objet de l'étape 6-2).
// On promeut donc DIRECTEMENT EN BASE, après création par la route publique
// d'inscription. Ce raccourci est acceptable ici — un test a le droit de
// fabriquer son état de départ — mais il ne résout PAS la question de la
// création du premier administrateur en production.
describe("Contrôle d'accès par rôle (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const userIds: string[] = [];
  const stopIds: string[] = [];

  let jetonUser: string;
  let idUser: string;
  let jetonAdmin: string;

  const MOT_DE_PASSE = 'motdepasse-de-test';

  /**
   * Crée un compte et rend un jeton portant le rôle demandé.
   *
   * ⚠️ Le rôle est posé en base AVANT le login : le JWT est signé à partir de
   * `user.role`, donc promouvoir après coup laisserait un jeton portant
   * encore « USER ».
   */
  const creerUsager = async (suffixe: string, role: RoleEnum) => {
    const email = `e2e-6c1-${suffixe}-${Date.now()}@example.com`;

    await request(app.getHttpServer())
      .post('/api/users')
      .send({ email, password: MOT_DE_PASSE })
      .expect(201);

    const cree = await prisma.user.findUniqueOrThrow({ where: { email } });
    userIds.push(cree.id);

    if (role !== RoleEnum.USER) {
      await prisma.user.update({ where: { id: cree.id }, data: { role } });
    }

    const connexion = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: MOT_DE_PASSE })
      .expect(200);

    return {
      jeton: (connexion.body as { accessToken: string }).accessToken,
      id: cree.id,
      email,
    };
  };

  const arret = (nom: string) => ({
    name: nom,
    latitude: 48.8809,
    longitude: 2.3553,
    operatorCode: 'RATP',
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

    const u = await creerUsager('user', RoleEnum.USER);
    jetonUser = u.jeton;
    idUser = u.id;
    const a = await creerUsager('admin', RoleEnum.ADMIN);
    jetonAdmin = a.jeton;
  });

  afterEach(async () => {
    await prisma.stop.deleteMany({ where: { id: { in: stopIds } } });
    stopIds.length = 0;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  // ===========================================================================
  // Le rôle traverse réellement la chaîne
  // ===========================================================================
  describe('rôle dans le jeton', () => {
    it('le login signe bien le rôle ADMIN', () => {
      // Décodage de la charge utile sans vérifier la signature : on veut
      // seulement constater ce que le serveur y a mis.
      const charge = JSON.parse(
        Buffer.from(jetonAdmin.split('.')[1], 'base64').toString('utf8'),
      ) as { role: string; sub: string; email: string };

      expect(charge.role).toBe('ADMIN');
      // La structure du jeton n'a pas changé : `sub` et `email` sont
      // toujours là (régression de l'étape 6-1).
      expect(charge.sub).toBeTruthy();
      expect(charge.email).toBeTruthy();
    });

    it('le login signe USER par défaut', () => {
      const charge = JSON.parse(
        Buffer.from(jetonUser.split('.')[1], 'base64').toString('utf8'),
      ) as { role: string };

      expect(charge.role).toBe('USER');
    });
  });

  // ===========================================================================
  // GET /api/users/:id — la fuite refermée, puis la route supprimée
  // ===========================================================================
  describe('GET /api/users/:id', () => {
    // ═══ CE BLOC A CHANGÉ DEUX FOIS ═══
    //
    // À l'étape 6-1, il vérifiait que la route, jusque-là PUBLIQUE, exigeait
    // désormais un jeton — elle rendait l'adresse électronique, le rôle et
    // toutes les préférences de n'importe quel usager à n'importe qui.
    //
    // À l'étape 6-3, la route a été SUPPRIMÉE : aucun consommateur ne
    // l'utilisait, et aucune exigence du dossier ne la justifiait. La
    // « gestion des utilisateurs » passe par `GET /api/admin/users`.
    //
    // Le garde-fou demeure, mais il garantit maintenant l'ABSENCE de la
    // route plutôt que sa protection — la meilleure façon de ne pas se
    // tromper sur une autorisation étant de n'avoir rien à autoriser.

    it("N'EXISTE PLUS, pour personne", async () => {
      await request(app.getHttpServer())
        .get(`/api/users/${idUser}`)
        .expect(404);

      await request(app.getHttpServer())
        .get(`/api/users/${idUser}`)
        .set('Authorization', `Bearer ${jetonUser}`)
        .expect(404);

      await request(app.getHttpServer())
        .get(`/api/users/${idUser}`)
        .set('Authorization', `Bearer ${jetonAdmin}`)
        .expect(404);
    });

    it('ne laisse fuiter AUCUNE donnée', async () => {
      const reponse = await request(app.getHttpServer())
        .get(`/api/users/${idUser}`)
        .expect(404);

      expect(JSON.stringify(reponse.body)).not.toContain('@example.com');
    });

    it('GET /api/users/me fonctionne TOUJOURS', async () => {
      // La suppression devait être chirurgicale : c'est cette route-là que
      // le frontend utilise.
      const reponse = await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Authorization', `Bearer ${jetonUser}`)
        .expect(200);

      const corps = reponse.body as { id: string; passwordHash?: string };
      expect(corps.id).toBe(idUser);
      expect(corps.passwordHash).toBeUndefined();
    });
  });

  // ===========================================================================
  // POST /api/stops — écriture du réseau, réservée aux ADMIN
  // ===========================================================================
  describe('POST /api/stops', () => {
    it('anonyme → 401', async () => {
      await request(app.getHttpServer())
        .post('/api/stops')
        .send(arret('Arrêt anonyme'))
        .expect(401);
    });

    it('USER authentifié → 403', async () => {
      // 403 et non 401 : on sait parfaitement qui demande, et la réponse est
      // « non ». Lui répondre 401 l'enverrait se reconnecter en vain.
      const reponse = await request(app.getHttpServer())
        .post('/api/stops')
        .set('Authorization', `Bearer ${jetonUser}`)
        .send(arret('Arrêt refusé'))
        .expect(403);

      expect(JSON.stringify(reponse.body)).toMatch(/administrateurs/i);
    });

    it("un USER n'écrit RIEN en base", async () => {
      const avant = await prisma.stop.count();

      await request(app.getHttpServer())
        .post('/api/stops')
        .set('Authorization', `Bearer ${jetonUser}`)
        .send(arret('Arrêt fantôme'))
        .expect(403);

      // Le guard rejette AVANT le contrôleur : rien n'a pu être créé.
      expect(await prisma.stop.count()).toBe(avant);
    });

    it('ADMIN → 201, comportement inchangé', async () => {
      const reponse = await request(app.getHttpServer())
        .post('/api/stops')
        .set('Authorization', `Bearer ${jetonAdmin}`)
        .send(arret('Arrêt administrateur'))
        .expect(201);

      const cree = reponse.body as { id: string; name: string };
      stopIds.push(cree.id);
      expect(cree.name).toBe('Arrêt administrateur');
      // Réellement persisté, pas seulement renvoyé.
      expect(
        await prisma.stop.findUnique({ where: { id: cree.id } }),
      ).not.toBeNull();
    });

    it('la VALIDATION reste appliquée pour un ADMIN', async () => {
      // Le rôle donne le droit d'écrire, pas celui d'écrire n'importe quoi :
      // le ValidationPipe s'exécute après les guards.
      await request(app.getHttpServer())
        .post('/api/stops')
        .set('Authorization', `Bearer ${jetonAdmin}`)
        .send({ name: 'Sans coordonnées', operatorCode: 'RATP' })
        .expect(400);
    });
  });

  // ===========================================================================
  // Les lectures publiques restent publiques
  // ===========================================================================
  describe('non-régression des routes publiques', () => {
    it('GET /api/stops reste accessible sans compte', async () => {
      // Le dossier place « Consulter la carte » et « Rechercher un
      // itinéraire » en libre accès : verrouiller la lecture du réseau
      // casserait le cœur public de l'application.
      await request(app.getHttpServer()).get('/api/stops').expect(200);
    });

    it('GET /api/alerts reste accessible sans compte', async () => {
      await request(app.getHttpServer()).get('/api/alerts').expect(200);
    });

    it('POST /api/routes/search reste accessible sans compte', async () => {
      await request(app.getHttpServer())
        .post('/api/routes/search')
        .send({ fromLat: 48.88, fromLon: 2.355, toLat: 48.853, toLon: 2.369 })
        .expect(200);
    });

    it('POST /api/users (inscription) reste publique', async () => {
      const email = `e2e-6c1-inscription-${Date.now()}@example.com`;

      const reponse = await request(app.getHttpServer())
        .post('/api/users')
        .send({ email, password: MOT_DE_PASSE })
        .expect(201);

      userIds.push((reponse.body as { id: string }).id);
    });
  });

  // ===========================================================================
  // Non-régression des routes authentifiées SANS rôle exigé
  // ===========================================================================
  describe('non-régression des routes authentifiées', () => {
    it('GET /api/users/me fonctionne pour un USER', async () => {
      // `RolesGuard` n'est pas posé sur cette route : elle doit se comporter
      // exactement comme avant l'étape 6-1.
      await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Authorization', `Bearer ${jetonUser}`)
        .expect(200);
    });

    it('GET /api/routes fonctionne pour un USER', async () => {
      await request(app.getHttpServer())
        .get('/api/routes')
        .set('Authorization', `Bearer ${jetonUser}`)
        .expect(200);
    });

    it('un ADMIN garde AUSSI ses droits ordinaires', async () => {
      // Le rôle ADMIN ajoute des permissions, il n'en retire aucune.
      await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Authorization', `Bearer ${jetonAdmin}`)
        .expect(200);
    });

    it('PATCH /api/users/me/preferences fonctionne pour un USER', async () => {
      await request(app.getHttpServer())
        .patch('/api/users/me/preferences')
        .set('Authorization', `Bearer ${jetonUser}`)
        .send({ co2BudgetWeekly: 5000 })
        .expect(200);
    });
  });
});
