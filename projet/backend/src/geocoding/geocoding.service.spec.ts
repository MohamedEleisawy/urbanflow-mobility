import 'reflect-metadata';
import { ServiceUnavailableException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { GeocodingService } from './geocoding.service';
import { GeocodingQueryDto } from './dto/geocoding-query.dto';

// Recherche d'adresses (Phase 3A).
//
// ⚠️ AUCUN ACCÈS À INTERNET. `fetch` est simulé de bout en bout : un test qui
// interrogerait vraiment Nominatim échouerait hors ligne, consommerait le
// quota d'un service public gratuit, et rendrait des résultats différents
// d'un jour à l'autre.
describe('GeocodingService', () => {
  let service: GeocodingService;
  let appelFetch: jest.SpyInstance;

  const URL_TEST = 'https://geocodeur-de-test.example';
  const environnementInitial = process.env.GEOCODING_URL;

  /// Un résultat Nominatim tel qu'il arrive réellement : lat/lon en CHAÎNES.
  const resultatBrut = (
    nom: string,
    lat: string,
    lon: string,
  ): Record<string, unknown> => ({
    display_name: nom,
    lat,
    lon,
    // Champs que Nominatim rend vraiment et que nous ne devons PAS relayer.
    place_id: 123456,
    licence: 'Data © OpenStreetMap contributors',
    osm_type: 'way',
    osm_id: 5013364,
    boundingbox: ['48.85', '48.86', '2.29', '2.30'],
    importance: 0.77,
    place_rank: 30,
  });

  const repondre = (corps: unknown, status = 200) => {
    appelFetch.mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(corps),
    });
  };

  const chercher = (q = 'Tour Eiffel') =>
    service.search(plainToInstance(GeocodingQueryDto, { q }));

  beforeEach(() => {
    process.env.GEOCODING_URL = URL_TEST;
    service = new GeocodingService();
    appelFetch = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    appelFetch.mockRestore();
    process.env.GEOCODING_URL = environnementInitial;
  });

  // ---------------------------------------------------------------------------
  // Validation de la saisie
  // ---------------------------------------------------------------------------
  describe('validation de `q`', () => {
    const erreurs = async (q: unknown) =>
      validate(plainToInstance(GeocodingQueryDto, { q }));

    it('accepte une saisie ordinaire', async () => {
      expect(await erreurs('Tour Eiffel')).toHaveLength(0);
    });

    it('REFUSE une saisie vide', async () => {
      expect((await erreurs('')).length).toBeGreaterThan(0);
    });

    it('REFUSE une saisie trop courte', async () => {
      // En deçà de trois caractères, le fournisseur rendrait des milliers de
      // correspondances — et on n'interroge pas un service public avec « a ».
      expect((await erreurs('ab')).length).toBeGreaterThan(0);
    });

    it('REFUSE une saisie trop longue', async () => {
      expect((await erreurs('x'.repeat(121))).length).toBeGreaterThan(0);
    });

    it('rogne AVANT de mesurer la longueur', async () => {
      // Sans le `@Transform`, « ␣␣a␣␣ » passerait `@MinLength(3)` pour ne
      // valoir qu'un seul caractère utile.
      expect((await erreurs('  a  ')).length).toBeGreaterThan(0);
    });

    it('rogne les espaces d’une saisie valide', () => {
      const dto = plainToInstance(GeocodingQueryDto, { q: '  Châtelet  ' });

      expect(dto.q).toBe('Châtelet');
    });
  });

  // ---------------------------------------------------------------------------
  // Appel au fournisseur
  // ---------------------------------------------------------------------------
  describe('appel au fournisseur', () => {
    beforeEach(() => repondre([]));

    it('envoie un User-Agent identifiant l’application', async () => {
      await chercher();

      // ⚠️ EXIGÉ par la politique d'usage de Nominatim — et impossible à poser
      // depuis un navigateur, qui interdit cet en-tête. C'est la raison
      // première de l'existence de ce proxy.
      const [, options] = appelFetch.mock.calls[0] as [string, RequestInit];
      const entetes = options.headers as Record<string, string>;

      expect(entetes['User-Agent']).toMatch(/UrbanFlow/i);
    });

    it('impose un délai maximal', async () => {
      await chercher();

      // Sans lui, un fournisseur lent bloquerait une connexion du serveur
      // jusqu'à son propre timeout.
      const [, options] = appelFetch.mock.calls[0] as [string, RequestInit];

      expect(options.signal).toBeDefined();
    });

    it('BORNE le nombre de résultats demandés', async () => {
      await chercher();

      const [url] = appelFetch.mock.calls[0] as [string];

      expect(url).toContain('limit=5');
    });

    it('ne demande NI détail d’adresse NI polygone', async () => {
      await chercher();

      const [url] = appelFetch.mock.calls[0] as [string];

      // On ne demande que ce dont on se sert : moins d'octets transportés, et
      // moins de données personnelles manipulées.
      expect(url).toContain('addressdetails=0');
      expect(url).toContain('polygon_geojson=0');
    });

    it('échappe la saisie dans l’URL', async () => {
      await chercher('rue A & B #2');

      const [url] = appelFetch.mock.calls[0] as [string];

      // Sans échappement, un « & » couperait le paramètre en deux et
      // altérerait les suivants.
      expect(url).not.toContain('& B');
      expect(url).toContain('%26');
    });

    it('respecte GEOCODING_URL', async () => {
      await chercher();

      expect((appelFetch.mock.calls[0] as [string])[0]).toContain(URL_TEST);
    });

    it('se replie sur Nominatim public sans configuration', async () => {
      delete process.env.GEOCODING_URL;
      const sansConfig = new GeocodingService();
      repondre([]);

      await sansConfig.search(
        plainToInstance(GeocodingQueryDto, { q: 'Châtelet' }),
      );

      expect((appelFetch.mock.calls[0] as [string])[0]).toContain(
        'nominatim.openstreetmap.org',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Normalisation
  // ---------------------------------------------------------------------------
  describe('normalisation', () => {
    it('rend UNIQUEMENT label, latitude et longitude', async () => {
      repondre([resultatBrut('Tour Eiffel, Paris', '48.8584', '2.2945')]);

      const { items } = await chercher();

      // LA VÉRIFICATION CENTRALE : Nominatim rend une vingtaine de champs.
      // En relayer un seul de plus lierait notre contrat public au sien.
      expect(Object.keys(items[0]).sort()).toEqual([
        'label',
        'latitude',
        'longitude',
      ]);
    });

    it('CONVERTIT les coordonnées en nombres', async () => {
      repondre([resultatBrut('Tour Eiffel, Paris', '48.8584', '2.2945')]);

      const { items } = await chercher();

      // Nominatim rend des CHAÎNES. Les relayer telles quelles ferait refuser
      // le `POST /routes/search` en 400 par `@IsNumber()`.
      expect(items[0].latitude).toBe(48.8584);
      expect(items[0].longitude).toBe(2.2945);
      expect(typeof items[0].latitude).toBe('number');
    });

    it('rend plusieurs résultats dans l’ordre du fournisseur', async () => {
      repondre([
        resultatBrut('Gare du Nord, Paris', '48.8809', '2.3553'),
        resultatBrut('Gare du Nord, Lille', '50.6390', '3.0700'),
      ]);

      const { items } = await chercher('Gare du Nord');

      // Le fournisseur classe par pertinence : le réordonner ici
      // substituerait notre jugement au sien, sans rien y connaître.
      expect(items.map((i) => i.label)).toEqual([
        'Gare du Nord, Paris',
        'Gare du Nord, Lille',
      ]);
    });

    it('rend une liste VIDE — pas une erreur — sans résultat', async () => {
      repondre([]);

      const { items } = await chercher('zzzzzz introuvable');

      // « Aucun résultat » invite à reformuler ; « service indisponible »
      // invite à réessayer. Les confondre ferait corriger une saisie correcte.
      expect(items).toEqual([]);
    });

    it('joint la mention d’attribution', async () => {
      repondre([]);

      // Imposée par la licence ODbL. Elle voyage AVEC les résultats plutôt
      // que d'être écrite en dur côté frontend.
      expect((await chercher()).attribution).toMatch(/OpenStreetMap/);
    });

    it('ÉCARTE un résultat mal formé sans perdre les autres', async () => {
      repondre([
        resultatBrut('Bon résultat', '48.85', '2.35'),
        { display_name: 'Sans coordonnées' },
        { lat: '48.0', lon: '2.0' },
        resultatBrut('Autre bon résultat', '48.86', '2.36'),
      ]);

      const { items } = await chercher();

      // Un fournisseur externe peut changer de forme sans prévenir. Deux bons
      // résultats valent mieux qu'un 503 parce que le troisième était bancal.
      expect(items.map((i) => i.label)).toEqual([
        'Bon résultat',
        'Autre bon résultat',
      ]);
    });

    it('ÉCARTE des coordonnées hors bornes', async () => {
      repondre([
        resultatBrut('Latitude impossible', '91', '2.35'),
        resultatBrut('Longitude impossible', '48.85', '181'),
        resultatBrut('Correct', '48.85', '2.35'),
      ]);

      expect((await chercher()).items).toHaveLength(1);
    });

    it('ÉCARTE une coordonnée non numérique', async () => {
      repondre([resultatBrut('Texte au lieu d’un nombre', 'quarante', '2.35')]);

      expect((await chercher()).items).toEqual([]);
    });

    it('PLAFONNE les résultats même si le fournisseur en rend plus', async () => {
      repondre(
        Array.from({ length: 12 }, (_, i) =>
          resultatBrut(`Résultat ${i}`, '48.85', '2.35'),
        ),
      );

      // Le plafond est une règle de NOTRE contrat, pas une politesse envers
      // le fournisseur : une liste de douze propositions ralentit le choix.
      expect((await chercher()).items).toHaveLength(5);
    });
  });

  // ---------------------------------------------------------------------------
  // Pannes
  // ---------------------------------------------------------------------------
  describe('pannes du fournisseur', () => {
    it('traduit un 500 en 503', async () => {
      repondre({}, 500);

      // L'usager n'est responsable de rien et ne peut rien faire : c'est bien
      // NOTRE service qui est momentanément indisponible.
      await expect(chercher()).rejects.toThrow(ServiceUnavailableException);
    });

    it('traduit un 429 en 503', async () => {
      repondre({}, 429);

      await expect(chercher()).rejects.toThrow(ServiceUnavailableException);
    });

    it('traduit un timeout en 503', async () => {
      appelFetch.mockRejectedValue(
        Object.assign(new Error('The operation was aborted'), {
          name: 'TimeoutError',
        }),
      );

      await expect(chercher()).rejects.toThrow(ServiceUnavailableException);
    });

    it('traduit une panne réseau en 503', async () => {
      appelFetch.mockRejectedValue(new TypeError('fetch failed'));

      await expect(chercher()).rejects.toThrow(ServiceUnavailableException);
    });

    it('traduit un corps illisible en 503', async () => {
      appelFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
      });

      await expect(chercher()).rejects.toThrow(ServiceUnavailableException);
    });

    it('traduit une réponse qui n’est pas un tableau en 503', async () => {
      repondre({ erreur: 'forme inattendue' });

      await expect(chercher()).rejects.toThrow(ServiceUnavailableException);
    });

    it('NE JOURNALISE JAMAIS l’adresse cherchée', async () => {
      const journal = jest
        .spyOn(service['logger'], 'error')
        .mockImplementation(() => undefined);
      appelFetch.mockRejectedValue(new TypeError('fetch failed'));

      await expect(chercher('12 rue de mon domicile secret')).rejects.toThrow();

      // Une adresse est une donnée personnelle : la voir dans les journaux à
      // chaque panne reviendrait à constituer un historique par accident.
      const messages = journal.mock.calls.flat().join(' ');
      expect(messages).not.toContain('domicile');
      expect(messages).not.toContain('rue de');
    });
  });

  // ---------------------------------------------------------------------------
  // Ce que ce service ne fait PAS
  // ---------------------------------------------------------------------------
  describe('périmètre', () => {
    it("n'a AUCUNE dépendance injectée", () => {
      // Ni Prisma, ni repository, ni table, ni migration : ce service relaie
      // un appel et normalise une réponse. Rien n'est écrit nulle part.
      expect(GeocodingService).toHaveLength(0);
    });
  });
});
