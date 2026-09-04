// Charge projet/backend/.env (DATABASE_URL, JWT_SECRET...).
// Indispensable ici : en test end-to-end on importe AppModule directement,
// donc main.ts — qui fait normalement ce chargement — n'est jamais exécuté.
import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

// Test d'INTÉGRATION : contrairement aux tests unitaires, on démarre
// réellement l'application et on écrit dans PostgreSQL. Il vérifie donc
// aussi la validation HTTP, le routage et les requêtes Prisma.
describe('POST /api/routes/search (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  // Identifiants des données créées pour ce test, afin de ne supprimer
  // QUE celles-ci à la fin (et pas les données de développement).
  const stopIds: string[] = [];
  const lineIds: string[] = [];
  // Identifiants nommés des lignes (étape 4E-3A) : les tests doivent
  // pouvoir vérifier que le `lineId` renvoyé est EXACTEMENT celui de la
  // liaison retenue, ce qu'un simple tableau ne permettrait pas.
  let ligneMarcheId: string;
  let ligneBus12Id: string;
  let ligneBus99Id: string;
  let ligneBus99BisId: string;
  // Données PERSONNELLES d'un usager, créées volontairement pour prouver
  // qu'elles n'influencent JAMAIS la recherche publique (étape 4C-3).
  let routeId: string;
  let userId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // On reproduit la configuration de main.ts, sinon la validation et le
    // préfixe /api ne s'appliqueraient pas et le test ne refléterait pas
    // le comportement réel de l'application.
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

    // --- Jeu de données ---------------------------------------------------
    // Coordonnées volontairement placées au large de l'Atlantique (0,0) :
    // aucun risque de collision avec de vraies données de développement.
    const a = await prisma.stop.create({
      data: {
        name: 'E2E Arret A',
        latitude: 0.0,
        longitude: 0.0,
        operatorCode: 'E2E',
      },
    });
    const b = await prisma.stop.create({
      data: {
        name: 'E2E Arret B',
        latitude: 0.01,
        longitude: 0.0,
        operatorCode: 'E2E',
      },
    });
    const c = await prisma.stop.create({
      data: {
        name: 'E2E Arret C',
        latitude: 0.02,
        longitude: 0.0,
        operatorCode: 'E2E',
      },
    });
    stopIds.push(a.id, b.id, c.id);

    // --- Les LIGNES (étape 4C-4-1) : le mode et l'exploitant vivent ici,
    // plus sur la liaison. Une liaison ne peut pas exister sans sa ligne.
    const ligneMarche = await prisma.transitLine.create({
      data: { name: 'À pied E2E', mode: 'WALK', operator: 'E2E' },
    });
    const ligneBus12 = await prisma.transitLine.create({
      data: { name: 'Bus 12 E2E', mode: 'BUS', operator: 'E2E' },
    });
    const ligneBus99 = await prisma.transitLine.create({
      data: { name: 'Bus 99 E2E', mode: 'BUS', operator: 'E2E' },
    });
    // Ligne CONCURRENTE de la 99 : même mode, mêmes arrêts (A → C), et
    // volontairement le MÊME nom d'affichage. Elle est plus lente ET plus
    // longue, donc elle ne gagne jamais — elle ne change donc rien aux
    // itinéraires attendus. Elle sert uniquement à prouver, à l'étape
    // 4E-3A, que `lineId` désigne bien la liaison RETENUE, là où `lineName`
    // serait incapable de les distinguer.
    const ligneBus99Bis = await prisma.transitLine.create({
      data: { name: 'Bus 99 E2E', mode: 'BUS', operator: 'E2E' },
    });
    lineIds.push(
      ligneMarche.id,
      ligneBus12.id,
      ligneBus99.id,
      ligneBus99Bis.id,
    );

    // --- Le RÉSEAU PUBLIC : c'est lui, et lui seul, qui doit alimenter la
    // recherche depuis l'étape 4C-3.
    await prisma.networkLink.createMany({
      data: [
        // A → B : 10 min, 600 m
        {
          lineId: ligneMarche.id,
          fromStopId: a.id,
          toStopId: b.id,
          distanceM: 600,
          durationMin: 10,
        },
        // B → C : 10 min, 3200 m   => A→B→C = 20 min / 3800 m
        {
          lineId: ligneBus12.id,
          fromStopId: b.id,
          toStopId: c.id,
          distanceM: 3200,
          durationMin: 10,
        },
        // A → C direct : 30 min, 3000 m  => plus long en temps, plus court
        {
          lineId: ligneBus99.id,
          fromStopId: a.id,
          toStopId: c.id,
          distanceM: 3000,
          durationMin: 30,
        },
        // A → C par la ligne concurrente : perdante sur les DEUX critères,
        // donc jamais retenue. Elle ne modifie aucun résultat attendu.
        {
          lineId: ligneBus99Bis.id,
          fromStopId: a.id,
          toStopId: c.id,
          distanceM: 5000,
          durationMin: 40,
        },
      ],
    });

    ligneMarcheId = ligneMarche.id;
    ligneBus12Id = ligneBus12.id;
    ligneBus99Id = ligneBus99.id;
    ligneBus99BisId = ligneBus99Bis.id;

    // --- Des données PERSONNELLES, créées exprès comme piège.
    // Un usager enregistre un trajet A→C ultra-rapide (1 min, 100 m).
    // S'il influençait la recherche publique, il deviendrait à la fois le
    // plus rapide ET le plus court, et TOUS les tests ci-dessous
    // échoueraient. Ils constituent donc eux-mêmes une preuve d'isolation.
    const user = await prisma.user.create({
      data: {
        email: `e2e-search-${Date.now()}@example.com`,
        passwordHash: 'hash-factice-non-utilise',
      },
    });
    userId = user.id;

    const route = await prisma.route.create({
      data: {
        userId,
        originLat: 0,
        originLng: 0,
        destinationLat: 0.02,
        destinationLng: 0,
        totalDurationMin: 1,
        totalDistanceM: 100,
        ecoScore: 0,
        carbonEstimate: 0,
      },
    });
    routeId = route.id;

    await prisma.segment.create({
      data: {
        routeId,
        fromStopId: a.id,
        toStopId: c.id,
        mode: 'BIKE',
        operator: 'PRIVE',
        line: 'raccourci personnel',
        gtfsTripId: 'prive-ac',
        distanceM: 100,
        departureTime: new Date('2026-08-15T08:00:00.000Z'),
        arrivalTime: new Date('2026-08-15T08:01:00.000Z'),
      },
    });
  });

  afterAll(async () => {
    // Nettoyage, dans l'ordre imposé par les clés étrangères. On ne
    // supprime que nos propres données, jamais celles du développement.
    if (routeId) {
      await prisma.segment.deleteMany({ where: { routeId } });
      await prisma.route.delete({ where: { id: routeId } });
    }
    if (userId) {
      await prisma.user.delete({ where: { id: userId } });
    }
    if (stopIds.length > 0) {
      // Les liaisons réseau sont supprimées en cascade avec leurs arrêts,
      // mais on les efface explicitement : c'est plus lisible et cela ne
      // dépend pas du comportement de la base.
      await prisma.networkLink.deleteMany({
        where: { fromStopId: { in: stopIds } },
      });
      await prisma.stop.deleteMany({ where: { id: { in: stopIds } } });
    }
    if (lineIds.length > 0) {
      // Après les liaisons : une ligne ne peut pas être supprimée tant
      // qu'un tronçon la référence.
      await prisma.transitLine.deleteMany({ where: { id: { in: lineIds } } });
    }
    await app.close();
  });

  it('est accessible SANS authentification et renvoie 200', () => {
    return request(app.getHttpServer())
      .post('/api/routes/search')
      .send({ fromLat: 0, fromLon: 0, toLat: 0.02, toLon: 0 })
      .expect(200);
  });

  /**
   * Minutes et mètres de la MARCHE d'approche et de sortie.
   *
   * ⚠️ ILS ENTRENT DANS LES TOTAUX. Les points demandés par ces tests ne sont
   * pas exactement sur les arrêts : il faut les rejoindre à pied, et cette
   * marche est désormais annoncée ET comptée. Un total « exactement 3 800 m »
   * signalerait qu'elle a de nouveau disparu.
   */
  const marches = (itineraire: {
    walkAccess?: { distanceM: number; durationMin: number } | null;
    walkEgress?: { distanceM: number; durationMin: number } | null;
  }) => {
    const legs = [itineraire.walkAccess, itineraire.walkEgress].filter(
      (leg): leg is { distanceM: number; durationMin: number } =>
        leg !== null && leg !== undefined,
    );

    return {
      distanceM: legs.reduce((somme, leg) => somme + leg.distanceM, 0),
      durationMin: legs.reduce((somme, leg) => somme + leg.durationMin, 0),
    };
  };

  it('renvoie deux itinéraires : le plus rapide et le moins émetteur', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/routes/search')
      .send({ fromLat: 0, fromLon: 0, toLat: 0.02, toLon: 0 })
      .expect(200);

    const itineraires = response.body as {
      criterion: string;
      totalDistanceM: number;
      totalDurationMin: number;
      numberOfTransfers: number;
      walkAccess: { distanceM: number; durationMin: number } | null;
      walkEgress: { distanceM: number; durationMin: number } | null;
      segments: { fromStopName: string; toStopName: string }[];
    }[];

    expect(itineraires).toHaveLength(2);

    const rapide = itineraires.find((i) => i.criterion === 'FASTEST');
    const propre = itineraires.find((i) => i.criterion === 'LOWEST_CO2');

    // Le plus rapide passe par B (20 min) plutôt que le direct (30 min).
    expect(rapide!.totalDurationMin).toBe(20 + marches(rapide!).durationMin);
    expect(rapide!.totalDistanceM).toBe(3800 + marches(rapide!).distanceM);
    expect(rapide?.segments).toHaveLength(2);

    // Le moins émetteur est le trajet DIRECT, et le calcul est vérifiable à
    // la main avec les facteurs du dossier (BUS = 113 g/km, WALK = 0) :
    //
    //   A→B→C : 600 m à pied (0 g) + 3 200 m de bus  = 361,6 g
    //   A→C   :                      3 000 m de bus  = 339,0 g
    //
    // Il est plus lent de 10 minutes et émet 22,6 g de moins : c'est
    // exactement le compromis que ce critère doit rendre visible.
    expect(propre!.totalDistanceM).toBe(3000 + marches(propre!).distanceM);
    expect(propre!.totalDurationMin).toBe(30 + marches(propre!).durationMin);
    expect(propre?.segments).toHaveLength(1);

    // ⚠️ AUCUN itinéraire FEWEST_TRANSFERS : le plus rapide n'en comporte
    // déjà aucun (la marche n'est pas une correspondance), donc les deux
    // critères désignent le même trajet, rendu une seule fois.
    expect(rapide?.numberOfTransfers).toBe(0);
    expect(
      itineraires.filter((i) => i.criterion === 'FEWEST_TRANSFERS'),
    ).toHaveLength(0);
  });

  it('renvoie le nom des arrêts dans chaque segment', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/routes/search')
      .send({ fromLat: 0, fromLon: 0, toLat: 0.02, toLon: 0 })
      .expect(200);

    const rapide = (
      response.body as {
        criterion: string;
        segments: { fromStopName: string }[];
      }[]
    ).find((i) => i.criterion === 'FASTEST');

    expect(rapide?.segments[0].fromStopName).toBe('E2E Arret A');
  });

  // ---------------------------------------------------------------------------
  // Étape 4E-2 : nom de ligne et exploitant
  // ---------------------------------------------------------------------------

  it('renvoie le nom de ligne et l’exploitant EXACTS de chaque segment', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/routes/search')
      .send({ fromLat: 0, fromLon: 0, toLat: 0.02, toLon: 0 })
      .expect(200);

    const itineraires = response.body as {
      criterion: string;
      segments: { mode: string; lineName: string; operator: string }[];
    }[];

    const rapide = itineraires.find((i) => i.criterion === 'FASTEST');
    const propre = itineraires.find((i) => i.criterion === 'LOWEST_CO2');

    // Le trajet rapide emprunte DEUX lignes différentes : la marche puis le
    // bus 12. Vérifier les valeurs, et pas seulement leur présence, est ce
    // qui prouve que chaque segment reçoit SA ligne — une interversion ou
    // une valeur recopiée échouerait ici.
    expect(
      rapide?.segments.map((s) => ({
        mode: s.mode,
        lineName: s.lineName,
        operator: s.operator,
      })),
    ).toEqual([
      { mode: 'WALK', lineName: 'À pied E2E', operator: 'E2E' },
      { mode: 'BUS', lineName: 'Bus 12 E2E', operator: 'E2E' },
    ]);

    // Le trajet direct emprunte une TROISIÈME ligne, distincte des deux
    // précédentes bien qu'elle soit du même mode.
    expect(propre?.segments[0].lineName).toBe('Bus 99 E2E');
    expect(propre?.segments[0].mode).toBe('BUS');
  });

  it('renvoie ces champs AUSSI pour un segment à pied', async () => {
    // Vérifie l'absence de cas particulier pour WALK : la marche est une
    // ligne du réseau comme une autre.
    const response = await request(app.getHttpServer())
      .post('/api/routes/search')
      .send({ fromLat: 0, fromLon: 0, toLat: 0.02, toLon: 0 })
      .expect(200);

    const marche = (
      response.body as {
        criterion: string;
        segments: { mode: string; lineName: string; operator: string }[];
      }[]
    )
      .flatMap((i) => i.segments)
      .find((s) => s.mode === 'WALK');

    expect(marche).toBeDefined();
    expect(marche?.lineName).toBe('À pied E2E');
    expect(marche?.operator).toBe('E2E');
  });

  it('conserve la forme exacte du segment, sans champ en trop ni en moins', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/routes/search')
      .send({ fromLat: 0, fromLon: 0, toLat: 0.02, toLon: 0 })
      .expect(200);

    const propre = (
      response.body as { criterion: string; segments: object[] }[]
    ).find((i) => i.criterion === 'LOWEST_CO2');

    // Non-régression : 4E-2, 4E-3A puis la Phase 4 n'ont fait qu'AJOUTER des
    // clés. Aucune n'a jamais été retirée ni renommée.
    expect(Object.keys(propre!.segments[0]).sort()).toEqual([
      'distanceM',
      'durationMin',
      'fromStopId',
      'fromStopLat',
      'fromStopLon',
      'fromStopName',
      'geometry',
      'geometrySource',
      'gtfsLineId',
      'lineId',
      'lineName',
      'mode',
      'operator',
      'toStopId',
      'toStopLat',
      'toStopLon',
      'toStopName',
    ]);
  });

  // ---------------------------------------------------------------------------
  // Étape 4E-3A : identifiant de la liaison choisie
  // ---------------------------------------------------------------------------

  it('renvoie le lineId EXACT de chaque segment', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/routes/search')
      .send({ fromLat: 0, fromLon: 0, toLat: 0.02, toLon: 0 })
      .expect(200);

    const itineraires = response.body as {
      criterion: string;
      segments: { lineId: string }[];
    }[];

    const rapide = itineraires.find((i) => i.criterion === 'FASTEST');
    const propre = itineraires.find((i) => i.criterion === 'LOWEST_CO2');

    expect(rapide?.segments.map((s) => s.lineId)).toEqual([
      ligneMarcheId,
      ligneBus12Id,
    ]);
    expect(propre?.segments[0].lineId).toBe(ligneBus99Id);
  });

  it('distingue deux lignes concurrentes de MÊME nom par leur lineId', async () => {
    // Deux liaisons relient A à C, du même mode et du même nom d'affichage
    // (« Bus 99 E2E »). Seul l'identifiant dit laquelle a été retenue —
    // c'est précisément ce que `lineName` ne peut pas faire.
    const response = await request(app.getHttpServer())
      .post('/api/routes/search')
      .send({ fromLat: 0, fromLon: 0, toLat: 0.02, toLon: 0 })
      .expect(200);

    const propre = (
      response.body as {
        criterion: string;
        segments: { lineId: string; lineName: string; distanceM: number }[];
      }[]
    ).find((i) => i.criterion === 'LOWEST_CO2');

    // La liaison retenue est la moins émettrice (3 000 m à 113 g/km, contre
    // 5 000 m pour la concurrente), pas l'autre.
    expect(propre?.segments[0].lineId).toBe(ligneBus99Id);
    expect(propre?.segments[0].lineId).not.toBe(ligneBus99BisId);
    expect(propre?.segments[0].distanceM).toBe(3000);
    // Le nom, lui, aurait été identique dans les deux cas.
    expect(propre?.segments[0].lineName).toBe('Bus 99 E2E');
  });

  it('ne divulgue aucune donnée personnelle (routeId, userId, horaires)', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/routes/search')
      .send({ fromLat: 0, fromLon: 0, toLat: 0.02, toLon: 0 });

    const json = JSON.stringify(response.body);
    expect(json).not.toContain('routeId');
    expect(json).not.toContain('userId');
    expect(json).not.toContain('departureTime');
  });

  it('renvoie 400 si une coordonnée est hors intervalle', () => {
    return request(app.getHttpServer())
      .post('/api/routes/search')
      .send({ fromLat: 95, fromLon: 0, toLat: 0.02, toLon: 500 })
      .expect(400);
  });

  it('renvoie 400 si une coordonnée est manquante', () => {
    return request(app.getHttpServer())
      .post('/api/routes/search')
      .send({ fromLat: 0, fromLon: 0 })
      .expect(400);
  });

  it('renvoie 400 si un champ inconnu est envoyé', () => {
    return request(app.getHttpServer())
      .post('/api/routes/search')
      .send({
        fromLat: 0,
        fromLon: 0,
        toLat: 0.02,
        toLon: 0,
        userId: 'tentative-injection',
      })
      .expect(400);
  });

  it('propose la MARCHE quand le réseau n’offre aucun trajet', async () => {
    // On cherche dans le sens inverse : aucun segment ne remonte de C vers A.
    const response = await request(app.getHttpServer())
      .post('/api/routes/search')
      .send({ fromLat: 0.02, fromLon: 0, toLat: 0, toLon: 0 })
      .expect(200);

    // ⚠️ « Le réseau n'y va pas » n'est pas « on ne peut pas y aller ».
    const itineraires = response.body as {
      segments: unknown[];
      walkAccess: { source: string } | null;
    }[];

    expect(itineraires).toHaveLength(1);
    expect(itineraires[0].segments).toEqual([]);
    expect(itineraires[0].walkAccess?.source).toBe('ESTIMATE');
  });

  // ---------------------------------------------------------------------------
  // Étape 4C-2 : bornes, typage strict, rayon de recherche, déterminisme
  // ---------------------------------------------------------------------------

  it('accepte les coordonnées aux bornes exactes (±90 / ±180)', () => {
    // Ces valeurs sont valides : elles doivent passer la validation.
    // Aucun arrêt ne s'y trouve — la réponse est donc une marche (d'un pôle à
    // l'autre, ce qui est absurde mais mathématiquement honnête), et surtout
    // PAS une erreur 400. C'est la validation qu'on éprouve ici.
    return request(app.getHttpServer())
      .post('/api/routes/search')
      .send({ fromLat: 90, fromLon: 180, toLat: -90, toLon: -180 })
      .expect(200)
      .expect((response) => {
        const itineraires = response.body as { segments: unknown[] }[];
        expect(itineraires.every((i) => i.segments.length === 0)).toBe(true);
      });
  });

  it('refuse une coordonnée envoyée en chaîne de caractères', () => {
    // Le contrat déclare des nombres : "0" doit être refusé (@IsNumber).
    return request(app.getHttpServer())
      .post('/api/routes/search')
      .send({ fromLat: '0', fromLon: 0, toLat: 0.02, toLon: 0 })
      .expect(400);
  });

  it('propose la MARCHE quand le point demandé est trop éloigné du réseau', async () => {
    // Les arrêts du test sont autour de (0,0). Ce point en est distant de
    // plusieurs centaines de kilomètres : au-delà du rayon de 2 km, on
    // considère qu'aucun arrêt ne le dessert.
    const response = await request(app.getHttpServer())
      .post('/api/routes/search')
      .send({ fromLat: 10, fromLon: 10, toLat: 0.02, toLon: 0 })
      .expect(200);

    const itineraires = response.body as { segments: unknown[] }[];
    expect(itineraires).toHaveLength(1);
    expect(itineraires[0].segments).toEqual([]);
  });

  it('renvoie exactement le même résultat pour deux appels identiques', async () => {
    const critere = { fromLat: 0, fromLon: 0, toLat: 0.02, toLon: 0 };

    const premier = await request(app.getHttpServer())
      .post('/api/routes/search')
      .send(critere)
      .expect(200);

    const second = await request(app.getHttpServer())
      .post('/api/routes/search')
      .send(critere)
      .expect(200);

    expect(second.body).toEqual(premier.body);
  });

  it('N’HORODATE AUCUN SEGMENT quand l’itinéraire entier n’est pas horodatable', async () => {
    // ⚠️ TEST ÉCRIT APRÈS UN DÉFAUT RÉEL. La première version posait les
    // heures au fil de la boucle : un abandon en cours de route laissait les
    // premiers segments horodatés et les suivants nus, sur un itinéraire
    // pourtant marqué `SCHEDULE_UNKNOWN`.
    //
    // Des heures précises sur un trajet dont on annonce ignorer l'horaire :
    // c'est la pire des réponses, et c'est aussi ce qui rendait deux appels
    // identiques non reproductibles, ces heures suivant l'horloge murale.
    //
    // Les lignes de ce test n'ont aucun passage en base : le statut ne peut
    // donc pas être `SCHEDULE_AVAILABLE`.
    const response = await request(app.getHttpServer())
      .post('/api/routes/search')
      .send({ fromLat: 0, fromLon: 0, toLat: 0.02, toLon: 0 })
      .expect(200);

    const itineraires = response.body as {
      schedule: { status: string; arrivalAt: string | null };
      segments: {
        departureAt?: string;
        arrivalAt?: string;
        waitMin?: number;
      }[];
    }[];

    expect(itineraires.length).toBeGreaterThan(0);

    for (const itineraire of itineraires) {
      expect(itineraire.schedule.status).not.toBe('SCHEDULE_AVAILABLE');
      expect(itineraire.schedule.arrivalAt).toBeNull();

      for (const segment of itineraire.segments) {
        expect(segment.departureAt).toBeUndefined();
        expect(segment.arrivalAt).toBeUndefined();
        // ⚠️ `undefined`, JAMAIS 0. Zéro annoncerait « aucune attente », ce
        // qui est une affirmation ; on n'en a aucune à faire.
        expect(segment.waitMin).toBeUndefined();
      }
    }
  });

  it('renvoie des segments chaînés de l’origine vers la destination', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/routes/search')
      .send({ fromLat: 0, fromLon: 0, toLat: 0.02, toLon: 0 })
      .expect(200);

    const rapide = (
      response.body as {
        criterion: string;
        segments: { fromStopId: string; toStopId: string }[];
      }[]
    ).find((i) => i.criterion === 'FASTEST');

    const segments = rapide?.segments ?? [];
    expect(segments.length).toBeGreaterThan(1);

    // Chaque segment repart exactement là où le précédent s'arrête.
    for (let i = 0; i < segments.length - 1; i++) {
      expect(segments[i].toStopId).toBe(segments[i + 1].fromStopId);
    }
  });

  // ---------------------------------------------------------------------------
  // Étape 4C-3 : isolation entre réseau public et données personnelles
  // ---------------------------------------------------------------------------

  it("ignore le trajet personnel d'un usager, pourtant bien plus rapide", async () => {
    // Rappel du piège posé dans beforeAll : un usager a enregistré un
    // segment A→C de 1 minute / 100 m. S'il alimentait le graphe public,
    // il serait forcément choisi comme le plus rapide ET le plus court.
    const response = await request(app.getHttpServer())
      .post('/api/routes/search')
      .send({ fromLat: 0, fromLon: 0, toLat: 0.02, toLon: 0 })
      .expect(200);

    const itineraires = response.body as {
      criterion: string;
      totalDurationMin: number;
      totalDistanceM: number;
      segments: { mode: string }[];
    }[];

    for (const itineraire of itineraires) {
      // Aucun itinéraire ne peut être aussi rapide/court que le raccourci.
      expect(itineraire.totalDurationMin).toBeGreaterThan(1);
      expect(itineraire.totalDistanceM).toBeGreaterThan(100);
      // Le mode BIKE n'existe que dans le trajet personnel.
      for (const segment of itineraire.segments) {
        expect(segment.mode).not.toBe('BIKE');
      }
    }
  });

  it('ne divulgue pas les libellés du trajet personnel', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/routes/search')
      .send({ fromLat: 0, fromLon: 0, toLat: 0.02, toLon: 0 })
      .expect(200);

    const json = JSON.stringify(response.body);
    expect(json).not.toContain('raccourci personnel');
    expect(json).not.toContain('PRIVE');
    expect(json).not.toContain('prive-ac');
  });

  it('utilise bien les valeurs du réseau public', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/routes/search')
      .send({ fromLat: 0, fromLon: 0, toLat: 0.02, toLon: 0 })
      .expect(200);

    const rapide = (
      response.body as {
        criterion: string;
        totalDurationMin: number;
        totalDistanceM: number;
        walkAccess: { distanceM: number; durationMin: number } | null;
        walkEgress: { distanceM: number; durationMin: number } | null;
        segments: { mode: string }[];
      }[]
    ).find((i) => i.criterion === 'FASTEST');

    // 20 min / 3800 m sont exactement les valeurs des liaisons réseau
    // A→B (10 min, 600 m) + B→C (10 min, 3200 m), auxquelles s'ajoute la
    // marche des deux bouts. Elles ne peuvent pas provenir du trajet
    // personnel, qui vaut 1 min / 100 m.
    expect(rapide!.totalDurationMin).toBe(20 + marches(rapide!).durationMin);
    expect(rapide!.totalDistanceM).toBe(3800 + marches(rapide!).distanceM);
    // Les modes proviennent bien du réseau (WALK puis BUS), pas du BIKE
    // du raccourci personnel.
    expect(rapide?.segments.map((s) => s.mode)).toEqual(['WALK', 'BUS']);
  });
});
