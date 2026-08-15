import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { RoutesModule } from './routes/routes.module';
import { StopsModule } from './stops/stops.module';
import { SegmentsModule } from './segments/segments.module';

@Module({
  imports: [
    PrismaModule,
    UsersModule,
    AuthModule,
    RoutesModule,
    StopsModule,
    SegmentsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
