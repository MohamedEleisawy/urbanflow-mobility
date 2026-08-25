import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AlertSeverity, ModeTransport } from '@prisma/client';
import { transit_realtime } from 'gtfs-realtime-bindings';
import { GtfsRtImportReport } from './gtfs-rt-import-report';
import { GtfsRtModeLookup, mapAlertEntity } from './gtfs-rt-alert.mapper';

// Le mapper est PUR : aucun de ces tests ne touche à PostgreSQL, ni au
// réseau. Ce que la base sait est fourni sous forme de deux tables de
// correspondance — c'est exactement ce que GtfsRtImportService lui passera.
const LOOKUP: GtfsRtModeLookup = {
  modeParLigne: new Map([
    ['ROUTE_A', ModeTransport.BUS],
    ['ROUTE_B', ModeTransport.BUS],
    ['ROUTE_T', ModeTransport.TRAM],
  ]),
  modesParArret: new Map([
    ['STOP_BUS', new Set([ModeTransport.BUS])],
    ['STOP_AUTRE', new Set([ModeTransport.BUS])],
    ['STOP_MIXTE', new Set([ModeTransport.BUS, ModeTransport.TRAM])],
  ]),
};

const DEBUT = 1_764_586_800; // 2025-12-01T11:00:00Z
const FIN = 1_764_597_600; // 2025-12-01T14:00:00Z

/// Entité minimale valide, que chaque test ne fait que modifier là où il
/// veut prouver quelque chose. Sans cela, chaque test devrait redéclarer
/// dix champs et le point testé disparaîtrait dans le bruit.
const entite = (
  alerte: transit_realtime.IAlert,
  id = 'alerte-1',
): transit_realtime.IFeedEntity => ({
  id,
  alert: {
    activePeriod: [{ start: DEBUT, end: FIN }],
    informedEntity: [{ routeId: 'ROUTE_A' }],
    severityLevel: transit_realtime.Alert.SeverityLevel.WARNING,
    ...alerte,
  },
});

describe('mapAlertEntity', () => {
  let report: GtfsRtImportReport;

  beforeEach(() => {
    report = new GtfsRtImportReport();
  });

  /// Raccourci : mappe et exige un succès.
  const mapper = (e: transit_realtime.IFeedEntity) => {
    const donnees = mapAlertEntity(e, LOOKUP, report);
    expect(donnees).not.toBeNull();
    return donnees!;
  };

  // ---------------------------------------------------------------------------
  // Cas nominal
  // ---------------------------------------------------------------------------
  describe('alerte simple', () => {
    it('traduit une alerte complète en données prêtes pour Prisma', () => {
      const donnees = mapper(
        entite({
          cause: transit_realtime.Alert.Cause.MAINTENANCE,
          effect: transit_realtime.Alert.Effect.REDUCED_SERVICE,
        }),
      );

      expect(donnees).toEqual({
        gtfsAlertId: 'alerte-1',
        stopIds: [],
        lineIds: ['ROUTE_A'],
        affectedMode: ModeTransport.BUS,
        severity: AlertSeverity.WARNING,
        cause: 'MAINTENANCE',
        effect: 'REDUCED_SERVICE',
        startTime: new Date('2025-12-01T11:00:00.000Z'),
        endTime: new Date('2025-12-01T14:00:00.000Z'),
        headerText: null,
        descriptionText: null,
      });
    });

    it("reprend l'identifiant de l'entité comme clé d'idempotence", () => {
      const donnees = mapper(entite({}, 'perturbation-ligne-4'));

      // gtfsAlertId porte l'unicité en base : c'est lui qui empêchera un
      // réimport de créer un doublon.
      expect(donnees.gtfsAlertId).toBe('perturbation-ligne-4');
    });

    it('convertit les horodatages Unix en secondes, pas en millisecondes', () => {
      const donnees = mapper(entite({}));

      // Le piège relevé en 4F-1B : oublier le facteur 1000 daterait toutes
      // les perturbations de janvier 1970.
      expect(donnees.startTime.getUTCFullYear()).toBe(2025);
    });
  });

  // ---------------------------------------------------------------------------
  // Période d'activité
  // ---------------------------------------------------------------------------
  describe("période d'activité", () => {
    it("rend endTime null quand aucune fin n'est annoncée", () => {
      // Le cas qui a motivé la migration 4F-1A. Aucune date artificielle.
      const donnees = mapper(entite({ activePeriod: [{ start: DEBUT }] }));

      expect(donnees.startTime).toEqual(new Date('2025-12-01T11:00:00.000Z'));
      expect(donnees.endTime).toBeNull();
    });

    it('rejette une alerte sans aucune période', () => {
      // La spécification la dit « active tant qu'elle figure au flux ». Le
      // seul startTime disponible serait l'heure de lecture, qui dit quand
      // NOUS avons lu, pas quand la perturbation a commencé.
      const donnees = mapAlertEntity(
        entite({ activePeriod: [] }),
        LOOKUP,
        report,
      );

      expect(donnees).toBeNull();
      expect(report.rejections.missingActivePeriod).toBe(1);
    });

    it('rejette une alerte à plusieurs périodes plutôt que de les fusionner', () => {
      // Fusionner 11h-14h et 18h-20h donnerait 11h-20h : une perturbation
      // annoncée à 16h alors qu'il n'y en a pas.
      const donnees = mapAlertEntity(
        entite({
          activePeriod: [{ start: DEBUT, end: FIN }, { start: FIN + 86_400 }],
        }),
        LOOKUP,
        report,
      );

      expect(donnees).toBeNull();
      expect(report.rejections.multipleActivePeriods).toBe(1);
    });

    it('rejette une période sans start', () => {
      const donnees = mapAlertEntity(
        entite({ activePeriod: [{ end: FIN }] }),
        LOOKUP,
        report,
      );

      expect(donnees).toBeNull();
      expect(report.rejections.missingPeriodStart).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Cause et effet
  // ---------------------------------------------------------------------------
  describe('cause et effet', () => {
    it("conserve le nom exact de l'énumération GTFS-RT pour la cause", () => {
      const donnees = mapper(
        entite({ cause: transit_realtime.Alert.Cause.STRIKE }),
      );

      // Le NOM, pas le numéro : un « 5 » en base serait illisible et
      // dépendrait de la version du fichier .proto.
      expect(donnees.cause).toBe('STRIKE');
    });

    it("conserve le nom exact de l'énumération GTFS-RT pour l'effet", () => {
      const donnees = mapper(
        entite({ effect: transit_realtime.Alert.Effect.DETOUR }),
      );

      expect(donnees.effect).toBe('DETOUR');
    });

    it('retombe sur les valeurs par défaut de la spécification', () => {
      const donnees = mapper(entite({}));

      // UNKNOWN_CAUSE et UNKNOWN_EFFECT ne sont pas inventés : ce sont les
      // valeurs par défaut définies par GTFS-Realtime lui-même. Les écrire
      // ne travestit donc rien.
      expect(donnees.cause).toBe('UNKNOWN_CAUSE');
      expect(donnees.effect).toBe('UNKNOWN_EFFECT');
    });
  });

  // ---------------------------------------------------------------------------
  // Sévérité
  // ---------------------------------------------------------------------------
  describe('sévérité', () => {
    it.each([
      [transit_realtime.Alert.SeverityLevel.INFO, AlertSeverity.INFO],
      [transit_realtime.Alert.SeverityLevel.WARNING, AlertSeverity.WARNING],
      [transit_realtime.Alert.SeverityLevel.SEVERE, AlertSeverity.SEVERE],
    ])('traduit la sévérité %s', (gtfs, attendue) => {
      const donnees = mapper(entite({ severityLevel: gtfs }));

      expect(donnees.severity).toBe(attendue);
    });

    it('rejette UNKNOWN_SEVERITY au lieu de la rabaisser en INFO', () => {
      // La traduire en INFO afficherait « pour information » là où
      // l'opérateur a dit « je ne sais pas » : une panne majeure passerait
      // pour anodine. Même refus que le trolleybus non traduit en BUS (4C-4-3).
      const donnees = mapAlertEntity(
        entite({
          severityLevel: transit_realtime.Alert.SeverityLevel.UNKNOWN_SEVERITY,
        }),
        LOOKUP,
        report,
      );

      expect(donnees).toBeNull();
      expect(report.rejections.unknownSeverity).toBe(1);
    });

    it('traite une sévérité absente comme UNKNOWN_SEVERITY', () => {
      // protobufjs applique la valeur par défaut de la spécification : un
      // champ non transmis et un UNKNOWN_SEVERITY explicite sont
      // indiscernables, et reçoivent donc le même traitement.
      const donnees = mapAlertEntity(
        entite({ severityLevel: undefined }),
        LOOKUP,
        report,
      );

      expect(donnees).toBeNull();
      expect(report.rejections.unknownSeverity).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Entités concernées
  // ---------------------------------------------------------------------------
  describe('entités concernées', () => {
    it('retient un arrêt seul', () => {
      const donnees = mapper(
        entite({ informedEntity: [{ stopId: 'STOP_BUS' }] }),
      );

      expect(donnees.stopIds).toEqual(['STOP_BUS']);
      expect(donnees.lineIds).toEqual([]);
    });

    it('retient une ligne seule', () => {
      const donnees = mapper(
        entite({ informedEntity: [{ routeId: 'ROUTE_A' }] }),
      );

      expect(donnees.lineIds).toEqual(['ROUTE_A']);
      expect(donnees.stopIds).toEqual([]);
    });

    it('retient plusieurs arrêts', () => {
      const donnees = mapper(
        entite({
          informedEntity: [{ stopId: 'STOP_BUS' }, { stopId: 'STOP_AUTRE' }],
        }),
      );

      expect(donnees.stopIds).toEqual(['STOP_BUS', 'STOP_AUTRE']);
    });

    it('retient plusieurs lignes', () => {
      const donnees = mapper(
        entite({
          informedEntity: [{ routeId: 'ROUTE_A' }, { routeId: 'ROUTE_B' }],
        }),
      );

      expect(donnees.lineIds).toEqual(['ROUTE_A', 'ROUTE_B']);
    });

    it('ne répète jamais deux fois le même identifiant', () => {
      const donnees = mapper(
        entite({
          informedEntity: [
            { routeId: 'ROUTE_A' },
            { routeId: 'ROUTE_A', stopId: 'STOP_BUS' },
          ],
        }),
      );

      expect(donnees.lineIds).toEqual(['ROUTE_A']);
      expect(donnees.stopIds).toEqual(['STOP_BUS']);
    });

    it('écarte un ciblage de trajet, et le compte', () => {
      const donnees = mapAlertEntity(
        entite({ informedEntity: [{ trip: { tripId: 'TRIP_0812' } }] }),
        LOOKUP,
        report,
      );

      expect(donnees).toBeNull();
      expect(report.discardedSelectors.tripSelector).toBe(1);
      expect(report.rejections.noRepresentableEntity).toBe(1);
    });

    it('écarte un ciblage par exploitant, et le compte', () => {
      const donnees = mapAlertEntity(
        entite({ informedEntity: [{ agencyId: 'RATP' }] }),
        LOOKUP,
        report,
      );

      expect(donnees).toBeNull();
      expect(report.discardedSelectors.agencySelector).toBe(1);
    });

    it('écarte un sélecteur vide, et le compte', () => {
      const donnees = mapAlertEntity(
        entite({ informedEntity: [{ directionId: 0 }] }),
        LOOKUP,
        report,
      );

      expect(donnees).toBeNull();
      expect(report.discardedSelectors.emptySelector).toBe(1);
    });

    it("n'élargit pas une alerte ciblant un trajet précis", () => {
      // « La ligne A pour le trajet de 8h12 » n'est PAS « la ligne A ».
      // Retenir le routeId élargirait l'alerte à toute la journée.
      const donnees = mapAlertEntity(
        entite({
          informedEntity: [{ routeId: 'ROUTE_A', trip: { tripId: 'T_0812' } }],
        }),
        LOOKUP,
        report,
      );

      expect(donnees).toBeNull();
      expect(report.discardedSelectors.tripSelector).toBe(1);
    });

    it('importe une alerte partiellement représentable, en le signalant', () => {
      const donnees = mapper(
        entite({
          informedEntity: [
            { routeId: 'ROUTE_A' },
            { trip: { tripId: 'TRIP_1015' } },
          ],
        }),
      );

      // L'alerte part en base avec une portée PLUS ÉTROITE que celle
      // annoncée — jamais plus large — et la perte est comptée.
      expect(donnees.lineIds).toEqual(['ROUTE_A']);
      expect(report.partiallyRepresented).toBe(1);
      expect(report.discardedSelectors.tripSelector).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Mode affecté
  // ---------------------------------------------------------------------------
  describe('mode affecté', () => {
    it('déduit le mode de la ligne, à partir du référentiel importé', () => {
      // Le mode n'est PAS dans le flux : GTFS-RT ne transmet que des
      // identifiants. Il vient de TransitLine.mode, alimenté par route_type.
      const donnees = mapper(
        entite({ informedEntity: [{ routeId: 'ROUTE_T' }] }),
      );

      expect(donnees.affectedMode).toBe(ModeTransport.TRAM);
    });

    it("déduit le mode de l'arrêt lorsque aucune ligne n'est nommée", () => {
      const donnees = mapper(
        entite({ informedEntity: [{ stopId: 'STOP_BUS' }] }),
      );

      expect(donnees.affectedMode).toBe(ModeTransport.BUS);
    });

    it('accepte plusieurs lignes de même mode', () => {
      const donnees = mapper(
        entite({
          informedEntity: [{ routeId: 'ROUTE_A' }, { routeId: 'ROUTE_B' }],
        }),
      );

      // Deux lignes de bus : aucune ambiguïté, le mode reste BUS.
      expect(donnees.affectedMode).toBe(ModeTransport.BUS);
    });

    it('rejette une alerte portant sur deux modes distincts', () => {
      const donnees = mapAlertEntity(
        entite({
          informedEntity: [{ routeId: 'ROUTE_A' }, { routeId: 'ROUTE_T' }],
        }),
        LOOKUP,
        report,
      );

      expect(donnees).toBeNull();
      expect(report.rejections.ambiguousMode).toBe(1);
    });

    it('fait primer les lignes sur les arrêts', () => {
      // ROUTE_A est un bus ; STOP_MIXTE est desservi par un bus ET un tram.
      // Consulter l'arrêt rendrait ambiguë une alerte qui ne l'est pas : la
      // ligne nommée dit précisément ce qui est perturbé.
      const donnees = mapper(
        entite({
          informedEntity: [{ routeId: 'ROUTE_A' }, { stopId: 'STOP_MIXTE' }],
        }),
      );

      expect(donnees.affectedMode).toBe(ModeTransport.BUS);
    });

    it("rejette une alerte dont l'arrêt dessert plusieurs modes", () => {
      // Ici aucune ligne ne tranche : l'ambiguïté est réelle.
      const donnees = mapAlertEntity(
        entite({ informedEntity: [{ stopId: 'STOP_MIXTE' }] }),
        LOOKUP,
        report,
      );

      expect(donnees).toBeNull();
      expect(report.rejections.ambiguousMode).toBe(1);
    });

    it('rejette une alerte sur une ligne absente de notre référentiel', () => {
      const donnees = mapAlertEntity(
        entite({ informedEntity: [{ routeId: 'ROUTE_INCONNUE' }] }),
        LOOKUP,
        report,
      );

      expect(donnees).toBeNull();
      expect(report.rejections.undeterminableMode).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Validation de l'entité elle-même
  // ---------------------------------------------------------------------------
  describe("validation de l'entité", () => {
    it("rejette une entité qui ne porte pas d'alerte", () => {
      const donnees = mapAlertEntity(
        { id: 'maj-trajet', tripUpdate: { trip: { tripId: 'T_1' } } },
        LOOKUP,
        report,
      );

      expect(donnees).toBeNull();
      expect(report.rejections.notAnAlert).toBe(1);
      // Et ce n'est pas comptabilisé comme une alerte lue.
      expect(report.entities.alerts).toBe(0);
    });

    it('rejette une entité sans identifiant', () => {
      // Sans clé externe, chaque import créerait un doublon.
      const donnees = mapAlertEntity({ ...entite({}), id: '' }, LOOKUP, report);

      expect(donnees).toBeNull();
      expect(report.rejections.missingEntityId).toBe(1);
    });

    it("rejette une entité dont l'identifiant n'est qu'un espace", () => {
      const donnees = mapAlertEntity(
        { ...entite({}), id: '   ' },
        LOOKUP,
        report,
      );

      expect(donnees).toBeNull();
      expect(report.rejections.missingEntityId).toBe(1);
    });

    it('rejette une entité marquée supprimée', () => {
      const donnees = mapAlertEntity(
        { ...entite({}), isDeleted: true },
        LOOKUP,
        report,
      );

      expect(donnees).toBeNull();
      expect(report.rejections.deletedEntity).toBe(1);
    });

    it('rejette une alerte sans aucune entité concernée', () => {
      const donnees = mapAlertEntity(
        entite({ informedEntity: [] }),
        LOOKUP,
        report,
      );

      expect(donnees).toBeNull();
      expect(report.rejections.noRepresentableEntity).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Texte destiné aux voyageurs (étape 4F-2A)
  // ---------------------------------------------------------------------------
  //
  // GTFS-RT ne transporte pas une chaîne mais une LISTE de traductions. Ces
  // tests fixent la règle de choix : français d'abord, première traduction
  // ensuite, NULL si rien.
  describe('texte utilisateur', () => {
    const TEXTES = join(__dirname, '..', '..', 'test', 'fixtures', 'gtfs-rt');

    /// Décode une fixture BINAIRE : la structure protobuf réelle, avec ses
    /// valeurs par défaut servies par le prototype (leçon de 4F-1C).
    const depuisFixture = (nom: string) =>
      mapper(
        transit_realtime.FeedMessage.decode(
          new Uint8Array(readFileSync(join(TEXTES, nom))),
        ).entity[0],
      );

    it('retient le titre français parmi plusieurs langues', () => {
      // Le français est en TROISIÈME position dans la fixture : prendre le
      // premier venu donnerait l'anglais.
      const donnees = depuisFixture('texte-multilingue.pb');

      expect(donnees.headerText).toBe('Travaux sur la ligne A');
    });

    it('retient la description française parmi plusieurs langues', () => {
      const donnees = depuisFixture('texte-multilingue.pb');

      expect(donnees.descriptionText).toBe('Service réduit jusqu’à 14h.');
    });

    it('se replie sur la première traduction faute de français', () => {
      // Un texte dans une langue non demandée reste une information vraie,
      // écrite par l'opérateur : la cacher priverait le voyageur d'un
      // avertissement réel.
      const donnees = depuisFixture('texte-sans-francais.pb');

      expect(donnees.headerText).toBe('Works on line A');
      expect(donnees.descriptionText).toBe('Reduced service.');
    });

    it("accepte un flux monolingue dont la langue n'est pas déclarée", () => {
      // protobufjs rend "" pour un `language` non transmis : il ne doit ni
      // passer pour du français, ni faire écarter le texte.
      const donnees = depuisFixture('texte-sans-langue.pb');

      expect(donnees.headerText).toBe('Perturbation en cours');
    });

    it('accepte un titre sans description', () => {
      const donnees = depuisFixture('texte-header-seul.pb');

      expect(donnees.headerText).toBe('Ligne A interrompue');
      expect(donnees.descriptionText).toBeNull();
    });

    it('accepte une description sans titre', () => {
      const donnees = depuisFixture('texte-description-seule.pb');

      expect(donnees.headerText).toBeNull();
      expect(donnees.descriptionText).toBe('Un véhicule est immobilisé.');
    });

    it('rend null quand aucun texte n’est publié', () => {
      // import-nominal.pb porte un titre mais aucune description.
      const donnees = depuisFixture('import-texte-retire.pb');

      expect(donnees.headerText).toBeNull();
      expect(donnees.descriptionText).toBeNull();
    });

    it('rend null pour une liste de traductions vide ou blanche', () => {
      // Deux façons pour un flux de ne rien dire tout en remplissant le
      // champ : aucune traduction, ou une traduction faite d'espaces.
      const donnees = depuisFixture('texte-vide.pb');

      expect(donnees.headerText).toBeNull();
      expect(donnees.descriptionText).toBeNull();
    });

    it('ne fabrique JAMAIS un texte à partir de cause et effect', () => {
      // « MAINTENANCE » + « REDUCED_SERVICE » donnerait bien une phrase,
      // mais ce serait NOTRE phrase présentée comme celle de l'opérateur.
      const donnees = mapper(
        entite({
          cause: transit_realtime.Alert.Cause.MAINTENANCE,
          effect: transit_realtime.Alert.Effect.REDUCED_SERVICE,
        }),
      );

      expect(donnees.cause).toBe('MAINTENANCE');
      expect(donnees.headerText).toBeNull();
      expect(donnees.descriptionText).toBeNull();
    });

    it('supprime les espaces superflus autour du texte', () => {
      const donnees = mapper(
        entite({
          headerText: { translation: [{ text: '  Ligne A perturbée  ' }] },
        }),
      );

      expect(donnees.headerText).toBe('Ligne A perturbée');
    });

    it('ignore une traduction sans texte au profit de la suivante', () => {
      const donnees = mapper(
        entite({
          headerText: {
            translation: [
              { text: '', language: 'fr' },
              { text: 'Ligne A perturbée', language: 'en' },
            ],
          },
        }),
      );

      // Une traduction française VIDE ne vaut pas mieux que rien : c'est la
      // traduction anglaise, elle, qui informe.
      expect(donnees.headerText).toBe('Ligne A perturbée');
    });

    it('reconnaît le français quelle que soit la casse', () => {
      const donnees = mapper(
        entite({
          headerText: {
            translation: [
              { text: 'Line A disrupted', language: 'en' },
              { text: 'Ligne A perturbée', language: 'FR' },
            ],
          },
        }),
      );

      expect(donnees.headerText).toBe('Ligne A perturbée');
    });
  });

  // ---------------------------------------------------------------------------
  // Sur un message RÉELLEMENT DÉCODÉ
  // ---------------------------------------------------------------------------
  //
  // Tous les tests ci-dessus construisent des objets à la main. Ce n'est PAS
  // équivalent à un flux décodé, et l'écart a coûté un bug : protobufjs sert
  // les champs non transmis depuis le PROTOTYPE de la classe, avec la valeur
  // par défaut de la spécification. `end` non fourni ne vaut donc pas
  // `undefined` mais 0 — et `new Date(0)` donne le 1ᵉʳ janvier 1970.
  //
  // Le test e2e l'a attrapé ; ces deux tests-ci le verrouillent sans base de
  // données, pour que la régression tombe en une seconde et non en trente.
  describe('sur un flux décodé (et non un objet fabriqué)', () => {
    const FIXTURES = join(__dirname, '..', '..', 'test', 'fixtures', 'gtfs-rt');

    const decoder = (nom: string): transit_realtime.IFeedEntity =>
      transit_realtime.FeedMessage.decode(
        new Uint8Array(readFileSync(join(FIXTURES, nom))),
      ).entity[0];

    it('rend endTime null quand `end` est absent du binaire', () => {
      const donnees = mapper(decoder('import-modifie.pb'));

      // Sans la garde sur 0, cette alerte s'enregistrerait comme terminée
      // le 1ᵉʳ janvier 1970.
      expect(donnees.endTime).toBeNull();
      expect(donnees.startTime.getUTCFullYear()).toBe(2025);
    });

    it('lit correctement une période complète issue du binaire', () => {
      const donnees = mapper(decoder('import-nominal.pb'));

      expect(donnees.startTime).toEqual(new Date('2025-12-01T11:00:00.000Z'));
      expect(donnees.endTime).toEqual(new Date('2025-12-01T14:00:00.000Z'));
    });

    it('traite une sévérité non transmise comme UNKNOWN_SEVERITY', () => {
      // flux-sans-fin.pb ne porte aucun severityLevel : le prototype rend
      // la valeur par défaut de la spécification.
      const donnees = mapAlertEntity(
        decoder('flux-sans-fin.pb'),
        LOOKUP,
        report,
      );

      expect(donnees).toBeNull();
      expect(report.rejections.unknownSeverity).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Le rapport lui-même
  // ---------------------------------------------------------------------------
  describe("rapport d'import", () => {
    it('compte une alerte lue pour chaque entité porteuse', () => {
      mapAlertEntity(entite({}), LOOKUP, report);
      mapAlertEntity(
        { id: 'x', tripUpdate: { trip: { tripId: 'T' } } },
        LOOKUP,
        report,
      );

      expect(report.entities.alerts).toBe(1);
    });

    it('ne rejette jamais sans motif', () => {
      const cas: transit_realtime.IFeedEntity[] = [
        { id: 'a', tripUpdate: { trip: { tripId: 'T' } } },
        { ...entite({}), id: '' },
        entite({ activePeriod: [] }),
        entite({
          severityLevel: transit_realtime.Alert.SeverityLevel.UNKNOWN_SEVERITY,
        }),
        entite({ informedEntity: [] }),
      ];

      for (const c of cas) {
        expect(mapAlertEntity(c, LOOKUP, report)).toBeNull();
      }

      // Autant de motifs inscrits que de rejets : aucun rejet silencieux.
      const totalMotifs = Object.values(report.rejections).reduce(
        (somme, n) => somme + n,
        0,
      );
      expect(report.entities.rejected).toBe(cas.length);
      expect(totalMotifs).toBe(cas.length);
    });
  });
});
