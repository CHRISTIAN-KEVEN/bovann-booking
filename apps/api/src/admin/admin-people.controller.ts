import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ADMIN_ROLES,
  PAYMENT_STATUSES,
  type AdminCustomerDetail,
  type AdminCustomerListResponse,
  type AdminPaymentListResponse,
  type AdminUserDto,
  type CustomerLookupDto,
  type TemporaryPasswordResponse,
} from '@bovann/shared';
import { z } from 'zod';
import { parseOrThrow } from '../common/errors';
import { parseId, phoneSchema, requiredText } from './admin-common';
import { AdminBookingsService } from './admin-bookings.service';
import { AdminReportsService } from './admin-reports.service';
import { AdminUsersService } from './admin-users.service';
import { AdminAuthGuard, CurrentAdmin, Roles } from './auth/admin-auth.guard';
import type { AdminPrincipal } from './auth/admin-auth.service';

const pageSchema = {
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
};
const customersSchema = z.object({ q: z.string().max(100).optional(), ...pageSchema });
const paymentsSchema = z.object({
  status: z.enum(PAYMENT_STATUSES).optional(),
  spaceId: z.coerce.number().int().positive().optional(),
  ...pageSchema,
});

const lookupSchema = z.object({ phone: phoneSchema });

const role = z.enum(ADMIN_ROLES, { message: 'Rôle invalide.' });
const userCreateSchema = z.object({
  email: z
    .string()
    .trim()
    .max(254)
    .email('Adresse e-mail invalide.')
    .transform((v) => v.toLowerCase()),
  fullName: requiredText('Le nom', 120),
  role,
});
const userUpdateSchema = z
  .object({ fullName: requiredText('Le nom', 120), role, isActive: z.boolean() })
  .partial()
  .strict();

/** Clients and payments (all admins, read-only). */
@Controller('admin')
@UseGuards(AdminAuthGuard)
export class AdminReportsController {
  constructor(
    private readonly reports: AdminReportsService,
    private readonly bookings: AdminBookingsService,
  ) {}

  /** Pre-fills the studio booking form when the phone number is already known. */
  @Get('customers/lookup')
  async lookup(@Query() query: unknown): Promise<{ customer: CustomerLookupDto | null }> {
    const { phone } = parseOrThrow(lookupSchema, query);
    return { customer: await this.bookings.lookupCustomer(phone) };
  }

  @Get('customers')
  customers(@Query() query: unknown): Promise<AdminCustomerListResponse> {
    const { q, page, pageSize } = parseOrThrow(customersSchema, query);
    return this.reports.customers(q, page, pageSize);
  }

  @Get('customers/:id')
  customer(@Param('id') id: string): Promise<AdminCustomerDetail> {
    return this.reports.customer(parseId(id, 'Client'));
  }

  @Get('payments')
  payments(@Query() query: unknown): Promise<AdminPaymentListResponse> {
    const { status, spaceId, page, pageSize } = parseOrThrow(paymentsSchema, query);
    return this.reports.payments(status, spaceId, page, pageSize);
  }
}

/** Admin accounts: administrators only. */
@Controller('admin/users')
@UseGuards(AdminAuthGuard)
@Roles('OWNER')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  list(): Promise<AdminUserDto[]> {
    return this.users.list();
  }

  @Post()
  create(
    @Body() body: unknown,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<TemporaryPasswordResponse> {
    return this.users.create(parseOrThrow(userCreateSchema, body), admin);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminUserDto> {
    return this.users.update(parseId(id, 'Compte'), parseOrThrow(userUpdateSchema, body), admin);
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(
    @Param('id') id: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<TemporaryPasswordResponse> {
    return this.users.resetPassword(parseId(id, 'Compte'), admin);
  }
}
