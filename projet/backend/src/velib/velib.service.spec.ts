import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { VelibService } from './velib.service';

// =============================================================================
// Vélib' — lecture du flux GBFS
// =============================================================================
// ⚠️ LE FOURNISSEUR EST SIMULÉ. Ces tests éprouvent NOTRE traduction — la
// fusion des deux flux, la lecture défensive, le cache, la fraîcheur — jamais
// Smovengo. Un test qui l'interrogerait vraiment échouerait hors ligne et
// dépendrait de l'état réel du réseau à l'instant du test.
//
// Les formes employées ici sont celles MESURÉES sur le flux réel :
// `station_id` numérique, booléens à 0/1, `last_reported` en secondes Unix, et
// `num_bikes_available_types` en LISTE d'objets à une clé.
// =============================================================================

describe('VelibService', () => {
  let service: VelibService;
  let appelFetch: jest.SpyInstance;

  /// Horodatage Unix, en SECONDES — la forme du flux.
  const REPORTE_SECONDES = 1788382184;
  const REPORTE_ISO = new Date(REPORTE_SECONDES * 1000).toISOString();

  const information = (stations: unknown[]) => ({ data: { stations } });
  const status = (stations: unknown[]) => ({ data: { stations } });

  const STATION_INFO = {
    station_id: 213688169,
    stationCode: '16107',
    name: 'Benjamin Godard - Victor Hugo',
    lat: 48.865983,
    lon: 2.275725,
    capacity: 35,
  };

  const STATION_STATUS = {
    station_id: 213688169,
    num_bikes_available: 13,
    num_bikes_available_types: [{ mechanical: 5 }, { ebike: 8 }],
    num_docks_available: 21,
    is_installed: 1,
    is_renting: 1,
    is_returning: 1,
    last_reported: REPORTE_SECONDES,
  };

  /**
   * Fait répondre les flux SELON L'URL demandée.
   *
   * ⚠️ PAR URL, ET NON PAR ORDRE D'APPEL. Le service lit désormais QUATRE
   * fichiers en parallèle — deux obligatoires, deux facultatifs — et un
   * simulateur qui répondrait « le premier appel, puis le second » se
   * romprait au premier ajout de flux. Répondre par URL décrit ce que le
   * service demande réellement.
   *
   * Un fichier sans réponse déclarée rend 404 : c'est ainsi qu'on éprouve
   * l'absence d'un flux facultatif.
   */
  const repondreSelonUrl = (
    reponses: Record<string, unknown>,
    statusHttp = 200,
  ) => {
    appelFetch.mockImplementation((url: string) => {
      const fichier = Object.keys(reponses).find((nom) => url.includes(nom));

      if (fichier === undefined) {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: () => Promise.resolve(null),
        });
      }

      return Promise.resolve({
        ok: statusHttp >= 200 && statusHttp < 300,
        status: statusHttp,
        json: () => Promise.resolve(reponses[fichier]),
      });
    });
  };

  /** Raccourci pour l'usage courant : le référentiel et l'état. */
  const repondre = (info: unknown, etat: unknown, statusHttp = 200) =>
    repondreSelonUrl(
      { 'station_information.json': info, 'station_status.json': etat },
      statusHttp,
    );

  const repondreNormalement = () =>
    repondre(information([STATION_INFO]), status([STATION_STATUS]));

  beforeEach(() => {
    appelFetch = jest.spyOn(global, 'fetch');
    // Une instance NEUVE par test : le cache ne doit pas fuir d'un test à
    // l'autre, sans quoi le second n'appellerait plus le flux du tout.
    service = new VelibService();
  });

  afterEach(() => {
    appelFetch.mockRestore();
  });

  // ---------------------------------------------------------------------------
  // Fusion des deux flux
  // ---------------------------------------------------------------------------
  describe('fusion information + status', () => {
    it('rapproche le référentiel et l’état par station_id', async () => {
      repondreNormalement();

      const { stations } = await service.findAll(50);

      expect(stations).toHaveLength(1);
      expect(stations[0]).toMatchObject({
        stationId: '213688169',
        stationCode: '16107',
        name: 'Benjamin Godard - Victor Hugo',
        latitude: 48.865983,
        longitude: 2.275725,
        capacity: 35,
        bikesAvailable: 13,
        docksAvailable: 21,
      });
    });

    it('lit les types de vélos dans la LISTE publiée par le flux', async () => {
      repondreNormalement();

      const { stations } = await service.findAll(50);

      // ⚠️ Le flux publie `[{mechanical: 5}, {ebike: 8}]`, PAS
      // `{mechanical: 5, ebike: 8}`. Supposer un objet plat rendrait
      // `undefined` sur les données réelles.
      expect(stations[0].mechanical).toBe(5);
      expect(stations[0].electric).toBe(8);
    });

    it('traduit les booléens publiés en 0 / 1', async () => {
      repondre(
        information([STATION_INFO]),
        status([{ ...STATION_STATUS, is_renting: 0, is_returning: 1 }]),
      );

      const { stations } = await service.findAll(50);

      expect(stations[0].isRenting).toBe(false);
      expect(stations[0].isReturning).toBe(true);
    });

    it('convertit last_reported en ISO, depuis des SECONDES', async () => {
      repondreNormalement();

      const { stations } = await service.findAll(50);

      // `new Date(secondes)` donnerait 1970 : l'erreur ne lèverait rien et
      // afficherait « actualisé il y a 56 ans ».
      expect(stations[0].lastReported).toBe(REPORTE_ISO);
      expect(new Date(stations[0].lastReported!).getFullYear()).toBeGreaterThan(
        2020,
      );
    });

    it('écarte une station SANS position ou SANS nom', async () => {
      repondre(
        information([
          STATION_INFO,
          { station_id: 2, name: 'Sans position' },
          { station_id: 3, lat: 48.8, lon: 2.3 },
        ]),
        status([STATION_STATUS]),
      );

      const { stations } = await service.findAll(50);

      // Une station sans nom ni position est indessinable et innommable :
      // l'écarter vaut mieux que d'inventer un libellé.
      expect(stations).toHaveLength(1);
    });

    it('garde une station connue mais SANS état publié', async () => {
      repondre(information([STATION_INFO]), status([]));

      const { stations } = await service.findAll(50);

      expect(stations).toHaveLength(1);
      // ⚠️ `null`, JAMAIS 0 : « nous ne savons pas » n'est pas « il n'y a
      // aucun vélo ». La carte doit pouvoir écrire « indisponible ».
      expect(stations[0].bikesAvailable).toBeNull();
      expect(stations[0].mechanical).toBeNull();
      expect(stations[0].electric).toBeNull();
      expect(stations[0].freshness).toBe('STATIC');
    });

    it('écarte un état orphelin, absent du référentiel', async () => {
      repondre(
        information([STATION_INFO]),
        status([STATION_STATUS, { station_id: 999, num_bikes_available: 4 }]),
      );

      const { stations } = await service.findAll(50);

      expect(stations).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Format nextbike (Vélhop Strasbourg) — l'autre forme GBFS réelle
  // ---------------------------------------------------------------------------
  describe('format nextbike', () => {
    /// Station Vélhop, telle que le flux réel la publie.
    const VELHOP_INFO = {
      station_id: '245557155',
      short_name: '62000',
      name: 'Bischheim Gare',
      lat: 48.611639,
      lon: 7.742056,
      capacity: 5,
    };

    const VELHOP_STATUS = {
      station_id: '245557155',
      num_bikes_available: 2,
      // ⚠️ AUTRE FORME QUE VÉLIB' : des identifiants de type, pas des noms.
      vehicle_types_available: [{ vehicle_type_id: '272', count: 2 }],
      num_docks_available: 3,
      // ⚠️ Et de VRAIS booléens, là où Vélib' publie 0 / 1.
      is_installed: true,
      is_renting: true,
      is_returning: true,
      last_reported: REPORTE_SECONDES,
    };

    const TYPES = {
      data: {
        vehicle_types: [
          {
            vehicle_type_id: '272',
            form_factor: 'bicycle',
            propulsion_type: 'human',
          },
        ],
      },
    };

    it('accepte un station_id en CHAÎNE', async () => {
      repondreSelonUrl({
        'station_information.json': information([VELHOP_INFO]),
        'station_status.json': status([VELHOP_STATUS]),
      });

      const { stations } = await service.findAll(50);

      expect(stations[0].stationId).toBe('245557155');
      expect(stations[0].name).toBe('Bischheim Gare');
    });

    it('accepte de VRAIS booléens', async () => {
      repondreSelonUrl({
        'station_information.json': information([VELHOP_INFO]),
        'station_status.json': status([
          { ...VELHOP_STATUS, is_renting: false },
        ]),
      });

      const { stations } = await service.findAll(50);

      expect(stations[0].isRenting).toBe(false);
      expect(stations[0].isReturning).toBe(true);
    });

    it('résout la motorisation grâce à vehicle_types.json', async () => {
      repondreSelonUrl({
        'station_information.json': information([VELHOP_INFO]),
        'station_status.json': status([VELHOP_STATUS]),
        'vehicle_types.json': TYPES,
      });

      const { stations } = await service.findAll(50);

      // Le flux réel de Vélhop ne déclare qu'un type, `human` : ces deux vélos
      // sont donc RÉELLEMENT mécaniques, et il y a RÉELLEMENT zéro électrique.
      expect(stations[0].mechanical).toBe(2);
      expect(stations[0].electric).toBe(0);
    });

    it('avoue son IGNORANCE quand vehicle_types.json manque', async () => {
      repondreSelonUrl({
        'station_information.json': information([VELHOP_INFO]),
        'station_status.json': status([VELHOP_STATUS]),
      });

      const { stations } = await service.findAll(50);

      // ⚠️ `null`, PAS `0`. Sans la table des types, « 272 » ne dit rien de la
      // motorisation : supposer « mécanique » ferait passer une hypothèse pour
      // une mesure. Le total, lui, reste connu.
      expect(stations[0].mechanical).toBeNull();
      expect(stations[0].electric).toBeNull();
      expect(stations[0].bikesAvailable).toBe(2);
    });

    it('ne compte NULLE PART un type absent de la table', async () => {
      repondreSelonUrl({
        'station_information.json': information([VELHOP_INFO]),
        'station_status.json': status([
          {
            ...VELHOP_STATUS,
            vehicle_types_available: [{ vehicle_type_id: 'inconnu', count: 7 }],
          },
        ]),
        'vehicle_types.json': TYPES,
      });

      const { stations } = await service.findAll(50);

      // Le ranger d'office dans « mécanique » gonflerait un chiffre que
      // l'usager croirait mesuré.
      expect(stations[0].mechanical).toBeNull();
      expect(stations[0].electric).toBeNull();
    });

    it('distingue un type électrique', async () => {
      repondreSelonUrl({
        'station_information.json': information([VELHOP_INFO]),
        'station_status.json': status([
          {
            ...VELHOP_STATUS,
            vehicle_types_available: [
              { vehicle_type_id: '272', count: 2 },
              { vehicle_type_id: '999', count: 3 },
            ],
          },
        ]),
        'vehicle_types.json': {
          data: {
            vehicle_types: [
              { vehicle_type_id: '272', propulsion_type: 'human' },
              { vehicle_type_id: '999', propulsion_type: 'electric_assist' },
            ],
          },
        },
      });

      const { stations } = await service.findAll(50);

      expect(stations[0].mechanical).toBe(2);
      expect(stations[0].electric).toBe(3);
    });

    it('reste lisible si un flux FACULTATIF est en panne', async () => {
      // `vehicle_types.json` et `system_information.json` renvoient 404 : la
      // lecture doit aboutir malgré tout, en avouant ce qu'elle ignore.
      repondreSelonUrl({
        'station_information.json': information([VELHOP_INFO]),
        'station_status.json': status([VELHOP_STATUS]),
      });

      const reponse = await service.findAll(50);

      expect(reponse.total).toBe(1);
      expect(reponse.attribution).toMatch(/libre-service/i);
    });
  });

  // ---------------------------------------------------------------------------
  // Fraîcheur — le mot « temps réel » ne s'écrit pas à la légère
  // ---------------------------------------------------------------------------
  describe('fraîcheur de la donnée', () => {
    it('annonce REALTIME quand un horodatage l’adosse', async () => {
      repondreNormalement();

      const { stations } = await service.findAll(50);

      expect(stations[0].freshness).toBe('REALTIME');
    });

    it('annonce UNKNOWN quand l’état existe SANS horodatage', async () => {
      const sansDate = { ...STATION_STATUS };
      delete (sansDate as Record<string, unknown>).last_reported;

      repondre(information([STATION_INFO]), status([sansDate]));

      const { stations } = await service.findAll(50);

      // Sans horodatage, rien ne distingue une mesure d'il y a trois secondes
      // d'une mesure d'il y a trois heures.
      expect(stations[0].freshness).toBe('UNKNOWN');
      expect(stations[0].lastReported).toBeNull();
    });

    it('date la LECTURE séparément de la MESURE', async () => {
      repondreNormalement();

      const reponse = await service.findAll(50);

      // `fetchedAt` date notre lecture, `lastReported` la mesure du
      // fournisseur : l'écart entre les deux EST l'âge du cache.
      expect(reponse.fetchedAt).toEqual(expect.any(String));
      expect(reponse.fetchedAt).not.toBe(reponse.stations[0].lastReported);
    });

    it('porte l’attribution LUE DANS LE FLUX', async () => {
      repondreSelonUrl({
        'station_information.json': information([STATION_INFO]),
        'station_status.json': status([STATION_STATUS]),
        'system_information.json': { data: { name: 'Vélhop - Strasbourg' } },
      });

      const reponse = await service.findAll(50);

      // ⚠️ Le nom de l'exploitant vient du flux, jamais du code : le coder en
      // dur se tromperait dès qu'on change de territoire.
      expect(reponse.attribution).toBe('Source : Vélhop - Strasbourg');
    });

    it('se replie sur une attribution neutre quand le flux ne se nomme pas', async () => {
      repondreNormalement();

      const reponse = await service.findAll(50);

      expect(reponse.attribution).toMatch(/libre-service/i);
      // Surtout pas un nom d'exploitant inventé.
      expect(reponse.attribution).not.toMatch(/Vélhop|Vélib/);
    });
  });

  // ---------------------------------------------------------------------------
  // Voisinage
  // ---------------------------------------------------------------------------
  describe('findNearby', () => {
    const AILLEURS = {
      station_id: 2,
      name: 'Loin',
      lat: 48.9,
      lon: 2.4,
      capacity: 20,
    };

    it('ne rend que les stations dans le rayon', async () => {
      repondre(information([STATION_INFO, AILLEURS]), status([STATION_STATUS]));

      const reponse = await service.findNearby(48.865983, 2.275725, 500, 50);

      expect(reponse.total).toBe(1);
      expect(reponse.stations[0].stationId).toBe('213688169');
    });

    it('ordonne de la plus proche à la plus éloignée et donne la distance', async () => {
      // ⚠️ `AILLEURS` est à ~10 km, donc HORS du plafond de 5 km : il ne
      // conviendrait pas ici. On prend une station voisine, à ~800 m.
      const VOISINE = {
        station_id: 3,
        name: 'Voisine',
        lat: 48.8732,
        lon: 2.275725,
        capacity: 20,
      };

      repondre(information([VOISINE, STATION_INFO]), status([STATION_STATUS]));

      const reponse = await service.findNearby(48.865983, 2.275725, 5000, 50);

      expect(reponse.stations).toHaveLength(2);
      expect(reponse.stations[0].distanceM).toBe(0);
      expect(reponse.stations[1].distanceM).toBeGreaterThan(0);
    });

    it('plafonne le rayon demandé', async () => {
      repondre(information([STATION_INFO, AILLEURS]), status([STATION_STATUS]));

      // 999 999 m couvrirait la France : le service ramène à 5 km.
      const reponse = await service.findNearby(0, 0, 999999, 50);

      expect(reponse.total).toBe(0);
    });

    it('rend une liste VIDE, et non une erreur, loin de tout', async () => {
      repondreNormalement();

      const reponse = await service.findNearby(-60, -140, 1000, 50);

      // « Aucune station à proximité » est une réponse, pas une panne.
      expect(reponse.stations).toEqual([]);
      expect(reponse.total).toBe(0);
    });

    it('respecte la limite tout en annonçant le total réel', async () => {
      repondre(
        information([STATION_INFO, { ...AILLEURS, lat: 48.866, lon: 2.2758 }]),
        status([STATION_STATUS]),
      );

      const reponse = await service.findNearby(48.865983, 2.275725, 5000, 1);

      expect(reponse.stations).toHaveLength(1);
      expect(reponse.total).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Station unique
  // ---------------------------------------------------------------------------
  describe('findOne', () => {
    it('rend la station demandée', async () => {
      repondreNormalement();

      const station = await service.findOne('213688169');

      expect(station.name).toBe('Benjamin Godard - Victor Hugo');
    });

    it('lève 404 pour un identifiant inconnu', async () => {
      repondreNormalement();

      await expect(service.findOne('inexistante')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Cache
  // ---------------------------------------------------------------------------
  describe('cache', () => {
    it('ne télécharge le flux qu’UNE fois pour deux appels rapprochés', async () => {
      repondreNormalement();

      await service.findAll(50);
      await service.findAll(50);

      // Quatre fichiers (deux obligatoires, deux facultatifs), UNE seule
      // lecture : huit appels signifieraient que le cache ne sert à rien.
      expect(appelFetch).toHaveBeenCalledTimes(4);
    });

    it('partage UNE seule lecture entre des appels simultanés', async () => {
      repondreNormalement();

      // Sans verrou, dix usagers arrivant ensemble déclencheraient dix
      // téléchargements de 730 ko en parallèle.
      await Promise.all([
        service.findAll(50),
        service.findAll(50),
        service.findAll(50),
      ]);

      expect(appelFetch).toHaveBeenCalledTimes(4);
    });

    it('ne met PAS en cache un échec', async () => {
      appelFetch.mockRejectedValue(new Error('réseau coupé'));

      await expect(service.findAll(50)).rejects.toThrow(
        ServiceUnavailableException,
      );

      // Le flux redevient joignable : la requête suivante doit réessayer.
      appelFetch.mockReset();
      repondreNormalement();

      await expect(service.findAll(50)).resolves.toMatchObject({ total: 1 });
    });
  });

  // ---------------------------------------------------------------------------
  // Robustesse du fournisseur
  // ---------------------------------------------------------------------------
  describe('pannes du fournisseur', () => {
    it('traduit une coupure réseau en 503', async () => {
      appelFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(service.findAll(50)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('traduit un HTTP 500 en 503', async () => {
      repondre(null, null, 500);

      await expect(service.findAll(50)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('traduit un JSON illisible en 503', async () => {
      appelFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error('Unexpected token')),
      });

      await expect(service.findAll(50)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('refuse une réponse de forme inattendue plutôt que de planter', async () => {
      // Une page d'erreur rendue en JSON, ou un schéma changé.
      repondre({ message: 'nope' }, { message: 'nope' });

      await expect(service.findAll(50)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('refuse un flux lisible mais VIDE', async () => {
      repondre(information([]), status([]));

      // Zéro station est une anomalie, pas une réponse : mieux vaut le dire
      // que d'afficher une carte vide sans explication.
      await expect(service.findAll(50)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('ne divulgue NI l’adresse du flux NI la panne dans le message', async () => {
      appelFetch.mockRejectedValue(
        new Error('connect ECONNREFUSED 51.15.2.3:443'),
      );

      // On inspecte le message RÉEL plutôt que de composer des matchers
      // typés `any` : plus lisible, et le linter n'a rien à redire.
      await expect(service.findAll(50)).rejects.toThrow(
        /momentanément indisponibles/,
      );

      const echec: unknown = await service.findAll(50).catch((e: unknown) => e);
      const message = echec instanceof Error ? echec.message : '';

      expect(message).not.toContain('ECONNREFUSED');
      expect(message).not.toContain('51.15.2.3');
    });

    it('borne l’attente par un délai', async () => {
      repondreNormalement();

      await service.findAll(50);

      // Sans `signal`, une requête pendante bloquerait un client
      // indéfiniment.
      const appels = appelFetch.mock.calls as [string, RequestInit][];
      const referentiel = appels.find(([url]) =>
        url.includes('station_information.json'),
      );

      expect(referentiel).toBeDefined();
      expect(referentiel?.[1].signal).toBeDefined();
    });
  });
});
