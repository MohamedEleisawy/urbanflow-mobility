import { FavoriteAddressType } from '@prisma/client';
import {
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * Corps de `PATCH /api/users/me/addresses/:id` (bloc 7).
 *
 * ═══ POURQUOI CE DTO EST ÉCRIT À LA MAIN ═══
 *
 * `PartialType(CreateAddressDto)` de `@nestjs/mapped-types` ferait la même
 * chose en une ligne — mais ce paquet n'est pas installé, et l'ajouter pour
 * économiser une vingtaine de lignes déclaratives serait une dépendance de
 * confort. C'est le choix déjà fait pour `UpdatePreferencesDto` (5E) ; le
 * répéter garde les deux écrans cohérents.
 *
 * ⚠️ CHAQUE CHAMP EST FACULTATIF, MAIS AUCUN N'EST RELÂCHÉ. Un champ présent
 * subit exactement les mêmes contrôles qu'à la création : `@IsOptional`
 * n'écarte les autres décorateurs que lorsque la valeur est absente.
 */
export class UpdateAddressDto {
  /**
   * Changer le TYPE est autorisé — par exemple après un déménagement qui
   * fait du bureau le domicile.
   *
   * La contrainte d'unicité reste la seule autorité : viser un type déjà
   * occupé échoue en 409, comme à la création.
   */
  @IsOptional()
  @IsEnum(FavoriteAddressType)
  type?: FavoriteAddressType;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  address?: string;

  @IsOptional()
  @IsNumber()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  @IsLongitude()
  longitude?: number;
}
