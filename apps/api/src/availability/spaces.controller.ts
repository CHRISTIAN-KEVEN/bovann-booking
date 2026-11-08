import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  SESSION_MODES,
  type DayAvailabilityResponse,
  type MonthAvailabilityResponse,
  type PackagesResponse,
  type SpaceDto,
} from '@bovann/shared';
import { z } from 'zod';
import { parseOrThrow } from '../common/errors';
import { AvailabilityService } from './availability.service';
import { isValidLocalDate } from './domain/time';

const slugSchema = z.string().regex(/^[a-z0-9-]{1,80}$/, 'Identifiant d’espace invalide.');
const modeSchema = z.enum(SESSION_MODES, {
  message: 'Le paramètre « mode » est obligatoire : IN_PERSON (en studio) ou VIRTUAL (virtuel).',
});
const monthSchema = z
  .string({ message: 'Le paramètre « month » est obligatoire (format AAAA-MM).' })
  .regex(
    /^(20\d{2})-(0[1-9]|1[0-2])$/,
    'Mois invalide : utilisez le format AAAA-MM, par exemple 2026-11.',
  );
const dateSchema = z
  .string()
  .refine(
    isValidLocalDate,
    'Date invalide : utilisez le format AAAA-MM-JJ, par exemple 2026-11-12.',
  );

/**
 * Public, read-only endpoints used by the booking screens.
 * Thin by design: validate input, delegate to the service.
 */
@Controller('spaces')
export class SpacesController {
  constructor(private readonly availability: AvailabilityService) {}

  /** Space details for the first screen (modes offered, booking window). */
  @Get(':slug')
  getSpace(@Param('slug') slug: string): Promise<SpaceDto> {
    return this.availability.getSpace(parseOrThrow(slugSchema, slug));
  }

  /** Packages and prices for a mode (catalog view, not tied to a date). */
  @Get(':slug/packages')
  getPackages(
    @Param('slug') slug: string,
    @Query('mode') mode: unknown,
  ): Promise<PackagesResponse> {
    return this.availability.getPackages(
      parseOrThrow(slugSchema, slug),
      parseOrThrow(modeSchema, mode),
    );
  }

  /** Month calendar: one status per day. GET …/availability?month=2026-11 */
  @Get(':slug/availability')
  getMonth(
    @Param('slug') slug: string,
    @Query('month') month: unknown,
  ): Promise<MonthAvailabilityResponse> {
    return this.availability.getMonth(
      parseOrThrow(slugSchema, slug),
      parseOrThrow(monthSchema, month),
    );
  }

  /** One day: every slot, and where each package fits. GET …/availability/2026-11-12?mode=IN_PERSON */
  @Get(':slug/availability/:date')
  getDay(
    @Param('slug') slug: string,
    @Param('date') date: string,
    @Query('mode') mode: unknown,
  ): Promise<DayAvailabilityResponse> {
    return this.availability.getDay(
      parseOrThrow(slugSchema, slug),
      parseOrThrow(dateSchema, date),
      parseOrThrow(modeSchema, mode),
    );
  }
}
