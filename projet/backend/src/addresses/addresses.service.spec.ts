import 'reflect-metadata';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AddressesService } from './addresses.service';
import { PrismaService } from '../prisma/prisma.service';

// Adresses favorites — logique de service (bloc 7).
//
// Prisma est SIMULÉ ici : ce fichier vérifie les décisions du service — quel
// `where`, quel `select`, quelle exception — et non le comportement de
// PostgreSQL. La contrainte d'unicité elle-même est éprouvée par
// `test/addresses.e2e-spec.ts`, contre une vraie base : une contrainte
// simulée ne prouverait rien.
describe('AddressesService', () => {
  let service: AddressesService;
  let prisma: {
    favoriteAddress: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };

  const MOI = '11111111-1111-1111-1111-111111111111';
  const AUTRUI = '22222222-2222-2222-2222-222222222222';
  const ID_ADRESSE = 'aaaaaaaa-0000-0000-0000-000000000001';

  const DOMICILE = {
    type: 'HOME' as const,
    address: '12 rue des Lilas, Paris',
    latitude: 48.8566,
    longitude: 2.3522,
  };

  /// Forme des arguments passés à Prisma, pour garder les assertions typées.
  interface AppelPrisma {
    where?: Record<string, unknown>;
    data?: Record<string, unknown>;
    select?: Record<string, boolean>;
    orderBy?: Record<string, string>;
  }

  const premierAppel = (mock: jest.Mock): AppelPrisma =>
    (mock.mock.calls as unknown[][])[0][0] as AppelPrisma;

  /// Erreur d'unicité telle que Prisma la lève réellement.
  const doublon = () =>
    new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '6.19.3',
    });

  beforeEach(() => {
    prisma = {
      favoriteAddress: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: ID_ADRESSE, ...DOMICILE }),
        update: jest.fn().mockResolvedValue({ id: ID_ADRESSE, ...DOMICILE }),
        delete: jest.fn().mockResolvedValue({}),
      },
    };

    service = new AddressesService(prisma as unknown as PrismaService);
  });

  // ---------------------------------------------------------------------------
  // Lecture
  // ---------------------------------------------------------------------------
  describe('findAllForUser', () => {
    it('filtre sur le compte appelant', async () => {
      await service.findAllForUser(MOI);

      // Sans ce `where`, la méthode rendrait les adresses de TOUT LE MONDE.
      expect(premierAppel(prisma.favoriteAddress.findMany).where).toEqual({
        userId: MOI,
      });
    });

    it('ordonne par type — HOME avant WORK', async () => {
      await service.findAllForUser(MOI);

      // PostgreSQL trie un enum selon son ordre de DÉCLARATION. L'ordre est
      // TOTAL : la contrainte d'unicité interdit deux fois le même type, il
      // n'y a donc aucune égalité à départager par un second critère.
      expect(premierAppel(prisma.favoriteAddress.findMany).orderBy).toEqual({
        type: 'asc',
      });
    });

    it('ne sélectionne PAS `userId`', async () => {
      await service.findAllForUser(MOI);

      const select = premierAppel(prisma.favoriteAddress.findMany).select;

      // La route est `/me` : l'appelant sait déjà que ces adresses sont les
      // siennes. Renvoyer l'identifiant ferait circuler une donnée de plus
      // sans rien apprendre.
      expect(select).not.toHaveProperty('userId');
      expect(Object.keys(select ?? {}).sort()).toEqual([
        'address',
        'createdAt',
        'id',
        'latitude',
        'longitude',
        'type',
      ]);
    });

    it('rend un tableau vide sans lever', async () => {
      expect(await service.findAllForUser(MOI)).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Création
  // ---------------------------------------------------------------------------
  describe('create', () => {
    it("rattache l'adresse au compte reçu, jamais au corps", async () => {
      await service.create(MOI, DOMICILE);

      expect(premierAppel(prisma.favoriteAddress.create).data).toEqual({
        ...DOMICILE,
        userId: MOI,
      });
    });

    it('NE LIT PAS la base avant de créer', async () => {
      await service.create(MOI, DOMICILE);

      // Un `findFirst` suivi d'un `create` laisserait une fenêtre : deux
      // requêtes simultanées y liraient toutes deux « pas de domicile ». La
      // contrainte d'unicité de la base ferme cette fenêtre.
      expect(prisma.favoriteAddress.findMany).not.toHaveBeenCalled();
      expect(prisma.favoriteAddress.findUnique).not.toHaveBeenCalled();
    });

    it('traduit P2002 en 409, avec le bon libellé', async () => {
      prisma.favoriteAddress.create.mockRejectedValue(doublon());

      await expect(service.create(MOI, DOMICILE)).rejects.toThrow(
        ConflictException,
      );
      await expect(service.create(MOI, DOMICILE)).rejects.toThrow(/domicile/i);
    });

    it('nomme « travail » pour un doublon de type WORK', async () => {
      prisma.favoriteAddress.create.mockRejectedValue(doublon());

      await expect(
        service.create(MOI, { ...DOMICILE, type: 'WORK' }),
      ).rejects.toThrow(/travail/i);
    });

    it('laisse passer TOUTE AUTRE erreur telle quelle', async () => {
      const panne = new Error('base indisponible');
      prisma.favoriteAddress.create.mockRejectedValue(panne);

      // Transformer une panne en 409 mentirait à l'usager : rien n'est en
      // double, le serveur est simplement en difficulté.
      await expect(service.create(MOI, DOMICILE)).rejects.toBe(panne);
    });
  });

  // ---------------------------------------------------------------------------
  // Modification
  // ---------------------------------------------------------------------------
  describe('update', () => {
    beforeEach(() => {
      prisma.favoriteAddress.findUnique.mockResolvedValue({
        id: ID_ADRESSE,
        userId: MOI,
        ...DOMICILE,
      });
    });

    it("vérifie l'appartenance AVANT d'écrire", async () => {
      await service.update(ID_ADRESSE, MOI, { address: 'Nouvelle' });

      // L'ordre importe : un `update({ where: { id } })` seul modifierait
      // l'adresse de n'importe qui.
      const ordre = [
        prisma.favoriteAddress.findUnique.mock.invocationCallOrder[0],
        prisma.favoriteAddress.update.mock.invocationCallOrder[0],
      ];
      expect(ordre[0]).toBeLessThan(ordre[1]);
    });

    it("refuse l'adresse d'autrui par un 404", async () => {
      prisma.favoriteAddress.findUnique.mockResolvedValue({
        id: ID_ADRESSE,
        userId: AUTRUI,
        ...DOMICILE,
      });

      await expect(
        service.update(ID_ADRESSE, MOI, { address: 'x' }),
      ).rejects.toThrow(NotFoundException);

      // Et RIEN n'a été écrit.
      expect(prisma.favoriteAddress.update).not.toHaveBeenCalled();
    });

    it('répond 404 — et non 403 — sur une adresse existante d’autrui', async () => {
      prisma.favoriteAddress.findUnique.mockResolvedValue({
        id: ID_ADRESSE,
        userId: AUTRUI,
        ...DOMICILE,
      });

      // Un 403 confirmerait qu'un identifiant existe. « Inexistante » et
      // « pas à vous » restent volontairement indiscernables.
      await expect(
        service.update(ID_ADRESSE, MOI, { address: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('404 sur une adresse inexistante', async () => {
      prisma.favoriteAddress.findUnique.mockResolvedValue(null);

      await expect(
        service.update(ID_ADRESSE, MOI, { address: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });

    it("n'écrit QUE les champs reçus", async () => {
      await service.update(ID_ADRESSE, MOI, { latitude: 45.75 });

      // Prisma ne touche pas aux colonnes absentes du `data` : c'est ce qui
      // fait de PATCH une modification partielle, et non un remplacement.
      expect(premierAppel(prisma.favoriteAddress.update).data).toEqual({
        latitude: 45.75,
      });
    });

    it('traduit un conflit de type en 409', async () => {
      prisma.favoriteAddress.update.mockRejectedValue(doublon());

      await expect(
        service.update(ID_ADRESSE, MOI, { type: 'WORK' }),
      ).rejects.toThrow(ConflictException);
    });

    it('nomme le type VISÉ dans le message, pas le type actuel', async () => {
      prisma.favoriteAddress.update.mockRejectedValue(doublon());

      // L'adresse est un HOME qu'on tente de basculer en WORK : c'est la
      // place de destination qui est occupée.
      await expect(
        service.update(ID_ADRESSE, MOI, { type: 'WORK' }),
      ).rejects.toThrow(/travail/i);
    });
  });

  // ---------------------------------------------------------------------------
  // Suppression
  // ---------------------------------------------------------------------------
  describe('remove', () => {
    it("vérifie l'appartenance avant de supprimer", async () => {
      prisma.favoriteAddress.findUnique.mockResolvedValue({
        id: ID_ADRESSE,
        userId: AUTRUI,
        ...DOMICILE,
      });

      await expect(service.remove(ID_ADRESSE, MOI)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.favoriteAddress.delete).not.toHaveBeenCalled();
    });

    it('supprime PHYSIQUEMENT, sans suppression logique', async () => {
      prisma.favoriteAddress.findUnique.mockResolvedValue({
        id: ID_ADRESSE,
        userId: MOI,
        ...DOMICILE,
      });

      await service.remove(ID_ADRESSE, MOI);

      // Une adresse favorite est un RACCOURCI, pas une trace d'activité :
      // l'usager qui la retire veut qu'elle disparaisse. La conserver
      // logiquement obligerait à filtrer `deletedAt` partout, sans rendre
      // service à personne.
      expect(prisma.favoriteAddress.delete).toHaveBeenCalledWith({
        where: { id: ID_ADRESSE },
      });
      expect(prisma.favoriteAddress.update).not.toHaveBeenCalled();
    });

    it('404 sur une adresse inexistante', async () => {
      prisma.favoriteAddress.findUnique.mockResolvedValue(null);

      await expect(service.remove(ID_ADRESSE, MOI)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Cloisonnement — la garantie transversale
  // ---------------------------------------------------------------------------
  describe('cloisonnement', () => {
    it('les écritures ciblées CONFRONTENT toujours le propriétaire', async () => {
      prisma.favoriteAddress.findUnique.mockResolvedValue({
        id: ID_ADRESSE,
        userId: MOI,
        ...DOMICILE,
      });

      await service.update(ID_ADRESSE, MOI, { address: 'x' });
      await service.remove(ID_ADRESSE, MOI);

      // `update` et `remove` reçoivent un identifiant d'ADRESSE, seule donnée
      // du module qu'un client peut désigner. Ils doivent donc lire `userId`
      // pour le confronter à celui du jeton — sans cette colonne dans le
      // `select`, la comparaison porterait sur `undefined` et laisserait
      // passer tout le monde.
      const appels = prisma.favoriteAddress.findUnique.mock
        .calls as unknown[][];

      expect(appels).toHaveLength(2);
      for (const [argument] of appels) {
        expect((argument as AppelPrisma).select).toHaveProperty('userId', true);
      }
    });

    it('la lecture de liste NE PEUT PAS omettre le filtre', async () => {
      await service.findAllForUser(MOI);

      // La seule méthode qui lit plusieurs lignes. Sans ce `where`, elle
      // rendrait la table entière — l'erreur la plus coûteuse possible ici.
      expect(premierAppel(prisma.favoriteAddress.findMany).where).toEqual({
        userId: MOI,
      });
    });
  });
});
