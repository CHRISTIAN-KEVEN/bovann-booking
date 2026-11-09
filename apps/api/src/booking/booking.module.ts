import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AvailabilityModule } from '../availability/availability.module';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { DevPaymentsController } from '../payment/dev-payments.controller';
import { MockPaymentGateway } from '../payment/mock-payment.gateway';
import { PAYMENT_GATEWAY } from '../payment/payment-gateway';
import { BookingHoldService } from './booking-hold.service';
import { BookingLifecycleService } from './booking-lifecycle.service';
import { BookingQueryService } from './booking-query.service';
import { BookingsController } from './bookings.controller';
import { HoldExpiryWorker } from './hold-expiry.worker';
import { TurnstileService } from './turnstile.service';

@Module({
  imports: [
    AvailabilityModule,
    ThrottlerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => [
        { name: 'holds', ttl: 60_000, limit: env.HOLD_RATE_LIMIT_PER_MIN },
      ],
    }),
  ],
  controllers: [BookingsController, DevPaymentsController],
  providers: [
    BookingHoldService,
    BookingLifecycleService,
    BookingQueryService,
    TurnstileService,
    HoldExpiryWorker,
    // Phase 4 selects the real provider adapter from PAYMENT_PROVIDER.
    { provide: PAYMENT_GATEWAY, useClass: MockPaymentGateway },
  ],
  exports: [BookingLifecycleService],
})
export class BookingModule {}
