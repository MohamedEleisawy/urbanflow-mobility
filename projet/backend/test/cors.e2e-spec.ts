// Charge projet/backend/.env (DATABASE_URL, JWT_SECRET...).
import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { METHODES_EXPOSEES, optionsCors } from './../src/config/cors.config';
import { entetesDeSecurite } from './../src/config/security-headers.middleware';

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

    // ⚠️ LA CONFIGURATION EST IMPORTÉE, PLUS JAMAIS RECOPIÉE.
    //
    // Ce fichier écrivait auparavant sa propre copie des options — et c'est
    // exactement ce qui a laissé passer le bug de l'étape 7-1 : `PATCH` a été
    // ajouté au frontend en 5E, la liste des méthodes n'a été mise à jour ni
    // dans `main.ts` ni ici, et le test a continué de valider SA copie.
    //
    // En important `optionsCors()`, ce test éprouve désormais la
    // configuration RÉELLE de l'application. Un verbe oublié échoue ici.
    app.use(entetesDeSecurite);
    app.enableCors(optionsCors());
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

  // ===========================================================================
  // Verbes exposés (étape 7-1)
  // ===========================================================================
  describe('méthodes autorisées', () => {
    /**
     * LE TEST QUI MANQUAIT.
     *
     * `PATCH /api/users/me/preferences` existe depuis l'étape 5E, et le
     * frontend l'appelle en cross-origin (`:3000` → `:3001`, sans `rewrites`
     * côté Next). La liste des méthodes ne le contenait pas : le navigateur
     * aurait refusé le préflight, et l'enregistrement des préférences aurait
     * échoué SANS QU'AUCUN TEST N'ÉCHOUE — supertest ne fait pas respecter
     * CORS, c'est une protection du navigateur.
     */
    it('autorise PATCH — le verbe des préférences', async () => {
      const reponse = await request(app.getHttpServer())
        .options('/api/users/me/preferences')
        .set('Origin', ORIGINE_AUTORISEE)
        .set('Access-Control-Request-Method', 'PATCH')
        .set('Access-Control-Request-Headers', 'authorization,content-type');

      expect(reponse.status).toBeLessThan(400);
      expect(reponse.headers['access-control-allow-methods']).toContain(
        'PATCH',
      );
    });

    it('autorise les QUATRE verbes réellement exposés', async () => {
      const reponse = await request(app.getHttpServer())
        .options('/api/users/me')
        .set('Origin', ORIGINE_AUTORISEE)
        .set('Access-Control-Request-Method', 'DELETE');

      const autorisees = reponse.headers['access-control-allow-methods'];

      for (const verbe of ['GET', 'POST', 'PATCH', 'DELETE']) {
        expect(autorisees).toContain(verbe);
      }
    });

    it("n'annonce PAS de verbe inexistant", async () => {
      const reponse = await request(app.getHttpServer())
        .options('/api/users/me')
        .set('Origin', ORIGINE_AUTORISEE)
        .set('Access-Control-Request-Method', 'GET');

      // Aucune route n'emploie PUT : l'annoncer ne « bloquerait » rien de
      // plus, mais décrirait une capacité que l'API ne possède pas.
      expect(reponse.headers['access-control-allow-methods']).not.toContain(
        'PUT',
      );
    });

    it('couvre EXACTEMENT les verbes des décorateurs de route', () => {
      // Garde-fou contre la régression de fond : ce n'est pas la liste qui
      // était fausse, c'est le fait que personne ne la comparait à la
      // réalité. `METHODES_EXPOSEES` est la source unique, importée par
      // `main.ts` comme par ce test.
      expect([...METHODES_EXPOSEES].sort()).toEqual([
        'DELETE',
        'GET',
        'PATCH',
        'POST',
      ]);
    });
  });

  // ===========================================================================
  // En-têtes de sécurité (étape 7-1)
  // ===========================================================================
  describe('en-têtes de sécurité', () => {
    it('interdit le reniflage de type', async () => {
      const reponse = await request(app.getHttpServer()).get('/api/alerts');

      expect(reponse.headers['x-content-type-options']).toBe('nosniff');
    });

    it("interdit l'affichage dans un cadre", async () => {
      const reponse = await request(app.getHttpServer()).get('/api/alerts');

      // L'API ne rend aucune page : elle n'a jamais à être encadrée.
      expect(reponse.headers['x-frame-options']).toBe('DENY');
      expect(reponse.headers['content-security-policy']).toContain(
        "frame-ancestors 'none'",
      );
    });

    it("pose une politique de contenu qui n'autorise rien", async () => {
      const reponse = await request(app.getHttpServer()).get('/api/alerts');

      // Sans effet sur du JSON — et c'est l'intérêt : elle neutralise le cas
      // où une page HTML sortirait d'ici par accident.
      expect(reponse.headers['content-security-policy']).toContain(
        "default-src 'none'",
      );
    });

    it("n'envoie aucun référent", async () => {
      const reponse = await request(app.getHttpServer()).get('/api/alerts');

      expect(reponse.headers['referrer-policy']).toBe('no-referrer');
    });

    it('ne divulgue PAS la technologie du serveur', async () => {
      const reponse = await request(app.getHttpServer()).get('/api/alerts');

      // Express annonce « X-Powered-By: Express » par défaut : un
      // renseignement offert à qui cherche une faille connue.
      expect(reponse.headers['x-powered-by']).toBeUndefined();
    });

    it("n'affirme PAS HTTPS en développement", async () => {
      const reponse = await request(app.getHttpServer()).get('/api/alerts');

      // HSTS n'est posé qu'en production : l'envoyer ici affirmerait une
      // propriété que le développement local ne possède pas. Les navigateurs
      // l'ignoreraient de toute façon sur une connexion en clair.
      expect(reponse.headers['strict-transport-security']).toBeUndefined();
    });

    it('protège AUSSI les réponses en erreur', async () => {
      const reponse = await request(app.getHttpServer())
        .get('/api/users/me')
        .expect(401);

      // Le middleware est posé avant tout le reste : une 401 les porte donc
      // comme une 200.
      expect(reponse.headers['x-content-type-options']).toBe('nosniff');
      expect(reponse.headers['x-powered-by']).toBeUndefined();
    });
  });
});
