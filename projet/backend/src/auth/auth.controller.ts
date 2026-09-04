import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PasswordResetService } from './password-reset.service';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly passwordReset: PasswordResetService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  /**
   * Demande une réinitialisation de mot de passe.
   *
   *   200  toujours, quelle que soit l'adresse fournie.
   *   400  adresse mal formée (validation du DTO).
   *
   * ⚠️ 200 MÊME POUR UNE ADRESSE INCONNUE, ET C'EST LE POINT DE L'ENDPOINT.
   * Un 404 sur une adresse non inscrite ferait de cette route un oracle : on
   * lui soumettrait une liste d'adresses et l'on apprendrait lesquelles ont un
   * compte. C'est l'énumération de comptes, et elle se paie cher — les
   * adresses ainsi confirmées alimentent l'hameçonnage ciblé.
   *
   * ⚠️ LE MESSAGE DIT « PRÉPARÉ », PAS « ENVOYÉ ». Aucun transport de courriel
   * n'est configuré sur cette installation ; annoncer un envoi serait faux.
   * Voir `PasswordResetService.livrer()`.
   */
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
  ): Promise<{ message: string }> {
    await this.passwordReset.demander(dto);

    return {
      message:
        'Si un compte existe pour cette adresse, un lien de ' +
        'réinitialisation a été préparé.',
    };
  }

  /**
   * Consomme un jeton et remplace le mot de passe.
   *
   *   200  mot de passe remplacé, jeton consommé.
   *   400  jeton inconnu, expiré ou déjà utilisé — un seul message pour les
   *        trois, afin de ne pas révéler qu'un jeton a existé.
   *
   * ⚠️ AUCUN JETON D'ACCÈS N'EST RENVOYÉ. Réinitialiser son mot de passe ne
   * doit pas connecter : quelqu'un qui a intercepté le lien obtiendrait une
   * session sans jamais prouver qu'il connaît le nouveau mot de passe. On
   * renvoie donc vers la page de connexion.
   */
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body() dto: ResetPasswordDto,
  ): Promise<{ message: string }> {
    await this.passwordReset.reinitialiser(dto);

    return {
      message:
        'Votre mot de passe a été modifié. Vous pouvez maintenant vous ' +
        'connecter.',
    };
  }
}
