import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import {
  MOBILE_MONEY_CHANNELS,
  SESSION_MODES,
  type BookingDto,
  type BookingLookupResponse,
  type CreateBookingRequest,
  type CreateBookingResponse,
} from '@bovann/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { badRequest, parseOrThrow } from '../common/errors';
import { BookingHoldService } from './booking-hold.service';
import { BookingLifecycleService } from './booking-lifecycle.service';
import { BookingQueryService } from './booking-query.service';
import { TurnstileService } from './turnstile.service';

const phone = z
  .string({ message: 'Le numéro de téléphone est obligatoire.' })
  .transform((v) => v.replace(/[\s.-]/g, ''))
  .pipe(
    z
      .string()
      .regex(
        /^\+[1-9]\d{6,14}$/,
        'Numéro de téléphone invalide : indiquez l’indicatif, par exemple +228 90 12 34 56.',
      ),
  );
const isoInstant = z.string().datetime({ offset: true, message: 'Horaire invalide.' });
const text = (label: string, max: number) =>
  z
    .string({ message: `${label} est obligatoire.` })
    .trim()
    .min(1, `${label} est obligatoire.`)
    .max(max, `${label} est trop long (${max} caractères maximum).`);

const createBookingSchema = z.object({
  spaceSlug: z.string().regex(/^[a-z0-9-]{1,80}$/, 'Espace invalide.'),
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
    { message: 'Sélection invalide.' },
  ),
  customer: z.object({
    fullName: text('Le nom complet', 120),
    phone,
    email: z
      .string()
      .trim()
      .max(254)
      .email('Adresse e-mail invalide.')
      .transform((v) => v.toLowerCase())
      .nullish()
      .or(z.literal('').transform(() => null)),
    businessName: text('Le nom de l’entreprise', 160),
    businessSector: text('Le secteur d’activité', 80),
  }),
  liveDescription: z
    .string()
    .trim()
    .max(1000, 'Description trop longue (1000 caractères maximum).')
    .nullish(),
  acceptTerms: z.literal(true, { message: 'Vous devez accepter les conditions de réservation.' }),
  payment: z.discriminatedUnion(
    'method',
    [
      z.object({
        method: z.literal('MOBILE_MONEY'),
        channel: z.enum(MOBILE_MONEY_CHANNELS, { message: 'Choisissez T-Money ou Flooz.' }),
        payerPhone: phone,
      }),
      z.object({ method: z.literal('CARD') }),
    ],
    { message: 'Choisissez un moyen de paiement.' },
  ),
  captchaToken: z.string().max(4096).optional(),
});

const referenceSchema = z.string().regex(/^BOV-\d{4}-[0-9A-Z]{5}$/, 'Référence invalide.');

const lookupSchema = z.object({
  reference: z
    .string({ message: 'La référence est obligatoire.' })
    .transform((v) => v.trim().toUpperCase())
    .pipe(referenceSchema),
  phone,
});

/**
 * Customer booking endpoints. The controller only validates and delegates;
 * rules live in the services. "Payer" is rate limited per client connection.
 */
@Controller('bookings')
export class BookingsController {
  constructor(
    private readonly holds: BookingHoldService,
    private readonly lifecycle: BookingLifecycleService,
    private readonly query: BookingQueryService,
    private readonly turnstile: TurnstileService,
  ) {}

  /** "Payer": hold the slots for a few minutes and start the payment. */
  @Post()
  @UseGuards(ThrottlerGuard)
  @SkipThrottle({ lookups: true })
  async create(@Body() body: unknown, @Req() req: Request): Promise<CreateBookingResponse> {
    const input = parseOrThrow(createBookingSchema, body) as CreateBookingRequest;
    await this.turnstile.assertHuman(input.captchaToken, req.ip);
    return this.holds.create(input);
  }

  /** "Mes réservations": find a booking from another device with its reference and phone. */
  @Post('lookup')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @SkipThrottle({ holds: true })
  async lookup(@Body() body: unknown): Promise<BookingLookupResponse> {
    const input = parseOrThrow(lookupSchema, body);
    return this.query.lookup(input.reference, input.phone);
  }

  /** Follow a booking (payment screen polling, confirmation screen). */
  @Get(':reference')
  async get(
    @Param('reference') reference: string,
    @Headers('x-booking-token') token: string | undefined,
  ): Promise<BookingDto> {
    const id = await this.query.idByReferenceAndToken(
      parseOrThrow(referenceSchema, reference),
      token,
    );
    return this.query.byId(id);
  }

  /** The customer gives up before paying: slots are freed immediately. */
  @Post(':reference/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Param('reference') reference: string,
    @Headers('x-booking-token') token: string | undefined,
  ): Promise<BookingDto> {
    if (!token) throw badRequest('TOKEN_REQUIRED', 'Jeton de réservation manquant.');
    const id = await this.query.idByReferenceAndToken(
      parseOrThrow(referenceSchema, reference),
      token,
    );
    await this.lifecycle.cancelByCustomer(id);
    return this.query.byId(id);
  }
}
