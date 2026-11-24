import { otpTransport } from '../sellers/otp-sender';
import { loadEnv, simulationsAllowed } from './env';

describe('loadEnv', () => {
  const base = { DATABASE_URL: 'mysql://u:p@localhost:3306/db' };

  it('applies defaults for optional settings', () => {
    const env = loadEnv(base);
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3001,
      LOG_LEVEL: 'info',
      DATABASE_POOL_SIZE: 10,
      CORS_ORIGINS: ['http://localhost:3000'],
    });
  });

  it('treats empty values as not set, so their defaults apply', () => {
    const env = loadEnv({ ...base, STUDIO_CONTACT_PHONE: '', PORT: '', TURNSTILE_SECRET_KEY: ' ' });
    expect(env.STUDIO_CONTACT_PHONE).toBeUndefined();
    expect(env.TURNSTILE_SECRET_KEY).toBeUndefined();
    expect(env.PORT).toBe(3001);
  });

  it('parses a comma-separated CORS list', () => {
    const env = loadEnv({ ...base, CORS_ORIGINS: 'https://bovann.tg, https://admin.bovann.tg' });
    expect(env.CORS_ORIGINS).toEqual(['https://bovann.tg', 'https://admin.bovann.tg']);
  });

  it('refuses to start without a database URL', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
  });

  it('refuses a non-MySQL database URL', () => {
    expect(() => loadEnv({ DATABASE_URL: 'postgres://x' })).toThrow(/mysql:\/\//);
  });

  it('refuses an invalid port', () => {
    expect(() => loadEnv({ ...base, PORT: '99999' })).toThrow(/PORT/);
  });

  it('refuses to run production with the mock payment provider', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' })).toThrow(/PAYMENT_PROVIDER/);
  });

  it('requires a host and a sender to send emails by SMTP', () => {
    expect(() => loadEnv({ ...base, EMAIL_TRANSPORT: 'smtp' })).toThrow(/SMTP_HOST/);
    expect(() =>
      loadEnv({ ...base, EMAIL_TRANSPORT: 'smtp', SMTP_HOST: 'smtp.gmail.com' }),
    ).toThrow(/EMAIL_FROM/);
    expect(() =>
      loadEnv({
        ...base,
        EMAIL_TRANSPORT: 'smtp',
        SMTP_HOST: 'smtp.gmail.com',
        EMAIL_FROM: 'Bovann <a@b.tg>',
        SMTP_USER: 'a@b.tg',
      }),
    ).toThrow(/SMTP_USER and SMTP_PASSWORD/);
    const env = loadEnv({
      ...base,
      EMAIL_TRANSPORT: 'smtp',
      SMTP_HOST: 'smtp.gmail.com',
      SMTP_PORT: '465',
      SMTP_SECURE: 'true',
      EMAIL_FROM: 'Bovann <a@b.tg>',
    });
    expect(env).toMatchObject({ SMTP_PORT: 465, SMTP_SECURE: true });
  });

  it('never sends simulated sign-in codes in production, and closes seller sign-in by default', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', OTP_TRANSPORT: 'simulated' })).toThrow(
      /OTP_TRANSPORT/,
    );
    expect(otpTransport(loadEnv(base))).toBe('simulated');
    expect(otpTransport({ ...loadEnv(base), NODE_ENV: 'production' })).toBe('disabled');
  });

  it('refuses to run production without sending emails', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' })).toThrow(/EMAIL_TRANSPORT/);
  });

  describe('staging', () => {
    const staging = {
      ...base,
      NODE_ENV: 'production',
      DEPLOY_ENV: 'staging',
      EMAIL_TRANSPORT: 'smtp',
      SMTP_HOST: 'mailpit',
      EMAIL_FROM: 'Bovann OCD Live <staging@example.com>',
      PUBLIC_WEB_URL: 'https://staging.example.com',
    };

    it('allows simulated payments and sign-in codes on staging only', () => {
      const env = loadEnv({ ...staging, OTP_TRANSPORT: 'simulated' });
      expect(env).toMatchObject({ PAYMENT_PROVIDER: 'mock', DEPLOY_ENV: 'staging' });
      expect(simulationsAllowed(env)).toBe(true);
      expect(otpTransport(env)).toBe('simulated');
    });

    it('treats a production build without DEPLOY_ENV as production', () => {
      const { DEPLOY_ENV: _unused, ...production } = staging;
      expect(() => loadEnv(production)).toThrow(/PAYMENT_PROVIDER/);
      expect(() => loadEnv({ ...staging, DEPLOY_ENV: 'production' })).toThrow(/PAYMENT_PROVIDER/);
      expect(simulationsAllowed({ NODE_ENV: 'production', DEPLOY_ENV: undefined })).toBe(false);
      expect(simulationsAllowed({ NODE_ENV: 'production', DEPLOY_ENV: 'production' })).toBe(false);
      expect(simulationsAllowed({ NODE_ENV: 'development', DEPLOY_ENV: undefined })).toBe(true);
    });

    it('still requires emails and HTTPS on staging', () => {
      expect(() => loadEnv({ ...staging, EMAIL_TRANSPORT: 'disabled' })).toThrow(/EMAIL_TRANSPORT/);
      expect(() => loadEnv({ ...staging, PUBLIC_WEB_URL: 'http://staging.example.com' })).toThrow(
        /PUBLIC_WEB_URL/,
      );
    });

    it('refuses an unknown deployment name', () => {
      expect(() => loadEnv({ ...staging, DEPLOY_ENV: 'demo' })).toThrow(/DEPLOY_ENV/);
    });
  });
});
