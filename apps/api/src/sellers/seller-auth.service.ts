import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { OtpChannel, SellerCodeResponse, SellerMe } from '@bovann/shared';
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import { generateSessionToken, hashSessionToken } from '../admin/auth/passwords';
import { inTransaction } from '../booking/booking-tx';
import { CLOCK, type Clock } from '../common/clock';
import { ApiError } from '../common/errors';
import { currentLocale } from '../common/request-context';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { DB } from '../database/database.module';
import type { Database } from '../database/schema';
import { OTP_SENDER, type OtpSender } from './otp-sender';

/** A code works for 10 minutes… */
export const OTP_TTL_SEC = 10 * 60;
/** …for at most 5 tries. */
export const OTP_MAX_ATTEMPTS = 5;
/** A new code can be asked for after 60 seconds… */
export const OTP_RESEND_SEC = 60;
/** …and at most 5 times per phone per hour. */
export const OTP_MAX_PER_HOUR = 5;
/** A seller stays signed in for 30 days without activity, 90 days at most. */
const SESSION_IDLE_MS = 30 * 86_400_000;
const SESSION_MAX_MS = 90 * 86_400_000;
/** last_seen_at is written at most this often. */
const SEEN_EVERY_MS = 60 * 60_000;

export interface SellerPrincipal {
  id: number;
  phone: string;
  sessionId: number;
}

type VerifyOutcome =
  { ok: true; me: SellerMe; token: string; expiresAt: Date } | { ok: false; error: ApiError };

/**
 * Seller sign-in with a one-time code sent to the phone (no password).
 *
 * Guessing is kept out of reach: 6 digits, 5 tries per code, a new code at most every
 * minute and 5 per hour per phone (plus a limit per connection), so an attacker gets
 * about 25 guesses an hour out of a million. Codes are stored as an HMAC with a server
 * key, so a database leak doesn't reveal them. The same answer is given whether the
 * phone is known or not: accounts are created at the first successful sign-in.
 */
@Injectable()
export class SellerAuthService {
  private readonly logger = new Logger(SellerAuthService.name);
  private readonly key: Buffer;

  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(OTP_SENDER) private readonly sender: OtpSender,
    @Inject(ENV) env: Env,
  ) {
    // Without a configured key (development, tests), a random one per process:
    // codes simply stop working after a restart.
    this.key = env.OTP_SECRET ? Buffer.from(env.OTP_SECRET) : randomBytes(32);
  }

  get available(): boolean {
    return this.sender.enabled;
  }

  async requestCode(phone: string, channel: OtpChannel): Promise<SellerCodeResponse> {
    if (!this.sender.enabled) throw unavailable();
    const locale = currentLocale();
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');

    const refusal = await inTransaction(this.db, async (trx) => {
      // One request at a time per phone, so two quick taps can't both pass the limits.
      await sql`SELECT GET_LOCK(${`otp:${phone}`}, 5)`.execute(trx);
      try {
        const now = this.clock.now();
        const recent = await trx
          .selectFrom('t_seller_otps')
          .select(['created_at'])
          .where('phone_e164', '=', phone)
          .where('created_at', '>', new Date(now.getTime() - 3_600_000))
          .orderBy('created_at', 'desc')
          .execute();
        const last = recent[0];
        if (last) {
          const wait =
            OTP_RESEND_SEC - Math.floor((now.getTime() - last.created_at.getTime()) / 1000);
          if (wait > 0) return tooSoon(wait);
        }
        if (recent.length >= OTP_MAX_PER_HOUR) {
          const oldest = recent[recent.length - 1]!.created_at.getTime();
          const minutes = Math.max(1, Math.ceil((oldest + 3_600_000 - now.getTime()) / 60_000));
          return tooMany(minutes);
        }
        await trx
          .insertInto('t_seller_otps')
          .values({
            phone_e164: phone,
            channel,
            code_hash: this.hash(phone, code),
            expires_at: new Date(now.getTime() + OTP_TTL_SEC * 1000),
            created_at: now,
          })
          .execute();
        return null;
      } finally {
        await sql`SELECT RELEASE_LOCK(${`otp:${phone}`})`.execute(trx);
      }
    });
    if (refusal) throw refusal;

    try {
      await this.sender.send({ phone, channel, code, locale });
    } catch (error) {
      this.logger.error(`Sign-in code not sent (${channel}): ${(error as Error).message}`);
      throw new ApiError(
        HttpStatus.BAD_GATEWAY,
        'OTP_SEND_FAILED',
        'Le code n’a pas pu être envoyé. Réessayez dans un instant.',
      );
    }

    return {
      phone,
      channel,
      expiresInSec: OTP_TTL_SEC,
      resendInSec: OTP_RESEND_SEC,
      ...(this.sender.simulated ? { devCode: code } : {}),
    };
  }

  /** Checks the code; on success the seller exists (created if new) and a session is open. */
  async verify(
    phone: string,
    code: string,
    meta: { userAgent: string | null },
  ): Promise<{ me: SellerMe; token: string; expiresAt: Date }> {
    if (!this.sender.enabled) throw unavailable();
    const locale = currentLocale();
    // Wrong tries must be counted even though the request fails, so the transaction
    // returns its outcome and the error is thrown after it commits.
    const outcome = await inTransaction(this.db, async (trx): Promise<VerifyOutcome> => {
      const now = this.clock.now();
      const otp = await trx
        .selectFrom('t_seller_otps')
        .select(['id', 'code_hash', 'attempts', 'expires_at', 'consumed_at'])
        .where('phone_e164', '=', phone)
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .limit(1)
        .forUpdate()
        .executeTakeFirst();
      if (!otp || otp.consumed_at || otp.expires_at <= now || otp.attempts >= OTP_MAX_ATTEMPTS) {
        return { ok: false, error: expired() };
      }
      if (!this.matches(otp.code_hash, phone, code)) {
        const attempts = otp.attempts + 1;
        await trx.updateTable('t_seller_otps').set({ attempts }).where('id', '=', otp.id).execute();
        const left = OTP_MAX_ATTEMPTS - attempts;
        return { ok: false, error: left > 0 ? wrongCode(left) : tooManyTries() };
      }
      await trx
        .updateTable('t_seller_otps')
        .set({ consumed_at: now })
        .where('id', '=', otp.id)
        .execute();

      await trx
        .insertInto('t_sellers')
        .values({ phone_e164: phone, locale, last_sign_in_at: now })
        .onDuplicateKeyUpdate({ last_sign_in_at: now, locale })
        .execute();
      const seller = await trx
        .selectFrom('t_sellers')
        .select(['id', 'phone_e164', 'blocked_at'])
        .where('phone_e164', '=', phone)
        .executeTakeFirstOrThrow();
      if (seller.blocked_at) return { ok: false, error: blocked() };

      const session = generateSessionToken();
      const expiresAt = new Date(now.getTime() + SESSION_MAX_MS);
      await trx
        .insertInto('t_seller_sessions')
        .values({
          seller_id: seller.id,
          token_hash: session.hash,
          created_at: now,
          last_seen_at: now,
          expires_at: expiresAt,
          user_agent: meta.userAgent?.slice(0, 255) ?? null,
        })
        .execute();
      return {
        ok: true,
        me: { id: seller.id, phone: seller.phone_e164 },
        token: session.token,
        expiresAt,
      };
    });
    if (!outcome.ok) throw outcome.error;
    return outcome;
  }

  /** Resolves a cookie token to its seller, or null when the session is no longer valid. */
  async authenticate(token: string): Promise<SellerPrincipal | null> {
    const now = this.clock.now();
    const row = await this.db
      .selectFrom('t_seller_sessions as s')
      .innerJoin('t_sellers as u', 'u.id', 's.seller_id')
      .select(['s.id as session_id', 's.last_seen_at', 'u.id', 'u.phone_e164'])
      .where('s.token_hash', '=', hashSessionToken(token))
      .where('s.revoked_at', 'is', null)
      .where('s.expires_at', '>', now)
      .where('s.last_seen_at', '>', new Date(now.getTime() - SESSION_IDLE_MS))
      .where('u.blocked_at', 'is', null)
      .executeTakeFirst();
    if (!row) return null;
    if (now.getTime() - row.last_seen_at.getTime() > SEEN_EVERY_MS) {
      await this.db
        .updateTable('t_seller_sessions')
        .set({ last_seen_at: now })
        .where('id', '=', row.session_id)
        .execute();
    }
    return { id: row.id, phone: row.phone_e164, sessionId: row.session_id };
  }

  async logout(sessionId: number): Promise<void> {
    await this.db
      .updateTable('t_seller_sessions')
      .set({ revoked_at: this.clock.now() })
      .where('id', '=', sessionId)
      .where('revoked_at', 'is', null)
      .execute();
  }

  private hash(phone: string, code: string): string {
    return createHmac('sha256', this.key).update(`${phone}:${code}`).digest('hex');
  }

  private matches(stored: string, phone: string, code: string): boolean {
    const a = Buffer.from(stored, 'hex');
    const b = Buffer.from(this.hash(phone, code), 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }
}

const unavailable = () =>
  new ApiError(
    HttpStatus.SERVICE_UNAVAILABLE,
    'OTP_UNAVAILABLE',
    'La connexion des vendeurs n’est pas encore ouverte. Revenez bientôt.',
  );

const tooSoon = (seconds: number) =>
  new ApiError(
    HttpStatus.TOO_MANY_REQUESTS,
    'OTP_TOO_SOON',
    {
      fr: `Patientez ${seconds} s avant de demander un nouveau code.`,
      en: `Wait ${seconds} s before asking for a new code.`,
    },
    { retryInSec: seconds },
  );

const tooMany = (minutes: number) =>
  new ApiError(
    HttpStatus.TOO_MANY_REQUESTS,
    'OTP_TOO_MANY',
    {
      fr: `Trop de codes demandés pour ce numéro. Réessayez dans ${minutes} min.`,
      en: `Too many codes asked for this number. Try again in ${minutes} min.`,
    },
    { retryInSec: minutes * 60 },
  );

const expired = () =>
  new ApiError(
    HttpStatus.BAD_REQUEST,
    'OTP_EXPIRED',
    'Ce code ne marche plus. Demandez un nouveau code.',
  );

const wrongCode = (left: number) =>
  new ApiError(
    HttpStatus.BAD_REQUEST,
    'OTP_INVALID',
    {
      fr: left > 1 ? `Code incorrect. Encore ${left} essais.` : 'Code incorrect. Dernier essai.',
      en: left > 1 ? `Wrong code. ${left} tries left.` : 'Wrong code. Last try.',
    },
    { attemptsLeft: left },
  );

const tooManyTries = () =>
  new ApiError(HttpStatus.BAD_REQUEST, 'OTP_EXPIRED', 'Trop d’essais. Demandez un nouveau code.');

const blocked = () =>
  new ApiError(
    HttpStatus.FORBIDDEN,
    'SELLER_BLOCKED',
    'Ce numéro ne peut plus publier de lives. Contactez le studio.',
  );
