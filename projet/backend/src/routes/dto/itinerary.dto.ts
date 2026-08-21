import { ModeTransport } from '@prisma/client';

// Formes des données RENVOYÉES par POST /api/routes/search.
// Ce sont de simples interfaces de sortie (pas de class-validator : on ne
// valide que ce qui ENTRE dans l'application, pas ce qui en sort).

// Une portion du trajet proposé, entre deux arrêts.
export interface ItinerarySegmentDto {
  fromStopId: string;
  fromStopName: string;
  toStopId: string;
  toStopName: string;
  mode: ModeTransport;

  // Nom et exploitant de la ligne empruntée (étape 4E-2), par exemple
  // "38" / "RATP". Sans eux, l'API disait "prenez un BUS" sans dire LEQUEL.
  //
  // OBLIGATOIRES, et non optionnels : un NetworkLink porte toujours une
  // ligne (relation requise), et TransitLine.name comme TransitLine.operator
  // sont non-nullables. Le modèle garantit ces valeurs, le contrat public
  // doit donc les garantir aussi.
  //
  // Ils seront recopiés tels quels dans Segment.line et Segment.operator au
  // moment d'enregistrer un trajet (étape 4E-3).
  lineName: string;
  operator: string;

  distanceM: number;
  durationMin: number;
}

// Critère selon lequel l'itinéraire a été optimisé.
export type ItineraryCriterion = 'FASTEST' | 'SHORTEST';

export interface ItineraryDto {
  // Permet au client de savoir lequel est le plus rapide et lequel est le
  // plus court, sans avoir à comparer les totaux lui-même.
  criterion: ItineraryCriterion;
  totalDistanceM: number;
  totalDurationMin: number;
  segments: ItinerarySegmentDto[];
}
