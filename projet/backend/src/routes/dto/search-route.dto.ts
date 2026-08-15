import { IsLatitude, IsLongitude } from 'class-validator';

// Corps attendu par POST /api/routes/search.
//
// L'usager saisit deux points sur une carte : on ne lui demande pas de
// connaître les identifiants des arrêts. Le service se charge de trouver
// l'arrêt le plus proche de chaque point.
//
// @IsLatitude vérifie l'intervalle [-90, 90] et @IsLongitude [-180, 180].
export class SearchRouteDto {
  @IsLatitude()
  fromLat!: number;

  @IsLongitude()
  fromLon!: number;

  @IsLatitude()
  toLat!: number;

  @IsLongitude()
  toLon!: number;
}
