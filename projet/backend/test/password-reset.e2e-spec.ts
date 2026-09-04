// Charge projet/backend/.env (DATABASE_URL, JWT_SECRET...).
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

// =============================================================================
// Réinitialisation de mot de passe (e2e, war room)
// =============================================================================
// ═══ POURQUOI CE PARCOURS EXIGE UNE VRAIE BASE ═══
//
// Les tests unitaires vérifient la LOGIQUE — empreinte, expiration, usage
// unique. Ils ne peuvent pas vérifier ce qui compte le plus ici : que le mot de
// passe écrit en base permet vraiment de se connecter, et que l'ancien ne le
// permet plus.
//
// C'est le seul chemin qui traverse trois services — réinitialisation,
// utilisateurs, authentification — et trois écritures. Un maillon simulé
// validerait la simulation.
//
// ⚠️ LE JETON EST RELU EN BASE PAR SON EMPREINTE. On ne peut pas l'intercepter
// autrement : il n'est ni renvoyé par l'API — ce serait une faille béante — ni
// stocké en clair. On tire donc un jeton candidat, on calcule son empreinte, et
// on l'INJECTE. C'est exactement ce que ferait quelqu'un ayant reçu le
// courriel, sans dépendre d'un transport qui n'existe pas.
// =============================================================================

describe('Réinitialisation de mot de passe (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const userIds: string[] = [];
  const PREFIXE = `e2e-reset-${Date.now()}`;
  const ANCIEN = 'ancien-mot-de-passe';
  const NOUVEAU = 'nouveau-mot-de-passe';

  const empreinte = (jeton: string) =>
    createHash('sha256').update(jeton).digest('hex');

  const creerUsager = async (suffixe: string) => {
    const email = `${PREFIXE}-${suffixe}@example.com`;

    await request(app.getHttpServer())
      .post('/api/users')
      .send({ email, password: ANCIEN })
      .expect(201);

    const cree = await prisma.user.findUniqueOrThrow({ where: { email } });
    userIds.push(cree.id);

    return { id: cree.id, email };
  };

  /**
   * Pose un jeton de réinitialisation directement en base, et rend sa valeur
   * en clair — celle qui serait arrivée par courriel.
   */
  const poserJeton = async (
    userId: string,
    options: { expire?: boolean; consomme?: boolean } = {},
  ) => {
    const clair = `jeton-e2e-${Math.random().toString(16).slice(2)}`;

    await prisma.passwordResetToken.create({
      data: {
        userId,
        tokenHash: empreinte(clair),
        expiresAt: new Date(
          Date.now() + (options.expire ? -60_000 : 15 * 60_000),
        ),
        usedAt: options.consomme ? new Date() : null,
      },
    });

    return clair;
  };

  const seConnecter = (email: string, password: string) =>
    request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password });

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

  afterAll(async () => {
    // ⚠️ ON NE SUPPRIME QUE CE QU'ON A CRÉÉ. Les jetons partent en cascade
    // avec leur utilisateur (`onDelete: Cascade`).
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }

    await app.close();
  });

  // ---------------------------------------------------------------------------
  // Aucune énumération de comptes
  // ---------------------------------------------------------------------------
  describe('POST /api/auth/forgot-password', () => {
    it('répond IDENTIQUEMENT pour une adresse inscrite et une inconnue', async () => {
      // ⚠️ LE TEST LE PLUS IMPORTANT DU FICHIER. Une réponse différente ferait
      // de cet endpoint un oracle : on lui soumettrait une liste d'adresses et
      // l'on apprendrait lesquelles ont un compte ici. Ces listes se revendent
      // et servent à l'hameçonnage ciblé.
      const usager = await creerUsager('enumeration');

      const inscrite = await request(app.getHttpServer())
        .post('/api/auth/forgot-password')
        .send({ email: usager.email })
        .expect(200);

      const inconnue = await request(app.getHttpServer())
        .post('/api/auth/forgot-password')
        .send({ email: `${PREFIXE}-jamais-vu@example.com` })
        .expect(200);

      expect(inconnue.body).toEqual(inscrite.body);
    });

    it('N’ANNONCE PAS un envoi de courriel', async () => {
      // Aucun transport n'est configuré : le lien est PRÉPARÉ, pas envoyé.
      const reponse = await request(app.getHttpServer())
        .post('/api/auth/forgot-password')
        .send({ email: `${PREFIXE}-formulation@example.com` })
        .expect(200);

      const message = (reponse.body as { message: string }).message;

      expect(message).toMatch(/préparé/i);
      expect(message).not.toMatch(/envoyé/i);
    });

    it('refuse une adresse MAL FORMÉE', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/forgot-password')
        .send({ email: 'pas-une-adresse' })
        .expect(400);
    });

    it('INVALIDE la demande précédente', async () => {
      // Sans cela, dix demandes laisseraient dix jetons valables en
      // circulation, et il suffirait d'intercepter le plus ancien courriel.
      const usager = await creerUsager('invalidation');

      await request(app.getHttpServer())
        .post('/api/auth/forgot-password')
        .send({ email: usager.email })
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/auth/forgot-password')
        .send({ email: usager.email })
        .expect(200);

      const encoreValides = await prisma.passwordResetToken.count({
        where: { userId: usager.id, usedAt: null },
      });

      expect(encoreValides).toBe(1);
    });

    it('N’ÉCRIT AUCUN JETON EN CLAIR en base', async () => {
      // ⚠️ Un jeton de réinitialisation vaut un mot de passe : lire la base ne
      // doit pas suffire à prendre la main sur un compte.
      const usager = await creerUsager('empreinte');

      await request(app.getHttpServer())
        .post('/api/auth/forgot-password')
        .send({ email: usager.email })
        .expect(200);

      const jeton = await prisma.passwordResetToken.findFirstOrThrow({
        where: { userId: usager.id },
      });

      // 64 caractères hexadécimaux : la signature d'un SHA-256, jamais celle
      // d'un secret lisible.
      expect(jeton.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  // ---------------------------------------------------------------------------
  // Le cycle complet
  // ---------------------------------------------------------------------------
  describe('POST /api/auth/reset-password', () => {
    it('REMPLACE RÉELLEMENT le mot de passe', async () => {
      // ⚠️ CE QUE LES TESTS UNITAIRES NE PEUVENT PAS VÉRIFIER : que le hachage
      // écrit permet vraiment de se connecter, et que l'ancien ne le permet
      // plus. Trois services et trois écritures sont traversés ici.
      const usager = await creerUsager('cycle-complet');
      const jeton = await poserJeton(usager.id);

      await seConnecter(usager.email, ANCIEN).expect(200);

      await request(app.getHttpServer())
        .post('/api/auth/reset-password')
        .send({ token: jeton, password: NOUVEAU })
        .expect(200);

      await seConnecter(usager.email, NOUVEAU).expect(200);
      await seConnecter(usager.email, ANCIEN).expect(401);
    });

    it('NE RENVOIE AUCUN JETON D’ACCÈS', async () => {
      // ⚠️ Réinitialiser ne doit pas connecter : quelqu'un qui aurait
      // intercepté le lien obtiendrait sinon une session sans jamais prouver
      // qu'il connaît le nouveau mot de passe.
      const usager = await creerUsager('sans-session');
      const jeton = await poserJeton(usager.id);

      const reponse = await request(app.getHttpServer())
        .post('/api/auth/reset-password')
        .send({ token: jeton, password: NOUVEAU })
        .expect(200);

      expect(JSON.stringify(reponse.body)).not.toMatch(/accessToken|Bearer/i);
    });

    it('REFUSE un jeton déjà utilisé', async () => {
      const usager = await creerUsager('usage-unique');
      const jeton = await poserJeton(usager.id);

      await request(app.getHttpServer())
        .post('/api/auth/reset-password')
        .send({ token: jeton, password: NOUVEAU })
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/auth/reset-password')
        .send({ token: jeton, password: 'encore-un-autre' })
        .expect(400);

      // Le second mot de passe n'a PAS été appliqué.
      await seConnecter(usager.email, NOUVEAU).expect(200);
    });

    it('REFUSE un jeton expiré', async () => {
      const usager = await creerUsager('expire');
      const jeton = await poserJeton(usager.id, { expire: true });

      await request(app.getHttpServer())
        .post('/api/auth/reset-password')
        .send({ token: jeton, password: NOUVEAU })
        .expect(400);

      await seConnecter(usager.email, ANCIEN).expect(200);
    });

    it('REFUSE un jeton inconnu', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/reset-password')
        .send({ token: 'jeton-qui-n-a-jamais-existe', password: NOUVEAU })
        .expect(400);
    });

    it('donne LE MÊME MESSAGE pour inconnu, expiré et déjà utilisé', async () => {
      // ⚠️ Les distinguer apprendrait qu'un jeton a existé, donc qu'une
      // demande a été faite pour un compte donné.
      const usager = await creerUsager('messages');
      const expire = await poserJeton(usager.id, { expire: true });
      const consomme = await poserJeton(usager.id, { consomme: true });

      const messages: string[] = [];

      for (const jeton of ['jamais-emis', expire, consomme]) {
        const reponse = await request(app.getHttpServer())
          .post('/api/auth/reset-password')
          .send({ token: jeton, password: NOUVEAU })
          .expect(400);

        messages.push((reponse.body as { message: string }).message);
      }

      expect(messages).toHaveLength(3);
      expect(new Set(messages).size).toBe(1);
    });

    it('REFUSE un mot de passe trop court, comme à l’inscription', async () => {
      // Une exigence plus faible ici ouvrirait un contournement : il suffirait
      // de demander une réinitialisation pour se donner un mot de passe que
      // l'inscription refuse.
      const usager = await creerUsager('trop-court');
      const jeton = await poserJeton(usager.id);

      await request(app.getHttpServer())
        .post('/api/auth/reset-password')
        .send({ token: jeton, password: 'court' })
        .expect(400);

      // Le jeton n'a PAS été consommé : l'usager peut réessayer avec un mot de
      // passe valable, sans redemander un lien.
      const encoreValide = await prisma.passwordResetToken.count({
        where: { userId: usager.id, usedAt: null },
      });

      expect(encoreValide).toBe(1);
    });

    it('REFUSE de ressusciter un compte SUPPRIMÉ', async () => {
      // Ressusciter un compte effacé par une réinitialisation viderait de son
      // sens le droit à l'effacement.
      const usager = await creerUsager('supprime');
      const jeton = await poserJeton(usager.id);

      await prisma.user.update({
        where: { id: usager.id },
        data: { deletedAt: new Date() },
      });

      await request(app.getHttpServer())
        .post('/api/auth/reset-password')
        .send({ token: jeton, password: NOUVEAU })
        .expect(400);
    });
  });
});
