import { Body, Controller, HttpCode, HttpStatus, Inject, Param, Post } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import { BookingLifecycleService, type ConfirmOutcome } from '../booking/booking-lifecycle.service';
import { notFound, parseOrThrow } from '../common/errors';
import { ENV } from '../config/config.module';
import { simulationsAllowed, type Env } from '../config/env';
import { DB } from '../database/database.module';
import type { Database } from '../database/schema';

/**
 * DEVELOPMENT ONLY: decides the outcome of a simulated payment.
 * Answers 404 unless PAYMENT_PROVIDER=mock outside production or on staging (and the
 * environment validation forbids the mock provider in production). Replaced by real provider webhooks in Phase 4.
 */
@Controller('dev/payments')
export class DevPaymentsController {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(ENV) private readonly env: Env,
    private readonly lifecycle: BookingLifecycleService,
  ) {}

  /** Behaves as if the route did not exist outside the mock setup. */
  private assertEnabled(): void {
    if (this.env.PAYMENT_PROVIDER !== 'mock' || !simulationsAllowed(this.env)) {
      throw notFound('NOT_FOUND', 'Ressource introuvable.');
    }
  }

  @Post(':reference/succeed')
  @HttpCode(HttpStatus.OK)
  async succeed(@Param('reference') reference: string): Promise<{ outcome: ConfirmOutcome }> {
    this.assertEnabled();
    return {
      outcome: await this.lifecycle.confirmPayment(await this.latestPaymentId(reference), {
        simulated: true,
      }),
    };
  }

  @Post(':reference/fail')
  @HttpCode(HttpStatus.OK)
  async fail(
    @Param('reference') reference: string,
    @Body() body: unknown,
  ): Promise<{ outcome: 'FAILED' }> {
    this.assertEnabled();
    const { reason } = parseOrThrow(
      z.object({ reason: z.string().max(255).default('DECLINED') }),
      body ?? {},
    );
    await this.lifecycle.failPayment(await this.latestPaymentId(reference), reason);
    return { outcome: 'FAILED' };
  }

  private async latestPaymentId(reference: string): Promise<number> {
    const row = await this.db
      .selectFrom('t_payments as p')
      .innerJoin('t_bookings as b', 'b.id', 'p.booking_id')
      .select('p.id')
      .where('b.reference', '=', reference)
      .orderBy('p.id', 'desc')
      .limit(1)
      .executeTakeFirst();
    if (!row) throw notFound('BOOKING_NOT_FOUND', 'Réservation introuvable.');
    return row.id;
  }
}
