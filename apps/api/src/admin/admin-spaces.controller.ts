import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  SESSION_MODES,
  type AdminDashboardStats,
  type AdminDayOptionsResponse,
  type AdminPackagesResponse,
  type AdminSpaceDto,
  type ClosureDto,
  type OpeningHoursDayDto,
  type OwnerRecipientDto,
  type ScheduleResponse,
} from '@bovann/shared';
import { z } from 'zod';
import { parseOrThrow } from '../common/errors';
import { AdminBookingsService } from './admin-bookings.service';
import { AdminCatalogService } from './admin-catalog.service';
import {
  localDateSchema,
  localTimeSchema,
  optionalText,
  parseId,
  requiredText,
} from './admin-common';
import { AdminScheduleService } from './admin-schedule.service';
import { AdminSettingsService } from './admin-settings.service';
import { AdminAuthGuard, CurrentAdmin, Roles } from './auth/admin-auth.guard';
import type { AdminPrincipal } from './auth/admin-auth.service';

const spaceCreateSchema = z.object({
  name: requiredText('Le nom de l’espace', 120),
  nameEn: optionalText(120),
  address: optionalText(255),
  inPersonEnabled: z.boolean(),
  virtualEnabled: z.boolean(),
});

const spaceUpdateSchema = z
  .object({
    name: requiredText('Le nom de l’espace', 120),
    nameEn: optionalText(120),
    address: optionalText(255),
    minLeadMin: z
      .number()
      .int()
      .min(0, 'Délai invalide.')
      .max(10_080, 'Délai trop long (7 jours maximum).'),
    horizonDays: z
      .number()
      .int()
      .min(1, 'Période invalide.')
      .max(730, 'Période trop longue (2 ans maximum).'),
    holdDurationMin: z
      .number()
      .int()
      .min(2, 'Le délai de paiement doit être d’au moins 2 minutes.')
      .max(15, 'Le délai de paiement ne peut pas dépasser 15 minutes.'),
    fewSlotsThreshold: z.number().int().min(0).max(50),
    inPersonEnabled: z.boolean(),
    virtualEnabled: z.boolean(),
    isActive: z.boolean(),
  })
  .partial()
  .strict();

const scheduleSchema = z.object({
  from: localDateSchema,
  days: z.coerce.number().int().min(1).max(42).default(1),
});

const dayOptionsSchema = z.object({
  date: localDateSchema,
  mode: z.enum(SESSION_MODES, { message: 'Mode invalide.' }),
});

const blockSchema = z.object({
  slotStarts: z
    .array(z.string().datetime({ offset: true, message: 'Horaire invalide.' }))
    .min(1, 'Choisissez au moins un créneau.')
    .max(200),
  reason: requiredText('Le motif', 255),
});

const openingHoursSchema = z.object({
  days: z
    .array(
      z.object({
        weekday: z.number().int().min(1).max(7),
        isOpen: z.boolean(),
        opensAt: localTimeSchema,
        closesAt: localTimeSchema,
      }),
    )
    .length(7, 'Indiquez les horaires des 7 jours de la semaine.'),
});

const closureSchema = z.object({
  startDate: localDateSchema,
  endDate: localDateSchema,
  startTime: localTimeSchema.optional(),
  endTime: localTimeSchema.optional(),
  reason: optionalText(255),
});

const recipientSchema = z.object({
  email: z
    .string()
    .trim()
    .max(254)
    .email('Adresse e-mail invalide.')
    .transform((v) => v.toLowerCase()),
  name: optionalText(120),
});
const recipientUpdateSchema = z.object({ isActive: z.boolean() });

const price = z
  .number()
  .int('Le prix doit être un nombre entier de FCFA.')
  .min(100, 'Prix trop bas (100 FCFA minimum).')
  .max(100_000_000, 'Prix trop élevé.')
  .nullable();
const pricesSchema = z.object({ IN_PERSON: price.optional(), VIRTUAL: price.optional() }).strict();
const packageCreateSchema = z.object({
  name: requiredText('Le nom du forfait', 120),
  nameEn: optionalText(120),
  description: optionalText(255),
  isFullDay: z.boolean().optional(),
  slotCount: z.number().int().min(1).max(20).nullish(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
  prices: pricesSchema,
});
const packageUpdateSchema = packageCreateSchema.partial().strict();

@Controller('admin')
@UseGuards(AdminAuthGuard)
export class AdminSpacesController {
  constructor(
    private readonly settings: AdminSettingsService,
    private readonly schedule: AdminScheduleService,
    private readonly catalog: AdminCatalogService,
    private readonly bookings: AdminBookingsService,
  ) {}

  // ------------------------------------------------------------------ spaces

  @Get('spaces')
  listSpaces(): Promise<AdminSpaceDto[]> {
    return this.settings.listSpaces();
  }

  @Post('spaces')
  @Roles('OWNER')
  createSpace(
    @Body() body: unknown,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminSpaceDto> {
    return this.settings.createSpace(parseOrThrow(spaceCreateSchema, body), admin);
  }

  @Get('spaces/:id')
  getSpace(@Param('id') id: string): Promise<AdminSpaceDto> {
    return this.settings.getSpace(parseId(id, 'Espace'));
  }

  @Patch('spaces/:id')
  @Roles('OWNER')
  updateSpace(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminSpaceDto> {
    return this.settings.updateSpace(
      parseId(id, 'Espace'),
      parseOrThrow(spaceUpdateSchema, body),
      admin,
    );
  }

  // ------------------------------------------------------------------ planning

  @Get('spaces/:id/stats')
  stats(@Param('id') id: string): Promise<AdminDashboardStats> {
    return this.schedule.stats(parseId(id, 'Espace'));
  }

  @Get('spaces/:id/schedule')
  getSchedule(@Param('id') id: string, @Query() query: unknown): Promise<ScheduleResponse> {
    const { from, days } = parseOrThrow(scheduleSchema, query);
    return this.schedule.schedule(parseId(id, 'Espace'), from, days);
  }

  @Get('spaces/:id/day-options')
  dayOptions(@Param('id') id: string, @Query() query: unknown): Promise<AdminDayOptionsResponse> {
    const { date, mode } = parseOrThrow(dayOptionsSchema, query);
    return this.bookings.dayOptions(parseId(id, 'Espace'), date, mode);
  }

  @Post('spaces/:id/blocks')
  createBlock(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<{ id: number }> {
    return this.schedule.createBlock(parseId(id, 'Espace'), parseOrThrow(blockSchema, body), admin);
  }

  @Delete('blocks/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteBlock(@Param('id') id: string, @CurrentAdmin() admin: AdminPrincipal): Promise<void> {
    return this.schedule.deleteBlock(parseId(id, 'Blocage'), admin);
  }

  // ------------------------------------------------------------------ hours & closures

  @Get('spaces/:id/opening-hours')
  openingHours(@Param('id') id: string): Promise<OpeningHoursDayDto[]> {
    return this.settings.openingHours(parseId(id, 'Espace'));
  }

  @Put('spaces/:id/opening-hours')
  @Roles('OWNER')
  updateOpeningHours(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<OpeningHoursDayDto[]> {
    return this.settings.updateOpeningHours(
      parseId(id, 'Espace'),
      parseOrThrow(openingHoursSchema, body),
      admin,
    );
  }

  @Get('spaces/:id/closures')
  closures(@Param('id') id: string): Promise<ClosureDto[]> {
    return this.settings.closures(parseId(id, 'Espace'));
  }

  @Post('spaces/:id/closures')
  @Roles('OWNER')
  createClosure(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<ClosureDto> {
    return this.settings.createClosure(
      parseId(id, 'Espace'),
      parseOrThrow(closureSchema, body),
      admin,
    );
  }

  @Delete('closures/:id')
  @Roles('OWNER')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteClosure(@Param('id') id: string, @CurrentAdmin() admin: AdminPrincipal): Promise<void> {
    return this.settings.deleteClosure(parseId(id, 'Fermeture'), admin);
  }

  // ------------------------------------------------------------------ owner emails

  @Get('spaces/:id/recipients')
  @Roles('OWNER')
  recipients(@Param('id') id: string): Promise<OwnerRecipientDto[]> {
    return this.settings.recipients(parseId(id, 'Espace'));
  }

  @Post('spaces/:id/recipients')
  @Roles('OWNER')
  addRecipient(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<OwnerRecipientDto[]> {
    return this.settings.addRecipient(
      parseId(id, 'Espace'),
      parseOrThrow(recipientSchema, body),
      admin,
    );
  }

  @Patch('recipients/:id')
  @Roles('OWNER')
  updateRecipient(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<OwnerRecipientDto[]> {
    const { isActive } = parseOrThrow(recipientUpdateSchema, body);
    return this.settings.updateRecipient(parseId(id, 'Adresse'), isActive, admin);
  }

  @Delete('recipients/:id')
  @Roles('OWNER')
  deleteRecipient(
    @Param('id') id: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<OwnerRecipientDto[]> {
    return this.settings.deleteRecipient(parseId(id, 'Adresse'), admin);
  }

  // ------------------------------------------------------------------ packages & prices

  @Get('spaces/:id/packages')
  packages(@Param('id') id: string): Promise<AdminPackagesResponse> {
    return this.catalog.list(parseId(id, 'Espace'));
  }

  @Post('spaces/:id/packages')
  @Roles('OWNER')
  createPackage(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminPackagesResponse> {
    return this.catalog.create(
      parseId(id, 'Espace'),
      parseOrThrow(packageCreateSchema, body),
      admin,
    );
  }

  @Patch('packages/:id')
  @Roles('OWNER')
  updatePackage(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminPackagesResponse> {
    return this.catalog.update(
      parseId(id, 'Forfait'),
      parseOrThrow(packageUpdateSchema, body),
      admin,
    );
  }
}
