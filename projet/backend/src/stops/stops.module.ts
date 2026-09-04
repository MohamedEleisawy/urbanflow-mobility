import { Module } from '@nestjs/common';
import { StopsController } from './stops.controller';
import { StopsService } from './stops.service';
import { AuthModule } from '../auth/auth.module';
import { ScheduleModule } from '../schedule/schedule.module';

@Module({
  // AuthModule fournit JwtService, nécessaire à JwtAuthGuard sur POST /stops.
  // ScheduleModule (war room) : « Autour de moi » joint les prochains
  // passages aux arrêts proches.
  imports: [AuthModule, ScheduleModule],
  controllers: [StopsController],
  providers: [StopsService],
})
export class StopsModule {}
