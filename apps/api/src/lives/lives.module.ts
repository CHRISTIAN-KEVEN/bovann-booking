import { Module } from '@nestjs/common';
import { MockPaymentGateway } from '../payment/mock-payment.gateway';
import { PAYMENT_GATEWAY } from '../payment/payment-gateway';
import { SellersModule } from '../sellers/sellers.module';
import { LivesController } from './lives.controller';
import { LivesService } from './lives.service';
import { PassesService } from './passes.service';
import { SellerLivesController } from './seller-lives.controller';
import {
  DevSellerPaymentsController,
  SellerPaymentsController,
} from './seller-payments.controller';
import { SellerPaymentsService } from './seller-payments.service';

/**
 * Live directory "En direct": the public wall, sellers' lives, passes and payments
 * (admin routes live in AdminModule).
 */
@Module({
  imports: [SellersModule],
  controllers: [
    LivesController,
    SellerLivesController,
    SellerPaymentsController,
    DevSellerPaymentsController,
  ],
  providers: [
    LivesService,
    PassesService,
    SellerPaymentsService,
    // Phase 4 selects the real provider adapter from PAYMENT_PROVIDER (same as bookings).
    { provide: PAYMENT_GATEWAY, useClass: MockPaymentGateway },
  ],
  exports: [LivesService, PassesService],
})
export class LivesModule {}
