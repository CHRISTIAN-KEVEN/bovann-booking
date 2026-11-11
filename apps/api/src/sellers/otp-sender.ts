import { Logger } from '@nestjs/common';
import type { Locale, OtpChannel } from '@bovann/shared';
import type { Env } from '../config/env';

export const OTP_SENDER = Symbol('OTP_SENDER');

export interface OtpMessage {
  phone: string;
  channel: OtpChannel;
  code: string;
  locale: Locale;
}

/**
 * Sends a sign-in code by WhatsApp or SMS. Kept tiny so a real provider (chosen by Bovann)
 * is one new class, and tests can swap in a fake.
 */
export interface OtpSender {
  /** False: seller sign-in is closed (no provider configured). */
  readonly enabled: boolean;
  /** True: the code is not really sent; development shows it on screen instead. */
  readonly simulated: boolean;
  send(message: OtpMessage): Promise<void>;
}

/** Development: writes the code to the log. Refused in production by the settings check. */
export class SimulatedOtpSender implements OtpSender {
  readonly enabled = true;
  readonly simulated = true;
  private readonly logger = new Logger('SimulatedOtpSender');

  send(message: OtpMessage): Promise<void> {
    this.logger.log(
      `Sign-in code for ${message.phone} by ${message.channel}: ${message.code} (simulated, not sent)`,
    );
    return Promise.resolve();
  }
}

/** No provider yet: sign-in answers "not available yet" instead of pretending to send. */
export class DisabledOtpSender implements OtpSender {
  readonly enabled = false;
  readonly simulated = false;

  send(): Promise<void> {
    return Promise.reject(new Error('OTP sending is disabled'));
  }
}

export function otpTransport(env: Env): 'simulated' | 'disabled' {
  return env.OTP_TRANSPORT ?? (env.NODE_ENV === 'production' ? 'disabled' : 'simulated');
}

export function createOtpSender(env: Env): OtpSender {
  return otpTransport(env) === 'simulated' ? new SimulatedOtpSender() : new DisabledOtpSender();
}

/** Text of the message, for real providers (WhatsApp templates must match it). */
export function otpText(code: string, locale: Locale): string {
  return locale === 'en'
    ? `${code} is your OCD Live code. It works for 10 minutes. Never share it.`
    : `${code} est votre code OCD Live. Il est valable 10 minutes. Ne le donnez à personne.`;
}
