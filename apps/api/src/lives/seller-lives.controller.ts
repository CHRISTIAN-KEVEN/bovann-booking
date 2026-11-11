import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { SellerLiveDto, SellerLivesResponse } from '@bovann/shared';
import { parseId } from '../admin/admin-common';
import { parseOrThrow } from '../common/errors';
import { CurrentSeller, SellerAuthGuard } from '../sellers/seller-auth.guard';
import type { SellerPrincipal } from '../sellers/seller-auth.service';
import { liveCreateSchema } from './lives.schemas';
import { LivesService } from './lives.service';

/** A signed-in seller's lives: post one (it goes to staff review), follow it, end it. */
@Controller('seller/lives')
@UseGuards(SellerAuthGuard)
export class SellerLivesController {
  constructor(private readonly lives: LivesService) {}

  /** Their lives of the last 30 days, with review hours and the categories for the form. */
  @Get()
  list(@CurrentSeller() seller: SellerPrincipal): Promise<SellerLivesResponse> {
    return this.lives.sellerLives(seller.id);
  }

  @Post()
  submit(@CurrentSeller() seller: SellerPrincipal, @Body() body: unknown): Promise<SellerLiveDto> {
    return this.lives.submit(seller.id, parseOrThrow(liveCreateSchema, body));
  }

  /** Withdraws a request waiting for review, or takes the live off the wall ("J’ai terminé"). */
  @Post(':id/end')
  @HttpCode(HttpStatus.OK)
  end(@CurrentSeller() seller: SellerPrincipal, @Param('id') id: string): Promise<SellerLiveDto> {
    return this.lives.sellerEnd(seller.id, parseId(id, 'Live'));
  }
}
