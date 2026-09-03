import { Controller, Get } from '@nestjs/common';
import { territoryConfig } from '../config/territory.config';
import type { TerritoryConfig } from '../config/territory.config';

// =============================================================================
// GET /api/territory (Phase 6)
// =============================================================================
// ⚠️ POURQUOI LE FRONTEND NE LIT PAS SA PROPRE VARIABLE D'ENVIRONNEMENT.
//
// Il le pourrait — `NEXT_PUBLIC_TERRITORY_*` fonctionnerait. Ce serait alors
// DEUX sources de verite a tenir accordees : un deploiement qui changerait le
// territoire cote backend sans toucher au frontend afficherait une carte
// centree sur une ville et des arretes d'une autre.
//
// Une seule variable, un seul endpoint : le frontend demande ou il se trouve.
//
// ⚠️ AUCUN GUARD, comme `GET /api/stops` : le territoire desservi n'est pas
// une donnee personnelle, et un visiteur doit voir la carte.
// =============================================================================
@Controller('territory')
export class TerritoryController {
  /**
   * Le territoire desservi par cette installation.
   *
   *   200  `{ name, displayName, country, centerLat, centerLon, radiusM }`
   *
   * Ne peut pas echouer : la configuration a toujours des valeurs par defaut.
   */
  @Get()
  find(): TerritoryConfig {
    return territoryConfig();
  }
}
