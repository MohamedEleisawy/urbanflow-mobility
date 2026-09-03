import { Controller, Get, Param, Query } from '@nestjs/common';
import { VelibService } from './velib.service';
import {
  VelibNearbyQueryDto,
  VelibStationsQueryDto,
} from './dto/velib-query.dto';
import {
  VelibStationDto,
  VelibStationsResponseDto,
} from './dto/velib-station.dto';

// =============================================================================
// Stations Vélib' — contrat HTTP (Phase 5)
// =============================================================================
// ⚠️ AUCUN GUARD, comme pour `GET /api/stops` et `POST /api/routes/search` :
// le dossier place la consultation de la carte en libre accès. Rien n'est lu
// ni écrit en base ici — seulement un relais vers un flux public.
//
// ⚠️ LE FRONTEND NE DOIT JAMAIS APPELER GBFS DIRECTEMENT. Les raisons sont
// détaillées sur `VelibService` : taille des flux, absence de garantie CORS,
// et surtout un cache serveur partagé plutôt qu'un téléchargement de 730 ko
// par navigateur et par ouverture de carte.
// =============================================================================

@Controller('velib')
export class VelibController {
  constructor(private readonly velibService: VelibService) {}

  /**
   * Stations du réseau, plafonnées.
   *
   *   GET /api/velib/stations?limit=100
   *
   * Réponses :
   *   200  `{ stations, total, fetchedAt, attribution }`
   *   400  `limit` hors bornes
   *   503  flux injoignable, en erreur, illisible ou vide
   */
  @Get('stations')
  findAll(
    @Query() query: VelibStationsQueryDto,
  ): Promise<VelibStationsResponseDto> {
    return this.velibService.findAll(query.limit);
  }

  /**
   * Stations autour d'un point, de la plus proche à la plus éloignée.
   *
   *   GET /api/velib/nearby?lat=48.85&lon=2.35&radiusM=800
   *
   * ⚠️ DÉCLARÉ AVANT `:stationId`. Sans cela, Nest ferait correspondre
   * « nearby » au paramètre d'identifiant, et la route ne serait jamais
   * atteinte — le même piège que `POST /routes/search` face à `POST /routes`.
   *
   * Une liste VIDE n'est pas une erreur : « aucune station à moins de 800 m »
   * est une réponse, que l'interface doit savoir afficher.
   */
  @Get('nearby')
  findNearby(
    @Query() query: VelibNearbyQueryDto,
  ): Promise<VelibStationsResponseDto> {
    return this.velibService.findNearby(
      query.lat,
      query.lon,
      query.radiusM,
      query.limit,
    );
  }

  /**
   * Une station précise.
   *
   *   GET /api/velib/stations/213688169
   *
   * ⚠️ PAS DE `ParseUUIDPipe` ICI, contrairement aux ressources internes : cet
   * identifiant est celui du FOURNISSEUR, un entier publié par GBFS. Exiger un
   * UUID rejetterait toutes les stations réelles.
   *
   *   404  aucune station ne porte cet identifiant
   *   503  flux indisponible
   */
  @Get('stations/:stationId')
  findOne(@Param('stationId') stationId: string): Promise<VelibStationDto> {
    return this.velibService.findOne(stationId);
  }
}
