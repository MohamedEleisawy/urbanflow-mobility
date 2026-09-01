import { Module } from '@nestjs/common';
import { AddressesController } from './addresses.controller';
import { AddressesService } from './addresses.service';
import { AuthModule } from '../auth/auth.module';

// Adresses favorites (bloc 7).
//
// `AuthModule` est importé pour son export `JwtModule`, dont `JwtAuthGuard` a
// besoin — même raison que dans `UsersModule`, `RoutesModule` et
// `AdminModule`. Sans lui, NestJS ne saurait pas construire le guard et
// planterait au démarrage.
//
// `PrismaModule` n'a pas à être importé : il est `@Global()`.
//
// `AddressesService` est EXPORTÉ : l'export RGPD (`UsersService`) doit lire
// les adresses, et il n'existe qu'une seule façon de les sélectionner.
@Module({
  imports: [AuthModule],
  controllers: [AddressesController],
  providers: [AddressesService],
  exports: [AddressesService],
})
export class AddressesModule {}
