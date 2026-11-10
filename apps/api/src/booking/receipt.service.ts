import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { CLOCK, type Clock } from '../common/clock';
import { ApiError } from '../common/errors';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { DB } from '../database/database.module';
import type { Database } from '../database/schema';
import { loadReceiptData, renderReceiptPdf } from './receipt';
import { currentLocale } from '../common/request-context';

@Injectable()
export class ReceiptService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** The customer's receipt as a PDF. Only for confirmed bookings. */
  async pdf(bookingId: number): Promise<{ reference: string; pdf: Buffer }> {
    const data = await loadReceiptData(this.db, bookingId);
    if (data.status !== 'CONFIRMED') {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'RECEIPT_NOT_AVAILABLE',
        'Le reçu est disponible une fois la réservation confirmée.',
      );
    }
    const pdf = await renderReceiptPdf(data, {
      webUrl: this.env.PUBLIC_WEB_URL.replace(/\/+$/, ''),
      contactPhone: this.env.STUDIO_CONTACT_PHONE,
      issuedAt: this.clock.now(),
      locale: currentLocale(),
    });
    return { reference: data.booking.reference, pdf };
  }
}
