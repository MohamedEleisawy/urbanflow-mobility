// Charge projet/backend/.env (DATABASE_URL, JWT_SECRET...).
import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { UsersService } from './../src/users/users.service';

// Promotion d'un utilisateur en administrateur (étape 6-2).
//
// PostgreSQL est RÉEL, et c'est toute la valeur de cette suite : ce qu'on veut
// prouver n'est pas qu'une méthode rend le bon objet — les tests unitaires le
// font déjà — mais que la CHAÎNE COMPLÈTE fonctionne :
//
//     inscription → promotion → RECONNEXION → nouveau JWT → accès ADMIN
//
// Chaque maillon est vérifié sur la vraie base et le vrai serveur HTTP.
//
// ⚠️ On appelle `UsersService.promoteToAdmin` directement, et non le script
// `user-promote.cli.ts`. Le script démarre sa PROPRE application Nest et
// appelle `process.exit` : le lancer depuis Jest ouvrirait une seconde
// connexion à la base et tuerait le processus de test. Le script n'étant
// qu'une enveloppe de dix lignes autour de ce service, c'est bien le service
// qui porte le comportement à éprouver. Le script, lui, est exécuté
// RÉELLEMENT en ligne de commande à la fin de l'étape.
describe('Promotion en administrateur (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let users: UsersService;

  const userIds: string[] = [];
  const stopIds: string[] = [];

  const MOT_DE_PASSE = 'motdepasse-de-test';

  const creerUsager = async (suffixe: string) => {
    const email = `e2e-6c2-${suffixe}-${Date.now()}@example.com`;

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

  /// Décode la charge utile d'un JWT, sans vérifier sa signature : on veut
  /// seulement constater ce que le serveur y a mis.
  const roleDuJeton = (jeton: string): string =>
    (
      JSON.parse(
        Buffer.from(jeton.split('.')[1], 'base64').toString('utf8'),
      ) as { role: string }
    ).role;

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
    users = app.get(UsersService);
  });

  afterEach(async () => {
    await prisma.stop.deleteMany({ where: { id: { in: stopIds } } });
    stopIds.length = 0;
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    userIds.length = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  // ===========================================================================
  // La promotion elle-même
  // ===========================================================================
  describe('promotion', () => {
    it('change RÉELLEMENT le rôle en base', async () => {
      const { id, email } = await creerUsager('promu');
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id } })).role,
      ).toBe('USER');

      await users.promoteToAdmin(email);

      // Relu EN BASE : c'est la seule preuve qui ne passe pas par le code
      // qu'on teste.
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id } })).role,
      ).toBe('ADMIN');
    });

    it('NE TOUCHE À AUCUN autre champ', async () => {
      const { id, email } = await creerUsager('intact');
      const avant = await prisma.user.findUniqueOrThrow({ where: { id } });

      await users.promoteToAdmin(email);

      const apres = await prisma.user.findUniqueOrThrow({ where: { id } });
      expect(apres.email).toBe(avant.email);
      // Le mot de passe en particulier : la commande n'en demande aucun et
      // n'en modifie aucun.
      expect(apres.passwordHash).toBe(avant.passwordHash);
      expect(apres.createdAt.getTime()).toBe(avant.createdAt.getTime());
      expect(apres.deletedAt).toBeNull();
    });

    it('LÈVE sur un compte introuvable', async () => {
      await expect(
        users.promoteToAdmin('personne-de-ce-nom@example.com'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('REFUSE un compte supprimé', async () => {
      const { id, email } = await creerUsager('supprime');
      await prisma.user.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      await expect(users.promoteToAdmin(email)).rejects.toBeInstanceOf(
        BadRequestException,
      );

      // Le rôle est resté USER : promouvoir aurait créé un administrateur
      // incapable de se connecter (étape 5G).
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id } })).role,
      ).toBe('USER');
    });
  });

  // ===========================================================================
  // Idempotence
  // ===========================================================================
  describe('idempotence', () => {
    it('deux exécutions donnent le MÊME résultat', async () => {
      const { email } = await creerUsager('deux-fois');

      const premiere = await users.promoteToAdmin(email);
      const seconde = await users.promoteToAdmin(email);

      expect(premiere).toEqual({ email, role: 'ADMIN', dejaAdmin: false });
      // La seconde CONSTATE, elle ne réécrit pas — et surtout, elle ne
      // dégrade rien.
      expect(seconde).toEqual({ email, role: 'ADMIN', dejaAdmin: true });
    });

    it('le compte reste ADMIN après la seconde exécution', async () => {
      const { id, email } = await creerUsager('stable');

      await users.promoteToAdmin(email);
      await users.promoteToAdmin(email);

      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id } })).role,
      ).toBe('ADMIN');
    });
  });

  // ===========================================================================
  // Le jeton : la partie que l'on oublie
  // ===========================================================================
  describe('effet sur les jetons', () => {
    it('un ANCIEN jeton ne devient PAS administrateur', async () => {
      const { email } = await creerUsager('ancien-jeton');
      const jetonAvant = await seConnecter(email);

      await users.promoteToAdmin(email);

      // Le rôle est signé DANS le jeton au moment du login : la base a
      // changé, ce jeton non. C'est la contrepartie d'un JWT autoportant —
      // et elle est sans danger, un ancien jeton donne MOINS de droits.
      expect(roleDuJeton(jetonAvant)).toBe('USER');

      await request(app.getHttpServer())
        .post('/api/stops')
        .set('Authorization', `Bearer ${jetonAvant}`)
        .send(arret('Arrêt avec ancien jeton'))
        .expect(403);
    });

    it('APRÈS RECONNEXION, le jeton porte ADMIN', async () => {
      const { email } = await creerUsager('reconnexion');

      await users.promoteToAdmin(email);
      const jetonApres = await seConnecter(email);

      expect(roleDuJeton(jetonApres)).toBe('ADMIN');
    });

    it('le nouveau jeton OUVRE réellement POST /api/stops', async () => {
      const { email } = await creerUsager('acces-admin');

      await users.promoteToAdmin(email);
      const jeton = await seConnecter(email);

      // La chaîne complète : base → promotion → login → signature → guard.
      const reponse = await request(app.getHttpServer())
        .post('/api/stops')
        .set('Authorization', `Bearer ${jeton}`)
        .send(arret('Arrêt créé après promotion'))
        .expect(201);

      stopIds.push((reponse.body as { id: string }).id);
    });

    it('un ADMIN garde AUSSI ses droits ordinaires', async () => {
      const { email } = await creerUsager('droits-ordinaires');

      await users.promoteToAdmin(email);
      const jeton = await seConnecter(email);

      // La promotion ajoute des permissions, elle n'en retire aucune.
      await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Authorization', `Bearer ${jeton}`)
        .expect(200);
    });
  });

  // ===========================================================================
  // Cloisonnement
  // ===========================================================================
  describe('cloisonnement', () => {
    it('les AUTRES comptes restent USER', async () => {
      const promu = await creerUsager('promu-a');
      const temoin = await creerUsager('temoin-b');

      await users.promoteToAdmin(promu.email);

      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: temoin.id } }))
          .role,
      ).toBe('USER');
    });

    it('le témoin reste REFUSÉ sur POST /api/stops', async () => {
      const promu = await creerUsager('promu-c');
      const temoin = await creerUsager('temoin-d');

      await users.promoteToAdmin(promu.email);
      const jetonTemoin = await seConnecter(temoin.email);

      await request(app.getHttpServer())
        .post('/api/stops')
        .set('Authorization', `Bearer ${jetonTemoin}`)
        .send(arret('Arrêt du témoin'))
        .expect(403);
    });
  });
});
