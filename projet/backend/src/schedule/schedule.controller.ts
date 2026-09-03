import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { ScheduleService } from './schedule.service';
import type { Passage } from './schedule.service';

// =============================================================================
// GET /api/stops/:id/departures (sprint soutenance)
// =============================================================================
// ⚠️ AUCUN GUARD, comme le reste du référentiel de transport. Les horaires
// d'un arrêt sont une donnée publique : un visiteur non connecté doit pouvoir
// savoir quand passe son tram.
//
// ⚠️ AUCUNE DONNÉE PERSONNELLE NE TRANSITE ICI. `stop_departures` n'a pas de
// colonne `userId`, par construction : on ne peut pas divulguer ce qu'on ne
// stocke pas.
// =============================================================================

/// Nombre maximal de passages rendus.
///
/// 10 : de quoi couvrir un quart d'heure sur une ligne fréquente, sans faire
/// défiler l'écran. Un plafond DUR — un client demandant 500 en obtient 10.
const LIMITE_MAX = 10;

export interface DeparturesResponseDto {
  /**
   * Fraîcheur de la donnée.
   *
   * `STATIC` : horaires THÉORIQUES publiés par l'opérateur. Ni retard, ni
   * suppression, ni véhicule réellement observé.
   *
   * `UNKNOWN` : aucun calendrier n'est importé sur cette installation.
   *
   * ⚠️ `REALTIME` N'EST JAMAIS RENDU ICI, et ce n'est pas un oubli : aucune
   * source temps réel n'alimente cette table. Le jour où un flux SIRI sera
   * branché, ce sera une autre valeur, produite par un autre chemin.
   */
  freshness: 'STATIC' | 'UNKNOWN';

  departures: Passage[];
}

@Controller('stops')
export class ScheduleController {
  constructor(private readonly schedule: ScheduleService) {}

  /**
   * Les prochains passages à un arrêt.
   *
   *   200  `{ freshness, departures }`
   *   400  identifiant d'arrêt mal formé
   *
   * Ne rend JAMAIS 404 sur un arrêt inconnu : un arrêt sans passage et un
   * arrêt inexistant produisent la même liste vide, et distinguer les deux
   * permettrait d'énumérer les identifiants en base.
   */
  @Get(':id/departures')
  async departures(
    @Param('id', ParseUUIDPipe) stopId: string,
    @Query('limit', new DefaultValuePipe(LIMITE_MAX), ParseIntPipe)
    limite: number,
  ): Promise<DeparturesResponseDto> {
    if (!(await this.schedule.horairesDisponibles())) {
      return { freshness: 'UNKNOWN', departures: [] };
    }

    // ⚠️ LE PLAFOND EST APPLIQUÉ ICI, PAS DANS LE SERVICE. Un `limit=0` ou
    // négatif deviendrait un `take` invalide côté Prisma.
    const demande = Math.min(Math.max(limite, 1), LIMITE_MAX);

    const departures = await this.schedule.prochainsPassages(
      [stopId],
      new Date(),
      demande,
    );

    return { freshness: 'STATIC', departures };
  }
}
