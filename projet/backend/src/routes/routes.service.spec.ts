import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CarbonService } from '../carbon/carbon.service';
import { ScheduleService } from '../schedule/schedule.service';
import { WalkRoutingService } from '../walk-routing/walk-routing.service';
import { CarbonResultDto } from '../carbon/dto/carbon-result.dto';
import { RoutesService } from './routes.service';
import { CreateRouteDto } from './dto/create-route.dto';
import { PaginationQueryDto } from './dto/pagination-query.dto';

// Le test du breakdown incohérent provoque VOLONTAIREMENT une erreur
// journalisée : l'afficher laisserait croire à un échec dans une suite verte.
beforeAll(() => {
  Logger.overrideLogger(false);
});

// Même approche que pour UsersService : PrismaService est simulé, seules
// les méthodes réellement utilisées sont mockées. Ce sont des tests
// unitaires, pas des tests d'intégration.
describe('RoutesService', () => {
  let walkRouting: {
    estConfigure: jest.Mock;
    itineraire: jest.Mock;
  };
  let schedule: {
    lignesActives: jest.Mock;
    horairesDisponibles: jest.Mock;
    attenteAvantLigne: jest.Mock;
    prochainsPassages: jest.Mock;
  };
  let service: RoutesService;
  let prisma: {
    route: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      count: jest.Mock;
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
  let carbonService: { calculate: jest.Mock; facteurs: jest.Mock };

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
        count: jest.fn(),
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
      // Table des facteurs telle que la publie le microservice (GET /factors).
      // ⚠️ ESCOOTER est ABSENT, exactement comme dans app/factors.py : c'est
      // ce qui permet de tester qu'un mode sans facteur n'est jamais compté
      // pour zéro.
      facteurs: jest.fn().mockResolvedValue({
        gPerKm: {
          WALK: 0,
          BIKE: 0,
          TRAM: 4,
          METRO: 4,
          TRAIN: 4,
          BUS: 113,
          CAR: 218,
        },
        carGPerKm: 218,
      }),
    };

    // ⚠️ UN CALENDRIER QUI RÉPOND « JE NE SAIS PAS ».
    //
    // `lignesActives: null` est le comportement d'une installation SANS
    // `calendar.txt` : le moteur n'écarte alors aucune ligne, et se comporte
    // exactement comme avant l'ajout des horaires. C'est ce que la très
    // grande majorité de ces tests vérifie — le graphe, les critères, la
    // déduplication — et qu'un calendrier actif rendrait illisible.
    //
    // Les tests qui portent SUR les horaires, eux, remplacent ce double.
    schedule = {
      lignesActives: jest.fn().mockResolvedValue(null),
      horairesDisponibles: jest.fn().mockResolvedValue(false),
      attenteAvantLigne: jest.fn().mockResolvedValue(null),
      prochainsPassages: jest.fn().mockResolvedValue([]),
    };

    // ⚠️ ROUTEUR PIÉTON DÉLIBÉRÉMENT « NON CONFIGURÉ » PAR DÉFAUT. Ces tests
    // vérifient le MOTEUR D'ITINÉRAIRES, pas le routage piéton : laisser
    // passer un appel réseau les rendrait lents et dépendants d'un service
    // extérieur. Les marches y restent donc des estimations à vol d'oiseau,
    // exactement comme sur une installation sans moteur configuré.
    walkRouting = {
      estConfigure: jest.fn().mockReturnValue(false),
      itineraire: jest.fn().mockResolvedValue(null),
    };

    service = new RoutesService(
      prisma as unknown as PrismaService,
      carbonService as unknown as CarbonService,
      schedule as unknown as ScheduleService,
      walkRouting as unknown as WalkRoutingService,
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
    // Reproduit ce que le ValidationPipe fabrique quand le client n'envoie
    // aucun paramètre : les valeurs par défaut du DTO.
    const paginationParDefaut = () => new PaginationQueryDto();

    beforeEach(() => {
      prisma.route.findMany.mockResolvedValue([maRoute]);
      prisma.route.count.mockResolvedValue(1);
    });

    it("ne demande à Prisma que les itinéraires de l'usager", async () => {
      await service.findAllForUser(MOI, paginationParDefaut());

      // Le filtre est fait EN BASE. Récupérer puis filtrer en mémoire
      // ramènerait les données des autres usagers sur le serveur.
      expect(prisma.route.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: MOI } }),
      );
      expect(prisma.route.count).toHaveBeenCalledWith({
        where: { userId: MOI },
      });
    });

    it('applique page=1 et limit=20 par défaut', async () => {
      const resultat = await service.findAllForUser(MOI, paginationParDefaut());

      expect(prisma.route.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
      expect(resultat.page).toBe(1);
      expect(resultat.limit).toBe(20);
    });

    it('traduit page et limit en skip et take', async () => {
      // Page 3 avec 10 par page : on saute les 20 premiers.
      await service.findAllForUser(MOI, { page: 3, limit: 10 });

      expect(prisma.route.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });

    it('trie par date décroissante PUIS par identifiant', async () => {
      await service.findAllForUser(MOI, paginationParDefaut());

      // La seconde clé n'est pas décorative : sans ordre total, skip/take
      // peut sauter ou dupliquer des lignes entre deux pages.
      expect(prisma.route.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
        }),
      );
    });

    it('ne charge AUCUNE relation : une liste est un résumé', async () => {
      await service.findAllForUser(MOI, paginationParDefaut());

      // `mock.calls` est un `any[]` : on le type AVANT de l'indexer.
      const appels = prisma.route.findMany.mock.calls as [
        Record<string, unknown>,
      ][];
      const options = appels[0][0];
      expect(options).not.toHaveProperty('include');
      expect(options).not.toHaveProperty('select');
    });

    it('enveloppe le résultat avec le total', async () => {
      prisma.route.count.mockResolvedValue(42);

      const resultat = await service.findAllForUser(MOI, paginationParDefaut());

      expect(resultat).toEqual({
        items: [maRoute],
        page: 1,
        limit: 20,
        total: 42,
      });
    });

    it('renvoie une liste vide sans erreur quand la page dépasse le total', async () => {
      prisma.route.findMany.mockResolvedValue([]);
      prisma.route.count.mockResolvedValue(3);

      const resultat = await service.findAllForUser(MOI, {
        page: 99,
        limit: 20,
      });

      expect(resultat.items).toEqual([]);
      expect(resultat.total).toBe(3);
    });
  });

  describe('findOneDetailedForUser', () => {
    const routeDetaillee = {
      ...maRoute,
      segments: [{ id: 'segment-1' }],
      carbonRecords: [{ id: 'carbone-1' }],
    };

    beforeEach(() => {
      prisma.route.findUnique.mockResolvedValue(maRoute);
      prisma.route.findUniqueOrThrow.mockResolvedValue(routeDetaillee);
    });

    it('renvoie la route AVEC ses segments et ses enregistrements carbone', async () => {
      const resultat = await service.findOneDetailedForUser('route-1', MOI);

      expect(resultat).toEqual(routeDetaillee);
    });

    it('demande les segments dans l’ordre CHRONOLOGIQUE', async () => {
      await service.findOneDetailedForUser('route-1', MOI);

      // Sans orderBy explicite, PostgreSQL ne promet aucun ordre et
      // l'itinéraire pourrait revenir mélangé.
      expect(prisma.route.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 'route-1' },
        include: {
          segments: {
            orderBy: { departureTime: 'asc' },
            // Phase 4 : les arrêts voyagent AVEC le segment, pour que
            // l'historique n'ait plus à charger tout le référentiel réseau.
            include: { fromStop: true, toStop: true },
          },
          carbonRecords: { orderBy: [{ distanceM: 'desc' }, { id: 'asc' }] },
        },
      });
    });

    it('impose un ordre TOTAL aux enregistrements carbone', async () => {
      await service.findOneDetailedForUser('route-1', MOI);

      // Ils partagent tous la même `date` : sans clé de départage, leur
      // ordre serait laissé à PostgreSQL.
      const appels = prisma.route.findUniqueOrThrow.mock.calls as [
        { include: { carbonRecords: { orderBy: unknown } } },
      ][];
      expect(appels[0][0].include.carbonRecords.orderBy).toEqual([
        { distanceM: 'desc' },
        { id: 'asc' },
      ]);
    });

    it('contrôle la propriété AVANT de charger quoi que ce soit', async () => {
      const ordre: string[] = [];
      prisma.route.findUnique.mockImplementation(() => {
        ordre.push('proprietaire');
        return Promise.resolve(maRoute);
      });
      prisma.route.findUniqueOrThrow.mockImplementation(() => {
        ordre.push('detail');
        return Promise.resolve(routeDetaillee);
      });

      await service.findOneDetailedForUser('route-1', MOI);

      expect(ordre).toEqual(['proprietaire', 'detail']);
    });

    it("lève 404 et NE CHARGE RIEN si l'itinéraire appartient à un autre", async () => {
      prisma.route.findUnique.mockResolvedValue({
        ...maRoute,
        userId: QUELQU_UN_DAUTRE,
      });

      await expect(
        service.findOneDetailedForUser('route-1', MOI),
      ).rejects.toThrow(NotFoundException);

      // Le point important : aucune donnée de l'autre usager n'a été lue.
      expect(prisma.route.findUniqueOrThrow).not.toHaveBeenCalled();
    });

    it("lève 404 et NE CHARGE RIEN si l'itinéraire n'existe pas", async () => {
      prisma.route.findUnique.mockResolvedValue(null);

      await expect(
        service.findOneDetailedForUser('route-inexistante', MOI),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.route.findUniqueOrThrow).not.toHaveBeenCalled();
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
      mode: 'WALK' | 'BUS' | 'METRO' | 'TRAM',
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

    /**
     * Distance et durée de la MARCHE d'approche et de sortie d'un itinéraire.
     *
     * ⚠️ ELLES ENTRENT DANS LES TOTAUX. Les jeux d'essai placent le point
     * demandé à quelques dizaines de mètres du quai : la marche y est donc
     * courte mais JAMAIS NULLE, et un total « exactement 3 000 m » signalerait
     * qu'elle a été oubliée — le défaut que ces tests verrouillent.
     */
    const marches = (itineraire: {
      walkAccess: { distanceM: number; durationMin: number } | null;
      walkEgress: { distanceM: number; durationMin: number } | null;
    }) => {
      const legs = [itineraire.walkAccess, itineraire.walkEgress].filter(
        (leg): leg is { distanceM: number; durationMin: number } =>
          leg !== null,
      );

      return {
        distanceM: legs.reduce((somme, leg) => somme + leg.distanceM, 0),
        durationMin: legs.reduce((somme, leg) => somme + leg.durationMin, 0),
      };
    };

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
      // Réseau + marche des deux bouts : c'est ce que l'usager parcourt.
      expect(result[0].totalDistanceM).toBe(
        3000 + marches(result[0]).distanceM,
      );
      expect(result[0].totalDurationMin).toBe(
        30 + marches(result[0]).durationMin,
      );
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
      // Les totaux sont la somme des segments ET de la marche des deux bouts.
      expect(result[0].totalDistanceM).toBe(
        3800 + marches(result[0]).distanceM,
      );
      expect(result[0].totalDurationMin).toBe(
        20 + marches(result[0]).durationMin,
      );
    });

    it('oppose le plus rapide au moins de changements quand ils diffèrent', async () => {
      // ⚠️ CE TEST OPPOSAIT AUPARAVANT FASTEST A SHORTEST. Le critere « le plus
      // court en metres » a ete retire de l'affichage apres mesure sur le
      // reseau francilien : il proposait 64 minutes et onze fois plus
      // d'emissions pour economiser 1,4 km de trace. Voir l'en-tete de
      // `searchRoutes`.
      //
      //   Rapide : A --tram--> B --tram--> C   10 min, 1 changement
      //   Direct : A --bus-----------> C       30 min, 0 changement
      //
      // ⚠️ LE PLUS DIRECT EST ICI LE PLUS LENT. C'est exactement ce que le
      // critere doit rendre visible : quelqu'un avec une valise, une poussette
      // ou vingt minutes d'avance prefere souvent ne pas changer.
      const aVersBTram = segment(A.id, B.id, 'TRAM', 3000, 5, 'tram-b');
      const bVersCTram = segment(B.id, C.id, 'TRAM', 3000, 5, 'tram-c');
      const aVersCBus = segment(A.id, C.id, 'BUS', 3500, 30, 'bus-30');

      prisma.stop.findMany.mockResolvedValue([A, B, C]);
      prisma.networkLink.findMany.mockResolvedValue([
        aVersBTram,
        bVersCTram,
        aVersCBus,
      ]);

      const result = await service.searchRoutes({ ...depuisA, ...versC });

      const rapide = result.find((i) => i.criterion === 'FASTEST');
      const direct = result.find((i) => i.criterion === 'FEWEST_TRANSFERS');

      // Le plus rapide gagne 20 minutes, au prix d'une correspondance.
      expect(rapide!.totalDurationMin).toBe(10 + marches(rapide!).durationMin);
      expect(rapide?.numberOfTransfers).toBe(1);

      // Le plus direct est plus lent, mais d'un seul tenant.
      expect(direct!.totalDurationMin).toBe(30 + marches(direct!).durationMin);
      expect(direct?.numberOfTransfers).toBe(0);
      expect(direct?.segments).toHaveLength(1);

      // ⚠️ `SHORTEST` EST CALCULE MAIS JAMAIS RENDU : il sert de candidat au
      // critere carbone, sans occuper une carte de resultat.
      expect(result.map((i) => i.criterion)).not.toContain('SHORTEST');
    });

    it('NE SACRIFIE PAS 23 MINUTES POUR UN DIXIÈME DE GRAMME', async () => {
      // ⚠️ TEST ÉCRIT APRÈS UNE MESURE SUR LE RÉSEAU RÉEL.
      //
      //     Esplanade → Neuhof, un jeudi matin
      //     « le plus rapide »      1 changement
      //     « le plus écologique »  6 changements, 23 minutes plus tard
      //                             …pour 0,11 gramme de moins.
      //
      // Le classement était exact et la proposition indéfendable. Les
      // émissions sont désormais comparées AU GRAMME — la précision des
      // facteurs de la Base Carbone, et l'unité affichée à l'usager.
      //
      // Ici : A→C direct fait 3 000 m de bus ; A→B→C en fait 3 001. L'écart
      // d'émissions est inférieur au gramme, et le détour ne doit donc pas
      // ressortir comme « le plus écologique ».
      const direct = segment(A.id, C.id, 'BUS', 3000, 10, 'bus-direct');
      const detourA = segment(A.id, B.id, 'BUS', 1500, 2, 'bus-x');
      const detourB = segment(B.id, C.id, 'BUS', 1499, 2, 'bus-y');

      prisma.stop.findMany.mockResolvedValue([A, B, C]);
      prisma.networkLink.findMany.mockResolvedValue([direct, detourA, detourB]);

      const result = await service.searchRoutes({ ...depuisA, ...versC });

      const propre = result.find((i) => i.criterion === 'LOWEST_CO2');

      // Le détour émet 0,11 g de moins (1 m de bus en moins), pour une
      // correspondance de plus. Sous le gramme, il ne gagne pas.
      expect(propre?.segments ?? []).not.toHaveLength(2);
    });

    it('N’INVENTE PAS un troisième trajet pour remplir trois cartes', async () => {
      // Un seul chemin possible : les trois critères le désignent tous. La
      // réponse doit en contenir UN, pas trois copies étiquetées différemment.
      prisma.stop.findMany.mockResolvedValue([A, C]);
      prisma.networkLink.findMany.mockResolvedValue([aVersC]);

      const result = await service.searchRoutes({ ...depuisA, ...versC });

      expect(result).toHaveLength(1);
      expect(result[0].criterion).toBe('FASTEST');
    });

    it('DISTINGUE deux trajets qui ne diffèrent QUE par la ligne empruntée', async () => {
      // Homme de Fer → Broglie est desservi par le tram B ET le tram F. Ce
      // sont DEUX rames différentes, deux fréquences, deux directions : les
      // confondre supprimerait une alternative réelle.
      //
      // ⚠️ CE TEST A ÉTÉ ÉCRIT APRÈS AVOIR CONSTATÉ LE BUG. La signature de
      // déduplication ne portait que sur les arrêts et le mode ; le second
      // tram disparaissait silencieusement.
      const parB = segment(A.id, C.id, 'TRAM', 3000, 9, 'tram-b');
      const parF = segment(A.id, C.id, 'TRAM', 2000, 12, 'tram-f');

      prisma.stop.findMany.mockResolvedValue([A, C]);
      prisma.networkLink.findMany.mockResolvedValue([parB, parF]);

      const result = await service.searchRoutes({ ...depuisA, ...versC });

      expect(result).toHaveLength(2);
      expect(result[0].segments[0].lineId).toBe('tram-b');
      expect(result[1].segments[0].lineId).toBe('tram-f');

      // ⚠️ LE SECOND EST ÉTIQUETÉ « LOWEST_CO2 » : moins de mètres à mode
      // égal, ce sont moins de grammes, donc le critère carbone désigne ce
      // trajet et passe avant dans l'ordre d'insertion. L'usager voit deux
      // cartes honnêtes, pas trois dont l'une serait un doublon maquillé.
      expect(result.map((i) => i.criterion)).toEqual(['FASTEST', 'LOWEST_CO2']);
    });

    it('ne compte PAS la marche comme un changement de ligne', async () => {
      // A --à pied--> B --bus 38--> C : une seule ligne réellement empruntée.
      // Un couloir de correspondance n'est pas une correspondance.
      prisma.stop.findMany.mockResolvedValue([A, B, C]);
      prisma.networkLink.findMany.mockResolvedValue([aVersB, bVersC]);

      const [itineraire] = await service.searchRoutes({ ...depuisA, ...versC });

      expect(itineraire.segments).toHaveLength(2);
      expect(itineraire.segments[0].mode).toBe('WALK');
      expect(itineraire.numberOfTransfers).toBe(0);
    });

    it("ne renvoie qu'un itinéraire quand les trois critères désignent le même trajet", async () => {
      // Un seul chemin possible : il est à la fois le plus rapide, le plus
      // direct et le moins émetteur. On ne le renvoie pas trois fois.
      prisma.stop.findMany.mockResolvedValue([A, C]);
      prisma.networkLink.findMany.mockResolvedValue([aVersC]);

      const result = await service.searchRoutes({ ...depuisA, ...versC });

      expect(result).toHaveLength(1);
      expect(result[0].criterion).toBe('FASTEST');
    });

    // -------------------------------------------------------------------------
    // Phase 4 : empreinte carbone portée par chaque itinéraire
    // -------------------------------------------------------------------------
    describe('empreinte carbone des itinéraires', () => {
      beforeEach(() => {
        prisma.stop.findMany.mockResolvedValue([A, C]);
        prisma.networkLink.findMany.mockResolvedValue([aVersC]);
      });

      it('renseigne les émissions, la référence voiture et l’EcoScore', async () => {
        carbonService.calculate.mockResolvedValue({
          totalDistanceM: 3000,
          totalCo2Grams: 339,
          carCo2Grams: 654,
          savedVsCarGrams: 315,
          ecoScore: 48.2,
          breakdown: [],
        });

        const [itineraire] = await service.searchRoutes({
          ...depuisA,
          ...versC,
        });

        expect(itineraire.carbon).toEqual({
          status: 'CARBON_AVAILABLE',
          co2Grams: 339,
          carCo2Grams: 654,
          savedVsCarGrams: 315,
          ecoScore: 48.2,
          reason: null,
        });
      });

      it('envoie au calcul le mode et la distance issus du RÉSEAU', async () => {
        await service.searchRoutes({ ...depuisA, ...versC });

        // ⚠️ LA MARCHE EST ENVOYÉE ELLE AUSSI. Elle n'émet rien, mais elle
        // compte dans la distance porte-à-porte — celle qui sert de référence
        // à « ce que la voiture aurait émis ». L'omettre sous-estimait
        // l'économie annoncée à l'usager.
        expect(carbonService.calculate).toHaveBeenCalledWith({
          segments: [
            { mode: 'BUS', distanceM: 3000 },
            // La marche d'approche et celle de sortie, dans cet ordre.
            { mode: 'WALK', distanceM: expect.any(Number) as number },
            { mode: 'WALK', distanceM: expect.any(Number) as number },
          ],
        });
      });

      // ⚠️ LA PROPRIÉTÉ LA PLUS IMPORTANTE DE CE BLOC. L'étape 4D-2 exigeait
      // qu'une panne du calcul carbone ne rende jamais la recherche
      // d'itinéraire indisponible. La recherche appelle désormais le
      // microservice ; cette garantie doit survivre intacte.
      it('rend quand même les itinéraires quand le calcul carbone échoue', async () => {
        carbonService.calculate.mockRejectedValue(
          new Error('microservice injoignable'),
        );

        const result = await service.searchRoutes({ ...depuisA, ...versC });

        expect(result).toHaveLength(1);
        expect(result[0].segments).toHaveLength(1);
        expect(result[0].totalDurationMin).toBe(
          30 + marches(result[0]).durationMin,
        );
      });

      it('n’affiche JAMAIS 0 g à la place d’une erreur', async () => {
        carbonService.calculate.mockRejectedValue(new Error('panne'));

        const [itineraire] = await service.searchRoutes({
          ...depuisA,
          ...versC,
        });

        expect(itineraire.carbon.status).toBe('CARBON_UNAVAILABLE');
        // Tous à null, aucun à zéro : « nous ne savons pas » ne se dit pas
        // « ce trajet ne pollue pas ».
        expect(itineraire.carbon.co2Grams).toBeNull();
        expect(itineraire.carbon.carCo2Grams).toBeNull();
        expect(itineraire.carbon.savedVsCarGrams).toBeNull();
        expect(itineraire.carbon.ecoScore).toBeNull();
        expect(itineraire.carbon.reason).toEqual(expect.any(String));
      });

      it('ne divulgue rien du microservice dans le message rendu à l’usager', async () => {
        carbonService.calculate.mockRejectedValue(
          new Error('connect ECONNREFUSED 127.0.0.1:8000'),
        );

        const [itineraire] = await service.searchRoutes({
          ...depuisA,
          ...versC,
        });

        expect(itineraire.carbon.reason).not.toContain('8000');
        expect(itineraire.carbon.reason).not.toContain('ECONNREFUSED');
      });

      it('ne propose AUCUN itinéraire LOWEST_CO2 sans facteurs d’émission', async () => {
        carbonService.facteurs.mockResolvedValue(null);
        prisma.stop.findMany.mockResolvedValue([A, B, C]);
        prisma.networkLink.findMany.mockResolvedValue([aVersB, bVersC, aVersC]);

        const result = await service.searchRoutes({ ...depuisA, ...versC });

        // Un « plus écologique » qui n'a été comparé à rien serait un
        // mensonge : on préfère ne pas le proposer.
        expect(result.filter((i) => i.criterion === 'LOWEST_CO2')).toHaveLength(
          0,
        );
        // Mais la recherche, elle, fonctionne toujours.
        expect(result.length).toBeGreaterThan(0);
      });

      it('n’appelle même pas le calcul quand les facteurs sont indisponibles', async () => {
        carbonService.facteurs.mockResolvedValue(null);

        const [itineraire] = await service.searchRoutes({
          ...depuisA,
          ...versC,
        });

        // Le microservice vient déjà d'échouer : trois appels de plus
        // n'ajouteraient que trois délais d'attente à la recherche.
        expect(carbonService.calculate).not.toHaveBeenCalled();
        expect(itineraire.carbon.status).toBe('CARBON_UNAVAILABLE');
      });
    });

    // -------------------------------------------------------------------------
    // Phase 4 : géométrie réelle transmise à la carte
    // -------------------------------------------------------------------------
    describe('géométrie des segments', () => {
      it('transmet le tracé réel tel quel, en le marquant SHAPE', async () => {
        const trace = {
          type: 'LineString',
          // ⚠️ [longitude, latitude] : l'ordre GeoJSON, inverse de Leaflet.
          coordinates: [
            [2.3553, 48.8809],
            [2.347, 48.8583],
          ],
        };

        prisma.stop.findMany.mockResolvedValue([A, C]);
        prisma.networkLink.findMany.mockResolvedValue([
          { ...aVersC, geometry: trace },
        ]);

        const [itineraire] = await service.searchRoutes({
          ...depuisA,
          ...versC,
        });

        expect(itineraire.segments[0].geometry).toEqual(trace);
        expect(itineraire.segments[0].geometrySource).toBe('SHAPE');
      });

      it('annonce STRAIGHT quand le flux ne publie aucun tracé', async () => {
        prisma.stop.findMany.mockResolvedValue([A, C]);
        prisma.networkLink.findMany.mockResolvedValue([
          { ...aVersC, geometry: null },
        ]);

        const [itineraire] = await service.searchRoutes({
          ...depuisA,
          ...versC,
        });

        // La carte tracera une droite — mais elle saura que c'en est une.
        expect(itineraire.segments[0].geometry).toBeNull();
        expect(itineraire.segments[0].geometrySource).toBe('STRAIGHT');
      });

      it('expose les coordonnées des deux arrêts de chaque segment', async () => {
        prisma.stop.findMany.mockResolvedValue([A, C]);
        prisma.networkLink.findMany.mockResolvedValue([aVersC]);

        const [itineraire] = await service.searchRoutes({
          ...depuisA,
          ...versC,
        });

        expect(itineraire.segments[0]).toMatchObject({
          fromStopLat: A.latitude,
          fromStopLon: A.longitude,
          toStopLat: C.latitude,
          toStopLon: C.longitude,
        });
      });
    });

    it("propose la MARCHE quand l'arrivée n'est reliée à rien", async () => {
      prisma.stop.findMany.mockResolvedValue([A, B, C, D]);
      prisma.networkLink.findMany.mockResolvedValue([aVersB, bVersC]);

      // On cherche vers D, qui n'a aucun segment entrant.
      const result = await service.searchRoutes({
        ...depuisA,
        toLat: D.latitude,
        toLon: D.longitude,
      });

      // ⚠️ « Le réseau n'y va pas » n'est pas « on ne peut pas y aller ».
      // Aucun tronçon n'est emprunté : l'itinéraire est une marche, et il le
      // dit — `ESTIMATE`, jamais un itinéraire de rues.
      expect(result).toHaveLength(1);
      expect(result[0].segments).toEqual([]);
      expect(result[0].walkAccess?.source).toBe('ESTIMATE');
    });

    it('propose la MARCHE quand la base ne contient aucun arrêt', async () => {
      // ⚠️ « Aucun arrêt » n'est pas « aucun trajet ». Deux points peuvent se
      // rejoindre à pied dans une zone que le réseau ne dessert pas — et
      // répondre [] reviendrait à dire « impossible » à quelqu'un qui n'a
      // qu'à marcher.
      prisma.stop.findMany.mockResolvedValue([]);
      prisma.networkLink.findMany.mockResolvedValue([]);

      const result = await service.searchRoutes({ ...depuisA, ...versC });

      expect(result).toHaveLength(1);
      expect(result[0].segments).toEqual([]);
      expect(result[0].walkAccess).toMatchObject({ source: 'ESTIMATE' });
      expect(result[0].walkAccess!.distanceM).toBeGreaterThan(0);
      expect(result[0].totalDurationMin).toBeGreaterThanOrEqual(1);
    });

    it('propose la MARCHE quand le départ et l’arrivée pointent vers le même arrêt', async () => {
      // Mesuré sur le réseau réel : « 15 rue Adler » → « 2 rue Mélanie »,
      // deux cents mètres, rendait AUCUN itinéraire.
      prisma.stop.findMany.mockResolvedValue([A, C]);
      prisma.networkLink.findMany.mockResolvedValue([aVersC]);

      const result = await service.searchRoutes({
        fromLat: A.latitude,
        fromLon: A.longitude,
        toLat: A.latitude,
        toLon: A.longitude,
      });

      expect(result).toHaveLength(1);
      expect(result[0].segments).toEqual([]);
      expect(result[0].numberOfTransfers).toBe(0);
      // ⚠️ JAMAIS ZÉRO MINUTE : « 0 min » se lirait « vous y êtes ».
      expect(result[0].totalDurationMin).toBeGreaterThanOrEqual(1);
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
        // Phase 5 : l'identifiant du flux, seul moyen de rattacher une
        // perturbation GTFS-RT à la ligne réellement empruntée.
        gtfsLineId: null,
        distanceM: 3000,
        durationMin: 30,
        // Ajoutés en Phase 4 : la carte doit pouvoir tracer le trajet sans
        // redemander chaque arrêt un par un.
        fromStopLat: A.latitude,
        fromStopLon: A.longitude,
        toStopLat: C.latitude,
        toStopLon: C.longitude,
        // Cette liaison de test n'a pas de tracé : `null`, et la source le
        // dit franchement — le client tracera une droite en le sachant.
        geometry: null,
        geometrySource: 'STRAIGHT',
      });
      expect(itineraire.criterion).toBe('FASTEST');
      expect(itineraire.totalDistanceM).toBe(
        3000 + marches(itineraire).distanceM,
      );
      expect(itineraire.totalDurationMin).toBe(
        30 + marches(itineraire).durationMin,
      );
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
      // `objectContaining` : la requête porte désormais un `where` de
      // BORNAGE SPATIAL (refonte mobilité). Ce test-ci vérifie qu'il n'y a
      // qu'UNE requête, jointure comprise — pas la forme du filtre, qui a
      // ses propres tests.
      expect(prisma.networkLink.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { id: 'asc' },
          include: { line: true },
        }),
      );
    });

    // -------------------------------------------------------------------------
    // Bornage spatial (refonte mobilité)
    // -------------------------------------------------------------------------
    describe('bornage spatial', () => {
      it('NE CHARGE PAS tout le réseau : un cadre est imposé', async () => {
        prisma.stop.findMany.mockResolvedValue([A, C]);
        prisma.networkLink.findMany.mockResolvedValue([aVersC]);

        await service.searchRoutes({ ...depuisA, ...versC });

        // C'est ce qui rend l'ajout du bus et du RER possible : sans cadre,
        // chaque recherche balaierait ~50 000 arrêts et 100 000 liaisons.
        const appel = (
          prisma.stop.findMany.mock.calls as unknown[][]
        )[0][0] as {
          where?: { latitude?: unknown; longitude?: unknown };
        };

        expect(appel.where).toBeDefined();
        expect(appel.where?.latitude).toBeDefined();
        expect(appel.where?.longitude).toBeDefined();
      });

      it('encadre les DEUX points, origine comme destination', async () => {
        prisma.stop.findMany.mockResolvedValue([A, C]);
        prisma.networkLink.findMany.mockResolvedValue([aVersC]);

        await service.searchRoutes({
          fromLat: 48.85,
          fromLon: 2.35,
          toLat: 48.88,
          toLon: 2.37,
        });

        const where = (
          (prisma.stop.findMany.mock.calls as unknown[][])[0][0] as {
            where: { latitude: { gte: number; lte: number } };
          }
        ).where;

        // Le cadre contient les deux extrémités, avec de la marge de part et
        // d'autre : un itinéraire peut légitimement déborder du rectangle.
        expect(where.latitude.gte).toBeLessThan(48.85);
        expect(where.latitude.lte).toBeGreaterThan(48.88);
      });

      it('exige que les DEUX extrémités d’une liaison soient dans le cadre', async () => {
        prisma.stop.findMany.mockResolvedValue([A, C]);
        prisma.networkLink.findMany.mockResolvedValue([aVersC]);

        await service.searchRoutes({ ...depuisA, ...versC });

        // Une liaison dont l'autre bout est hors zone mènerait à un sommet
        // absent du graphe — Dijkstra suivrait une arête vers nulle part.
        const appel = (
          prisma.networkLink.findMany.mock.calls as unknown[][]
        )[0][0] as {
          where: { fromStop?: unknown; toStop?: unknown };
        };

        expect(appel.where.fromStop).toBeDefined();
        expect(appel.where.toStop).toBeDefined();
      });

      it('applique le MÊME cadre aux arrêts et aux liaisons', async () => {
        prisma.stop.findMany.mockResolvedValue([A, C]);
        prisma.networkLink.findMany.mockResolvedValue([aVersC]);

        await service.searchRoutes({ ...depuisA, ...versC });

        // Deux cadres différents laisseraient des arrêts sans liaison, ou
        // l'inverse : le graphe serait incohérent.
        const cadreArrets = (
          (prisma.stop.findMany.mock.calls as unknown[][])[0][0] as {
            where: unknown;
          }
        ).where;
        const cadreLiaisons = (
          (prisma.networkLink.findMany.mock.calls as unknown[][])[0][0] as {
            where: { fromStop: unknown };
          }
        ).where.fromStop;

        expect(cadreLiaisons).toEqual(cadreArrets);
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
      // A→C    : 3000 m / 30 min  → le plus DIRECT (aucun changement)
      // A→E→C  : 2000 m / 50 min  → entièrement à pied, donc le moins ÉMETTEUR
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
      const propre = result.find((i) => i.criterion === 'LOWEST_CO2');

      // Le plus rapide est bien le minimum des trois durées (20 < 30 < 50).
      expect(rapide!.totalDurationMin).toBe(20 + marches(rapide!).durationMin);

      // ⚠️ AUCUN itinéraire FEWEST_TRANSFERS ici, et c'est CORRECT : le plus
      // rapide (A→B à pied, puis le bus 38) ne comporte lui non plus aucun
      // changement, la marche n'en étant pas un. Les deux critères désignent
      // le même trajet, qui n'est donc rendu qu'une fois.
      expect(rapide?.numberOfTransfers).toBe(0);
      expect(
        result.filter((i) => i.criterion === 'FEWEST_TRANSFERS'),
      ).toHaveLength(0);

      // Le moins émetteur est A→E→C, entièrement à pied : deux liaisons WALK
      // à 0 g/km, contre du BUS à 113 g/km sur les deux autres trajets.
      // ⚠️ Ce n'est PAS l'effet d'un Dijkstra minimisant les grammes — celui-ci
      // choisirait toujours de tout faire à pied. C'est une SÉLECTION parmi
      // des trajets réels : ici, le plus rapide sans bus se trouve être ce
      // trajet-là.
      expect(propre?.segments.every((s) => s.mode === 'WALK')).toBe(true);
      expect(propre!.totalDistanceM).toBe(2000 + marches(propre!).distanceM);
    });

    it('propose la MARCHE quand le point de départ est trop loin de tout arrêt', async () => {
      prisma.stop.findMany.mockResolvedValue([A, B, C]);
      prisma.networkLink.findMany.mockResolvedValue([aVersB, bVersC]);

      // 0,025° de latitude ≈ 2,8 km : au-delà du rayon de 2 km.
      const result = await service.searchRoutes({
        fromLat: A.latitude + 0.025,
        fromLon: A.longitude,
        ...versC,
      });

      // Le réseau ne dessert pas ce point : reste la marche, annoncée comme
      // une estimation.
      expect(result).toHaveLength(1);
      expect(result[0].segments).toEqual([]);
      expect(result[0].walkAccess?.source).toBe('ESTIMATE');
    });

    it('propose la MARCHE quand la destination est trop loin de tout arrêt', async () => {
      prisma.stop.findMany.mockResolvedValue([A, B, C]);
      prisma.networkLink.findMany.mockResolvedValue([aVersB, bVersC]);

      const result = await service.searchRoutes({
        ...depuisA,
        toLat: C.latitude + 0.025,
        toLon: C.longitude,
      });

      expect(result).toHaveLength(1);
      expect(result[0].segments).toEqual([]);
      expect(result[0].walkAccess?.source).toBe('ESTIMATE');
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
        expect(prisma.networkLink.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            orderBy: { id: 'asc' },
            include: { line: true },
          }),
        );
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
        const propre = result.find((i) => i.criterion === 'LOWEST_CO2');

        // Le plus rapide est le bus (30 min contre 45), le moins émetteur la
        // marche (0 g/km contre 113) : les deux liaisons ont donc bien été
        // prises en compte séparément.
        expect(rapide!.totalDurationMin).toBe(
          30 + marches(rapide!).durationMin,
        );
        expect(rapide?.segments[0].mode).toBe('BUS');
        expect(propre?.segments[0].mode).toBe('WALK');
        expect(propre!.totalDistanceM).toBe(2000 + marches(propre!).distanceM);
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

      it('ignore les trajets personnels : sans réseau public, aucun TRONÇON', async () => {
        prisma.stop.findMany.mockResolvedValue([A, B, C]);
        // Le réseau public est VIDE...
        prisma.networkLink.findMany.mockResolvedValue([]);
        // ...alors qu'un usager a bien enregistré des segments entre ces
        // mêmes arrêts. Avant 4C-3, ces segments auraient alimenté le
        // graphe public. Ce ne doit plus être le cas.
        prisma.segment.findMany.mockResolvedValue([aVersB, bVersC]);

        const result = await service.searchRoutes({ ...depuisA, ...versC });

        // ⚠️ LA GARANTIE PORTE SUR LES TRONÇONS, PAS SUR LE NOMBRE DE
        // RÉPONSES. Depuis que la marche est proposée en dernier recours, la
        // réponse n'est plus vide — mais elle ne contient TOUJOURS aucun
        // tronçon, donc rien qui puisse venir du trajet d'un usager.
        expect(result).toHaveLength(1);
        expect(result[0].segments).toEqual([]);
        expect(JSON.stringify(result)).not.toContain(B.id);
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
        expect(result[0].totalDurationMin).toBe(
          30 + marches(result[0]).durationMin,
        );
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
