import { z } from 'zod';

/**
 * Every setting the API reads from the environment, validated once at startup.
 * The process refuses to start with a missing or malformed value, so
 * configuration mistakes surface at deploy time instead of at the first booking.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    /**
     * Which deployment a production build runs as. `staging` keeps production behaviour (Secure
     * cookies, JSON logs, no database reset) but allows the simulated payment provider and
     * simulated sign-in codes, so the client can try every flow. Unset = production: the safe default.
     */
    DEPLOY_ENV: z.enum(['staging', 'production']).optional(),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    DATABASE_URL: z
      .string()
      .regex(/^mysql:\/\//, 'DATABASE_URL must be a mysql:// connection string'),
    DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
    /** Comma-separated list of browser origins allowed to call the API. */
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:3000')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
    /**
     * Number of reverse proxies in front of the API (Caddy/Nginx on the VPS = 1),
     * so the real client IP is used for the request rate limit.
     */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    /** Cloudflare Turnstile secret. Optional: unset = bot check disabled. */
    TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
    /** How often unpaid holds past their expiry are released (0 = disabled, for tests). */
    HOLD_EXPIRY_INTERVAL_SEC: z.coerce.number().int().min(0).max(3600).default(30),
    /** "Payer" attempts allowed per client connection per minute. */
    HOLD_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).max(1000).default(5),
    /** "Mes réservations" lookups (reference + phone) per minute per connection. */
    LOOKUP_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).max(1000).default(10),
    /** Admin sign-in attempts allowed per client connection per minute (on top of account lockout). */
    ADMIN_LOGIN_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).max(1000).default(10),
    /**
     * Send the admin session cookie only over HTTPS. Defaults to on in production;
     * turn off only for a local production build served over plain HTTP.
     */
    ADMIN_COOKIE_SECURE: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === 'true')),
    /**
     * How emails leave: `smtp` (Gmail, Brevo, Mailpit in development…) or
     * `disabled` (emails stay queued, nothing is sent: tests, or no provider yet).
     */
    EMAIL_TRANSPORT: z.enum(['smtp', 'disabled']).default('disabled'),
    SMTP_HOST: z.string().min(1).optional(),
    /** 587 with STARTTLS (default) or 465 with SMTP_SECURE=true. */
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    SMTP_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    SMTP_USER: z.string().min(1).optional(),
    /** For Gmail: an App Password (16 characters), never the account password. */
    SMTP_PASSWORD: z.string().min(1).optional(),
    /** Sender shown to recipients, e.g. "Bovann OCD Live <reservations@example.com>". */
    EMAIL_FROM: z.string().min(3).optional(),
    /** Where replies go (optional; defaults to the sender). */
    EMAIL_REPLY_TO: z.string().email().optional(),
    /** Public address of the website, for links in emails (e.g. https://reservation.bovann.tg). */
    PUBLIC_WEB_URL: z.string().url().default('http://localhost:3000'),
    /** Phone number shown to customers in their emails (optional). */
    STUDIO_CONTACT_PHONE: z.string().min(3).optional(),
    /** How often queued emails are sent, in seconds (0 = worker off). */
    NOTIFICATION_INTERVAL_SEC: z.coerce.number().int().min(0).max(3600).default(15),
    /**
     * How seller sign-in codes are sent: `simulated` (development: the code is logged and shown
     * on the sign-in screen), `disabled` (seller sign-in is closed: no provider yet).
     * WhatsApp/SMS providers are added here once Bovann chooses one.
     * Default: simulated in development and tests, disabled in production.
     */
    OTP_TRANSPORT: z.enum(['simulated', 'disabled']).optional(),
    /** Key for hashing sign-in codes (32+ characters). Required in production when codes are sent. */
    OTP_SECRET: z.string().min(32).optional(),
    /** Sign-in codes one connection may ask for per hour (on top of 5 per phone per hour). */
    OTP_RATE_LIMIT_PER_HOUR: z.coerce.number().int().min(1).max(10_000).default(20),
    /** Payment provider adapter. "mock" simulates payments (never allowed in production). */
    PAYMENT_PROVIDER: z.enum(['mock']).default('mock'),
  })
  .superRefine((env, ctx) => {
    if (env.EMAIL_TRANSPORT === 'smtp') {
      if (!env.SMTP_HOST) {
        ctx.addIssue({
          code: 'custom',
          path: ['SMTP_HOST'],
          message: 'required when EMAIL_TRANSPORT=smtp',
        });
      }
      if (!env.EMAIL_FROM) {
        ctx.addIssue({
          code: 'custom',
          path: ['EMAIL_FROM'],
          message: 'required when EMAIL_TRANSPORT=smtp',
        });
      }
      if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASSWORD)) {
        ctx.addIssue({
          code: 'custom',
          path: ['SMTP_PASSWORD'],
          message: 'SMTP_USER and SMTP_PASSWORD go together',
        });
      }
    }
    if (env.NODE_ENV !== 'production') return;
    if (env.DEPLOY_ENV === 'staging' && env.PUBLIC_WEB_URL.startsWith('http://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['PUBLIC_WEB_URL'],
        message: 'staging is served over HTTPS (the session cookies are Secure)',
      });
    }
    if (env.EMAIL_TRANSPORT !== 'smtp') {
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_TRANSPORT'],
        message: 'production must send emails (owners are notified of every booking)',
      });
    }
    if (env.DEPLOY_ENV === 'staging') return;
    if (env.OTP_TRANSPORT === 'simulated') {
      ctx.addIssue({
        code: 'custom',
        path: ['OTP_TRANSPORT'],
        message: 'simulated sign-in codes are not allowed in production',
      });
    }
    if (env.OTP_TRANSPORT && env.OTP_TRANSPORT !== 'disabled' && !env.OTP_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['OTP_SECRET'],
        message: 'required in production when sign-in codes are sent',
      });
    }
    if (env.PAYMENT_PROVIDER === 'mock') {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYMENT_PROVIDER'],
        message: 'the mock provider is not allowed in production',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Whether simulated payments and sign-in codes may be used: always outside production builds,
 * and in a production build only when it runs as staging.
 */
export function simulationsAllowed(env: Pick<Env, 'NODE_ENV' | 'DEPLOY_ENV'>): boolean {
  return env.NODE_ENV !== 'production' || env.DEPLOY_ENV === 'staging';
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // An empty value (`KEY=` in a .env file or a Compose file) means "not set", so the default
  // applies instead of a confusing "too short" error.
  const defined = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value.trim() !== ''),
  );
  const parsed = envSchema.safeParse(defined);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
