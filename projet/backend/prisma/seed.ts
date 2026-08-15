// =============================================================================
// Jeu de démonstration du réseau public (étape 4C-3)
// =============================================================================
// Ce script remplit les tables "stops" et "network_links" avec un petit
// réseau parisien fictif mais géographiquement cohérent, afin que la
// recherche d'itinéraire (POST /api/routes/search) ait de quoi travailler.
//
//   npm run db:seed
//
// Il est IDEMPOTENT : on peut le relancer autant de fois qu'on veut, il
// produit toujours exactement le même résultat. C'est pour cela que les
// identifiants des arrêts sont fixes (et non générés aléatoirement) :
// on peut ainsi utiliser "upsert", qui crée l'arrêt s'il n'existe pas et le
// met à jour sinon — sans jamais créer de doublon.
//
// ATTENTION : ce script ne touche QUE les données du réseau public. Il ne
// lit ni ne modifie aucune donnée personnelle (users, routes, segments).
//
// Le vrai réseau viendra de l'import GTFS à l'étape suivante ; ce jeu de
// démonstration sera alors remplacé.
// =============================================================================

import { ModeTransport, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// --- Les arrêts (les SOMMETS du graphe) --------------------------------------
// Coordonnées réelles, pour que le calcul du "plus proche arrêt" ait du sens.
const ARRETS = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Gare du Nord',
    latitude: 48.8809,
    longitude: 2.3553,
    pmrAccessible: true,
    operatorCode: 'RATP',
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    name: "Gare de l'Est",
    latitude: 48.8766,
    longitude: 2.359,
    pmrAccessible: true,
    operatorCode: 'RATP',
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    name: 'République',
    latitude: 48.8675,
    longitude: 2.3636,
    pmrAccessible: false,
    operatorCode: 'RATP',
  },
  {
    id: '00000000-0000-4000-8000-000000000004',
    name: 'Châtelet',
    latitude: 48.8583,
    longitude: 2.347,
    pmrAccessible: true,
    operatorCode: 'RATP',
  },
  {
    id: '00000000-0000-4000-8000-000000000005',
    name: 'Hôtel de Ville',
    latitude: 48.8574,
    longitude: 2.3522,
    pmrAccessible: false,
    operatorCode: 'RATP',
  },
  {
    id: '00000000-0000-4000-8000-000000000006',
    name: 'Bastille',
    latitude: 48.8532,
    longitude: 2.3693,
    pmrAccessible: true,
    operatorCode: 'RATP',
  },
];

// Raccourcis lisibles vers les identifiants ci-dessus.
const [NORD, EST, REPUBLIQUE, CHATELET, HOTEL_DE_VILLE, BASTILLE] = ARRETS.map(
  (arret) => arret.id,
);

// --- Les liaisons (les ARÊTES du graphe) -------------------------------------
//
// Une liaison est ORIENTÉE. Une ligne de transport circulant dans les deux
// sens produit donc DEUX liaisons : c'est le rôle du helper `ligne()`.
//
//        Gare du Nord
//         │        │
//     M4  │        │  Bus 38
//         │        │
//   Gare de l'Est  │
//         │   \    │
//     M4  │    \M5 │
//         │     \  │
//      Châtelet  République
//         │  \        │
//     M1  │   \marche │ M5
//         │    \      │
//  Hôtel de Ville \   │
//         │        \  │
//     M1  │         \ │
//         └────── Bastille
//
// Contraste pédagogique volontaire entre Châtelet et Bastille :
//   - en métro (via Hôtel de Ville) : 2200 m en 6 min  → le plus RAPIDE
//   - à pied (direct)               : 1730 m en 22 min → le plus COURT
// C'est exactement ce qui permet à FASTEST et SHORTEST de différer.
interface Liaison {
  from: string;
  to: string;
  mode: ModeTransport;
  lineName: string;
  durationMin: number;
  distanceM: number;
}

// Crée les deux sens d'une même liaison.
function ligne(
  a: string,
  b: string,
  mode: ModeTransport,
  lineName: string,
  durationMin: number,
  distanceM: number,
): Liaison[] {
  return [
    { from: a, to: b, mode, lineName, durationMin, distanceM },
    { from: b, to: a, mode, lineName, durationMin, distanceM },
  ];
}

const LIAISONS: Liaison[] = [
  // Métro 4 : Gare du Nord — Gare de l'Est — Châtelet
  ...ligne(NORD, EST, ModeTransport.METRO, 'Métro 4', 3, 550),
  ...ligne(EST, CHATELET, ModeTransport.METRO, 'Métro 4', 5, 2200),

  // Bus 38 : Gare du Nord — République — Châtelet (plus lent que le métro)
  ...ligne(NORD, REPUBLIQUE, ModeTransport.BUS, 'Bus 38', 7, 1610),
  ...ligne(REPUBLIQUE, CHATELET, ModeTransport.BUS, 'Bus 38', 9, 1590),

  // Métro 5 : Gare de l'Est — République — Bastille
  ...ligne(EST, REPUBLIQUE, ModeTransport.METRO, 'Métro 5', 4, 1200),
  ...ligne(REPUBLIQUE, BASTILLE, ModeTransport.METRO, 'Métro 5', 4, 1400),

  // Métro 1 : Châtelet — Hôtel de Ville — Bastille
  ...ligne(CHATELET, HOTEL_DE_VILLE, ModeTransport.METRO, 'Métro 1', 2, 700),
  ...ligne(HOTEL_DE_VILLE, BASTILLE, ModeTransport.METRO, 'Métro 1', 4, 1500),

  // Correspondance à pied : plus courte en distance, mais bien plus lente.
  ...ligne(CHATELET, BASTILLE, ModeTransport.WALK, 'À pied', 22, 1730),
];

async function main() {
  console.log('Seed du réseau public de démonstration…');

  // 1) Les arrêts : upsert, donc aucun doublon même en relançant le script.
  for (const arret of ARRETS) {
    await prisma.stop.upsert({
      where: { id: arret.id },
      update: arret,
      create: arret,
    });
  }
  console.log(`  ${ARRETS.length} arrêts`);

  // 2) Les liaisons : on efface puis on recrée.
  //    C'est sans risque : aucune autre table ne référence network_links,
  //    et les données personnelles (routes, segments) ne sont pas touchées.
  await prisma.networkLink.deleteMany();
  await prisma.networkLink.createMany({
    data: LIAISONS.map((liaison) => ({
      fromStopId: liaison.from,
      toStopId: liaison.to,
      mode: liaison.mode,
      lineName: liaison.lineName,
      operator: 'RATP',
      durationMin: liaison.durationMin,
      distanceM: liaison.distanceM,
    })),
  });
  console.log(`  ${LIAISONS.length} liaisons`);

  console.log('Terminé.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
