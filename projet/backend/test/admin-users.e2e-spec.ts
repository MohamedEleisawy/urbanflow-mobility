// Charge projet/backend/.env (DATABASE_URL, JWT_SECRET...).
import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { UsersService } from './../src/users/users.service';

// Liste des comptes pour l'administration (étape 6-3).
//
// PostgreSQL est RÉEL : la pagination, le tri et le total se calculent en base
// et ne se prouvent qu'avec de vraies lignes. Un Prisma simulé validerait la
// simulation, pas SQL.
//
// ═══ LES FIXTURES SONT ISOLÉES, MAIS LA BASE EST PARTAGÉE ═══
//
// D'autres suites laissent des comptes derrière elles pendant leur exécution.
// Les assertions portent donc sur NOS comptes, repérés par un préfixe
// d'adresse unique — jamais sur des totaux globaux, qui varieraient selon
// l'ordre des suites.
describe('GET /api/admin/users (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let users: UsersService;

  const userIds: string[] = [];
  const PREFIXE = `e2e-6c3-${Date.now()}`;

  let jetonAdmin: string;
  let jetonUser: string;
  let idUser: string;
  let emailAdmin: string;
  let emailSupprime: string;

  const MOT_DE_PASSE = 'motdepasse-de-test';

  interface PageAdmin {
    items: {
      id: string;
      email: string;
      role: string;
      createdAt: string;
      deletedAt: string | null;
    }[];
    page: number;
    limit: number;
    total: number;
  }

  const creerUsager = async (suffixe: string) => {
    const email = `${PREFIXE}-${suffixe}@example.com`;

    await request(app.getHttpServer())
      .post('/api/users')
      .send({ email, password: MOT_DE_PASSE })
      .expect(201);

    const cree = await prisma.user.findUniqueOrThrow({ where: { email } });
    userIds.push(cree.id);
    return { id: cree.id, email };
  };

  const seConnecter = async (email: string) => {
    const reponse = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: MOT_DE_PASSE })
      .expect(200);

    return (reponse.body as { accessToken: string }).accessToken;
  };

  const lister = async (jeton: string, requete = '') => {
    const reponse = await request(app.getHttpServer())
      .get(`/api/admin/users${requete}`)
      .set('Authorization', `Bearer ${jeton}`)
      .expect(200);

    return reponse.body as PageAdmin;
  };

  /// Ne retient que NOS comptes : la base est partagée avec les autres suites.
  const lesNotres = (page: PageAdmin) =>
    page.items.filter((u) => u.email.startsWith(PREFIXE));

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

    // Un administrateur, promu par le mécanisme RÉEL de l'étape 6-2 — et non
    // par une écriture directe en base. La suite éprouve ainsi la chaîne
    // complète, promotion comprise.
    const admin = await creerUsager('admin');
    emailAdmin = admin.email;
    await users.promoteToAdmin(admin.email);
    jetonAdmin = await seConnecter(admin.email);

    const usager = await creerUsager('user');
    idUser = usager.id;
    jetonUser = await seConnecter(usager.email);

    // Un compte supprimé, pour vérifier qu'il apparaît bien dans la liste.
    const supprime = await creerUsager('supprime');
    emailSupprime = supprime.email;
    await users.softDeleteAccount(supprime.id);
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
      await request(app.getHttpServer()).get('/api/admin/users').expect(401);
    });

    it('jeton invalide → 401', async () => {
      await request(app.getHttpServer())
        .get('/api/admin/users')
        .set('Authorization', 'Bearer pas-un-vrai-jeton')
        .expect(401);
    });

    it('USER authentifié → 403', async () => {
      // 403 et non 401 : on sait parfaitement qui demande, et la réponse est
      // « non ».
      const reponse = await request(app.getHttpServer())
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${jetonUser}`)
        .expect(403);

      expect(JSON.stringify(reponse.body)).toMatch(/administrateurs/i);
    });

    it('un refus ne laisse fuiter AUCUNE adresse', async () => {
      const reponse = await request(app.getHttpServer())
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${jetonUser}`)
        .expect(403);

      expect(JSON.stringify(reponse.body)).not.toContain(PREFIXE);
    });

    it('ADMIN → 200', async () => {
      await request(app.getHttpServer())
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${jetonAdmin}`)
        .expect(200);
    });
  });

  // ===========================================================================
  // Contenu
  // ===========================================================================
  describe('contenu', () => {
    it('rend la forme paginée habituelle', async () => {
      const page = await lister(jetonAdmin);

      // Mêmes clés que `GET /api/routes` (4E-4A).
      expect(Object.keys(page).sort()).toEqual([
        'items',
        'limit',
        'page',
        'total',
      ]);
      expect(page.page).toBe(1);
      expect(page.limit).toBe(20);
    });

    it('expose EXACTEMENT cinq champs par compte', async () => {
      const page = await lister(jetonAdmin, '?limit=50');
      const [premier] = lesNotres(page);

      expect(Object.keys(premier).sort()).toEqual([
        'createdAt',
        'deletedAt',
        'email',
        'id',
        'role',
      ]);
    });

    it('NE CONTIENT JAMAIS passwordHash', async () => {
      const reponse = await request(app.getHttpServer())
        .get('/api/admin/users?limit=50')
        .set('Authorization', `Bearer ${jetonAdmin}`)
        .expect(200);

      expect(reponse.text).not.toContain('passwordHash');
      // Et le condensat réel n'apparaît nulle part dans le texte.
      const enBase = await prisma.user.findUniqueOrThrow({
        where: { id: idUser },
      });
      expect(reponse.text).not.toContain(enBase.passwordHash);
    });

    it('NE CONTIENT PAS les préférences', async () => {
      await request(app.getHttpServer())
        .patch('/api/users/me/preferences')
        .set('Authorization', `Bearer ${jetonUser}`)
        .send({ co2BudgetWeekly: 4242 })
        .expect(200);

      const reponse = await request(app.getHttpServer())
        .get('/api/admin/users?limit=50')
        .set('Authorization', `Bearer ${jetonAdmin}`)
        .expect(200);

      // Une liste sert à repérer un compte, pas à l'inspecter.
      expect(reponse.text).not.toContain('preferences');
      expect(reponse.text).not.toContain('4242');
    });

    it('montre le RÔLE réel de chacun', async () => {
      const page = await lister(jetonAdmin, '?limit=50');
      const notres = lesNotres(page);

      expect(notres.find((u) => u.email === emailAdmin)?.role).toBe('ADMIN');
      expect(notres.find((u) => u.id === idUser)?.role).toBe('USER');
    });
  });

  // ===========================================================================
  // Comptes supprimés
  // ===========================================================================
  describe('comptes supprimés', () => {
    it('les INCLUT dans la liste', async () => {
      const page = await lister(jetonAdmin, '?limit=50');

      // Les masquer laisserait un administrateur s'étonner qu'une
      // inscription échoue en 409 sur une adresse qu'il ne voit nulle part.
      const supprime = lesNotres(page).find((u) => u.email === emailSupprime);
      expect(supprime).toBeDefined();
    });

    it('les DISTINGUE par `deletedAt`', async () => {
      const page = await lister(jetonAdmin, '?limit=50');
      const notres = lesNotres(page);

      expect(
        notres.find((u) => u.email === emailSupprime)?.deletedAt,
      ).not.toBeNull();
      expect(notres.find((u) => u.id === idUser)?.deletedAt).toBeNull();
    });
  });

  // ===========================================================================
  // Pagination
  // ===========================================================================
  describe('pagination', () => {
    it('respecte la limite demandée', async () => {
      const page = await lister(jetonAdmin, '?limit=2');

      expect(page.items).toHaveLength(2);
      expect(page.limit).toBe(2);
    });

    it('rend un TOTAL cohérent avec la base', async () => {
      const page = await lister(jetonAdmin, '?limit=1');

      // Le total compte TOUS les comptes, y compris les supprimés — sans
      // quoi le nombre de pages affiché serait faux.
      expect(page.total).toBe(await prisma.user.count());
      expect(page.total).toBeGreaterThanOrEqual(3);
    });

    it('la page 2 ne REDONNE PAS la page 1', async () => {
      const page1 = await lister(jetonAdmin, '?page=1&limit=2');
      const page2 = await lister(jetonAdmin, '?page=2&limit=2');

      const ids1 = page1.items.map((u) => u.id);
      const ids2 = page2.items.map((u) => u.id);
      expect(ids2.some((id) => ids1.includes(id))).toBe(false);
    });

    it('REFUSE une limite au-delà du plafond', async () => {
      // Le DTO partagé plafonne à 50 : sans cela, `?limit=100000`
      // rétablirait la requête non bornée que la pagination vient supprimer.
      await request(app.getHttpServer())
        .get('/api/admin/users?limit=51')
        .set('Authorization', `Bearer ${jetonAdmin}`)
        .expect(400);
    });

    it('REFUSE une page nulle ou négative', async () => {
      for (const page of ['0', '-1']) {
        await request(app.getHttpServer())
          .get(`/api/admin/users?page=${page}`)
          .set('Authorization', `Bearer ${jetonAdmin}`)
          .expect(400);
      }
    });

    it('REFUSE un paramètre inconnu', async () => {
      // `forbidNonWhitelisted` est actif globalement.
      await request(app.getHttpServer())
        .get('/api/admin/users?role=ADMIN')
        .set('Authorization', `Bearer ${jetonAdmin}`)
        .expect(400);
    });
  });

  // ===========================================================================
  // Tri
  // ===========================================================================
  describe('tri', () => {
    it('classe du plus RÉCENT au plus ancien', async () => {
      const page = await lister(jetonAdmin, '?limit=50');
      const dates = page.items.map((u) => new Date(u.createdAt).getTime());

      for (let i = 1; i < dates.length; i++) {
        expect(dates[i]).toBeLessThanOrEqual(dates[i - 1]);
      }
    });

    it('est DÉTERMINISTE : deux appels, même ordre', async () => {
      const premier = await lister(jetonAdmin, '?limit=50');
      const second = await lister(jetonAdmin, '?limit=50');

      // Sans le départage par identifiant, deux comptes créés dans la même
      // milliseconde pourraient changer de place entre ces deux appels.
      expect(second.items.map((u) => u.id)).toEqual(
        premier.items.map((u) => u.id),
      );
    });
  });

  // ===========================================================================
  // Suppression de GET /api/users/:id (étape 6-3)
  // ===========================================================================
  describe('GET /api/users/:id supprimée', () => {
    it("N'EXISTE PLUS, même pour un ADMIN", async () => {
      // La route rendait le profil de n'importe quel usager. Aucun
      // consommateur ne l'utilisait ; la supprimer valait mieux que la
      // durcir — une route qui n'existe pas ne peut pas voir sa protection
      // oubliée lors d'un remaniement.
      await request(app.getHttpServer())
        .get(`/api/users/${idUser}`)
        .set('Authorization', `Bearer ${jetonAdmin}`)
        .expect(404);
    });

    it("N'EXISTE PLUS pour un USER ni pour un anonyme", async () => {
      await request(app.getHttpServer())
        .get(`/api/users/${idUser}`)
        .set('Authorization', `Bearer ${jetonUser}`)
        .expect(404);

      await request(app.getHttpServer())
        .get(`/api/users/${idUser}`)
        .expect(404);
    });

    it('GET /api/users/me fonctionne TOUJOURS', async () => {
      // C'est elle que le frontend utilise : la suppression devait être
      // chirurgicale.
      const reponse = await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Authorization', `Bearer ${jetonUser}`)
        .expect(200);

      expect((reponse.body as { id: string }).id).toBe(idUser);
    });
  });

  // ===========================================================================
  // Non-régression
  // ===========================================================================
  describe('non-régression', () => {
    it('un ADMIN garde ses droits ordinaires', async () => {
      await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Authorization', `Bearer ${jetonAdmin}`)
        .expect(200);
    });

    it('les routes publiques restent publiques', async () => {
      await request(app.getHttpServer()).get('/api/stops').expect(200);
      await request(app.getHttpServer()).get('/api/alerts').expect(200);
    });

    it("aucune route /admin non prevue n'existe", async () => {
      // Mis a jour a l'etape 6-5 : GET /api/admin/stats existe desormais.
      // Le controle garde son interet — il verifie qu'aucune route
      // d'administration n'apparait sans avoir ete decidee.
      await request(app.getHttpServer())
        .get('/api/admin/settings')
        .set('Authorization', `Bearer ${jetonAdmin}`)
        .expect(404);
    });
  });
});
