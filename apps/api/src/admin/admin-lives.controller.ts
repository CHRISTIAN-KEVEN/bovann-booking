import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { AdminLiveDto, AdminLiveListResponse, LiveCategoryDto } from '@bovann/shared';
import { parseOrThrow } from '../common/errors';
import { adminLiveListSchema, liveCreateSchema, liveRemoveSchema } from '../lives/lives.schemas';
import { LivesService } from '../lives/lives.service';
import { parseId } from './admin-common';
import { AdminAuthGuard, CurrentAdmin } from './auth/admin-auth.guard';
import type { AdminPrincipal } from './auth/admin-auth.service';

/** Lives on the wall: staff (both roles) list lives for sellers and take them down. */
@Controller('admin/lives')
@UseGuards(AdminAuthGuard)
export class AdminLivesController {
  constructor(private readonly lives: LivesService) {}

  @Get()
  list(@Query() query: unknown): Promise<AdminLiveListResponse> {
    return this.lives.adminList(parseOrThrow(adminLiveListSchema, query).tab);
  }

  @Get('categories')
  categories(): Promise<LiveCategoryDto[]> {
    return this.lives.categories();
  }

  @Post()
  create(@Body() body: unknown, @CurrentAdmin() admin: AdminPrincipal): Promise<AdminLiveDto> {
    return this.lives.create(parseOrThrow(liveCreateSchema, body), admin);
  }

  @Post(':id/remove')
  remove(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminLiveDto> {
    const { reason } = parseOrThrow(liveRemoveSchema, body ?? {});
    return this.lives.remove(parseId(id, 'Live'), reason, admin);
  }
}
