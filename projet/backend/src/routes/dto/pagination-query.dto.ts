import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

/// Nombre d'éléments renvoyés quand le client ne demande rien.
///
/// Une page d'historique en affiche une dizaine : 20 évite un aller-retour
/// immédiat sans pour autant charger une liste que personne ne lira.
const LIMITE_PAR_DEFAUT = 20;

/// Plafond du nombre d'éléments par page.
///
/// C'est la RAISON D'ÊTRE du paramètre : sans plafond, `?limit=100000`
/// rétablirait exactement la requête non bornée que la pagination vient
/// supprimer. 50 résumés d'itinéraire pèsent une dizaine de kilo-octets,
/// ce qui laisse une marge confortable.
const LIMITE_MAXIMALE = 50;

// Paramètres d'URL de GET /api/routes (étape 4E-4A).
//
// ⚠️ Les paramètres d'URL arrivent TOUJOURS en chaînes de caractères :
// `?page=2` vaut "2", pas 2. Sans @Type(() => Number), @IsInt() refuserait
// toute valeur, y compris correcte. C'est le même piège que @ValidateNested
// sans @Type (étape 4D-2) : deux décorateurs qui n'ont de sens qu'ensemble.
//
// Les valeurs par défaut sont portées par les propriétés elles-mêmes : quand
// le client n'envoie rien, class-transformer instancie la classe et ces
// valeurs subsistent, puis sont validées comme les autres.
export class PaginationQueryDto {
  @Type(() => Number)
  @IsInt()
  // Numérotation humaine : la première page est la 1, pas la 0. Le décalage
  // SQL en est déduit, (page - 1) × limit.
  @Min(1)
  page: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(LIMITE_MAXIMALE)
  limit: number = LIMITE_PAR_DEFAUT;
}
