// Charge projet/backend/.env (DATABASE_URL, JWT_SECRET...).
import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

// Tests de bout en bout de GET /api/routes — l'historique paginé
// (étape 4E-4A).
//
// PostgreSQL est RÉEL, et il le faut : ni le tri déterministe, ni le
// cloisonnement entre deux usagers ne se prouvent avec un Prisma simulé.
// C'est la leçon de l'étape 4E-3C.
//
// Les itinéraires sont créés DIRECTEMENT en base plutôt que par
// POST /api/routes : cette étape ne teste que la LECTURE, et passer par la
// création exigerait tout le réseau public et le microservice carbone pour
// rien.
describe('GET /api/routes (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const userIds: string[] = [];

  let jetonA: string;
  let userA: string;
  let jetonB: string;
  let userB: string;

  // Trois instants distincts et croissants, pour un ordre attendu certain.
  const T1 = new Date('2026-08-01T08:00:00.000Z');
  const T2 = new Date('2026-08-02T08:00:00.000Z');
  const T3 = new Date('2026-08-03T08:00:00.000Z');
  // Instant PARTAGÉ par deux itinéraires : c'est lui qui met le départage
  // par identifiant à l'épreuve.
  const T_EGALITE = new Date('2026-08-04T08:00:00.000Z');

  interface ReponseHistorique {
    items: { id: string; requestedAt: string }[];
    page: number;
    limit: number;
    total: number;
  }

  const creerRoute = async (userId: string, requestedAt: Date) => {
    const route = await prisma.route.create({
      data: {
        userId,
        requestedAt,
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
    return route.id;
  };

  const creerUsager = async (suffixe: string) => {
    const email = `e2e-4e4a-${suffixe}-${Date.now()}@example.com`;
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

  const historique = async (jeton: string, requete = '') => {
    const reponse = await request(app.getHttpServer())
      .get(`/api/routes${requete}`)
      .set('Authorization', `Bearer ${jeton}`)
      .expect(200);

    return reponse.body as ReponseHistorique;
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
    // Chaque test repart d'un historique vide, sans jamais toucher aux
    // données des autres suites : tout est filtré par NOS identifiants.
    await prisma.route.deleteMany({ where: { userId: { in: userIds } } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  // ===========================================================================
  // Tri
  // ===========================================================================
  describe('tri', () => {
    it('renvoie le trajet le plus récent en premier', async () => {
      const ancien = await creerRoute(userA, T1);
      const recent = await creerRoute(userA, T3);
      const median = await creerRoute(userA, T2);

      const corps = await historique(jetonA);

      expect(corps.items.map((r) => r.id)).toEqual([recent, median, ancien]);
    });

    it('départage des trajets de MÊME date par identifiant décroissant', async () => {
      // LE test du déterminisme. Sans seconde clé de tri, PostgreSQL ne
      // promet AUCUN ordre pour ces lignes — et avec skip/take, la page 2
      // pourrait réafficher une ligne de la page 1, ou en sauter une.
      //
      // CINQ trajets, et non deux : sans la clé de départage, l'ordre rendu
      // est arbitraire. Avec deux lignes, il aurait UNE CHANCE SUR DEUX de
      // coïncider par hasard avec l'ordre attendu — un test qui passe à pile
      // ou face ne prouve rien. Avec cinq, la probabilité tombe à 1/120.
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        ids.push(await creerRoute(userA, T_EGALITE));
      }

      // Les identifiants sont des UUID aléatoires : l'ordre attendu se
      // DÉDUIT d'eux, il n'est pas supposé.
      const attendu = [...ids].sort().reverse();

      const corps = await historique(jetonA);

      expect(corps.items.map((r) => r.id)).toEqual(attendu);
    });
  });

  // ===========================================================================
  // Pagination
  // ===========================================================================
  describe('pagination', () => {
    // 3 trajets, du plus récent au plus ancien : T3, T2, T1.
    const troisTrajets = async () => ({
      ancien: await creerRoute(userA, T1),
      median: await creerRoute(userA, T2),
      recent: await creerRoute(userA, T3),
    });

    it('applique page=1 et limit=20 par défaut', async () => {
      await troisTrajets();

      const corps = await historique(jetonA);

      expect(corps.page).toBe(1);
      expect(corps.limit).toBe(20);
      expect(corps.total).toBe(3);
      expect(corps.items).toHaveLength(3);
    });

    it('découpe correctement en pages de 1', async () => {
      const { ancien, median, recent } = await troisTrajets();

      const page1 = await historique(jetonA, '?page=1&limit=1');
      const page2 = await historique(jetonA, '?page=2&limit=1');
      const page3 = await historique(jetonA, '?page=3&limit=1');

      expect(page1.items.map((r) => r.id)).toEqual([recent]);
      expect(page2.items.map((r) => r.id)).toEqual([median]);
      expect(page3.items.map((r) => r.id)).toEqual([ancien]);
      // Le total ne dépend pas de la page : c'est le nombre d'éléments
      // disponibles, pas le nombre renvoyés.
      expect([page1.total, page2.total, page3.total]).toEqual([3, 3, 3]);
    });

    it('ne renvoie AUCUN doublon entre deux pages consécutives', async () => {
      await troisTrajets();

      const page1 = await historique(jetonA, '?page=1&limit=2');
      const page2 = await historique(jetonA, '?page=2&limit=2');

      const tous = [...page1.items, ...page2.items].map((r) => r.id);
      expect(new Set(tous).size).toBe(3);
    });

    it('accepte la limite maximale de 50', async () => {
      await creerRoute(userA, T1);

      const corps = await historique(jetonA, '?limit=50');

      expect(corps.limit).toBe(50);
      expect(corps.items).toHaveLength(1);
    });

    it('renvoie 200 et une liste vide au-delà de la dernière page', async () => {
      await troisTrajets();

      const corps = await historique(jetonA, '?page=99');

      // Une page vide n'est pas une erreur : la ressource existe, elle est
      // simplement sans contenu à cet endroit.
      expect(corps.items).toEqual([]);
      expect(corps.total).toBe(3);
      expect(corps.page).toBe(99);
    });

    it('renvoie une liste vide pour un usager sans trajet', async () => {
      const corps = await historique(jetonA);

      expect(corps).toEqual({ items: [], page: 1, limit: 20, total: 0 });
    });
  });

  // ===========================================================================
  // Validation des paramètres
  // ===========================================================================
  describe('validation des paramètres', () => {
    const refuse = (requete: string) =>
      request(app.getHttpServer())
        .get(`/api/routes${requete}`)
        .set('Authorization', `Bearer ${jetonA}`)
        .expect(400);

    // Aucun rabotage silencieux : une valeur hors bornes est REFUSÉE, pas
    // ramenée au plafond. C'est la ligne suivie dans tout le projet —
    // refuser plutôt que masquer.
    it('refuse limit=51 (au-dessus du plafond)', () => refuse('?limit=51'));
    it('refuse limit=0', () => refuse('?limit=0'));
    it('refuse page=0', () => refuse('?page=0'));
    it('refuse page=-1', () => refuse('?page=-1'));
    it('refuse une valeur non numérique', () => refuse('?page=deux'));
    it('refuse une valeur décimale', () => refuse('?limit=2.5'));

    it('refuse un paramètre inconnu comme ?userId=', async () => {
      // Tenter de lire l'historique d'autrui par l'URL. Le paramètre n'est
      // pas déclaré dans le DTO, et forbidNonWhitelisted s'applique aussi
      // aux paramètres d'URL.
      await refuse(`?userId=${userB}`);
    });

    it('accepte les bornes exactes : page=1 et limit=1', async () => {
      await creerRoute(userA, T1);

      const corps = await historique(jetonA, '?page=1&limit=1');

      expect(corps.items).toHaveLength(1);
    });
  });

  // ===========================================================================
  // Cloisonnement entre usagers
  // ===========================================================================
  describe('ownership', () => {
    it('ne renvoie à chacun que SES propres trajets', async () => {
      const aUn = await creerRoute(userA, T1);
      const aDeux = await creerRoute(userA, T2);
      const aTrois = await creerRoute(userA, T3);
      const bUn = await creerRoute(userB, T1);
      const bDeux = await creerRoute(userB, T2);

      const chezA = await historique(jetonA);
      const chezB = await historique(jetonB);

      expect(chezA.total).toBe(3);
      expect(chezA.items.map((r) => r.id).sort()).toEqual(
        [aUn, aDeux, aTrois].sort(),
      );

      expect(chezB.total).toBe(2);
      expect(chezB.items.map((r) => r.id).sort()).toEqual([bUn, bDeux].sort());

      // Aucun trajet de B ne doit apparaître chez A, ni l'inverse.
      const idsA = new Set(chezA.items.map((r) => r.id));
      expect(chezB.items.some((r) => idsA.has(r.id))).toBe(false);
    });

    it('compte le total sur les seuls trajets de l’usager', async () => {
      await creerRoute(userA, T1);
      await creerRoute(userB, T1);
      await creerRoute(userB, T2);

      // Un total calculé sans filtre renverrait 3 et trahirait l'existence
      // des trajets de B.
      expect((await historique(jetonA)).total).toBe(1);
    });

    it('refuse la requête sans jeton', async () => {
      await request(app.getHttpServer()).get('/api/routes').expect(401);
    });
  });

  // ===========================================================================
  // Forme de la réponse
  // ===========================================================================
  describe('forme de la réponse', () => {
    it('renvoie un résumé, SANS segments ni enregistrements carbone', async () => {
      await creerRoute(userA, T1);

      const corps = await historique(jetonA);
      const [item] = corps.items as unknown as Record<string, unknown>[];

      // Une liste est un résumé : charger les relations d'une page entière
      // ramènerait des dizaines de lignes que cette vue n'affiche pas.
      expect(item).not.toHaveProperty('segments');
      expect(item).not.toHaveProperty('carbonRecords');

      // ...mais tout ce dont un affichage d'historique a besoin est là.
      expect(Object.keys(item).sort()).toEqual([
        'carbonEstimate',
        'destinationLat',
        'destinationLng',
        'ecoScore',
        'id',
        'originLat',
        'originLng',
        'requestedAt',
        'totalDistanceM',
        'totalDurationMin',
        'userId',
      ]);
    });
  });
});
