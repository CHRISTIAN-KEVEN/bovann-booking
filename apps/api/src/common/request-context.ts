import { AsyncLocalStorage } from 'node:async_hooks';
import { DEFAULT_LOCALE, type Locale } from '@bovann/shared';
import type { NextFunction, Request, Response } from 'express';
import { requestLocale } from './locale';

/**
 * Per-request context, available anywhere during a request without passing it through every
 * call: today only the language asked for (Accept-Language). Outside a request (background jobs)
 * the language is French; jobs that write to customers use the booking's own language instead.
 */
const storage = new AsyncLocalStorage<{ locale: Locale }>();

export function requestContextMiddleware(req: Request, _res: Response, next: NextFunction): void {
  storage.run({ locale: requestLocale(req) }, next);
}

export function currentLocale(): Locale {
  return storage.getStore()?.locale ?? DEFAULT_LOCALE;
}

/** Runs `fn` as if the request asked for `locale` (tests, jobs). */
export function withLocale<T>(locale: Locale, fn: () => T): T {
  return storage.run({ locale }, fn);
}

/** The English text when the request asks for English and one exists, else the French one. */
export function localized(fr: string, en: string | null | undefined): string {
  return currentLocale() === 'en' && en ? en : fr;
}
