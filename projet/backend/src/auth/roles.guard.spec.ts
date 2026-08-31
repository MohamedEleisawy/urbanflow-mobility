import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleEnum } from '@prisma/client';
import { CLE_ROLES, Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';
import { AuthenticatedRequest, JwtPayload } from './jwt-payload.type';

// =============================================================================
// Contrôle d'accès par rôle (étape 6-1)
// =============================================================================
// Un VRAI `Reflector`, comme `jwt-auth.guard.spec.ts` emploie un vrai
// `JwtService` : c'est le mécanisme de metadata de NestJS qu'on veut éprouver,
// et un `Reflector` simulé ne prouverait que la simulation.
// =============================================================================

/// Fabrique un contexte HTTP dont le handler porte — ou non — un `@Roles`.
function contexte(
  utilisateur?: JwtPayload,
  rolesDeclares?: RoleEnum[],
): ExecutionContext {
  // Une vraie classe décorée : c'est ainsi que la metadata existe réellement,
  // plutôt que d'être posée à la main.
  class ControleurDeTest {
    methode(this: void) {}
  }

  if (rolesDeclares) {
    Roles(...rolesDeclares)(
      ControleurDeTest.prototype,
      'methode',
      Object.getOwnPropertyDescriptor(ControleurDeTest.prototype, 'methode')!,
    );
  }

  const request = { user: utilisateur } as AuthenticatedRequest;

  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ControleurDeTest.prototype.methode,
    getClass: () => ControleurDeTest,
  } as unknown as ExecutionContext;
}

const usager = (role: string): JwtPayload => ({
  sub: 'user-1',
  email: 'lena@example.com',
  role,
});

describe('RolesGuard', () => {
  let guard: RolesGuard;

  beforeEach(() => {
    guard = new RolesGuard(new Reflector());
  });

  // ---------------------------------------------------------------------------
  // Sans exigence déclarée
  // ---------------------------------------------------------------------------
  describe('route sans @Roles', () => {
    it('LAISSE PASSER, sans rien exiger', () => {
      // Ce guard n'est pas une autorisation par défaut : une route sans
      // `@Roles` garde exactement le comportement qu'elle avait avant
      // l'étape 6-1. C'est ce qui rend son ajout sûr sur un contrôleur
      // existant.
      expect(guard.canActivate(contexte(usager(RoleEnum.USER)))).toBe(true);
    });

    it('laisse passer même SANS usager du tout', () => {
      // Aucune exigence à vérifier : il n'y a aucune raison de refuser.
      expect(guard.canActivate(contexte(undefined))).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Avec @Roles(ADMIN)
  // ---------------------------------------------------------------------------
  describe('route réservée aux administrateurs', () => {
    it('ACCEPTE un ADMIN', () => {
      expect(
        guard.canActivate(contexte(usager(RoleEnum.ADMIN), [RoleEnum.ADMIN])),
      ).toBe(true);
    });

    it('REFUSE un USER en 403', () => {
      // 403 et non 401 : on sait parfaitement QUI demande, et la réponse est
      // « non ». Répondre 401 lui dirait de se reconnecter, ce qui n'y
      // changerait rien.
      expect(() =>
        guard.canActivate(contexte(usager(RoleEnum.USER), [RoleEnum.ADMIN])),
      ).toThrow(ForbiddenException);
    });

    it('REFUSE un rôle inconnu', () => {
      // Un jeton ancien, ou forgé avec un rôle qui n'existe plus : la liste
      // est une liste d'AUTORISATION, tout ce qui n'y figure pas est refusé.
      expect(() =>
        guard.canActivate(contexte(usager('SUPERVISEUR'), [RoleEnum.ADMIN])),
      ).toThrow(ForbiddenException);
    });

    it('REFUSE un rôle vide', () => {
      expect(() =>
        guard.canActivate(contexte(usager(''), [RoleEnum.ADMIN])),
      ).toThrow(ForbiddenException);
    });

    it("refuse en 401 quand AUCUN usager n'est attaché", () => {
      // Ce serait un `RolesGuard` employé sans `JwtAuthGuard`, ou placé avant
      // lui. Sans jeton validé, on ignore QUI demande : on ne peut donc pas
      // dire que c'est interdit à cette personne-là.
      expect(() =>
        guard.canActivate(contexte(undefined, [RoleEnum.ADMIN])),
      ).toThrow(UnauthorizedException);
    });

    it('porte un message qui DIT pourquoi', () => {
      expect(() =>
        guard.canActivate(contexte(usager(RoleEnum.USER), [RoleEnum.ADMIN])),
      ).toThrow(/réservée aux administrateurs/i);
    });
  });

  // ---------------------------------------------------------------------------
  // Plusieurs rôles
  // ---------------------------------------------------------------------------
  describe('plusieurs rôles autorisés', () => {
    it('accepte CHACUN des rôles déclarés', () => {
      const declares = [RoleEnum.ADMIN, RoleEnum.USER];

      expect(
        guard.canActivate(contexte(usager(RoleEnum.ADMIN), declares)),
      ).toBe(true);
      expect(guard.canActivate(contexte(usager(RoleEnum.USER), declares))).toBe(
        true,
      );
    });

    it("refuse ce qui n'est dans AUCUN", () => {
      expect(() =>
        guard.canActivate(
          contexte(usager('INVITE'), [RoleEnum.ADMIN, RoleEnum.USER]),
        ),
      ).toThrow(ForbiddenException);
    });
  });

  // ---------------------------------------------------------------------------
  // Ce qu'il ne fait PAS
  // ---------------------------------------------------------------------------
  describe('périmètre', () => {
    it('NE VÉRIFIE AUCUNE signature de jeton', () => {
      // Le guard n'a qu'une dépendance : `Reflector`. Ni `JwtService`, ni
      // `PrismaService`. Il ne peut donc PAS revalider un jeton, ni consulter
      // la base — c'est le travail de `JwtAuthGuard`, déjà fait en amont.
      expect(RolesGuard.length).toBe(1);
    });

    it('est DÉTERMINISTE : même entrée, même réponse', () => {
      const c = () => contexte(usager(RoleEnum.ADMIN), [RoleEnum.ADMIN]);

      expect(guard.canActivate(c())).toBe(true);
      expect(guard.canActivate(c())).toBe(true);
      expect(guard.canActivate(c())).toBe(true);
    });

    it('ne MODIFIE pas la requête', () => {
      const utilisateur = usager(RoleEnum.ADMIN);
      const ctx = contexte(utilisateur, [RoleEnum.ADMIN]);

      guard.canActivate(ctx);

      // Le guard décide, il ne transforme rien : `@CurrentUser()` doit
      // retrouver exactement ce que `JwtAuthGuard` a déposé.
      const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
      expect(request.user).toEqual(utilisateur);
    });
  });
});

// =============================================================================
describe('@Roles', () => {
  it('attache les rôles sous la clé attendue', () => {
    class Controleur {
      methode(this: void) {}
    }
    Roles(RoleEnum.ADMIN)(
      Controleur.prototype,
      'methode',
      Object.getOwnPropertyDescriptor(Controleur.prototype, 'methode')!,
    );

    // La clé est exportée précisément pour que le guard et ce test lisent la
    // MÊME : une chaîne recopiée des deux côtés finirait par diverger.
    expect(
      new Reflector().get(CLE_ROLES, Controleur.prototype.methode),
    ).toEqual([RoleEnum.ADMIN]);
  });

  it('accepte PLUSIEURS rôles', () => {
    class Controleur {
      methode(this: void) {}
    }
    Roles(RoleEnum.ADMIN, RoleEnum.USER)(
      Controleur.prototype,
      'methode',
      Object.getOwnPropertyDescriptor(Controleur.prototype, 'methode')!,
    );

    expect(
      new Reflector().get(CLE_ROLES, Controleur.prototype.methode),
    ).toEqual([RoleEnum.ADMIN, RoleEnum.USER]);
  });

  it('ne pose RIEN sur une méthode non décorée', () => {
    class Controleur {
      methode(this: void) {}
    }

    // C'est ce qui garantit qu'une route sans `@Roles` reste ouverte comme
    // avant.
    expect(
      new Reflector().get(CLE_ROLES, Controleur.prototype.methode),
    ).toBeUndefined();
  });
});
