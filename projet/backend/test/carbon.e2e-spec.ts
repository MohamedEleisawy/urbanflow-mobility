// Charge projet/backend/.env (DATABASE_URL, JWT_SECRET, CARBON_SERVICE_URL).
// Indispensable ici : en test end-to-end on importe AppModule directement,
// donc main.ts — qui fait normalement ce chargement — n'est jamais exécuté.
import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

// Test d'INTÉGRATION : l'application est réellement démarrée, la requête
// traverse le routage, le ValidationPipe global et le contrôleur.
//
// SEUL l'appel réseau vers FastAPI est simulé. Ce choix est explicite :
// `npm run test:e2e` ne doit pas exiger qu'un microservice Python tourne à
// côté, sans quoi la suite deviendrait rouge pour une raison étrangère au
// backend. Le microservice a sa propre suite de tests (étape 4D-1), et
// l'intégration réelle des deux est vérifiée à la main (voir le carnet).
describe('POST /api/carbone (e2e)', () => {
  let app: INestApplication<App>;

  // Réponse type du microservice, telle que mesurée à l'étape 4D-1.
  const REPONSE_FASTAPI = {
    total_distance_m: 3800,
    total_co2_g: 361.6,
    car_co2_g: 828.4,
    saved_g: 466.8,
    breakdown: [
      { mode: 'WALK', distance_m: 600, co2_g: 0.0 },
      { mode: 'BUS', distance_m: 3200, co2_g: 361.6 },
    ],
  };

  const CORPS_VALIDE = {
    segments: [
      { mode: 'WALK', distanceM: 600 },
      { mode: 'BUS', distanceM: 3200 },
    ],
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    // logger: false — le test des pannes provoque VOLONTAIREMENT des erreurs
    // journalisées par CarbonService. Les afficher laisserait croire à un
    // échec dans une suite pourtant verte.
    app = moduleFixture.createNestApplication({ logger: false });

    // On reproduit la configuration de main.ts, sinon la validation et le
    // préfixe /api ne s'appliqueraient pas et le test ne refléterait pas
    // le comportement réel de l'application.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.setGlobalPrefix('api');

    await app.init();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it('renvoie 200 et le contrat public en camelCase', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(REPONSE_FASTAPI), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const reponse = await request(app.getHttpServer())
      .post('/api/carbone')
      .send(CORPS_VALIDE)
      .expect(200);

    expect(reponse.body).toEqual({
      totalDistanceM: 3800,
      totalCo2Grams: 361.6,
      carCo2Grams: 828.4,
      savedVsCarGrams: 466.8,
      breakdown: [
        { mode: 'WALK', distanceM: 600, co2Grams: 0 },
        { mode: 'BUS', distanceM: 3200, co2Grams: 361.6 },
      ],
    });
  });

  it("est accessible SANS jeton d'authentification", async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify(REPONSE_FASTAPI), { status: 200 }),
      );

    // Aucun en-tête Authorization : l'étape 4D est un calcul sans état, et
    // le diagramme de cas d'utilisation ne le réserve à personne.
    const reponse = await request(app.getHttpServer())
      .post('/api/carbone')
      .send(CORPS_VALIDE);

    expect(reponse.status).not.toBe(401);
    expect(reponse.status).toBe(200);
  });

  it('renvoie 400 sur un corps invalide, sans appeler FastAPI', async () => {
    const appel = jest.spyOn(global, 'fetch');

    await request(app.getHttpServer())
      .post('/api/carbone')
      .send({ segments: [] })
      .expect(400);

    // La validation précède l'appel réseau : une requête invalide ne coûte
    // rien au microservice.
    expect(appel).not.toHaveBeenCalled();
  });

  it('renvoie 400 sur un mode inexistant, sans appeler FastAPI', async () => {
    const appel = jest.spyOn(global, 'fetch');

    await request(app.getHttpServer())
      .post('/api/carbone')
      .send({ segments: [{ mode: 'FUSEE', distanceM: 1000 }] })
      .expect(400);

    expect(appel).not.toHaveBeenCalled();
  });

  it('renvoie 422 quand FastAPI refuse de calculer un mode', async () => {
    // ESCOOTER traverse le DTO (il est dans l'enum Prisma) mais n'a aucun
    // facteur d'émission côté microservice.
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          detail: [
            {
              msg: "Value error, Mode 'ESCOOTER' non supporte : aucun facteur",
            },
          ],
        }),
        { status: 422 },
      ),
    );

    const reponse = await request(app.getHttpServer())
      .post('/api/carbone')
      .send({ segments: [{ mode: 'ESCOOTER', distanceM: 1000 }] })
      .expect(422);

    expect(JSON.stringify(reponse.body)).toContain('ESCOOTER');
  });

  it('renvoie 503 quand le microservice est injoignable', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new TypeError('fetch failed'));

    const reponse = await request(app.getHttpServer())
      .post('/api/carbone')
      .send(CORPS_VALIDE)
      .expect(503);

    // Message public clair, sans pile d'exécution ni adresse interne.
    expect(reponse.body).toMatchObject({
      message: 'Service de calcul carbone indisponible',
    });
    expect(JSON.stringify(reponse.body)).not.toContain('fetch failed');
  });
});
