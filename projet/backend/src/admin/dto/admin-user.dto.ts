import { RoleEnum } from '@prisma/client';

// Forme des données rendues par GET /api/admin/users (étape 6-3).
//
// Interfaces de SORTIE uniquement, sans class-validator : on ne valide que ce
// qui ENTRE dans l'application. Même convention qu'`alert.dto.ts` (4F-2B) et
// `personal-data-export.dto.ts` (5F).
//
// ═══ CINQ CHAMPS, ET PAS UN DE PLUS ═══
//
// Une liste d'administration sert à REPÉRER un compte, pas à l'inspecter.
// Chaque champ retenu répond à une question qu'un administrateur se pose en
// parcourant la liste :
//
//   id         → désigner ce compte dans une action ultérieure
//   email      → le reconnaître (c'est ainsi qu'un usager s'identifie au support)
//   role       → savoir qui a déjà les droits d'administration
//   createdAt  → distinguer un compte ancien d'une inscription du jour
//   deletedAt  → savoir si le compte est encore utilisable
//
// ═══ CE QUI N'Y FIGURE PAS, ET POURQUOI ═══
//
//   `passwordHash` — jamais, nulle part. Il n'est même pas sélectionné.
//   Les PRÉFÉRENCES — six champs par usager, multipliés par la page entière,
//     pour une information qu'on ne lit pas en parcourant une liste. Elles
//     relèveront d'une future route de détail, si le besoin apparaît.
//   Les COMPTEURS (trajets, empreintes) — chacun coûterait une agrégation par
//     ligne, soit exactement le N+1 que la pagination vient éviter.

/** Un compte, tel qu'un administrateur le voit dans la liste. */
export interface AdminUserDto {
  id: string;
  email: string;
  role: RoleEnum;
  createdAt: Date;
  /**
   * Date de suppression logique, ou `null`.
   *
   * ⚠️ LES COMPTES SUPPRIMÉS SONT INCLUS DANS LA LISTE. Les filtrer
   * donnerait de l'application une image fausse : le dossier confie à
   * l'administrateur la « gestion des utilisateurs », or un compte supprimé
   * occupe toujours son adresse électronique (`email` est `@unique`) et
   * conserve son historique. Le masquer laisserait un administrateur
   * s'étonner qu'une inscription échoue en 409 sur une adresse qu'il ne voit
   * nulle part.
   */
  deletedAt: Date | null;
}

/**
 * Réponse paginée de GET /api/admin/users.
 *
 * MÊME FORME que `GET /api/routes` (étape 4E-4A) : `items`, `page`, `limit`,
 * `total`. Une seconde convention de pagination obligerait chaque appelant à
 * se souvenir de laquelle s'applique où.
 */
export interface AdminUsersPageDto {
  items: AdminUserDto[];
  page: number;
  limit: number;
  /** Nombre TOTAL de comptes, toutes pages confondues. */
  total: number;
}
