import { loadEnv } from './env';

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

  it('refuses to run production without sending emails', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' })).toThrow(/EMAIL_TRANSPORT/);
  });
});
