import {
  generateSessionToken,
  generateTemporaryPassword,
  hashPassword,
  hashSessionToken,
  passwordProblem,
  verifyPassword,
} from './passwords';

describe('admin passwords', () => {
  it('hashes with Argon2id and verifies', async () => {
    const hash = await hashPassword('un mot de passe solide');
    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(verifyPassword(hash, 'un mot de passe solide')).resolves.toBe(true);
    await expect(verifyPassword(hash, 'un autre')).resolves.toBe(false);
    await expect(verifyPassword('not-a-hash', 'x')).resolves.toBe(false);
  });

  it('explains why a new password is refused', () => {
    expect(passwordProblem('court')).toMatch(/au moins 10/);
    expect(passwordProblem('aaaaaaaaaaaa')).toMatch(/trop simple/);
    expect(passwordProblem('kossi-2026-studio', 'kossi@bovann.tg')).toMatch(/adresse e-mail/);
    expect(passwordProblem('un mot de passe solide', 'kossi@bovann.tg')).toBeNull();
  });

  it('makes readable temporary passwords without look-alike characters', () => {
    for (let i = 0; i < 50; i++) {
      const p = generateTemporaryPassword();
      expect(p).toMatch(/^[a-km-zA-HJ-NP-Z2-9]{4}(-[a-km-zA-HJ-NP-Z2-9]{4}){3}$/);
      expect(p).not.toMatch(/[01lIoO]/);
      expect(passwordProblem(p)).toBeNull();
    }
  });

  it('stores only the hash of session tokens', () => {
    const { token, hash } = generateSessionToken();
    expect(token).toHaveLength(43);
    expect(hash).toBe(hashSessionToken(token));
    expect(hash).not.toContain(token);
  });
});
