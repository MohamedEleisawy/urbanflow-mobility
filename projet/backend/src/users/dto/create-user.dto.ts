import { Type } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CreateUserPreferencesDto } from './create-user-preferences.dto';

// Corps attendu par POST /api/users. "password" est le mot de passe en
// clair envoyé par le client : UsersService le transforme en passwordHash
// avant de l'écrire en base (voir src/common/crypto/password.util.ts).
export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  // Optionnel : correspond à la relation 1-1 facultative User -> UserPreferences.
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateUserPreferencesDto)
  preferences?: CreateUserPreferencesDto;
}
