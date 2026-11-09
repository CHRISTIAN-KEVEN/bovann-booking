import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { NotificationSettingsDto } from '@bovann/shared';
import { z } from 'zod';
import { parseOrThrow } from '../common/errors';
import { NotificationService } from '../notification/notification.service';
import { parseId } from './admin-common';
import { auditAdmin } from './admin-audit';
import { AdminAuthGuard, CurrentAdmin, Roles } from './auth/admin-auth.guard';
import type { AdminPrincipal } from './auth/admin-auth.service';
import type { Kysely } from 'kysely';
import { DB } from '../database/database.module';
import type { Database } from '../database/schema';

const testSchema = z.object({
  to: z.string().trim().max(254).email('Adresse e-mail invalide.').optional(),
});

/** Email status, retries and a test send. */
@Controller('admin/notifications')
@UseGuards(AdminAuthGuard)
export class AdminNotificationsController {
  constructor(
    private readonly notifications: NotificationService,
    @Inject(DB) private readonly db: Kysely<Database>,
  ) {}

  @Get('settings')
  settings(): Promise<NotificationSettingsDto> {
    return this.notifications.settings();
  }

  /** Sends a test email to the given address, or to the signed-in admin. */
  @Post('test')
  @Roles('OWNER')
  @HttpCode(HttpStatus.OK)
  async test(
    @Body() body: unknown,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<{ to: string }> {
    const { to } = parseOrThrow(testSchema, body);
    const recipient = to ?? admin.email;
    await this.notifications.sendTest(recipient);
    return { to: recipient };
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.NO_CONTENT)
  async retry(@Param('id') id: string, @CurrentAdmin() admin: AdminPrincipal): Promise<void> {
    const notificationId = parseId(id, 'E-mail');
    await this.notifications.retry(notificationId);
    await auditAdmin(
      this.db,
      admin.id,
      'ADMIN_NOTIFICATION_RETRIED',
      'notification',
      notificationId,
    );
  }
}
