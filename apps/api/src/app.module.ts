import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AvailabilityModule } from './availability/availability.module';
import { BookingModule } from './booking/booking.module';
import { ClockModule } from './common/clock';
import { ConfigModule, ENV } from './config/config.module';
import type { Env } from './config/env';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          // JSON logs in production (shipped to log storage); readable logs in development.
          transport:
            env.NODE_ENV === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
          // Never log credentials or customer contact details.
          redact: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.body.phone',
            'req.body.email',
          ],
          autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
          // Keep request logs short: method, URL, status, timing; no header dumps.
          serializers: {
            req: (req: { id: unknown; method: string; url: string }) => ({
              id: req.id,
              method: req.method,
              url: req.url,
            }),
            res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
          },
        },
      }),
    }),
    ClockModule,
    DatabaseModule,
    HealthModule,
    AvailabilityModule,
    BookingModule,
  ],
})
export class AppModule {}
