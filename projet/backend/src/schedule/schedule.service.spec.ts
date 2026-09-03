import { PrismaService } from '../prisma/prisma.service';
import { ScheduleService } from './schedule.service';

// =============================================================================
// Ce que ces tests verrouillent
// =============================================================================
// Les trois règles de calendrier de GTFS, DANS LE BON ORDRE, et la distinction
// entre « aucun service » et « aucun calendrier ». Cette dernière est celle
// qui casse un déploiement entier quand on la manque : confondue, elle fait
// échouer toute recherche d'itinéraire sur un flux pourtant valide.
// =============================================================================

describe('ScheduleService', () => {
  // ⚠️ LES DOUBLES SONT TYPÉS PAR LEURS ARGUMENTS, et pas seulement par
  // `jest.Mock`. Sans le paramètre de type, `mock.calls[n][0]` vaut `any`, et
  // chaque assertion sur une requête Prisma devient un accès non sûr que le
  // linter refuse — à juste titre : une faute de frappe dans un nom de champ
  // ne serait alors détectée par rien.
  type Requete = { where: Record<string, unknown> };

  let prisma: {
    transitService: {
      findMany: jest.Mock<Promise<unknown[]>, [Requete]>;
      count: jest.Mock<Promise<number>, []>;
    };
    transitServiceException: {
      findMany: jest.Mock<Promise<unknown[]>, [Requete]>;
    };
    stopDeparture: {
      findMany: jest.Mock<Promise<unknown[]>, [Requete]>;
      count: jest.Mock<Promise<number>, []>;
    };
  };
  let service: ScheduleService;

  /// Jeudi 3 septembre 2026, 08 h 00 à Strasbourg.
  const JEUDI_8H = new Date('2026-09-03T06:00:00Z');

  beforeEach(() => {
    prisma = {
      transitService: {
        findMany: jest
          .fn<Promise<unknown[]>, [Requete]>()
          .mockResolvedValue([]),
        count: jest.fn<Promise<number>, []>().mockResolvedValue(0),
      },
      transitServiceException: {
        findMany: jest
          .fn<Promise<unknown[]>, [Requete]>()
          .mockResolvedValue([]),
      },
      stopDeparture: {
        findMany: jest
          .fn<Promise<unknown[]>, [Requete]>()
          .mockResolvedValue([]),
        count: jest.fn<Promise<number>, []>().mockResolvedValue(0),
      },
    };

    service = new ScheduleService(prisma as unknown as PrismaService);
  });

  describe('lignesActives', () => {
    it('rend `null` — « je ne sais pas » — quand AUCUN calendrier n’est importé', () => {
      // ⚠️ LE TEST LE PLUS IMPORTANT DU FICHIER. Rendre un ensemble vide
      // signifierait « aucune ligne ne circule », et le moteur refuserait
      // tout itinéraire. Un flux GTFS sans `calendar.txt` reste valide, et
      // doit continuer de fonctionner comme avant l'ajout des horaires.
      prisma.transitService.count.mockResolvedValue(0);

      return expect(service.lignesActives(JEUDI_8H)).resolves.toBeNull();
    });

    it('rend un ensemble VIDE quand le calendrier existe mais que rien ne circule', async () => {
      // Distinct du cas précédent : ici on SAIT, et la réponse est « aucune ».
      prisma.transitService.count.mockResolvedValue(77);

      const circulation = await service.lignesActives(JEUDI_8H);

      expect(circulation?.actives).toEqual(new Set());
    });

    it('DISTINGUE une ligne sans horaire d’une ligne qui ne circule pas', async () => {
      // ⚠️ LE TEST QUI A ÉTÉ ÉCRIT APRÈS UN BOGUE RÉEL, révélé par les tests
      // de bout en bout. La première version ne rendait que les lignes
      // actives, et le moteur écartait toutes les autres — y compris celles
      // qu'aucun `stop_times.txt` ne décrit, dont on ne sait donc RIEN.
      //
      // Un flux peut décrire une navette saisonnière sans lui donner
      // d'horaires : la faire disparaître du réseau amputerait le graphe
      // sans que rien ne le signale.
      prisma.transitService.count.mockResolvedValue(77);
      prisma.transitService.findMany.mockResolvedValue([{ id: 'semaine' }]);
      prisma.stopDeparture.findMany
        // La requête `distinct` des lignes horodatées.
        .mockResolvedValueOnce([{ lineId: 'tram-d' }, { lineId: 'bus-nuit' }])
        // Puis les lignes actives de chacun des deux jours de service.
        .mockResolvedValueOnce([{ lineId: 'tram-d' }])
        .mockResolvedValueOnce([]);

      const circulation = await service.lignesActives(JEUDI_8H);

      expect(circulation?.horodatees).toEqual(new Set(['tram-d', 'bus-nuit']));
      expect(circulation?.actives).toEqual(new Set(['tram-d']));

      // La navette sans horaire n'apparaît NULLE PART : ni active, ni
      // horodatée. C'est ce qui la laisse passer côté moteur.
      expect(circulation?.horodatees.has('navette-ete')).toBe(false);
    });

    it('interroge le jour courant ET la veille', async () => {
      prisma.transitService.count.mockResolvedValue(77);
      prisma.transitService.findMany.mockResolvedValue([{ id: 'svc-1' }]);
      prisma.stopDeparture.findMany
        // La requête `distinct` des lignes horodatées vient en premier.
        .mockResolvedValueOnce([{ lineId: 'tram-d' }, { lineId: 'bus-n3' }])
        .mockResolvedValueOnce([{ lineId: 'tram-d' }])
        .mockResolvedValueOnce([{ lineId: 'bus-n3' }]);

      const circulation = await service.lignesActives(JEUDI_8H);

      // La ligne de nuit vient du service de la VEILLE : elle circule encore
      // au petit matin. C'est exactement ce que la double interrogation
      // permet de voir.
      expect(circulation?.actives).toEqual(new Set(['tram-d', 'bus-n3']));
      expect(prisma.stopDeparture.findMany).toHaveBeenCalledTimes(3);
    });

    it('interroge la BONNE COLONNE de jour de semaine', async () => {
      prisma.transitService.count.mockResolvedValue(77);

      await service.lignesActives(JEUDI_8H);

      // Jeudi pour le jour courant, mercredi pour la veille.
      const premier = prisma.transitService.findMany.mock.calls[0][0];
      const second = prisma.transitService.findMany.mock.calls[1][0];

      expect(premier.where.thursday).toBe(true);
      expect(second.where.wednesday).toBe(true);
    });
  });

  describe('exceptions de calendrier', () => {
    beforeEach(() => {
      prisma.transitService.count.mockResolvedValue(77);
    });

    it('RETIRE un service qu’une exception supprime ce jour-là', async () => {
      // Le cas du jour férié : le service « Semaine » est régulier un jeudi,
      // mais le 14 juillet il ne roule pas.
      prisma.transitService.findMany.mockResolvedValue([
        { id: 'semaine' },
        { id: 'scolaire' },
      ]);
      prisma.transitServiceException.findMany.mockResolvedValue([
        { serviceId: 'scolaire', added: false },
      ]);

      await service.lignesActives(JEUDI_8H);

      // ⚠️ `calls[1]`, ET NON `calls[0]`. Le premier appel est la requête
      // `distinct` qui recense les lignes horodatées ; les suivants portent
      // sur les jours de service. Viser l'indice 0 vérifierait la mauvaise
      // requête, et le test passerait pour de mauvaises raisons.
      const requete = prisma.stopDeparture.findMany.mock.calls[1][0];

      expect(requete.where.serviceId.in).toEqual(['semaine']);
    });

    it('AJOUTE un service qu’une exception introduit, même hors calendrier régulier', async () => {
      // ⚠️ L'ORDRE DES RÈGLES GTFS. Un ajout l'emporte sur l'absence de règle
      // régulière : c'est ainsi qu'un réseau fait circuler son service
      // « dimanche » un 14 juillet tombant un mardi. Une implémentation qui
      // filtrerait d'abord les réguliers puis intersecterait les exceptions
      // raterait ce cas.
      prisma.transitService.findMany.mockResolvedValue([]);
      prisma.transitServiceException.findMany.mockResolvedValue([
        { serviceId: 'dimanche', added: true },
      ]);

      await service.lignesActives(JEUDI_8H);

      // ⚠️ `calls[1]`, ET NON `calls[0]`. Le premier appel est la requête
      // `distinct` qui recense les lignes horodatées ; les suivants portent
      // sur les jours de service. Viser l'indice 0 vérifierait la mauvaise
      // requête, et le test passerait pour de mauvaises raisons.
      const requete = prisma.stopDeparture.findMany.mock.calls[1][0];

      expect(requete.where.serviceId.in).toEqual(['dimanche']);
    });
  });

  describe('prochainsPassages', () => {
    beforeEach(() => {
      prisma.transitService.count.mockResolvedValue(77);
      prisma.transitService.findMany.mockResolvedValue([{ id: 'semaine' }]);
    });

    const passage = (departureSec: number, name = 'D') => ({
      lineId: `tram-${name.toLowerCase()}`,
      headsign: 'Poteries',
      departureSec,
      line: { name, mode: 'TRAM' },
    });

    it('calcule l’attente À PARTIR DE L’INSTANT DEMANDÉ', async () => {
      // 08:00 demandé, passage à 08:06 → six minutes.
      prisma.stopDeparture.findMany.mockResolvedValueOnce([
        passage(8 * 3600 + 6 * 60),
      ]);

      const passages = await service.prochainsPassages(
        ['arret-1'],
        JEUDI_8H,
        5,
      );

      expect(passages[0].waitMin).toBe(6);
      expect(passages[0].lineName).toBe('D');
      expect(passages[0].headsign).toBe('Poteries');
    });

    it('ARRONDIT L’ATTENTE VERS LE BAS', async () => {
      // Passage à 08:06:50 → « dans 6 min », pas 7. L'erreur n'est pas
      // symétrique : arrondir au-dessus fait rater le tram.
      prisma.stopDeparture.findMany.mockResolvedValueOnce([
        passage(8 * 3600 + 6 * 60 + 50),
      ]);

      const passages = await service.prochainsPassages(
        ['arret-1'],
        JEUDI_8H,
        5,
      );

      expect(passages[0].waitMin).toBe(6);
    });

    it('rend un INSTANT ABSOLU, et non une heure formatée', async () => {
      prisma.stopDeparture.findMany.mockResolvedValueOnce([
        passage(8 * 3600 + 10 * 60),
      ]);

      const passages = await service.prochainsPassages(
        ['arret-1'],
        JEUDI_8H,
        5,
      );

      expect(passages[0].departureAt.toISOString()).toBe(
        '2026-09-03T06:10:00.000Z',
      );
    });

    it('RETRIE les passages des deux jours de service ensemble', async () => {
      // ⚠️ LE PIÈGE. Les deux jours sont interrogés séparément : concaténés
      // sans retri, un passage de la veille à 24 h 10 précéderait un passage
      // du jour à 00 h 05.
      prisma.stopDeparture.findMany
        .mockResolvedValueOnce([passage(8 * 3600 + 20 * 60, 'C')])
        .mockResolvedValueOnce([passage(32 * 3600 + 5 * 60, 'B')]);

      const passages = await service.prochainsPassages(
        ['arret-1'],
        JEUDI_8H,
        5,
      );

      // Le service de la veille place ce passage à 08:05, avant celui de
      // 08:20 du jour courant.
      expect(passages.map((p) => p.lineName)).toEqual(['B', 'C']);
    });

    it('respecte la LIMITE après le retri, pas avant', async () => {
      prisma.stopDeparture.findMany
        .mockResolvedValueOnce([
          passage(8 * 3600 + 20 * 60, 'C'),
          passage(8 * 3600 + 30 * 60, 'E'),
        ])
        .mockResolvedValueOnce([passage(32 * 3600 + 5 * 60, 'B')]);

      const passages = await service.prochainsPassages(
        ['arret-1'],
        JEUDI_8H,
        2,
      );

      expect(passages.map((p) => p.lineName)).toEqual(['B', 'C']);
    });

    it('ne cherche PAS au-delà de l’horizon', async () => {
      await service.prochainsPassages(['arret-1'], JEUDI_8H, 5);

      const requete = prisma.stopDeparture.findMany.mock.calls[0][0];

      expect(requete.where.departureSec.gte).toBe(8 * 3600);
      expect(requete.where.departureSec.lte).toBe(8 * 3600 + 3 * 3600);
    });

    it('rend une liste vide SANS INTERROGER LA BASE si aucun arrêt n’est demandé', async () => {
      const passages = await service.prochainsPassages([], JEUDI_8H, 5);

      expect(passages).toEqual([]);
      expect(prisma.stopDeparture.findMany).not.toHaveBeenCalled();
    });
  });

  describe('attenteAvantLigne', () => {
    beforeEach(() => {
      prisma.transitService.count.mockResolvedValue(77);
      prisma.transitService.findMany.mockResolvedValue([{ id: 'semaine' }]);
    });

    it('rend `null` — ET NON ZÉRO — quand aucun passage n’est connu', async () => {
      // ⚠️ Zéro signifierait « le véhicule est là ». C'est le mensonge le
      // plus coûteux possible sur cet écran : l'usager court vers un quai
      // vide. `null` fait afficher « attente inconnue ».
      const attente = await service.attenteAvantLigne(
        ['arret-1'],
        'tram-d',
        JEUDI_8H,
      );

      expect(attente).toBeNull();
    });

    it('restreint la recherche À LA LIGNE demandée', async () => {
      await service.attenteAvantLigne(['arret-1'], 'tram-d', JEUDI_8H);

      const requete = prisma.stopDeparture.findMany.mock.calls[0][0];

      expect(requete.where.lineId.in).toEqual(['tram-d']);
    });
  });
});
