import { SetMetadata } from '@nestjs/common';
import { RoleEnum } from '@prisma/client';

// Décorateur de route qui déclare les rôles autorisés (étape 6-1).
//
//     @Roles(RoleEnum.ADMIN)
//     @UseGuards(JwtAuthGuard, RolesGuard)
//     create(@Body() dto: CreateStopDto) { ... }
//
// ═══ IL NE PROTÈGE RIEN À LUI SEUL ═══
//
// `SetMetadata` ne fait qu'ATTACHER une information à la méthode. C'est
// `RolesGuard` qui la lit et qui décide. Un `@Roles()` posé sans le guard
// correspondant est donc silencieusement inopérant — d'où les tests qui
// vérifient que les deux sont bien présents ensemble sur les routes
// concernées.
//
// ═══ POURQUOI `RoleEnum` ET NON DES CHAÎNES ═══
//
// L'énumération vient de Prisma : c'est la MÊME source que la colonne
// `User.role`. Écrire `@Roles('ADMINISTRATEUR')` ne compilerait pas, alors
// qu'une chaîne libre aurait produit une route que personne ne peut atteindre
// — et le compilateur n'aurait rien vu.

/// Clé de metadata. Exportée pour que le guard lise EXACTEMENT la même, et
/// que le test puisse vérifier ce qui a été posé.
export const CLE_ROLES = 'roles';

/**
 * Réserve une route à un ou plusieurs rôles.
 *
 * Variadique : `@Roles(RoleEnum.ADMIN)` aujourd'hui, `@Roles(RoleEnum.ADMIN,
 * RoleEnum.MODERATEUR)` le jour où un troisième profil existera — sans
 * toucher au guard.
 */
export const Roles = (...roles: RoleEnum[]) => SetMetadata(CLE_ROLES, roles);
