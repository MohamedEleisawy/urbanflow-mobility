import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsInt,
  Min,
  ValidateNested,
} from 'class-validator';
import { ModeTransport } from '@prisma/client';

// Corps attendu par POST /api/carbone.
//
// L'API publique est en camelCase (distanceM), le microservice FastAPI en
// snake_case (distance_m). La traduction est faite par CarbonService, à un
// seul endroit : chaque service reste ainsi idiomatique dans son langage.

// Une portion de trajet dont on veut connaître les émissions.
//
// On ne demande QUE ce dont le calcul a besoin : un mode et une distance.
// La durée, les arrêts ou les noms de lignes n'interviennent pas, les
// émissions se mesurant au kilomètre et non à la minute.
export class CarbonSegmentDto {
  // Enum importé depuis @prisma/client, comme dans CreateSegmentDto : on
  // réutilise celui du schéma plutôt que d'en redéclarer un, pour qu'il ne
  // puisse jamais diverger de la base.
  //
  // Il contient ESCOOTER, que FastAPI refuse de calculer faute de facteur
  // d'émission. Ce refus est VOLONTAIREMENT laissé à FastAPI : dupliquer ici
  // la liste des modes calculables créerait deux vérités à maintenir, et
  // c'est le microservice qui détient les facteurs.
  @IsEnum(ModeTransport)
  mode!: ModeTransport;

  // Distance en MÈTRES, comme partout ailleurs dans UrbanFlow.
  // @IsInt refuse aussi bien "600" (chaîne) que 600.5 (décimal).
  @IsInt()
  @Min(0)
  distanceM!: number;
}

export class CalculateCarbonDto {
  // @ValidateNested({ each: true }) et @Type sont indispensables ensemble :
  // sans @Type, class-transformer laisserait des objets bruts dans le
  // tableau, et @ValidateNested n'aurait aucune classe contre laquelle les
  // valider — les segments passeraient donc SANS être vérifiés.
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CarbonSegmentDto)
  segments!: CarbonSegmentDto[];
}
