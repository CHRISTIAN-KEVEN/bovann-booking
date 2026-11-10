import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Locale } from '@bovann/shared';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { requestLocale } from './locale';
import { MESSAGES_EN } from './messages-en';

/**
 * Every API error has the same JSON shape:
 *   { "statusCode": 404, "code": "SPACE_NOT_FOUND", "message": "…" }
 * `code` is stable and meant for the web app's logic; `message` is in the language the request
 * asks for (Accept-Language: French by default, or English) and can be shown to the user as is.
 */
export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
}

/** A message written in both languages, for messages built with values. */
export type BilingualText = Record<Locale, string>;

export class ApiError extends HttpException {
  constructor(
    status: HttpStatus,
    code: string,
    message: string | BilingualText,
    details?: unknown,
  ) {
    const fr = typeof message === 'string' ? message : message.fr;
    const en = typeof message === 'string' ? undefined : message.en;
    super({ statusCode: status, code, message: fr, details, messageEn: en }, status);
  }
}

/**
 * The message in the request's language. French is the reference: English comes from the text
 * given with the error, else from the catalog, else (and logged) the French text is kept.
 */
export function localizeMessage(
  locale: Locale,
  fr: string,
  en: string | undefined,
  onMissing?: (fr: string) => void,
  fallbackEn?: string,
): string {
  if (locale === 'fr') return fr;
  if (en) return en;
  const known = MESSAGES_EN[fr];
  if (known) return known;
  onMissing?.(fr);
  return fallbackEn ?? fr;
}

const GENERIC_INVALID_EN = 'Some information is missing or invalid.';

/**
 * Error details can hold messages (validation problems, price-rule violations), possibly with an
 * English version in `messageEn`. Returns the details with each message in the request's
 * language, and without `messageEn`.
 */
function localizeDetails(locale: Locale, value: unknown, onMissing: (fr: string) => void): unknown {
  if (Array.isArray(value)) return value.map((v) => localizeDetails(locale, v, onMissing));
  if (typeof value !== 'object' || value === null || value instanceof Date) return value;
  const { messageEn, ...rest } = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(rest)) {
    out[key] =
      key === 'message' && typeof v === 'string'
        ? localizeMessage(
            locale,
            v,
            typeof messageEn === 'string' ? messageEn : undefined,
            onMissing,
            GENERIC_INVALID_EN,
          )
        : localizeDetails(locale, v, onMissing);
  }
  return out;
}

export const notFound = (code: string, message: string | BilingualText) =>
  new ApiError(HttpStatus.NOT_FOUND, code, message);
export const badRequest = (code: string, message: string | BilingualText, details?: unknown) =>
  new ApiError(HttpStatus.BAD_REQUEST, code, message, details);

/** Validates input with a zod schema; turns failures into a French 400. */
export function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    throw badRequest(
      'VALIDATION_ERROR',
      first?.message ?? 'Requête invalide.',
      result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    );
  }
  return result.data;
}

const STATUS_CODES: Partial<Record<number, string>> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  429: 'TOO_MANY_REQUESTS',
};

const FRENCH_DEFAULTS: Partial<Record<number, string>> = {
  404: 'Ressource introuvable.',
  405: 'Méthode non autorisée.',
  429: 'Trop de requêtes. Patientez un instant avant de réessayer.',
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request | undefined>();
    const locale = req?.headers ? requestLocale(req) : 'fr';
    const missing = (fr: string) =>
      this.logger.warn(`No English text for API message: ${JSON.stringify(fr)}`);

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      if (typeof raw === 'object' && raw !== null && 'code' in raw) {
        const { messageEn, ...body } = raw as ApiErrorBody & { messageEn?: string };
        const details = localizeDetails(locale, body.details, missing);
        const fallback = body.code === 'VALIDATION_ERROR' ? GENERIC_INVALID_EN : undefined;
        res.status(status).json({
          ...body,
          message: localizeMessage(locale, body.message, messageEn ?? undefined, missing, fallback),
          ...(details === undefined ? {} : { details }),
        } satisfies ApiErrorBody);
        return;
      }
      const fr = FRENCH_DEFAULTS[status] ?? exception.message;
      res.status(status).json({
        statusCode: status,
        code: STATUS_CODES[status] ?? 'HTTP_ERROR',
        message: FRENCH_DEFAULTS[status] ? localizeMessage(locale, fr, undefined) : fr,
      } satisfies ApiErrorBody);
      return;
    }

    // Unexpected error: log everything, reveal nothing.
    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: localizeMessage(
        locale,
        'Une erreur interne est survenue. Veuillez réessayer.',
        undefined,
      ),
    } satisfies ApiErrorBody);
  }
}
