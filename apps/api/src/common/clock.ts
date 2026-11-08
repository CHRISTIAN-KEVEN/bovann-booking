import { Global, Module } from '@nestjs/common';

/**
 * The only source of "now" in the API. Injected instead of calling `new Date()`
 * so time-dependent rules (lead time, holds, horizon) can be tested at a fixed instant.
 */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('CLOCK');

export const systemClock: Clock = { now: () => new Date() };

@Global()
@Module({
  providers: [{ provide: CLOCK, useValue: systemClock }],
  exports: [CLOCK],
})
export class ClockModule {}
