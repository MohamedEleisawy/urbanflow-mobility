// Charge projet/backend/.env (DATABASE_URL, JWT_SECRET...).
import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

// Adresses favorites — Domicile et Travail (bloc 7).
//
// PostgreSQL est RÉEL : la contrainte `@@unique([userId, type])` et la clé
// étrangère sont exécutées par la base. Un Prisma simulé validerait la
// simulation, alors que c'est précisément la contrainte qu'on veut éprouver —
// c'est elle, et non le service, qui empêche deux domiciles.
describe('Adresses favorites (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const userIds: string[] = [];
  const PREFIXE = `e2e-7-${Date.now()}`;
  const MOT_DE_PASSE = 'motdepasse-de-test';

  let jetonA: string;
  let jetonB: string;
  let idA: string;

  interface Adresse {
    id: string;
    type: 'HOME' | 'WORK';
    address: string;
    latitude: number;
    longitude: number;
    createdAt: string;
  }

  const DOMICILE = {
    type: 'HOME',
    address: '12 rue des Lilas, 75011 Paris',
    latitude: 48.8566,
    longitude: 2.3522,
  };

  const TRAVAIL = {
    type: 'WORK',
    address: '3 avenue de la Gare, 75012 Paris',
    latitude: 48.8443,
    longitude: 2.3735,
  };

  const creerUsager = async (suffixe: string) => {
    const email = `${PREFIXE}-${suffixe}@example.com`;

    await request(app.getHttpServer())
      .post('/api/users')
      .send({ email, password: MOT_DE_PASSE })
      .expect(201);

    const cree = await prisma.user.findUniqueOrThrow({ where: { email } });
    userIds.push(cree.id);

    const connexion = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: MOT_DE_PASSE })
      .expect(200);

    return {
      id: cree.id,
      jeton: (connexion.body as { accessToken: string }).accessToken,
    };
  };

  const creerAdresse = async (jeton: string, corps: object) => {
    const reponse = await request(app.getHttpServer())
      .post('/api/users/me/addresses')
      .set('Authorization', `Bearer ${jeton}`)
      .send(corps)
      .expect(201);

    return reponse.body as Adresse;
  };

  const lister = async (jeton: string) => {
    const reponse = await request(app.getHttpServer())
      .get('/api/users/me/addresses')
      .set('Authorization', `Bearer ${jeton}`)
      .expect(200);

    return reponse.body as Adresse[];
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

    prisma = app.get(PrismaService);

    const a = await creerUsager('usager-a');
    idA = a.id;
    jetonA = a.jeton;
    jetonB = (await creerUsager('usager-b')).jeton;
  });

  afterEach(async () => {
    // Chaque test repart d'un compte sans adresse : la contrainte d'unicité
    // rendrait sinon le second `POST HOME` d'un autre test conflictuel.
    await prisma.favoriteAddress.deleteMany({
      where: { userId: { in: userIds } },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  // ===========================================================================
  // Protection
  // ===========================================================================
  describe('protection', () => {
    it('anonyme → 401 sur les quatre routes', async () => {
      const serveur = app.getHttpServer();
      const id = '11111111-1111-1111-1111-111111111111';

      await request(serveur).get('/api/users/me/addresses').expect(401);
      await request(serveur)
        .post('/api/users/me/addresses')
        .send(DOMICILE)
        .expect(401);
      await request(serveur)
        .patch(`/api/users/me/addresses/${id}`)
        .send({ address: 'x' })
        .expect(401);
      await request(serveur)
        .delete(`/api/users/me/addresses/${id}`)
        .expect(401);
    });

    it('jeton invalide → 401', async () => {
      await request(app.getHttpServer())
        .get('/api/users/me/addresses')
        .set('Authorization', 'Bearer pas-un-vrai-jeton')
        .expect(401);
    });

    it('compte supprimé → 401, même avec un jeton encore valide', async () => {
      const { id, jeton } = await creerUsager('supprime');
      await creerAdresse(jeton, DOMICILE);

      await request(app.getHttpServer())
        .delete('/api/users/me')
        .set('Authorization', `Bearer ${jeton}`)
        .expect(204);

      // La suppression de compte est LOGIQUE (5G) : la ligne existe toujours.
      // Mais `JwtAuthGuard` interroge la base à chaque requête, donc aucune
      // route active ne la rend accessible. Rien de particulier n'a eu à être
      // écrit dans ce module pour l'obtenir.
      await request(app.getHttpServer())
        .get('/api/users/me/addresses')
        .set('Authorization', `Bearer ${jeton}`)
        .expect(401);

      const survivantes = await prisma.favoriteAddress.count({
        where: { userId: id },
      });
      expect(survivantes).toBe(1);
    });
  });

  // ===========================================================================
  // Lecture (7-4)
  // ===========================================================================
  describe('GET /api/users/me/addresses', () => {
    it('rend un tableau VIDE, jamais 404, sur un compte neuf', async () => {
      // « Aucune adresse » n'est pas une erreur : c'est l'état normal.
      expect(await lister(jetonA)).toEqual([]);
    });

    it('rend les adresses du compte appelant', async () => {
      await creerAdresse(jetonA, DOMICILE);

      const adresses = await lister(jetonA);

      expect(adresses).toHaveLength(1);
      expect(adresses[0].address).toBe(DOMICILE.address);
      expect(adresses[0].latitude).toBe(DOMICILE.latitude);
      expect(adresses[0].longitude).toBe(DOMICILE.longitude);
    });

    it('A ne voit JAMAIS les adresses de B', async () => {
      await creerAdresse(jetonB, DOMICILE);

      // Aucun identifiant n'est transmis : la route vise `/me`, et le serveur
      // lit l'identité dans le jeton. Il n'y a rien à falsifier.
      expect(await lister(jetonA)).toEqual([]);
      expect(await lister(jetonB)).toHaveLength(1);
    });

    it('ordonne HOME avant WORK, de façon déterministe', async () => {
      // Créées dans l'ordre INVERSE : si la liste suivait l'ordre
      // d'insertion, le travail arriverait en premier.
      await creerAdresse(jetonA, TRAVAIL);
      await creerAdresse(jetonA, DOMICILE);

      const adresses = await lister(jetonA);

      // PostgreSQL trie un enum selon son ordre de DÉCLARATION, et `HOME` est
      // déclaré en premier. L'ordre est TOTAL : la contrainte d'unicité
      // interdit deux fois le même type, donc aucune égalité à départager.
      expect(adresses.map((a) => a.type)).toEqual(['HOME', 'WORK']);
    });

    it('ne rend AUCUN champ au-delà du contrat', async () => {
      await creerAdresse(jetonA, DOMICILE);

      const [adresse] = await lister(jetonA);

      expect(Object.keys(adresse).sort()).toEqual([
        'address',
        'createdAt',
        'id',
        'latitude',
        'longitude',
        'type',
      ]);
      // `userId` est volontairement absent : la route est `/me`, l'appelant
      // sait déjà à qui appartiennent ces adresses.
      expect(adresse).not.toHaveProperty('userId');
    });
  });

  // ===========================================================================
  // Création (7-5)
  // ===========================================================================
  describe('POST /api/users/me/addresses', () => {
    it('crée une adresse et la rattache au JETON', async () => {
      const creee = await creerAdresse(jetonA, DOMICILE);

      const enBase = await prisma.favoriteAddress.findUniqueOrThrow({
        where: { id: creee.id },
      });

      // L'ownership vient du jeton, jamais du corps.
      expect(enBase.userId).toBe(idA);
    });

    it('conserve EXACTEMENT le texte et les coordonnées envoyés', async () => {
      const corps = {
        type: 'HOME',
        address: "  12 rue de l'Église, Saint-Étienne  ",
        latitude: -33.865143,
        longitude: 151.2099,
      };

      const creee = await creerAdresse(jetonA, corps);

      // AUCUN géocodage, aucun rognage, aucun arrondi : le projet n'appelle
      // aucun service d'adresses et ne réécrit pas ce qu'on lui confie.
      expect(creee.address).toBe(corps.address);
      expect(creee.latitude).toBe(corps.latitude);
      expect(creee.longitude).toBe(corps.longitude);
    });

    it('REFUSE un second domicile — 409', async () => {
      await creerAdresse(jetonA, DOMICILE);

      const reponse = await request(app.getHttpServer())
        .post('/api/users/me/addresses')
        .set('Authorization', `Bearer ${jetonA}`)
        .send({ ...DOMICILE, address: 'Une autre adresse' })
        .expect(409);

      expect(JSON.stringify(reponse.body)).toMatch(/domicile/i);
    });

    it('accepte un domicile ET un travail', async () => {
      await creerAdresse(jetonA, DOMICILE);
      await creerAdresse(jetonA, TRAVAIL);

      expect(await lister(jetonA)).toHaveLength(2);
    });

    it("l'unicité est par COMPTE, pas globale", async () => {
      await creerAdresse(jetonA, DOMICILE);

      // B doit pouvoir avoir son propre domicile.
      await creerAdresse(jetonB, DOMICILE);

      expect(await lister(jetonB)).toHaveLength(1);
    });

    describe('validation', () => {
      const refuse = (corps: object) =>
        request(app.getHttpServer())
          .post('/api/users/me/addresses')
          .set('Authorization', `Bearer ${jetonA}`)
          .send(corps)
          .expect(400);

      it('refuse un type inconnu', async () => {
        await refuse({ ...DOMICILE, type: 'GYM' });
      });

      it('refuse une adresse vide', async () => {
        await refuse({ ...DOMICILE, address: '' });
      });

      it('refuse une adresse démesurée', async () => {
        await refuse({ ...DOMICILE, address: 'x'.repeat(256) });
      });

      it('refuse une latitude hors bornes', async () => {
        await refuse({ ...DOMICILE, latitude: 91 });
        await refuse({ ...DOMICILE, latitude: -90.1 });
      });

      it('refuse une longitude hors bornes', async () => {
        await refuse({ ...DOMICILE, longitude: 180.5 });
        await refuse({ ...DOMICILE, longitude: -181 });
      });

      it('refuse une coordonnée textuelle', async () => {
        await refuse({ ...DOMICILE, latitude: '48.8566' });
      });

      it('refuse NaN et Infinity', async () => {
        // JSON ne sait pas transporter NaN : ils arrivent sous forme de
        // `null` ou de chaîne. `@IsNumber()` les refuse dans les deux cas.
        await refuse({ ...DOMICILE, latitude: null });
        await refuse({ ...DOMICILE, longitude: 'Infinity' });
      });

      it('refuse un champ inconnu — 400', async () => {
        // `forbidNonWhitelisted` : c'est ce qui rend impossible de glisser un
        // `userId` dans le corps pour viser un autre compte.
        await refuse({ ...DOMICILE, userId: idA });
      });

      it('refuse un corps incomplet', async () => {
        await refuse({ type: 'HOME' });
      });
    });
  });

  // ===========================================================================
  // Modification (7-5)
  // ===========================================================================
  describe('PATCH /api/users/me/addresses/:id', () => {
    it('modifie un seul champ sans toucher aux autres', async () => {
      const creee = await creerAdresse(jetonA, DOMICILE);

      const reponse = await request(app.getHttpServer())
        .patch(`/api/users/me/addresses/${creee.id}`)
        .set('Authorization', `Bearer ${jetonA}`)
        .send({ address: '99 boulevard Neuf, Lyon' })
        .expect(200);

      const modifiee = reponse.body as Adresse;
      expect(modifiee.address).toBe('99 boulevard Neuf, Lyon');
      // Les coordonnées n'étaient pas dans le corps : elles sont intactes.
      expect(modifiee.latitude).toBe(DOMICILE.latitude);
      expect(modifiee.type).toBe('HOME');
    });

    it('A ne peut PAS modifier une adresse de B — 404', async () => {
      const deB = await creerAdresse(jetonB, DOMICILE);

      await request(app.getHttpServer())
        .patch(`/api/users/me/addresses/${deB.id}`)
        .set('Authorization', `Bearer ${jetonA}`)
        .send({ address: 'piratée' })
        .expect(404);

      // Et rien n'a bougé.
      const [inchangee] = await lister(jetonB);
      expect(inchangee.address).toBe(DOMICILE.address);
    });

    it('404 — et non 403 — sur une adresse d’autrui', async () => {
      const deB = await creerAdresse(jetonB, DOMICILE);

      // Répondre 403 confirmerait à un curieux que l'identifiant existe.
      // « Inexistante » et « pas à vous » sont volontairement indiscernables.
      const reponse = await request(app.getHttpServer())
        .patch(`/api/users/me/addresses/${deB.id}`)
        .set('Authorization', `Bearer ${jetonA}`)
        .send({ address: 'x' });

      expect(reponse.status).toBe(404);
    });

    it('adresse inexistante → 404', async () => {
      await request(app.getHttpServer())
        .patch('/api/users/me/addresses/11111111-1111-1111-1111-111111111111')
        .set('Authorization', `Bearer ${jetonA}`)
        .send({ address: 'x' })
        .expect(404);
    });

    it('identifiant mal formé → 400, sans toucher la base', async () => {
      await request(app.getHttpServer())
        .patch('/api/users/me/addresses/pas-un-uuid')
        .set('Authorization', `Bearer ${jetonA}`)
        .send({ address: 'x' })
        .expect(400);
    });

    it('REFUSE de basculer vers un type déjà occupé — 409', async () => {
      await creerAdresse(jetonA, DOMICILE);
      const travail = await creerAdresse(jetonA, TRAVAIL);

      await request(app.getHttpServer())
        .patch(`/api/users/me/addresses/${travail.id}`)
        .set('Authorization', `Bearer ${jetonA}`)
        .send({ type: 'HOME' })
        .expect(409);
    });

    it('autorise le changement de type si la place est libre', async () => {
      const travail = await creerAdresse(jetonA, TRAVAIL);

      const reponse = await request(app.getHttpServer())
        .patch(`/api/users/me/addresses/${travail.id}`)
        .set('Authorization', `Bearer ${jetonA}`)
        .send({ type: 'HOME' })
        .expect(200);

      expect((reponse.body as Adresse).type).toBe('HOME');
    });

    it('applique les mêmes contrôles qu’à la création', async () => {
      const creee = await creerAdresse(jetonA, DOMICILE);

      // `@IsOptional` n'écarte les autres décorateurs que si la valeur est
      // ABSENTE. Présente, elle subit exactement les mêmes contrôles.
      for (const corps of [
        { latitude: 91 },
        { longitude: -181 },
        { address: '' },
        { type: 'GYM' },
        { userId: idA },
      ]) {
        await request(app.getHttpServer())
          .patch(`/api/users/me/addresses/${creee.id}`)
          .set('Authorization', `Bearer ${jetonA}`)
          .send(corps)
          .expect(400);
      }
    });
  });

  // ===========================================================================
  // Suppression (7-5)
  // ===========================================================================
  describe('DELETE /api/users/me/addresses/:id', () => {
    it('supprime et répond 204', async () => {
      const creee = await creerAdresse(jetonA, DOMICILE);

      await request(app.getHttpServer())
        .delete(`/api/users/me/addresses/${creee.id}`)
        .set('Authorization', `Bearer ${jetonA}`)
        .expect(204);

      expect(await lister(jetonA)).toEqual([]);
    });

    it('libère la place pour une nouvelle adresse du même type', async () => {
      const creee = await creerAdresse(jetonA, DOMICILE);

      await request(app.getHttpServer())
        .delete(`/api/users/me/addresses/${creee.id}`)
        .set('Authorization', `Bearer ${jetonA}`)
        .expect(204);

      // La suppression est PHYSIQUE : la contrainte d'unicité ne bloque plus.
      await creerAdresse(jetonA, DOMICILE);
      expect(await lister(jetonA)).toHaveLength(1);
    });

    it('A ne peut PAS supprimer une adresse de B — 404', async () => {
      const deB = await creerAdresse(jetonB, DOMICILE);

      await request(app.getHttpServer())
        .delete(`/api/users/me/addresses/${deB.id}`)
        .set('Authorization', `Bearer ${jetonA}`)
        .expect(404);

      expect(await lister(jetonB)).toHaveLength(1);
    });

    it('supprimer deux fois → 404 la seconde', async () => {
      const creee = await creerAdresse(jetonA, DOMICILE);
      const url = `/api/users/me/addresses/${creee.id}`;

      await request(app.getHttpServer())
        .delete(url)
        .set('Authorization', `Bearer ${jetonA}`)
        .expect(204);

      // Pas d'idempotence ici, contrairement à `DELETE /users/me` : là-bas,
      // distinguer « inexistant » de « déjà supprimé » aurait renseigné sur
      // l'existence d'un COMPTE. Ici, l'appelant n'atteint que ses propres
      // adresses, et savoir que le raccourci n'existe plus lui est utile.
      await request(app.getHttpServer())
        .delete(url)
        .set('Authorization', `Bearer ${jetonA}`)
        .expect(404);
    });

    it('identifiant mal formé → 400', async () => {
      await request(app.getHttpServer())
        .delete('/api/users/me/addresses/pas-un-uuid')
        .set('Authorization', `Bearer ${jetonA}`)
        .expect(400);
    });
  });
});
