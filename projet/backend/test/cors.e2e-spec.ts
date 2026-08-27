// Charge projet/backend/.env (DATABASE_URL, JWT_SECRET...).
import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

/**
 * Politique CORS (étape 5A-3).
 *
 * POURQUOI CE TEST EXISTE. CORS est une protection SILENCIEUSE : mal réglée,
 * elle ne casse rien côté serveur — les tests e2e passent, `curl` fonctionne,
 * et seul le navigateur refuse. Le symptôme apparaît donc au pire endroit
 * possible : dans la console du frontend, à un moment où l'on soupçonne
 * d'abord son propre code.
 *
 * Ces tests reproduisent ce que fait un navigateur : ils envoient un en-tête
 * `Origin` et vérifient la réponse.
 *
 * ⚠️ La configuration est lue AU DÉMARRAGE (`enableCors` dans main.ts, via
 * `FRONTEND_URL`). Ce test s'appuie donc sur le repli documenté —
 * `http://localhost:3000` — et non sur une variable qu'il modifierait.
 */
describe('CORS (e2e)', () => {
  let app: INestApplication<App>;

  const ORIGINE_AUTORISEE = 'http://localhost:3000';
  const ORIGINE_ETRANGERE = 'https://site-malveillant.example';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // On reproduit la configuration CORS de main.ts. Le reste (ValidationPipe,
    // préfixe /api) n'intervient pas dans ce que ce fichier vérifie.
    app.enableCors({
      origin: [ORIGINE_AUTORISEE],
      methods: ['GET', 'POST', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    });
    app.setGlobalPrefix('api');

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("autorise l'origine du frontend", async () => {
    const reponse = await request(app.getHttpServer())
      .get('/api/alerts')
      .set('Origin', ORIGINE_AUTORISEE)
      .expect(200);

    // C'est CET en-tête, et lui seul, qui autorise le JavaScript de la page à
    // lire la réponse.
    expect(reponse.headers['access-control-allow-origin']).toBe(
      ORIGINE_AUTORISEE,
    );
  });

  it("n'autorise PAS une origine inconnue", async () => {
    const reponse = await request(app.getHttpServer())
      .get('/api/alerts')
      .set('Origin', ORIGINE_ETRANGERE);

    // Le serveur répond quand même — CORS n'est pas une autorisation d'accès,
    // c'est une permission de LECTURE accordée au navigateur. Sans l'en-tête,
    // le navigateur jette la réponse.
    expect(reponse.headers['access-control-allow-origin']).toBeUndefined();
  });

  it("n'utilise JAMAIS le joker `*`", async () => {
    const reponse = await request(app.getHttpServer())
      .get('/api/alerts')
      .set('Origin', ORIGINE_AUTORISEE);

    // Le dossier l'exige (§3.1.2) : seules les requêtes du domaine du
    // frontend sont acceptées. `*` autoriserait tout site à appeler cette API
    // depuis le navigateur d'un usager.
    expect(reponse.headers['access-control-allow-origin']).not.toBe('*');
  });

  it("répond à la requête préalable d'une connexion", async () => {
    // Un POST portant `Content-Type: application/json` déclenche une requête
    // OPTIONS préalable. Si elle échoue, la connexion échoue AVANT même
    // d'atteindre le contrôleur.
    const reponse = await request(app.getHttpServer())
      .options('/api/auth/login')
      .set('Origin', ORIGINE_AUTORISEE)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');

    expect(reponse.status).toBeLessThan(400);
    expect(reponse.headers['access-control-allow-origin']).toBe(
      ORIGINE_AUTORISEE,
    );
    expect(reponse.headers['access-control-allow-methods']).toContain('POST');
  });

  it("autorise l'en-tête Authorization", async () => {
    // Sans lui, toute route protégée par JWT serait inatteignable depuis un
    // navigateur : la requête préalable refuserait l'en-tête.
    const reponse = await request(app.getHttpServer())
      .options('/api/users/me')
      .set('Origin', ORIGINE_AUTORISEE)
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization');

    expect(reponse.headers['access-control-allow-headers']).toContain(
      'Authorization',
    );
  });

  it("n'active PAS l'envoi de cookies entre origines", async () => {
    const reponse = await request(app.getHttpServer())
      .get('/api/alerts')
      .set('Origin', ORIGINE_AUTORISEE);

    // L'authentification passe par un en-tête Authorization, pas par un
    // cookie. Activer `credentials` ouvrirait une porte dont personne ne se
    // sert — et qui interdirait par ailleurs tout élargissement d'origine.
    expect(reponse.headers['access-control-allow-credentials']).toBeUndefined();
  });
});
