import { WalkRoutingService } from './walk-routing.service';

// =============================================================================
// Routage piéton — contrat du service
// =============================================================================
// ⚠️ AUCUN APPEL RÉSEAU RÉEL. `fetch` est remplacé : un test qui interrogerait
// l'instance publique de Valhalla serait lent, dépendant d'un tiers, et
// passerait ou échouerait selon la météo du réseau.
//
// ═══ CE QUI EST VÉRIFIÉ ═══
//
// La PROMESSE de ce service : ne jamais lever, ne jamais inventer, et ne jamais
// demander un profil automobile.
// =============================================================================

/// Réponse minimale d'un Valhalla en bonne santé : deux points, 327 m, 230 s.
const REPONSE_VALIDE = {
  trip: {
    legs: [
      {
        // Trois points RÉELS de Strasbourg, encodés en précision 6 :
        // 48.590251/7.746866 → 48.5894/7.7458 → 48.588630/7.744703.
        shape: 'uyut{AcrywMdt@raAbo@pcA',
        summary: { length: 0.327, time: 230 },
      },
    ],
  },
};

const DEPUIS = { latitude: 48.5902513, longitude: 7.7468657 };
const VERS = { latitude: 48.5886297, longitude: 7.7447026 };

describe('WalkRoutingService', () => {
  let service: WalkRoutingService;
  let fetchSimule: jest.Mock;

  const repondre = (corps: unknown, ok = true, status = 200) =>
    fetchSimule.mockResolvedValue({
      ok,
      status,
      json: () => Promise.resolve(corps),
    });

  beforeEach(() => {
    process.env.WALK_ROUTING_PROVIDER = 'valhalla';
    process.env.WALK_ROUTING_BASE_URL = 'https://valhalla.test';

    fetchSimule = jest.fn();
    global.fetch = fetchSimule;

    service = new WalkRoutingService();
  });

  afterEach(() => {
    delete process.env.WALK_ROUTING_PROVIDER;
    delete process.env.WALK_ROUTING_BASE_URL;
    jest.restoreAllMocks();
  });

  describe('configuration', () => {
    it('se déclare configuré quand les DEUX variables sont posées', () => {
      expect(service.estConfigure()).toBe(true);
    });

    it('n’est PAS configuré si l’adresse manque', () => {
      // Une configuration à moitié faite vaut « non configurée » : un
      // fournisseur sans adresse ne peut pas être appelé.
      delete process.env.WALK_ROUTING_BASE_URL;

      expect(service.estConfigure()).toBe(false);
    });

    it('n’appelle RIEN quand aucun moteur n’est configuré', async () => {
      delete process.env.WALK_ROUTING_PROVIDER;

      await expect(service.itineraire(DEPUIS, VERS)).resolves.toBeNull();
      expect(fetchSimule).not.toHaveBeenCalled();
    });
  });

  describe('appel au moteur', () => {
    it('demande le profil PIÉTON, jamais un profil automobile', async () => {
      // ⚠️ LE TEST LE PLUS IMPORTANT DE CE FICHIER. Un moteur voiture rendrait
      // un tracé plausible et FAUX : il évite les ruelles, ignore les passages
      // piétons et respecte des sens interdits qui ne s'appliquent pas à un
      // piéton. Bien plus trompeur qu'une droite assumée.
      repondre(REPONSE_VALIDE);

      await service.itineraire(DEPUIS, VERS);

      const [, options] = fetchSimule.mock.calls[0] as [
        string,
        { body: string },
      ];
      const envoye = JSON.parse(options.body) as { costing: string };

      expect(envoye.costing).toBe('pedestrian');
    });

    it('transmet les deux points dans l’ordre', async () => {
      repondre(REPONSE_VALIDE);

      await service.itineraire(DEPUIS, VERS);

      const [, options] = fetchSimule.mock.calls[0] as [
        string,
        { body: string },
      ];
      const envoye = JSON.parse(options.body) as {
        locations: { lat: number; lon: number }[];
      };

      expect(envoye.locations).toEqual([
        { lat: DEPUIS.latitude, lon: DEPUIS.longitude },
        { lat: VERS.latitude, lon: VERS.longitude },
      ]);
    });

    it('rend la distance et la durée DU MOTEUR, sans les recalculer', async () => {
      repondre(REPONSE_VALIDE);

      const trace = await service.itineraire(DEPUIS, VERS);

      // 0,327 km → 327 m ; 230 s → 4 min.
      expect(trace?.distanceM).toBe(327);
      expect(trace?.durationMin).toBe(4);
    });

    it('rend une géométrie GeoJSON en [longitude, latitude]', async () => {
      // ⚠️ L'ORDRE EST L'INVERSE DE CELUI DU DÉCODEUR ET DE LEAFLET. Une
      // inversion ne lève rien : elle place Strasbourg en Somalie.
      repondre(REPONSE_VALIDE);

      const trace = await service.itineraire(DEPUIS, VERS);

      expect(trace?.geometry.type).toBe('LineString');
      const [longitude, latitude] = trace!.geometry.coordinates[0];
      expect(longitude).toBeGreaterThan(0);
      expect(longitude).toBeLessThan(20);
      expect(latitude).toBeGreaterThan(40);
      expect(latitude).toBeLessThan(60);
    });

    it('n’interroge pas le moteur pour deux points CONFONDUS', async () => {
      repondre(REPONSE_VALIDE);

      await expect(service.itineraire(DEPUIS, DEPUIS)).resolves.toBeNull();
      expect(fetchSimule).not.toHaveBeenCalled();
    });
  });

  describe('pannes — le service ne lève JAMAIS', () => {
    it('rend `null` sur une réponse HTTP en erreur', async () => {
      repondre({}, false, 503);

      await expect(service.itineraire(DEPUIS, VERS)).resolves.toBeNull();
    });

    it('rend `null` quand le moteur est injoignable', async () => {
      fetchSimule.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(service.itineraire(DEPUIS, VERS)).resolves.toBeNull();
    });

    it('rend `null` sur une réponse dont la forme a changé', async () => {
      // Un fournisseur externe n'est pas un contrat qu'on maîtrise.
      repondre({ trip: { legs: [{ shape: 42, summary: {} }] } });

      await expect(service.itineraire(DEPUIS, VERS)).resolves.toBeNull();
    });

    it('rend `null` sur un tracé d’un seul point', async () => {
      // Une « ligne » d'un point ne se dessine pas — et signale une réponse
      // dégradée qu'il vaut mieux traiter comme une absence.
      repondre({
        trip: {
          legs: [{ shape: 'uyut{AcrywM', summary: { length: 0.1, time: 60 } }],
        },
      });

      await expect(service.itineraire(DEPUIS, VERS)).resolves.toBeNull();
    });

    it('ne rend JAMAIS zéro minute', async () => {
      // « 0 min de marche » se lit « vous y êtes », ce qui est faux à
      // cinquante mètres.
      repondre({
        trip: {
          legs: [
            {
              shape: 'uyut{AcrywMdt@raAbo@pcA',
              summary: { length: 0.02, time: 12 },
            },
          ],
        },
      });

      const trace = await service.itineraire(DEPUIS, VERS);

      expect(trace?.durationMin).toBe(1);
    });
  });

  describe('disjoncteur — un moteur en panne ne doit pas ralentir le produit', () => {
    it('reste FERMÉ tant que les échecs sont isolés', async () => {
      // Un échec arrive : un paquet perdu, une seconde de latence. Couper dès
      // le premier priverait le produit de routage piéton pour rien.
      fetchSimule.mockRejectedValueOnce(new Error('ECONNRESET'));
      await service.itineraire(DEPUIS, VERS);

      expect(service.disjoncteurOuvert()).toBe(false);

      repondre(REPONSE_VALIDE);
      await expect(service.itineraire(DEPUIS, VERS)).resolves.not.toBeNull();
    });

    it('S’OUVRE après trois échecs consécutifs', async () => {
      fetchSimule.mockRejectedValue(new Error('ECONNREFUSED'));

      for (let n = 0; n < 3; n += 1) {
        await service.itineraire(DEPUIS, VERS);
      }

      expect(service.disjoncteurOuvert()).toBe(true);
    });

    it('N’APPELLE PLUS le réseau une fois ouvert', async () => {
      // ⚠️ C'EST TOUT L'INTÉRÊT. Sans lui, chaque recherche d'itinéraire
      // attendait encore le délai complet — quatre secondes ajoutées à CHAQUE
      // recherche, indéfiniment, pour un échec prévisible.
      fetchSimule.mockRejectedValue(new Error('ECONNREFUSED'));
      for (let n = 0; n < 3; n += 1) await service.itineraire(DEPUIS, VERS);

      const appelsAvant = fetchSimule.mock.calls.length;
      await expect(service.itineraire(DEPUIS, VERS)).resolves.toBeNull();

      expect(fetchSimule.mock.calls.length).toBe(appelsAvant);
    });

    it('se REFERME dès qu’un appel aboutit', async () => {
      fetchSimule.mockRejectedValue(new Error('ECONNREFUSED'));
      for (let n = 0; n < 3; n += 1) await service.itineraire(DEPUIS, VERS);
      expect(service.disjoncteurOuvert()).toBe(true);

      // Une minute plus tard, le service est revenu.
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000);
      repondre(REPONSE_VALIDE);

      await expect(service.itineraire(DEPUIS, VERS)).resolves.not.toBeNull();
      expect(service.disjoncteurOuvert()).toBe(false);
    });

    it('ne compte PAS une absence de chemin comme une panne', async () => {
      // ⚠️ Deux situations différentes : un moteur en mauvais état, et un
      // moteur qui répond correctement « aucun chemin ». Confondre les deux
      // couperait le routage pour un trajet simplement impossible à pied.
      repondre({
        trip: {
          legs: [{ shape: 'uyut{AcrywM', summary: { length: 0.1, time: 60 } }],
        },
      });

      for (let n = 0; n < 4; n += 1) await service.itineraire(DEPUIS, VERS);

      expect(service.disjoncteurOuvert()).toBe(false);
    });
  });
});
