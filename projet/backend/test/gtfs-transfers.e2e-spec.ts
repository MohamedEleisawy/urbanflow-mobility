// Charge projet/backend/.env (DATABASE_URL...).
import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import {
  GtfsImportService,
  LIGNE_CORRESPONDANCE_ID,
} from './../src/gtfs/gtfs-import.service';
import { ModeTransport } from '@prisma/client';

// Correspondances GTFS (Phase 1).
//
// PostgreSQL est RÉEL : la contrainte d'unicité qui porte l'idempotence est
// exécutée par la base, et c'est précisément elle qu'on veut éprouver.
//
// ═══ POURQUOI CE FICHIER EXISTE ═══
//
// Île-de-France Mobilités publie UN ARRÊT PAR QUAI. Sans correspondances, le
// graphe est une collection de chemins isolés : une recherche Bastille →
// Châtelet rendait ZÉRO proposition alors que les deux arrêts sont sur la
// ligne 1. Le jeu d'essai reproduit cette forme en miniature — deux lignes,
// deux quais voisins, une correspondance entre eux.
describe('Correspondances GTFS (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let importService: GtfsImportService;

  const FIXTURE = 'test/fixtures/gtfs-transfers';

  /// Les arrêts du jeu d'essai, tous préfixés pour un nettoyage sûr.
  const IDS = ['TA0', 'TAC', 'TBC', 'TB2', 'TX'];

  const nettoyer = async () => {
    await prisma.networkLink.deleteMany({
      where: { fromStop: { gtfsStopId: { in: IDS } } },
    });
    await prisma.networkLink.deleteMany({
      where: { toStop: { gtfsStopId: { in: IDS } } },
    });
    await prisma.stop.deleteMany({ where: { gtfsStopId: { in: IDS } } });
    await prisma.transitLine.deleteMany({
      where: { gtfsRouteId: { in: ['RA', 'RB'] } },
    });
  };

  const correspondances = () =>
    prisma.networkLink.findMany({
      where: { line: { gtfsRouteId: LIGNE_CORRESPONDANCE_ID } },
      include: { fromStop: true, toStop: true },
    });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ logger: false });
    await app.init();

    prisma = app.get(PrismaService);
    importService = app.get(GtfsImportService);
  });

  beforeEach(nettoyer);

  afterAll(async () => {
    await nettoyer();
    await app.close();
  });

  // ===========================================================================
  // Import
  // ===========================================================================
  describe('import', () => {
    it('crée les correspondances des DEUX sens', async () => {
      await importService.importReferential(
        FIXTURE,
        'E2E',
        new Set([ModeTransport.METRO]),
      );

      const liens = await correspondances();
      const notres = liens.filter((l) =>
        IDS.includes(l.fromStop.gtfsStopId ?? ''),
      );

      // GTFS déclare chaque sens séparément : TAC→TBC et TBC→TAC.
      expect(notres).toHaveLength(2);
      expect(
        notres
          .map((l) => `${l.fromStop.gtfsStopId}->${l.toStop.gtfsStopId}`)
          .sort(),
      ).toEqual(['TAC->TBC', 'TBC->TAC']);
    });

    it('les rattache à une ligne de MARCHE, jamais à une ligne de métro', async () => {
      await importService.importReferential(
        FIXTURE,
        'E2E',
        new Set([ModeTransport.METRO]),
      );

      const ligne = await prisma.transitLine.findUniqueOrThrow({
        where: { gtfsRouteId: LIGNE_CORRESPONDANCE_ID },
      });

      // ⚠️ Une correspondance n'est PAS un trajet en métro. Son mode décide de
      // ce que l'interface affiche (« Marche ») et de ce que le calcul carbone
      // lui applique (0 g/km) — deux choses qui seraient fausses avec METRO.
      expect(ligne.mode).toBe(ModeTransport.WALK);
      expect(ligne.name).toBe('Correspondance');
    });

    it('CONSERVE la durée publiée par l’opérateur', async () => {
      await importService.importReferential(
        FIXTURE,
        'E2E',
        new Set([ModeTransport.METRO]),
      );

      const [lien] = (await correspondances()).filter(
        (l) => l.fromStop.gtfsStopId === 'TAC',
      );

      // 240 s dans `transfers.txt` → 4 min. Aucune estimation : la durée est
      // celle que l'opérateur publie.
      expect(lien.durationMin).toBe(4);
    });

    it('ne pose AUCUNE géométrie sur une correspondance', async () => {
      await importService.importReferential(
        FIXTURE,
        'E2E',
        new Set([ModeTransport.METRO]),
      );

      const [lien] = await correspondances();

      // `shapes.txt` décrit des parcours de VÉHICULES. Tracer une ligne droite
      // entre deux quais serait un tracé faux.
      expect(lien.geometry).toBeNull();
    });
  });

  // ===========================================================================
  // Ce qui est ÉCARTÉ
  // ===========================================================================
  describe('lignes écartées', () => {
    beforeEach(async () => {
      await importService.importReferential(
        FIXTURE,
        'E2E',
        new Set([ModeTransport.METRO]),
      );
    });

    it('REFUSE une correspondance d’un arrêt vers lui-même', async () => {
      const liens = await correspondances();

      // `TAC,TAC` figure dans le jeu d'essai : elle produirait une boucle de
      // coût nul dans le graphe.
      expect(
        liens.filter((l) => l.fromStop.gtfsStopId === l.toStop.gtfsStopId),
      ).toHaveLength(0);
    });

    it('REFUSE le transfer_type 3', async () => {
      const liens = await correspondances();

      // Type 3 = « correspondance IMPOSSIBLE ». L'importer créerait un chemin
      // que l'opérateur déclare inexistant.
      expect(liens.filter((l) => l.fromStop.gtfsStopId === 'TA0')).toHaveLength(
        0,
      );
    });

    it('REFUSE une correspondance vers un arrêt hors périmètre', async () => {
      const liens = await correspondances();

      // `TAC,INCONNU` : l'arrêt d'arrivée n'existe pas en base. C'est le cas
      // massif du flux réel — 188 751 correspondances sur 191 816 relient des
      // arrêts de bus ou de RER, hors du périmètre métro/tram.
      expect(liens.map((l) => l.toStop.gtfsStopId)).not.toContain('INCONNU');
    });
  });

  // ===========================================================================
  // Idempotence
  // ===========================================================================
  describe('idempotence', () => {
    it('deux imports ne créent PAS de doublon', async () => {
      await importService.importReferential(
        FIXTURE,
        'E2E',
        new Set([ModeTransport.METRO]),
      );
      const premier = (await correspondances()).length;

      await importService.importReferential(
        FIXTURE,
        'E2E',
        new Set([ModeTransport.METRO]),
      );
      const second = (await correspondances()).length;

      // L'idempotence vient de `@@unique([lineId, fromStopId, toStopId])` :
      // elle est portée par la BASE, pas par une vérification applicative.
      expect(second).toBe(premier);
    });

    it('ne crée QU’UNE ligne de correspondance, même réimportée', async () => {
      await importService.importReferential(
        FIXTURE,
        'E2E',
        new Set([ModeTransport.METRO]),
      );
      await importService.importReferential(
        FIXTURE,
        'E2E',
        new Set([ModeTransport.METRO]),
      );

      const lignes = await prisma.transitLine.findMany({
        where: { gtfsRouteId: LIGNE_CORRESPONDANCE_ID },
      });

      expect(lignes).toHaveLength(1);
    });
  });

  // ===========================================================================
  // L'objectif : le graphe devient traversable
  // ===========================================================================
  describe('connectivité', () => {
    it('RELIE deux lignes qui ne partageaient aucun arrêt', async () => {
      await importService.importReferential(
        FIXTURE,
        'E2E',
        new Set([ModeTransport.METRO]),
      );

      // Avant les correspondances, la ligne A s'arrêtait à TAC et la ligne B
      // partait de TBC : deux chemins isolés, aucun trajet possible de l'un à
      // l'autre. C'est exactement ce qui rendait 0 proposition sur le réseau
      // réel entre deux quais d'une même station.
      const quaiA = await prisma.stop.findFirstOrThrow({
        where: { gtfsStopId: 'TAC' },
      });

      const sorties = await prisma.networkLink.findMany({
        where: { fromStopId: quaiA.id },
        include: { line: true, toStop: true },
      });

      const versQuaiB = sorties.find((l) => l.toStop.gtfsStopId === 'TBC');

      expect(versQuaiB).toBeDefined();
      expect(versQuaiB?.line.mode).toBe(ModeTransport.WALK);
    });
  });
});
