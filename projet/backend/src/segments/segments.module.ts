import { Module } from '@nestjs/common';
import { SegmentsController } from './segments.controller';
import { SegmentsService } from './segments.service';
import { AuthModule } from '../auth/auth.module';
import { RoutesModule } from '../routes/routes.module';

@Module({
  imports: [
    // JwtService pour JwtAuthGuard.
    AuthModule,
    // RoutesService pour vérifier la propriété de la route parente.
    RoutesModule,
  ],
  controllers: [SegmentsController],
  providers: [SegmentsService],
})
export class SegmentsModule {}
