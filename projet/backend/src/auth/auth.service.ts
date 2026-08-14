import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { hashPassword, verifyPassword } from '../common/crypto/password.util';
import { JwtPayload } from './jwt-payload.type';

// Hash factice (calculé une seule fois au chargement du module), utilisé
// quand l'email fourni ne correspond à aucun utilisateur. Sans ça, la
// réponse serait plus rapide en l'absence d'utilisateur (pas de calcul
// scrypt), ce qui permettrait de deviner par le temps de réponse qu'un
// email n'existe pas — alors que la consigne est de ne jamais le révéler.
const DUMMY_HASH = hashPassword('mot-de-passe-factice-pour-temps-constant');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: LoginDto) {
    // Accès direct à Prisma (et non via UsersService) : c'est le seul
    // endroit de l'application qui a besoin de lire passwordHash, et
    // UsersService ne le renvoie jamais par conception (voir toPublicUser).
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    const isPasswordValid = verifyPassword(
      dto.password,
      user?.passwordHash ?? DUMMY_HASH,
    );

    if (!user || !isPasswordValid) {
      // Même message et même statut, que l'email existe ou non.
      throw new UnauthorizedException('Email ou mot de passe incorrect');
    }

    // Typé explicitement : JwtAuthGuard relira exactement cette structure
    // lors de la vérification du token (voir jwt-payload.type.ts).
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    };
  }
}
