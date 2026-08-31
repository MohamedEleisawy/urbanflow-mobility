import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

// PrismaService n'est pas une vraie base de données ici : on simule
// uniquement les deux méthodes utilisées par UsersService (user.create et
// user.findUnique). C'est un test unitaire, pas un test d'intégration.
describe('UsersService', () => {
  let service: UsersService;
  let prisma: {
    user: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    userPreferences: {
      findUnique: jest.Mock;
      upsert: jest.Mock;
      update: jest.Mock;
    };
    route: { findMany: jest.Mock };
    carbonRecord: { findMany: jest.Mock };
    carbonBudget: { findMany: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      user: {
        create: jest.fn(),
        findUnique: jest.fn(),
        // Ajoutée à l'étape 6-2 : la promotion écrit UNE colonne.
        update: jest.fn(),
        // Ajoutée à l'étape 5G : la suppression est LOGIQUE, donc un update.
        updateMany: jest.fn(),
      },
      // Ajouté à l'étape 5E-1 : `updatePreferences` ne touche QUE cette table.
      userPreferences: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
      },
      // Ajoutées à l'étape 5F : `exportPersonalData` lit ces trois tables.
      route: { findMany: jest.fn() },
      carbonRecord: { findMany: jest.fn() },
      carbonBudget: { findMany: jest.fn() },
    };
    service = new UsersService(prisma as unknown as PrismaService);
  });

  /// Forme des arguments passés à Prisma, pour que les assertions restent
  /// typées : `mock.calls[0][0]` est `any`, ce qu'ESLint refuse à juste
  /// titre — une faute de frappe dans un nom de champ passerait sinon
  /// inaperçue.
  interface AppelPrisma {
    where?: { userId?: string; id?: string; deletedAt?: Date | null };
    select?: Record<string, unknown>;
    data?: Record<string, unknown>;
    update?: Record<string, unknown>;
    create?: Record<string, unknown>;
  }

  const premierAppel = (mock: jest.Mock): AppelPrisma => {
    const appels = mock.mock.calls as AppelPrisma[][];
    return appels[0][0];
  };

  describe('create', () => {
    it('crée un utilisateur et ne renvoie jamais passwordHash', async () => {
      prisma.user.create.mockResolvedValue({
        id: 'user-1',
        email: 'lena@example.com',
        passwordHash: 'sel:hash',
        role: 'USER',
        createdAt: new Date(),
        deletedAt: null,
        preferences: null,
      });

      const result = await service.create({
        email: 'lena@example.com',
        password: 'motdepasse123',
      });

      expect(result).not.toHaveProperty('passwordHash');
      expect(result.email).toBe('lena@example.com');
    });

    it('transforme une violation de contrainte unique (email) en ConflictException', async () => {
      prisma.user.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '6.19.3',
        }),
      );

      await expect(
        service.create({
          email: 'lena@example.com',
          password: 'motdepasse123',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findById', () => {
    it("lève NotFoundException si l'utilisateur n'existe pas", async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.findById('id-inexistant')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('renvoie un utilisateur sans passwordHash quand il existe', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'lena@example.com',
        passwordHash: 'sel:hash',
        role: 'USER',
        createdAt: new Date(),
        deletedAt: null,
        preferences: null,
      });

      const result = await service.findById('user-1');

      expect(result).not.toHaveProperty('passwordHash');
      expect(result.id).toBe('user-1');
    });
  });

  // ---------------------------------------------------------------------------
  // Préférences (étape 5E-1)
  // ---------------------------------------------------------------------------
  describe('updatePreferences', () => {
    const USAGER = '11111111-1111-1111-1111-111111111111';

    /// Une ligne de préférences déjà en base.
    const existantes = () =>
      prisma.userPreferences.findUnique.mockResolvedValue({ id: 'pref-1' });

    /// Aucune ligne : le compte a été créé sans sous-objet `preferences`.
    const absentes = () =>
      prisma.userPreferences.findUnique.mockResolvedValue(null);

    it('met à jour une préférence existante', async () => {
      existantes();
      prisma.userPreferences.update.mockResolvedValue({
        id: 'pref-1',
        theme: 'DARK',
      });

      const resultat = await service.updatePreferences(USAGER, {
        theme: 'DARK',
      });

      // SANS budget dans le corps, c'est un `update` et non un `upsert` :
      // Prisma valide la branche `create` d'un upsert même quand il prendra
      // `update`, et `co2BudgetWeekly` y serait manquant.
      expect(prisma.userPreferences.update).toHaveBeenCalledWith({
        where: { userId: USAGER },
        data: { theme: 'DARK' },
      });
      expect(prisma.userPreferences.upsert).not.toHaveBeenCalled();
      // La réponse est ce que la BASE a retenu, pas ce que le client a envoyé.
      expect(resultat).toEqual({ id: 'pref-1', theme: 'DARK' });
    });

    it('accepte une mise à jour PARTIELLE', async () => {
      existantes();
      prisma.userPreferences.update.mockResolvedValue({});

      await service.updatePreferences(USAGER, { pmrMode: true });

      // Un seul champ : c'est le propre d'un PATCH.
      expect(premierAppel(prisma.userPreferences.update).data).toEqual({
        pmrMode: true,
      });
    });

    it("N'ÉCRASE PAS un champ absent du corps", async () => {
      existantes();
      prisma.userPreferences.update.mockResolvedValue({});

      await service.updatePreferences(USAGER, { theme: 'LIGHT' });

      const appel = {
        update: premierAppel(prisma.userPreferences.update).data ?? {},
      };
      // Prisma ignore les clés absentes : le budget et les modes favoris
      // gardent leur valeur. Passer `undefined` explicitement produirait le
      // même effet, mais une clé `null` les effacerait.
      expect(appel.update).not.toHaveProperty('co2BudgetWeekly');
      expect(appel.update).not.toHaveProperty('preferredModes');
    });

    it("CRÉE la ligne quand aucune préférence n'existe", async () => {
      absentes();
      prisma.userPreferences.upsert.mockResolvedValue({ id: 'pref-neuve' });

      await service.updatePreferences(USAGER, { co2BudgetWeekly: 5000 });

      const appel = premierAppel(prisma.userPreferences.upsert);
      // La relation User → UserPreferences est FACULTATIVE : un `update`
      // lèverait P2025 pour un usager parfaitement valide.
      expect(appel.create).toEqual({ co2BudgetWeekly: 5000, userId: USAGER });
    });

    it('REFUSE la création sans budget carbone', async () => {
      absentes();

      await expect(
        service.updatePreferences(USAGER, { theme: 'DARK' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      // Rien n'a été écrit : inventer un budget par défaut aurait fabriqué un
      // chiffre que personne n'a choisi.
      expect(prisma.userPreferences.upsert).not.toHaveBeenCalled();
      expect(prisma.userPreferences.update).not.toHaveBeenCalled();
    });

    it('accepte un budget de ZÉRO à la création', async () => {
      absentes();
      prisma.userPreferences.upsert.mockResolvedValue({});

      await service.updatePreferences(USAGER, { co2BudgetWeekly: 0 });

      // 0 EST UNE VALEUR : un test `if (!dto.co2BudgetWeekly)` l'aurait
      // confondu avec l'absence et refusé un objectif parfaitement légitime.
      expect(prisma.userPreferences.upsert).toHaveBeenCalled();
      const appel = premierAppel(prisma.userPreferences.upsert);
      // `toEqual` sur l'objet entier plutôt qu'un accès chaîné : `create` est
      // optionnel dans le type, et le déréférencer nécessiterait un `!` qui
      // masquerait une vraie régression le jour où la branche disparaîtrait.
      expect(appel.create).toEqual({ co2BudgetWeekly: 0, userId: USAGER });
    });

    it("cible EXCLUSIVEMENT l'identifiant reçu, jamais un autre", async () => {
      existantes();
      prisma.userPreferences.update.mockResolvedValue({});

      // Un client malveillant tente de glisser un `userId` dans le corps.
      // Le DTO ne le déclare pas — le ValidationPipe global le rejetterait
      // d'ailleurs en 400 — mais on vérifie ici que même s'il arrivait
      // jusqu'au service, il ne changerait pas la cible.
      await service.updatePreferences(USAGER, {
        theme: 'DARK',
        userId: 'victime-99999999-9999-9999-9999-999999999999',
      } as never);

      const appel = premierAppel(prisma.userPreferences.update);
      expect(appel.where).toEqual({ userId: USAGER });
    });

    it("n'interroge même pas la base quand le budget est fourni", async () => {
      prisma.userPreferences.upsert.mockResolvedValue({});

      await service.updatePreferences(USAGER, { co2BudgetWeekly: 1200 });

      // L'upsert traite les deux cas d'un seul appel ATOMIQUE : deux
      // requêtes concurrentes du même usager ne peuvent pas se marcher
      // dessus, là où « lire puis écrire » laisserait une fenêtre.
      expect(prisma.userPreferences.findUnique).not.toHaveBeenCalled();
      expect(prisma.userPreferences.upsert).toHaveBeenCalled();
    });

    it('ne touche à AUCUNE autre table', async () => {
      existantes();
      prisma.userPreferences.update.mockResolvedValue({});

      await service.updatePreferences(USAGER, { pmrMode: false });

      // En particulier pas à `user` : aucun `passwordHash` ne peut donc être
      // lu, et encore moins renvoyé.
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Export RGPD (étape 5F)
  // ---------------------------------------------------------------------------
  describe('exportPersonalData', () => {
    const USAGER = '11111111-1111-1111-1111-111111111111';

    const compte = {
      id: USAGER,
      email: 'usager@exemple.fr',
      role: 'USER',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      deletedAt: null,
    };

    const preparer = () => {
      prisma.user.findUnique.mockResolvedValue(compte);
      prisma.userPreferences.findUnique.mockResolvedValue(null);
      prisma.route.findMany.mockResolvedValue([]);
      prisma.carbonRecord.findMany.mockResolvedValue([]);
      prisma.carbonBudget.findMany.mockResolvedValue([]);
    };

    it("n'utilise QUE l'identifiant reçu, pour chaque table", async () => {
      preparer();

      await service.exportPersonalData(USAGER);

      // Aucune requête ne doit pouvoir viser un autre compte : c'est la
      // garantie la plus grave à tenir dans un export.
      expect(premierAppel(prisma.user.findUnique).where).toEqual({
        id: USAGER,
      });
      for (const mock of [
        prisma.userPreferences.findUnique,
        prisma.route.findMany,
        prisma.carbonRecord.findMany,
        prisma.carbonBudget.findMany,
      ]) {
        expect(premierAppel(mock).where).toEqual({ userId: USAGER });
      }
    });

    it("N'EXPOSE PAS passwordHash — il n'est même pas sélectionné", async () => {
      preparer();

      await service.exportPersonalData(USAGER);

      const select = premierAppel(prisma.user.findUnique).select ?? {};
      // Un `select` explicite plutôt qu'un `include` : une colonne ajoutée
      // plus tard au schéma ne peut pas se retrouver dans le fichier toute
      // seule.
      expect(select).not.toHaveProperty('passwordHash');
      expect(Object.keys(select).sort()).toEqual([
        'createdAt',
        'deletedAt',
        'email',
        'id',
        'role',
      ]);
    });

    it('charge les segments AVEC leurs trajets, sans N+1', async () => {
      preparer();

      await service.exportPersonalData(USAGER);

      // Les étapes viennent d'un `select` imbriqué : une seule requête pour
      // tous les trajets, et non une requête par trajet.
      expect(premierAppel(prisma.route.findMany).select).toHaveProperty(
        'segments',
      );
      expect(prisma.route.findMany).toHaveBeenCalledTimes(1);
    });

    it('rend une structure VERSIONNÉE et datée', async () => {
      preparer();

      const resultat = await service.exportPersonalData(USAGER);

      // Un fichier conservé des années doit pouvoir être identifié : sans
      // numéro de version, impossible de savoir comment le relire.
      expect(resultat.version).toBe(1);
      expect(resultat.exportedAt).toBeInstanceOf(Date);
    });

    it('expose les six sections attendues, et rien de plus', async () => {
      preparer();

      const resultat = await service.exportPersonalData(USAGER);

      // Ni `alerts`, ni `stops`, ni `lines` : ce sont des données de
      // référence GLOBALES, identiques pour tout le monde.
      expect(Object.keys(resultat).sort()).toEqual([
        'carbonBudgets',
        'carbonRecords',
        'exportedAt',
        'preferences',
        'routes',
        'user',
        'version',
      ]);
    });

    it("rend `preferences: null` quand il n'y en a aucune", async () => {
      preparer();

      const resultat = await service.exportPersonalData(USAGER);

      // `null` dit « aucune préférence enregistrée ». Un objet rempli de
      // valeurs par défaut laisserait croire à des choix jamais faits.
      expect(resultat.preferences).toBeNull();
    });

    it('inclut carbonBudgets même vide', async () => {
      preparer();

      const resultat = await service.exportPersonalData(USAGER);

      // Aucun code n'écrit dans cette table aujourd'hui, mais elle porte un
      // `userId` : elle relève donc des données personnelles, et le fichier
      // restera complet le jour où quelque chose y écrira.
      expect(resultat.carbonBudgets).toEqual([]);
    });

    it('lève si le compte a disparu pendant la vie du jeton', async () => {
      preparer();
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.exportPersonalData(USAGER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Suppression du compte (étape 5G)
  // ---------------------------------------------------------------------------
  describe('softDeleteAccount', () => {
    const USAGER = '11111111-1111-1111-1111-111111111111';

    beforeEach(() => {
      prisma.user.updateMany.mockResolvedValue({ count: 1 });
    });

    it('NE SUPPRIME PAS physiquement le compte', async () => {
      await service.softDeleteAccount(USAGER);

      // Le schéma le prescrit : « jamais de DELETE physique sur ce compte ».
      // Un `delete` déclencherait quatre `onDelete: Cascade` et détruirait
      // l'historique.
      expect(prisma.user.updateMany).toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('pose une DATE de suppression', async () => {
      await service.softDeleteAccount(USAGER);

      expect(
        premierAppel(prisma.user.updateMany).data?.deletedAt,
      ).toBeInstanceOf(Date);
    });

    it("cible EXCLUSIVEMENT l'identifiant reçu", async () => {
      await service.softDeleteAccount(USAGER);

      expect(premierAppel(prisma.user.updateMany).where?.id).toBe(USAGER);
    });

    it("N'ÉCRASE PAS une suppression déjà enregistrée", async () => {
      await service.softDeleteAccount(USAGER);

      // `deletedAt: null` dans le filtre : la date initiale est la seule
      // trace de QUAND le droit a été exercé, et la redater la perdrait.
      expect(premierAppel(prisma.user.updateMany).where?.deletedAt).toBeNull();
    });

    it('reste SILENCIEUX quand aucune ligne ne correspond', async () => {
      // Compte déjà supprimé, ou inexistant.
      prisma.user.updateMany.mockResolvedValue({ count: 0 });

      // Idempotent : le résultat attendu — « ce compte est supprimé » — est
      // vrai dans les deux cas. Lever apprendrait à un attaquant qu'un compte
      // a existé.
      await expect(service.softDeleteAccount(USAGER)).resolves.toBeUndefined();
    });

    it('NE TOUCHE À AUCUNE donnée associée', async () => {
      await service.softDeleteAccount(USAGER);

      // Ni préférences, ni trajets, ni empreintes : la suppression logique
      // rend le compte inutilisable sans rien détruire.
      expect(prisma.userPreferences.upsert).not.toHaveBeenCalled();
      expect(prisma.userPreferences.update).not.toHaveBeenCalled();
      expect(prisma.route.findMany).not.toHaveBeenCalled();
      expect(prisma.carbonRecord.findMany).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Promotion en administrateur (étape 6-2)
  // ---------------------------------------------------------------------------
  describe('promoteToAdmin', () => {
    const EMAIL = 'lena@example.com';

    const trouve = (surcharge: Record<string, unknown> = {}) =>
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: EMAIL,
        role: 'USER',
        deletedAt: null,
        ...surcharge,
      });

    it('cherche le compte par son ADRESSE', async () => {
      trouve();
      prisma.user.update.mockResolvedValue({ email: EMAIL, role: 'ADMIN' });

      await service.promoteToAdmin(EMAIL);

      expect(premierAppel(prisma.user.findUnique).where).toEqual({
        email: EMAIL,
      });
    });

    it('NE LIT JAMAIS passwordHash', async () => {
      trouve();
      prisma.user.update.mockResolvedValue({ email: EMAIL, role: 'ADMIN' });

      await service.promoteToAdmin(EMAIL);

      // Cette méthode est appelée depuis un terminal, dont la sortie finit
      // dans un historique de commandes et parfois dans des journaux.
      const select = premierAppel(prisma.user.findUnique).select ?? {};
      expect(select).not.toHaveProperty('passwordHash');
      expect(Object.keys(select).sort()).toEqual([
        'deletedAt',
        'email',
        'id',
        'role',
      ]);
    });

    it('promeut un USER en ADMIN', async () => {
      trouve();
      prisma.user.update.mockResolvedValue({ email: EMAIL, role: 'ADMIN' });

      const resultat = await service.promoteToAdmin(EMAIL);

      expect(resultat).toEqual({
        email: EMAIL,
        role: 'ADMIN',
        dejaAdmin: false,
      });
    });

    it("n'écrit QUE la colonne `role`", async () => {
      trouve();
      prisma.user.update.mockResolvedValue({ email: EMAIL, role: 'ADMIN' });

      await service.promoteToAdmin(EMAIL);

      const appel = premierAppel(prisma.user.update);
      // Ni l'email, ni le mot de passe, ni les préférences.
      expect(appel.data).toEqual({ role: 'ADMIN' });
      // Ciblé par l'identifiant relu, jamais par l'adresse fournie en
      // argument : c'est la clé primaire qui désigne la ligne.
      expect(appel.where).toEqual({ id: 'user-1' });
    });

    it("ne renvoie RIEN d'autre que l'adresse, le rôle et l'état", async () => {
      trouve();
      prisma.user.update.mockResolvedValue({ email: EMAIL, role: 'ADMIN' });

      const resultat = await service.promoteToAdmin(EMAIL);

      expect(Object.keys(resultat).sort()).toEqual([
        'dejaAdmin',
        'email',
        'role',
      ]);
    });

    it("N'ÉCRIT RIEN si le compte est DÉJÀ administrateur", async () => {
      trouve({ role: 'ADMIN' });

      const resultat = await service.promoteToAdmin(EMAIL);

      // Idempotence : le résultat attendu est atteint, ce n'est pas une
      // erreur. Mais rien n'est réécrit.
      expect(resultat).toEqual({
        email: EMAIL,
        role: 'ADMIN',
        dejaAdmin: true,
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('LÈVE si le compte est introuvable', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.promoteToAdmin('inconnu@example.com'),
      ).rejects.toBeInstanceOf(NotFoundException);

      // « Introuvable » n'est JAMAIS un succès : sans cela, une faute de
      // frappe dans l'adresse passerait pour une promotion réussie.
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('REFUSE de promouvoir un compte SUPPRIMÉ', async () => {
      trouve({ deletedAt: new Date('2026-08-01T10:00:00.000Z') });

      // Cela produirait un administrateur incapable de se connecter (5G) —
      // un droit accordé à personne, et une surprise le jour où quelqu'un le
      // restaurerait.
      await expect(service.promoteToAdmin(EMAIL)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('ne touche à AUCUNE autre table', async () => {
      trouve();
      prisma.user.update.mockResolvedValue({ email: EMAIL, role: 'ADMIN' });

      await service.promoteToAdmin(EMAIL);

      expect(prisma.userPreferences.update).not.toHaveBeenCalled();
      expect(prisma.route.findMany).not.toHaveBeenCalled();
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });
  });
});
