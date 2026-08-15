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
