import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

// Corps attendu par POST /api/auth/login.
export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}
