import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GtfsRtSourceService } from './gtfs-rt-source.service';
import { GtfsRtDecoderService } from './gtfs-rt-decoder.service';
import { GtfsRtImportService } from './gtfs-rt-import.service';

beforeAll(() => {
  Logger.overrideLogger(false);
});

// Ce fichier ne teste QUE le contrat de déclenchement introduit en 4F-1D :
// d'où vient l'adresse du flux, et dans quel ordre. Le mapping a son propre
// test unitaire, et l'écriture en base son test e2e — aucun des deux n'est
// rejoué ici.
//
// La base est un double : ce test ne doit rien écrire, et un vrai
// PrismaService l'obligerait à démarrer PostgreSQL pour vérifier la lecture
// d'une variable d'environnement.
describe("GtfsRtImportService — résolution de l'URL", () => {
  let service: GtfsRtImportService;
  let source: GtfsRtSourceService;
  let decoder: GtfsRtDecoderService;
  /// Le double est conservé dans une variable : passer `source.fetchFeed`
  /// directement à `expect` détacherait la méthode de son objet.
  let telechargement: jest.SpyInstance;

  /// Un flux vide mais valide : il traverse toute la chaîne sans rien écrire,
  /// ce qui laisse l'attention sur l'adresse effectivement demandée.
  const FLUX_VIDE = {
    header: { gtfsRealtimeVersion: '2.0' },
    entity: [],
  };

  const prismaFactice = {
    alert: { findUnique: jest.fn(), upsert: jest.fn() },
    transitLine: { findMany: jest.fn().mockResolvedValue([]) },
    networkLink: { findMany: jest.fn().mockResolvedValue([]) },
  } as unknown as PrismaService;

  const urlDepart = process.env.GTFS_RT_URL;

  beforeEach(() => {
    source = new GtfsRtSourceService();
    decoder = new GtfsRtDecoderService();
    service = new GtfsRtImportService(prismaFactice, source, decoder);

    telechargement = jest
      .spyOn(source, 'fetchFeed')
      .mockResolvedValue(new Uint8Array([1, 2, 3]));
    jest.spyOn(decoder, 'decode').mockReturnValue(FLUX_VIDE as never);

    delete process.env.GTFS_RT_URL;
  });

  afterEach(() => {
    jest.restoreAllMocks();

    if (urlDepart === undefined) {
      delete process.env.GTFS_RT_URL;
    } else {
      process.env.GTFS_RT_URL = urlDepart;
    }
  });

  it("utilise l'URL passée en argument", async () => {
    await service.importFromUrl('https://argument.fr/alertes.pb');

    expect(telechargement).toHaveBeenCalledWith(
      'https://argument.fr/alertes.pb',
    );
  });

  it("se replie sur GTFS_RT_URL quand aucun argument n'est donné", async () => {
    // Le cas normal d'exploitation : une seule adresse, celle du réseau
    // exploité, que personne n'a à retaper.
    process.env.GTFS_RT_URL = 'https://config.fr/alertes.pb';

    await service.importFromUrl();

    expect(telechargement).toHaveBeenCalledWith('https://config.fr/alertes.pb');
  });

  it("laisse l'argument primer sur la variable d'environnement", async () => {
    // Essayer un autre flux ne doit pas obliger à modifier la configuration.
    process.env.GTFS_RT_URL = 'https://config.fr/alertes.pb';

    await service.importFromUrl('https://argument.fr/alertes.pb');

    expect(telechargement).toHaveBeenCalledWith(
      'https://argument.fr/alertes.pb',
    );
  });

  it("ignore un argument vide ou fait d'espaces", async () => {
    process.env.GTFS_RT_URL = 'https://config.fr/alertes.pb';

    await service.importFromUrl('   ');

    expect(telechargement).toHaveBeenCalledWith('https://config.fr/alertes.pb');
  });

  describe('aucune adresse disponible', () => {
    it('refuse sans jamais rien télécharger', async () => {
      await expect(service.importFromUrl()).rejects.toThrow(
        /Aucune URL de flux GTFS-RT/,
      );

      // AUCUNE URL PAR DÉFAUT DANS LE CODE : contrairement à
      // CARBON_SERVICE_URL qui se replie sur localhost:8000 (4D-2), il
      // n'existe ici aucun repli sensé — l'adresse dépend du réseau exploité.
      // Interroger une adresse inventée produirait un message trompeur.
      expect(telechargement).not.toHaveBeenCalled();
    });

    it("indique les deux façons de fournir l'adresse", async () => {
      // Un message qui dit seulement « URL manquante » oblige à ouvrir le
      // code pour savoir quoi faire.
      await expect(service.importFromUrl()).rejects.toThrow(
        /gtfs-rt:import.*GTFS_RT_URL/s,
      );
    });

    it('refuse aussi lorsque GTFS_RT_URL est vide', async () => {
      process.env.GTFS_RT_URL = '   ';

      await expect(service.importFromUrl()).rejects.toThrow(
        /Aucune URL de flux GTFS-RT/,
      );
    });
  });
});
