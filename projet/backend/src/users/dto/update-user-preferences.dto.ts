import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
} from 'class-validator';
import { LanguageEnum, ModeTransport, ThemeEnum } from '@prisma/client';

// Corps de PATCH /api/users/me/preferences (étape 5E-1).
//
// ═══ POURQUOI CE DTO EST ÉCRIT À LA MAIN ═══
//
// `PartialType(CreateUserPreferencesDto)` produirait exactement le même
// résultat en une ligne — mais il vit dans `@nestjs/mapped-types`, qui n'est
// PAS installé. Ajouter une dépendance pour économiser six lignes serait un
// mauvais échange, d'autant qu'un DTO explicite se lit sans connaître la
// mécanique de `PartialType`.
//
// ═══ CE QU'ON NE TROUVERA JAMAIS ICI ═══
//
// Aucun `userId`. Il vient EXCLUSIVEMENT de `@CurrentUser().sub`, c'est-à-dire
// d'un jeton signé et vérifié. L'accepter dans le corps offrirait à n'importe
// qui les préférences de n'importe qui : c'est la faille classique de ce genre
// de route, et la seule façon sûre de l'éviter est que le champ n'existe pas.
//
// `forbidNonWhitelisted: true` est actif globalement (main.ts) : un client qui
// enverrait `userId` reçoit donc un 400, et non un silence.
//
// ═══ LA SEULE DIFFÉRENCE AVEC LE DTO DE CRÉATION ═══
//
// `co2BudgetWeekly` y est OBLIGATOIRE, ici il est facultatif. C'est le propre
// d'un PATCH : on décrit ce qui change, pas l'objet entier. La contrainte du
// modèle Prisma — ce champ n'a aucune valeur par défaut — est donc reportée
// dans le SERVICE, qui seul sait si une ligne existe déjà (voir
// `updatePreferences`).

export class UpdateUserPreferencesDto {
  @IsOptional()
  @IsArray()
  @IsEnum(ModeTransport, { each: true })
  preferredModes?: ModeTransport[];

  @IsOptional()
  @IsBoolean()
  pmrMode?: boolean;

  // ⚠️ `@IsNumber()` SEUL, comme dans CreateUserPreferencesDto : un budget
  // négatif passerait. Le durcir ici et pas à la création créerait deux
  // règles pour un même champ — un piège pire que le trou lui-même. Le
  // signalement est fait dans le rapport de l'étape ; la correction est une
  // évolution distincte, qui devra toucher les deux DTO ensemble.
  @IsOptional()
  @IsNumber()
  co2BudgetWeekly?: number;

  @IsOptional()
  @IsBoolean()
  notificationsEnabled?: boolean;

  @IsOptional()
  @IsEnum(LanguageEnum)
  language?: LanguageEnum;

  @IsOptional()
  @IsEnum(ThemeEnum)
  theme?: ThemeEnum;
}
