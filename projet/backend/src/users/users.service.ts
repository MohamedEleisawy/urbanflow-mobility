import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { hashPassword } from '../common/crypto/password.util';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateUserDto) {
    const passwordHash = hashPassword(dto.password);

    try {
      const user = await this.prisma.user.create({
        data: {
          email: dto.email,
          passwordHash,
          // Écriture imbriquée : Prisma crée la ligne UserPreferences dans la
          // même requête, uniquement si "preferences" a été fourni.
          preferences: dto.preferences
            ? { create: dto.preferences }
            : undefined,
        },
        include: { preferences: true },
      });

      return this.toPublicUser(user);
    } catch (error) {
      // P2002 = violation de contrainte unique (ici : email déjà utilisé).
      // Sans ce garde-fou, Prisma renverrait une erreur brute et Nest
      // répondrait 500 au lieu d'un 409 explicite pour le client.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          `Un utilisateur avec l'email ${dto.email} existe déjà`,
        );
      }
      throw error;
    }
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { preferences: true },
    });

    if (!user) {
      throw new NotFoundException(`Utilisateur ${id} introuvable`);
    }

    return this.toPublicUser(user);
  }

  // Retire passwordHash avant de renvoyer l'utilisateur au controller.
  private toPublicUser<T extends { passwordHash: string }>(user: T) {
    const { passwordHash: _passwordHash, ...publicUser } = user;
    return publicUser;
  }
}
