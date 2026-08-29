// Charge projet/backend/.env (DATABASE_URL, JWT_SECRET...).
import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

// Tests de bout en bout de PATCH /api/users/me/preferences (étape 5E-1).
//
// PostgreSQL est RÉEL, et il le faut ici plus qu'ailleurs :
//
//   - la PERSISTANCE ne se prouve pas avec un Prisma simulé — il faut relire
//     la ligne après l'écriture ;
//   - l'UPSERT dépend de la présence réelle d'une ligne, donc de la
//     contrainte `@unique` sur `userId` ;
//   - le CLOISONNEMENT entre deux usagers est la garantie centrale de cette
//     route, et un test à base de doublures ne prouverait que la doublure.
describe('PATCH /api/users/me/preferences (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const userIds: string[] = [];

  let jetonA: string;
  let userA: string;
  let jetonB: string;
  let userB: string;

  interface Preferences {
    id: string;
    preferredModes: string[];
    pmrMode: boolean;
    co2BudgetWeekly: number;
    notificationsEnabled: boolean;
    language: string;
    theme: string;
    userId: string;
  }

  /**
   * Crée un compte SANS préférences.
   *
   * `POST /api/users` n'exige pas le sous-objet `preferences` : c'est
   * précisément le cas qui rend l'upsert nécessaire, et c'est donc l'état de
   * départ le plus honnête pour cette suite.
   */
  const creerUsager = async (suffixe: string) => {
    const email = `e2e-5e1-${suffixe}-${Date.now()}@example.com`;
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

  const patch = (jeton: string, corps: Record<string, unknown>) =>
    request(app.getHttpServer())
      .patch('/api/users/me/preferences')
      .set('Authorization', `Bearer ${jeton}`)
      .send(corps);

  /// Relit la ligne DIRECTEMENT en base : c'est la seule preuve de
  /// persistance qui ne passe pas par le code qu'on teste.
  const enBase = (userId: string) =>
    prisma.userPreferences.findUnique({ where: { userId } });

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
    // Chaque test repart SANS préférences : c'est l'état d'un compte neuf, et
    // il fait passer l'upsert par sa branche `create`. Seules NOS lignes sont
    // touchées.
    await prisma.userPreferences.deleteMany({
      where: { userId: { in: userIds } },
    });
  });

  afterAll(async () => {
    // `onDelete: Cascade` sur la relation emporte les préférences restantes.
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  // ===========================================================================
  // Authentification
  // ===========================================================================
  describe('authentification', () => {
    it('refuse une requête SANS jeton', async () => {
      await request(app.getHttpServer())
        .patch('/api/users/me/preferences')
        .send({ co2BudgetWeekly: 5000 })
        .expect(401);
    });

    it('refuse un jeton invalide', async () => {
      await request(app.getHttpServer())
        .patch('/api/users/me/preferences')
        .set('Authorization', 'Bearer pas-un-vrai-jeton')
        .send({ co2BudgetWeekly: 5000 })
        .expect(401);
    });

    it("n'écrit RIEN quand le jeton est refusé", async () => {
      await request(app.getHttpServer())
        .patch('/api/users/me/preferences')
        .send({ co2BudgetWeekly: 9999 })
        .expect(401);

      expect(await enBase(userA)).toBeNull();
      expect(await enBase(userB)).toBeNull();
    });
  });

  // ===========================================================================
  // Création (branche `create` de l'upsert)
  // ===========================================================================
  describe('création', () => {
    it("CRÉE la ligne quand aucune préférence n'existe", async () => {
      expect(await enBase(userA)).toBeNull();

      const reponse = await patch(jetonA, { co2BudgetWeekly: 4200 }).expect(
        200,
      );

      const corps = reponse.body as Preferences;
      expect(corps.co2BudgetWeekly).toBe(4200);
      // Le userId de la ligne créée vient du JETON, jamais du corps.
      expect(corps.userId).toBe(userA);
    });

    it('applique les valeurs par défaut du schéma Prisma', async () => {
      await patch(jetonA, { co2BudgetWeekly: 4200 }).expect(200);

      const ligne = await enBase(userA);
      // Ces défauts viennent du modèle, pas du code : les répéter côté
      // application créerait une seconde vérité.
      expect(ligne?.pmrMode).toBe(false);
      expect(ligne?.notificationsEnabled).toBe(true);
      expect(ligne?.language).toBe('FR');
      expect(ligne?.theme).toBe('SYSTEM');
      expect(ligne?.preferredModes).toEqual([]);
    });

    it('REFUSE la création sans budget carbone', async () => {
      const reponse = await patch(jetonA, { theme: 'DARK' }).expect(400);

      // Le message dit QUOI FAIRE, il ne se contente pas de refuser.
      expect(JSON.stringify(reponse.body)).toMatch(/budget carbone/i);
      // Et surtout : rien n'a été créé. Inventer un budget par défaut aurait
      // fabriqué un chiffre que personne n'a choisi.
      expect(await enBase(userA)).toBeNull();
    });

    it('accepte un budget de ZÉRO', async () => {
      await patch(jetonA, { co2BudgetWeekly: 0 }).expect(200);

      // 0 EST UNE VALEUR — un objectif « zéro émission » est légitime. Un
      // test de vérité (`if (!budget)`) l'aurait confondu avec l'absence.
      expect((await enBase(userA))?.co2BudgetWeekly).toBe(0);
    });
  });

  // ===========================================================================
  // Mise à jour (branche `update` de l'upsert)
  // ===========================================================================
  describe('mise à jour', () => {
    beforeEach(async () => {
      await patch(jetonA, {
        co2BudgetWeekly: 5000,
        preferredModes: ['BUS', 'METRO'],
        pmrMode: true,
        theme: 'LIGHT',
      }).expect(200);
    });

    it('modifie réellement la valeur en base', async () => {
      await patch(jetonA, { co2BudgetWeekly: 3000 }).expect(200);

      // Relu EN BASE, pas dans la réponse : c'est la persistance qu'on
      // vérifie, pas l'écho du serveur.
      expect((await enBase(userA))?.co2BudgetWeekly).toBe(3000);
    });

    it('CONSERVE les champs absents du corps', async () => {
      await patch(jetonA, { theme: 'DARK' }).expect(200);

      const ligne = await enBase(userA);
      expect(ligne?.theme).toBe('DARK');
      // Tout le reste est intact : c'est la sémantique d'un PATCH, et la
      // raison pour laquelle ce n'est pas un PUT.
      expect(ligne?.co2BudgetWeekly).toBe(5000);
      expect(ligne?.preferredModes).toEqual(['BUS', 'METRO']);
      expect(ligne?.pmrMode).toBe(true);
    });

    it('remplace entièrement un tableau de modes', async () => {
      await patch(jetonA, { preferredModes: ['BIKE'] }).expect(200);

      // Un tableau fourni REMPLACE, il ne fusionne pas : sans cela, on ne
      // pourrait jamais retirer un mode de ses favoris.
      expect((await enBase(userA))?.preferredModes).toEqual(['BIKE']);
    });

    it('accepte un tableau VIDE', async () => {
      await patch(jetonA, { preferredModes: [] }).expect(200);

      expect((await enBase(userA))?.preferredModes).toEqual([]);
    });

    it('renvoie EXACTEMENT ce qui est persisté', async () => {
      const reponse = await patch(jetonA, {
        pmrMode: false,
        theme: 'DARK',
      }).expect(200);

      const corps = reponse.body as Preferences;
      const ligne = await enBase(userA);

      // Le frontend se sert de cette réponse pour rafraîchir son état : elle
      // doit refléter la base, pas le corps de la requête.
      expect(corps.pmrMode).toBe(ligne?.pmrMode);
      expect(corps.theme).toBe(ligne?.theme);
      expect(corps.co2BudgetWeekly).toBe(ligne?.co2BudgetWeekly);
    });
  });

  // ===========================================================================
  // Validation
  // ===========================================================================
  describe('validation', () => {
    it('refuse un champ INCONNU', async () => {
      // `forbidNonWhitelisted` est actif globalement : aucun code spécifique
      // n'est nécessaire pour cela.
      await patch(jetonA, {
        co2BudgetWeekly: 100,
        couleurPreferee: 'bleu',
      }).expect(400);

      expect(await enBase(userA)).toBeNull();
    });

    it('refuse un mode de transport INEXISTANT', async () => {
      await patch(jetonA, {
        co2BudgetWeekly: 100,
        preferredModes: ['FUSEE'],
      }).expect(400);
    });

    it('refuse un thème INEXISTANT', async () => {
      await patch(jetonA, {
        co2BudgetWeekly: 100,
        theme: 'ARC_EN_CIEL',
      }).expect(400);
    });

    it('refuse une langue INEXISTANTE', async () => {
      await patch(jetonA, { co2BudgetWeekly: 100, language: 'KLINGON' }).expect(
        400,
      );
    });

    it("refuse un budget qui n'est pas un nombre", async () => {
      await patch(jetonA, { co2BudgetWeekly: 'beaucoup' }).expect(400);
    });

    it('refuse un booléen mal typé', async () => {
      await patch(jetonA, { co2BudgetWeekly: 100, pmrMode: 'oui' }).expect(400);
    });
  });

  // ===========================================================================
  // Cloisonnement — la garantie centrale de cette route
  // ===========================================================================
  describe('cloisonnement', () => {
    it('B ne peut PAS modifier les préférences de A, même en le nommant', async () => {
      await patch(jetonA, { co2BudgetWeekly: 5000, theme: 'LIGHT' }).expect(
        200,
      );

      // B envoie le `userId` de A dans le corps. Le DTO ne déclare pas ce
      // champ, donc `forbidNonWhitelisted` répond 400 — la tentative n'atteint
      // même pas le service.
      await patch(jetonB, { co2BudgetWeekly: 1, userId: userA }).expect(400);

      // A est intact.
      expect((await enBase(userA))?.co2BudgetWeekly).toBe(5000);
      expect((await enBase(userA))?.theme).toBe('LIGHT');
    });

    it('B ne touche QUE ses propres préférences', async () => {
      await patch(jetonA, { co2BudgetWeekly: 5000 }).expect(200);

      await patch(jetonB, { co2BudgetWeekly: 9999 }).expect(200);

      // Deux lignes distinctes, chacune la sienne. La contrainte `@unique`
      // sur `userId` garantit qu'il ne peut y en avoir qu'une par compte.
      expect((await enBase(userA))?.co2BudgetWeekly).toBe(5000);
      expect((await enBase(userB))?.co2BudgetWeekly).toBe(9999);
    });

    it("la route n'expose AUCUN identifiant à passer", async () => {
      // Il n'existe pas de `/api/users/:id/preferences` : le seul chemin
      // possible est `/me`. Une route paramétrée obligerait à vérifier à
      // chaque appel que l'identifiant correspond au porteur du jeton — un
      // contrôle qu'on peut oublier. Ici, il n'y a rien à oublier.
      await request(app.getHttpServer())
        .patch(`/api/users/${userA}/preferences`)
        .set('Authorization', `Bearer ${jetonB}`)
        .send({ co2BudgetWeekly: 1 })
        .expect(404);
    });
  });

  // ===========================================================================
  // Cohérence avec GET /api/users/me
  // ===========================================================================
  describe('lecture après écriture', () => {
    it('GET /users/me reflète les nouvelles préférences', async () => {
      await patch(jetonA, { co2BudgetWeekly: 7777, theme: 'DARK' }).expect(200);

      const moi = await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Authorization', `Bearer ${jetonA}`)
        .expect(200);

      const corps = moi.body as {
        preferences: Preferences;
        passwordHash?: string;
      };
      expect(corps.preferences.co2BudgetWeekly).toBe(7777);
      expect(corps.preferences.theme).toBe('DARK');
      // Le frontend rechargera son profil par cette route : elle ne doit
      // toujours pas laisser fuiter le mot de passe.
      expect(corps.passwordHash).toBeUndefined();
    });
  });
});
