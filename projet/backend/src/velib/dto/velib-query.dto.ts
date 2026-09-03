import { Type } from 'class-transformer';
import { IsInt, IsLatitude, IsLongitude, Max, Min } from 'class-validator';

// =============================================================================
// Paramètres d'URL des endpoints Vélib' (Phase 5)
// =============================================================================
// ⚠️ Les paramètres d'URL arrivent TOUJOURS en chaînes : `?limit=20` vaut "20",
// pas 20. Sans `@Type(() => Number)`, `@IsInt()` refuserait toute valeur, y
// compris correcte. C'est le même piège que pour `FindStopsQueryDto`.
// =============================================================================

/// Stations rendues quand le client ne demande rien.
const LIMITE_PAR_DEFAUT = 50;

/**
 * Plafond du nombre de stations rendues.
 *
 * Le réseau en compte 1 519. Les rendre toutes ferait ~500 ko de JSON par
 * appel, et dessinerait un pâté de marqueurs illisible. 300 couvre largement
 * une vue de quartier.
 */
const LIMITE_MAXIMALE = 300;

/// Rayon retenu quand aucun n'est précisé.
const RAYON_PAR_DEFAUT_M = 800;

/// Même plafond que `GET /api/stops` : au-delà, ce n'est plus un voisinage.
const RAYON_MAXIMAL_M = 5000;

/** Paramètres de `GET /api/velib/stations`. */
export class VelibStationsQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(LIMITE_MAXIMALE)
  limit: number = LIMITE_PAR_DEFAUT;
}

/**
 * Paramètres de `GET /api/velib/nearby`.
 *
 * ⚠️ `lat` ET `lon` SONT OBLIGATOIRES ICI, contrairement à `GET /api/stops`
 * où ils sont facultatifs. La nuance est voulue : sans point, « nearby » n'a
 * aucun sens, alors que « stops » a un mode de parcours paginé.
 */
export class VelibNearbyQueryDto {
  @Type(() => Number)
  @IsLatitude()
  lat!: number;

  @Type(() => Number)
  @IsLongitude()
  lon!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(RAYON_MAXIMAL_M)
  radiusM: number = RAYON_PAR_DEFAUT_M;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(LIMITE_MAXIMALE)
  limit: number = LIMITE_PAR_DEFAUT;
}
