import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import type {
  AdminLiveDto,
  AdminLiveListResponse,
  AdminReviewHours,
  AdminSellerDto,
  LiveCategoryDto,
  LivePrices,
} from '@bovann/shared';
import { parseOrThrow } from '../common/errors';
import {
  adminLiveListSchema,
  liveCreateSchema,
  liveRejectSchema,
  livePricesSchema,
  liveRemoveSchema,
  passGrantSchema,
  reviewHoursSchema,
} from '../lives/lives.schemas';
import { LivesService } from '../lives/lives.service';
import { PassesService } from '../lives/passes.service';
import { parseId } from './admin-common';
import { AdminAuthGuard, CurrentAdmin, Roles } from './auth/admin-auth.guard';
import type { AdminPrincipal } from './auth/admin-auth.service';

/**
 * Lives: staff (both roles) review sellers' requests, list lives for sellers and take them
 * down. Review hours are changed by administrators.
 */
@Controller('admin')
@UseGuards(AdminAuthGuard)
export class AdminLivesController {
  constructor(
    private readonly lives: LivesService,
    private readonly passes: PassesService,
  ) {}

  @Get('live-prices')
  prices(): Promise<LivePrices> {
    return this.passes.prices();
  }

  @Put('live-prices')
  @Roles('OWNER')
  setPrices(@Body() body: unknown, @CurrentAdmin() admin: AdminPrincipal): Promise<LivePrices> {
    return this.passes.setPrices(parseOrThrow(livePricesSchema, body ?? {}), admin);
  }

  @Get('sellers')
  sellers(): Promise<AdminSellerDto[]> {
    return this.passes.sellers();
  }

  /** Activates a pass after the seller paid in cash or another way (both roles). */
  @Post('sellers/:id/pass')
  @HttpCode(HttpStatus.OK)
  grantPass(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminSellerDto> {
    const { plan, note } = parseOrThrow(passGrantSchema, body ?? {});
    return this.passes.grant(parseId(id, 'Vendeur'), plan, note, admin);
  }

  /** For the menu counter (polled by the admin). */
  @Get('lives/pending-count')
  async pendingCount(): Promise<{ count: number }> {
    return { count: await this.lives.pendingCount() };
  }

  @Post('lives/:id/approve')
  @HttpCode(HttpStatus.OK)
  approve(@Param('id') id: string, @CurrentAdmin() admin: AdminPrincipal): Promise<AdminLiveDto> {
    return this.lives.approve(parseId(id, 'Live'), admin);
  }

  @Post('lives/:id/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminLiveDto> {
    const { reason } = parseOrThrow(liveRejectSchema, body ?? {});
    return this.lives.reject(parseId(id, 'Live'), reason, admin);
  }

  @Get('review-hours')
  async reviewHours(): Promise<AdminReviewHours> {
    return { periods: await this.lives.reviewPeriods() };
  }

  @Put('review-hours')
  @Roles('OWNER')
  async setReviewHours(
    @Body() body: unknown,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminReviewHours> {
    const { periods } = parseOrThrow(reviewHoursSchema, body ?? {});
    return { periods: await this.lives.setReviewPeriods(periods, admin) };
  }

  @Get('lives')
  list(@Query() query: unknown): Promise<AdminLiveListResponse> {
    return this.lives.adminList(parseOrThrow(adminLiveListSchema, query).tab);
  }

  @Get('lives/categories')
  categories(): Promise<LiveCategoryDto[]> {
    return this.lives.categories();
  }

  @Post('lives')
  create(@Body() body: unknown, @CurrentAdmin() admin: AdminPrincipal): Promise<AdminLiveDto> {
    return this.lives.create(parseOrThrow(liveCreateSchema, body), admin);
  }

  @Post('lives/:id/remove')
  remove(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminLiveDto> {
    const { reason } = parseOrThrow(liveRemoveSchema, body ?? {});
    return this.lives.remove(parseId(id, 'Live'), reason, admin);
  }
}
