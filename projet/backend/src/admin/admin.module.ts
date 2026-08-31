import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';

// Module d'administration (étape 6-3).
//
// `AuthModule` est importé pour son export `JwtModule`, dont `JwtAuthGuard` a
// besoin — même raison que dans `UsersModule` et `RoutesModule`. Sans lui,
// NestJS ne saurait pas construire le guard et planterait au démarrage.
//
// `PrismaModule` n'a pas à être importé : il est `@Global()`.
@Module({
  // `UsersModule` est importé pour son export `UsersService` : la
  // suppression logique n'a qu'UNE implémentation (étape 6-4).
  imports: [AuthModule, UsersModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
