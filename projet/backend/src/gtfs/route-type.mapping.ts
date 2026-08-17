import { ModeTransport } from '@prisma/client';

// =============================================================================
// Correspondance route_type (GTFS) → ModeTransport (UrbanFlow) — étape 4C-4-3
// =============================================================================
// GTFS décrit le mode d'une ligne par un entier, `route_type` :
//
//    0  tramway              → TRAM
//    1  métro                → METRO
//    2  train                → AUCUN ÉQUIVALENT
//    3  bus                  → BUS
//    4  ferry                → AUCUN ÉQUIVALENT
//    5  tramway à câble      → AUCUN ÉQUIVALENT
//    6  télécabine           → AUCUN ÉQUIVALENT
//    7  funiculaire          → AUCUN ÉQUIVALENT
//   11  trolleybus           → AUCUN ÉQUIVALENT (voir ci-dessous)
//   12  monorail             → AUCUN ÉQUIVALENT
//
// Notre enum ModeTransport contient WALK, BUS, TRAM, METRO, BIKE, ESCOOTER,
// CAR : il a été conçu pour la mobilité urbaine décrite par le dossier, pas
// pour couvrir l'intégralité du référentiel GTFS.
//
// CHOIX VOLONTAIREMENT CONSERVATEUR : on ne traduit que les trois types dont
// l'équivalent est INDISCUTABLE. Le trolleybus (11) est bien un autobus dans
// l'usage courant, mais le traduire en BUS relèverait de l'interprétation :
// on préfère le signaler que le deviner. Une ligne non traduite n'est jamais
// importée en silence — elle est comptée et journalisée avec son type exact,
// ce qui permettra de décider en connaissance de cause s'il faut un jour
// étendre l'enum (ce qui exigerait une migration).
// =============================================================================

const CORRESPONDANCES: Record<number, ModeTransport> = {
  0: ModeTransport.TRAM,
  1: ModeTransport.METRO,
  3: ModeTransport.BUS,
};

/**
 * Traduit un route_type GTFS en mode de transport UrbanFlow.
 * Renvoie null si le type n'a pas d'équivalent : à l'appelant de le
 * comptabiliser plutôt que de l'ignorer.
 */
export function mapRouteType(routeType: number): ModeTransport | null {
  return CORRESPONDANCES[routeType] ?? null;
}

/// Libellé lisible d'un route_type, pour le bilan d'import.
/// Rend le journal compréhensible : "type 2 (train)" plutôt que "type 2".
const LIBELLES: Record<number, string> = {
  0: 'tramway',
  1: 'métro',
  2: 'train',
  3: 'bus',
  4: 'ferry',
  5: 'tramway à câble',
  6: 'télécabine',
  7: 'funiculaire',
  11: 'trolleybus',
  12: 'monorail',
};

export function describeRouteType(routeType: number): string {
  const libelle = LIBELLES[routeType];
  return libelle ? `${routeType} (${libelle})` : `${routeType} (inconnu)`;
}
