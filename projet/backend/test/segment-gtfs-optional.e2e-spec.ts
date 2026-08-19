// Charge projet/backend/.env (DATABASE_URL).
import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaModule } from './../src/prisma/prisma.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { ModeTransport } from '@prisma/client';

// Test de MODÈLE (étape 4E-1) : il vérifie la migration elle-même, sur la
// vraie base, et non le comportement d'un endpoint.
//
// Pourquoi pas un test unitaire ? Parce qu'avec un PrismaService simulé,
// « insérer un segment sans gtfsTripId » réussirait toujours — le mock
// accepte n'importe quoi. Un tel test passerait AVANT comme APRÈS la
// migration, donc ne prouverait rien. Seule la base peut répondre.
//
// Aucun module applicatif n'est démarré : ce test n'a besoin que de Prisma.
describe('Segment.gtfsTripId optionnel (e2e)', () => {
  let prisma: PrismaService;

  // Identifiants des données créées ici, pour ne supprimer QUE celles-ci.
  const segmentIds: string[] = [];
  let routeId: string;
  let fromStopId: string;
  let toStopId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [PrismaModule],
    }).compile();

    prisma = moduleFixture.get(PrismaService);

    // Coordonnées volontairement placées au large de l'Alaska : plusieurs
    // suites e2e tournent EN PARALLÈLE, et `findNearestStop` parcourt TOUS
    // les arrêts. Un arrêt trop proche de ceux d'une autre suite fausserait
    // sa recherche (leçon de l'étape 4C-4-4).
    const depart = await prisma.stop.create({
      data: {
        name: '4E1 Arret Depart',
        latitude: 60.0,
        longitude: -150.0,
        operatorCode: '4E1',
      },
    });
    const arrivee = await prisma.stop.create({
      data: {
        name: '4E1 Arret Arrivee',
        latitude: 60.01,
        longitude: -150.0,
        operatorCode: '4E1',
      },
    });
    fromStopId = depart.id;
    toStopId = arrivee.id;

    // userId reste NULL : Route.userId est nullable, et ce test ne porte pas
    // sur la propriété des données. Un usager en moins, c'est une source
    // d'interférence en moins avec les autres suites.
    const route = await prisma.route.create({
      data: {
        originLat: 60.0,
        originLng: -150.0,
        destinationLat: 60.01,
        destinationLng: -150.0,
        totalDurationMin: 5,
        totalDistanceM: 1100,
        ecoScore: 100,
        carbonEstimate: 0,
      },
    });
    routeId = route.id;
  });

  afterAll(async () => {
    // Ordre inverse de la création : les segments référencent la route et
    // les arrêts. (La cascade supprimerait les segments avec la route, mais
    // on ne s'appuie pas dessus : le nettoyage doit être explicite.)
    await prisma.segment.deleteMany({ where: { id: { in: segmentIds } } });
    await prisma.route.delete({ where: { id: routeId } });
    await prisma.stop.deleteMany({
      where: { id: { in: [fromStopId, toStopId] } },
    });
  });

  // Base commune aux trois segments créés ci-dessous.
  const segmentDeBase = () => ({
    mode: ModeTransport.WALK,
    operator: 'RATP',
    departureTime: new Date('2026-08-19T08:00:00.000Z'),
    arrivalTime: new Date('2026-08-19T08:05:00.000Z'),
    distanceM: 1100,
    line: 'À pied',
    routeId,
    fromStopId,
    toStopId,
  });

  it('la colonne est déclarée NULLABLE en base', async () => {
    // Interrogation directe du catalogue PostgreSQL : c'est la preuve la
    // plus directe que la migration a bien été appliquée, sans passer par
    // l'interprétation de Prisma.
    const colonnes = await prisma.$queryRaw<{ is_nullable: string }[]>`
      SELECT is_nullable
      FROM information_schema.columns
      WHERE table_name = 'segments' AND column_name = 'gtfsTripId'
    `;

    expect(colonnes).toHaveLength(1);
    expect(colonnes[0].is_nullable).toBe('YES');
  });

  it('accepte un segment AVEC gtfsTripId, et conserve la valeur', async () => {
    // Le cas d'un vrai passage GTFS : la donnée existe, on la garde.
    const segment = await prisma.segment.create({
      data: { ...segmentDeBase(), gtfsTripId: 'trip-reel-4E1' },
    });
    segmentIds.push(segment.id);

    expect(segment.gtfsTripId).toBe('trip-reel-4E1');
  });

  it('accepte un segment avec gtfsTripId explicitement null', async () => {
    // Le cas d'un itinéraire calculé sur NetworkLink : aucun passage précis
    // ne lui correspond, donc aucun trip_id à inscrire.
    const segment = await prisma.segment.create({
      data: { ...segmentDeBase(), gtfsTripId: null },
    });
    segmentIds.push(segment.id);

    expect(segment.gtfsTripId).toBeNull();
  });

  it('accepte un segment où le champ est totalement absent', async () => {
    // C'est la forme qu'aura la persistance de l'étape 4E-3 : on n'écrira
    // pas `gtfsTripId: null`, on ne mentionnera simplement pas le champ.
    const segment = await prisma.segment.create({
      data: segmentDeBase(),
    });
    segmentIds.push(segment.id);

    expect(segment.gtfsTripId).toBeNull();
  });

  it('les autres colonnes restent OBLIGATOIRES', async () => {
    // Garde-fou de périmètre : la migration ne devait assouplir QUE
    // gtfsTripId. Si `line` ou `operator` étaient devenus nullables au
    // passage, ce test le dirait.
    const colonnes = await prisma.$queryRaw<
      { column_name: string; is_nullable: string }[]
    >`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'segments'
      ORDER BY ordinal_position
    `;

    const nullables = colonnes
      .filter((c) => c.is_nullable === 'YES')
      .map((c) => c.column_name);

    expect(nullables).toEqual(['gtfsTripId']);
  });

  it('relit correctement les segments enregistrés', async () => {
    const segments = await prisma.segment.findMany({
      where: { routeId },
      orderBy: { gtfsTripId: 'asc' },
    });

    expect(segments).toHaveLength(3);
    // Un seul des trois porte un identifiant : les deux autres sont nuls.
    expect(segments.filter((s) => s.gtfsTripId !== null)).toHaveLength(1);
  });
});
