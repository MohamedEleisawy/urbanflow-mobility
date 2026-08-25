// Charge projet/backend/.env (DATABASE_URL).
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AlertSeverity, ModeTransport } from '@prisma/client';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { GtfsRtModule } from '../src/gtfs-rt/gtfs-rt.module';
import { GtfsRtDecoderService } from '../src/gtfs-rt/gtfs-rt-decoder.service';
import { GtfsRtImportService } from '../src/gtfs-rt/gtfs-rt-import.service';

/**
 * Import des alertes GTFS-Realtime en base (étape 4F-1C).
 *
 * CE QUE LE TEST DU MAPPER NE PROUVE PAS. Le mapper est pur : il travaille
 * sur des tables de correspondance qu'on lui fournit. Trois choses ne peuvent
 * donc se vérifier QUE sur PostgreSQL :
 *
 *   1. l'idempotence — elle repose sur la contrainte UNIQUE de gtfsAlertId ;
 *   2. la déduction du mode — elle vient d'une vraie requête sur le
 *      référentiel importé en 4C-4 ;
 *   3. la persistance de `endTime = NULL` — la colonne n'est nullable que
 *      depuis la migration 4F-1A.
 *
 * AUCUN RÉSEAU : les flux viennent des fixtures binaires versionnées, jamais
 * d'une API. Seul le décodage et l'écriture sont exercés ici.
 */
const FIXTURES = join(__dirname, 'fixtures', 'gtfs-rt');
const lireFlux = (nom: string): Uint8Array =>
  new Uint8Array(readFileSync(join(FIXTURES, nom)));

/// Identifiants propres à ce test, distincts de ceux des autres suites e2e
/// (R1/R2/N1/NR1) : les tests tournent en parallèle sur la même base.
const ROUTES = ['ROUTE_A', 'ROUTE_T'];
const ARRETS = ['STOP_1', 'STOP_2'];
const ALERTES = [
  'alerte-import-1',
  'alerte-arret-seul',
  'mixte-valide',
  'mixte-partiel',
  'mixte-trajet',
  'mixte-severite-inconnue',
  'mixte-deux-periodes',
  'mixte-sans-periode',
  'mixte-trip-update',
  'mixte-mode-ambigu',
  'mixte-ligne-inconnue',
  // Étape 4F-2A
  'texte-multilingue',
  'texte-sans-francais',
  'texte-sans-langue',
  'texte-header-seul',
  'texte-description-seule',
  'texte-vide',
];

describe('Import des alertes GTFS-RT (e2e)', () => {
  let moduleRef: TestingModule;
  let importer: GtfsRtImportService;
  let decoder: GtfsRtDecoderService;
  let prisma: PrismaService;

  /// Importe une fixture décodée, sans passer par le réseau.
  const importerFixture = (nom: string) =>
    importer.importFeed(decoder.decode(lireFlux(nom)));

  const alerte = (gtfsAlertId: string) =>
    prisma.alert.findUnique({ where: { gtfsAlertId } });

  const nettoyer = async () => {
    await prisma.alert.deleteMany({ where: { gtfsAlertId: { in: ALERTES } } });
    await prisma.networkLink.deleteMany({
      where: { line: { gtfsRouteId: { in: ROUTES } } },
    });
    await prisma.transitLine.deleteMany({
      where: { gtfsRouteId: { in: ROUTES } },
    });
    await prisma.stop.deleteMany({ where: { gtfsStopId: { in: ARRETS } } });
  };

  beforeAll(async () => {
    Logger.overrideLogger(false);

    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, GtfsRtModule],
    }).compile();
    await moduleRef.init();

    importer = moduleRef.get(GtfsRtImportService);
    decoder = moduleRef.get(GtfsRtDecoderService);
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await nettoyer();
    await moduleRef.close();
  });

  beforeEach(async () => {
    await nettoyer();

    // Le référentiel dont l'import a besoin pour déduire les modes. Il vient
    // normalement de l'import GTFS statique (4C-4) : on le reconstitue ici
    // au strict minimum.
    const [ligneBus, ligneTram] = await Promise.all([
      prisma.transitLine.create({
        data: {
          gtfsRouteId: 'ROUTE_A',
          name: 'A',
          mode: ModeTransport.BUS,
          operator: 'E2E',
        },
      }),
      prisma.transitLine.create({
        data: {
          gtfsRouteId: 'ROUTE_T',
          name: 'T',
          mode: ModeTransport.TRAM,
          operator: 'E2E',
        },
      }),
    ]);

    const [arret1, arret2] = await Promise.all([
      prisma.stop.create({
        data: {
          gtfsStopId: 'STOP_1',
          name: 'Arrêt 1',
          latitude: -33.1,
          longitude: 18.1,
          operatorCode: 'E2E',
        },
      }),
      prisma.stop.create({
        data: {
          gtfsStopId: 'STOP_2',
          name: 'Arrêt 2',
          latitude: -33.2,
          longitude: 18.2,
          operatorCode: 'E2E',
        },
      }),
    ]);

    // La liaison est ce qui rattache un ARRÊT à un MODE : sans elle, une
    // alerte ne nommant qu'un arrêt serait sans mode déductible.
    await prisma.networkLink.create({
      data: {
        lineId: ligneBus.id,
        fromStopId: arret1.id,
        toStopId: arret2.id,
        durationMin: 3,
        distanceM: 800,
      },
    });

    void ligneTram;
  });

  // ---------------------------------------------------------------------------
  // 1. Création
  // ---------------------------------------------------------------------------
  describe('premier import', () => {
    it("crée l'alerte en base avec toutes ses données", async () => {
      const rapport = await importerFixture('import-nominal.pb');

      expect(rapport.entities.created).toBe(1);
      expect(rapport.entities.updated).toBe(0);

      const enregistree = await alerte('alerte-import-1');

      expect(enregistree).toMatchObject({
        lineIds: ['ROUTE_A'],
        stopIds: ['STOP_1'],
        affectedMode: ModeTransport.BUS,
        severity: AlertSeverity.WARNING,
        cause: 'MAINTENANCE',
        effect: 'REDUCED_SERVICE',
        startTime: new Date('2025-12-01T11:00:00.000Z'),
        endTime: new Date('2025-12-01T14:00:00.000Z'),
      });
    });

    it("attribue un UUID interne, distinct de l'identifiant du flux", async () => {
      await importerFixture('import-nominal.pb');

      const enregistree = await alerte('alerte-import-1');

      // Même règle qu'en 4C-4-3 : on ne dépend jamais du format
      // d'identifiant de l'opérateur pour notre clé primaire.
      expect(enregistree!.id).not.toBe('alerte-import-1');
      expect(enregistree!.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('déduit le mode depuis les liaisons quand seul un arrêt est nommé', async () => {
      // Aucune ligne dans cette alerte : le mode ne peut venir que d'une
      // requête réelle sur NetworkLink → TransitLine.mode.
      const rapport = await importerFixture('import-arret-seul.pb');

      expect(rapport.entities.created).toBe(1);

      const enregistree = await alerte('alerte-arret-seul');

      expect(enregistree).toMatchObject({
        stopIds: ['STOP_1'],
        lineIds: [],
        affectedMode: ModeTransport.BUS,
        effect: 'ACCESSIBILITY_ISSUE',
      });
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Idempotence — la propriété centrale de l'étape
  // ---------------------------------------------------------------------------
  describe('idempotence', () => {
    it('ne crée aucun doublon lorsque le même flux est réimporté', async () => {
      await importerFixture('import-nominal.pb');
      const second = await importerFixture('import-nominal.pb');

      // Un flux temps réel est rechargé toutes les 30 secondes : sans cette
      // propriété, la table grossirait indéfiniment.
      expect(second.entities.created).toBe(0);
      expect(second.entities.updated).toBe(1);

      const lignes = await prisma.alert.count({
        where: { gtfsAlertId: 'alerte-import-1' },
      });
      expect(lignes).toBe(1);
    });

    it("conserve l'UUID interne d'un réimport à l'autre", async () => {
      await importerFixture('import-nominal.pb');
      const avant = await alerte('alerte-import-1');

      await importerFixture('import-nominal.pb');
      const apres = await alerte('alerte-import-1');

      // C'est bien une MISE À JOUR de la même ligne, pas un remplacement :
      // toute référence future à cette alerte reste valide.
      expect(apres!.id).toBe(avant!.id);
    });

    it('laisse le nombre total de lignes inchangé', async () => {
      const avant = await prisma.alert.count();

      await importerFixture('import-nominal.pb');
      const apresPremier = await prisma.alert.count();
      await importerFixture('import-nominal.pb');
      const apresSecond = await prisma.alert.count();

      expect(apresPremier).toBe(avant + 1);
      expect(apresSecond).toBe(apresPremier);
    });

    it("laisse l'alerte rigoureusement identique si le flux n'a pas changé", async () => {
      await importerFixture('import-nominal.pb');
      const avant = await alerte('alerte-import-1');

      await importerFixture('import-nominal.pb');
      const apres = await alerte('alerte-import-1');

      // Une mise à jour qui n'a rien à mettre à jour ne doit RIEN changer :
      // ni l'UUID, ni un champ, ni un tableau. C'est ce qui rend un flux
      // rechargé toutes les 30 secondes inoffensif.
      expect(apres).toEqual(avant);
    });

    it('produit exactement le même rapport à flux identique', async () => {
      // Le rapport est déterministe : aucune date, aucun aléa.
      await importerFixture('import-nominal.pb');
      const premier = await importerFixture('import-nominal.pb');
      const second = await importerFixture('import-nominal.pb');

      expect(second).toEqual(premier);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Mise à jour lorsque le flux change
  // ---------------------------------------------------------------------------
  describe('mise à jour', () => {
    it("remplace les données lorsque l'opérateur aggrave l'alerte", async () => {
      await importerFixture('import-nominal.pb');
      const rapport = await importerFixture('import-modifie.pb');

      expect(rapport.entities.updated).toBe(1);
      expect(rapport.entities.created).toBe(0);

      const enregistree = await alerte('alerte-import-1');

      expect(enregistree).toMatchObject({
        severity: AlertSeverity.SEVERE,
        cause: 'STRIKE',
        effect: 'NO_SERVICE',
        lineIds: ['ROUTE_A'],
      });
    });

    it('efface un arrêt qui ne figure plus dans le flux', async () => {
      await importerFixture('import-nominal.pb');
      await importerFixture('import-modifie.pb');

      const enregistree = await alerte('alerte-import-1');

      // La mise à jour REMPLACE les tableaux, elle ne les complète pas :
      // sinon une perturbation levée sur un arrêt y resterait affichée.
      expect(enregistree!.stopIds).toEqual([]);
    });

    it('persiste réellement endTime à NULL quand la fin devient inconnue', async () => {
      await importerFixture('import-nominal.pb');
      const avant = await alerte('alerte-import-1');
      expect(avant!.endTime).not.toBeNull();

      await importerFixture('import-modifie.pb');
      const apres = await alerte('alerte-import-1');

      // Le cœur de la migration 4F-1A, vérifié sur PostgreSQL : une fin
      // connue peut redevenir inconnue, et NULL le dit sans mentir.
      expect(apres!.endTime).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Rejets contrôlés et rapport d'import
  // ---------------------------------------------------------------------------
  describe("rejets et rapport d'import", () => {
    it('rend un rapport exact sur un flux mêlant tous les cas', async () => {
      const rapport = await importerFixture('import-mixte.pb');

      expect(rapport.entities).toEqual({
        total: 9,
        alerts: 8, // la 9e entité est un tripUpdate
        created: 2, // mixte-valide et mixte-partiel
        updated: 0,
        rejected: 7,
      });

      expect(rapport.rejections).toEqual({
        notAnAlert: 1,
        deletedEntity: 0,
        missingEntityId: 0,
        missingActivePeriod: 1,
        multipleActivePeriods: 1,
        missingPeriodStart: 0,
        unknownSeverity: 1,
        noRepresentableEntity: 1,
        ambiguousMode: 1,
        undeterminableMode: 1,
      });

      expect(rapport.discardedSelectors).toEqual({
        tripSelector: 2,
        agencySelector: 0,
        emptySelector: 0,
      });

      expect(rapport.partiallyRepresented).toBe(1);
    });

    it('respecte son invariant : toute entité lue a un sort connu', async () => {
      const rapport = await importerFixture('import-mixte.pb');

      // total === créées + mises à jour + rejetées. Si cet invariant tombe,
      // c'est qu'un chemin de code écarte une entité en silence.
      expect(rapport.isConsistent()).toBe(true);
    });

    it("n'écrit AUCUNE des alertes rejetées", async () => {
      await importerFixture('import-mixte.pb');

      const enBase = await prisma.alert.findMany({
        where: { gtfsAlertId: { in: ALERTES } },
        select: { gtfsAlertId: true },
      });

      // Un rejet est un refus d'écrire, pas une écriture dégradée.
      expect(enBase.map((a) => a.gtfsAlertId).sort()).toEqual([
        'mixte-partiel',
        'mixte-valide',
      ]);
    });

    it("importe l'alerte partiellement représentable, amputée mais fidèle", async () => {
      await importerFixture('import-mixte.pb');

      const enregistree = await alerte('mixte-partiel');

      // Le ciblage de trajet a disparu ; la ligne demeure. L'alerte annonce
      // moins que ce que l'opérateur a publié, jamais plus.
      expect(enregistree).toMatchObject({
        lineIds: ['ROUTE_A'],
        stopIds: [],
        affectedMode: ModeTransport.BUS,
        effect: 'SIGNIFICANT_DELAYS',
      });
    });

    it('rend un bilan lisible mentionnant chaque motif rencontré', async () => {
      const rapport = await importerFixture('import-mixte.pb');
      const texte = rapport.toLines().join('\n');

      expect(texte).toContain('9 entités lues, dont 8 alertes');
      expect(texte).toContain('unknownSeverity : 1');
      expect(texte).toContain('ambiguousMode : 1');
      // Les motifs jamais rencontrés n'encombrent pas le bilan.
      expect(texte).not.toContain('deletedEntity');
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Texte destiné aux voyageurs — étape 4F-2A
  // ---------------------------------------------------------------------------
  //
  // Le mapper a ses propres tests, sans base. Ce qui ne peut se vérifier QUE
  // sur PostgreSQL, c'est que ces colonnes — créées par la migration
  // 4F-2A — reçoivent bien le texte, et surtout qu'elles savent REDEVENIR
  // NULL.
  describe('texte utilisateur', () => {
    it('persiste le titre publié par l’opérateur', async () => {
      await importerFixture('import-nominal.pb');

      const enregistree = await alerte('alerte-import-1');

      // Sans cette colonne, l'alerte se résumait en base à
      // « MAINTENANCE / REDUCED_SERVICE » : illisible pour un voyageur.
      expect(enregistree!.headerText).toBe('Travaux ligne A');
    });

    it('persiste titre ET description, en français', async () => {
      await importerFixture('texte-multilingue.pb');

      const enregistree = await alerte('texte-multilingue');

      expect(enregistree).toMatchObject({
        headerText: 'Travaux sur la ligne A',
        descriptionText: 'Service réduit jusqu’à 14h.',
      });
    });

    it('persiste le repli sur la première traduction', async () => {
      await importerFixture('texte-sans-francais.pb');

      const enregistree = await alerte('texte-sans-francais');

      expect(enregistree).toMatchObject({
        headerText: 'Works on line A',
        descriptionText: 'Reduced service.',
      });
    });

    it('écrit NULL quand aucun texte n’est publié', async () => {
      await importerFixture('texte-vide.pb');

      const enregistree = await alerte('texte-vide');

      // NULL, et non une chaîne vide : « aucun texte n'a été publié » est
      // une information, "" n'en est pas une.
      expect(enregistree!.headerText).toBeNull();
      expect(enregistree!.descriptionText).toBeNull();
    });

    it('accepte un titre sans description, et l’inverse', async () => {
      await importerFixture('texte-header-seul.pb');
      await importerFixture('texte-description-seule.pb');

      expect(await alerte('texte-header-seul')).toMatchObject({
        headerText: 'Ligne A interrompue',
        descriptionText: null,
      });
      expect(await alerte('texte-description-seule')).toMatchObject({
        headerText: null,
        descriptionText: 'Un véhicule est immobilisé.',
      });
    });

    it('remplace le texte quand l’opérateur le réécrit', async () => {
      await importerFixture('import-nominal.pb');
      const rapport = await importerFixture('import-modifie.pb');

      const enregistree = await alerte('alerte-import-1');

      // Même gtfsAlertId, donc une MISE À JOUR : le texte suit l'évolution
      // de la perturbation sans créer de seconde ligne.
      expect(rapport.entities.updated).toBe(1);
      expect(rapport.entities.created).toBe(0);
      expect(enregistree!.headerText).toBe('Grève ligne A');
    });

    it('repasse réellement à NULL si le texte est retiré du flux', async () => {
      // LE CAS DÉCISIF. Un opérateur peut retirer un titre publié par erreur.
      // Conserver l'ancienne valeur afficherait indéfiniment un message qu'il
      // a lui-même retiré.
      await importerFixture('import-nominal.pb');
      expect((await alerte('alerte-import-1'))!.headerText).not.toBeNull();

      await importerFixture('import-texte-retire.pb');

      const apres = await alerte('alerte-import-1');
      expect(apres!.headerText).toBeNull();
      expect(apres!.descriptionText).toBeNull();
    });

    it('laisse le texte rigoureusement identique à flux inchangé', async () => {
      await importerFixture('texte-multilingue.pb');
      const avant = await alerte('texte-multilingue');

      await importerFixture('texte-multilingue.pb');
      const apres = await alerte('texte-multilingue');

      // L'idempotence de 4F-1C doit couvrir les nouvelles colonnes comme les
      // autres : un flux rechargé toutes les 30 secondes ne doit rien agiter.
      expect(apres).toEqual(avant);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Disparition du flux — étape 4F-1D
  // ---------------------------------------------------------------------------
  describe('alerte disparue du flux', () => {
    it("ne supprime RIEN lorsqu'une alerte cesse d'être publiée", async () => {
      await importerFixture('import-mixte.pb');
      expect(await alerte('mixte-valide')).not.toBeNull();

      // Un flux qui ne mentionne plus mixte-valide.
      await importerFixture('import-nominal.pb');

      // VERROU DE COMPORTEMENT (4F-1D). « Absente du flux actuel » n'est PAS
      // « doit être supprimée ». Un flux tronqué, une panne de l'opérateur ou
      // un flux INCREMENTAL effaceraient l'historique des perturbations sur
      // un simple silence. Décider qu'une alerte est terminée demande une
      // règle explicite — elle n'est pas prise à cette étape.
      expect(await alerte('mixte-valide')).not.toBeNull();
      expect(await alerte('mixte-partiel')).not.toBeNull();
    });

    it("n'invente pas non plus de date de fin à une alerte disparue", async () => {
      await importerFixture('import-mixte.pb');
      await importerFixture('import-nominal.pb');

      const survivante = await alerte('mixte-valide');

      // Clore l'alerte en lui posant `endTime = maintenant` serait la même
      // faute qu'un endTime = 2099 : affirmer une échéance que l'opérateur
      // n'a jamais annoncée.
      expect(survivante!.endTime).toEqual(new Date('2025-12-01T14:00:00.000Z'));
    });

    it("réactualise l'alerte si elle réapparaît au flux suivant", async () => {
      await importerFixture('import-mixte.pb');
      await importerFixture('import-nominal.pb');
      const rapport = await importerFixture('import-mixte.pb');

      // Comme elle n'a jamais été supprimée, son retour est une MISE À JOUR :
      // aucun doublon, et l'UUID interne est conservé.
      expect(rapport.entities.created).toBe(0);
      expect(rapport.entities.updated).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Absence de résidu
  // ---------------------------------------------------------------------------
  it('ne laisse aucune trace des alertes rejetées après nettoyage', async () => {
    await importerFixture('import-mixte.pb');
    await nettoyer();

    const restantes = await prisma.alert.count({
      where: { gtfsAlertId: { in: ALERTES } },
    });

    expect(restantes).toBe(0);
  });
});
