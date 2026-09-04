import { Type } from 'class-transformer';
import {
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

// =============================================================================
// GET /api/stops/nearby — « Autour de moi » (war room)
// =============================================================================

/**
 * Rayon par défaut, en mètres.
 *
 * 800 m : environ dix minutes de marche, la distance au-delà de laquelle
 * personne ne considère qu'un arrêt est « à côté ». Un rayon plus large
 * remplirait l'écran d'arrêts qu'on n'ira pas rejoindre.
 */
export const RAYON_DEFAUT_M = 800;

/**
 * Rayon maximal accepté.
 *
 * ⚠️ UNE BORNE DE REQUÊTE, PAS UN CONFORT. Sans elle, `radiusM=500000`
 * chargerait les 36 838 arrêts de la base en mémoire pour en calculer la
 * distance un par un.
 */
export const RAYON_MAX_M = 3000;

/// Nombre d'arrêts rendus par défaut, et plafond dur.
export const LIMITE_DEFAUT = 8;
export const LIMITE_MAX = 25;

export class NearbyQueryDto {
  /**
   * ⚠️ LES DEUX COORDONNÉES SONT OBLIGATOIRES, contrairement à
   * `FindStopsQueryDto` où elles sont facultatives. Un endpoint « autour de
   * moi » sans point de référence n'a pas de sens : mieux vaut un 400 explicite
   * qu'un repli silencieux sur le centre du territoire, qui rendrait des
   * arrêts sans rapport avec l'usager.
   */
  @Type(() => Number)
  @IsLatitude()
  lat!: number;

  @Type(() => Number)
  @IsLongitude()
  lon!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(50)
  @Max(RAYON_MAX_M)
  radiusM: number = RAYON_DEFAUT_M;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(LIMITE_MAX)
  limit: number = LIMITE_DEFAUT;
}

/// Une ligne desservant un arrêt.
export interface LigneDesservieDto {
  id: string;
  name: string;
  mode: string;
}

/// Le prochain passage à un arrêt, quand il est calculable.
export interface ProchainPassageDto {
  lineId: string;
  lineName: string;
  mode: string;
  headsign: string | null;
  departureAt: string;
  waitMin: number;
}

export interface ArretProcheDto {
  id: string;
  name: string;
  latitude: number;
  longitude: number;

  /// Distance à vol d'oiseau, en mètres.
  ///
  /// ⚠️ À VOL D'OISEAU, ET L'INTERFACE DOIT LE DIRE. Aucun routeur piéton
  /// n'est configuré : la distance réelle à pied est plus longue, parfois
  /// beaucoup — une voie ferrée ou un fleuve entre les deux points.
  distanceM: number;

  /// Temps de marche ESTIMÉ, en minutes.
  ///
  /// ⚠️ DÉRIVÉ DE LA DISTANCE À VOL D'OISEAU, donc optimiste. Voir
  /// `StopsService.minutesDeMarche()` pour l'hypothèse retenue et pourquoi
  /// elle est annoncée comme une estimation.
  walkMin: number;

  pmrAccessible: boolean;

  /**
   * Les lignes qui desservent cet arrêt.
   *
   * ⚠️ PEUT ÊTRE VIDE. Un arrêt importé qu'aucune liaison ne relie existe en
   * base ; le masquer reviendrait à cacher une donnée réelle. L'interface
   * l'affiche alors sans liste de lignes.
   */
  lines: LigneDesservieDto[];

  /**
   * Le prochain passage, ou `null` si aucun n'est calculable.
   *
   * ⚠️ `null` NE SIGNIFIE PAS « PLUS DE SERVICE ». Il couvre aussi « ce réseau
   * n'a pas d'horaires importés ». C'est `departuresFreshness` qui distingue
   * les deux, et l'interface DOIT s'en servir : afficher « aucun passage » sur
   * un réseau jamais horodaté serait faux.
   */
  nextDeparture: ProchainPassageDto | null;
}

export interface NearbyResponseDto {
  stops: ArretProcheDto[];

  /**
   * Ce que vaut l'information horaire de cette réponse.
   *
   * `STATIC`  : horaires THÉORIQUES publiés par l'opérateur. Ni retard, ni
   *             suppression, ni véhicule observé.
   * `UNKNOWN` : aucun horaire n'est importé pour ce réseau.
   *
   * ⚠️ `REALTIME` N'EXISTE PAS ICI, et ce n'est pas un oubli : aucune source
   * temps réel n'alimente cette table.
   */
  departuresFreshness: 'STATIC' | 'UNKNOWN';
}
