import { FavoriteAddressType } from '@prisma/client';
import {
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsNumber,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * Corps de `POST /api/users/me/addresses` (bloc 7).
 *
 * ⚠️ AUCUN `userId`. La route vise `/me` : le serveur lit l'identité dans le
 * jeton signé, et `forbidNonWhitelisted` rejette en 400 tout champ non
 * déclaré ici. Un client ne peut donc pas glisser l'identifiant d'un autre
 * compte — il n'y a pas de règle à écrire pour l'en empêcher, la forme du
 * DTO suffit.
 */
export class CreateAddressDto {
  /**
   * Domicile ou Travail — les deux seuls emplacements du dossier.
   *
   * `@IsEnum` refuse toute autre valeur en 400. C'est la même barrière que
   * la contrainte d'enum en base, appliquée un cran plus tôt pour rendre un
   * message lisible plutôt qu'une erreur Prisma.
   */
  @IsEnum(FavoriteAddressType)
  type!: FavoriteAddressType;

  /**
   * L'adresse telle que l'usager la saisit — « 12 rue des Lilas, Paris ».
   *
   * `@IsNotEmpty` : une chaîne vide passerait `@IsString` et produirait une
   * ligne dont l'affichage serait un blanc.
   *
   * `@MaxLength(255)` : une adresse postale française tient très largement
   * dedans, et la borne empêche qu'un client stocke un roman dans une
   * colonne `TEXT` sans limite. C'est le « budget de données » du modèle,
   * pas une contrainte de mise en forme.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  address!: string;

  /**
   * Coordonnées — ce que la recherche d'itinéraire consomme réellement.
   *
   * Mêmes décorateurs que `SearchRouteDto` (4B) et `CreateRouteDto` (4E) :
   *
   *   `@IsNumber()`    refuse une chaîne, ET refuse `NaN` comme `Infinity` —
   *                    ce sont les valeurs par défaut de class-validator
   *                    (`allowNaN: false`, `allowInfinity: false`).
   *   `@IsLatitude()`  vérifie l'intervalle [-90, 90].
   *   `@IsLongitude()` vérifie l'intervalle [-180, 180].
   *
   * Les trois vont ensemble : sans `@IsNumber`, `"abc"` traverserait.
   */
  @IsNumber()
  @IsLatitude()
  latitude!: number;

  @IsNumber()
  @IsLongitude()
  longitude!: number;
}
