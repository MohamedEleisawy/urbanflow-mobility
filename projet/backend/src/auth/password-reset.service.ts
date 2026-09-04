import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword } from '../common/crypto/password.util';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

// =============================================================================
// Réinitialisation de mot de passe (war room)
// =============================================================================
// ═══ LES TROIS PROPRIÉTÉS QUE CE SERVICE DOIT TENIR ═══
//
//   1. NE JAMAIS RÉVÉLER QU'UN COMPTE EXISTE. La demande répond exactement la
//      même chose pour une adresse inscrite et pour une adresse inconnue.
//
//   2. NE JAMAIS STOCKER LE JETON EN CLAIR. Un jeton de réinitialisation vaut
//      un mot de passe : lire la base ne doit pas suffire à prendre la main
//      sur un compte.
//
//   3. UN JETON NE SERT QU'UNE FOIS. Consommé, il est marqué — pas supprimé,
//      pour qu'une seconde tentative soit refusée sciemment.
//
// ═══ CE QUE CE SERVICE N'ENVOIE PAS ═══
//
// ⚠️ AUCUN COURRIEL N'EST ENVOYÉ, PARCE QU'AUCUN FOURNISSEUR N'EST CONFIGURÉ.
// Inventer un SMTP serait un faux : le lien ne partirait nulle part, et
// l'interface annoncerait pourtant « email envoyé ».
//
// À la place, la livraison passe par un TRANSPORT explicite. En développement,
// le lien est journalisé côté serveur — visible du développeur, jamais de
// l'usager. Le jour où un fournisseur sera branché, seul ce transport changera.
//
// ⚠️ ET SURTOUT : L'INTERFACE NE DIT JAMAIS « email envoyé ». Elle dit « si un
// compte existe, un lien a été PRÉPARÉ ». La nuance n'est pas rhétorique — la
// première formulation serait fausse ici, et le resterait tant qu'aucun
// courriel ne part réellement.
// =============================================================================

/**
 * Durée de validité d'un jeton.
 *
 * Quinze minutes : assez pour relever ses courriels et cliquer, trop court
 * pour qu'un lien oublié dans une boîte de réception reste exploitable des
 * semaines plus tard. C'est l'ordre de grandeur retenu par l'OWASP.
 */
export const VALIDITE_JETON_MS = 15 * 60 * 1000;

/**
 * Taille du jeton, en octets.
 *
 * 32 octets = 256 bits d'entropie. Deviner un tel jeton est hors de portée, ce
 * qui est exactement pourquoi son empreinte n'a pas besoin d'un hachage lent.
 */
const OCTETS_JETON = 32;

/**
 * Empreinte d'un jeton.
 *
 * ⚠️ SHA-256 NU, ET NON scrypt — contrairement aux mots de passe. La différence
 * est justifiée par ce que chaque secret protège : un mot de passe est choisi
 * par un humain, donc devinable, et exige un hachage lent ; un jeton de
 * 256 bits ne l'est pas, et un hachage lent ne ferait que ralentir chaque
 * vérification sans rien protéger de plus.
 */
function empreinte(jeton: string): string {
  return createHash('sha256').update(jeton).digest('hex');
}

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Prépare une réinitialisation pour cette adresse.
   *
   * ⚠️ NE LÈVE JAMAIS, ET NE DIT JAMAIS SI LE COMPTE EXISTE. Une réponse
   * différente — même un code de statut, même un délai — transformerait cet
   * endpoint en oracle : on pourrait lui soumettre une liste d'adresses et
   * apprendre lesquelles sont inscrites.
   *
   * ⚠️ UN COMPTE SUPPRIMÉ NE REÇOIT PAS DE JETON, et le silence est le même.
   * Ressusciter un compte effacé par une réinitialisation viderait de son sens
   * le droit à l'effacement.
   */
  async demander(dto: ForgotPasswordDto): Promise<void> {
    const utilisateur = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true, email: true, deletedAt: true },
    });

    if (!utilisateur || utilisateur.deletedAt !== null) {
      // Silence complet. Voir l'avertissement ci-dessus.
      return;
    }

    // ⚠️ LES DEMANDES PRÉCÉDENTES SONT INVALIDÉES. Sans cela, dix demandes
    // successives laisseraient dix jetons valables en circulation, et il
    // suffirait d'intercepter le plus ancien courriel. Demander une
    // réinitialisation doit périmer la précédente.
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: utilisateur.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const jeton = randomBytes(OCTETS_JETON).toString('hex');

    await this.prisma.passwordResetToken.create({
      data: {
        userId: utilisateur.id,
        tokenHash: empreinte(jeton),
        expiresAt: new Date(Date.now() + VALIDITE_JETON_MS),
      },
    });

    this.livrer(utilisateur.email, jeton);
  }

  /**
   * Achemine le lien vers l'usager.
   *
   * ⚠️ POINT D'EXTENSION UNIQUE. Le jour où un fournisseur de courriel sera
   * configuré, c'est la SEULE méthode à changer : ni la génération du jeton,
   * ni sa vérification, ni les contrôleurs n'ont à savoir comment le lien
   * voyage.
   *
   * ⚠️ LE JETON EST JOURNALISÉ, ET C'EST ASSUMÉ EN DÉVELOPPEMENT SEULEMENT.
   * En production — `NODE_ENV=production` — on journalise qu'une demande a eu
   * lieu, jamais le jeton : les journaux d'un serveur sont lus par des
   * humains, agrégés, parfois exportés. Un jeton qui y traîne vaut un mot de
   * passe en clair.
   */
  private livrer(email: string, jeton: string): void {
    if (process.env.NODE_ENV === 'production') {
      this.logger.log(
        'Demande de réinitialisation traitée. Aucun transport de courriel ' +
          "n'est configuré : le lien n'a été envoyé nulle part.",
      );
      return;
    }

    const base = process.env.APP_PUBLIC_URL ?? 'http://localhost:3000';

    this.logger.warn(
      `[DÉVELOPPEMENT] Lien de réinitialisation pour ${email} :\n` +
        `  ${base}/reinitialiser-mot-de-passe?token=${jeton}\n` +
        `  Valable ${VALIDITE_JETON_MS / 60000} minutes, utilisable une seule fois.`,
    );
  }

  /**
   * Consomme un jeton et remplace le mot de passe.
   *
   * ⚠️ UN SEUL MESSAGE D'ERREUR POUR LES TROIS ÉCHECS — jeton inconnu, expiré,
   * déjà utilisé. Les distinguer apprendrait à un attaquant qu'un jeton a
   * existé, donc qu'une demande a été faite pour un compte donné.
   *
   * ⚠️ TOUT SE FAIT DANS UNE TRANSACTION. Sans elle, une panne entre l'écriture
   * du mot de passe et le marquage du jeton laisserait ce dernier réutilisable
   * — et un lien intercepté resterait valable après coup.
   */
  async reinitialiser(dto: ResetPasswordDto): Promise<void> {
    const enregistrement = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: empreinte(dto.token) },
      include: { user: { select: { id: true, deletedAt: true } } },
    });

    const invalide =
      !enregistrement ||
      enregistrement.usedAt !== null ||
      enregistrement.expiresAt.getTime() <= Date.now() ||
      enregistrement.user.deletedAt !== null;

    if (invalide) {
      throw new BadRequestException(
        'Ce lien de réinitialisation est invalide ou a expiré. ' +
          'Demandez-en un nouveau.',
      );
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: enregistrement.user.id },
        data: { passwordHash: hashPassword(dto.password) },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: enregistrement.id },
        data: { usedAt: new Date() },
      }),
      // ⚠️ LES AUTRES DEMANDES EN COURS SONT ÉGALEMENT INVALIDÉES. Quelqu'un
      // qui reprend la main sur son compte doit périmer tous les liens émis
      // pendant qu'il en avait perdu le contrôle.
      this.prisma.passwordResetToken.updateMany({
        where: { userId: enregistrement.user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
    ]);

    this.logger.log(
      `Mot de passe réinitialisé pour l'utilisateur ${enregistrement.user.id}.`,
    );
  }
}
