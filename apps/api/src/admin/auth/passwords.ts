import { createHash, randomBytes, randomInt } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { ADMIN_PASSWORD_MIN_LENGTH } from '@bovann/shared';

/**
 * Password hashing with Argon2id (OWASP's first choice), library defaults:
 * 19 MiB memory, 2 iterations, 1 lane. The parameters are stored inside each
 * hash, so they can be raised later without invalidating existing passwords.
 */
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password);
  } catch {
    return false;
  }
}

/**
 * Verifying against this when the email is unknown makes a wrong email take as
 * long as a wrong password, so response times don't reveal which accounts exist.
 */
let dummyHash: Promise<string> | undefined;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hash(randomBytes(16).toString('hex'));
  return dummyHash;
}

/** French reason why a new password is refused, or null when it is acceptable. */
export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < ADMIN_PASSWORD_MIN_LENGTH) {
    return `Le mot de passe doit contenir au moins ${ADMIN_PASSWORD_MIN_LENGTH} caractères.`;
  }
  if (password.length > 200) return 'Le mot de passe est trop long (200 caractères maximum).';
  if (new Set(password).size < 4) return 'Ce mot de passe est trop simple.';
  if (email && password.toLowerCase().includes(email.split('@')[0]!.toLowerCase())) {
    return 'Le mot de passe ne doit pas contenir votre adresse e-mail.';
  }
  return null;
}

/** A temporary password that is easy to read out or type: 4 groups of 4 characters. */
export function generateTemporaryPassword(): string {
  // No 0/O, 1/l/I: avoids misreading when passed on by phone or on paper.
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const groups: string[] = [];
  for (let g = 0; g < 4; g++) {
    let group = '';
    for (let i = 0; i < 4; i++) group += alphabet[randomInt(alphabet.length)];
    groups.push(group);
  }
  return groups.join('-');
}

/** Session tokens: 256 random bits; only their SHA-256 is stored. */
export function generateSessionToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashSessionToken(token) };
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
