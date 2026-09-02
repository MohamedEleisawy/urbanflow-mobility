// Charge projet/backend/.env (DATABASE_URL, JWT_SECRET...).
import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

// Recherche d'adresses — contrat HTTP (Phase 3A).
//
// ⚠️ LE FOURNISSEUR EST SIMULÉ. Ces tests éprouvent NOTRE contrat — validation,
// codes de statut, forme de la réponse — jamais Nominatim. Un test qui
// l'interrogerait vraiment échouerait hors ligne et consommerait le quota d'un
// service public gratuit.
describe('Géocodage (e2e)', () => {
  let app: INestApplication<App>;
  let appelFetch: jest.SpyInstance;

  const resultat = (nom: string, lat: string, lon: string) => ({
    display_name: nom,
    lat,
    lon,
    place_id: 1,
    licence: 'Data © OpenStreetMap contributors',
    boundingbox: ['48.85', '48.86', '2.29', '2.30'],
  });

  const repondre = (corps: unknown, status = 200) => {
    appelFetch.mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(corps),
    });
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ logger: false });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.setGlobalPrefix('api');
    await app.init();
  });

  beforeEach(() => {
    appelFetch = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    appelFetch.mockRestore();
  });

  afterAll(async () => {
    await app.close();
  });

  const chercher = (q: string) =>
    request(app.getHttpServer()).get(
      `/api/geocoding/search?q=${encodeURIComponent(q)}`,
    );

  // ===========================================================================
  // Accès
  // ===========================================================================
  describe('accès', () => {
    it('est PUBLIC : aucun jeton requis', async () => {
      repondre([]);

      // Le dossier place la recherche d'itinéraire en libre accès : exiger un
      // compte pour saisir une adresse fermerait la porte d'entrée de
      // l'application au visiteur.
      await chercher('Tour Eiffel').expect(200);
    });

    it('ignore un jeton fourni', async () => {
      repondre([]);

      await request(app.getHttpServer())
        .get('/api/geocoding/search?q=Chatelet')
        .set('Authorization', 'Bearer peu-importe')
        .expect(200);
    });
  });

  // ===========================================================================
  // Validation
  // ===========================================================================
  describe('validation', () => {
    it('400 sans paramètre q', async () => {
      await request(app.getHttpServer())
        .get('/api/geocoding/search')
        .expect(400);
    });

    it('400 sur une saisie trop courte', async () => {
      await chercher('ab').expect(400);
    });

    it('400 sur une saisie trop longue', async () => {
      await chercher('x'.repeat(121)).expect(400);
    });

    it('400 sur une saisie uniquement composée d’espaces', async () => {
      await chercher('     ').expect(400);
    });

    it('400 sur un paramètre inconnu', async () => {
      // `forbidNonWhitelisted` : un client ne peut pas glisser `limit=500`
      // pour faire porter à notre adresse IP une requête abusive.
      await request(app.getHttpServer())
        .get('/api/geocoding/search?q=Chatelet&limit=500')
        .expect(400);
    });

    it('N’APPELLE PAS le fournisseur si la saisie est refusée', async () => {
      await chercher('ab').expect(400);

      // La validation protège aussi le service tiers : une saisie invalide ne
      // doit consommer aucun quota.
      expect(appelFetch).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Réponse
  // ===========================================================================
  describe('réponse', () => {
    it('rend items et attribution', async () => {
      repondre([resultat('Tour Eiffel, Paris', '48.8584', '2.2945')]);

      const reponse = await chercher('Tour Eiffel').expect(200);
      const corps = reponse.body as {
        items: { label: string; latitude: number; longitude: number }[];
        attribution: string;
      };

      expect(corps.items).toHaveLength(1);
      expect(corps.items[0].label).toBe('Tour Eiffel, Paris');
      expect(corps.items[0].latitude).toBe(48.8584);
      expect(corps.attribution).toMatch(/OpenStreetMap/);
    });

    it('ne laisse FUIR aucun champ du fournisseur', async () => {
      repondre([resultat('Tour Eiffel, Paris', '48.8584', '2.2945')]);

      const reponse = await chercher('Tour Eiffel').expect(200);

      // Ni `place_id`, ni `licence`, ni `boundingbox` : notre contrat public
      // ne doit pas être celui d'un fournisseur qu'on doit pouvoir remplacer.
      const brut = JSON.stringify(reponse.body);
      expect(brut).not.toContain('place_id');
      expect(brut).not.toContain('boundingbox');
      expect(brut).not.toContain('licence');
    });

    it('200 avec une liste VIDE quand rien ne correspond', async () => {
      repondre([]);

      const reponse = await chercher('zzzzz introuvable').expect(200);

      // « Aucun résultat » n'est pas une erreur : c'est une réponse.
      expect((reponse.body as { items: unknown[] }).items).toEqual([]);
    });
  });

  // ===========================================================================
  // Pannes
  // ===========================================================================
  describe('pannes', () => {
    it('503 quand le fournisseur est en erreur', async () => {
      repondre({}, 500);

      await chercher('Tour Eiffel').expect(503);
    });

    it('503 quand le fournisseur est injoignable', async () => {
      appelFetch.mockRejectedValue(new TypeError('fetch failed'));

      await chercher('Tour Eiffel').expect(503);
    });

    it('503 — et non 200 avec une liste vide — sur une panne', async () => {
      appelFetch.mockRejectedValue(new TypeError('fetch failed'));

      const reponse = await chercher('Tour Eiffel');

      // Confondre les deux ferait corriger à l'usager une saisie parfaitement
      // correcte pendant une panne.
      expect(reponse.status).toBe(503);
      expect(reponse.body).not.toHaveProperty('items');
    });
  });
});
