import { ModeTransport } from '@prisma/client';

// Formes des données RENVOYÉES par POST /api/carbone.
// Ce sont de simples interfaces de sortie (pas de class-validator : on ne
// valide que ce qui ENTRE dans l'application, pas ce qui en sort).

// Détail des émissions d'un segment. L'usager doit pouvoir voir quelle
// portion de son trajet émet quoi, et pas seulement un total.
export interface CarbonBreakdownItemDto {
  mode: ModeTransport;
  distanceM: number;
  co2Grams: number;
}

export interface CarbonResultDto {
  totalDistanceM: number;
  // Toutes les valeurs de CO₂ sont exprimées en GRAMMES de CO₂ équivalent.
  totalCo2Grams: number;
  // Ce que le même trajet aurait émis en voiture individuelle.
  carCo2Grams: number;
  // Économie réalisée par rapport à la voiture, jamais négative.
  //
  // Ce nom est celui du champ `savedVsCarGrams` du modèle CarbonRecord dans
  // schema.prisma : quand l'étape 4E enregistrera les trajets, aucune
  // traduction supplémentaire ne sera nécessaire.
  savedVsCarGrams: number;
  breakdown: CarbonBreakdownItemDto[];
}
