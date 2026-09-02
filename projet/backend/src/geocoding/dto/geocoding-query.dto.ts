import { IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Paramètres de `GET /api/geocoding/search?q=...` (Phase 3A).
 *
 * ⚠️ UN SEUL PARAMÈTRE, et c'est délibéré. Aucun `limit`, aucun `countrycodes`,
 * aucun `viewbox` : ces réglages appartiennent au SERVICE, qui les impose au
 * fournisseur. Les exposer laisserait un client demander 500 résultats à
 * Nominatim depuis notre adresse IP, et c'est nous qui en répondrions.
 */
export class GeocodingQueryDto {
  /**
   * Texte saisi par l'usager — « Tour Eiffel », « 10 rue de Rivoli Paris ».
   *
   * `@Transform` rogne AVANT validation : sans lui, « &nbsp;&nbsp; » passerait
   * `@MinLength(3)` pour n'être qu'un espace une fois nettoyé.
   *
   * `@MinLength(3)` : en deçà, aucune recherche d'adresse n'a de sens et le
   * fournisseur renverrait des milliers de correspondances. C'est aussi une
   * protection de politesse — on n'interroge pas un service public gratuit
   * avec « a ».
   *
   * `@MaxLength(120)` : largement au-delà d'une adresse postale française. La
   * borne existe pour qu'on ne relaie pas un texte arbitrairement long vers
   * un tiers.
   */
  // `value` est typé `any` par class-transformer : on le RESTREINT avant de
  // le rendre, plutôt que de propager un `any` dans le DTO.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  q!: string;
}
