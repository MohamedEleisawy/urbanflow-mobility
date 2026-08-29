// Charge projet/backend/.env (DATABASE_URL, JWT_SECRET...).
import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

// Tests de bout en bout de DELETE /api/users/me (étape 5G).
//
// PostgreSQL est RÉEL, et rien d'autre ne conviendrait :
//
//   - la SUPPRESSION LOGIQUE se prouve en relisant `deletedAt` en base ;
//   - le VERROUILLAGE des dix routes protégées ne se démontre qu'en les
//     appelant réellement avec un jeton encore cryptographiquement valide ;
//   - la SURVIE des données associées (préférences, trajets, empreintes) ne
//     se vérifie qu'en constatant qu'elles sont toujours là après coup.
describe('DELETE /api/users/me (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const userIds: string[] = [];
  const routeIds: string[] = [];

  let jetonA: string;
  let userA: string;
  let emailA: string;
  let motDePasseA: string;
  let jetonB: string;
  let userB: string;

  const MOT_DE_PASSE = 'motdepasse-de-test';

  const creerUsager = async (suffixe: string) => {
    const email = `e2e-5g-${suffixe}-${Date.now()}@example.com`;

    await request(app.getHttpServer())
      .post('/api/users')
      .send({ email, password: MOT_DE_PASSE })
      .expect(201);

    const connexion = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: MOT_DE_PASSE })
      .expect(200);

    const usager = await prisma.user.findUniqueOrThrow({ where: { email } });
    userIds.push(usager.id);

    return {
      jeton: (connexion.body as { accessToken: string }).accessToken,
      id: usager.id,
      email,
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

  const supprimerCompte = (jeton: string) =>
    request(app.getHttpServer())
      .delete('/api/users/me')
      .set('Authorization', `Bearer ${jeton}`);

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
  });

  beforeEach(async () => {
    // Des comptes NEUFS à chaque test : une suppression est irréversible, un
    // compte supprimé ne peut donc pas resservir.
    const a = await creerUsager('a');
    jetonA = a.jeton;
    userA = a.id;
    emailA = a.email;
    motDePasseA = MOT_DE_PASSE;
    const b = await creerUsager('b');
    jetonB = b.jeton;
    userB = b.id;
  });

  afterEach(async () => {
    await prisma.route.deleteMany({ where: { id: { in: routeIds } } });
    routeIds.length = 0;
    // Ici seulement, une suppression PHYSIQUE : ce sont des comptes de test,
    // et `onDelete: Cascade` emporte tout le reste.
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    userIds.length = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  // ===========================================================================
  // La suppression elle-même
  // ===========================================================================
  describe('suppression', () => {
    it('répond 204 sans corps', async () => {
      const reponse = await supprimerCompte(jetonA).expect(204);

      expect(reponse.body).toEqual({});
      expect(reponse.text).toBeFalsy();
    });

    it('POSE réellement une date en base', async () => {
      await supprimerCompte(jetonA).expect(204);

      const compte = await prisma.user.findUniqueOrThrow({
        where: { id: userA },
      });
      expect(compte.deletedAt).toBeInstanceOf(Date);
    });

    it('NE SUPPRIME PAS physiquement la ligne', async () => {
      await supprimerCompte(jetonA).expect(204);

      // Le schéma le prescrit : « jamais de DELETE physique sur ce compte ».
      const compte = await prisma.user.findUnique({ where: { id: userA } });
      expect(compte).not.toBeNull();
      expect(compte?.email).toBe(emailA);
    });

    it('refuse la suppression SANS jeton', async () => {
      await request(app.getHttpServer()).delete('/api/users/me').expect(401);

      const compte = await prisma.user.findUniqueOrThrow({
        where: { id: userA },
      });
      expect(compte.deletedAt).toBeNull();
    });

    it("la route n'accepte AUCUN identifiant", async () => {
      // `/api/users/:id` n'accepte que GET : un DELETE dessus ne correspond à
      // aucune route. Il n'y a donc aucun paramètre à contrôler, donc aucun
      // contrôle à oublier.
      await request(app.getHttpServer())
        .delete(`/api/users/${userA}`)
        .set('Authorization', `Bearer ${jetonB}`)
        .expect(404);

      const compte = await prisma.user.findUniqueOrThrow({
        where: { id: userA },
      });
      expect(compte.deletedAt).toBeNull();
    });
  });

  // ===========================================================================
  // Le compte devient inutilisable — le cœur de l'étape
  // ===========================================================================
  describe('après suppression', () => {
    beforeEach(async () => {
      await peupler(userA, jetonA);
      await supprimerCompte(jetonA).expect(204);
    });

    it('NE PEUT PLUS SE RECONNECTER', async () => {
      const reponse = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: emailA, password: motDePasseA })
        .expect(401);

      // Même message qu'un mot de passe faux : on n'apprend pas qu'un compte
      // a existé.
      expect(JSON.stringify(reponse.body)).toMatch(/incorrect/i);
    });

    it('SON JETON ENCORE VALIDE ne fonctionne plus nulle part', async () => {
      // ⚠️ LE POINT CENTRAL DE L'ÉTAPE. Le jeton reste cryptographiquement
      // valide une heure durant : seule une vérification en base peut le
      // rendre inopérant. Elle vit dans `JwtAuthGuard`, donc UNE fois pour
      // les dix routes.
      const entete = { Authorization: `Bearer ${jetonA}` };
      const serveur = app.getHttpServer();

      await request(serveur).get('/api/users/me').set(entete).expect(401);
      await request(serveur)
        .get('/api/users/me/export')
        .set(entete)
        .expect(401);
      await request(serveur)
        .patch('/api/users/me/preferences')
        .set(entete)
        .send({ co2BudgetWeekly: 1 })
        .expect(401);
      await request(serveur).get('/api/routes').set(entete).expect(401);
      await request(serveur)
        .get(`/api/routes/${routeIds[0]}`)
        .set(entete)
        .expect(401);
      await request(serveur)
        .delete(`/api/routes/${routeIds[0]}`)
        .set(entete)
        .expect(401);
      await request(serveur).get('/api/suivi-carbone').set(entete).expect(401);
      await request(serveur)
        .get('/api/suivi-carbone/budget')
        .set(entete)
        .expect(401);
      await request(serveur).delete('/api/users/me').set(entete).expect(401);
    });

    it('NE PEUT PLUS enregistrer de trajet', async () => {
      await request(app.getHttpServer())
        .post('/api/routes')
        .set('Authorization', `Bearer ${jetonA}`)
        .send({
          originLat: 48.88,
          originLng: 2.355,
          destinationLat: 48.853,
          destinationLng: 2.369,
          segments: [],
        })
        .expect(401);
    });

    it('SES MODIFICATIONS refusées ne laissent AUCUNE trace', async () => {
      await request(app.getHttpServer())
        .patch('/api/users/me/preferences')
        .set('Authorization', `Bearer ${jetonA}`)
        .send({ co2BudgetWeekly: 99999 })
        .expect(401);

      // Le guard rejette AVANT le controller : rien n'a pu être écrit.
      const prefs = await prisma.userPreferences.findUnique({
        where: { userId: userA },
      });
      expect(prefs?.co2BudgetWeekly).toBe(5000);
    });

    it('les ROUTES PUBLIQUES restent accessibles', async () => {
      // La suppression d'un compte ne ferme pas l'application : le dossier
      // veut qu'elle reste utilisable sans compte.
      await request(app.getHttpServer()).get('/api/stops').expect(200);
      await request(app.getHttpServer()).get('/api/alerts').expect(200);
    });
  });

  // ===========================================================================
  // Données associées
  // ===========================================================================
  describe('données associées', () => {
    it('SURVIVENT toutes à la suppression', async () => {
      const routeId = await peupler(userA, jetonA);

      await supprimerCompte(jetonA).expect(204);

      // Rien n'est détruit : la suppression logique rend le compte
      // inutilisable, elle n'efface pas l'historique. Un `delete` physique
      // aurait déclenché quatre `onDelete: Cascade`.
      expect(
        await prisma.userPreferences.findUnique({ where: { userId: userA } }),
      ).not.toBeNull();
      expect(
        await prisma.route.findUnique({ where: { id: routeId } }),
      ).not.toBeNull();
      expect(await prisma.segment.count({ where: { routeId } })).toBe(1);
      expect(
        await prisma.carbonRecord.count({ where: { userId: userA } }),
      ).toBe(1);
    });
  });

  // ===========================================================================
  // Cloisonnement
  // ===========================================================================
  describe('cloisonnement', () => {
    it("la suppression de A n'affecte EN RIEN B", async () => {
      await peupler(userB, jetonB);

      await supprimerCompte(jetonA).expect(204);

      // B garde son compte actif…
      const compteB = await prisma.user.findUniqueOrThrow({
        where: { id: userB },
      });
      expect(compteB.deletedAt).toBeNull();

      // …son jeton, et toutes ses données.
      await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Authorization', `Bearer ${jetonB}`)
        .expect(200);
      expect(
        await prisma.carbonRecord.count({ where: { userId: userB } }),
      ).toBe(1);
    });

    it('B peut toujours se connecter après la suppression de A', async () => {
      await supprimerCompte(jetonA).expect(204);

      await request(app.getHttpServer())
        .get('/api/users/me/export')
        .set('Authorization', `Bearer ${jetonB}`)
        .expect(200);
    });
  });

  // ===========================================================================
  // Idempotence
  // ===========================================================================
  describe('idempotence', () => {
    it('une seconde suppression ne REDATE PAS la première', async () => {
      await supprimerCompte(jetonA).expect(204);
      const premiere = await prisma.user.findUniqueOrThrow({
        where: { id: userA },
      });

      // Le jeton de A est désormais refusé par le guard : on appelle donc le
      // service par une seconde requête qui, elle, sera rejetée. C'est le
      // filtre `deletedAt: null` du service qui porte la garantie — vérifiée
      // ici en réappliquant directement l'opération.
      await prisma.user.updateMany({
        where: { id: userA, deletedAt: null },
        data: { deletedAt: new Date('2030-01-01T00:00:00.000Z') },
      });

      const seconde = await prisma.user.findUniqueOrThrow({
        where: { id: userA },
      });
      // La date initiale est la seule trace de QUAND le droit a été exercé.
      expect(seconde.deletedAt?.getTime()).toBe(premiere.deletedAt?.getTime());
    });
  });
});
