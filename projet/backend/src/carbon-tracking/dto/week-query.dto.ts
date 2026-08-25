import { Type } from 'class-transformer';
import { IsInt, Max, Min, ValidateIf } from 'class-validator';

/// Garde-fou de saisie, non une règle métier : bornes assez larges pour
/// n'exclure aucun usage réel, assez étroites pour refuser une aberration.
const ANNEE_MINIMALE = 2000;
const ANNEE_MAXIMALE = 2100;

/// Certaines années ISO comptent 53 semaines (2020, 2026...). Demander la
/// semaine 53 d'une année qui n'en compte que 52 est accepté et renvoie
/// simplement une consommation nulle : c'est une semaine sans trajet, pas
/// une erreur de saisie.
const SEMAINE_MAXIMALE = 53;

// Paramètres d'URL de GET /api/suivi-carbone/budget (étape 4E-5B).
//
// Les deux champs vont PAR PAIRE : soit aucun (la semaine courante est
// alors utilisée), soit les deux. Une année sans semaine, ou l'inverse, ne
// désigne aucune période.
//
// C'est ce que réalise `@ValidateIf` : la validation de `year` ne s'active
// que si `week` est présent — auquel cas `@IsInt()` s'applique à une valeur
// absente et rejette la requête en 400. Et symétriquement. Quand les deux
// manquent, les deux validations sont ignorées.
export class WeekQueryDto {
  @ValidateIf((requete: WeekQueryDto) => requete.week !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(ANNEE_MINIMALE)
  @Max(ANNEE_MAXIMALE)
  year?: number;

  @ValidateIf((requete: WeekQueryDto) => requete.year !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SEMAINE_MAXIMALE)
  week?: number;
}
