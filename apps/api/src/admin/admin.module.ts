import { Module } from '@nestjs/common';
import { AvailabilityModule } from '../availability/availability.module';
import { BookingModule } from '../booking/booking.module';
import { AdminBookingsController } from './admin-bookings.controller';
import { AdminBookingsService } from './admin-bookings.service';
import { AdminCatalogService } from './admin-catalog.service';
import { AdminReportsController, AdminUsersController } from './admin-people.controller';
import { AdminReportsService } from './admin-reports.service';
import { AdminScheduleService } from './admin-schedule.service';
import { AdminSettingsService } from './admin-settings.service';
import { AdminSpacesController } from './admin-spaces.controller';
import { AdminUsersService } from './admin-users.service';
import { AdminAuthController } from './auth/admin-auth.controller';
import { AdminAuthGuard } from './auth/admin-auth.guard';
import { AdminAuthService } from './auth/admin-auth.service';
import { LoginRateLimiter } from './auth/login-rate-limiter';

/** Everything under /api/v1/admin: sign-in, planning, bookings, catalog, settings, accounts. */
@Module({
  imports: [AvailabilityModule, BookingModule],
  controllers: [
    AdminAuthController,
    AdminBookingsController,
    AdminSpacesController,
    AdminReportsController,
    AdminUsersController,
  ],
  providers: [
    AdminAuthService,
    AdminAuthGuard,
    LoginRateLimiter,
    AdminBookingsService,
    AdminScheduleService,
    AdminSettingsService,
    AdminCatalogService,
    AdminUsersService,
    AdminReportsService,
  ],
})
export class AdminModule {}
