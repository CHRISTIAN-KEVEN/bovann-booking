import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { SellerPaymentCreate, SellerPaymentDto, SellerPaymentPurpose } from '@bovann/shared';
import type { Kysely } from 'kysely';
import { paymentIdempotencyKey } from '../booking/domain/identifiers';
import { inTransaction } from '../booking/booking-tx';
import { CLOCK, type Clock } from '../common/clock';
import { ApiError, notFound } from '../common/errors';
import { DB } from '../database/database.module';
import type { Database } from '../database/schema';
import { PAYMENT_GATEWAY, type PaymentGateway } from '../payment/payment-gateway';
import { PassesService } from './passes.service';

export type SellerPaymentOutcome = 'SUCCEEDED' | 'ALREADY_DONE';

/**
 * Sellers' payments for a pass (needed to post lives).
 * Same provider contract as bookings; the simulated provider is used until Phase 4, its
 * outcome decided with the development endpoints.
 */
@Injectable()
export class SellerPaymentsService {
  private readonly logger = new Logger(SellerPaymentsService.name);

  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly passes: PassesService,
  ) {}

  async start(
    seller: { id: number; phone: string },
    input: SellerPaymentCreate,
  ): Promise<SellerPaymentDto> {
    const idempotencyKey = paymentIdempotencyKey();
    const created = await inTransaction(this.db, async (trx) => {
      const now = this.clock.now();
      // A new attempt replaces the seller's unfinished one.
      await trx
        .updateTable('t_seller_payments')
        .set({ status: 'CANCELLED', completed_at: now, failure_reason: 'SUPERSEDED' })
        .where('seller_id', '=', seller.id)
        .where('status', '=', 'PENDING')
        .execute();

      const prices = await this.passes.prices(trx);
      const amount = amountFor(input.purpose, prices);
      const inserted = await trx
        .insertInto('t_seller_payments')
        .values({
          seller_id: seller.id,
          purpose: input.purpose,
          amount_xof: amount,
          method: input.method,
          channel: input.method === 'MOBILE_MONEY' ? input.channel : null,
          payer_phone: input.method === 'MOBILE_MONEY' ? input.payerPhone : null,
          provider: this.gateway.name,
          idempotency_key: idempotencyKey,
          created_at: now,
        })
        .executeTakeFirstOrThrow();
      return { id: Number(inserted.insertId), amount };
    });

    // Never hold database locks during a call to the provider.
    try {
      const started = await this.gateway.initiate({
        paymentId: created.id,
        idempotencyKey,
        amountXof: created.amount,
        method: input.method,
        channel: input.method === 'MOBILE_MONEY' ? input.channel : null,
        payerPhone: input.method === 'MOBILE_MONEY' ? input.payerPhone : null,
        bookingReference: `LIVE-PAY-${created.id}`,
        description: describe(input.purpose),
        customer: { fullName: seller.phone, email: null, phone: seller.phone },
      });
      await this.db
        .updateTable('t_seller_payments')
        .set({ provider_ref: started.providerRef, instructions: started.instructions })
        .where('id', '=', created.id)
        .execute();
    } catch (error) {
      this.logger.error(`Seller payment ${created.id} could not start: ${String(error)}`);
      await this.fail(created.id, 'INIT_FAILED');
      throw new ApiError(
        HttpStatus.BAD_GATEWAY,
        'PAYMENT_PROVIDER_UNAVAILABLE',
        'Le service de paiement ne répond pas. Réessayez dans un instant.',
      );
    }
    return this.get(seller.id, created.id);
  }

  async get(sellerId: number, id: number): Promise<SellerPaymentDto> {
    const row = await this.db
      .selectFrom('t_seller_payments')
      .selectAll()
      .where('id', '=', id)
      .where('seller_id', '=', sellerId)
      .executeTakeFirst();
    if (!row) throw notFound('PAYMENT_NOT_FOUND', 'Ce paiement est introuvable.');
    return {
      id: row.id,
      purpose: row.purpose,
      amountXof: row.amount_xof,
      method: row.method,
      channel: row.channel,
      status: row.status,
      instructions: row.instructions,
      failureReason: row.failure_reason,
      createdAt: row.created_at.toISOString(),
    };
  }

  /**
   * The provider confirmed the payment (simulated: the development endpoint). Idempotent:
   * a payment is settled once, and adds the pass.
   */
  async confirm(id: number): Promise<SellerPaymentOutcome> {
    return inTransaction(this.db, async (trx) => {
      const now = this.clock.now();
      const payment = await trx
        .selectFrom('t_seller_payments')
        .select(['id', 'seller_id', 'purpose', 'amount_xof', 'status'])
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!payment) throw notFound('PAYMENT_NOT_FOUND', 'Ce paiement est introuvable.');
      if (payment.status === 'SUCCEEDED') return 'ALREADY_DONE';
      // A payment the seller replaced or that failed can still be confirmed by the provider:
      // the money arrived, so it is honoured.
      await trx
        .updateTable('t_seller_payments')
        .set({ status: 'SUCCEEDED', completed_at: now, failure_reason: null })
        .where('id', '=', id)
        .execute();
      await this.passes.addPass(
        trx,
        payment.seller_id,
        payment.purpose === 'PASS_MONTH' ? 'MONTH' : 'YEAR',
        now,
        { paymentId: payment.id, priceXof: payment.amount_xof },
      );
      return 'SUCCEEDED';
    });
  }

  async fail(id: number, reason: string): Promise<void> {
    const now = this.clock.now();
    const result = await this.db
      .updateTable('t_seller_payments')
      .set({ status: 'FAILED', completed_at: now, failure_reason: reason.slice(0, 255) })
      .where('id', '=', id)
      .where('status', '=', 'PENDING')
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) {
      const exists = await this.db
        .selectFrom('t_seller_payments')
        .select('id')
        .where('id', '=', id)
        .executeTakeFirst();
      if (!exists) throw notFound('PAYMENT_NOT_FOUND', 'Ce paiement est introuvable.');
    }
  }
}

function amountFor(
  purpose: SellerPaymentPurpose,
  prices: { passMonthXof: number; passYearXof: number },
): number {
  return purpose === 'PASS_MONTH' ? prices.passMonthXof : prices.passYearXof;
}

function describe(purpose: SellerPaymentPurpose): string {
  return purpose === 'PASS_MONTH'
    ? 'OCD Live — pass mensuel (30 jours)'
    : 'OCD Live — pass annuel (365 jours)';
}
