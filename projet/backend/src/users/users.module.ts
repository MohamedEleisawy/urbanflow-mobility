import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  // AuthModule est importé pour son export JwtService, dont JwtAuthGuard a
  // besoin pour vérifier les tokens sur la route protégée GET /users/me.
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
  // Exporté depuis l'étape 6-4 : `AdminModule` réutilise
  // `softDeleteAccount`, seule implémentation de la suppression logique.
  exports: [UsersService],
})
export class UsersModule {}
