// Charge projet/backend/.env : en test end-to-end, main.ts n'est jamais
// exécuté (voir routes-search.e2e-spec.ts pour l'explication détaillée).
import 'dotenv/config';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { GtfsImportService } from './../src/gtfs/gtfs-import.service';

/**
 * Test d'intégration de bout en bout : un flux GTFS est importé dans la
 * VRAIE base, puis la recherche d'itinéraire est appelée par HTTP. Il
 * vérifie donc que la chaîne complète fonctionne :
 *
 *   fichiers GTFS → Stop + TransitLine → NetworkLink → graphe → Dijkstra
 *
 * ISOLATION. Les arrêts de ce flux sont volontairement placés très loin
 * (latitude -33, longitude 18) du réseau de démonstration parisien et des
 * arrêts de l'autre test end-to-end (situés vers 0,0). Aucune recherche ne
 * peut donc confondre les deux jeux de données, et ce test ne supprime
 * jamais que ses propres enregistrements — le réseau seed reste intact.
 */
describe('Import GTFS puis recherche (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const FIXTURES = join(__dirname, 'fixtures', 'gtfs-network');
  const STOPS_GTFS = ['N1', 'N2', 'N3'];
  const ROUTES_GTFS = ['NR1'];

  // Le départ et l'arrivée coïncident avec les arrêts extrêmes du flux.
  const RECHERCHE = {
    fromLat: -33.0,
    fromLon: 18.0,
    toLat: -33.02,
    toLon: 18.0,
  };

  const nettoyer = async () => {
    // Ordre imposé par les clés étrangères : liaisons, puis lignes et arrêts.
    const lignes = await prisma.transitLine.findMany({
      where: { gtfsRouteId: { in: ROUTES_GTFS } },
      select: { id: true },
    });
    await prisma.networkLink.deleteMany({
      where: { lineId: { in: lignes.map((l) => l.id) } },
    });
    await prisma.transitLine.deleteMany({
      where: { gtfsRouteId: { in: ROUTES_GTFS } },
    });
    await prisma.stop.deleteMany({
      where: { gtfsStopId: { in: STOPS_GTFS } },
    });
  };

  beforeAll(async () => {
    // Le bilan d'import est journalisé : utile en exploitation, illisible
    // dans la sortie des tests.
    Logger.overrideLogger(false);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
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

    // Au cas où un test précédent aurait été interrompu.
    await nettoyer();

    await app.get(GtfsImportService).importReferential(FIXTURES, 'E2E');
  });

  afterAll(async () => {
    await nettoyer();
    await app.close();
  });

  it('crée exactement 2 liaisons pour 2 trajets sur le même parcours', async () => {
    const lignes = await prisma.transitLine.findMany({
      where: { gtfsRouteId: { in: ROUTES_GTFS } },
      select: { id: true },
    });
    const liaisons = await prisma.networkLink.count({
      where: { lineId: { in: lignes.map((l) => l.id) } },
    });

    // NT1 et NT2 parcourent tous deux N1 → N2 → N3. Sans regroupement on
    // obtiendrait 4 liaisons ; avec regroupement, 2.
    expect(liaisons).toBe(2);
  });

  it('retient la médiane des durées observées', async () => {
    const liaisons = await prisma.networkLink.findMany({
      where: { fromStop: { gtfsStopId: 'N1' } },
      select: { durationMin: true },
    });

    // N1 → N2 : 5 min pour NT1, 7 min pour NT2 → médiane 6.
    expect(liaisons[0].durationMin).toBe(6);
  });

  it('calcule une distance à vol d’oiseau cohérente', async () => {
    const liaison = await prisma.networkLink.findFirst({
      where: { fromStop: { gtfsStopId: 'N1' } },
      select: { distanceM: true },
    });

    // 0,01° de latitude ≈ 1,11 km.
    expect(liaison?.distanceM).toBeGreaterThan(1000);
    expect(liaison?.distanceM).toBeLessThan(1200);
  });

  it('trouve un itinéraire circulant sur le réseau issu de GTFS', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/routes/search')
      .send(RECHERCHE)
      .expect(200);

    const itineraires = response.body as {
      criterion: string;
      totalDurationMin: number;
      segments: { fromStopName: string; toStopName: string; mode: string }[];
    }[];

    expect(itineraires.length).toBeGreaterThan(0);

    const itineraire = itineraires[0];
    // Le trajet emprunte bien les deux tronçons construits depuis GTFS.
    expect(itineraire.segments.map((s) => s.fromStopName)).toEqual([
      'Reseau Nord',
      'Reseau Centre',
    ]);
    expect(itineraire.segments[1].toStopName).toBe('Reseau Sud');
    // 6 min (médiane N1→N2) + 8 min (médiane N2→N3).
    expect(itineraire.totalDurationMin).toBe(14);
    // Le mode vient de la ligne GTFS (route_type 3 = bus).
    expect(itineraire.segments[0].mode).toBe('BUS');
  });

  it('ne crée aucun doublon lors d’un second import', async () => {
    const compter = async () => {
      const lignes = await prisma.transitLine.findMany({
        where: { gtfsRouteId: { in: ROUTES_GTFS } },
        select: { id: true },
      });
      return {
        arrets: await prisma.stop.count({
          where: { gtfsStopId: { in: STOPS_GTFS } },
        }),
        lignes: lignes.length,
        liaisons: await prisma.networkLink.count({
          where: { lineId: { in: lignes.map((l) => l.id) } },
        }),
      };
    };

    const avant = await compter();
    await app.get(GtfsImportService).importReferential(FIXTURES, 'E2E');
    const apres = await compter();

    expect(apres).toEqual(avant);
    expect(apres).toEqual({ arrets: 3, lignes: 1, liaisons: 2 });
  });

  it('laisse intactes les données personnelles', async () => {
    // On crée NOS PROPRES données personnelles et on vérifie qu'un import
    // ne les touche pas. Compter les usagers en valeur absolue serait
    // fragile : les fichiers de tests end-to-end s'exécutent en parallèle
    // et l'autre suite crée elle aussi un usager.
    const usager = await prisma.user.create({
      data: {
        email: `gtfs-e2e-${Date.now()}@example.com`,
        passwordHash: 'hash-factice-non-utilise',
      },
    });
    const itineraire = await prisma.route.create({
      data: {
        userId: usager.id,
        originLat: -33.0,
        originLng: 18.0,
        destinationLat: -33.02,
        destinationLng: 18.0,
        totalDurationMin: 14,
        totalDistanceM: 2226,
        ecoScore: 90,
        carbonEstimate: 0,
      },
    });

    await app.get(GtfsImportService).importReferential(FIXTURES, 'E2E');

    const usagerApres = await prisma.user.findUnique({
      where: { id: usager.id },
    });
    const itineraireApres = await prisma.route.findUnique({
      where: { id: itineraire.id },
    });

    expect(usagerApres?.email).toBe(usager.email);
    expect(itineraireApres?.totalDurationMin).toBe(14);

    await prisma.route.delete({ where: { id: itineraire.id } });
    await prisma.user.delete({ where: { id: usager.id } });
  });

  // ---------------------------------------------------------------------------
  // Étape 4C-4-5 : les trois sources
  // ---------------------------------------------------------------------------
  describe('sources : dossier, ZIP et URL', () => {
    const ZIP = join(__dirname, 'fixtures', 'gtfs-network.zip');

    /// Photographie du réseau importé, SANS les identifiants internes :
    /// ceux-ci sont régénérés à chaque import et ne peuvent pas être
    /// comparés d'une source à l'autre.
    const etatDuReseau = async () => {
      const liaisons = await prisma.networkLink.findMany({
        where: { line: { gtfsRouteId: { in: ROUTES_GTFS } } },
        select: {
          durationMin: true,
          distanceM: true,
          fromStop: { select: { gtfsStopId: true, name: true } },
          toStop: { select: { gtfsStopId: true, name: true } },
          line: { select: { gtfsRouteId: true, name: true, mode: true } },
        },
      });

      return liaisons
        .map((l) => ({
          de: l.fromStop.gtfsStopId,
          vers: l.toStop.gtfsStopId,
          ligne: l.line.gtfsRouteId,
          mode: l.line.mode,
          durationMin: l.durationMin,
          distanceM: l.distanceM,
        }))
        .sort((a, b) => `${a.de}${a.vers}`.localeCompare(`${b.de}${b.vers}`));
    };

    const importer = (source: string) =>
      app.get(GtfsImportService).importFromSource(source, 'E2E');

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('les trois sources produisent EXACTEMENT le même réseau en base', async () => {
      // --- Source 1 : dossier ---
      await nettoyer();
      await importer(FIXTURES);
      const parDossier = await etatDuReseau();

      // --- Source 2 : archive ZIP locale ---
      await nettoyer();
      await importer(ZIP);
      const parZip = await etatDuReseau();

      // --- Source 3 : archive distante (téléchargement simulé) ---
      await nettoyer();
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(
          new Response(
            Readable.toWeb(createReadStream(ZIP)) as ReadableStream<Uint8Array>,
            { status: 200 },
          ),
        );
      await importer('https://exemple.fr/reseau.zip');
      const parUrl = await etatDuReseau();

      // Le pipeline métier est le même dans les trois cas : seule la façon
      // d'obtenir les fichiers change.
      expect(parDossier).toHaveLength(2);
      expect(parZip).toEqual(parDossier);
      expect(parUrl).toEqual(parDossier);
    });

    it('reste idempotent quelle que soit la source', async () => {
      await nettoyer();
      await importer(FIXTURES);
      const apresDossier = await etatDuReseau();

      // Réimporter la même donnée par une AUTRE source ne doit rien
      // dupliquer : la clé de rapprochement est l'identifiant GTFS, pas la
      // provenance du fichier.
      await importer(ZIP);
      const apresZip = await etatDuReseau();

      expect(apresZip).toEqual(apresDossier);
      expect(apresZip).toHaveLength(2);
    });

    it('laisse le réseau exploitable par la recherche après un import ZIP', async () => {
      await nettoyer();
      await importer(ZIP);

      const response = await request(app.getHttpServer())
        .post('/api/routes/search')
        .send(RECHERCHE)
        .expect(200);

      const itineraires = response.body as { totalDurationMin: number }[];
      expect(itineraires[0].totalDurationMin).toBe(14);
    });

    it('remonte une erreur claire pour une archive corrompue', async () => {
      await expect(
        importer(join(__dirname, 'fixtures', 'gtfs-corrompu.zip')),
      ).rejects.toThrow(/Archive GTFS illisible/);
    });

    it('remonte une erreur claire pour une URL en échec', async () => {
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response(null, { status: 500 }));

      await expect(importer('https://exemple.fr/panne.zip')).rejects.toThrow(
        /HTTP 500/,
      );
    });
  });
});
