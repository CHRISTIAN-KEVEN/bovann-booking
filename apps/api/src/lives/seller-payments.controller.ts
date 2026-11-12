import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { SellerPaymentDto } from '@bovann/shared';
import { parseId } from '../admin/admin-common';
import { notFound, parseOrThrow } from '../common/errors';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { CurrentSeller, SellerAuthGuard } from '../sellers/seller-auth.guard';
import type { SellerPrincipal } from '../sellers/seller-auth.service';
import { devPaymentFailSchema, sellerPaymentSchema } from './lives.schemas';
import { SellerPaymentsService, type SellerPaymentOutcome } from './seller-payments.service';

/** A seller pays for an approved live or a pass, then follows the payment. */
@Controller('seller/payments')
@UseGuards(SellerAuthGuard)
export class SellerPaymentsController {
  constructor(private readonly payments: SellerPaymentsService) {}

  @Post()
  start(
    @CurrentSeller() seller: SellerPrincipal,
    @Body() body: unknown,
  ): Promise<SellerPaymentDto> {
    return this.payments.start(seller, parseOrThrow(sellerPaymentSchema, body));
  }

  @Get(':id')
  get(
    @CurrentSeller() seller: SellerPrincipal,
    @Param('id') id: string,
  ): Promise<SellerPaymentDto> {
    return this.payments.get(seller.id, parseId(id, 'Paiement'));
  }
}

/**
 * DEVELOPMENT ONLY: decides the outcome of a simulated seller payment, like
 * /dev/payments for bookings. 404 unless PAYMENT_PROVIDER=mock outside production.
 */
@Controller('dev/seller-payments')
export class DevSellerPaymentsController {
  constructor(
    private readonly payments: SellerPaymentsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private assertEnabled(): void {
    if (this.env.PAYMENT_PROVIDER !== 'mock' || this.env.NODE_ENV === 'production') {
      throw notFound('NOT_FOUND', 'Ressource introuvable.');
    }
  }

  @Post(':id/succeed')
  @HttpCode(HttpStatus.OK)
  async succeed(@Param('id') id: string): Promise<{ outcome: SellerPaymentOutcome }> {
    this.assertEnabled();
    return { outcome: await this.payments.confirm(parseId(id, 'Paiement')) };
  }

  @Post(':id/fail')
  @HttpCode(HttpStatus.OK)
  async fail(@Param('id') id: string, @Body() body: unknown): Promise<{ outcome: 'FAILED' }> {
    this.assertEnabled();
    const { reason } = parseOrThrow(devPaymentFailSchema, body ?? {});
    await this.payments.fail(parseId(id, 'Paiement'), reason);
    return { outcome: 'FAILED' };
  }
}
