import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { ModeTransport } from '@prisma/client';

// Corps attendu par POST /api/routes/:routeId/segments.
//
// routeId n'apparaît PAS ici : il vient de l'URL, et sa propriété est
// vérifiée par le service. userId non plus : il vient du JWT.
export class CreateSegmentDto {
  // Enum importé depuis @prisma/client : on réutilise celui du schéma plutôt
  // que d'en redéclarer un, pour qu'il ne puisse jamais diverger de la base.
  @IsEnum(ModeTransport)
  mode!: ModeTransport;

  // Opérateur de transport (ex : "RATP"). Obligatoire dans le schéma Prisma,
  // conformément au diagramme de classes.
  @IsString()
  @IsNotEmpty()
  operator!: string;

  // @Type(() => Date) convertit la chaîne JSON ISO en objet Date (le
  // ValidationPipe global a transform: true), pour que Prisma reçoive
  // directement un DateTime valide.
  @Type(() => Date)
  @IsDate()
  departureTime!: Date;

  @Type(() => Date)
  @IsDate()
  arrivalTime!: Date;

  @IsInt()
  @Min(0)
  distanceM!: number;

  // Ligne empruntée (ex : "Bus 12", "M4").
  @IsString()
  @IsNotEmpty()
  line!: string;

  // Identifiant du trajet dans le flux GTFS de l'opérateur. Obligatoire dans
  // le schéma ; l'import GTFS réel viendra à une étape ultérieure.
  @IsString()
  @IsNotEmpty()
  gtfsTripId!: string;

  // Arrêts de départ et d'arrivée du segment : doivent exister en base.
  @IsUUID()
  fromStopId!: string;

  @IsUUID()
  toStopId!: string;
}
