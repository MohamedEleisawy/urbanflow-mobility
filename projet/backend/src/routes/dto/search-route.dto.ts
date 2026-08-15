import { IsLatitude, IsLongitude, IsNumber } from 'class-validator';

// Corps attendu par POST /api/routes/search.
//
// L'usager saisit deux points sur une carte : on ne lui demande pas de
// connaître les identifiants des arrêts. Le service se charge de trouver
// l'arrêt le plus proche de chaque point.
//
// Deux validations se complètent sur chaque champ (étape 4C-2) :
//   - @IsNumber  : refuse les chaînes de caractères. Sans lui, {"fromLat":
//     "48.8"} serait accepté (isLatitude tolère les chaînes numériques),
//     alors que le type déclaré est number ;
//   - @IsLatitude / @IsLongitude : vérifient les intervalles [-90, 90] et
//     [-180, 180], bornes comprises.
export class SearchRouteDto {
  @IsNumber()
  @IsLatitude()
  fromLat!: number;

  @IsNumber()
  @IsLongitude()
  fromLon!: number;

  @IsNumber()
  @IsLatitude()
  toLat!: number;

  @IsNumber()
  @IsLongitude()
  toLon!: number;
}
