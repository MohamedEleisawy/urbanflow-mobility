// Charge projet/backend/.env (DATABASE_URL...).
import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AlertSeverity, ModeTransport } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { ALERTS_LIMIT } from './../src/alerts/alerts.service';

/**
 * GET /api/alerts — lecture publique des perturbations (étape 4F-2B, UC02).
 *
 * CE QUE LE TEST UNITAIRE NE PROUVE PAS. Il double Prisma : il vérifie donc
 * les BORNES demandées, pas que PostgreSQL sélectionne réellement les bonnes
 * lignes. Trois choses ne se vérifient qu'ici :
 *
 *   1. le filtre temporel appliqué par la base — y compris `endTime IS NULL` ;
 *   2. l'accès PUBLIC, à travers le vrai routage et sans jeton ;
 *   3. la sérialisation JSON — dates en ISO 8601 UTC, `null` transmis.
 *
 * LE TEMPS. Aucun `useFakeTimers` : figer les timers perturberait Prisma et
 * le serveur HTTP. Les données sont donc datées RELATIVEMENT à l'heure
 * réelle, avec des marges d'une heure — assez larges pour qu'aucune seconde
 * d'exécution ne fasse basculer un cas.
 */
const PREFIXE = '4F2B-';
const LIGNE_CONNUE = '4F2B-ROUTE-A';
const LIGNE_INCONNUE = '4F2B-ROUTE-FANTOME';

const HEURE = 60 * 60 * 1000;

interface AlerteJson {
  id: string;
  headerText: string | null;
  descriptionText: string | null;
  stopIds: string[];
  lines: { id: string; name: string | null }[];
  mode: string;
  severity: string;
  cause: string;
  effect: string;
  startTime: string;
  endTime: string | null;
}

interface ReponseJson {
  items: AlerteJson[];
  limit: number;
  truncated: boolean;
}

describe('GET /api/alerts (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Configuration de main.ts reproduite : sans elle, ni la validation ni le
    // préfixe /api ne s'appliqueraient, et le test ne refléterait pas le
    // comportement réel.
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
    await nettoyer();
    await app.close();
  });

  const nettoyer = async () => {
    await prisma.alert.deleteMany({
      where: { gtfsAlertId: { startsWith: PREFIXE } },
    });
    await prisma.transitLine.deleteMany({
      where: { gtfsRouteId: { in: [LIGNE_CONNUE, LIGNE_INCONNUE] } },
    });
  };

  beforeEach(async () => {
    await nettoyer();
  });

  /// Crée une alerte datée par rapport à MAINTENANT, en heures.
  const creer = (
    suffixe: string,
    options: {
      debutH?: number;
      /// Début EXACT, quand plusieurs alertes doivent partager la même heure
      /// à la milliseconde près — sans quoi `Date.now()`, réévalué à chaque
      /// création, les séparerait et le départage par identifiant ne serait
      /// jamais atteint.
      debutExact?: Date;
      finH?: number | null;
      severity?: AlertSeverity;
      lineIds?: string[];
      stopIds?: string[];
      headerText?: string | null;
      descriptionText?: string | null;
    } = {},
  ) => {
    const maintenant = Date.now();
    const {
      debutH = -1,
      debutExact,
      finH = null,
      severity = AlertSeverity.WARNING,
      lineIds = [],
      stopIds = [],
      headerText = 'Travaux',
      descriptionText = null,
    } = options;

    return prisma.alert.create({
      data: {
        gtfsAlertId: `${PREFIXE}${suffixe}`,
        stopIds,
        lineIds,
        affectedMode: ModeTransport.BUS,
        severity,
        cause: 'MAINTENANCE',
        effect: 'REDUCED_SERVICE',
        startTime: debutExact ?? new Date(maintenant + debutH * HEURE),
        endTime: finH === null ? null : new Date(maintenant + finH * HEURE),
        headerText,
        descriptionText,
      },
    });
  };

  /// Appelle l'endpoint SANS aucun jeton.
  const appeler = async (chemin = '/api/alerts'): Promise<ReponseJson> => {
    const reponse = await request(app.getHttpServer()).get(chemin).expect(200);
    return reponse.body as ReponseJson;
  };

  /// Les identifiants rendus, restreints à ceux de ce test : la base peut
  /// contenir d'autres alertes actives créées par une suite parallèle.
  const idsDuTest = (corps: ReponseJson) =>
    corps.items.map((a) => a.id).filter((id) => id.startsWith(PREFIXE));

  // ---------------------------------------------------------------------------
  // 1. Accès public
  // ---------------------------------------------------------------------------
  describe('accès', () => {
    it('répond 200 sans le moindre jeton', async () => {
      // UC02 est dans « Mobilité (Libre accès) » : exiger un compte pour
      // savoir que sa ligne est coupée serait absurde.
      await request(app.getHttpServer()).get('/api/alerts').expect(200);
    });

    it('répond 200 même si un jeton invalide est envoyé', async () => {
      // Preuve qu'aucun guard n'est monté : un guard rejetterait en 401.
      await request(app.getHttpServer())
        .get('/api/alerts')
        .set('Authorization', 'Bearer ceci-nest-pas-un-jeton')
        .expect(200);
    });

    it('rend toujours 200, jamais 404, même sans perturbation', async () => {
      const corps = await appeler();

      // « Le réseau fonctionne » est une réponse, pas une erreur.
      expect(idsDuTest(corps)).toEqual([]);
      expect(Array.isArray(corps.items)).toBe(true);
    });

    it('ignore un paramètre inattendu plutôt que de le rejeter', async () => {
      // CONSTAT, et non supposition : `forbidNonWhitelisted` ne s'applique
      // qu'aux DTO déclarés, et cette route n'en a aucun. Le paramètre est
      // donc simplement ignoré — le comportement HTTP habituel.
      await request(app.getHttpServer()).get('/api/alerts?foo=1').expect(200);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Sélection temporelle — le cœur de l'étape
  // ---------------------------------------------------------------------------
  describe('alertes actives', () => {
    it('rend une alerte en cours', async () => {
      await creer('en-cours', { debutH: -1, finH: 1 });

      expect(idsDuTest(await appeler())).toEqual([`${PREFIXE}en-cours`]);
    });

    it('rend une alerte commencée et sans fin annoncée', async () => {
      // Le cas de la migration 4F-1A : `endTime IS NULL` doit passer le
      // filtre SQL, et pas seulement le filtre TypeScript.
      await creer('sans-fin', { debutH: -2, finH: null });

      expect(idsDuTest(await appeler())).toEqual([`${PREFIXE}sans-fin`]);
    });

    it('exclut une alerte qui n’a pas encore commencé', async () => {
      // Des travaux annoncés pour dans une heure ne sont pas une
      // perturbation « en cours » : les afficher ferait renoncer à un trajet
      // possible.
      await creer('future', { debutH: 1, finH: 2 });

      expect(idsDuTest(await appeler())).toEqual([]);
    });

    it('exclut une alerte terminée', async () => {
      await creer('expiree', { debutH: -3, finH: -1 });

      expect(idsDuTest(await appeler())).toEqual([]);
    });

    it('n’a PAS supprimé l’alerte expirée de la base', async () => {
      await creer('expiree', { debutH: -3, finH: -1 });
      await appeler();

      // La décision de 4F-1D : la pertinence se juge à la LECTURE. La table
      // garde l'historique, l'API ne montre que le présent.
      const enBase = await prisma.alert.findUnique({
        where: { gtfsAlertId: `${PREFIXE}expiree` },
      });
      expect(enBase).not.toBeNull();
    });

    it('trie sans laisser passer future ni expirée parmi plusieurs', async () => {
      await creer('a-en-cours', { debutH: -1, finH: 1 });
      await creer('b-future', { debutH: 2, finH: 3 });
      await creer('c-expiree', { debutH: -5, finH: -4 });
      await creer('d-sans-fin', { debutH: -2 });

      expect(idsDuTest(await appeler()).sort()).toEqual([
        `${PREFIXE}a-en-cours`,
        `${PREFIXE}d-sans-fin`,
      ]);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Contrat de réponse
  // ---------------------------------------------------------------------------
  describe('contrat JSON', () => {
    it('rend exactement les champs attendus', async () => {
      await creer('contrat', {
        debutH: -1,
        finH: 2,
        stopIds: ['STOP_X'],
        descriptionText: 'Service réduit.',
      });

      const [alerte] = (await appeler()).items.filter((a) =>
        a.id.startsWith(PREFIXE),
      );

      expect(Object.keys(alerte).sort()).toEqual([
        'cause',
        'descriptionText',
        'effect',
        'endTime',
        'headerText',
        'id',
        'lines',
        'mode',
        'severity',
        'startTime',
        'stopIds',
      ]);
    });

    it('expose gtfsAlertId, jamais l’UUID interne', async () => {
      const creee = await creer('identite', { debutH: -1 });

      const reponse = await request(app.getHttpServer())
        .get('/api/alerts')
        .expect(200);

      // Le corps ENTIER est inspecté : aucune fuite, même dans un champ
      // auquel on n'aurait pas pensé.
      expect(JSON.stringify(reponse.body)).not.toContain(creee.id);
      expect(JSON.stringify(reponse.body)).toContain(`${PREFIXE}identite`);
    });

    it('sérialise les dates en ISO 8601 UTC', async () => {
      await creer('dates', { debutH: -1, finH: 2 });

      const [alerte] = (await appeler()).items.filter((a) =>
        a.id.startsWith(PREFIXE),
      );

      expect(alerte.startTime).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
      expect(alerte.endTime).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    });

    it('sérialise endTime absent en null, et non en date inventée', async () => {
      await creer('sans-fin', { debutH: -1, finH: null });

      const [alerte] = (await appeler()).items.filter((a) =>
        a.id.startsWith(PREFIXE),
      );

      expect(alerte.endTime).toBeNull();
    });

    it('transmet des textes absents en null', async () => {
      await creer('sans-texte', {
        debutH: -1,
        headerText: null,
        descriptionText: null,
      });

      const [alerte] = (await appeler()).items.filter((a) =>
        a.id.startsWith(PREFIXE),
      );

      expect(alerte.headerText).toBeNull();
      expect(alerte.descriptionText).toBeNull();
      // Et rien n'a été fabriqué à partir de cause/effect.
      expect(alerte.cause).toBe('MAINTENANCE');
    });

    it('annonce son plafond dans chaque réponse', async () => {
      const corps = await appeler();

      expect(corps.limit).toBe(ALERTS_LIMIT);
      expect(corps.truncated).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Tri
  // ---------------------------------------------------------------------------
  describe('tri', () => {
    it('classe par gravité, puis date, puis identifiant', async () => {
      await creer('c-info', {
        debutH: -1,
        severity: AlertSeverity.INFO,
      });
      await creer('a-severe-ancienne', {
        debutH: -4,
        severity: AlertSeverity.SEVERE,
      });
      await creer('b-severe-recente', {
        debutH: -2,
        severity: AlertSeverity.SEVERE,
      });
      await creer('d-warning', {
        debutH: -1,
        severity: AlertSeverity.WARNING,
      });

      // Une coupure annoncée il y a 4 h passe avant une info d'il y a 1 h :
      // c'est une liste de triage, pas une chronologie.
      expect(idsDuTest(await appeler())).toEqual([
        `${PREFIXE}b-severe-recente`,
        `${PREFIXE}a-severe-ancienne`,
        `${PREFIXE}d-warning`,
        `${PREFIXE}c-info`,
      ]);
    });

    it('rend deux fois le même ordre', async () => {
      // MÊME gravité et MÊME heure exacte : c'est le seul montage où le
      // troisième critère est réellement sollicité.
      const memeInstant = new Date(Date.now() - HEURE);
      const grave = { debutExact: memeInstant, severity: AlertSeverity.SEVERE };

      await creer('z', grave);
      await creer('x', grave);
      await creer('y', grave);

      // Même gravité, même heure : sans le départage par identifiant,
      // l'ordre serait laissé à PostgreSQL et ce test échouerait par
      // intermittence.
      const premier = idsDuTest(await appeler());
      const second = idsDuTest(await appeler());

      expect(second).toEqual(premier);
      expect(premier).toEqual([`${PREFIXE}x`, `${PREFIXE}y`, `${PREFIXE}z`]);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Plafond, éprouvé sur la vraie base
  // ---------------------------------------------------------------------------
  //
  // Le test unitaire double Prisma : il vérifie que `take: 201` est DEMANDÉ,
  // pas que PostgreSQL s'y tienne. Ces deux cas-ci le prouvent.
  describe('plafond', () => {
    /// Insère `nombre` alertes actives en une seule requête.
    const creerEnMasse = async (nombre: number) => {
      const debut = new Date(Date.now() - HEURE);

      await prisma.alert.createMany({
        data: Array.from({ length: nombre }, (_, i) => ({
          gtfsAlertId: `${PREFIXE}masse-${String(i).padStart(4, '0')}`,
          stopIds: [],
          lineIds: [],
          affectedMode: ModeTransport.BUS,
          severity: AlertSeverity.INFO,
          cause: 'MAINTENANCE',
          effect: 'REDUCED_SERVICE',
          startTime: debut,
          endTime: null,
          headerText: null,
          descriptionText: null,
        })),
      });
    };

    it('ne tronque pas à exactement 200 alertes', async () => {
      await creerEnMasse(ALERTS_LIMIT);

      const corps = await appeler();

      expect(corps.items).toHaveLength(ALERTS_LIMIT);
      expect(corps.truncated).toBe(false);
    });

    it('tronque à 200 et le signale au-delà', async () => {
      await creerEnMasse(ALERTS_LIMIT + 1);

      const corps = await appeler();

      // Le client peut ainsi distinguer « voici tout » de « en voici 200 ».
      expect(corps.items).toHaveLength(ALERTS_LIMIT);
      expect(corps.limit).toBe(ALERTS_LIMIT);
      expect(corps.truncated).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Résolution des lignes
  // ---------------------------------------------------------------------------
  describe('lignes concernées', () => {
    beforeEach(async () => {
      await prisma.transitLine.create({
        data: {
          gtfsRouteId: LIGNE_CONNUE,
          name: 'Bus 38',
          mode: ModeTransport.BUS,
          operator: 'E2E',
        },
      });
    });

    it('remplace l’identifiant GTFS par le nom affiché', async () => {
      await creer('avec-ligne', { debutH: -1, lineIds: [LIGNE_CONNUE] });

      const [alerte] = (await appeler()).items.filter((a) =>
        a.id.startsWith(PREFIXE),
      );

      // L'exigence de 4E-2 : l'usager lit « Bus 38 », pas un code interne.
      expect(alerte.lines).toEqual([{ id: LIGNE_CONNUE, name: 'Bus 38' }]);
    });

    it('conserve une ligne absente du référentiel, sans nom', async () => {
      await creer('ligne-fantome', {
        debutH: -1,
        lineIds: [LIGNE_INCONNUE],
      });

      const [alerte] = (await appeler()).items.filter((a) =>
        a.id.startsWith(PREFIXE),
      );

      // L'alerte n'est PAS écartée : un flux temps réel peut citer une ligne
      // créée après notre dernier import statique.
      expect(alerte.lines).toEqual([{ id: LIGNE_INCONNUE, name: null }]);
    });

    it('mêle lignes connues et inconnues sur une même alerte', async () => {
      await creer('mixte', {
        debutH: -1,
        lineIds: [LIGNE_CONNUE, LIGNE_INCONNUE],
      });

      const [alerte] = (await appeler()).items.filter((a) =>
        a.id.startsWith(PREFIXE),
      );

      expect(alerte.lines).toEqual([
        { id: LIGNE_CONNUE, name: 'Bus 38' },
        { id: LIGNE_INCONNUE, name: null },
      ]);
    });

    it('résout la même ligne pour plusieurs alertes', async () => {
      await creer('part-1', { debutH: -1, lineIds: [LIGNE_CONNUE] });
      await creer('part-2', { debutH: -2, lineIds: [LIGNE_CONNUE] });
      await creer('part-3', { debutH: -3, lineIds: [LIGNE_CONNUE] });

      const alertes = (await appeler()).items.filter((a) =>
        a.id.startsWith(PREFIXE),
      );

      // Trois alertes, une seule requête de résolution (vérifiée côté
      // unitaire) : toutes portent le même nom.
      expect(alertes).toHaveLength(3);
      for (const alerte of alertes) {
        expect(alerte.lines).toEqual([{ id: LIGNE_CONNUE, name: 'Bus 38' }]);
      }
    });

    it('rend un tableau vide quand aucune ligne n’est citée', async () => {
      await creer('sans-ligne', { debutH: -1, lineIds: [] });

      const [alerte] = (await appeler()).items.filter((a) =>
        a.id.startsWith(PREFIXE),
      );

      expect(alerte.lines).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Absence de résidu
  // ---------------------------------------------------------------------------
  it('ne laisse aucune donnée derrière lui', async () => {
    await creer('residu', { debutH: -1 });
    await nettoyer();

    const restantes = await prisma.alert.count({
      where: { gtfsAlertId: { startsWith: PREFIXE } },
    });
    expect(restantes).toBe(0);
  });
});
