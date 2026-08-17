import { createReadStream } from 'node:fs';
import { access, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { Logger } from '@nestjs/common';
import { GtfsSourceService } from './gtfs-source.service';

beforeAll(() => {
  Logger.overrideLogger(false);
});

// AUCUN test ne touche à Internet : les téléchargements sont simulés en
// remplaçant fetch, qui est global depuis Node 18.
const FIXTURES = join(__dirname, '..', '..', 'test', 'fixtures');
const fixture = (nom: string) => join(FIXTURES, nom);

describe('GtfsSourceService', () => {
  let service: GtfsSourceService;

  beforeEach(() => {
    service = new GtfsSourceService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Source 1 — dossier local
  // ---------------------------------------------------------------------------
  describe('dossier local', () => {
    it('accepte un dossier contenant les quatre fichiers', async () => {
      const flux = await service.resolve(fixture('gtfs-network'));

      expect(flux.folder).toBe(fixture('gtfs-network'));
      await flux.cleanup();
    });

    it("ne supprime JAMAIS un dossier fourni par l'utilisateur", async () => {
      const flux = await service.resolve(fixture('gtfs-network'));
      await flux.cleanup();

      // Le nettoyage ne concerne que les fichiers temporaires : un dossier
      // que l'utilisateur nous a désigné doit rester intact.
      await expect(
        access(join(fixture('gtfs-network'), 'stops.txt')),
      ).resolves.toBeUndefined();
    });

    it('refuse un dossier inexistant avec un message clair', async () => {
      await expect(
        service.resolve(fixture('dossier-qui-nexiste-pas')),
      ).rejects.toThrow(/Dossier GTFS introuvable/);
    });

    it('refuse un dossier auquel il manque un fichier obligatoire', async () => {
      // Le dossier racine des fixtures ne contient aucun .txt GTFS.
      await expect(service.resolve(FIXTURES)).rejects.toThrow(
        /Flux GTFS incomplet.*stops\.txt/s,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Source 2 — archive ZIP locale
  // ---------------------------------------------------------------------------
  describe('archive ZIP locale', () => {
    it('extrait les quatre fichiers vers un dossier temporaire', async () => {
      const flux = await service.resolve(fixture('gtfs-network.zip'));

      const fichiers = (await readdir(flux.folder)).sort();
      expect(fichiers).toEqual([
        'routes.txt',
        'stop_times.txt',
        'stops.txt',
        'trips.txt',
      ]);
      // Le dossier est bien temporaire, pas l'archive elle-même.
      expect(flux.folder).not.toBe(fixture('gtfs-network.zip'));

      await flux.cleanup();
    });

    it('extrait un contenu identique à celui du dossier de référence', async () => {
      const flux = await service.resolve(fixture('gtfs-network.zip'));

      const depuisZip = await readFile(join(flux.folder, 'stops.txt'), 'utf8');
      const depuisDossier = await readFile(
        join(fixture('gtfs-network'), 'stops.txt'),
        'utf8',
      );

      expect(depuisZip).toBe(depuisDossier);
      await flux.cleanup();
    });

    it('retrouve les fichiers même rangés dans un sous-dossier', async () => {
      // Les entrées s'appellent alors "gtfs-network/stops.txt" : la
      // comparaison se fait sur le nom de base.
      const flux = await service.resolve(fixture('gtfs-sousdossier.zip'));

      const fichiers = (await readdir(flux.folder)).sort();
      expect(fichiers).toContain('stops.txt');
      expect(fichiers).toContain('stop_times.txt');

      await flux.cleanup();
    });

    it('supprime le dossier temporaire au nettoyage', async () => {
      const flux = await service.resolve(fixture('gtfs-network.zip'));
      const dossier = flux.folder;

      await flux.cleanup();

      await expect(access(dossier)).rejects.toThrow();
    });

    it('refuse une archive à laquelle il manque un fichier', async () => {
      await expect(
        service.resolve(fixture('gtfs-incomplet.zip')),
      ).rejects.toThrow(/Flux GTFS incomplet.*stop_times\.txt/s);
    });

    it('refuse une archive corrompue', async () => {
      await expect(
        service.resolve(fixture('gtfs-corrompu.zip')),
      ).rejects.toThrow(/Archive GTFS illisible/);
    });

    it('refuse une archive inexistante', async () => {
      await expect(
        service.resolve(fixture('archive-absente.zip')),
      ).rejects.toThrow(/Archive GTFS introuvable/);
    });
  });

  // ---------------------------------------------------------------------------
  // Source 3 — archive distante
  // ---------------------------------------------------------------------------
  describe('archive via URL', () => {
    /// Simule une réponse HTTP dont le corps est un vrai fichier local.
    const simulerTelechargement = (cheminZip: string) => {
      const corps = Readable.toWeb(
        createReadStream(cheminZip),
      ) as ReadableStream<Uint8Array>;

      jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response(corps, { status: 200 }));
    };

    it('télécharge puis extrait une archive distante', async () => {
      simulerTelechargement(fixture('gtfs-network.zip'));

      const flux = await service.resolve('https://exemple.fr/reseau.zip');

      const fichiers = await readdir(flux.folder);
      expect(fichiers).toContain('stops.txt');
      expect(fichiers).toContain('stop_times.txt');

      await flux.cleanup();
    });

    it('applique un délai maximal au téléchargement', async () => {
      const espion = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(
          new Response(
            Readable.toWeb(
              createReadStream(fixture('gtfs-network.zip')),
            ) as ReadableStream<Uint8Array>,
            { status: 200 },
          ),
        );

      const flux = await service.resolve('https://exemple.fr/reseau.zip');
      await flux.cleanup();

      // Un serveur qui ne répond pas ne doit pas bloquer l'import
      // indéfiniment.
      expect(espion.mock.calls[0][1]).toHaveProperty('signal');
    });

    it('signale une réponse HTTP en erreur', async () => {
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response(null, { status: 404 }));

      await expect(
        service.resolve('https://exemple.fr/absent.zip'),
      ).rejects.toThrow(/HTTP 404/);
    });

    it('signale une erreur réseau', async () => {
      jest
        .spyOn(global, 'fetch')
        .mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));

      await expect(
        service.resolve('https://serveur-injoignable.invalid/reseau.zip'),
      ).rejects.toThrow(/Téléchargement impossible.*ENOTFOUND/s);
    });

    it('signale une réponse vide', async () => {
      // Un corps présent mais sans octet : l'archive téléchargée est vide.
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response(new Blob([]), { status: 200 }));

      await expect(
        service.resolve('https://exemple.fr/vide.zip'),
      ).rejects.toThrow(/Archive vide|illisible/);
    });

    it('refuse un protocole autre que http(s)', async () => {
      // file:// permettrait de faire lire n'importe quel fichier de la
      // machine : le service ne traite que http et https.
      const espion = jest.spyOn(global, 'fetch');

      await expect(
        service.resolve('ftp://exemple.fr/reseau.zip'),
      ).rejects.toThrow(/Protocole non autorisé/);
      // Et surtout : aucune requête n'est partie.
      expect(espion).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Équivalence des trois sources
  // ---------------------------------------------------------------------------
  it('les trois sources produisent exactement les mêmes fichiers', async () => {
    const lire = async (dossier: string) => ({
      stops: await readFile(join(dossier, 'stops.txt'), 'utf8'),
      routes: await readFile(join(dossier, 'routes.txt'), 'utf8'),
      trips: await readFile(join(dossier, 'trips.txt'), 'utf8'),
      stopTimes: await readFile(join(dossier, 'stop_times.txt'), 'utf8'),
    });

    const depuisDossier = await service.resolve(fixture('gtfs-network'));
    const contenuDossier = await lire(depuisDossier.folder);
    await depuisDossier.cleanup();

    const depuisZip = await service.resolve(fixture('gtfs-network.zip'));
    const contenuZip = await lire(depuisZip.folder);
    await depuisZip.cleanup();

    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(
          Readable.toWeb(
            createReadStream(fixture('gtfs-network.zip')),
          ) as ReadableStream<Uint8Array>,
          { status: 200 },
        ),
      );
    const depuisUrl = await service.resolve('https://exemple.fr/reseau.zip');
    const contenuUrl = await lire(depuisUrl.folder);
    await depuisUrl.cleanup();

    expect(contenuZip).toEqual(contenuDossier);
    expect(contenuUrl).toEqual(contenuDossier);
  });
});
