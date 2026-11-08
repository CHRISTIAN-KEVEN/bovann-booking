import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { ENV } from './config/config.module';
import type { Env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const env = app.get<Env>(ENV);

  app.useLogger(app.get(Logger));
  configureApp(app, { corsOrigins: env.CORS_ORIGINS, trustProxyHops: env.TRUST_PROXY_HOPS });

  await app.listen(env.PORT);
  app.get(Logger).log(`API listening on port ${env.PORT} (${env.NODE_ENV})`);
}

void bootstrap();
