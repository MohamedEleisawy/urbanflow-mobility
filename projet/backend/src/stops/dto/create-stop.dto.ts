import {
  IsBoolean,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

// Corps attendu par POST /api/stops.
// Un Stop est un arrêt physique du réseau (arrêt de bus, station de métro).
export class CreateStopDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  // Coordonnées du GeoPoint "location" du diagramme de classes, aplati en
  // deux colonnes (décision de l'étape 2A).
  @IsLatitude()
  latitude!: number;

  @IsLongitude()
  longitude!: number;

  // Accessibilité PMR : optionnel car le schéma Prisma prévoit @default(false).
  // Répond au besoin de la persona Christiane (« savoir avant de partir si je
  // vais pouvoir descendre du tram sans aide »).
  @IsOptional()
  @IsBoolean()
  pmrAccessible?: boolean;

  // Code de l'opérateur de transport auquel appartient l'arrêt.
  @IsString()
  @IsNotEmpty()
  operatorCode!: string;
}
