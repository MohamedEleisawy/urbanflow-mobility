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
    };
    prisma.user.count.mockResolvedValue(0);
    prisma.user.findMany.mockResolvedValue([]);

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
});
