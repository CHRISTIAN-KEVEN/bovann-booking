import { createHash, createHmac, randomBytes, randomInt } from 'node:crypto';

/** Crockford base32 without I, L, O, U: no characters customers can confuse when reading aloud. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Booking reference shown to customers and owners: BOV-YYMM-XXXXX
 * (local year and month, then 5 random characters: 33 million combinations per month).
 * Uniqueness is guaranteed by the database; the caller retries on a collision.
 */
export function generateReference(localDate: string): string {
  const yymm = localDate.slice(2, 4) + localDate.slice(5, 7);
  let suffix = '';
  for (let i = 0; i < 5; i++) suffix += ALPHABET[randomInt(ALPHABET.length)];
  return `BOV-${yymm}-${suffix}`;
}

/**
 * Secret token handed to the customer's browser to follow or cancel the booking.
 * Only its SHA-256 hash is stored, so a database leak does not expose live tokens.
 */
export function generateAccessToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashAccessToken(token) };
}

export function hashAccessToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Anonymous, stable identifier of a client connection: HMAC-SHA256 of the IP
 * address with a server secret. The IP itself is never stored, and the value
 * can't be reversed or compared across installations.
 */
export function clientFingerprint(ip: string, secret: string): string {
  return createHmac('sha256', secret).update(ip.trim().toLowerCase()).digest('hex');
}

/** Idempotency key sent to the payment provider for one payment attempt. */
export function paymentIdempotencyKey(): string {
  return randomBytes(16).toString('hex');
}
