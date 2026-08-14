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
})
export class UsersModule {}
