// Charge projet/backend/.env (DATABASE_URL, JWT_SECRET...).
import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

// =============================================================================
// « Autour de moi » (e2e, war room)
// =============================================================================
// ═══ CE QUE CE FICHIER ÉPROUVE, ET QUE L'UNITAIRE NE PEUT PAS ═══
//
// L'ORDRE DE DÉCLARATION DES ROUTES. `@Get('nearby')` doit être apparié avant
// `@Get(':id')`, faute de quoi « nearby » serait lu comme un identifiant et
// produirait un 400. Aucun test unitaire ne voit ce genre de collision : elle
// n'existe qu'une fois le routeur HTTP monté.
//
// Et la VALIDATION RÉELLE des paramètres, qui passe par le `ValidationPipe`
// global et `class-transformer` — deux couches absentes d'un appel direct au
// service.
// =============================================================================

describe('GET /api/stops/nearby (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const PREFIXE = `e2e-nearby-${Date.now()}`;
  const stopIds: string[] = [];
  const lineIds: string[] = [];

  /// Un point de référence arbitraire, loin de tout réseau réel importé : ces
  /// tests ne doivent dépendre d'aucune donnée de production.
  const POINT = { lat: 10.0, lon: 10.0 };

  interface ArretProche {
    id: string;
    name: string;
    distanceM: number;
    walkMin: number;
    pmrAccessible: boolean;
    lines: { id: string; name: string; mode: string }[];
    nextDeparture: unknown;
  }

  interface Reponse {
    stops: ArretProche[];
    departuresFreshness: 'STATIC' | 'UNKNOWN';
  }

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

    // Deux quais du MÊME lieu, et un lieu voisin — la configuration exacte
    // d'Île-de-France Mobilités, qui publie un arrêt par quai.
    const quaiA = await prisma.stop.create({
      data: {
        name: `${PREFIXE} Grand Lieu`,
        latitude: 10.0,
        longitude: 10.0,
        operatorCode: 'E2E',
        gtfsStopId: `${PREFIXE}-A`,
      },
    });
    const quaiB = await prisma.stop.create({
      data: {
        name: `${PREFIXE} Grand Lieu`,
        latitude: 10.0005,
        longitude: 10.0,
        operatorCode: 'E2E',
        // Un seul des deux quais est accessible : le lieu doit l'être.
        pmrAccessible: true,
        gtfsStopId: `${PREFIXE}-B`,
      },
    });
    const voisin = await prisma.stop.create({
      data: {
        name: `${PREFIXE} Voisin`,
        latitude: 10.002,
        longitude: 10.0,
        operatorCode: 'E2E',
        gtfsStopId: `${PREFIXE}-C`,
      },
    });

    stopIds.push(quaiA.id, quaiB.id, voisin.id);

    const metro = await prisma.transitLine.create({
      data: {
        name: `${PREFIXE}-14`,
        mode: 'METRO',
        operator: 'E2E',
        gtfsRouteId: `${PREFIXE}-metro`,
      },
    });
    const bus = await prisma.transitLine.create({
      data: {
        name: `${PREFIXE}-63`,
        mode: 'BUS',
        operator: 'E2E',
        gtfsRouteId: `${PREFIXE}-bus`,
      },
    });
    // ⚠️ LA LIGNE PIÉTONNE : un artefact d'import, qui ne doit JAMAIS
    // apparaître comme une ligne empruntable.
    const marche = await prisma.transitLine.create({
      data: {
        name: `${PREFIXE}-Correspondance`,
        mode: 'WALK',
        operator: 'E2E',
        gtfsRouteId: `${PREFIXE}-walk`,
      },
    });

    lineIds.push(metro.id, bus.id, marche.id);

    await prisma.networkLink.createMany({
      data: [
        // Le métro part du quai A, le bus du quai B : deux lignes du même lieu.
        {
          lineId: metro.id,
          fromStopId: quaiA.id,
          toStopId: voisin.id,
          durationMin: 3,
          distanceM: 900,
        },
        {
          lineId: bus.id,
          fromStopId: quaiB.id,
          toStopId: voisin.id,
          durationMin: 5,
          distanceM: 900,
        },
        {
          lineId: marche.id,
          fromStopId: quaiA.id,
          toStopId: quaiB.id,
          durationMin: 1,
          distanceM: 60,
        },
      ],
    });
  });

  afterAll(async () => {
    // Les liaisons partent en cascade avec leurs lignes et leurs arrêts.
    if (lineIds.length > 0) {
      await prisma.transitLine.deleteMany({ where: { id: { in: lineIds } } });
    }
    if (stopIds.length > 0) {
      await prisma.stop.deleteMany({ where: { id: { in: stopIds } } });
    }

    await app.close();
  });

  const chercher = (parametres: Record<string, string | number>) =>
    request(app.getHttpServer())
      .get('/api/stops/nearby')
      .query(parametres as Record<string, string>);

  it('n’est PAS capturé par la route /stops/:id', async () => {
    // ⚠️ Nest apparie les routes DANS L'ORDRE DE DÉCLARATION. Placé après
    // `@Get(':id')`, « nearby » serait lu comme un identifiant et produirait un
    // 400 sur un UUID mal formé. Aucun test unitaire ne voit cette collision.
    await chercher({ ...POINT, radiusM: 500 }).expect(200);
  });

  it('REGROUPE les quais du même lieu', async () => {
    const reponse = await chercher({ ...POINT, radiusM: 500 }).expect(200);
    const corps = reponse.body as Reponse;

    const noms = corps.stops.map((arret) => arret.name);

    expect(noms.filter((nom) => nom === `${PREFIXE} Grand Lieu`)).toHaveLength(
      1,
    );
  });

  it('FUSIONNE les lignes des quais, et ÉCARTE la correspondance à pied', async () => {
    const reponse = await chercher({ ...POINT, radiusM: 500 }).expect(200);
    const corps = reponse.body as Reponse;

    const lieu = corps.stops.find(
      (arret) => arret.name === `${PREFIXE} Grand Lieu`,
    );

    const noms = (lieu?.lines ?? []).map((ligne) => ligne.name).sort();

    // Le métro (quai A) ET le bus (quai B) : ne garder que le quai le plus
    // proche tairait la moitié de l'offre.
    expect(noms).toEqual([`${PREFIXE}-14`, `${PREFIXE}-63`]);

    // ⚠️ La ligne WALK est un ARTEFACT d'import. « Grand Lieu —
    // Correspondance » se lirait comme une ligne qu'on peut prendre.
    expect(noms).not.toContain(`${PREFIXE}-Correspondance`);
  });

  it('rend un lieu ACCESSIBLE dès qu’un de ses quais l’est', async () => {
    const reponse = await chercher({ ...POINT, radiusM: 500 }).expect(200);
    const corps = reponse.body as Reponse;

    const lieu = corps.stops.find(
      (arret) => arret.name === `${PREFIXE} Grand Lieu`,
    );

    expect(lieu?.pmrAccessible).toBe(true);
  });

  it('trie par distance CROISSANTE', async () => {
    const reponse = await chercher({ ...POINT, radiusM: 500 }).expect(200);
    const corps = reponse.body as Reponse;

    const distances = corps.stops.map((arret) => arret.distanceM);

    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });

  it('annonce UNKNOWN quand ces lignes n’ont aucun horaire', async () => {
    // ⚠️ « Aucun passage connu » n'est PAS « plus de service ». Ces lignes de
    // test n'ont aucun `stop_departure` : la réponse honnête est « nous ne
    // savons pas », et `nextDeparture` reste `null`.
    const reponse = await chercher({ ...POINT, radiusM: 500 }).expect(200);
    const corps = reponse.body as Reponse;

    expect(corps.departuresFreshness).toBe('UNKNOWN');
    expect(corps.stops.every((arret) => arret.nextDeparture === null)).toBe(
      true,
    );
  });

  it('ÉCARTE ce qui est hors du rayon', async () => {
    const reponse = await chercher({ ...POINT, radiusM: 100 }).expect(200);
    const corps = reponse.body as Reponse;

    // Le voisin est à ~220 m : il sort.
    expect(corps.stops.map((arret) => arret.name)).not.toContain(
      `${PREFIXE} Voisin`,
    );
  });

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------
  it('EXIGE les deux coordonnées', async () => {
    // Un « autour de moi » sans point de référence n'a pas de sens : mieux
    // vaut un 400 explicite qu'un repli silencieux sur le centre du
    // territoire, qui rendrait des arrêts sans rapport avec l'usager.
    await chercher({ lat: 10 }).expect(400);
    await chercher({ lon: 10 }).expect(400);
    await request(app.getHttpServer()).get('/api/stops/nearby').expect(400);
  });

  it('REFUSE des coordonnées hors bornes', async () => {
    await chercher({ lat: 91, lon: 10 }).expect(400);
    await chercher({ lat: 10, lon: 181 }).expect(400);
  });

  it('PLAFONNE le rayon', async () => {
    // ⚠️ Une borne de requête, pas un confort : sans elle, `radiusM=500000`
    // chargerait les 36 838 arrêts de la base pour en calculer la distance un
    // par un.
    await chercher({ ...POINT, radiusM: 500_000 }).expect(400);
  });

  it('REFUSE un champ non déclaré', async () => {
    // `forbidNonWhitelisted` : un paramètre inattendu est une erreur du client,
    // pas quelque chose à ignorer en silence.
    await chercher({ ...POINT, inattendu: 'oui' }).expect(400);
  });
});
