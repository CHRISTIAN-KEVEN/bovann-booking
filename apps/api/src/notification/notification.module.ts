import { Module } from '@nestjs/common';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { DisabledMailer, MAILER, SmtpMailer, type Mailer } from './mailer';
import { NotificationService } from './notification.service';
import { NotificationWorker } from './notification.worker';

@Module({
  providers: [
    {
      provide: MAILER,
      inject: [ENV],
      useFactory: (env: Env): Mailer =>
        env.EMAIL_TRANSPORT === 'smtp' ? new SmtpMailer(env) : new DisabledMailer(),
    },
    NotificationService,
    NotificationWorker,
  ],
  exports: [NotificationService],
})
export class NotificationModule {}
