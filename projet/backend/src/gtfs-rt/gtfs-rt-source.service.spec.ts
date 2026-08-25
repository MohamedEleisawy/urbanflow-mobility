import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { GtfsRtSourceService } from './gtfs-rt-source.service';

beforeAll(() => {
  Logger.overrideLogger(false);
});

// AUCUN test ne touche à Internet : fetch, global depuis Node 18, est
// remplacé. Même convention que GtfsSourceService (4C-4-5).
const FIXTURES = join(__dirname, '..', '..', 'test', 'fixtures', 'gtfs-rt');
const OCTETS_VALIDES = new Uint8Array(
  readFileSync(join(FIXTURES, 'flux-valide.pb')),
);

/// Simule une réponse HTTP dont le corps est un contenu binaire donné.
const simulerReponse = (
  corps: Uint8Array,
  init: ResponseInit = { status: 200 },
) =>
  jest
    .spyOn(global, 'fetch')
    .mockResolvedValue(new Response(corps as BodyInit, init));

describe('GtfsRtSourceService', () => {
  let service: GtfsRtSourceService;

  beforeEach(() => {
    service = new GtfsRtSourceService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Cas nominal
  // ---------------------------------------------------------------------------
  describe('téléchargement réussi', () => {
    it('rapporte exactement les octets reçus', async () => {
      simulerReponse(OCTETS_VALIDES);

      const octets = await service.fetchFeed('https://exemple.fr/alertes.pb');

      // Octet pour octet : le service ne transforme rien.
      expect(Buffer.from(octets)).toEqual(Buffer.from(OCTETS_VALIDES));
    });

    it('renvoie un Uint8Array', async () => {
      simulerReponse(OCTETS_VALIDES);

      const octets = await service.fetchFeed('https://exemple.fr/alertes.pb');

      // C'est ce qu'attend GtfsRtDecoderService : pas de chaîne de
      // caractères, pas de JSON — un flux binaire lu tel quel.
      expect(octets).toBeInstanceOf(Uint8Array);
    });

    it('accepte http comme https', async () => {
      simulerReponse(OCTETS_VALIDES);

      await expect(
        service.fetchFeed('http://exemple.fr/alertes.pb'),
      ).resolves.toBeInstanceOf(Uint8Array);
    });
  });

  // ---------------------------------------------------------------------------
  // Validation de l'URL — avant toute requête
  // ---------------------------------------------------------------------------
  describe("validation de l'URL", () => {
    it('refuse une URL malformée', async () => {
      const espion = jest.spyOn(global, 'fetch');

      await expect(service.fetchFeed('pas-une-url')).rejects.toThrow(
        /URL de flux GTFS-RT invalide/,
      );
      expect(espion).not.toHaveBeenCalled();
    });

    it('refuse le protocole file://', async () => {
      // Sans cette garde, une adresse file:///etc/passwd ferait lire un
      // fichier local. Même protection que GtfsSourceService.
      const espion = jest.spyOn(global, 'fetch');

      await expect(service.fetchFeed('file:///etc/passwd')).rejects.toThrow(
        /Protocole non autorisé/,
      );
      expect(espion).not.toHaveBeenCalled();
    });

    it('refuse le protocole ftp://', async () => {
      const espion = jest.spyOn(global, 'fetch');

      await expect(
        service.fetchFeed('ftp://exemple.fr/alertes.pb'),
      ).rejects.toThrow(/Protocole non autorisé/);
      expect(espion).not.toHaveBeenCalled();
    });

    it("nomme le protocole refusé dans l'erreur", async () => {
      await expect(
        service.fetchFeed('ftp://exemple.fr/alertes.pb'),
      ).rejects.toThrow(/"ftp:"/);
    });
  });

  // ---------------------------------------------------------------------------
  // Délai maximal
  // ---------------------------------------------------------------------------
  describe('délai maximal', () => {
    it("arme un signal d'annulation sur la requête", async () => {
      const espion = simulerReponse(OCTETS_VALIDES);

      await service.fetchFeed('https://exemple.fr/alertes.pb');

      // Sans signal, une requête pendante immobiliserait l'appelant
      // indéfiniment.
      const options = espion.mock.calls[0][1];
      expect(options?.signal).toBeInstanceOf(AbortSignal);
    });

    it("annule au bout de 10 s, pas des 30 s de l'import statique", async () => {
      // Un flux temps réel lent est un flux périmé : le délai est
      // délibérément plus court que celui du téléchargement d'archive.
      const espion = jest
        .spyOn(AbortSignal, 'timeout')
        .mockReturnValue(new AbortController().signal);
      simulerReponse(OCTETS_VALIDES);

      await service.fetchFeed('https://exemple.fr/alertes.pb');

      expect(espion).toHaveBeenCalledWith(10_000);
    });

    it('signale un dépassement de délai', async () => {
      jest
        .spyOn(global, 'fetch')
        .mockRejectedValue(
          new DOMException('The operation was aborted', 'TimeoutError'),
        );

      await expect(
        service.fetchFeed('https://serveur-lent.fr/alertes.pb'),
      ).rejects.toThrow(/injoignable.*aborted/s);
    });
  });

  // ---------------------------------------------------------------------------
  // Réponses en erreur
  // ---------------------------------------------------------------------------
  describe('réponse du serveur', () => {
    it('signale un 404', async () => {
      simulerReponse(new Uint8Array(0), { status: 404 });

      await expect(
        service.fetchFeed('https://exemple.fr/absent.pb'),
      ).rejects.toThrow(/HTTP 404/);
    });

    it('signale un 500', async () => {
      simulerReponse(new Uint8Array(0), { status: 500 });

      await expect(
        service.fetchFeed('https://exemple.fr/alertes.pb'),
      ).rejects.toThrow(/HTTP 500/);
    });

    it("rappelle l'URL fautive dans l'erreur HTTP", async () => {
      simulerReponse(new Uint8Array(0), { status: 503 });

      await expect(
        service.fetchFeed('https://exemple.fr/alertes.pb'),
      ).rejects.toThrow(/exemple\.fr\/alertes\.pb/);
    });

    it('signale une erreur réseau', async () => {
      jest
        .spyOn(global, 'fetch')
        .mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));

      await expect(
        service.fetchFeed('https://serveur-injoignable.invalid/alertes.pb'),
      ).rejects.toThrow(/injoignable.*ENOTFOUND/s);
    });

    it('refuse un corps vide', async () => {
      // Un corps de longueur nulle signale une erreur côté serveur, et non
      // « aucune perturbation » : ce cas-là a un en-tête et pèse 13 octets
      // (fixture flux-sans-entite.pb).
      simulerReponse(new Uint8Array(0));

      await expect(
        service.fetchFeed('https://exemple.fr/vide.pb'),
      ).rejects.toThrow(/vide/);
    });
  });

  // ---------------------------------------------------------------------------
  // Limite de taille — protection propre à cette étape
  // ---------------------------------------------------------------------------
  describe('limite de taille', () => {
    const MAX = 25 * 1024 * 1024;

    it('refuse un flux annoncé trop volumineux sans lire le corps', async () => {
      // Content-Length dépassant la limite : on refuse AVANT de lire le
      // corps, puisque le décodage protobuf exige tout le message en mémoire.
      const arrayBuffer = jest.fn();
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-length': String(MAX + 1) }),
        arrayBuffer,
      } as unknown as Response);

      await expect(
        service.fetchFeed('https://exemple.fr/enorme.pb'),
      ).rejects.toThrow(/trop volumineux.*annoncés/s);
      // Et surtout : le corps n'a jamais été lu.
      expect(arrayBuffer).not.toHaveBeenCalled();
    });

    it('refuse un flux dont les octets reçus dépassent la limite', async () => {
      // Un serveur peut mentir sur Content-Length, ou ne pas l'envoyer :
      // la vérification sur les octets réellement reçus reste indispensable.
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(MAX + 1)),
      } as unknown as Response);

      await expect(
        service.fetchFeed('https://exemple.fr/menteur.pb'),
      ).rejects.toThrow(/trop volumineux.*reçus/s);
    });

    it('accepte un flux sans Content-Length', async () => {
      // L'en-tête est facultatif : son absence ne doit pas faire échouer un
      // flux parfaitement normal.
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        arrayBuffer: () => Promise.resolve(OCTETS_VALIDES.buffer.slice(0)),
      } as unknown as Response);

      await expect(
        service.fetchFeed('https://exemple.fr/alertes.pb'),
      ).resolves.toBeInstanceOf(Uint8Array);
    });
  });

  // ---------------------------------------------------------------------------
  // Type d'erreur (étape 4F-1D)
  // ---------------------------------------------------------------------------
  describe("type d'erreur", () => {
    it.each([
      ['URL malformée', 'pas-une-url'],
      ['protocole refusé', 'ftp://exemple.fr/alertes.pb'],
    ])('lève une ServiceUnavailableException — %s', async (_cas, url) => {
      await expect(service.fetchFeed(url)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('lève une ServiceUnavailableException sur réponse HTTP en erreur', async () => {
      simulerReponse(new Uint8Array(0), { status: 404 });

      // Un appelant doit pouvoir distinguer « le serveur de l'opérateur n'a
      // pas répondu » de « le flux reçu est illisible » SANS lire le texte du
      // message — voir le décodeur, qui lève une UnprocessableEntityException.
      await expect(
        service.fetchFeed('https://exemple.fr/absent.pb'),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('lève une ServiceUnavailableException sur panne réseau', async () => {
      jest
        .spyOn(global, 'fetch')
        .mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));

      await expect(
        service.fetchFeed('https://injoignable.invalid/alertes.pb'),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  // ---------------------------------------------------------------------------
  // Frontière de responsabilité
  // ---------------------------------------------------------------------------
  it('ne décode rien : il rapporte des octets', async () => {
    // Le service accepte un contenu qui n'est PAS un flux GTFS-RT. Juger du
    // contenu appartient à GtfsRtDecoderService — c'est précisément ce qui
    // rend les pannes réseau testables sans fabriquer de protobuf valide.
    simulerReponse(new Uint8Array(Buffer.from('<html>erreur</html>')));

    const octets = await service.fetchFeed('https://exemple.fr/alertes.pb');

    expect(Buffer.from(octets).toString()).toBe('<html>erreur</html>');
  });
});
