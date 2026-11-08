import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import type { z } from 'zod';

/**
 * Every API error has the same JSON shape:
 *   { "statusCode": 404, "code": "SPACE_NOT_FOUND", "message": "…" }
 * `code` is stable and meant for the web app's logic; `message` is French and
 * can be shown to the user as is.
 */
export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
}

export class ApiError extends HttpException {
  constructor(status: HttpStatus, code: string, message: string, details?: unknown) {
    super({ statusCode: status, code, message, details } satisfies ApiErrorBody, status);
  }
}

export const notFound = (code: string, message: string) =>
  new ApiError(HttpStatus.NOT_FOUND, code, message);
export const badRequest = (code: string, message: string, details?: unknown) =>
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
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      if (typeof raw === 'object' && raw !== null && 'code' in raw) {
        res.status(status).json(raw);
        return;
      }
      res.status(status).json({
        statusCode: status,
        code: STATUS_CODES[status] ?? 'HTTP_ERROR',
        message: FRENCH_DEFAULTS[status] ?? exception.message,
      } satisfies ApiErrorBody);
      return;
    }

    // Unexpected error: log everything, reveal nothing.
    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Une erreur interne est survenue. Veuillez réessayer.',
    } satisfies ApiErrorBody);
  }
}
