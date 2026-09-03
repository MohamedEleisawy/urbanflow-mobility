import { Controller, Get } from '@nestjs/common';
import { capabilitiesConfig } from '../config/capabilities.config';
import type { CapabilitiesConfig } from '../config/capabilities.config';

// =============================================================================
// GET /api/capabilities (sprint soutenance)
// =============================================================================
// Ce que cette installation sait RÉELLEMENT faire, pour que l'interface cesse
// de deviner. Voir `capabilities.config.ts` pour le raisonnement.
//
// ⚠️ AUCUN GUARD, comme `GET /api/territory` : savoir si le routage piéton est
// branché n'est pas une donnée personnelle, et un visiteur non connecté voit
// exactement les mêmes écrans qu'un usager connecté.
//
// ⚠️ AUCUNE URL, AUCUNE CLÉ NE SORT D'ICI. `capabilitiesConfig()` ne rend que
// des noms de fournisseurs et des états ; les adresses de base restent
// côté serveur. Un endpoint public qui recracherait `WALK_ROUTING_BASE_URL`
// publierait le jeton qu'elle peut contenir.
// =============================================================================
@Controller('capabilities')
export class CapabilitiesController {
  /**
   * Les capacités de cette installation.
   *
   *   200  `{ walkRouting, bikeRouting, transitRealtime, legal }`
   *
   * Ne peut pas échouer : une variable absente vaut « non configuré ».
   */
  @Get()
  find(): CapabilitiesConfig {
    return capabilitiesConfig();
  }
}
