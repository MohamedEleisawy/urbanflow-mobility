import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

/// Fenêtre par défaut : environ un trimestre, horizon lisible sur un
/// graphique d'évolution sans noyer l'usager sous l'historique.
const SEMAINES_PAR_DEFAUT = 12;

/// Plafond de la fenêtre — un an.
///
/// C'est la RAISON D'ÊTRE du paramètre : sans plafond, `?weeks=100000`
/// rétablirait la requête non bornée que la fenêtre vient supprimer. Même
/// raisonnement que `limit` dans PaginationQueryDto (étape 4E-4A).
const SEMAINES_MAXIMUM = 52;

// Paramètres d'URL de GET /api/suivi-carbone (étape 4E-5A).
//
// ⚠️ Les paramètres d'URL arrivent TOUJOURS en chaînes : `?weeks=4` vaut
// "4", pas 4. Sans @Type(() => Number), @IsInt() refuserait toute valeur,
// y compris correcte. Le couple est indissociable — même piège qu'en 4E-4A.
export class WeeklyTrackingQueryDto {
  /**
   * Nombre de semaines à remonter, semaine courante INCLUSE.
   *
   * Une valeur hors bornes est REFUSÉE (400), jamais ramenée au plafond :
   * un rabotage silencieux répondrait « voici vos 100 semaines » en en
   * renvoyant 52. C'est la ligne suivie dans tout le projet.
   */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SEMAINES_MAXIMUM)
  weeks: number = SEMAINES_PAR_DEFAUT;
}
