import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { ENV } from './config/config.module';
import type { Env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const env = app.get<Env>(ENV);

  app.useLogger(app.get(Logger));
  app.use(helmet());
  app.enableCors({ origin: env.CORS_ORIGINS, credentials: true });
  // Business endpoints live under /api/v1; health checks stay at the root for probes.
  app.setGlobalPrefix('api/v1', { exclude: ['health/live', 'health/ready'] });
  app.enableShutdownHooks();

  await app.listen(env.PORT);
  app.get(Logger).log(`API listening on port ${env.PORT} (${env.NODE_ENV})`);
}

void bootstrap();
