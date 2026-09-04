import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  PasswordResetService,
  VALIDITE_JETON_MS,
} from './password-reset.service';
import { verifyPassword } from '../common/crypto/password.util';

// =============================================================================
// Ce que ces tests verrouillent
// =============================================================================
// Trois propriétés de sécurité, et rien d'autre. Chacune, si elle cède,
// transforme une commodité en faille :
//
//   1. AUCUNE ÉNUMÉRATION DE COMPTES. La demande se comporte identiquement
//      pour une adresse inscrite et pour une adresse inconnue.
//   2. LE JETON N'EST JAMAIS STOCKÉ EN CLAIR. Lire la base ne doit pas suffire
//      à prendre la main sur un compte.
//   3. UN JETON NE SERT QU'UNE FOIS, et pas au-delà de sa durée de vie.
// =============================================================================

describe('PasswordResetService', () => {
  /**
   * Les formes qu'on inspecte reellement.
   *
   * TYPEES, ET NON `jest.Mock` NU. Sans parametre de type,
   * `mock.calls[n][0]` vaut `any` : chaque assertion devient un acces non sur,
   * et une faute de frappe dans un nom de champ ne serait detectee par rien.
   */
  type CreationJeton = {
    data: { userId: string; tokenHash: string; expiresAt: Date };
  };
  type MiseAJourJetons = {
    where: { userId: string; usedAt: null };
    data: { usedAt: Date };
  };
  type MiseAJourUtilisateur = {
    where: { id: string };
    data: { passwordHash: string };
  };

  let prisma: {
    user: {
      findUnique: jest.Mock<Promise<unknown>, [unknown]>;
      update: jest.Mock<Promise<unknown>, [MiseAJourUtilisateur]>;
    };
    passwordResetToken: {
      findUnique: jest.Mock<Promise<unknown>, [unknown]>;
      create: jest.Mock<Promise<unknown>, [CreationJeton]>;
      update: jest.Mock<Promise<unknown>, [unknown]>;
      updateMany: jest.Mock<Promise<unknown>, [MiseAJourJetons]>;
    };
    $transaction: jest.Mock<Promise<unknown[]>, [unknown[]]>;
  };
  let service: PasswordResetService;

  const UTILISATEUR = {
    id: 'user-1',
    email: 'usager@example.test',
    deletedAt: null,
  };

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest
          .fn<Promise<unknown>, [unknown]>()
          .mockResolvedValue(null),
        update: jest
          .fn<Promise<unknown>, [MiseAJourUtilisateur]>()
          .mockResolvedValue(UTILISATEUR),
      },
      passwordResetToken: {
        findUnique: jest
          .fn<Promise<unknown>, [unknown]>()
          .mockResolvedValue(null),
        create: jest
          .fn<Promise<unknown>, [CreationJeton]>()
          .mockResolvedValue({ id: 'jeton-1' }),
        update: jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({}),
        updateMany: jest
          .fn<Promise<unknown>, [MiseAJourJetons]>()
          .mockResolvedValue({ count: 0 }),
      },
      // Le double exécute simplement les opérations qu'on lui passe : les
      // tests portent sur CE QUI est écrit, pas sur l'atomicité de Prisma.
      $transaction: jest
        .fn<Promise<unknown[]>, [unknown[]]>()
        .mockResolvedValue([]),
    };

    service = new PasswordResetService(prisma as unknown as PrismaService);

    // Le service journalise le lien en développement. On coupe la sortie pour
    // ne pas noyer le rapport de test — mais on la RELIT dans un cas dédié.
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
    jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
  });

  // ---------------------------------------------------------------------------
  // 1. Aucune énumération de comptes
  // ---------------------------------------------------------------------------
  describe('demander', () => {
    it('NE LÈVE PAS pour une adresse inconnue', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      // ⚠️ LE TEST LE PLUS IMPORTANT DU FICHIER. Une exception ici — ou tout
      // comportement observable différent — ferait de cet endpoint un oracle :
      // on lui soumettrait une liste d'adresses et l'on apprendrait lesquelles
      // ont un compte.
      await expect(
        service.demander({ email: 'inconnu@example.test' }),
      ).resolves.toBeUndefined();

      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
    });

    it('NE CRÉE AUCUN JETON pour un compte supprimé', async () => {
      // Ressusciter un compte effacé par une réinitialisation viderait de son
      // sens le droit à l'effacement.
      prisma.user.findUnique.mockResolvedValue({
        ...UTILISATEUR,
        deletedAt: new Date(),
      });

      await service.demander({ email: UTILISATEUR.email });

      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
    });

    it('crée un jeton pour un compte actif', async () => {
      prisma.user.findUnique.mockResolvedValue(UTILISATEUR);

      await service.demander({ email: UTILISATEUR.email });

      expect(prisma.passwordResetToken.create).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Le jeton n'est jamais stocké en clair
  // ---------------------------------------------------------------------------
  describe('stockage du jeton', () => {
    it('N’ÉCRIT QUE L’EMPREINTE, jamais le jeton lui-même', async () => {
      prisma.user.findUnique.mockResolvedValue(UTILISATEUR);

      // On récupère le jeton en clair depuis le journal de développement —
      // le seul endroit où il apparaît.
      const journal = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => undefined);

      await service.demander({ email: UTILISATEUR.email });

      const ligne = String(journal.mock.calls[0][0]);
      const trouve = /token=([0-9a-f]+)/.exec(ligne);

      expect(trouve).not.toBeNull();
      const jetonEnClair = trouve![1];

      const ecrit = prisma.passwordResetToken.create.mock.calls[0][0];

      // ⚠️ CE QUI EST EN BASE N'EST PAS CE QUI EST ENVOYÉ. Un jeton de
      // réinitialisation vaut un mot de passe : lire la base ne doit pas
      // suffire à prendre la main sur un compte.
      expect(ecrit.data.tokenHash).not.toBe(jetonEnClair);
      expect(ecrit.data.tokenHash).toBe(
        createHash('sha256').update(jetonEnClair).digest('hex'),
      );
    });

    it('tire un jeton DIFFÉRENT à chaque demande', async () => {
      prisma.user.findUnique.mockResolvedValue(UTILISATEUR);

      await service.demander({ email: UTILISATEUR.email });
      await service.demander({ email: UTILISATEUR.email });

      const [premier, second] = prisma.passwordResetToken.create.mock.calls.map(
        (appel) => appel[0].data.tokenHash,
      );

      expect(premier).not.toBe(second);
    });

    it('INVALIDE les demandes précédentes', async () => {
      // Sans cela, dix demandes successives laisseraient dix jetons valables
      // en circulation, et il suffirait d'intercepter le plus ancien courriel.
      prisma.user.findUnique.mockResolvedValue(UTILISATEUR);

      await service.demander({ email: UTILISATEUR.email });

      // On inspecte l'appel plutot que d'employer `expect.any(Date)`, qui
      // rend `any` et fait de l'objet attendu une valeur non sure.
      const appel = prisma.passwordResetToken.updateMany.mock.calls[0][0];

      expect(appel.where).toEqual({ userId: UTILISATEUR.id, usedAt: null });
      expect(appel.data.usedAt).toBeInstanceOf(Date);
    });

    it('donne au jeton une durée de vie COURTE', async () => {
      prisma.user.findUnique.mockResolvedValue(UTILISATEUR);
      const avant = Date.now();

      await service.demander({ email: UTILISATEUR.email });

      const ecrit = prisma.passwordResetToken.create.mock.calls[0][0];
      const duree = ecrit.data.expiresAt.getTime() - avant;

      // Un lien oublié dans une boîte de réception ne doit pas rester
      // exploitable des semaines plus tard.
      expect(duree).toBeGreaterThan(0);
      expect(duree).toBeLessThanOrEqual(VALIDITE_JETON_MS + 1000);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Un jeton ne sert qu'une fois
  // ---------------------------------------------------------------------------
  describe('reinitialiser', () => {
    const jetonValide = (surcharge: Record<string, unknown> = {}) => ({
      id: 'jeton-1',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: { id: UTILISATEUR.id, deletedAt: null },
      ...surcharge,
    });

    const CLAIR = 'a'.repeat(64);

    it('refuse un jeton INCONNU', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(null);

      await expect(
        service.reinitialiser({ token: CLAIR, password: 'nouveau-mdp-1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuse un jeton EXPIRÉ', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(
        jetonValide({ expiresAt: new Date(Date.now() - 1000) }),
      );

      await expect(
        service.reinitialiser({ token: CLAIR, password: 'nouveau-mdp-1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuse un jeton DÉJÀ UTILISÉ', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(
        jetonValide({ usedAt: new Date() }),
      );

      await expect(
        service.reinitialiser({ token: CLAIR, password: 'nouveau-mdp-1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuse un jeton dont le COMPTE a été supprimé entre-temps', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(
        jetonValide({ user: { id: UTILISATEUR.id, deletedAt: new Date() } }),
      );

      await expect(
        service.reinitialiser({ token: CLAIR, password: 'nouveau-mdp-1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('donne LE MÊME MESSAGE pour les quatre refus', async () => {
      // ⚠️ Distinguer « expiré » de « inconnu » apprendrait qu'un jeton a
      // existé, donc qu'une demande a été faite pour un compte donné.
      const messages: string[] = [];

      for (const etat of [
        null,
        jetonValide({ expiresAt: new Date(Date.now() - 1000) }),
        jetonValide({ usedAt: new Date() }),
        jetonValide({ user: { id: UTILISATEUR.id, deletedAt: new Date() } }),
      ]) {
        prisma.passwordResetToken.findUnique.mockResolvedValue(etat);

        await service
          .reinitialiser({ token: CLAIR, password: 'nouveau-mdp-1' })
          .catch((erreur: BadRequestException) =>
            messages.push(erreur.message),
          );
      }

      expect(messages).toHaveLength(4);
      expect(new Set(messages).size).toBe(1);
    });

    it('CHERCHE PAR EMPREINTE, jamais par le jeton en clair', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(jetonValide());

      await service.reinitialiser({ token: CLAIR, password: 'nouveau-mdp-1' });

      expect(prisma.passwordResetToken.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tokenHash: createHash('sha256').update(CLAIR).digest('hex'),
          },
        }),
      );
    });

    it('remplace le mot de passe par un HACHAGE, et marque le jeton', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(jetonValide());

      await service.reinitialiser({ token: CLAIR, password: 'nouveau-mdp-1' });

      // ⚠️ TOUT PASSE PAR UNE TRANSACTION. Sans elle, une panne entre
      // l'écriture du mot de passe et le marquage du jeton laisserait ce
      // dernier réutilisable.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);

      const ecrit = prisma.user.update.mock.calls[0][0];

      expect(ecrit.data.passwordHash).not.toContain('nouveau-mdp-1');
      expect(verifyPassword('nouveau-mdp-1', ecrit.data.passwordHash)).toBe(
        true,
      );
    });

    it('INVALIDE les autres demandes en cours', async () => {
      // Quelqu'un qui reprend la main sur son compte doit périmer tous les
      // liens émis pendant qu'il en avait perdu le contrôle.
      prisma.passwordResetToken.findUnique.mockResolvedValue(jetonValide());

      await service.reinitialiser({ token: CLAIR, password: 'nouveau-mdp-1' });

      // On inspecte l'appel plutot que d'employer `expect.any(Date)`, qui
      // rend `any` et fait de l'objet attendu une valeur non sure.
      const appel = prisma.passwordResetToken.updateMany.mock.calls[0][0];

      expect(appel.where).toEqual({ userId: UTILISATEUR.id, usedAt: null });
      expect(appel.data.usedAt).toBeInstanceOf(Date);
    });
  });

  // ---------------------------------------------------------------------------
  // Livraison
  // ---------------------------------------------------------------------------
  describe('livraison du lien', () => {
    const environnement = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = environnement;
    });

    it('NE JOURNALISE PAS LE JETON en production', async () => {
      // ⚠️ Les journaux d'un serveur sont lus par des humains, agrégés,
      // parfois exportés. Un jeton qui y traîne vaut un mot de passe en clair.
      process.env.NODE_ENV = 'production';
      prisma.user.findUnique.mockResolvedValue(UTILISATEUR);

      const avertissement = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => undefined);
      const journal = jest
        .spyOn(service['logger'], 'log')
        .mockImplementation(() => undefined);

      await service.demander({ email: UTILISATEUR.email });

      expect(avertissement).not.toHaveBeenCalled();
      expect(String(journal.mock.calls[0][0])).not.toMatch(/token=/);
    });
  });
});
