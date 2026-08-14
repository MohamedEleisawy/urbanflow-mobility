import { Module } from '@nestjs/common';
import { RoutesController } from './routes.controller';
import { RoutesService } from './routes.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  // AuthModule est importé pour son export JwtService, dont JwtAuthGuard a
  // besoin pour vérifier les tokens (même raison que dans UsersModule).
  imports: [AuthModule],
  controllers: [RoutesController],
  providers: [RoutesService],
})
export class RoutesModule {}
