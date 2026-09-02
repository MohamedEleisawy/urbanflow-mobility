// Charge projet/backend/.env (DATABASE_URL, JWT_SECRET...).
import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

// =============================================================================
// GET /api/stops — contrat HTTP (Phase 4)
// =============================================================================
// ⚠️ CE QUE CES TESTS PROTÈGENT VRAIMENT
//
// L'endpoint renvoyait AUTREFOIS la table entière. C'est ce qui rendait
// l'import du bus impossible : 1 934 arrêts aujourd'hui, plus de 35 000 avec
// le bus, à chaque chargement de la page de recherche.
//
// La première assertion de ce fichier est donc la plus importante : une
// requête sans paramètre ne doit PAS rendre un tableau. Si quelqu'un
// rétablissait un jour `findMany()` sans borne, c'est ici que ça se verrait.
// =============================================================================

describe('GET /api/stops (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  /// Arrêts créés par ce fichier, supprimés à la fin. Le préfixe rend
  /// impossible toute collision avec les données de développement.
  const PREFIXE = `E2E-STOPS-${Date.now()}`;
  const stopIds: string[] = [];

  /// Un coin de l'océan Atlantique : aucun arrêt réel ne s'y trouve, donc le
  /// voisinage testé ne peut contenir que NOS arrêts.
  const LAT = 10;
  const LON = -30;

  const creer = async (suffixe: string, dLat: number, dLon: number) => {
    const stop = await prisma.stop.create({
      data: {
        name: `${PREFIXE} ${suffixe}`,
        latitude: LAT + dLat,
        longitude: LON + dLon,
        operatorCode: 'E2E',
      },
    });
    stopIds.push(stop.id);
    return stop;
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

    // 0,001° de latitude ≈ 111 m. Les trois arrêts sont donc à environ
    // 0 m, 111 m et 555 m du point de référence.
    await creer('Alpha', 0, 0);
    await creer('Beta', 0.001, 0);
    await creer('Gamma', 0.005, 0);
  });

  afterAll(async () => {
    if (stopIds.length > 0) {
      await prisma.stop.deleteMany({ where: { id: { in: stopIds } } });
    }
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // La borne elle-même
  // ---------------------------------------------------------------------------

  it('ne renvoie JAMAIS un tableau nu, même sans aucun paramètre', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/stops')
      .expect(200);

    // Un tableau signifierait que la table entière est de nouveau rendue.
    expect(Array.isArray(response.body)).toBe(false);

    const corps = response.body as Record<string, unknown>;

    expect(corps.page).toBe(1);
    expect(typeof corps.limit).toBe('number');
    expect(typeof corps.total).toBe('number');
    expect(Array.isArray(corps.items)).toBe(true);
  });

  it('reste PUBLIC : aucune authentification requise', () => {
    return request(app.getHttpServer()).get('/api/stops').expect(200);
  });

  it('refuse une limite qui contournerait la pagination', () => {
    // Sans plafond, `?limit=100000` rétablirait la requête non bornée.
    return request(app.getHttpServer())
      .get('/api/stops?limit=100000')
      .expect(400);
  });

  it('refuse une page nulle ou négative', async () => {
    await request(app.getHttpServer()).get('/api/stops?page=0').expect(400);
    await request(app.getHttpServer()).get('/api/stops?page=-1').expect(400);
  });

  it('refuse un paramètre inconnu', () => {
    // `forbidNonWhitelisted` s'applique aussi aux paramètres d'URL : c'est ce
    // qui empêche un `?userId=` d'être glissé dans une requête publique.
    return request(app.getHttpServer())
      .get('/api/stops?userId=quelquun')
      .expect(400);
  });

  it('respecte la limite demandée', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/stops?limit=2')
      .expect(200);

    expect((response.body as { items: unknown[] }).items).toHaveLength(2);
  });

  // ---------------------------------------------------------------------------
  // Recherche par nom
  // ---------------------------------------------------------------------------

  it('filtre par nom', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/stops?query=${encodeURIComponent(PREFIXE)}`)
      .expect(200);

    const corps = response.body as {
      total: number;
      items: { name: string }[];
    };

    expect(corps.total).toBe(3);
    expect(corps.items.every((s) => s.name.startsWith(PREFIXE))).toBe(true);
  });

  it('cherche sans tenir compte de la casse', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/stops?query=${encodeURIComponent(PREFIXE.toLowerCase())}`)
      .expect(200);

    expect((response.body as { total: number }).total).toBe(3);
  });

  it('refuse une recherche trop courte pour être discriminante', () => {
    // Une seule lettre ramènerait presque tout le réseau : ce serait
    // contourner la pagination par la porte de derrière.
    return request(app.getHttpServer()).get('/api/stops?query=a').expect(400);
  });

  it('ne traite pas la saisie comme du SQL', async () => {
    // Prisma paramètre la requête : ces caractères sont des caractères.
    const response = await request(app.getHttpServer())
      .get(`/api/stops?query=${encodeURIComponent("100%';--")}`)
      .expect(200);

    expect((response.body as { total: number }).total).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Voisinage
  // ---------------------------------------------------------------------------

  it('ne rend que les arrêts réellement dans le rayon', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/stops?lat=${LAT}&lon=${LON}&radiusM=200`)
      .expect(200);

    const corps = response.body as {
      total: number;
      items: { name: string; distanceM: number }[];
    };

    // Alpha (0 m) et Beta (~111 m) ; Gamma (~555 m) est hors rayon.
    expect(corps.total).toBe(2);
    expect(corps.items.map((s) => s.name)).toEqual([
      `${PREFIXE} Alpha`,
      `${PREFIXE} Beta`,
    ]);
  });

  it('ordonne du plus proche au plus éloigné et donne la distance', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/stops?lat=${LAT}&lon=${LON}&radiusM=1000`)
      .expect(200);

    const items = (response.body as { items: { distanceM: number }[] }).items;

    expect(items[0].distanceM).toBe(0);
    expect(items.map((s) => s.distanceM)).toEqual(
      [...items.map((s) => s.distanceM)].sort((a, b) => a - b),
    );
  });

  it('exige les DEUX coordonnées, jamais une seule', async () => {
    // `?lat=` seul serait accepté sans cette règle, et le filtre spatial
    // silencieusement ignoré : l'usager croirait chercher autour de lui.
    await request(app.getHttpServer()).get('/api/stops?lat=10').expect(400);
    await request(app.getHttpServer()).get('/api/stops?lon=-30').expect(400);
  });

  it('refuse un rayon plus large que le voisinage', () => {
    return request(app.getHttpServer())
      .get('/api/stops?lat=10&lon=-30&radiusM=999999')
      .expect(400);
  });

  it('refuse des coordonnées hors bornes', () => {
    return request(app.getHttpServer())
      .get('/api/stops?lat=91&lon=-30')
      .expect(400);
  });

  it('rend une page vide, et non une erreur, loin de tout arrêt', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/stops?lat=-60&lon=-140&radiusM=1000')
      .expect(200);

    expect(response.body).toMatchObject({ total: 0, items: [] });
  });

  it('combine la recherche par nom et le voisinage', async () => {
    const response = await request(app.getHttpServer())
      .get(
        `/api/stops?lat=${LAT}&lon=${LON}&radiusM=1000&query=${encodeURIComponent(
          `${PREFIXE} Gamma`,
        )}`,
      )
      .expect(200);

    const corps = response.body as { total: number; items: { name: string }[] };

    expect(corps.total).toBe(1);
    expect(corps.items[0].name).toBe(`${PREFIXE} Gamma`);
  });
});
