// Charge projet/backend/.env (DATABASE_URL, JWT_SECRET...).
import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

// =============================================================================
// GET /api/velib/* — contrat HTTP (Phase 5)
// =============================================================================
// ⚠️ LE FOURNISSEUR EST SIMULÉ. Ces tests éprouvent NOTRE contrat — validation,
// codes de statut, forme de la réponse — jamais Smovengo. Un test qui
// l'interrogerait vraiment échouerait hors ligne et dépendrait de l'état réel
// du réseau Vélib' à l'instant du test.
// =============================================================================

describe('Vélib’ (e2e)', () => {
  let app: INestApplication<App>;
  let appelFetch: jest.SpyInstance;

  const STATION = {
    station_id: 213688169,
    stationCode: '16107',
    name: 'Benjamin Godard - Victor Hugo',
    lat: 48.865983,
    lon: 2.275725,
    capacity: 35,
  };

  const ETAT = {
    station_id: 213688169,
    num_bikes_available: 13,
    num_bikes_available_types: [{ mechanical: 5 }, { ebike: 8 }],
    num_docks_available: 21,
    is_installed: 1,
    is_renting: 1,
    is_returning: 1,
    last_reported: 1788382184,
  };

  /**
   * Fait répondre les flux SELON L'URL demandée.
   *
   * ⚠️ PAR URL, ET NON PAR ORDRE D'APPEL — et c'est un vrai correctif. La
   * version précédente empilait deux `mockResolvedValueOnce` ; le service
   * lisant désormais QUATRE fichiers, les deux suivants retombaient sur le
   * `fetch` RÉEL et interrogeaient l'internet. Le test dépendait donc de la
   * disponibilité de Vélhop, ce que l'en-tête de ce fichier interdit
   * explicitement.
   *
   * Tout fichier non déclaré rend 404 : c'est ainsi qu'on éprouve l'absence
   * d'un flux facultatif.
   */
  const repondre = (info: unknown[], etat: unknown[]) => {
    appelFetch.mockImplementation((url: string) => {
      if (url.includes('station_information.json')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: { stations: info } }),
        });
      }

      if (url.includes('station_status.json')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: { stations: etat } }),
        });
      }

      return Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.resolve(null),
      });
    });
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
  });

  beforeEach(() => {
    appelFetch = jest.spyOn(global, 'fetch');
    repondre([STATION], [ETAT]);
  });

  afterEach(() => {
    appelFetch.mockRestore();
  });

  afterAll(async () => {
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // Liste
  // ---------------------------------------------------------------------------

  it('est PUBLIC et rend les stations avec leur attribution', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/velib/stations')
      .expect(200);

    const corps = response.body as {
      stations: unknown[];
      total: number;
      fetchedAt: string;
      attribution: string;
    };

    expect(corps.total).toBeGreaterThan(0);
    // ⚠️ L'ATTRIBUTION EST LUE DANS LE FLUX (`system_information.json`), qui
    // n'est pas simulé ici : le service se replie donc sur une mention
    // neutre. Le point vérifié est qu'il y en a TOUJOURS une — la licence de
    // ces flux impose de citer la source — et qu'elle ne nomme aucun
    // exploitant que nous n'aurions pas lu.
    expect(corps.attribution).toMatch(/libre-service/i);
    expect(corps.fetchedAt).toEqual(expect.any(String));
  });

  it('refuse une limite qui viderait le flux entier', () => {
    return request(app.getHttpServer())
      .get('/api/velib/stations?limit=100000')
      .expect(400);
  });

  it('refuse un paramètre inconnu', () => {
    return request(app.getHttpServer())
      .get('/api/velib/stations?userId=quelquun')
      .expect(400);
  });

  // ---------------------------------------------------------------------------
  // Voisinage
  // ---------------------------------------------------------------------------

  it('rend les stations proches, avec leur distance', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/velib/nearby?lat=48.865983&lon=2.275725&radiusM=500')
      .expect(200);

    const corps = response.body as {
      stations: { distanceM: number; name: string }[];
    };

    expect(corps.stations[0].distanceM).toBe(0);
    expect(corps.stations[0].name).toBe(STATION.name);
  });

  it('exige les DEUX coordonnées', async () => {
    await request(app.getHttpServer())
      .get('/api/velib/nearby?lat=48.86')
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/velib/nearby?lon=2.27')
      .expect(400);
  });

  it('refuse des coordonnées hors bornes', () => {
    return request(app.getHttpServer())
      .get('/api/velib/nearby?lat=91&lon=2.27')
      .expect(400);
  });

  it('refuse un rayon plus large que le voisinage', () => {
    return request(app.getHttpServer())
      .get('/api/velib/nearby?lat=48.86&lon=2.27&radiusM=999999')
      .expect(400);
  });

  it('rend une liste VIDE, et non une erreur, loin de tout', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/velib/nearby?lat=-60&lon=-140&radiusM=1000')
      .expect(200);

    // « Aucune station à proximité » est une réponse, pas une panne.
    expect(response.body).toMatchObject({ total: 0, stations: [] });
  });

  // ---------------------------------------------------------------------------
  // Station unique
  // ---------------------------------------------------------------------------

  it('rend une station par son identifiant GBFS', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/velib/stations/213688169')
      .expect(200);

    const corps = response.body as { name: string; freshness: string };

    expect(corps.name).toBe(STATION.name);
    // Un horodatage adosse la mesure : le mot « temps réel » est mérité.
    expect(corps.freshness).toBe('REALTIME');
  });

  it('répond 404 pour un identifiant inconnu, sans exiger un UUID', () => {
    // ⚠️ L'identifiant est celui du FOURNISSEUR, un entier GBFS. Un
    // `ParseUUIDPipe` rejetterait toutes les stations réelles en 400.
    return request(app.getHttpServer())
      .get('/api/velib/stations/999999999')
      .expect(404);
  });

  // ---------------------------------------------------------------------------
  // Panne du fournisseur
  // ---------------------------------------------------------------------------

  it('continue de servir le cache pendant une panne passagère', async () => {
    // Une première lecture réussie remplit le cache.
    await request(app.getHttpServer()).get('/api/velib/stations').expect(200);

    appelFetch.mockReset();
    appelFetch.mockRejectedValue(new Error('réseau coupé'));

    // ⚠️ PROPRIÉTÉ VOULUE, pas un oubli : tant que le cache est valide, une
    // coupure passagère du fournisseur reste invisible pour l'usager. Et il
    // n'est pas trompé pour autant — `fetchedAt` date la lecture, donc l'âge
    // de la donnée est lisible à l'écran.
    const response = await request(app.getHttpServer())
      .get('/api/velib/stations')
      .expect(200);

    expect((response.body as { total: number }).total).toBeGreaterThan(0);
  });
});

// =============================================================================
// Panne du fournisseur, CACHE FROID
// =============================================================================
// ⚠️ UNE APPLICATION NEUVE, et c'est indispensable. `VelibService` est un
// singleton : les tests précédents ont rempli son cache, et une panne y
// resterait invisible. Ce bloc éprouve le cas où rien n'a encore été lu — le
// seul où l'usager doit voir une erreur.
// =============================================================================
describe('Vélib’ — panne à froid (e2e)', () => {
  let app: INestApplication<App>;
  let appelFetch: jest.SpyInstance;

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
  });

  beforeEach(() => {
    appelFetch = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    appelFetch.mockRestore();
  });

  afterAll(async () => {
    await app.close();
  });

  it('traduit une panne du flux en 503, sans divulguer l’adresse', async () => {
    appelFetch.mockRejectedValue(
      new Error('connect ECONNREFUSED 51.15.2.3:443'),
    );

    const response = await request(app.getHttpServer())
      .get('/api/velib/stations')
      .expect(503);

    const corps = response.body as { message: string };

    expect(corps.message).toMatch(/indisponibles/i);
    // Ni la cause technique, ni l'adresse du fournisseur.
    expect(corps.message).not.toContain('ECONNREFUSED');
    expect(corps.message).not.toContain('smovengo');
  });

  it('traduit un flux illisible en 503', async () => {
    appelFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error('Unexpected token')),
    });

    await request(app.getHttpServer()).get('/api/velib/stations').expect(503);
  });
});
