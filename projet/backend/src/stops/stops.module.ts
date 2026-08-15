import { Module } from '@nestjs/common';
import { StopsController } from './stops.controller';
import { StopsService } from './stops.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  // AuthModule fournit JwtService, nécessaire à JwtAuthGuard sur POST /stops.
  imports: [AuthModule],
  controllers: [StopsController],
  providers: [StopsService],
})
export class StopsModule {}
