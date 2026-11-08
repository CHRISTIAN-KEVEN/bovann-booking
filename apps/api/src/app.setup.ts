import type { INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import { ApiExceptionFilter } from './common/errors';

/**
 * HTTP pipeline shared by production (main.ts) and the API tests, so tests
 * exercise exactly the same prefix, error format and security headers.
 */
export function configureApp(app: INestApplication, options: { corsOrigins: string[] }): void {
  app.use(helmet());
  app.enableCors({ origin: options.corsOrigins, credentials: true });
  // Business endpoints live under /api/v1; health checks stay at the root for probes.
  app.setGlobalPrefix('api/v1', { exclude: ['health/live', 'health/ready'] });
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
}
