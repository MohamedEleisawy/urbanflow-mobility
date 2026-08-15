import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SegmentsService } from './segments.service';
import { CreateSegmentDto } from './dto/create-segment.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.type';

// Chemin imbriqué : un segment n'existe jamais seul, il fait toujours partie
// d'un itinéraire. L'URL exprime donc cette relation de composition.
//
// Toutes les routes sont protégées : un segment appartient à l'itinéraire
// d'un usager, c'est une donnée personnelle.
@Controller('routes/:routeId/segments')
@UseGuards(JwtAuthGuard)
export class SegmentsController {
  constructor(private readonly segmentsService: SegmentsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param('routeId', ParseUUIDPipe) routeId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateSegmentDto,
  ) {
    return this.segmentsService.create(routeId, user.sub, dto);
  }

  @Get()
  findAll(
    @Param('routeId', ParseUUIDPipe) routeId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.segmentsService.findAllForRoute(routeId, user.sub);
  }

  @Get(':id')
  findOne(
    @Param('routeId', ParseUUIDPipe) routeId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.segmentsService.findOneForRoute(routeId, id, user.sub);
  }
}
