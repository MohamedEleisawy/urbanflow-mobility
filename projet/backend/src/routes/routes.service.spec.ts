import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CarbonService } from '../carbon/carbon.service';
import { CarbonResultDto } from '../carbon/dto/carbon-result.dto';
import { RoutesService } from './routes.service';
import { CreateRouteDto } from './dto/create-route.dto';

// Le test du breakdown incohérent provoque VOLONTAIREMENT une erreur
// journalisée : l'afficher laisserait croire à un échec dans une suite verte.
beforeAll(() => {
  Logger.overrideLogger(false);
});

// Même approche que pour UsersService : PrismaService est simulé, seules
// les méthodes réellement utilisées sont mockées. Ce sont des tests
// unitaires, pas des tests d'intégration.
describe('RoutesService', () => {
  let service: RoutesService;
  let prisma: {
    route: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      delete: jest.Mock;
    };
    stop: { findMany: jest.Mock };
    // networkLink = le réseau public, seule source du graphe depuis 4C-3,
    // et source des données fiables à l'enregistrement depuis 4E-3B.
    networkLink: { findMany: jest.Mock };
    // segment.findMany reste simulé UNIQUEMENT pour prouver, dans les tests
    // d'isolation, que la RECHERCHE ne l'interroge JAMAIS.
    segment: { findMany: jest.Mock; createMany: jest.Mock };
    carbonRecord: { createMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let carbonService: { calculate: jest.Mock };

  const MOI = 'user-1';
  const QUELQU_UN_DAUTRE = 'user-2';

  // ---------------------------------------------------------------------------
  // Réseau de test pour l'enregistrement (étape 4E-3B)
  //
  //   stop-a ──À pied / 600 m / 10 min──> stop-b ──38 / 3200 m / 12 min──> stop-c
  //
  // Les deux lignes ont un NOM et un EXPLOITANT différents : c'est ce qui
  // permet de prouver que chaque segment reçoit bien les valeurs de SA
  // liaison, et non celles d'une autre ou une constante.
  // ---------------------------------------------------------------------------
  const liaisonAB = {
    id: 'link-ab',
    lineId: 'ligne-marche',
    fromStopId: 'stop-a',
    toStopId: 'stop-b',
    distanceM: 600,
    durationMin: 10,
    line: {
      id: 'ligne-marche',
      name: 'À pied',
      mode: 'WALK',
      operator: 'RATP',
    },
  };
  const liaisonBC = {
    id: 'link-bc',
    lineId: 'ligne-bus',
    fromStopId: 'stop-b',
    toStopId: 'stop-c',
    distanceM: 3200,
    durationMin: 12,
    line: { id: 'ligne-bus', name: '38', mode: 'BUS', operator: 'Transdev' },
  };

  // Le client ne DÉCRIT pas ses segments, il les DÉSIGNE.
  const dtoCreation: CreateRouteDto = {
    originLat: 48.8566,
    originLng: 2.3522,
    destinationLat: 48.8738,
    destinationLng: 2.295,
    segments: [
      { lineId: 'ligne-marche', fromStopId: 'stop-a', toStopId: 'stop-b' },
      { lineId: 'ligne-bus', fromStopId: 'stop-b', toStopId: 'stop-c' },
    ],
  };

  // Résultat carbone tel que mesuré à l'étape 4D-1 pour 600 m à pied puis
  // 3200 m en bus. Les valeurs sont vérifiables de tête :
  //   3,2 km x 113 = 361,6   |   3,8 km x 218 = 828,4   |   466,8 / 828,4 = 56,3 %
  const RESULTAT_CARBONE: CarbonResultDto = {
    totalDistanceM: 3800,
    totalCo2Grams: 361.6,
    carCo2Grams: 828.4,
    savedVsCarGrams: 466.8,
    ecoScore: 56.3,
    breakdown: [
      { mode: 'WALK', distanceM: 600, co2Grams: 0 },
      { mode: 'BUS', distanceM: 3200, co2Grams: 361.6 },
    ],
  };

  const routeCreee = { id: 'route-1' };
  const maRoute = {
    id: 'route-1',
    originLat: 48.8566,
    originLng: 2.3522,
    destinationLat: 48.8738,
    destinationLng: 2.295,
    totalDurationMin: 22,
    totalDistanceM: 3800,
    ecoScore: 56.3,
    carbonEstimate: 361.6,
    userId: MOI,
  };

  // Raccourcis de lecture des arguments réellement envoyés à Prisma.
  //
  // Ils sont TYPÉS : `mock.calls[0][0]` vaut `any`, et le laisser tel quel
  // ferait perdre toute vérification dans les assertions — une faute de
  // frappe sur un nom de champ passerait inaperçue.
  interface DonneesRoute {
    requestedAt: Date;
    totalDistanceM: number;
    totalDurationMin: number;
    carbonEstimate: number;
    ecoScore: number;
    userId: string;
  }
  interface DonneesSegment {
    mode: string;
    operator: string;
    line: string;
    distanceM: number;
    fromStopId: string;
    toStopId: string;
    departureTime: Date;
    arrivalTime: Date;
    routeId: string;
  }
  interface DonneesCarbone {
    date: Date;
    mode: string;
    distanceM: number;
    co2Grams: number;
    savedVsCarGrams: number;
    userId: string;
    routeId: string;
  }

  // `mock.calls` est un `any[]` : on le type AVANT de l'indexer, sinon
  // chaque accès resterait non vérifié.
  const premierAppel = <T>(mock: jest.Mock): T =>
    (mock.mock.calls as [{ data: T }][])[0][0].data;

  const donneesRoute = () => premierAppel<DonneesRoute>(prisma.route.create);
  const donneesSegments = () =>
    premierAppel<DonneesSegment[]>(prisma.segment.createMany);
  const donneesCarbone = () =>
    premierAppel<DonneesCarbone[]>(prisma.carbonRecord.createMany);

  beforeEach(() => {
    prisma = {
      route: {
        create: jest.fn().mockResolvedValue(routeCreee),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn().mockResolvedValue(maRoute),
        delete: jest.fn(),
      },
      stop: { findMany: jest.fn() },
      networkLink: { findMany: jest.fn() },
      segment: { findMany: jest.fn(), createMany: jest.fn() },
      carbonRecord: { createMany: jest.fn() },
      // La transaction est simulée en exécutant simplement son contenu : ces
      // tests vérifient CE QUI est écrit, pas l'atomicité elle-même — qui ne
      // peut se prouver que sur une vraie base (étape 4E-3C).
      $transaction: jest.fn((rappel: (tx: unknown) => unknown) =>
        rappel(prisma),
      ),
    };
    carbonService = {
      calculate: jest.fn().mockResolvedValue(RESULTAT_CARBONE),
    };

    service = new RoutesService(
      prisma as unknown as PrismaService,
      carbonService as unknown as CarbonService,
    );
  });

  describe('create', () => {
    beforeEach(() => {
      prisma.networkLink.findMany.mockResolvedValue([liaisonAB, liaisonBC]);
    });

    // -------------------------------------------------------------------------
    // Création nominale
    // -------------------------------------------------------------------------
    it("attache l'itinéraire à l'usager du JWT", async () => {
      await service.create(MOI, dtoCreation);

      // userId vient du token, jamais du corps de la requête.
      expect(donneesRoute().userId).toBe(MOI);
    });

    it('charge les liaisons demandées en UNE seule requête', async () => {
      await service.create(MOI, dtoCreation);

      // Une requête par segment serait le N+1 classique.
      expect(prisma.networkLink.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.networkLink.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            {
              lineId: 'ligne-marche',
              fromStopId: 'stop-a',
              toStopId: 'stop-b',
            },
            { lineId: 'ligne-bus', fromStopId: 'stop-b', toStopId: 'stop-c' },
          ],
        },
        include: { line: true },
      });
    });

    it('renvoie la route relue AVEC ses segments, dans l’ordre', async () => {
      const resultat = await service.create(MOI, dtoCreation);

      expect(prisma.route.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 'route-1' },
        include: { segments: { orderBy: { departureTime: 'asc' } } },
      });
      expect(resultat).toEqual(maRoute);
    });

    // -------------------------------------------------------------------------
    // Les données viennent du RÉSEAU, jamais du client
    // -------------------------------------------------------------------------
    it('reprend mode, exploitant, ligne et distance depuis NetworkLink', async () => {
      await service.create(MOI, dtoCreation);

      expect(donneesSegments()).toHaveLength(2);
      expect(donneesSegments()[0]).toMatchObject({
        mode: 'WALK',
        operator: 'RATP',
        line: 'À pied',
        distanceM: 600,
        fromStopId: 'stop-a',
        toStopId: 'stop-b',
        routeId: 'route-1',
      });
      expect(donneesSegments()[1]).toMatchObject({
        mode: 'BUS',
        operator: 'Transdev',
        line: '38',
        distanceM: 3200,
        fromStopId: 'stop-b',
        toStopId: 'stop-c',
      });
    });

    it('calcule lui-même les totaux, sans les demander au client', async () => {
      await service.create(MOI, dtoCreation);

      expect(donneesRoute().totalDistanceM).toBe(3800); // 600 + 3200
      expect(donneesRoute().totalDurationMin).toBe(22); // 10 + 12
    });

    it("n'écrit AUCUNE valeur qui viendrait du corps de la requête", async () => {
      // Le client tente d'imposer ses propres chiffres. Le DTO ne les
      // déclare pas : à supposer qu'ils franchissent la validation, ils ne
      // doivent atteindre la base sous aucune forme.
      const tentative = {
        ...dtoCreation,
        distanceM: 99,
        totalDistanceM: 99,
        ecoScore: 100,
        carbonEstimate: 0,
      } as CreateRouteDto;

      await service.create(MOI, tentative);

      expect(donneesRoute().totalDistanceM).toBe(3800);
      expect(donneesRoute().ecoScore).toBe(56.3);
      expect(donneesRoute().carbonEstimate).toBe(361.6);
      expect(donneesSegments()[0].distanceM).toBe(600);
    });

    it('ne renseigne PAS gtfsTripId, qui restera donc null', async () => {
      await service.create(MOI, dtoCreation);

      // Un itinéraire calculé sur des liaisons AGRÉGÉES ne correspond à
      // aucun passage GTFS précis (étapes 4C-4-4 et 4E-1).
      expect(donneesSegments()[0]).not.toHaveProperty('gtfsTripId');
      expect(donneesSegments()[1]).not.toHaveProperty('gtfsTripId');
    });

    // -------------------------------------------------------------------------
    // Intégrité du trajet
    // -------------------------------------------------------------------------
    it('refuse un segment qui ne correspond à aucune liaison', async () => {
      prisma.networkLink.findMany.mockResolvedValue([liaisonAB]);

      await expect(service.create(MOI, dtoCreation)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuse un trajet interrompu', async () => {
      const liaisonIsolee = {
        ...liaisonBC,
        id: 'link-de',
        lineId: 'ligne-autre',
        fromStopId: 'stop-d',
        toStopId: 'stop-e',
        line: { ...liaisonBC.line, id: 'ligne-autre' },
      };
      prisma.networkLink.findMany.mockResolvedValue([liaisonAB, liaisonIsolee]);

      // A → B puis D → E : on ne se téléporte pas de B à D.
      await expect(
        service.create(MOI, {
          ...dtoCreation,
          segments: [
            dtoCreation.segments[0],
            { lineId: 'ligne-autre', fromStopId: 'stop-d', toStopId: 'stop-e' },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("n'appelle PAS le service carbone quand le réseau est invalide", async () => {
      prisma.networkLink.findMany.mockResolvedValue([]);

      await expect(service.create(MOI, dtoCreation)).rejects.toThrow(
        BadRequestException,
      );

      // Une requête invalide ne doit rien coûter au microservice, et
      // surtout ne rien écrire en base.
      expect(carbonService.calculate).not.toHaveBeenCalled();
      expect(prisma.route.create).not.toHaveBeenCalled();
    });

    it('associe correctement un triplet répété deux fois', async () => {
      // Un aller-retour A→B→A→B est un trajet valide et cohérent : le même
      // triplet y apparaît deux fois. L'indexation ne doit pas le perdre.
      const retourBA = {
        ...liaisonAB,
        id: 'link-ba',
        fromStopId: 'stop-b',
        toStopId: 'stop-a',
      };
      prisma.networkLink.findMany.mockResolvedValue([liaisonAB, retourBA]);
      // Trois segments demandés, donc trois entrées de breakdown : le
      // garde-fou de taille l'exige, et il a raison.
      carbonService.calculate.mockResolvedValue({
        ...RESULTAT_CARBONE,
        breakdown: [
          { mode: 'WALK', distanceM: 600, co2Grams: 0 },
          { mode: 'WALK', distanceM: 600, co2Grams: 0 },
          { mode: 'WALK', distanceM: 600, co2Grams: 0 },
        ],
      });

      await service.create(MOI, {
        ...dtoCreation,
        segments: [
          { lineId: 'ligne-marche', fromStopId: 'stop-a', toStopId: 'stop-b' },
          { lineId: 'ligne-marche', fromStopId: 'stop-b', toStopId: 'stop-a' },
          { lineId: 'ligne-marche', fromStopId: 'stop-a', toStopId: 'stop-b' },
        ],
      });

      expect(donneesSegments()).toHaveLength(3);
      expect(donneesSegments().map((s) => s.toStopId)).toEqual([
        'stop-b',
        'stop-a',
        'stop-b',
      ]);
    });

    // -------------------------------------------------------------------------
    // Horaires estimés
    // -------------------------------------------------------------------------
    it('enchaîne les horaires depuis requestedAt', async () => {
      await service.create(MOI, dtoCreation);

      const depart = donneesRoute().requestedAt;
      const [premier, second] = donneesSegments();

      // Le premier segment part à l'instant de l'enregistrement...
      expect(premier.departureTime).toEqual(depart);
      // ...arrive 10 minutes plus tard (durée du réseau)...
      expect(
        premier.arrivalTime.getTime() - premier.departureTime.getTime(),
      ).toBe(10 * 60_000);
      // ...et le suivant repart EXACTEMENT à cette arrivée.
      expect(second.departureTime).toEqual(premier.arrivalTime);
      expect(
        second.arrivalTime.getTime() - second.departureTime.getTime(),
      ).toBe(12 * 60_000);
      // Durée totale du trajet = somme des durées du réseau.
      expect(second.arrivalTime.getTime() - depart.getTime()).toBe(22 * 60_000);
    });

    // -------------------------------------------------------------------------
    // Calcul carbone
    // -------------------------------------------------------------------------
    it("n'envoie au service carbone que le mode et la distance du RÉSEAU", async () => {
      await service.create(MOI, dtoCreation);

      expect(carbonService.calculate).toHaveBeenCalledTimes(1);
      expect(carbonService.calculate).toHaveBeenCalledWith({
        segments: [
          { mode: 'WALK', distanceM: 600 },
          { mode: 'BUS', distanceM: 3200 },
        ],
      });
    });

    it('écrit les valeurs carbone renvoyées par le service', async () => {
      await service.create(MOI, dtoCreation);

      expect(donneesRoute().carbonEstimate).toBe(361.6);
      expect(donneesRoute().ecoScore).toBe(56.3);
    });

    // -------------------------------------------------------------------------
    // CarbonRecord
    // -------------------------------------------------------------------------
    it('crée un enregistrement carbone PAR segment', async () => {
      await service.create(MOI, dtoCreation);

      expect(donneesCarbone()).toHaveLength(2);
      expect(donneesCarbone().map((c) => [c.routeId, c.userId])).toEqual([
        ['route-1', MOI],
        ['route-1', MOI],
      ]);
    });

    it('respecte l’ordre breakdown[i] ↔ segment[i]', async () => {
      await service.create(MOI, dtoCreation);

      // Une inversion associerait les 361,6 g du bus au segment à pied.
      expect(donneesCarbone()[0]).toMatchObject({
        mode: 'WALK',
        distanceM: 600,
        co2Grams: 0,
      });
      expect(donneesCarbone()[1]).toMatchObject({
        mode: 'BUS',
        distanceM: 3200,
        co2Grams: 361.6,
      });
    });

    it('refuse un breakdown de taille incohérente', async () => {
      // L'appariement est positionnel : si le microservice renvoyait un
      // nombre d'entrées différent, associer au hasard serait pire que
      // s'arrêter.
      carbonService.calculate.mockResolvedValue({
        ...RESULTAT_CARBONE,
        breakdown: [RESULTAT_CARBONE.breakdown[0]],
      });

      await expect(service.create(MOI, dtoCreation)).rejects.toThrow(
        /indisponible/,
      );
      expect(prisma.route.create).not.toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    // Répartition de l'économie
    // -------------------------------------------------------------------------
    it('répartit savedVsCarGrams proportionnellement à la distance', async () => {
      await service.create(MOI, dtoCreation);

      // Référence voiture du segment = 828,4 x (distance / 3800).
      //   à pied : 828,4 x 600/3800  = 130,8  →  130,8 - 0     = 130,8
      //   bus    : 828,4 x 3200/3800 = 697,6  →  697,6 - 361,6 = 336,0
      expect(donneesCarbone()[0].savedVsCarGrams).toBeCloseTo(130.8, 2);
      expect(donneesCarbone()[1].savedVsCarGrams).toBeCloseTo(336.0, 2);
    });

    it('la somme des économies retrouve le total du service carbone', async () => {
      await service.create(MOI, dtoCreation);

      const somme = donneesCarbone().reduce(
        (total, c) => total + c.savedVsCarGrams,
        0,
      );

      // Tolérance : les co2Grams du breakdown sont déjà arrondis à deux
      // décimales par le microservice, la somme peut donc s'écarter du
      // total de quelques centièmes.
      expect(somme).toBeCloseTo(RESULTAT_CARBONE.savedVsCarGrams, 1);
    });

    it('donne une économie nulle quand la distance totale est nulle', async () => {
      // Évite surtout la division par zéro : sans distance, aucune voiture
      // à comparer, donc aucune économie.
      const liaisonNulle = { ...liaisonAB, distanceM: 0, durationMin: 0 };
      prisma.networkLink.findMany.mockResolvedValue([liaisonNulle]);
      carbonService.calculate.mockResolvedValue({
        totalDistanceM: 0,
        totalCo2Grams: 0,
        carCo2Grams: 0,
        savedVsCarGrams: 0,
        ecoScore: 100,
        breakdown: [{ mode: 'WALK', distanceM: 0, co2Grams: 0 }],
      });

      await service.create(MOI, {
        ...dtoCreation,
        segments: [dtoCreation.segments[0]],
      });

      expect(donneesCarbone()[0].savedVsCarGrams).toBe(0);
    });

    // -------------------------------------------------------------------------
    // Un seul instant pour tout l'enregistrement
    // -------------------------------------------------------------------------
    it('horodate la route et son carbone au MÊME instant', async () => {
      await service.create(MOI, dtoCreation);

      const requestedAt = donneesRoute().requestedAt;

      for (const enregistrement of donneesCarbone()) {
        // Égalité d'instant ET d'objet : les @default(now()) de Prisma
        // auraient produit des dates distinctes de quelques millisecondes.
        expect(enregistrement.date).toBe(requestedAt);
      }
    });

    // -------------------------------------------------------------------------
    // Atomicité
    // -------------------------------------------------------------------------
    it('écrit route, segments et carbone dans UNE transaction', async () => {
      await service.create(MOI, dtoCreation);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('appelle le service carbone AVANT d’ouvrir la transaction', async () => {
      const ordre: string[] = [];
      carbonService.calculate.mockImplementation(() => {
        ordre.push('carbone');
        return Promise.resolve(RESULTAT_CARBONE);
      });
      prisma.$transaction.mockImplementation(
        (rappel: (tx: unknown) => unknown) => {
          ordre.push('transaction');
          return rappel(prisma);
        },
      );

      await service.create(MOI, dtoCreation);

      // Un appel HTTP dans une transaction tiendrait des verrous PostgreSQL
      // ouverts pendant toute sa durée.
      expect(ordre).toEqual(['carbone', 'transaction']);
    });
  });

  describe('findAllForUser', () => {
    it("ne demande à Prisma que les itinéraires de l'usager", async () => {
      prisma.route.findMany.mockResolvedValue([maRoute]);

      const result = await service.findAllForUser(MOI);

      expect(prisma.route.findMany).toHaveBeenCalledWith({
        where: { userId: MOI },
        orderBy: { requestedAt: 'desc' },
      });
      expect(result).toEqual([maRoute]);
    });
  });

  describe('findOneForUser', () => {
    it("renvoie l'itinéraire quand il appartient à l'usager", async () => {
      prisma.route.findUnique.mockResolvedValue(maRoute);

      await expect(service.findOneForUser('route-1', MOI)).resolves.toEqual(
        maRoute,
      );
    });

    it("lève 404 quand l'itinéraire n'existe pas", async () => {
      prisma.route.findUnique.mockResolvedValue(null);

      await expect(
        service.findOneForUser('route-inexistante', MOI),
      ).rejects.toThrow(NotFoundException);
    });

    it("lève 404 (et non 403) quand l'itinéraire appartient à un autre usager", async () => {
      // L'itinéraire existe bel et bien en base, mais pas pour moi :
      // on ne doit pas révéler son existence.
      prisma.route.findUnique.mockResolvedValue({
        ...maRoute,
        userId: QUELQU_UN_DAUTRE,
      });

      await expect(service.findOneForUser('route-1', MOI)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it("supprime l'itinéraire quand il appartient à l'usager", async () => {
      prisma.route.findUnique.mockResolvedValue(maRoute);
      prisma.route.delete.mockResolvedValue(maRoute);

      await service.remove('route-1', MOI);

      expect(prisma.route.delete).toHaveBeenCalledWith({
        where: { id: 'route-1' },
      });
    });

    it("lève 404 et NE SUPPRIME RIEN si l'itinéraire appartient à un autre usager", async () => {
      prisma.route.findUnique.mockResolvedValue({
        ...maRoute,
        userId: QUELQU_UN_DAUTRE,
      });

      await expect(service.remove('route-1', MOI)).rejects.toThrow(
        NotFoundException,
      );
      // Le point le plus important de ce test : aucun DELETE n'a été envoyé.
      expect(prisma.route.delete).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Recherche d'itinéraire (étape 4C-1)
  // ---------------------------------------------------------------------------
  describe('searchRoutes', () => {
    // Petit réseau de test :
    //
    //        A ──WALK 600 m / 10 min──> B ──BUS 3200 m / 10 min──> C
    //        └──────────── BUS 3000 m / 30 min ───────────────────>┘
    //        D (isolé, aucun segment)
    //
    // Donc : le plus RAPIDE = A→B→C (20 min, 3800 m)
    //        le plus COURT  = A→C   (30 min, 3000 m)
    const A = {
      id: 'stop-a',
      name: 'Gare du Nord',
      latitude: 48.8809,
      longitude: 2.3553,
      pmrAccessible: true,
      operatorCode: 'RATP',
    };
    const B = {
      id: 'stop-b',
      name: 'Magenta',
      latitude: 48.877,
      longitude: 2.359,
      pmrAccessible: false,
      operatorCode: 'RATP',
    };
    const C = {
      id: 'stop-c',
      name: 'Chatelet',
      latitude: 48.8583,
      longitude: 2.347,
      pmrAccessible: true,
      operatorCode: 'RATP',
    };
    const D = {
      id: 'stop-d',
      name: 'Arret isole',
      latitude: 48.95,
      longitude: 2.45,
      pmrAccessible: false,
      operatorCode: 'RATP',
    };

    // Fabrique une liaison du réseau public.
    //   - depuis 4C-3, la durée est une donnée directe (durationMin) ;
    //   - depuis 4C-4-1, le mode est porté par la LIGNE, d'où l'objet
    //     `line` imbriqué qui reproduit ce que renvoie `include: { line }`.
    const segment = (
      fromStopId: string,
      toStopId: string,
      mode: 'WALK' | 'BUS' | 'METRO',
      distanceM: number,
      durationMin: number,
      lineId = 'ligne-1',
      // Depuis 4E-2, le nom et l'exploitant sont paramétrables, et
      // VOLONTAIREMENT différents d'une liaison à l'autre ci-dessous.
      //
      // Avec « Ligne de test » partout, un test ne pourrait pas distinguer
      // « la BONNE ligne est transmise » de « UNE ligne est transmise » :
      // intervertir deux segments passerait inaperçu.
      nomLigne = 'Ligne de test',
      exploitant = 'RATP',
    ) => ({
      fromStopId,
      toStopId,
      distanceM,
      durationMin,
      lineId,
      line: { id: lineId, name: nomLigne, mode, operator: exploitant },
    });

    const aVersB = segment(
      A.id,
      B.id,
      'WALK',
      600,
      10,
      'ligne-marche',
      'À pied',
      'RATP',
    );
    const bVersC = segment(
      B.id,
      C.id,
      'BUS',
      3200,
      10,
      'ligne-bus',
      '38',
      'RATP',
    );
    // Exploitant différent : prouve que l'opérateur suit bien SA ligne et
    // n'est pas une constante recopiée d'ailleurs.
    const aVersC = segment(
      A.id,
      C.id,
      'BUS',
      3000,
      30,
      'ligne-express',
      '350',
      'Transdev',
    );
    const aVersCMetro = segment(
      A.id,
      C.id,
      'METRO',
      2800,
      8,
      'ligne-metro',
      '4',
      'RATP',
    );

    // Coordonnées de recherche : volontairement décalées de quelques mètres
    // pour prouver que le service retrouve bien l'arrêt LE PLUS PROCHE.
    const depuisA = { fromLat: 48.8807, fromLon: 2.3551 };
    const versC = { toLat: 48.8585, toLon: 2.3472 };

    it('renvoie un itinéraire direct quand un seul segment relie les deux arrêts', async () => {
      prisma.stop.findMany.mockResolvedValue([A, C]);
      prisma.networkLink.findMany.mockResolvedValue([aVersC]);

      const result = await service.searchRoutes({ ...depuisA, ...versC });

      // Le plus rapide et le plus court sont ici le même trajet : on ne le
      // renvoie qu'une fois.
      expect(result).toHaveLength(1);
      expect(result[0].segments).toHaveLength(1);
      expect(result[0].segments[0]).toMatchObject({
        fromStopId: A.id,
        fromStopName: 'Gare du Nord',
        toStopId: C.id,
        toStopName: 'Chatelet',
        mode: 'BUS',
        distanceM: 3000,
        durationMin: 30,
      });
      expect(result[0].totalDistanceM).toBe(3000);
      expect(result[0].totalDurationMin).toBe(30);
    });

    it('enchaîne deux segments quand il n’existe pas de liaison directe', async () => {
      prisma.stop.findMany.mockResolvedValue([A, B, C]);
      prisma.networkLink.findMany.mockResolvedValue([aVersB, bVersC]);

      const result = await service.searchRoutes({ ...depuisA, ...versC });

      expect(result).toHaveLength(1);
      expect(result[0].segments).toHaveLength(2);
      expect(result[0].segments.map((s) => s.toStopName)).toEqual([
        'Magenta',
        'Chatelet',
      ]);
      // Les totaux sont bien la somme des segments.
      expect(result[0].totalDistanceM).toBe(3800);
      expect(result[0].totalDurationMin).toBe(20);
    });

    it('propose deux itinéraires distincts : le plus rapide et le plus court', async () => {
      prisma.stop.findMany.mockResolvedValue([A, B, C]);
      prisma.networkLink.findMany.mockResolvedValue([aVersB, bVersC, aVersC]);

      const result = await service.searchRoutes({ ...depuisA, ...versC });

      expect(result).toHaveLength(2);

      const rapide = result.find((i) => i.criterion === 'FASTEST');
      const court = result.find((i) => i.criterion === 'SHORTEST');

      // Le plus rapide passe par B : 20 min au lieu de 30.
      expect(rapide?.totalDurationMin).toBe(20);
      expect(rapide?.totalDistanceM).toBe(3800);
      expect(rapide?.segments).toHaveLength(2);

      // Le plus court est le trajet direct : 3000 m au lieu de 3800.
      expect(court?.totalDistanceM).toBe(3000);
      expect(court?.totalDurationMin).toBe(30);
      expect(court?.segments).toHaveLength(1);
    });

    it("renvoie [] quand l'arrivée n'est reliée à rien", async () => {
      prisma.stop.findMany.mockResolvedValue([A, B, C, D]);
      prisma.networkLink.findMany.mockResolvedValue([aVersB, bVersC]);

      // On cherche vers D, qui n'a aucun segment entrant.
      const result = await service.searchRoutes({
        ...depuisA,
        toLat: D.latitude,
        toLon: D.longitude,
      });

      expect(result).toEqual([]);
    });

    it('renvoie [] quand la base ne contient aucun arrêt', async () => {
      prisma.stop.findMany.mockResolvedValue([]);
      prisma.networkLink.findMany.mockResolvedValue([]);

      const result = await service.searchRoutes({ ...depuisA, ...versC });

      expect(result).toEqual([]);
    });

    it('renvoie [] quand le départ et l’arrivée pointent vers le même arrêt', async () => {
      prisma.stop.findMany.mockResolvedValue([A, C]);
      prisma.networkLink.findMany.mockResolvedValue([aVersC]);

      const result = await service.searchRoutes({
        fromLat: A.latitude,
        fromLon: A.longitude,
        toLat: A.latitude,
        toLon: A.longitude,
      });

      expect(result).toEqual([]);
    });

    it('ne renvoie jamais de données personnelles (ni routeId, ni userId, ni horaires)', async () => {
      prisma.stop.findMany.mockResolvedValue([A, C]);
      prisma.networkLink.findMany.mockResolvedValue([aVersC]);

      const result = await service.searchRoutes({ ...depuisA, ...versC });

      const json = JSON.stringify(result);
      expect(json).not.toContain('routeId');
      expect(json).not.toContain('userId');
      expect(json).not.toContain('departureTime');
      expect(json).not.toContain('arrivalTime');
    });

    // -------------------------------------------------------------------------
    // Étape 4E-3A : identifiant de la liaison choisie
    // -------------------------------------------------------------------------

    it('expose le lineId de la ligne empruntée', async () => {
      prisma.stop.findMany.mockResolvedValue([A, C]);
      prisma.networkLink.findMany.mockResolvedValue([aVersC]);

      const [itineraire] = await service.searchRoutes({
        ...depuisA,
        ...versC,
      });

      expect(itineraire.segments[0].lineId).toBe('ligne-express');
    });

    it('expose un lineId AUSSI pour la marche', async () => {
      prisma.stop.findMany.mockResolvedValue([A, B]);
      prisma.networkLink.findMany.mockResolvedValue([aVersB]);

      const [itineraire] = await service.searchRoutes({
        ...depuisA,
        toLat: B.latitude,
        toLon: B.longitude,
      });

      expect(itineraire.segments[0].mode).toBe('WALK');
      expect(itineraire.segments[0].lineId).toBe('ligne-marche');
    });

    it('distingue deux lignes CONCURRENTES portant le MÊME nom', async () => {
      // LE test qui justifie l'existence de lineId.
      //
      // Deux liaisons relient A à C, avec le même mode ET le même nom
      // d'affichage : seul l'identifiant permet de savoir laquelle a été
      // retenue. Si l'on n'avait que `lineName`, la réponse serait
      // strictement identique dans les deux cas — donc inutilisable pour
      // enregistrer le trajet à l'étape 4E-3B.
      const lente = segment(
        A.id,
        C.id,
        'BUS',
        3000,
        30,
        'ligne-express-lente',
        'Express',
        'RATP',
      );
      const rapide = segment(
        A.id,
        C.id,
        'BUS',
        2000,
        10,
        'ligne-express-rapide',
        'Express',
        'RATP',
      );

      prisma.stop.findMany.mockResolvedValue([A, C]);
      prisma.networkLink.findMany.mockResolvedValue([lente, rapide]);

      const [itineraire] = await service.searchRoutes({
        ...depuisA,
        ...versC,
      });

      // La liaison rapide gagne sur les DEUX critères (10 min, 2000 m).
      expect(itineraire.segments[0].lineId).toBe('ligne-express-rapide');
      // ...alors que le nom, lui, ne distingue rien.
      expect(itineraire.segments[0].lineName).toBe('Express');
      expect(itineraire.segments[0].distanceM).toBe(2000);
    });

    it('associe à chaque segment le lineId de SA propre liaison', async () => {
      prisma.stop.findMany.mockResolvedValue([A, B, C]);
      prisma.networkLink.findMany.mockResolvedValue([aVersB, bVersC]);

      const [itineraire] = await service.searchRoutes({
        ...depuisA,
        ...versC,
      });

      expect(itineraire.segments.map((s) => s.lineId)).toEqual([
        'ligne-marche',
        'ligne-bus',
      ]);
    });

    it('ne se sert PAS du lineId pour choisir le chemin', async () => {
      // Dijkstra ne pondère que la durée et la distance. Changer le seul
      // identifiant d'une liaison ne doit donc rien changer au trajet élu.
      const memeLiaisonAutreId = segment(
        A.id,
        C.id,
        'BUS',
        3000,
        30,
        'zzz-identifiant-different',
        '350',
        'Transdev',
      );

      prisma.stop.findMany.mockResolvedValue([A, C]);
      prisma.networkLink.findMany.mockResolvedValue([aVersC]);
      const avant = await service.searchRoutes({ ...depuisA, ...versC });

      prisma.stop.findMany.mockResolvedValue([A, C]);
      prisma.networkLink.findMany.mockResolvedValue([memeLiaisonAutreId]);
      const apres = await service.searchRoutes({ ...depuisA, ...versC });

      // Même trajet, mêmes totaux : seul l'identifiant diffère.
      expect(apres[0].totalDistanceM).toBe(avant[0].totalDistanceM);
      expect(apres[0].totalDurationMin).toBe(avant[0].totalDurationMin);
      expect(apres[0].segments[0].toStopId).toBe(avant[0].segments[0].toStopId);
      expect(apres[0].segments[0].lineId).not.toBe(avant[0].segments[0].lineId);
    });

    // -------------------------------------------------------------------------
    // Étape 4E-2 : nom de ligne et exploitant dans la réponse
    // -------------------------------------------------------------------------

    it('expose le nom et l’exploitant de la ligne pour un BUS', async () => {
      prisma.stop.findMany.mockResolvedValue([A, C]);
      prisma.networkLink.findMany.mockResolvedValue([aVersC]);

      const [itineraire] = await service.searchRoutes({
        ...depuisA,
        ...versC,
      });

      expect(itineraire.segments[0].lineName).toBe('350');
      expect(itineraire.segments[0].operator).toBe('Transdev');
    });

    it('expose le nom et l’exploitant de la ligne pour un METRO', async () => {
      prisma.stop.findMany.mockResolvedValue([A, C]);
      prisma.networkLink.findMany.mockResolvedValue([aVersCMetro]);

      const [itineraire] = await service.searchRoutes({
        ...depuisA,
        ...versC,
      });

      expect(itineraire.segments[0].mode).toBe('METRO');
      expect(itineraire.segments[0].lineName).toBe('4');
      expect(itineraire.segments[0].operator).toBe('RATP');
    });

    it('expose le nom et l’exploitant AUSSI pour la marche', async () => {
      // Test important : il vérifie qu'AUCUN cas particulier n'a été écrit
      // pour WALK. La marche est portée par une ligne du réseau comme les
      // autres modes (« À pied » dans le seed), donc elle traverse le même
      // chemin de données sans traitement dédié.
      prisma.stop.findMany.mockResolvedValue([A, B]);
      prisma.networkLink.findMany.mockResolvedValue([aVersB]);

      const [itineraire] = await service.searchRoutes({
        ...depuisA,
        toLat: B.latitude,
        toLon: B.longitude,
      });

      expect(itineraire.segments[0].mode).toBe('WALK');
      expect(itineraire.segments[0].lineName).toBe('À pied');
      expect(itineraire.segments[0].operator).toBe('RATP');
    });

    it('associe à CHAQUE segment la ligne qui lui correspond', async () => {
      // Le test qui compte vraiment : deux segments, deux lignes
      // différentes. Une interversion, ou une valeur recopiée du premier
      // segment sur le second, échouerait ici — ce qu'une simple
      // vérification de présence ne détecterait jamais.
      prisma.stop.findMany.mockResolvedValue([A, B, C]);
      prisma.networkLink.findMany.mockResolvedValue([aVersB, bVersC]);

      const [itineraire] = await service.searchRoutes({
        ...depuisA,
        ...versC,
      });

      expect(
        itineraire.segments.map((s) => ({
          mode: s.mode,
          lineName: s.lineName,
          operator: s.operator,
        })),
      ).toEqual([
        { mode: 'WALK', lineName: 'À pied', operator: 'RATP' },
        { mode: 'BUS', lineName: '38', operator: 'RATP' },
      ]);
    });

    it('ne modifie aucune des propriétés déjà renvoyées', async () => {
      // Garde-fou de non-régression : 4E-2 ne devait qu'AJOUTER deux champs.
      prisma.stop.findMany.mockResolvedValue([A, C]);
      prisma.networkLink.findMany.mockResolvedValue([aVersC]);

      const [itineraire] = await service.searchRoutes({
        ...depuisA,
        ...versC,
      });

      expect(itineraire.segments[0]).toEqual({
        fromStopId: A.id,
        fromStopName: 'Gare du Nord',
        toStopId: C.id,
        toStopName: 'Chatelet',
        mode: 'BUS',
        lineName: '350',
        operator: 'Transdev',
        // Ajouté à l'étape 4E-3A.
        lineId: 'ligne-express',
        distanceM: 3000,
        durationMin: 30,
      });
      expect(itineraire.criterion).toBe('FASTEST');
      expect(itineraire.totalDistanceM).toBe(3000);
      expect(itineraire.totalDurationMin).toBe(30);
    });

    it('reste déterministe : deux recherches identiques, réponse identique', async () => {
      // Les nouveaux champs ne doivent pas dépendre de l'ordre de parcours.
      prisma.stop.findMany.mockResolvedValue([A, B, C]);
      prisma.networkLink.findMany.mockResolvedValue([aVersB, bVersC, aVersC]);

      const premier = await service.searchRoutes({ ...depuisA, ...versC });
      const second = await service.searchRoutes({ ...depuisA, ...versC });

      expect(JSON.stringify(premier)).toBe(JSON.stringify(second));
    });

    it('interroge la base exactement deux fois, sans requête par segment', async () => {
      // Les noms de ligne viennent du `include: { line: true }` DÉJÀ présent.
      // Si quelqu'un les récupérait par une requête supplémentaire, le
      // nombre d'appels augmenterait avec le nombre de segments (N+1).
      prisma.stop.findMany.mockResolvedValue([A, B, C]);
      prisma.networkLink.findMany.mockResolvedValue([aVersB, bVersC]);

      await service.searchRoutes({ ...depuisA, ...versC });

      expect(prisma.stop.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.networkLink.findMany).toHaveBeenCalledTimes(1);
      // La liaison est chargée AVEC sa ligne, en une seule requête.
      expect(prisma.networkLink.findMany).toHaveBeenCalledWith({
        orderBy: { id: 'asc' },
        include: { line: true },
      });
    });

    // -------------------------------------------------------------------------
    // Étape 4C-2 : déterminisme, rayon de recherche, chaînage
    // -------------------------------------------------------------------------

    it('garantit que les segments sont chaînés dans le bon ordre', async () => {
      prisma.stop.findMany.mockResolvedValue([A, B, C]);
      prisma.networkLink.findMany.mockResolvedValue([aVersB, bVersC]);

      const [itineraire] = await service.searchRoutes({
        ...depuisA,
        ...versC,
      });

      // Le premier segment part bien de l'origine...
      expect(itineraire.segments[0].fromStopId).toBe(A.id);
      // ...le dernier arrive bien à la destination...
      expect(itineraire.segments[itineraire.segments.length - 1].toStopId).toBe(
        C.id,
      );
      // ...et chaque segment repart exactement là où le précédent s'arrête.
      for (let i = 0; i < itineraire.segments.length - 1; i++) {
        expect(itineraire.segments[i].toStopId).toBe(
          itineraire.segments[i + 1].fromStopId,
        );
      }
    });

    it('renvoie exactement le même résultat pour deux appels identiques', async () => {
      prisma.stop.findMany.mockResolvedValue([A, B, C]);
      prisma.networkLink.findMany.mockResolvedValue([aVersB, bVersC, aVersC]);

      const premier = await service.searchRoutes({ ...depuisA, ...versC });
      const second = await service.searchRoutes({ ...depuisA, ...versC });

      expect(second).toEqual(premier);
    });

    it("choisit le même chemin même si l'ordre des segments change (départage déterministe)", async () => {
      // Deux chemins de coût STRICTEMENT identique : A→X→C et A→Y→C.
      // Sans règle de départage, le gagnant dépendrait de l'ordre des
      // lignes renvoyées par PostgreSQL. La règle retenue est : à coût
      // égal, l'identifiant le plus petit gagne — donc X ("stop-x").
      const X = { ...B, id: 'stop-x', name: 'Bifurcation X' };
      const Y = { ...B, id: 'stop-y', name: 'Bifurcation Y' };

      const aVersX = segment(A.id, X.id, 'WALK', 500, 5);
      const xVersC = segment(X.id, C.id, 'BUS', 500, 5);
      const aVersY = segment(A.id, Y.id, 'WALK', 500, 5);
      const yVersC = segment(Y.id, C.id, 'BUS', 500, 5);

      prisma.stop.findMany.mockResolvedValue([A, X, Y, C]);
      prisma.networkLink.findMany.mockResolvedValue([
        aVersX,
        xVersC,
        aVersY,
        yVersC,
      ]);
      const ordreNormal = await service.searchRoutes({ ...depuisA, ...versC });

      // Mêmes données, mais fournies dans l'ordre inverse.
      prisma.stop.findMany.mockResolvedValue([C, Y, X, A]);
      prisma.networkLink.findMany.mockResolvedValue([
        yVersC,
        aVersY,
        xVersC,
        aVersX,
      ]);
      const ordreInverse = await service.searchRoutes({ ...depuisA, ...versC });

      expect(ordreInverse).toEqual(ordreNormal);
      // Et c'est bien X qui a été retenu, conformément à la règle.
      expect(ordreNormal[0].segments[0].toStopId).toBe('stop-x');
    });

    it('choisit correctement parmi trois chemins possibles', async () => {
      // A→B→C  : 3800 m / 20 min  → le plus RAPIDE
      // A→C    : 3000 m / 30 min
      // A→E→C  : 2000 m / 50 min  → le plus COURT
      const E = { ...B, id: 'stop-e', name: 'Detour E' };
      const aVersE = segment(A.id, E.id, 'WALK', 1000, 25);
      const eVersC = segment(E.id, C.id, 'WALK', 1000, 25);

      prisma.stop.findMany.mockResolvedValue([A, B, C, E]);
      prisma.networkLink.findMany.mockResolvedValue([
        aVersB,
        bVersC,
        aVersC,
        aVersE,
        eVersC,
      ]);

      const result = await service.searchRoutes({ ...depuisA, ...versC });

      const rapide = result.find((i) => i.criterion === 'FASTEST');
      const court = result.find((i) => i.criterion === 'SHORTEST');

      // Le plus rapide est bien le minimum des trois durées (20 < 30 < 50).
      expect(rapide?.totalDurationMin).toBe(20);
      // Le plus court est bien le minimum des trois distances (2000 < 3000 < 3800).
      expect(court?.totalDistanceM).toBe(2000);
    });

    it('renvoie [] quand le point de départ est trop loin de tout arrêt', async () => {
      prisma.stop.findMany.mockResolvedValue([A, B, C]);
      prisma.networkLink.findMany.mockResolvedValue([aVersB, bVersC]);

      // 0,025° de latitude ≈ 2,8 km : au-delà du rayon de 2 km.
      const result = await service.searchRoutes({
        fromLat: A.latitude + 0.025,
        fromLon: A.longitude,
        ...versC,
      });

      expect(result).toEqual([]);
    });

    it('renvoie [] quand la destination est trop loin de tout arrêt', async () => {
      prisma.stop.findMany.mockResolvedValue([A, B, C]);
      prisma.networkLink.findMany.mockResolvedValue([aVersB, bVersC]);

      const result = await service.searchRoutes({
        ...depuisA,
        toLat: C.latitude + 0.025,
        toLon: C.longitude,
      });

      expect(result).toEqual([]);
    });

    it('accepte un point situé juste à l’intérieur du rayon de recherche', async () => {
      prisma.stop.findMany.mockResolvedValue([A, B, C]);
      prisma.networkLink.findMany.mockResolvedValue([aVersB, bVersC]);

      // 0,013° de latitude ≈ 1,45 km : à l'intérieur du rayon de 2 km.
      const result = await service.searchRoutes({
        fromLat: A.latitude + 0.013,
        fromLon: A.longitude,
        ...versC,
      });

      expect(result).toHaveLength(1);
      expect(result[0].segments[0].fromStopId).toBe(A.id);
    });

    // -------------------------------------------------------------------------
    // Étape 4C-4-1 : le mode vient de la ligne, pas de la liaison
    // -------------------------------------------------------------------------
    describe('lignes de transport (TransitLine)', () => {
      it('demande à Prisma de joindre la ligne à chaque liaison', async () => {
        prisma.stop.findMany.mockResolvedValue([A, C]);
        prisma.networkLink.findMany.mockResolvedValue([aVersC]);

        await service.searchRoutes({ ...depuisA, ...versC });

        // Sans include, le mode serait introuvable : cette requête est la
        // condition même du fonctionnement du graphe.
        expect(prisma.networkLink.findMany).toHaveBeenCalledWith({
          orderBy: { id: 'asc' },
          include: { line: true },
        });
      });

      it('lit le mode de transport depuis la ligne', async () => {
        // La liaison ne porte plus de mode : seule la ligne en a un.
        const liaison = segment(A.id, C.id, 'BUS', 3000, 30, 'ligne-bus-99');
        prisma.stop.findMany.mockResolvedValue([A, C]);
        prisma.networkLink.findMany.mockResolvedValue([liaison]);

        const result = await service.searchRoutes({ ...depuisA, ...versC });

        expect(result[0].segments[0].mode).toBe('BUS');
      });

      it('traite deux lignes différentes reliant les MÊMES arrêts comme deux liaisons distinctes', async () => {
        // Cas très courant dans un vrai réseau : un bus et un métro
        // desservent tous deux A→C. La contrainte unique du schéma porte sur
        // (lineId, fromStopId, toStopId), donc les deux coexistent.
        const parBus = segment(A.id, C.id, 'BUS', 3000, 30, 'ligne-bus');
        const parMarche = segment(A.id, C.id, 'WALK', 2000, 45, 'ligne-marche');

        prisma.stop.findMany.mockResolvedValue([A, C]);
        prisma.networkLink.findMany.mockResolvedValue([parBus, parMarche]);

        const result = await service.searchRoutes({ ...depuisA, ...versC });

        const rapide = result.find((i) => i.criterion === 'FASTEST');
        const court = result.find((i) => i.criterion === 'SHORTEST');

        // Le plus rapide est le bus (30 min), le plus court la marche (2000 m) :
        // les deux liaisons ont donc bien été prises en compte séparément.
        expect(rapide?.totalDurationMin).toBe(30);
        expect(rapide?.segments[0].mode).toBe('BUS');
        expect(court?.totalDistanceM).toBe(2000);
        expect(court?.segments[0].mode).toBe('WALK');
      });
    });

    // -------------------------------------------------------------------------
    // Étape 4C-3 : isolation entre réseau public et données personnelles
    // -------------------------------------------------------------------------
    describe('isolation des données personnelles', () => {
      it("n'interroge JAMAIS la table des segments personnels", async () => {
        prisma.stop.findMany.mockResolvedValue([A, C]);
        prisma.networkLink.findMany.mockResolvedValue([aVersC]);

        await service.searchRoutes({ ...depuisA, ...versC });

        // Preuve directe : la recherche ne touche pas aux données des usagers.
        expect(prisma.segment.findMany).not.toHaveBeenCalled();
        // ...et lit bien le réseau public à la place.
        expect(prisma.networkLink.findMany).toHaveBeenCalled();
      });

      it('ignore les trajets personnels : sans réseau public, aucun itinéraire', async () => {
        prisma.stop.findMany.mockResolvedValue([A, B, C]);
        // Le réseau public est VIDE...
        prisma.networkLink.findMany.mockResolvedValue([]);
        // ...alors qu'un usager a bien enregistré des segments entre ces
        // mêmes arrêts. Avant 4C-3, ces segments auraient alimenté le
        // graphe public. Ce ne doit plus être le cas.
        prisma.segment.findMany.mockResolvedValue([aVersB, bVersC]);

        const result = await service.searchRoutes({ ...depuisA, ...versC });

        expect(result).toEqual([]);
      });

      it("n'emprunte que des liaisons du réseau public, jamais celles d'un usager", async () => {
        prisma.stop.findMany.mockResolvedValue([A, B, C]);
        // Réseau public : uniquement le trajet direct A→C.
        prisma.networkLink.findMany.mockResolvedValue([aVersC]);
        // Un usager a enregistré un raccourci A→B→C bien plus rapide.
        // Il ne doit avoir AUCUNE influence sur le résultat.
        prisma.segment.findMany.mockResolvedValue([aVersB, bVersC]);

        const result = await service.searchRoutes({ ...depuisA, ...versC });

        expect(result).toHaveLength(1);
        expect(result[0].segments).toHaveLength(1);
        expect(result[0].segments[0].toStopId).toBe(C.id);
        // La durée est bien celle du réseau (30 min), et non celle du
        // raccourci personnel (20 min).
        expect(result[0].totalDurationMin).toBe(30);
      });

      it('fonctionne avec le réseau public seul, sans aucune donnée utilisateur', async () => {
        prisma.stop.findMany.mockResolvedValue([A, C]);
        prisma.networkLink.findMany.mockResolvedValue([aVersC]);
        // Aucune route, aucun segment, aucun usager en base.
        prisma.segment.findMany.mockResolvedValue([]);

        const result = await service.searchRoutes({ ...depuisA, ...versC });

        expect(result).toHaveLength(1);
        expect(result[0].segments[0].fromStopName).toBe('Gare du Nord');
      });
    });
  });
});
