import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AddressDto } from './dto/address.dto';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

// =============================================================================
// Adresses favorites — Domicile et Travail (bloc 7)
// =============================================================================
// Le dossier les demande dans l'espace personnel : « mémoriser des adresses
// favorites (Domicile, Travail) » (§3.2.1).
//
// ═══ CHAQUE MÉTHODE PREND `userId`, ET IL VIENT TOUJOURS DU JETON ═══
//
// Aucune méthode ne peut être appelée sans dire POUR QUI. Ce n'est pas une
// politesse de signature : c'est ce qui rend impossible d'écrire par
// distraction une requête qui lirait la table entière.
//
// Le contrôleur remplit ce paramètre depuis `@CurrentUser().sub` — un jeton
// signé et vérifié — jamais depuis un paramètre d'URL, une query ou un corps.
// =============================================================================

/// Colonnes rendues au client. `userId` en est absent : la route est `/me`,
/// l'appelant sait déjà que ces adresses sont les siennes.
const COLONNES_PUBLIQUES = {
  id: true,
  type: true,
  address: true,
  latitude: true,
  longitude: true,
  createdAt: true,
} as const;

@Injectable()
export class AddressesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Les adresses du compte, dans un ordre DÉTERMINISTE.
   *
   * `orderBy: { type: 'asc' }` suffit, et c'est un ordre TOTAL : la contrainte
   * `@@unique([userId, type])` garantit qu'un type n'apparaît qu'une fois.
   * Nul besoin d'un second critère de départage — il n'y a jamais d'égalité.
   *
   * PostgreSQL trie un enum selon son ORDRE DE DÉCLARATION, pas
   * alphabétiquement : `HOME` précède `WORK` parce qu'il est déclaré en
   * premier. Le Domicile arrive donc d'abord, ce qui est aussi l'ordre dans
   * lequel on s'attend à le lire.
   */
  async findAllForUser(userId: string): Promise<AddressDto[]> {
    return this.prisma.favoriteAddress.findMany({
      where: { userId },
      orderBy: { type: 'asc' },
      select: COLONNES_PUBLIQUES,
    });
  }

  /**
   * Enregistre une adresse.
   *
   * ⚠️ LE DOUBLON EST DÉTECTÉ PAR LA BASE, PAS PAR UNE LECTURE PRÉALABLE.
   *
   * Un `findFirst` suivi d'un `create` laisserait une fenêtre entre les deux :
   * deux requêtes simultanées y liraient toutes deux « pas de domicile » et
   * en créeraient deux. La contrainte `@@unique([userId, type])` ferme cette
   * fenêtre — et P2002 la traduit en 409.
   *
   * C'est la même leçon qu'à l'inscription (`P2002` → 409 sur l'email
   * dupliqué) : la base est le seul endroit où l'unicité est vraie.
   */
  async create(userId: string, dto: CreateAddressDto): Promise<AddressDto> {
    try {
      return await this.prisma.favoriteAddress.create({
        data: { ...dto, userId },
        select: COLONNES_PUBLIQUES,
      });
    } catch (erreur) {
      throw this.traduireDoublon(erreur, dto.type);
    }
  }

  /**
   * Modifie une adresse du compte appelant.
   *
   * L'ownership est vérifié AVANT toute écriture, par `findOneForUser` : un
   * `update({ where: { id } })` seul modifierait l'adresse de n'importe qui.
   */
  async update(
    id: string,
    userId: string,
    dto: UpdateAddressDto,
  ): Promise<AddressDto> {
    const existante = await this.findOneForUser(id, userId);

    try {
      return await this.prisma.favoriteAddress.update({
        where: { id },
        data: dto,
        select: COLONNES_PUBLIQUES,
      });
    } catch (erreur) {
      // Changer le type vers un emplacement déjà occupé heurte la même
      // contrainte qu'à la création.
      throw this.traduireDoublon(erreur, dto.type ?? existante.type);
    }
  }

  /**
   * Supprime une adresse du compte appelant.
   *
   * ⚠️ SUPPRESSION PHYSIQUE, et c'est délibéré — à la différence du compte
   * lui-même (5G). Une adresse favorite est un RACCOURCI, pas une trace
   * d'activité : l'usager qui la retire veut qu'elle disparaisse, et rien
   * dans le dossier ne demande d'en conserver l'historique. La conserver
   * logiquement obligerait de surcroît à filtrer `deletedAt` partout, pour
   * ne rendre service à personne.
   */
  async remove(id: string, userId: string): Promise<void> {
    await this.findOneForUser(id, userId);

    await this.prisma.favoriteAddress.delete({ where: { id } });
  }

  /**
   * Retrouve une adresse APPARTENANT à l'appelant, ou lève 404.
   *
   * ⚠️ MÊME RÉPONSE POUR « INEXISTANTE » ET « APPARTIENT À QUELQU'UN
   * D'AUTRE ». Répondre 403 dans le second cas confirmerait à un curieux que
   * l'identifiant existe — une fuite d'information ténue, mais réelle, et
   * gratuite à éviter.
   *
   * C'est exactement la convention de `RoutesService.findOneForUser` (5A-8) ;
   * en changer ici obligerait le frontend à retenir deux règles.
   */
  private async findOneForUser(id: string, userId: string) {
    const adresse = await this.prisma.favoriteAddress.findUnique({
      where: { id },
      select: { ...COLONNES_PUBLIQUES, userId: true },
    });

    if (!adresse || adresse.userId !== userId) {
      throw new NotFoundException(`Adresse ${id} introuvable`);
    }

    return adresse;
  }

  /**
   * Traduit la violation d'unicité de Prisma en 409 lisible.
   *
   * P2002 = contrainte unique violée. Le laisser remonter produirait un 500
   * et une trace interne, là où l'usager a simplement voulu enregistrer un
   * second domicile.
   */
  private traduireDoublon(erreur: unknown, type: string): unknown {
    if (
      erreur instanceof Prisma.PrismaClientKnownRequestError &&
      erreur.code === 'P2002'
    ) {
      const libelle = type === 'HOME' ? 'domicile' : 'travail';

      return new ConflictException(
        `Vous avez déjà une adresse de ${libelle}. Modifiez-la plutôt que d'en créer une seconde.`,
      );
    }

    return erreur;
  }
}
