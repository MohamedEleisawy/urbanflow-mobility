import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

// Échoue immédiatement au démarrage si JWT_SECRET est absent, plutôt que de laisser JwtModule signer silencieusement
// des tokens avec un secret "undefined" (voir CLAUDE.md : jamais de secret en dur, toujours une variable d'environnement).
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  throw new Error(
    'JWT_SECRET manquant. Copiez projet/backend/.env.example vers .env et définissez-le.',
  );
}

@Module({
  imports: [
    JwtModule.register({
      secret: jwtSecret,
      signOptions: { expiresIn: '1h' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  // JwtModule est réexporté pour que JwtService soit injectable dans les
  // autres modules qui protègent leurs routes avec JwtAuthGuard (ex :
  // UsersModule). Sans cet export, NestJS ne saurait pas construire le
  // guard depuis UsersModule et planterait au démarrage.
  exports: [JwtModule],
})
export class AuthModule {}
