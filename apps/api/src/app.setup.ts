import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { ApiExceptionFilter } from './common/errors';
import { requestContextMiddleware } from './common/request-context';

/**
 * HTTP pipeline shared by production (main.ts) and the API tests, so tests
 * exercise exactly the same prefix, error format and security headers.
 */
export function configureApp(
  app: INestApplication,
  options: { corsOrigins: string[]; trustProxyHops?: number },
): void {
  // Behind the VPS reverse proxy, use the real client IP (request rate limit).
  if (options.trustProxyHops)
    app.getHttpAdapter().getInstance().set('trust proxy', options.trustProxyHops);
  app.use(helmet());
  // Admin sessions travel in an httpOnly cookie.
  app.use(cookieParser());
  // The language each request asks for (Accept-Language), for messages and names.
  app.use(requestContextMiddleware);
  app.enableCors({ origin: options.corsOrigins, credentials: true });
  // Business endpoints live under /api/v1; health checks stay at the root for probes.
  app.setGlobalPrefix('api/v1', { exclude: ['health/live', 'health/ready'] });
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
}
