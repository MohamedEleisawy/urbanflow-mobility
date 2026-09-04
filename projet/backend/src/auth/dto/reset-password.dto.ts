import { IsString, MinLength } from 'class-validator';

/**
 * Corps attendu par `POST /api/auth/reset-password`.
 */
export class ResetPasswordDto {
  /**
   * Le jeton reçu par l'usager, en clair.
   *
   * ⚠️ AUCUNE CONTRAINTE DE FORMAT AU-DELÀ DE « CHAÎNE NON VIDE ». Valider sa
   * longueur exacte ou son alphabet permettrait de distinguer « jeton mal
   * formé » de « jeton inconnu » par le code de statut — et donc de sonder le
   * format attendu. Un jeton invalide, quelle qu'en soit la raison, doit
   * produire exactement la même réponse.
   */
  @IsString()
  @MinLength(1)
  token!: string;

  /**
   * Le nouveau mot de passe, en clair.
   *
   * ⚠️ `MinLength(8)`, LA MÊME RÈGLE QU'À L'INSCRIPTION (`CreateUserDto`).
   * Une exigence plus faible ici ouvrirait un contournement : il suffirait de
   * demander une réinitialisation pour se donner un mot de passe que
   * l'inscription refuse.
   */
  @IsString()
  @MinLength(8, {
    message: 'Le mot de passe doit contenir au moins 8 caractères.',
  })
  password!: string;
}
