import { PrismaService } from '../prisma/prisma.service';
import { CarbonTrackingService } from './carbon-tracking.service';
import { WeeklyTrackingQueryDto } from './dto/weekly-tracking-query.dto';

// Même approche que les autres services : PrismaService est simulé, seules
// les méthodes réellement utilisées sont mockées.
describe('CarbonTrackingService', () => {
  let service: CarbonTrackingService;
  let prisma: { carbonRecord: { findMany: jest.Mock } };

  const MOI = 'user-1';

  // Trois dates de la MÊME semaine ISO (35 de 2026 : lundi 24 → dimanche 30),
  // puis une de la semaine précédente et une de l'année d'avant.
  const LUNDI_S35 = new Date('2026-08-24T08:00:00.000Z');
  const DIMANCHE_S35 = new Date('2026-08-30T21:00:00.000Z');
  const LUNDI_S34 = new Date('2026-08-17T08:00:00.000Z');

  const enregistrement = (
    date: Date,
    routeId: string,
    co2Grams: number,
    savedVsCarGrams: number,
  ) => ({ date, routeId, co2Grams, savedVsCarGrams });

  const parDefaut = () => new WeeklyTrackingQueryDto();

  beforeEach(() => {
    prisma = { carbonRecord: { findMany: jest.fn().mockResolvedValue([]) } };
    service = new CarbonTrackingService(prisma as unknown as PrismaService);
  });

  // ---------------------------------------------------------------------------
  // La requête envoyée à Prisma
  // ---------------------------------------------------------------------------
  describe('requête', () => {
    it("ne demande que les enregistrements de l'usager", async () => {
      await service.findWeeklyForUser(MOI, parDefaut());

      const options = (
        prisma.carbonRecord.findMany.mock.calls as [
          { where: { userId: string } },
        ][]
      )[0][0];

      // Le filtre est fait EN BASE : tout ramener puis filtrer en mémoire
      // ferait transiter les données des autres usagers.
      expect(options.where.userId).toBe(MOI);
    });

    it('borne la requête à la fenêtre demandée', async () => {
      await service.findWeeklyForUser(MOI, { weeks: 4 });

      const options = (
        prisma.carbonRecord.findMany.mock.calls as [
          { where: { date: { gte: Date } } },
        ][]
      )[0][0];

      // Sans cette borne, la requête ramènerait tout l'historique.
      expect(options.where.date.gte).toBeInstanceOf(Date);
      // Le début de fenêtre est un lundi à minuit UTC.
      expect(options.where.date.gte.getUTCDay()).toBe(1);
      expect(options.where.date.gte.getUTCHours()).toBe(0);
    });

    it('ne charge que les quatre colonnes utiles', async () => {
      await service.findWeeklyForUser(MOI, parDefaut());

      const options = (
        prisma.carbonRecord.findMany.mock.calls as [
          { select: Record<string, boolean> },
        ][]
      )[0][0];

      expect(Object.keys(options.select).sort()).toEqual([
        'co2Grams',
        'date',
        'routeId',
        'savedVsCarGrams',
      ]);
    });

    it('interroge la base une seule fois', async () => {
      await service.findWeeklyForUser(MOI, parDefaut());

      expect(prisma.carbonRecord.findMany).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // L'agrégation
  // ---------------------------------------------------------------------------
  describe('agrégation', () => {
    it('somme le CO2 et les économies d’une semaine', async () => {
      prisma.carbonRecord.findMany.mockResolvedValue([
        enregistrement(LUNDI_S35, 'route-1', 361.6, 336.0),
        enregistrement(LUNDI_S35, 'route-1', 0, 130.8),
      ]);

      const resultat = await service.findWeeklyForUser(MOI, parDefaut());

      expect(resultat.weeks).toHaveLength(1);
      expect(resultat.weeks[0]).toEqual({
        year: 2026,
        week: 35,
        co2Grams: 361.6,
        savedVsCarGrams: 466.8,
        tripCount: 1,
      });
    });

    it('regroupe le lundi et le dimanche dans la MÊME semaine', async () => {
      // La frontière de semaine ISO : lundi 24 et dimanche 30 août 2026.
      prisma.carbonRecord.findMany.mockResolvedValue([
        enregistrement(LUNDI_S35, 'route-1', 100, 200),
        enregistrement(DIMANCHE_S35, 'route-2', 50, 80),
      ]);

      const resultat = await service.findWeeklyForUser(MOI, parDefaut());

      expect(resultat.weeks).toHaveLength(1);
      expect(resultat.weeks[0].tripCount).toBe(2);
      expect(resultat.weeks[0].co2Grams).toBe(150);
    });

    it('sépare deux semaines distinctes', async () => {
      prisma.carbonRecord.findMany.mockResolvedValue([
        enregistrement(LUNDI_S34, 'route-1', 100, 200),
        enregistrement(LUNDI_S35, 'route-2', 50, 80),
      ]);

      const resultat = await service.findWeeklyForUser(MOI, parDefaut());

      expect(resultat.weeks.map((s) => s.week)).toEqual([35, 34]);
    });

    it('trie de la semaine la plus récente à la plus ancienne', async () => {
      // Deux années : le tri doit porter sur l'année PUIS la semaine, sinon
      // la semaine 52 de 2025 passerait devant la semaine 2 de 2026.
      prisma.carbonRecord.findMany.mockResolvedValue([
        enregistrement(new Date('2026-01-08T08:00:00.000Z'), 'r1', 10, 10),
        enregistrement(new Date('2025-12-22T08:00:00.000Z'), 'r2', 10, 10),
        enregistrement(new Date('2026-01-15T08:00:00.000Z'), 'r3', 10, 10),
      ]);

      const resultat = await service.findWeeklyForUser(MOI, parDefaut());

      expect(resultat.weeks.map((s) => `${s.year}-S${s.week}`)).toEqual([
        '2026-S3',
        '2026-S2',
        '2025-S52',
      ]);
    });

    it('arrondit les totaux à deux décimales', async () => {
      // 0,1 + 0,2 vaut 0.30000000000000004 en arithmétique flottante.
      prisma.carbonRecord.findMany.mockResolvedValue([
        enregistrement(LUNDI_S35, 'route-1', 0.1, 0),
        enregistrement(LUNDI_S35, 'route-1', 0.2, 0),
      ]);

      const resultat = await service.findWeeklyForUser(MOI, parDefaut());

      expect(resultat.weeks[0].co2Grams).toBe(0.3);
    });
  });

  // ---------------------------------------------------------------------------
  // tripCount : le point sensible
  // ---------------------------------------------------------------------------
  describe('comptage des trajets', () => {
    it('compte UN trajet pour trois segments de la même route', async () => {
      // LE test de cette étape. Il existe un CarbonRecord par SEGMENT
      // (décision 4E) : compter les lignes donnerait 3 trajets au lieu d'1.
      prisma.carbonRecord.findMany.mockResolvedValue([
        enregistrement(LUNDI_S35, 'route-1', 0, 130.8),
        enregistrement(LUNDI_S35, 'route-1', 361.6, 336.0),
        enregistrement(LUNDI_S35, 'route-1', 0, 109.0),
      ]);

      const resultat = await service.findWeeklyForUser(MOI, parDefaut());

      expect(resultat.weeks[0].tripCount).toBe(1);
    });

    it('compte des routes distinctes séparément', async () => {
      prisma.carbonRecord.findMany.mockResolvedValue([
        enregistrement(LUNDI_S35, 'route-1', 10, 10),
        enregistrement(LUNDI_S35, 'route-1', 10, 10),
        enregistrement(LUNDI_S35, 'route-2', 10, 10),
        enregistrement(LUNDI_S35, 'route-3', 10, 10),
      ]);

      const resultat = await service.findWeeklyForUser(MOI, parDefaut());

      expect(resultat.weeks[0].tripCount).toBe(3);
      // Les sommes, elles, portent bien sur les QUATRE enregistrements.
      expect(resultat.weeks[0].co2Grams).toBe(40);
    });

    it('compte séparément la même route dans deux semaines', async () => {
      // Cas de bord : une route ne peut appartenir qu'à une semaine, mais
      // le Set ne doit pas être partagé entre les semaines.
      prisma.carbonRecord.findMany.mockResolvedValue([
        enregistrement(LUNDI_S34, 'route-1', 10, 10),
        enregistrement(LUNDI_S35, 'route-2', 10, 10),
      ]);

      const resultat = await service.findWeeklyForUser(MOI, parDefaut());

      expect(resultat.weeks.map((s) => s.tripCount)).toEqual([1, 1]);
    });
  });

  // ---------------------------------------------------------------------------
  // Enveloppe et cas vides
  // ---------------------------------------------------------------------------
  describe('réponse', () => {
    it('renvoie une liste vide sans erreur quand il n’y a aucun trajet', async () => {
      const resultat = await service.findWeeklyForUser(MOI, parDefaut());

      expect(resultat).toEqual({ weeks: [], weeksRequested: 12 });
    });

    it('rappelle la fenêtre effectivement appliquée', async () => {
      const resultat = await service.findWeeklyForUser(MOI, { weeks: 4 });

      // Sans ce rappel, le client ne peut pas distinguer « voici tout » de
      // « voici les 4 dernières semaines ».
      expect(resultat.weeksRequested).toBe(4);
    });

    it('n’invente aucune semaine vide', async () => {
      // Deux semaines séparées par un trou : la semaine intermédiaire ne
      // doit pas apparaître à zéro (décision validée en conception).
      prisma.carbonRecord.findMany.mockResolvedValue([
        enregistrement(new Date('2026-08-03T08:00:00.000Z'), 'r1', 10, 10),
        enregistrement(LUNDI_S35, 'r2', 10, 10),
      ]);

      const resultat = await service.findWeeklyForUser(MOI, parDefaut());

      expect(resultat.weeks.map((s) => s.week)).toEqual([35, 32]);
    });
  });
});
