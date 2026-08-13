import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
} from 'class-validator';
import { LanguageEnum, ModeTransport, ThemeEnum } from '@prisma/client';

// Sous-objet optionnel de CreateUserDto. Chaque champ correspond à une
// colonne de UserPreferences (voir prisma/schema.prisma). Seul
// co2BudgetWeekly est obligatoire ici : c'est le seul champ du modèle Prisma
// sans valeur par défaut.
export class CreateUserPreferencesDto {
  @IsOptional()
  @IsArray()
  @IsEnum(ModeTransport, { each: true })
  preferredModes?: ModeTransport[];

  @IsOptional()
  @IsBoolean()
  pmrMode?: boolean;

  @IsNumber()
  co2BudgetWeekly!: number;

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
