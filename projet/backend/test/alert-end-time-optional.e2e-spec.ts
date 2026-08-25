// Charge projet/backend/.env (DATABASE_URL).
import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaModule } from './../src/prisma/prisma.module';
import { PrismaService } from './../src/prisma/prisma.service';

// Test de MODÈLE (étape 4F-1A) : il vérifie la migration elle-même, sur la
// vraie base, et non le comportement d'un endpoint.
//
// Même raisonnement qu'à l'étape 4E-1 pour `Segment.gtfsTripId` : avec un
// PrismaService simulé, « insérer une alerte sans date de fin » réussirait
// toujours — le mock accepte n'importe quoi. Un tel test passerait AVANT
// comme APRÈS la migration, donc ne prouverait rien. Seule la base répond.
//
// Aucun module applicatif n'est démarré : ce test n'a besoin que de Prisma.
describe('Alert.endTime optionnel (e2e)', () => {
  let prisma: PrismaService;

  /// Préfixe commun à toutes nos alertes : le nettoyage n'effacera que
  /// celles-ci, jamais des données de développement.
  const PREFIXE = '4F1A-';
  const alertIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [PrismaModule],
    }).compile();

    prisma = moduleFixture.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.alert.deleteMany({ where: { id: { in: alertIds } } });
  });

  /** Alerte type : tous les champs obligatoires, sans la date de fin. */
  const alerteDeBase = (gtfsAlertId: string) => ({
    gtfsAlertId,
    stopIds: ['stop-a', 'stop-b'],
    lineIds: ['ligne-38'],
    affectedMode: 'BUS' as const,
    severity: 'WARNING' as const,
    cause: 'CONSTRUCTION',
    effect: 'DETOUR',
    startTime: new Date('2026-09-01T06:00:00.000Z'),
  });

  const creer = async (
    gtfsAlertId: string,
    endTime?: Date | null,
  ): Promise<{ id: string; endTime: Date | null }> => {
    const alerte = await prisma.alert.create({
      data: {
        ...alerteDeBase(gtfsAlertId),
        ...(endTime === undefined ? {} : { endTime }),
      },
    });
    alertIds.push(alerte.id);
    return alerte;
  };

  // ===========================================================================
  // La colonne elle-même
  // ===========================================================================
  it('la colonne endTime est déclarée NULLABLE en base', async () => {
    // Interrogation directe du catalogue PostgreSQL : la preuve la plus
    // directe que la migration a été appliquée, sans passer par
    // l'interprétation de Prisma.
    const colonnes = await prisma.$queryRaw<{ is_nullable: string }[]>`
      SELECT is_nullable
      FROM information_schema.columns
      WHERE table_name = 'alerts' AND column_name = 'endTime'
    `;

    expect(colonnes).toHaveLength(1);
    expect(colonnes[0].is_nullable).toBe('YES');
  });

  // ===========================================================================
  // Les deux formes d'alerte
  // ===========================================================================
  it('accepte une alerte AVEC date de fin, et la conserve intacte', async () => {
    // Le cas d'une perturbation dont l'opérateur annonce la fin :
    // GTFS-RT fournit alors `active_period { start, end }`.
    const fin = new Date('2026-09-15T20:00:00.000Z');

    const alerte = await creer(`${PREFIXE}avec-fin`, fin);

    expect(alerte.endTime).toEqual(fin);

    // Relue depuis PostgreSQL, la valeur doit être exactement la même :
    // c'est ce qui prouve qu'assouplir la contrainte n'altère en rien les
    // alertes qui ont bel et bien une fin.
    const relue = await prisma.alert.findUniqueOrThrow({
      where: { id: alerte.id },
    });
    expect(relue.endTime?.toISOString()).toBe(fin.toISOString());
    expect(relue.startTime.toISOString()).toBe('2026-09-01T06:00:00.000Z');
  });

  it('accepte une alerte avec endTime explicitement null', async () => {
    const alerte = await creer(`${PREFIXE}fin-nulle`, null);

    expect(alerte.endTime).toBeNull();
  });

  it('accepte une alerte où le champ est totalement ABSENT', async () => {
    // C'est la forme qu'aura l'import de 4F-1C : quand `active_period`
    // n'a pas d'`end`, on ne mentionnera simplement pas le champ — on
    // n'écrira pas `endTime: null` et surtout pas une date inventée.
    const alerte = await creer(`${PREFIXE}sans-champ`);

    expect(alerte.endTime).toBeNull();
  });

  // ===========================================================================
  // Périmètre : rien d'autre n'a été assoupli
  // ===========================================================================
  it('aucune colonne n’est devenue nullable par accident', async () => {
    // Garde-fou de périmètre. Il s'appelait « endTime est la SEULE colonne
    // rendue nullable » jusqu'à l'étape 4F-2A, qui a délibérément ajouté
    // `headerText` et `descriptionText` — nullables l'un et l'autre, faute
    // de quoi une alerte sans texte publié serait impossible à enregistrer.
    //
    // Le rôle du test n'a pas changé : il liste EXHAUSTIVEMENT les colonnes
    // nullables, si bien qu'aucune ne peut apparaître sans une décision
    // écrite ici. Si `cause`, `effect` ou `startTime` s'assouplissaient au
    // passage d'une migration, ce test le dirait.
    const colonnes = await prisma.$queryRaw<
      { column_name: string; is_nullable: string }[]
    >`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'alerts'
      ORDER BY ordinal_position
    `;

    const nullables = colonnes
      .filter((c) => c.is_nullable === 'YES')
      .map((c) => c.column_name)
      .sort();

    // stopIds et lineIds sont des tableaux : PostgreSQL les déclare
    // nullables depuis la migration initiale, ce n'est pas notre fait.
    expect(nullables).toEqual([
      'descriptionText', // 4F-2A — aucun texte publié
      'endTime', // 4F-1A — aucune fin annoncée
      'headerText', // 4F-2A — aucun texte publié
      'lineIds',
      'stopIds',
    ]);
  });

  it('les autres champs restent OBLIGATOIRES en base', async () => {
    // Insertion volontairement incomplète, en SQL direct pour contourner le
    // typage Prisma : PostgreSQL doit la refuser lui-même.
    await expect(
      prisma.$executeRawUnsafe(`
        INSERT INTO alerts ("id", "stopIds", "lineIds", "affectedMode",
                            "severity", "effect", "startTime", "gtfsAlertId")
        VALUES (gen_random_uuid(), '{}', '{}', 'BUS', 'INFO', 'DETOUR',
                NOW(), '${PREFIXE}sans-cause')
      `),
    ).rejects.toThrow();
  });

  it('gtfsAlertId reste UNIQUE', async () => {
    await creer(`${PREFIXE}doublon`);

    // La clé qui rendra l'import idempotent en 4F-1C : deux alertes ne
    // peuvent pas partager le même identifiant GTFS.
    await expect(creer(`${PREFIXE}doublon`, null)).rejects.toThrow();
  });
});
