import { Type } from 'class-transformer';
import {
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

// =============================================================================
// Paramètres d'URL de GET /api/stops (Phase 4)
// =============================================================================
// ⚠️ POURQUOI CETTE PAGINATION EXISTE, ET CE QU'ELLE DÉBLOQUE
//
// `GET /api/stops` renvoyait `findMany()` sans aucune borne. Sur le périmètre
// actuel — métro, tram, RER — cela fait 1 934 arrêts, soit quelques centaines
// de kilo-octets : lourd mais tenable.
//
// L'import du BUS d'Île-de-France porterait ce nombre à plus de 35 000. La
// même requête renverrait alors plusieurs mégaoctets de JSON à CHAQUE
// chargement de la page de recherche. C'est précisément ce qui a fait
// renoncer à importer le bus jusqu'ici : ce n'est pas l'import qui bloquait,
// c'est cet endpoint.
//
// Trois façons de demander des arrêts, et aucune ne les rend tous :
//
//   ?page=&limit=          parcours paginé, plafonné ;
//   ?query=                recherche par nom — « comment s'appelle-t-il ? » ;
//   ?lat=&lon=&radiusM=    voisinage — « qu'y a-t-il autour de moi ? ».
//
// Les trois se combinent : `?query=gare&lat=…&lon=…` cherche « gare » dans un
// voisinage. La pagination s'applique toujours, quelle que soit la
// combinaison.
// =============================================================================

/// Nombre d'arrêts renvoyés quand le client ne demande rien.
const LIMITE_PAR_DEFAUT = 50;

/**
 * Plafond du nombre d'arrêts par page.
 *
 * C'est la RAISON D'ÊTRE du paramètre : sans plafond, `?limit=100000`
 * rétablirait exactement la requête non bornée que cette pagination vient
 * supprimer.
 *
 * 200 arrêts pèsent une trentaine de kilo-octets — de quoi remplir une carte
 * à l'échelle d'un quartier en une seule requête.
 */
const LIMITE_MAXIMALE = 200;

/**
 * Rayon maximal d'une recherche de voisinage, en mètres.
 *
 * 5 km est plus large que le rayon de rattachement du moteur d'itinéraires
 * (2 km) : la carte doit pouvoir montrer un peu au-delà de ce que la
 * recherche relierait. Au-delà, ce n'est plus un voisinage, c'est un
 * parcours du réseau — et c'est à quoi sert `?page=`.
 */
const RAYON_MAXIMAL_M = 5000;

/// Rayon retenu quand un point est donné sans rayon explicite.
const RAYON_PAR_DEFAUT_M = 1000;

/**
 * Longueur minimale d'une recherche par nom.
 *
 * Une ou deux lettres ramèneraient presque tout le réseau, ce qui reviendrait
 * à contourner la pagination. C'est le même seuil que celui du champ
 * d'adresse côté frontend, et pour la même raison.
 */
const LONGUEUR_MINIMALE_RECHERCHE = 2;

export class FindStopsQueryDto {
  @Type(() => Number)
  @IsInt()
  // Numérotation humaine : la première page est la 1, pas la 0.
  @Min(1)
  page: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(LIMITE_MAXIMALE)
  limit: number = LIMITE_PAR_DEFAUT;

  /**
   * Fragment de nom recherché, insensible à la casse.
   *
   * ⚠️ AUCUNE CONCATÉNATION SQL. Prisma paramètre la requête `contains` :
   * un `%` ou une apostrophe dans la saisie n'ont aucun effet sur la
   * structure de la requête.
   */
  @IsOptional()
  @IsString()
  @MinLength(LONGUEUR_MINIMALE_RECHERCHE)
  // Borne haute : un nom d'arrêt réel dépasse rarement 60 caractères, et
  // rien ne justifie d'accepter une chaîne de plusieurs kilo-octets.
  @MaxLength(100)
  query?: string;

  /**
   * Centre de la recherche de voisinage.
   *
   * ⚠️ `lat` ET `lon` VONT ENSEMBLE. `@ValidateIf` rend chacun obligatoire
   * dès que l'autre est présent : sans cela, `?lat=48.8` seul serait accepté
   * et le filtre spatial silencieusement ignoré — l'usager croirait chercher
   * autour de lui alors qu'on lui rendrait le réseau entier paginé.
   */
  @ValidateIf((dto: FindStopsQueryDto) => dto.lon !== undefined)
  @Type(() => Number)
  @IsLatitude()
  lat?: number;

  @ValidateIf((dto: FindStopsQueryDto) => dto.lat !== undefined)
  @Type(() => Number)
  @IsLongitude()
  lon?: number;

  /**
   * Rayon du voisinage, en mètres. Sans effet si aucun point n'est donné.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(RAYON_MAXIMAL_M)
  radiusM: number = RAYON_PAR_DEFAUT_M;
}
