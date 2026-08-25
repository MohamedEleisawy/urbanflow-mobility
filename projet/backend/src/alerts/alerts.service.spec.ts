import { AlertSeverity, ModeTransport, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ALERTS_LIMIT, AlertsService } from './alerts.service';

// Aucun accès à PostgreSQL : Prisma est doublé, et l'instant de référence est
// FIXÉ. C'est ce qui permet d'éprouver les bornes à la milliseconde près —
// impossible avec `new Date()`, et sans avoir à figer les timers, ce qui
// perturberait Prisma et le serveur HTTP en e2e.
const MAINTENANT = new Date('2026-08-25T12:00:00.000Z');

/// Une ligne d'alerte telle que la rend la base, avec le `select` du service.
const enBase = (
  gtfsAlertId: string,
  surcharge: Partial<{
    severity: AlertSeverity;
    startTime: Date;
    endTime: Date | null;
    lineIds: string[];
    stopIds: string[];
    headerText: string | null;
    descriptionText: string | null;
  }> = {},
) => ({
  gtfsAlertId,
  headerText: 'Travaux ligne A',
  descriptionText: null,
  stopIds: [],
  lineIds: [],
  affectedMode: ModeTransport.BUS,
  severity: AlertSeverity.WARNING,
  cause: 'MAINTENANCE',
  effect: 'REDUCED_SERVICE',
  startTime: new Date('2026-08-25T10:00:00.000Z'),
  endTime: null,
  ...surcharge,
});

describe('AlertsService', () => {
  let service: AlertsService;
  let trouverAlertes: jest.Mock;
  let trouverLignes: jest.Mock;

  beforeEach(() => {
    trouverAlertes = jest.fn().mockResolvedValue([]);
    trouverLignes = jest.fn().mockResolvedValue([]);

    service = new AlertsService({
      alert: { findMany: trouverAlertes },
      transitLine: { findMany: trouverLignes },
    } as unknown as PrismaService);
  });

  /// Options réellement passées à `prisma.alert.findMany`.
  const requete = (): Prisma.AlertFindManyArgs => {
    const appels = trouverAlertes.mock.calls as Prisma.AlertFindManyArgs[][];
    return appels[0][0];
  };

  // ---------------------------------------------------------------------------
  // La requête envoyée à PostgreSQL
  // ---------------------------------------------------------------------------
  describe('requête Prisma', () => {
    it('ne retient que les alertes déjà commencées', async () => {
      await service.findActive(MAINTENANT);

      // Borne de début INCLUSIVE : `lte`, pas `lt`.
      expect(requete().where).toMatchObject({ startTime: { lte: MAINTENANT } });
    });

    it('retient les alertes sans fin, ou dont la fin est à venir', async () => {
      await service.findActive(MAINTENANT);

      // Borne de fin EXCLUSIVE : `gt`, pas `gte`. L'intervalle est donc
      // [startTime, endTime[, comme les semaines ISO de 4E-5B.
      expect(requete().where?.OR).toEqual([
        { endTime: null },
        { endTime: { gt: MAINTENANT } },
      ]);
    });

    it('demande un élément de plus que le plafond', async () => {
      await service.findActive(MAINTENANT);

      // 201 suffit à savoir s'il en existait d'autres, sans requête de
      // comptage supplémentaire.
      expect(requete().take).toBe(ALERTS_LIMIT + 1);
    });

    it('impose un ordre déterministe en base', async () => {
      await service.findActive(MAINTENANT);

      // Cet ordre-ci sert à CHOISIR les bonnes lignes sous le plafond : sans
      // `severity`, 200 alertes mineures récentes évinceraient une coupure
      // totale annoncée le matin même.
      expect(requete().orderBy).toEqual([
        { severity: 'desc' },
        { startTime: 'desc' },
        { gtfsAlertId: 'asc' },
      ]);
    });

    it("n'extrait jamais l'UUID interne", async () => {
      await service.findActive(MAINTENANT);

      const colonnes = requete().select as Record<string, boolean>;

      // Le `select` explicite est ce qui rend la fuite IMPOSSIBLE, plutôt que
      // simplement improbable.
      expect(colonnes.id).toBeUndefined();
      expect(colonnes.gtfsAlertId).toBe(true);
    });

    it('date la requête de lui-même quand aucun instant n’est donné', async () => {
      const avant = Date.now();
      await service.findActive();
      const apres = Date.now();

      const borne = (requete().where?.startTime as { lte: Date }).lte;
      expect(borne.getTime()).toBeGreaterThanOrEqual(avant);
      expect(borne.getTime()).toBeLessThanOrEqual(apres);
    });
  });

  // ---------------------------------------------------------------------------
  // Les bornes temporelles, vues du service
  // ---------------------------------------------------------------------------
  //
  // La sélection se fait en base : ces tests vérifient donc les BORNES que le
  // service demande, en les confrontant à des cas concrets. C'est ce que
  // l'instant fixe rend possible.
  describe('bornes temporelles', () => {
    const borneDebut = () =>
      (requete().where?.startTime as { lte: Date }).lte.getTime();
    const borneFin = () =>
      (
        requete().where?.OR as { endTime: { gt: Date } }[]
      )[1].endTime.gt.getTime();

    it('inclut une alerte commençant exactement maintenant', async () => {
      await service.findActive(MAINTENANT);

      // startTime === maintenant satisfait `lte` : la perturbation qui
      // commence à l'instant est en cours.
      expect(MAINTENANT.getTime()).toBeLessThanOrEqual(borneDebut());
    });

    it('exclut une alerte finissant exactement maintenant', async () => {
      await service.findActive(MAINTENANT);

      // endTime === maintenant ne satisfait PAS `gt` : à 14h00 précises,
      // « travaux jusqu'à 14h » est terminé.
      expect(MAINTENANT.getTime()).not.toBeGreaterThan(borneFin());
    });
  });

  // ---------------------------------------------------------------------------
  // Le contenu de la réponse
  // ---------------------------------------------------------------------------
  describe('réponse', () => {
    it('rend une liste vide quand le réseau fonctionne', async () => {
      const reponse = await service.findActive(MAINTENANT);

      // « Aucune perturbation » est une réponse, pas une erreur.
      expect(reponse).toEqual({
        items: [],
        limit: ALERTS_LIMIT,
        truncated: false,
      });
    });

    it('expose gtfsAlertId comme identifiant public', async () => {
      trouverAlertes.mockResolvedValue([enBase('alerte-1')]);

      const { items } = await service.findActive(MAINTENANT);

      expect(items[0].id).toBe('alerte-1');
      // Et l'objet rendu ne contient AUCUNE autre clé d'identité.
      expect(Object.keys(items[0])).not.toContain('gtfsAlertId');
    });

    it('rend tous les champs attendus par un voyageur', async () => {
      trouverAlertes.mockResolvedValue([
        enBase('alerte-1', {
          stopIds: ['STOP_1'],
          endTime: new Date('2026-08-25T14:00:00.000Z'),
          descriptionText: 'Service réduit.',
        }),
      ]);

      const { items } = await service.findActive(MAINTENANT);

      expect(items[0]).toEqual({
        id: 'alerte-1',
        headerText: 'Travaux ligne A',
        descriptionText: 'Service réduit.',
        stopIds: ['STOP_1'],
        lines: [],
        mode: ModeTransport.BUS,
        severity: AlertSeverity.WARNING,
        cause: 'MAINTENANCE',
        effect: 'REDUCED_SERVICE',
        startTime: new Date('2026-08-25T10:00:00.000Z'),
        endTime: new Date('2026-08-25T14:00:00.000Z'),
      });
    });

    it('transmet endTime à null sans rien inventer', async () => {
      trouverAlertes.mockResolvedValue([enBase('alerte-1', { endTime: null })]);

      const { items } = await service.findActive(MAINTENANT);

      expect(items[0].endTime).toBeNull();
    });

    it('transmet des textes absents sans les fabriquer', async () => {
      trouverAlertes.mockResolvedValue([
        enBase('alerte-1', { headerText: null, descriptionText: null }),
      ]);

      const { items } = await service.findActive(MAINTENANT);

      // Aucun texte reconstitué depuis cause/effect : ce serait notre phrase
      // présentée comme celle de l'opérateur.
      expect(items[0].headerText).toBeNull();
      expect(items[0].descriptionText).toBeNull();
      expect(items[0].cause).toBe('MAINTENANCE');
    });
  });

  // ---------------------------------------------------------------------------
  // Le tri
  // ---------------------------------------------------------------------------
  describe('tri', () => {
    it('place le plus grave en tête', async () => {
      // Volontairement rendus dans le désordre par la base : c'est le
      // service qui doit trancher, pas l'ordre d'arrivée.
      trouverAlertes.mockResolvedValue([
        enBase('b', { severity: AlertSeverity.INFO }),
        enBase('a', { severity: AlertSeverity.SEVERE }),
        enBase('c', { severity: AlertSeverity.WARNING }),
      ]);

      const { items } = await service.findActive(MAINTENANT);

      expect(items.map((a) => a.severity)).toEqual([
        AlertSeverity.SEVERE,
        AlertSeverity.WARNING,
        AlertSeverity.INFO,
      ]);
    });

    it('classe la plus récente en premier à gravité égale', async () => {
      trouverAlertes.mockResolvedValue([
        enBase('ancienne', { startTime: new Date('2026-08-25T08:00:00Z') }),
        enBase('recente', { startTime: new Date('2026-08-25T11:00:00Z') }),
      ]);

      const { items } = await service.findActive(MAINTENANT);

      expect(items.map((a) => a.id)).toEqual(['recente', 'ancienne']);
    });

    it('départage par identifiant à gravité et heure égales', async () => {
      trouverAlertes.mockResolvedValue([
        enBase('zebre'),
        enBase('alpha'),
        enBase('midi'),
      ]);

      const { items } = await service.findActive(MAINTENANT);

      // Sans ce troisième critère, l'ordre serait laissé à PostgreSQL, donc
      // instable — et le test de déterminisme échouerait par intermittence.
      expect(items.map((a) => a.id)).toEqual(['alpha', 'midi', 'zebre']);
    });

    it('fait primer la gravité sur la date', async () => {
      trouverAlertes.mockResolvedValue([
        enBase('info-recente', {
          severity: AlertSeverity.INFO,
          startTime: new Date('2026-08-25T11:59:00Z'),
        }),
        enBase('grave-ancienne', {
          severity: AlertSeverity.SEVERE,
          startTime: new Date('2026-08-25T06:00:00Z'),
        }),
      ]);

      const { items } = await service.findActive(MAINTENANT);

      // Une liste de perturbations est une liste de TRIAGE : une coupure
      // totale annoncée à 6h passe avant une info publiée il y a une minute.
      expect(items.map((a) => a.id)).toEqual([
        'grave-ancienne',
        'info-recente',
      ]);
    });

    it('rend deux fois exactement le même ordre', async () => {
      const lignes = [
        enBase('c', { severity: AlertSeverity.INFO }),
        enBase('a', { severity: AlertSeverity.SEVERE }),
        enBase('b', { severity: AlertSeverity.SEVERE }),
      ];
      trouverAlertes.mockResolvedValue(lignes);

      const premier = await service.findActive(MAINTENANT);
      const second = await service.findActive(MAINTENANT);

      expect(second).toEqual(premier);
    });

    it("n'hérite pas silencieusement de l'ordre de déclaration de l'enum", () => {
      // GARDE-FOU. PostgreSQL trie un enum selon son ordre de DÉCLARATION —
      // aujourd'hui INFO, WARNING, SEVERE. Le service s'appuie sur cet ordre
      // en base pour choisir les bonnes lignes sous le plafond, mais la
      // priorité affichée, elle, est écrite explicitement dans le service.
      //
      // Les deux doivent rester d'accord : si quelqu'un réordonnait l'enum,
      // le plafond retiendrait les mauvaises alertes sans que rien ne le
      // signale. Ce test rend l'accident impossible.
      const declare = Object.values(AlertSeverity);

      expect(declare).toEqual([
        AlertSeverity.INFO,
        AlertSeverity.WARNING,
        AlertSeverity.SEVERE,
      ]);
    });
  });

  // ---------------------------------------------------------------------------
  // Le plafond
  // ---------------------------------------------------------------------------
  describe('plafond', () => {
    const beaucoup = (nombre: number) =>
      Array.from({ length: nombre }, (_, i) =>
        enBase(`alerte-${String(i).padStart(4, '0')}`),
      );

    it('annonce son plafond même sans troncature', async () => {
      trouverAlertes.mockResolvedValue([enBase('alerte-1')]);

      const reponse = await service.findActive(MAINTENANT);

      // `truncated` est TOUJOURS présent : sans lui, le client ne peut pas
      // distinguer « voici tout » de « en voici 200 sur 3 000 ».
      expect(reponse.limit).toBe(ALERTS_LIMIT);
      expect(reponse.truncated).toBe(false);
    });

    it('ne tronque pas à exactement 200 alertes', async () => {
      trouverAlertes.mockResolvedValue(beaucoup(ALERTS_LIMIT));

      const reponse = await service.findActive(MAINTENANT);

      expect(reponse.items).toHaveLength(ALERTS_LIMIT);
      expect(reponse.truncated).toBe(false);
    });

    it('tronque à 200 et le signale au-delà', async () => {
      // 201 lignes rendues : c'est précisément ce que `take: 201` permet de
      // détecter.
      trouverAlertes.mockResolvedValue(beaucoup(ALERTS_LIMIT + 1));

      const reponse = await service.findActive(MAINTENANT);

      expect(reponse.items).toHaveLength(ALERTS_LIMIT);
      expect(reponse.truncated).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // La résolution des noms de ligne
  // ---------------------------------------------------------------------------
  describe('noms de ligne', () => {
    it('remplace un identifiant GTFS par le nom affiché', async () => {
      trouverAlertes.mockResolvedValue([
        enBase('alerte-1', { lineIds: ['ROUTE_A'] }),
      ]);
      trouverLignes.mockResolvedValue([
        { gtfsRouteId: 'ROUTE_A', name: 'Bus 38' },
      ]);

      const { items } = await service.findActive(MAINTENANT);

      // L'usager doit lire « Bus 38 », pas « ROUTE_A » — l'exigence déjà
      // posée en 4E-2 pour la recherche d'itinéraire.
      expect(items[0].lines).toEqual([{ id: 'ROUTE_A', name: 'Bus 38' }]);
    });

    it('conserve un identifiant absent du référentiel, sans nom', async () => {
      trouverAlertes.mockResolvedValue([
        enBase('alerte-1', { lineIds: ['ROUTE_INCONNUE'] }),
      ]);
      trouverLignes.mockResolvedValue([]);

      const { items } = await service.findActive(MAINTENANT);

      // Un flux temps réel peut citer une ligne créée après notre dernier
      // import statique. Mieux vaut « perturbation sur ROUTE_INCONNUE » que
      // le silence.
      expect(items[0].lines).toEqual([{ id: 'ROUTE_INCONNUE', name: null }]);
    });

    it('ne fait AUCUNE requête quand aucune ligne n’est citée', async () => {
      trouverAlertes.mockResolvedValue([enBase('alerte-1', { lineIds: [] })]);

      await service.findActive(MAINTENANT);

      expect(trouverLignes).not.toHaveBeenCalled();
    });

    it('résout dix alertes en UNE seule requête', async () => {
      trouverAlertes.mockResolvedValue(
        Array.from({ length: 10 }, (_, i) =>
          enBase(`alerte-${i}`, { lineIds: ['ROUTE_A', 'ROUTE_B'] }),
        ),
      );
      trouverLignes.mockResolvedValue([
        { gtfsRouteId: 'ROUTE_A', name: 'A' },
        { gtfsRouteId: 'ROUTE_B', name: 'B' },
      ]);

      await service.findActive(MAINTENANT);

      // LE POINT DU N+1 : une requête, pas dix.
      expect(trouverLignes).toHaveBeenCalledTimes(1);
    });

    it('ne demande chaque ligne qu’une fois, même citée dix fois', async () => {
      trouverAlertes.mockResolvedValue(
        Array.from({ length: 10 }, (_, i) =>
          enBase(`alerte-${i}`, { lineIds: ['ROUTE_A'] }),
        ),
      );
      trouverLignes.mockResolvedValue([{ gtfsRouteId: 'ROUTE_A', name: 'A' }]);

      await service.findActive(MAINTENANT);

      const appels = trouverLignes.mock.calls as {
        where: { gtfsRouteId: { in: string[] } };
      }[][];
      expect(appels[0][0].where.gtfsRouteId.in).toEqual(['ROUTE_A']);
    });

    it('résout plusieurs lignes sur une même alerte', async () => {
      trouverAlertes.mockResolvedValue([
        enBase('alerte-1', { lineIds: ['ROUTE_A', 'ROUTE_B'] }),
      ]);
      trouverLignes.mockResolvedValue([
        { gtfsRouteId: 'ROUTE_B', name: 'B' },
        { gtfsRouteId: 'ROUTE_A', name: 'A' },
      ]);

      const { items } = await service.findActive(MAINTENANT);

      // L'ordre suit celui de l'alerte, pas celui de la base.
      expect(items[0].lines).toEqual([
        { id: 'ROUTE_A', name: 'A' },
        { id: 'ROUTE_B', name: 'B' },
      ]);
    });
  });
});
