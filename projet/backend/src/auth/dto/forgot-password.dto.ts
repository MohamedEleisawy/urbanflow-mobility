import { IsEmail } from 'class-validator';

/**
 * Corps attendu par `POST /api/auth/forgot-password`.
 *
 * ⚠️ UN SEUL CHAMP, ET C'EST VOULU. Tout champ supplémentaire — un nom, une
 * question secrète — donnerait matière à comparer deux réponses, donc à
 * déduire l'existence d'un compte.
 */
export class ForgotPasswordDto {
  @IsEmail({}, { message: 'Adresse électronique invalide.' })
  email!: string;
}
