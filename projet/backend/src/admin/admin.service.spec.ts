// `@Type()` de class-transformer, employé par `PaginationQueryDto`, lit des
// metadata de conception : sans `reflect-metadata`, instancier le DTO lève
// « Reflect.getMetadata is not a function ».
//
// L'application le charge transitivement via `@nestjs/core` (main.ts), et les
// autres tests unitaires n'instancient aucune classe décorée — d'où cet
// import LOCAL plutôt qu'un fichier de configuration partagé, qui
// l'imposerait à toute la suite pour un seul fichier.
import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaginationQueryDto } from '../routes/dto/pagination-query.dto';
import { UsersService } from '../users/users.service';
import { AdminService } from './admin.service';

// =============================================================================
// Liste des comptes pour l'administration (étape 6-3)
// =============================================================================
// PrismaService est simulé : seules `user.count` et `user.findMany` sont
// employées. C'est un test unitaire, pas un test d'intégration — la
// persistance réelle et la protection par rôle sont éprouvées en e2e.
// =============================================================================

describe('AdminService', () => {
  let service: AdminService;
  let prisma: {
    user: { count: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock };
    route: { aggregate: jest.Mock };
    carbonRecord: { aggregate: jest.Mock };
    segment: { groupBy: jest.Mock };
  };
  let users: { softDeleteAccount: jest.Mock };

  /// Arguments passés à Prisma, typés pour que les assertions le restent :
  /// `mock.calls[0][0]` est `any`, et une faute de frappe dans un nom de
  /// champ passerait sinon inaperçue.
  interface AppelPrisma {
    where?: Record<string, unknown>;
    select?: Record<string, boolean>;
    orderBy?: Record<string, string>[];
    skip?: number;
    take?: number;
  }

  const premierAppel = (mock: jest.Mock): AppelPrisma => {
    const appels = mock.mock.calls as AppelPrisma[][];
    return appels[0][0];
  };

  /// Construit un DTO de pagination comme le ferait le ValidationPipe : les
  /// valeurs par défaut sont portées par les propriétés de la classe.
  const pagination = (surcharge: Partial<PaginationQueryDto> = {}) =>
    Object.assign(new PaginationQueryDto(), surcharge);

  beforeEach(() => {
    prisma = {
      user: {
        count: jest.fn(),
        findMany: jest.fn(),
        // Ajoutée à l'étape 6-4 : `deleteUser` vérifie l'existence de la
        // cible avant d'agir.
        findUnique: jest.fn(),
      },
      // Ajoutes a l'etape 6-5 : les statistiques n'emploient QUE des
      // agregations — aucun `findMany`, aucun calcul en memoire.
      route: { aggregate: jest.fn() },
      carbonRecord: { aggregate: jest.fn() },
      segment: { groupBy: jest.fn() },
    };
    prisma.user.count.mockResolvedValue(0);
    prisma.user.findMany.mockResolvedValue([]);
    prisma.route.aggregate.mockResolvedValue({
      _count: { _all: 0 },
      _sum: { totalDistanceM: null },
    });
    prisma.carbonRecord.aggregate.mockResolvedValue({
      _count: { _all: 0 },
      _sum: { co2Grams: null, savedVsCarGrams: null },
    });
    prisma.segment.groupBy.mockResolvedValue([]);

    // La suppression logique appartient à `UsersService` : ce test vérifie
    // qu'elle est APPELÉE, pas ce qu'elle fait — c'est le rôle de
    // `users.service.spec.ts`.
    users = { softDeleteAccount: jest.fn() };

    service = new AdminService(
      prisma as unknown as PrismaService,
      users as unknown as UsersService,
    );
  });

  // ---------------------------------------------------------------------------
  // Pagination
  // ---------------------------------------------------------------------------
  describe('pagination', () => {
    it('applique les valeurs par DÉFAUT', async () => {
      const resultat = await service.listUsers(pagination());

      // Mêmes défauts que `GET /api/routes` : première page, 20 éléments.
      expect(premierAppel(prisma.user.findMany).skip).toBe(0);
      expect(premierAppel(prisma.user.findMany).take).toBe(20);
      expect(resultat.page).toBe(1);
      expect(resultat.limit).toBe(20);
    });

    it('traduit la page en DÉCALAGE', async () => {
      await service.listUsers(pagination({ page: 3, limit: 10 }));

      // Numérotation HUMAINE : la première page est la 1. Le décalage en est
      // déduit, (page - 1) × limit.
      expect(premierAppel(prisma.user.findMany).skip).toBe(20);
      expect(premierAppel(prisma.user.findMany).take).toBe(10);
    });

    it('accepte la limite MAXIMALE', async () => {
      await service.listUsers(pagination({ limit: 50 }));

      // 50 est le plafond du DTO partagé. Au-delà, le ValidationPipe refuse
      // AVANT d'atteindre ce service — c'est sa raison d'être.
      expect(premierAppel(prisma.user.findMany).take).toBe(50);
    });

    it('PAGINE EN BASE, pas en mémoire', async () => {
      await service.listUsers(pagination({ page: 2, limit: 5 }));

      // `skip`/`take` sont passés à PostgreSQL. Charger tous les comptes
      // pour n'en garder cinq annulerait tout l'intérêt de l'exercice.
      const appel = premierAppel(prisma.user.findMany);
      expect(appel.skip).toBeDefined();
      expect(appel.take).toBeDefined();
    });

    it('rend le total et les éléments', async () => {
      prisma.user.count.mockResolvedValue(42);
      prisma.user.findMany.mockResolvedValue([{ id: 'user-1' }]);

      const resultat = await service.listUsers(pagination());

      expect(resultat.total).toBe(42);
      expect(resultat.items).toEqual([{ id: 'user-1' }]);
      // Même forme que `GET /api/routes` : une seconde convention obligerait
      // chaque appelant à se souvenir de laquelle s'applique où.
      expect(Object.keys(resultat).sort()).toEqual([
        'items',
        'limit',
        'page',
        'total',
      ]);
    });
  });

  // ---------------------------------------------------------------------------
  // Données exposées
  // ---------------------------------------------------------------------------
  describe('données exposées', () => {
    it('NE SÉLECTIONNE PAS passwordHash', async () => {
      await service.listUsers(pagination());

      const select = premierAppel(prisma.user.findMany).select ?? {};
      // `select` explicite plutôt qu'`include` : une colonne ajoutée plus
      // tard au modèle ne peut pas se retrouver dans la réponse toute seule.
      expect(select).not.toHaveProperty('passwordHash');
    });

    it('sélectionne EXACTEMENT cinq colonnes', async () => {
      await service.listUsers(pagination());

      expect(
        Object.keys(premierAppel(prisma.user.findMany).select ?? {}).sort(),
      ).toEqual(['createdAt', 'deletedAt', 'email', 'id', 'role']);
    });

    it('NE CHARGE PAS les préférences', async () => {
      await service.listUsers(pagination());

      const select = premierAppel(prisma.user.findMany).select ?? {};
      // Six champs par usager, multipliés par la page entière, pour une
      // information qu'on ne lit pas en parcourant une liste. Elles
      // relèveront d'une future route de détail.
      expect(select).not.toHaveProperty('preferences');
    });
  });

  // ---------------------------------------------------------------------------
  // Tri
  // ---------------------------------------------------------------------------
  describe('tri', () => {
    it('classe du plus RÉCENT au plus ancien', async () => {
      await service.listUsers(pagination());

      const ordre = premierAppel(prisma.user.findMany).orderBy ?? [];
      expect(ordre[0]).toEqual({ createdAt: 'desc' });
    });

    it('DÉPARTAGE par identifiant', async () => {
      await service.listUsers(pagination());

      const ordre = premierAppel(prisma.user.findMany).orderBy ?? [];
      // Sans ce second critère, deux comptes créés dans la même
      // milliseconde pourraient changer de place entre deux requêtes : l'un
      // apparaîtrait deux fois pendant qu'un autre disparaîtrait.
      expect(ordre[1]).toEqual({ id: 'desc' });
    });

    it("ne dépend JAMAIS de l'ordre physique de PostgreSQL", async () => {
      await service.listUsers(pagination());

      expect(premierAppel(prisma.user.findMany).orderBy).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Comptes supprimés
  // ---------------------------------------------------------------------------
  describe('comptes supprimés', () => {
    it("N'EXCLUT PAS les comptes supprimés", async () => {
      await service.listUsers(pagination());

      // Les filtrer donnerait de l'application une image fausse : un compte
      // supprimé occupe toujours son adresse électronique.
      expect(premierAppel(prisma.user.findMany).where).toBeUndefined();
    });

    it('les COMPTE aussi dans le total', async () => {
      await service.listUsers(pagination());

      // Sans quoi `total` ne correspondrait pas à ce que la liste montre, et
      // la pagination afficherait un nombre de pages faux.
      expect(premierAppel(prisma.user.count)).toBeUndefined();
    });

    it('expose `deletedAt` pour distinguer les deux états', async () => {
      await service.listUsers(pagination());

      expect(premierAppel(prisma.user.findMany).select?.deletedAt).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Performance
  // ---------------------------------------------------------------------------
  describe('performance', () => {
    it('lance les DEUX requêtes en parallèle', async () => {
      let compteResolu = false;
      prisma.user.count.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 10));
        compteResolu = true;
        return 0;
      });
      prisma.user.findMany.mockImplementation(() => {
        // Si les appels étaient enchaînés, `count` serait déjà résolu ici.
        expect(compteResolu).toBe(false);
        return Promise.resolve([]);
      });

      await service.listUsers(pagination());

      expect(compteResolu).toBe(true);
    });

    it('ne fait AUCUNE requête par ligne', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: 'a' },
        { id: 'b' },
        { id: 'c' },
      ]);

      await service.listUsers(pagination());

      // Deux requêtes au total, quelle que soit la taille de la page.
      expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.user.count).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Suppression administrative (étape 6-4)
  // ---------------------------------------------------------------------------
  describe('deleteUser', () => {
    const ADMIN = 'aaaaaaaa-0000-0000-0000-000000000001';
    const CIBLE = 'bbbbbbbb-0000-0000-0000-000000000002';

    /// La cible existe en base.
    const existe = () =>
      prisma.user.findUnique.mockResolvedValue({ id: CIBLE });

    it('DÉLÈGUE la suppression à UsersService', async () => {
      existe();

      await service.deleteUser(CIBLE, ADMIN);

      // La suppression logique n'a qu'UNE implémentation, celle de 5G.
      // Ce service décide, il n'écrit pas.
      expect(users.softDeleteAccount).toHaveBeenCalledWith(CIBLE);
      expect(users.softDeleteAccount).toHaveBeenCalledTimes(1);
    });

    it("cible l'identifiant de l'URL, jamais celui de l'appelant", async () => {
      existe();

      await service.deleteUser(CIBLE, ADMIN);

      expect(premierAppel(prisma.user.findUnique).where).toEqual({ id: CIBLE });
      expect(users.softDeleteAccount).not.toHaveBeenCalledWith(ADMIN);
    });

    it('NE LIT PAS le profil de la cible', async () => {
      existe();

      await service.deleteUser(CIBLE, ADMIN);

      // On vérifie une EXISTENCE, on ne lit pas un profil — et surtout
      // jamais `passwordHash`.
      expect(premierAppel(prisma.user.findUnique).select).toEqual({ id: true });
    });

    it("N'ÉCRIT RIEN lui-même", async () => {
      existe();

      await service.deleteUser(CIBLE, ADMIN);

      // Aucune écriture directe : ni `update`, ni `updateMany`, ni surtout
      // `delete`. Les cascades Prisma ne peuvent donc pas se déclencher.
      expect(prisma.user).not.toHaveProperty('delete');
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    describe('auto-suppression', () => {
      it('REFUSE en 400', async () => {
        await expect(service.deleteUser(ADMIN, ADMIN)).rejects.toBeInstanceOf(
          BadRequestException,
        );
      });

      it("n'interroge même pas la base", async () => {
        await expect(service.deleteUser(ADMIN, ADMIN)).rejects.toThrow();

        // Vérifié EN PREMIER : c'est le cas le moins cher à détecter.
        expect(prisma.user.findUnique).not.toHaveBeenCalled();
        expect(users.softDeleteAccount).not.toHaveBeenCalled();
      });

      it('porte un message qui DIT pourquoi', async () => {
        await expect(service.deleteUser(ADMIN, ADMIN)).rejects.toThrow(
          /votre propre compte/i,
        );
      });
    });

    // -------------------------------------------------------------------------
    describe('compte inexistant', () => {
      it('LÈVE 404', async () => {
        prisma.user.findUnique.mockResolvedValue(null);

        await expect(service.deleteUser(CIBLE, ADMIN)).rejects.toBeInstanceOf(
          NotFoundException,
        );
      });

      it('NE SUPPRIME RIEN', async () => {
        prisma.user.findUnique.mockResolvedValue(null);

        await expect(service.deleteUser(CIBLE, ADMIN)).rejects.toThrow();

        // Un administrateur doit savoir que son identifiant était faux,
        // plutôt que de croire avoir agi.
        expect(users.softDeleteAccount).not.toHaveBeenCalled();
      });
    });

    // -------------------------------------------------------------------------
    describe('compte déjà supprimé', () => {
      it('RÉUSSIT sans erreur', async () => {
        // La cible existe : `deletedAt` ne change rien à sa présence.
        existe();

        await expect(service.deleteUser(CIBLE, ADMIN)).resolves.toBeUndefined();
      });

      it("laisse l'idempotence à UsersService", async () => {
        existe();

        await service.deleteUser(CIBLE, ADMIN);

        // Ce service ne teste PAS `deletedAt` : c'est le filtre
        // `deletedAt: null` de `softDeleteAccount` qui garantit qu'une date
        // déjà posée n'est jamais réécrite. Le vérifier ici aussi
        // dupliquerait la règle.
        expect(premierAppel(prisma.user.findUnique).select).not.toHaveProperty(
          'deletedAt',
        );
        expect(users.softDeleteAccount).toHaveBeenCalledWith(CIBLE);
      });
    });

    // -------------------------------------------------------------------------
    it("n'applique AUCUNE règle particulière à un ADMIN cible", async () => {
      // Le dossier n'en définit aucune. En inventer une — « un
      // administrateur en protège un autre » — trancherait une question
      // d'organisation qui ne nous appartient pas.
      existe();

      await service.deleteUser(CIBLE, ADMIN);

      // Le rôle de la cible n'est même pas lu.
      expect(premierAppel(prisma.user.findUnique).select).not.toHaveProperty(
        'role',
      );
      expect(users.softDeleteAccount).toHaveBeenCalledWith(CIBLE);
    });
  });

  // ---------------------------------------------------------------------------
  // Statistiques anonymisees (etape 6-5)
  // ---------------------------------------------------------------------------
  describe('getStats', () => {
    /// Prepare des agregats realistes.
    const peupler = () => {
      prisma.user.count
        .mockResolvedValueOnce(12) // actifs
        .mockResolvedValueOnce(3); // supprimes
      prisma.route.aggregate.mockResolvedValue({
        _count: { _all: 48 },
        _sum: { totalDistanceM: 123456 },
      });
      prisma.carbonRecord.aggregate.mockResolvedValue({
        _count: { _all: 96 },
        _sum: { co2Grams: 12345.6, savedVsCarGrams: 45678.9 },
      });
      prisma.segment.groupBy.mockResolvedValue([
        { mode: 'WALK', _count: { _all: 10 }, _sum: { distanceM: 2000 } },
        { mode: 'BUS', _count: { _all: 42 }, _sum: { distanceM: 98765 } },
      ]);
    };

    it('rend les quatre sections attendues', async () => {
      peupler();

      const stats = await service.getStats();

      expect(Object.keys(stats).sort()).toEqual([
        'carbon',
        'modeUsage',
        'routes',
        'users',
      ]);
    });

    describe('utilisateurs', () => {
      it('compte les ACTIFS avec `deletedAt: null`', async () => {
        peupler();

        const stats = await service.getStats();

        expect(prisma.user.count).toHaveBeenNthCalledWith(1, {
          where: { deletedAt: null },
        });
        expect(stats.users.active).toBe(12);
      });

      it('compte les SUPPRIMES separement', async () => {
        peupler();

        const stats = await service.getStats();

        // Un compte desactive ne peut plus rien faire (5G) : le compter
        // parmi les actifs surestimerait l'audience.
        expect(prisma.user.count).toHaveBeenNthCalledWith(2, {
          where: { deletedAt: { not: null } },
        });
        expect(stats.users.deleted).toBe(3);
      });
    });

    describe('trajets', () => {
      it('compte les ROUTES, pas les enregistrements carbone', async () => {
        peupler();

        const stats = await service.getStats();

        // LE PIEGE DE L'ETAPE. Un trajet multimodal porte plusieurs
        // `CarbonRecord` : les confondre gonflerait le compteur d'un facteur
        // variable, plus eleve pour les usages que l'application encourage.
        expect(stats.routes.total).toBe(48);
        expect(stats.routes.total).not.toBe(stats.carbon.recordCount);
        expect(prisma.route.aggregate).toHaveBeenCalled();
      });

      it('somme la distance des trajets', async () => {
        peupler();

        expect((await service.getStats()).routes.totalDistanceM).toBe(123456);
      });

      it('rend 0 — et non `null` — sur une base vide', async () => {
        // `_sum` de Prisma rend `null` quand il n'y a rien a sommer. Sans
        // repli, le tableau de bord afficherait « null m ».
        const stats = await service.getStats();

        expect(stats.routes.totalDistanceM).toBe(0);
        expect(stats.carbon.totalCo2Grams).toBe(0);
        expect(stats.carbon.totalSavedVsCarGrams).toBe(0);
      });
    });

    describe('carbone', () => {
      it('LIT les valeurs, ne les recalcule pas', async () => {
        peupler();

        const stats = await service.getStats();

        // Le microservice les a deja calculees a l'enregistrement. Les
        // recalculer ici produirait un second chiffre, qui divergerait au
        // premier changement de facteur d'emission.
        expect(stats.carbon.totalCo2Grams).toBe(12345.6);
        expect(stats.carbon.totalSavedVsCarGrams).toBe(45678.9);
        expect(prisma.carbonRecord.aggregate).toHaveBeenCalledTimes(1);
      });

      it("expose le nombre d'enregistrements, distinct des trajets", async () => {
        peupler();

        expect((await service.getStats()).carbon.recordCount).toBe(96);
      });

      it("n'expose AUCUN eco-score moyen", async () => {
        peupler();

        const stats = await service.getStats();

        // L'eco-score est un RATIO : en faire une moyenne brute donnerait le
        // meme poids a un trajet d'un kilometre et a un trajet de quarante.
        // Un chiffre trompeur vaut moins que pas de chiffre.
        expect(stats.carbon).not.toHaveProperty('averageEcoScore');
        const [[argument]] = prisma.route.aggregate.mock.calls as unknown[][];
        expect(argument).not.toHaveProperty('_avg');
      });
    });

    describe('repartition par mode', () => {
      it('groupe les SEGMENTS par mode', async () => {
        peupler();

        await service.getStats();

        // Un trajet est MULTIMODAL : « BUS = 3 trajets » n'aurait aucun sens.
        const [[appel]] = prisma.segment.groupBy.mock.calls as [
          [{ by: string[] }],
        ];
        expect(appel.by).toEqual(['mode']);
      });

      it('nomme le champ `segmentCount`, pas `tripCount`', async () => {
        peupler();

        const [premier] = (await service.getStats()).modeUsage;

        // Le nom doit decrire honnetement ce que la valeur compte.
        expect(premier).toHaveProperty('segmentCount');
        expect(premier).not.toHaveProperty('tripCount');
      });

      it('TRIE du plus employe au moins employe', async () => {
        peupler();

        const modes = (await service.getStats()).modeUsage;

        // `groupBy` ne garantit aucun ordre : un tableau de bord dont les
        // lignes bougent a chaque rafraichissement est illisible.
        expect(modes.map((m) => m.mode)).toEqual(['BUS', 'WALK']);
        expect(modes[0].segmentCount).toBe(42);
      });

      it('DEPARTAGE les egalites par le nom du mode', async () => {
        prisma.segment.groupBy.mockResolvedValue([
          { mode: 'TRAM', _count: { _all: 5 }, _sum: { distanceM: 100 } },
          { mode: 'BUS', _count: { _all: 5 }, _sum: { distanceM: 200 } },
        ]);

        const modes = (await service.getStats()).modeUsage;

        expect(modes.map((m) => m.mode)).toEqual(['BUS', 'TRAM']);
      });

      it('somme la distance par mode', async () => {
        peupler();

        const modes = (await service.getStats()).modeUsage;

        // Dix etapes de marche de 200 m ne pesent pas le meme usage qu'une
        // etape de metro de 12 km : la distance dit ce que le compte tait.
        expect(modes.find((m) => m.mode === 'BUS')?.totalDistanceM).toBe(98765);
      });

      it('rend un tableau VIDE sans aucun segment', async () => {
        expect((await service.getStats()).modeUsage).toEqual([]);
      });
    });

    describe('anonymisation', () => {
      it('ne contient AUCUNE donnee nominative', async () => {
        peupler();

        const brut = JSON.stringify(await service.getStats());

        // Uniquement des comptes et des sommes. Une statistique par usager
        // n'est pas une statistique, c'est un fichier.
        expect(brut).not.toMatch(/email|userId|passwordHash|@/i);
        expect(brut).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
      });

      it('ne SELECTIONNE aucune colonne nominative', async () => {
        peupler();

        await service.getStats();

        const premierArgument = (mock: jest.Mock) =>
          (mock.mock.calls as unknown[][])[0][0] as Record<string, unknown>;

        const appels = [
          premierArgument(prisma.route.aggregate),
          premierArgument(prisma.carbonRecord.aggregate),
          premierArgument(prisma.segment.groupBy),
        ];

        for (const appel of appels) {
          expect(appel).not.toHaveProperty('select');
          expect(appel).not.toHaveProperty('include');
        }
      });
    });

    describe('performance', () => {
      it('AGREGE EN BASE, jamais en memoire', async () => {
        peupler();

        await service.getStats();

        // Charger toutes les lignes pour les compter en JavaScript
        // s'effondrerait au premier millier d'enregistrements.
        expect(prisma.user.findMany).not.toHaveBeenCalled();
        expect(prisma.route.aggregate).toHaveBeenCalledTimes(1);
        expect(prisma.carbonRecord.aggregate).toHaveBeenCalledTimes(1);
        expect(prisma.segment.groupBy).toHaveBeenCalledTimes(1);
      });

      it('fait CINQ requetes, pas une de plus', async () => {
        peupler();

        await service.getStats();

        const total =
          prisma.user.count.mock.calls.length +
          prisma.route.aggregate.mock.calls.length +
          prisma.carbonRecord.aggregate.mock.calls.length +
          prisma.segment.groupBy.mock.calls.length;

        // Aucune requete par usager, par trajet ni par mode : le cout ne
        // depend pas du volume de donnees.
        expect(total).toBe(5);
      });

      it('lance les requetes EN PARALLELE', async () => {
        peupler();
        let premiereResolue = false;
        prisma.user.count.mockReset();
        prisma.user.count
          .mockImplementationOnce(async () => {
            await new Promise((r) => setTimeout(r, 10));
            premiereResolue = true;
            return 12;
          })
          .mockResolvedValueOnce(3);
        prisma.segment.groupBy.mockImplementation(() => {
          // Enchainees, la premiere serait deja resolue ici.
          expect(premiereResolue).toBe(false);
          return Promise.resolve([]);
        });

        await service.getStats();

        expect(premiereResolue).toBe(true);
      });
    });

    it('est DETERMINISTE : deux appels, meme resultat', async () => {
      peupler();
      const premier = await service.getStats();

      peupler();
      const second = await service.getStats();

      expect(second).toEqual(premier);
    });
  });
});
