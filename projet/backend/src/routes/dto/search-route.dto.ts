import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
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

  /**
   * Mode de déplacement souhaité.
   *
   *   `TRANSIT` (défaut) : marche + tram/bus + marche, comme toujours ;
   *   `WALK`             : le trajet ENTIER à pied, rue par rue ;
   *   `BIKE`             : le trajet ENTIER à vélo, rue par rue.
   *
   * ⚠️ `WALK` ET `BIKE` COURT-CIRCUITENT LE GRAPHE DES TRANSPORTS. Ils ne
   * renvoient qu'UN itinéraire — il n'y a pas trois façons d'aller quelque
   * part à pied — et n'ont ni `walkAccess` ni `walkEgress` : le trajet n'est
   * pas « de l'adresse à un arrêt », il va d'un bout à l'autre.
   *
   * ⚠️ FACULTATIF. Son absence vaut `TRANSIT`, le cas courant.
   */
  @IsOptional()
  @IsIn(['TRANSIT', 'WALK', 'BIKE'])
  mode?: 'TRANSIT' | 'WALK' | 'BIKE';

  /**
   * L'usager demande un itinéraire ADAPTÉ AU FAUTEUIL ROULANT.
   *
   * ═══ CE QUE CE DRAPEAU FAIT ═══
   *
   * Le moteur PRIVILÉGIE les arrêts que le flux GTFS déclare accessibles
   * (`wheelchair_boarding = 1`). Si un itinéraire entièrement accessible
   * existe, c'est celui-là qui est rendu — même s'il est plus lent.
   *
   * ═══ CE QU'IL NE FAIT PAS ═══
   *
   * ⚠️ IL N'INVENTE RIEN. `wheelchair_boarding` vaut 0, 2 ou est absent pour
   * la plupart des arrêts : cela signifie « inconnu », PAS « inaccessible ».
   * Quand aucun trajet entièrement garanti n'existe, le moteur rend le
   * meilleur trajet possible ET le signale (`accessibility.guaranteed =
   * false`, liste des arrêts non garantis). Il ne renvoie jamais « aucun
   * itinéraire » parce qu'une donnée manque.
   *
   * ⚠️ IL NE VÉRIFIE PAS LES TROTTOIRS : seule l'accessibilité des ARRÊTS est
   * connue, pas celle du cheminement piéton entre l'adresse et le quai.
   *
   * ⚠️ FACULTATIF. Absent = pas de préférence, comportement inchangé.
   * `@Transform` : le drapeau arrive en `"true"`/`"false"` depuis une query
   * ou en booléen depuis un corps JSON — les deux doivent être acceptés.
   */
  @IsOptional()
  @Transform(({ value }: { value: unknown }): unknown => {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return value;
  })
  @IsBoolean()
  pmr?: boolean;
}
