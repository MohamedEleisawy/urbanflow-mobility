import { capabilitiesConfig } from './capabilities.config';

// =============================================================================
// Ce que ces tests verrouillent
// =============================================================================
// UNE SEULE PROPRIÉTÉ, et c'est la seule qui compte : une capacité n'est
// jamais annoncée disponible sans sa source. Tout le reste — le nom du
// fournisseur, la forme de l'objet — n'est vérifié que parce qu'il porte cette
// propriété.
//
// ⚠️ ON PASSE UN `env` EXPLICITE plutôt que de muter `process.env`. Un test qui
// écrit dans l'environnement du processus fuit sur les suivants selon l'ordre
// d'exécution, et ce genre de bogue met des heures à se voir.
// =============================================================================

describe('capabilitiesConfig', () => {
  const vide = {} as NodeJS.ProcessEnv;

  describe('routage', () => {
    it('NE DÉCLARE RIEN DISPONIBLE quand rien n’est configuré', () => {
      const config = capabilitiesConfig(vide);

      expect(config.walkRouting).toEqual({
        status: 'NOT_CONFIGURED',
        provider: null,
      });
      expect(config.bikeRouting.status).toBe('NOT_CONFIGURED');
      expect(config.transitRealtime.status).toBe('NOT_CONFIGURED');
    });

    it('déclare le routage piéton disponible quand les DEUX variables sont là', () => {
      const config = capabilitiesConfig({
        WALK_ROUTING_PROVIDER: 'osrm',
        WALK_ROUTING_BASE_URL: 'https://routeur.interne/osrm',
      });

      expect(config.walkRouting).toEqual({
        status: 'CONFIGURED',
        provider: 'osrm',
      });
    });

    it('REFUSE une configuration à moitié faite — fournisseur sans adresse', () => {
      // Un fournisseur qu'on ne sait pas joindre ne rend aucun itinéraire.
      // Annoncer « à pied disponible » ici enverrait l'usager vers un écran
      // d'erreur, ce qui est pire que de ne rien proposer.
      const config = capabilitiesConfig({
        WALK_ROUTING_PROVIDER: 'osrm',
      });

      expect(config.walkRouting.status).toBe('NOT_CONFIGURED');
      expect(config.walkRouting.provider).toBeNull();
    });

    it('REFUSE une configuration à moitié faite — adresse sans fournisseur', () => {
      const config = capabilitiesConfig({
        WALK_ROUTING_BASE_URL: 'https://routeur.interne/osrm',
      });

      expect(config.walkRouting.status).toBe('NOT_CONFIGURED');
    });

    it('traite une variable VIDE comme absente', () => {
      // `WALK_ROUTING_BASE_URL=` dans un fichier .env est une variable
      // déclarée et vide. Sans ce traitement, elle rendrait la capacité
      // « configurée » avec une adresse inutilisable.
      const config = capabilitiesConfig({
        WALK_ROUTING_PROVIDER: 'osrm',
        WALK_ROUTING_BASE_URL: '   ',
      });

      expect(config.walkRouting.status).toBe('NOT_CONFIGURED');
    });

    it('NE FAIT JAMAIS SORTIR L’ADRESSE DE BASE', () => {
      // ⚠️ Ce test protège un secret. `GET /api/capabilities` est public :
      // une adresse portant un jeton dans son chemin serait publiée à tout
      // visiteur. Le contrat est que SEUL le nom du fournisseur sort.
      const config = capabilitiesConfig({
        TRANSIT_REALTIME_PROVIDER: 'siri-lite',
        TRANSIT_REALTIME_BASE_URL: 'https://api.cts.fr/v1?key=SECRET-REEL',
      });

      expect(config.transitRealtime.status).toBe('CONFIGURED');
      expect(JSON.stringify(config)).not.toContain('SECRET-REEL');
      expect(JSON.stringify(config)).not.toContain('api.cts.fr');
    });

    it('SÉPARE le routage cyclable du vélo en libre-service', () => {
      // Vélhop répond, mais aucun routeur cyclable n'est branché : savoir où
      // sont les vélos ne dit pas par où l'on roule.
      const config = capabilitiesConfig({
        BIKE_ROUTING_PROVIDER: '',
      });

      expect(config.bikeRouting.status).toBe('NOT_CONFIGURED');
    });
  });

  describe('identité légale', () => {
    it('N’INVENTE AUCUNE COORDONNÉE quand rien n’est configuré', () => {
      // Un nom de société fabriqué sur une page « Mentions légales » ne serait
      // pas du texte de remplissage : ce serait une fausse identité de
      // responsable de traitement, sur la page même qui doit la donner.
      const config = capabilitiesConfig(vide);

      expect(config.legal).toEqual({
        entityName: null,
        contactEmail: null,
        privacyContactEmail: null,
      });
    });

    it('rend les coordonnées configurées, débarrassées de leurs espaces', () => {
      const config = capabilitiesConfig({
        LEGAL_ENTITY_NAME: '  UrbanFlow SAS ',
        LEGAL_CONTACT_EMAIL: 'contact@exemple.test',
        PRIVACY_CONTACT_EMAIL: 'dpo@exemple.test',
      });

      expect(config.legal).toEqual({
        entityName: 'UrbanFlow SAS',
        contactEmail: 'contact@exemple.test',
        privacyContactEmail: 'dpo@exemple.test',
      });
    });

    it('accepte une identité PARTIELLEMENT renseignée', () => {
      // Contrairement au routage, les trois champs sont indépendants : un
      // exploitant peut publier un nom sans adresse de DPO. Chaque champ
      // absent sera signalé individuellement par l'interface.
      const config = capabilitiesConfig({
        LEGAL_ENTITY_NAME: 'UrbanFlow SAS',
      });

      expect(config.legal.entityName).toBe('UrbanFlow SAS');
      expect(config.legal.contactEmail).toBeNull();
      expect(config.legal.privacyContactEmail).toBeNull();
    });
  });
});
