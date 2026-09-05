// Charge projet/backend/.env (DATABASE_URL, JWT_SECRET, CARBON_SERVICE_URL...).
// Indispensable ici : en test end-to-end on importe AppModule directement,
// donc main.ts — qui fait normalement ce chargement — n'est jamais exécuté.
import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

// =============================================================================
// POST /api/routes/search — mode de déplacement (WALK / BIKE) (e2e)
// =============================================================================
// Ce que ce fichier prouve, de bout en bout et à travers le vrai pipeline HTTP
// (ValidationPipe + préfixe /api + contrôleur + service) :
//
//   - `mode: 'WALK'`  → UN SEUL itinéraire, entièrement à pied, AUCUN segment
//                       de transport en commun ;
//   - `mode: 'BIKE'`  → UN SEUL itinéraire, un segment `BIKE`, AUCUN segment
//                       BUS / TRAM / TRAIN / METRO / WALK, aucune marche
//                       d'approche ;
//   - dans les deux cas, le CO₂ vaut 0 g et l'éco-score 100 ;
//   - un `mode` inconnu est rejeté en 400.
//
// ═══ CE QUI EST SIMULÉ, ET POURQUOI ═══
//
//   1. Le microservice carbone (`fetch`) — comme `carbon.e2e-spec.ts` :
//      `npm run test:e2e` ne doit pas exiger qu'un service Python tourne à
//      côté. On lui fait rendre une empreinte NULLE, ce qui est justement la
//      vraie réponse pour un trajet à pied ou à vélo.
//   2. Le routage rue par rue est DÉSACTIVÉ (variables d'environnement
//      retirées le temps du test) : le segment reste alors une estimation à
//      vol d'oiseau, `geometrySource: 'STRAIGHT'`, `geometry: null` — jamais
//      présentée comme un vrai tracé. C'est le cas qu'il faut garantir.
// =============================================================================

/// Réponse FastAPI d'un trajet à émission nulle : 0 g, éco-score 100.
const CARBONE_ZERO = {
  total_distance_m: 4000,
  total_co2_g: 0,
  car_co2_g: 760,
  saved_g: 760,
  eco_score: 100,
  breakdown: [{ mode: 'BIKE', distance_m: 4000, co2_g: 0 }],
};

/// Réponse de `GET /factors` — forme minimale acceptée par `CarbonService`.
const FACTEURS = {
  factors: { WALK: 0, BIKE: 0, BUS: 113, TRAM: 4, TRAIN: 4, METRO: 4 },
  car_factor_g_per_km: 192,
};

// Strasbourg : Place Kléber → Parlement européen (~4 km).
const DEPART = { fromLat: 48.5834, fromLon: 7.7452 };
const ARRIVEE = { toLat: 48.5977, toLon: 7.7674 };

const MODES_MOTORISES = ['BUS', 'TRAM', 'TRAIN', 'METRO'];

describe('POST /api/routes/search — mode WALK / BIKE (e2e)', () => {
  let app: INestApplication<App>;
  const envInitial: Record<string, string | undefined> = {};

  beforeAll(async () => {
    // ⚠️ ROUTAGE RUE PAR RUE DÉSACTIVÉ POUR CE FICHIER. Sans cela, `.env`
    // pointe Valhalla et le test ferait un vrai appel réseau — lent, et
    // dépendant d'un tiers. On veut précisément éprouver le repli.
    for (const cle of [
      'WALK_ROUTING_PROVIDER',
      'WALK_ROUTING_BASE_URL',
      'BIKE_ROUTING_PROVIDER',
      'BIKE_ROUTING_BASE_URL',
    ]) {
      envInitial[cle] = process.env[cle];
      delete process.env[cle];
    }

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    // logger: false — un `fetch` simulé et un routeur absent produisent des
    // avertissements attendus qu'il ne faut pas confondre avec un échec.
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

  afterAll(async () => {
    for (const [cle, valeur] of Object.entries(envInitial)) {
      if (valeur === undefined) {
        delete process.env[cle];
      } else {
        process.env[cle] = valeur;
      }
    }
    await app.close();
  });

  beforeEach(() => {
    // `CarbonService` n'appelle `fetch` qu'avec une URL en chaîne
    // (`${base}/factors`, `${base}/calculate`) : c'est le seul cas à traiter.
    const cible = (entree: unknown): string =>
      typeof entree === 'string'
        ? entree
        : entree instanceof URL
          ? entree.href
          : '';

    jest.spyOn(global, 'fetch').mockImplementation((entree: unknown) => {
      const corps = cible(entree).endsWith('/factors')
        ? FACTEURS
        : CARBONE_ZERO;

      return Promise.resolve(
        new Response(JSON.stringify(corps), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // mode: WALK
  // ---------------------------------------------------------------------------
  describe("mode: 'WALK'", () => {
    it('rend UN SEUL itinéraire, entièrement à pied, sans transport en commun', async () => {
      const reponse = await request(app.getHttpServer())
        .post('/api/routes/search')
        .send({ ...DEPART, ...ARRIVEE, mode: 'WALK' })
        .expect(200);

      const itineraires = reponse.body as {
        segments: { mode: string }[];
        walkAccess: { source: string } | null;
        walkEgress: unknown;
        carbon: { co2Grams: number | null; ecoScore: number | null };
      }[];

      expect(itineraires).toHaveLength(1);

      const [trajet] = itineraires;
      // Un trajet à pied n'a AUCUN segment de réseau — il est porté par
      // `walkAccess`.
      expect(trajet.segments).toEqual([]);
      expect(trajet.walkAccess).toMatchObject({ source: 'ESTIMATE' });
      expect(trajet.walkEgress).toBeNull();
    });

    it('annonce 0 g de CO₂ et un éco-score de 100', async () => {
      const reponse = await request(app.getHttpServer())
        .post('/api/routes/search')
        .send({ ...DEPART, ...ARRIVEE, mode: 'WALK' })
        .expect(200);

      const [trajet] = reponse.body as {
        carbon: {
          status: string;
          co2Grams: number | null;
          ecoScore: number | null;
        };
      }[];

      expect(trajet.carbon.co2Grams).toBe(0);
      expect(trajet.carbon.ecoScore).toBe(100);
    });
  });

  // ---------------------------------------------------------------------------
  // mode: BIKE
  // ---------------------------------------------------------------------------
  describe("mode: 'BIKE'", () => {
    it('rend UN SEUL segment de mode BIKE, sans marche d’approche', async () => {
      const reponse = await request(app.getHttpServer())
        .post('/api/routes/search')
        .send({ ...DEPART, ...ARRIVEE, mode: 'BIKE' })
        .expect(200);

      const itineraires = reponse.body as {
        segments: { mode: string }[];
        walkAccess: unknown;
        walkEgress: unknown;
      }[];

      expect(itineraires).toHaveLength(1);
      const [trajet] = itineraires;

      expect(trajet.segments).toHaveLength(1);
      expect(trajet.segments[0].mode).toBe('BIKE');
      // Le vélo va d'un bout à l'autre : aucune marche n'est ajoutée.
      expect(trajet.walkAccess).toBeNull();
      expect(trajet.walkEgress).toBeNull();
    });

    it('ne contient AUCUN segment BUS / TRAM / TRAIN / METRO / WALK', async () => {
      const reponse = await request(app.getHttpServer())
        .post('/api/routes/search')
        .send({ ...DEPART, ...ARRIVEE, mode: 'BIKE' })
        .expect(200);

      const [trajet] = reponse.body as { segments: { mode: string }[] }[];

      for (const segment of trajet.segments) {
        expect(MODES_MOTORISES).not.toContain(segment.mode);
        expect(segment.mode).not.toBe('WALK');
      }
    });

    it('sans routeur cyclable, le segment reste une estimation — jamais un faux tracé', async () => {
      const reponse = await request(app.getHttpServer())
        .post('/api/routes/search')
        .send({ ...DEPART, ...ARRIVEE, mode: 'BIKE' })
        .expect(200);

      const [trajet] = reponse.body as {
        segments: { geometrySource: string; geometry: unknown }[];
      }[];

      expect(trajet.segments[0].geometrySource).toBe('STRAIGHT');
      expect(trajet.segments[0].geometry).toBeNull();
    });

    it('annonce 0 g de CO₂ et un éco-score de 100', async () => {
      const reponse = await request(app.getHttpServer())
        .post('/api/routes/search')
        .send({ ...DEPART, ...ARRIVEE, mode: 'BIKE' })
        .expect(200);

      const [trajet] = reponse.body as {
        carbon: { co2Grams: number | null; ecoScore: number | null };
      }[];

      expect(trajet.carbon.co2Grams).toBe(0);
      expect(trajet.carbon.ecoScore).toBe(100);
    });

    it('NE LÈVE JAMAIS : un trajet vélo est rendu même si tout `fetch` échoue', async () => {
      // Routeur ET microservice carbone injoignables en même temps.
      jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

      const reponse = await request(app.getHttpServer())
        .post('/api/routes/search')
        .send({ ...DEPART, ...ARRIVEE, mode: 'BIKE' })
        .expect(200);

      const [trajet] = reponse.body as {
        segments: { mode: string; geometrySource: string }[];
        carbon: { status: string };
      }[];

      // Un itinéraire vélo, estimé, avec une empreinte « indisponible » —
      // jamais un 500, jamais un CO₂ inventé.
      expect(trajet.segments[0].mode).toBe('BIKE');
      expect(trajet.segments[0].geometrySource).toBe('STRAIGHT');
      expect(trajet.carbon.status).toBe('CARBON_UNAVAILABLE');
    });
  });

  // ---------------------------------------------------------------------------
  // mode: BIKE — Valhalla RÉPOND : le tracé suit la voirie
  // ---------------------------------------------------------------------------
  describe("mode: 'BIKE' — routeur cyclable actif, Valhalla répond", () => {
    // Réponse RÉELLE de `valhalla1.openstreetmap.de` (profil bicycle), tronquée :
    // `shape` est une polyligne encodée en PRÉCISION 6, `summary` porte la
    // longueur (km) et la durée (s). C'est exactement la forme que
    // `valhalla.client.ts` sait lire. Décodée en précision 6 → 18 points
    // autour de Strasbourg ; en précision 5 → en mer du Nord.
    const VALHALLA_BICYCLE = {
      trip: {
        status: 0,
        legs: [
          {
            shape:
              'omht{A_jvwM~DcImIeuA}AsGoK{`@sBmNKkAMwBc@i@gHeXwAeG{AeGi@_C}HuXqBqDaByCq@mBc@oA',
            summary: { length: 2.89, time: 625.8 },
          },
        ],
      },
    };

    const envInitial: Record<string, string | undefined> = {};

    beforeAll(() => {
      for (const [cle, valeur] of Object.entries({
        BIKE_ROUTING_PROVIDER: 'valhalla',
        BIKE_ROUTING_BASE_URL: 'https://valhalla.test',
      })) {
        envInitial[cle] = process.env[cle];
        process.env[cle] = valeur;
      }
    });

    afterAll(() => {
      for (const [cle, valeur] of Object.entries(envInitial)) {
        if (valeur === undefined) delete process.env[cle];
        else process.env[cle] = valeur;
      }
    });

    beforeEach(() => {
      // ⚠️ REMET LE DISJONCTEUR À ZÉRO. Les tests « BIKE » précédents ont pu
      // l'ouvrir (le service est un singleton partagé) : on avance l'horloge
      // au-delà de la fenêtre d'ouverture, comme `bike-routing.service.spec.ts`.
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 120_000);

      jest.spyOn(global, 'fetch').mockImplementation((entree: unknown) => {
        const url = typeof entree === 'string' ? entree : String(entree);
        const corps = url.endsWith('/route')
          ? VALHALLA_BICYCLE
          : url.endsWith('/factors')
            ? FACTEURS
            : CARBONE_ZERO;
        return Promise.resolve(
          new Response(JSON.stringify(corps), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      });
    });

    it('rend `geometrySource: ROUTED` et la polyligne de voirie décodée', async () => {
      const reponse = await request(app.getHttpServer())
        .post('/api/routes/search')
        .send({ ...DEPART, ...ARRIVEE, mode: 'BIKE' })
        .expect(200);

      const [trajet] = reponse.body as {
        totalDistanceM: number;
        segments: {
          mode: string;
          geometrySource: string;
          geometry: { type: string; coordinates: [number, number][] } | null;
        }[];
      }[];

      const segment = trajet.segments[0];
      expect(segment.mode).toBe('BIKE');
      // ⚠️ LE POINT CENTRAL : un vrai tracé, pas la ligne droite.
      expect(segment.geometrySource).toBe('ROUTED');
      expect(segment.geometry?.type).toBe('LineString');
      expect(segment.geometry!.coordinates.length).toBeGreaterThan(3);

      // Précision 6 → autour de Strasbourg (lon ~7.74, lat ~48.58).
      const [lon, lat] = segment.geometry!.coordinates[0];
      expect(lon).toBeGreaterThan(7);
      expect(lon).toBeLessThan(8);
      expect(lat).toBeGreaterThan(48);
      expect(lat).toBeLessThan(49);

      // La distance suit le moteur (2,89 km), pas le vol d'oiseau.
      expect(trajet.totalDistanceM).toBe(2890);
    });
  });

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------
  it('rejette un `mode` inconnu en 400', async () => {
    await request(app.getHttpServer())
      .post('/api/routes/search')
      .send({ ...DEPART, ...ARRIVEE, mode: 'CAR' })
      .expect(400);
  });

  it("sans `mode`, la recherche multimodale habituelle s'applique (pas de 400)", async () => {
    // `mode` est FACULTATIF : son absence vaut `TRANSIT`. On ne vérifie ici
    // que l'absence de 400 — le contenu multimodal est couvert ailleurs.
    await request(app.getHttpServer())
      .post('/api/routes/search')
      .send({ ...DEPART, ...ARRIVEE })
      .expect(200);
  });
});
