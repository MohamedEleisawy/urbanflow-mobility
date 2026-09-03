import {
  IsISO8601,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
} from 'class-validator';

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

  /**
   * Instant de départ souhaité, en ISO 8601. Absent = maintenant.
   *
   * ═══ POURQUOI CE CHAMP EXISTE ═══
   *
   * Depuis que le calendrier GTFS est importé, la réponse DÉPEND DE L'HEURE :
   * les lignes de nuit ne circulent pas à 14 h, et l'attente sur le quai n'est
   * pas la même un dimanche soir qu'un mardi matin. Sans ce champ, on ne
   * pourrait préparer un trajet que pour l'instant présent.
   *
   * ⚠️ FACULTATIF, ET SON ABSENCE N'EST PAS UNE ERREUR. La recherche « je pars
   * maintenant » reste le cas courant, et doit rester la plus simple à écrire.
   *
   * ⚠️ `@IsISO8601` ET NON `@IsDateString` : le second accepte des formats
   * que `new Date()` interprète différemment selon le moteur. Une date
   * ambiguë sur un calcul d'horaires produirait un décalage silencieux.
   */
  @IsOptional()
  @IsISO8601()
  departAt?: string;
}
