import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { CreateBookingRequest } from '@bovann/shared';
import { configureApp } from '../../src/app.setup';
import { BookingModule } from '../../src/booking/booking.module';
import { CLOCK, ClockModule } from '../../src/common/clock';
import { ConfigModule } from '../../src/config/config.module';
import { DatabaseModule } from '../../src/database/database.module';
import { testDatabaseUrl } from './test-db';

/** A clock the test moves by hand. */
export class TestClock {
  constructor(private current: Date) {}
  now(): Date {
    return new Date(this.current);
  }
  set(iso: string): void {
    this.current = new Date(iso);
  }
  advanceMinutes(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }
}

/** Boots the booking API on the test database, with a controllable clock. */
export async function bookingApp(
  clock: TestClock,
  env: Record<string, string> = {},
): Promise<INestApplication> {
  Object.assign(process.env, {
    DATABASE_URL: testDatabaseUrl(),
    HOLD_EXPIRY_INTERVAL_SEC: '0',
    HOLD_RATE_LIMIT_PER_MIN: '1000',
    LOOKUP_RATE_LIMIT_PER_MIN: '1000',
    ...env,
  });
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule, ClockModule, DatabaseModule, BookingModule],
  })
    .overrideProvider(CLOCK)
    .useValue(clock)
    .compile();
  const app = moduleRef.createNestApplication();
  configureApp(app, { corsOrigins: [], trustProxyHops: 1 });
  await app.init();
  return app;
}

let phoneCounter = 0;

/** A unique valid Togolese number per call, so tests don't share customers by accident. */
export function newPhone(): string {
  phoneCounter += 1;
  return `+2289${String(1_000_000 + phoneCounter).slice(1)}0`;
}

export function holdRequest(
  overrides: Partial<CreateBookingRequest> & { phone?: string } = {},
): CreateBookingRequest {
  const phone = overrides.phone ?? newPhone();
  return {
    spaceSlug: 'studio-principal-lome',
    mode: 'IN_PERSON',
    selection: { type: 'SLOTS', slotStarts: ['2026-11-16T08:00:00.000Z'] },
    customer: {
      fullName: 'Afi Mensah',
      phone,
      email: 'afi@example.test',
      businessName: 'Boutique Afi Mode',
      businessSector: 'Mode & beauté',
    },
    liveDescription: 'Présentation de la nouvelle collection',
    acceptTerms: true,
    payment: { method: 'MOBILE_MONEY', channel: 'TMONEY', payerPhone: phone },
    ...overrides,
  };
}
