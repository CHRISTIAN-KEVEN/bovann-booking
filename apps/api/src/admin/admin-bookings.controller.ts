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
  PAYMENT_METHODS,
  SESSION_MODES,
  type AdminBookingDetail,
  type AdminBookingListResponse,
} from '@bovann/shared';
import { z } from 'zod';
import { parseOrThrow } from '../common/errors';
import {
  optionalEmailSchema,
  optionalText,
  parseId,
  phoneSchema,
  requiredText,
  localDateSchema,
} from './admin-common';
import { AdminBookingsService } from './admin-bookings.service';
import { AdminAuthGuard, CurrentAdmin, Roles } from './auth/admin-auth.guard';
import type { AdminPrincipal } from './auth/admin-auth.service';

const isoInstant = z.string().datetime({ offset: true, message: 'Horaire invalide.' });
const amount = z.number().int('Montant invalide.').min(0, 'Montant invalide.').max(100_000_000);

const listSchema = z.object({
  spaceId: z.coerce.number().int().positive().optional(),
  tab: z
    .enum(['ALL', 'CONFIRMED', 'PENDING', 'CANCELLED', 'UNPAID', 'REFUND_DUE', 'ABANDONED'])
    .default('ALL'),
  q: z.string().max(100).optional(),
  when: z.enum(['upcoming', 'past', 'all']).default('all'),
  from: localDateSchema.optional(),
  to: localDateSchema.optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const paymentMethod = z.enum(PAYMENT_METHODS, { message: 'Moyen de paiement invalide.' });

const createSchema = z.object({
  spaceId: z.number().int().positive(),
  mode: z.enum(SESSION_MODES, { message: 'Choisissez « En studio » ou « Virtuel ».' }),
  selection: z.discriminatedUnion(
    'type',
    [
      z.object({
        type: z.literal('SLOTS'),
        slotStarts: z.array(isoInstant).min(1, 'Choisissez au moins un créneau.').max(20),
      }),
      z.object({
        type: z.literal('PACKAGE'),
        packageCode: z.string().min(1).max(40),
        start: isoInstant,
      }),
    ],
    { message: 'Choisissez des créneaux ou un forfait.' },
  ),
  customer: z.object({
    fullName: requiredText('Le nom complet', 120),
    phone: phoneSchema,
    email: optionalEmailSchema,
    businessName: requiredText('Le nom de l’entreprise', 160),
    businessSector: requiredText('Le secteur d’activité', 80),
  }),
  liveDescription: optionalText(1000),
  adminNote: optionalText(1000),
  totalXof: amount.optional(),
  payment: z.discriminatedUnion(
    'status',
    [
      z.object({
        status: z.literal('PAID'),
        method: paymentMethod,
        channel: optionalText(40),
        note: optionalText(255),
      }),
      z.object({ status: z.literal('UNPAID') }),
    ],
    { message: 'Indiquez si la réservation est payée.' },
  ),
});

const recordPaymentSchema = z.object({
  method: paymentMethod,
  channel: optionalText(40),
  note: optionalText(255),
});

const cancelSchema = z.object({
  reason: requiredText('Le motif d’annulation', 255),
  refundAmountXof: amount.optional(),
});

const refundSchema = z.object({ note: optionalText(255) });
const noteSchema = z.object({ adminNote: optionalText(1000) });

@Controller('admin')
@UseGuards(AdminAuthGuard)
export class AdminBookingsController {
  constructor(private readonly bookings: AdminBookingsService) {}

  @Get('bookings')
  list(@Query() query: unknown): Promise<AdminBookingListResponse> {
    return this.bookings.list(parseOrThrow(listSchema, query));
  }

  @Post('bookings')
  create(
    @Body() body: unknown,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminBookingDetail> {
    return this.bookings.create(parseOrThrow(createSchema, body), admin);
  }

  @Get('bookings/:id')
  detail(
    @Param('id') id: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminBookingDetail> {
    return this.bookings.detail(parseId(id, 'Réservation'), admin);
  }

  @Patch('bookings/:id/note')
  note(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminBookingDetail> {
    const input = parseOrThrow(noteSchema, body);
    return this.bookings.updateNote(parseId(id, 'Réservation'), input.adminNote, admin);
  }

  @Post('bookings/:id/payments')
  @HttpCode(HttpStatus.OK)
  recordPayment(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminBookingDetail> {
    return this.bookings.recordPayment(
      parseId(id, 'Réservation'),
      parseOrThrow(recordPaymentSchema, body),
      admin,
    );
  }

  @Post('bookings/:id/cancel')
  @Roles('OWNER')
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminBookingDetail> {
    return this.bookings.cancel(
      parseId(id, 'Réservation'),
      parseOrThrow(cancelSchema, body),
      admin,
    );
  }

  @Post('bookings/:id/refund')
  @Roles('OWNER')
  @HttpCode(HttpStatus.OK)
  markRefunded(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminBookingDetail> {
    return this.bookings.markRefunded(
      parseId(id, 'Réservation'),
      parseOrThrow(refundSchema, body),
      admin,
    );
  }
}
