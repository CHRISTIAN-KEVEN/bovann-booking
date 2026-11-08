import { z } from 'zod';

const DEV_FINGERPRINT_SECRET = 'dev-only-fingerprint-secret-not-for-production';

/**
 * Every setting the API reads from the environment, validated once at startup.
 * The process refuses to start with a missing or malformed value, so
 * configuration mistakes surface at deploy time instead of at the first booking.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
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
     * so the real client IP is used for rate limits and abuse rules.
     */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    /** Key for the anonymous client fingerprint (HMAC of the IP). ≥ 32 characters. */
    FINGERPRINT_SECRET: z.string().min(32).default(DEV_FINGERPRINT_SECRET),
    /** Cloudflare Turnstile secret. Unset = bot check disabled (development and tests only). */
    TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
    /** How often unpaid holds past their expiry are released (0 = disabled, for tests). */
    HOLD_EXPIRY_INTERVAL_SEC: z.coerce.number().int().min(0).max(3600).default(30),
    /** "Payer" attempts allowed per client connection per minute. */
    HOLD_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).max(1000).default(5),
    /** Payment provider adapter. "mock" simulates payments (never allowed in production). */
    PAYMENT_PROVIDER: z.enum(['mock']).default('mock'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    if (env.FINGERPRINT_SECRET === DEV_FINGERPRINT_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['FINGERPRINT_SECRET'],
        message: 'must be set to a secret value in production',
      });
    }
    if (!env.TURNSTILE_SECRET_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['TURNSTILE_SECRET_KEY'],
        message: 'is required in production (bot protection)',
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

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
