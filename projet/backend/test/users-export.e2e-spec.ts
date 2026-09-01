// Charge projet/backend/.env (DATABASE_URL, JWT_SECRET...).
import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

// Tests de bout en bout de GET /api/users/me/export (étape 5F).
//
// PostgreSQL est RÉEL, et c'est indispensable :
//
//   - la promesse « aucune donnée d'un autre usager » ne se prouve qu'avec
//     DEUX comptes réellement peuplés en base ;
//   - l'absence de `passwordHash` doit se vérifier sur un compte qui en a
//     réellement un — un Prisma simulé n'en aurait pas, et le test passerait
//     pour de mauvaises raisons ;
//   - `Route.userId` est NULLABLE : seul un vrai trajet anonyme prouve qu'il
//     n'entre pas dans l'export.
describe('GET /api/users/me/export (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const userIds: string[] = [];
  const routeIds: string[] = [];

  let jetonA: string;
  let userA: string;
  let emailA: string;
  let jetonB: string;
  let userB: string;
  let emailB: string;

  interface Export {
    version: number;
    exportedAt: string;
    user: {
      id: string;
      email: string;
      role: string;
      createdAt: string;
      deletedAt: string | null;
    };
    preferences: { co2BudgetWeekly: number; theme: string } | null;
    addresses: {
      id: string;
      type: string;
      address: string;
      latitude: number;
      longitude: number;
      createdAt: string;
    }[];
    routes: {
      id: string;
      totalDistanceM: number;
      segments: { id: string; mode: string; line: string }[];
    }[];
    carbonRecords: { id: string; co2Grams: number; routeId: string }[];
    carbonBudgets: { year: number; week: number; weeklyBudgetGrams: number }[];
  }

  const creerUsager = async (suffixe: string) => {
    const email = `e2e-5f-${suffixe}-${Date.now()}@example.com`;
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
      email,
    };
  };

  /**
   * Crée un trajet avec une étape et son empreinte carbone.
   *
   * `userId` est NULLABLE : passer `null` produit un trajet anonyme, comme en
   * crée une recherche faite sans compte.
   */
  const creerTrajet = async (userId: string | null, distanceM: number) => {
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
        totalDistanceM: distanceM,
        ecoScore: 82,
        carbonEstimate: 310,
        segments: {
          create: {
            mode: 'METRO',
            operator: 'RATP',
            line: '4',
            departureTime: new Date('2026-08-25T09:30:00.000Z'),
            arrivalTime: new Date('2026-08-25T09:39:00.000Z'),
            distanceM,
            fromStopId: arret.id,
            toStopId: arret.id,
          },
        },
      },
    });
    routeIds.push(route.id);

    if (userId) {
      await prisma.carbonRecord.create({
        data: {
          userId,
          routeId: route.id,
          co2Grams: 6,
          mode: 'METRO',
          distanceM,
          savedVsCarGrams: 321,
        },
      });
    }

    return route.id;
  };

  const exporter = async (jeton: string) => {
    const reponse = await request(app.getHttpServer())
      .get('/api/users/me/export')
      .set('Authorization', `Bearer ${jeton}`)
      .expect(200);

    return reponse;
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
    emailA = a.email;
    const b = await creerUsager('b');
    jetonB = b.jeton;
    userB = b.id;
    emailB = b.email;
  });

  afterEach(async () => {
    // Seules NOS lignes sont retirées : les autres suites ne sont jamais
    // touchées. `onDelete: Cascade` emporte segments et empreintes.
    await prisma.route.deleteMany({ where: { id: { in: routeIds } } });
    routeIds.length = 0;
    await prisma.carbonBudget.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.userPreferences.deleteMany({
      where: { userId: { in: userIds } },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  // ===========================================================================
  // Authentification
  // ===========================================================================
  describe('authentification', () => {
    it('refuse un export SANS jeton', async () => {
      await request(app.getHttpServer())
        .get('/api/users/me/export')
        .expect(401);
    });

    it('refuse un jeton invalide', async () => {
      await request(app.getHttpServer())
        .get('/api/users/me/export')
        .set('Authorization', 'Bearer pas-un-vrai-jeton')
        .expect(401);
    });

    it("n'expose AUCUNE donnée dans une réponse refusée", async () => {
      const reponse = await request(app.getHttpServer())
        .get('/api/users/me/export')
        .expect(401);

      expect(JSON.stringify(reponse.body)).not.toContain(emailA);
    });
  });

  // ===========================================================================
  // En-têtes HTTP
  // ===========================================================================
  describe('réponse HTTP', () => {
    it('se sert en JSON', async () => {
      const reponse = await exporter(jetonA);

      expect(reponse.headers['content-type']).toMatch(/application\/json/);
    });

    it("se TÉLÉCHARGE plutôt que de s'afficher", async () => {
      const reponse = await exporter(jetonA);

      // Sans `attachment`, un appel depuis la barre d'adresse afficherait les
      // données personnelles dans l'onglet au lieu de les enregistrer.
      expect(reponse.headers['content-disposition']).toMatch(/^attachment/);
      expect(reponse.headers['content-disposition']).toMatch(/\.json"?$/);
    });
  });

  // ===========================================================================
  // Contenu
  // ===========================================================================
  describe('contenu', () => {
    it('porte un numéro de version et une date', async () => {
      const corps = (await exporter(jetonA)).body as Export;

      // VERSION 2 depuis le bloc 7 : `addresses` s'est ajoute au fichier.
      expect(corps.version).toBe(2);
      // ISO 8601 : la sérialisation JSON d'une `Date`, déterministe.
      expect(corps.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    });

    it('contient le compte de A', async () => {
      const corps = (await exporter(jetonA)).body as Export;

      expect(corps.user.id).toBe(userA);
      expect(corps.user.email).toBe(emailA);
      expect(corps.user.role).toBe('USER');
      // `deletedAt` est exporté même nul : c'est un fait que la base détient.
      expect(corps.user.deletedAt).toBeNull();
    });

    it('contient les préférences de A', async () => {
      await request(app.getHttpServer())
        .patch('/api/users/me/preferences')
        .set('Authorization', `Bearer ${jetonA}`)
        .send({ co2BudgetWeekly: 4200, theme: 'DARK' })
        .expect(200);

      const corps = (await exporter(jetonA)).body as Export;

      expect(corps.preferences?.co2BudgetWeekly).toBe(4200);
      expect(corps.preferences?.theme).toBe('DARK');
    });

    it("rend `preferences: null` quand A n'en a aucune", async () => {
      const corps = (await exporter(jetonA)).body as Export;

      // `null` dit « aucune préférence enregistrée ». Un objet rempli de
      // valeurs par défaut laisserait croire à des choix jamais faits.
      expect(corps.preferences).toBeNull();
    });

    it('contient PLUSIEURS trajets avec leurs étapes', async () => {
      await creerTrajet(userA, 1000);
      await creerTrajet(userA, 2000);

      const corps = (await exporter(jetonA)).body as Export;

      expect(corps.routes).toHaveLength(2);
      // Les étapes sont IMBRIQUÉES : un segment n'a aucun sens hors de son
      // trajet, et une liste à plat obligerait l'usager à faire la jointure.
      expect(corps.routes[0].segments).toHaveLength(1);
      expect(corps.routes[0].segments[0].mode).toBe('METRO');
      expect(corps.routes[0].segments[0].line).toBe('4');
    });

    it('contient les empreintes carbone, rattachées à leur trajet', async () => {
      const routeId = await creerTrajet(userA, 1500);

      const corps = (await exporter(jetonA)).body as Export;

      expect(corps.carbonRecords).toHaveLength(1);
      expect(corps.carbonRecords[0].co2Grams).toBe(6);
      expect(corps.carbonRecords[0].routeId).toBe(routeId);
    });

    it('contient les budgets carbone', async () => {
      await prisma.carbonBudget.create({
        data: { userId: userA, year: 2026, week: 35, weeklyBudgetGrams: 5000 },
      });

      const corps = (await exporter(jetonA)).body as Export;

      // Aucun code n'écrit dans cette table aujourd'hui — mais elle porte un
      // `userId`, donc elle relève des données personnelles. Le jour où
      // quelque chose y écrira, l'export sera déjà complet.
      expect(corps.carbonBudgets).toHaveLength(1);
      expect(corps.carbonBudgets[0].weeklyBudgetGrams).toBe(5000);
    });

    it("rend des sections VIDES plutôt qu'absentes", async () => {
      const corps = (await exporter(jetonA)).body as Export;

      // Une clé absente laisserait croire à un oubli ; un tableau vide dit
      // « rien à ce sujet ».
      expect(corps.routes).toEqual([]);
      expect(corps.carbonRecords).toEqual([]);
      expect(corps.carbonBudgets).toEqual([]);
      expect(corps.addresses).toEqual([]);
    });
  });

  // ===========================================================================
  // Cloisonnement — la garantie centrale
  // ===========================================================================
  describe('cloisonnement', () => {
    it("l'export de A ne contient RIEN de B", async () => {
      await creerTrajet(userA, 1000);
      await creerTrajet(userB, 9999);
      await request(app.getHttpServer())
        .patch('/api/users/me/preferences')
        .set('Authorization', `Bearer ${jetonB}`)
        .send({ co2BudgetWeekly: 7777 })
        .expect(200);

      const brut = JSON.stringify((await exporter(jetonA)).body);

      // Ni son identifiant, ni son adresse, ni ses chiffres.
      expect(brut).not.toContain(userB);
      expect(brut).not.toContain(emailB);
      expect(brut).not.toContain('9999');
      expect(brut).not.toContain('7777');
    });

    it('chacun reçoit SON propre export', async () => {
      await creerTrajet(userA, 1111);
      await creerTrajet(userB, 2222);

      const a = (await exporter(jetonA)).body as Export;
      const b = (await exporter(jetonB)).body as Export;

      expect(a.routes).toHaveLength(1);
      expect(a.routes[0].totalDistanceM).toBe(1111);
      expect(b.routes).toHaveLength(1);
      expect(b.routes[0].totalDistanceM).toBe(2222);
    });

    it("N'INCLUT PAS les trajets ANONYMES", async () => {
      // `Route.userId` est nullable : une recherche faite sans compte crée un
      // trajet qui n'appartient à personne. Un filtre mal écrit — ou absent —
      // les verserait dans l'export du premier venu.
      await creerTrajet(null, 5555);
      await creerTrajet(userA, 1000);

      const corps = (await exporter(jetonA)).body as Export;

      expect(corps.routes).toHaveLength(1);
      expect(JSON.stringify(corps)).not.toContain('5555');
    });

    it("la route n'accepte AUCUN identifiant", async () => {
      // `/api/users/:id/export` N'EXISTE PAS — 404, et non 400 : `@Get(':id')`
      // ne capte qu'UN segment, si bien qu'aucune route ne correspond à ce
      // chemin à deux segments. Il n'y a donc aucun paramètre à contrôler,
      // donc aucun contrôle à oublier — la meilleure façon de ne pas se
      // tromper sur une autorisation est de n'avoir rien à autoriser.
      await request(app.getHttpServer())
        .get(`/api/users/${userA}/export`)
        .set('Authorization', `Bearer ${jetonB}`)
        .expect(404);
    });
  });

  // ===========================================================================
  // Secrets
  // ===========================================================================
  describe('secrets', () => {
    it('NE CONTIENT JAMAIS passwordHash', async () => {
      await creerTrajet(userA, 1000);

      const reponse = await exporter(jetonA);
      const corps = reponse.body as Export & { passwordHash?: string };

      expect(corps.user).not.toHaveProperty('passwordHash');
      expect(corps).not.toHaveProperty('passwordHash');
      // Et le condensat réel n'apparaît nulle part dans le texte du fichier.
      const enBase = await prisma.user.findUniqueOrThrow({
        where: { id: userA },
      });
      expect(reponse.text).not.toContain(enBase.passwordHash);
    });

    it('ne contient AUCUN jeton', async () => {
      const reponse = await exporter(jetonA);

      // Un JWT est autoportant et n'est jamais stocké en base : il n'y a rien
      // à exporter, et le retrouver ici signalerait une fuite.
      expect(reponse.text).not.toContain(jetonA);
      expect(reponse.text).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    });

    it("N'INCLUT PAS les données de référence globales", async () => {
      const corps = (await exporter(jetonA)).body as Record<string, unknown>;

      // Alertes, arrêts, lignes et liaisons sont identiques pour tout le
      // monde : les inclure gonflerait le fichier du réseau entier sans
      // apporter une seule information personnelle.
      expect(corps).not.toHaveProperty('alerts');
      expect(corps).not.toHaveProperty('stops');
      expect(corps).not.toHaveProperty('lines');
      expect(corps).not.toHaveProperty('networkLinks');
      expect(Object.keys(corps).sort()).toEqual([
        'addresses',
        'carbonBudgets',
        'carbonRecords',
        'exportedAt',
        'preferences',
        'routes',
        'user',
        'version',
      ]);
    });
  });

  // ===========================================================================
  // Adresses favorites (bloc 7)
  // ===========================================================================
  describe('adresses favorites', () => {
    const creerAdresse = (
      jeton: string,
      type: 'HOME' | 'WORK',
      adresse: string,
    ) =>
      request(app.getHttpServer())
        .post('/api/users/me/addresses')
        .set('Authorization', `Bearer ${jeton}`)
        .send({ type, address: adresse, latitude: 48.8566, longitude: 2.3522 })
        .expect(201);

    afterEach(async () => {
      await prisma.favoriteAddress.deleteMany({
        where: { userId: { in: [userA, userB] } },
      });
    });

    it('A retrouve SES adresses dans son export', async () => {
      await creerAdresse(jetonA, 'HOME', '12 rue des Lilas, Paris');

      const corps = (await exporter(jetonA)).body as Export;

      // Une adresse favorite DESIGNE LE DOMICILE d'une personne. L'omettre de
      // l'export serait un manquement au RGPD, pas un oubli d'affichage.
      expect(corps.addresses).toHaveLength(1);
      expect(corps.addresses[0].address).toBe('12 rue des Lilas, Paris');
      expect(corps.addresses[0].type).toBe('HOME');
      expect(corps.addresses[0].latitude).toBe(48.8566);
    });

    it('B ne recoit JAMAIS les adresses de A', async () => {
      await creerAdresse(jetonA, 'HOME', '12 rue des Lilas, Paris');
      await creerAdresse(jetonB, 'WORK', '3 avenue de la Gare, Lyon');

      const deB = (await exporter(jetonB)).body as Export;

      // LA GARANTIE CENTRALE DE L'EXPORT : l'identifiant vient du JETON, et
      // de nulle part ailleurs. B ne peut pas atteindre le domicile de A.
      expect(deB.addresses).toHaveLength(1);
      expect(deB.addresses[0].address).toBe('3 avenue de la Gare, Lyon');
      expect(JSON.stringify(deB)).not.toContain('rue des Lilas');
    });

    it("n'exporte AUCUN champ au-dela du contrat", async () => {
      await creerAdresse(jetonA, 'HOME', '12 rue des Lilas, Paris');

      const corps = (await exporter(jetonA)).body as Export;

      expect(Object.keys(corps.addresses[0]).sort()).toEqual([
        'address',
        'createdAt',
        'id',
        'latitude',
        'longitude',
        'type',
      ]);
      // `userId` est deja dans `user.id` : le repeter sur chaque ligne
      // n'apprendrait rien.
      expect(corps.addresses[0]).not.toHaveProperty('userId');
    });

    it("l'export dit EXACTEMENT la meme chose que l'ecran", async () => {
      await creerAdresse(jetonA, 'HOME', '12 rue des Lilas, Paris');
      await creerAdresse(jetonA, 'WORK', '3 avenue de la Gare, Lyon');

      const parLEcran = await request(app.getHttpServer())
        .get('/api/users/me/addresses')
        .set('Authorization', `Bearer ${jetonA}`)
        .expect(200);

      const corps = (await exporter(jetonA)).body as Export;

      // Les deux passent par `AddressesService.findAllForUser` : une colonne
      // ajoutee a l'un ne peut pas manquer a l'autre.
      expect(corps.addresses).toEqual(parLEcran.body);
    });
  });
});
