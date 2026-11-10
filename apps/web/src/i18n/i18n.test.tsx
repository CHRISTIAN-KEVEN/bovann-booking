import { screen } from '@testing-library/react';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { renderI18n, tFor } from '@/test/i18n';
import { proxy } from '../proxy';
import { localizePath, splitLocale } from './config';
import { en } from './messages/en';
import { fr } from './messages/fr';

let pathname = '/reserver/date';
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

describe('language addresses', () => {
  it('keeps French at the plain address and English under /en', () => {
    expect(localizePath('fr', '/reserver/date')).toBe('/reserver/date');
    expect(localizePath('en', '/reserver/date')).toBe('/en/reserver/date');
    expect(localizePath('en', '/')).toBe('/en');
    expect(splitLocale('/en/reserver/date')).toEqual({ locale: 'en', path: '/reserver/date' });
    expect(splitLocale('/fr')).toEqual({ locale: 'fr', path: '/' });
    expect(splitLocale('/conditions')).toEqual({ locale: 'fr', path: '/conditions' });
  });

  it('serves French from the plain address and sends /fr/... back to it', () => {
    const plain = proxy(new NextRequest('http://localhost/reserver/date?x=1'));
    expect(plain.headers.get('x-middleware-rewrite')).toBe('http://localhost/fr/reserver/date?x=1');
    const english = proxy(new NextRequest('http://localhost/en/conditions'));
    expect(english.headers.get('x-middleware-rewrite')).toBeNull();
    const prefixed = proxy(new NextRequest('http://localhost/fr/conditions'));
    expect(prefixed.status).toBe(308);
    expect(prefixed.headers.get('location')).toBe('http://localhost/conditions');
  });
});

describe('texts', () => {
  it('has the same keys in English as in French', () => {
    const keys = (o: object, prefix = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) =>
        typeof v === 'string' || 'other' in v ? [prefix + k] : keys(v, `${prefix}${k}.`),
      );
    expect(keys(en).sort()).toEqual(keys(fr).sort());
  });

  it('fills values and picks singular or plural', () => {
    const t = tFor('en');
    expect(t('selection.slots', { count: 1 })).toBe('1 slot');
    expect(t('selection.slots', { count: 3 })).toBe('3 slots');
    expect(tFor('fr')('selection.slots', { count: 0 })).toBe('0 créneau');
    expect(t('payment.pay', { amount: '15,000 FCFA' })).toBe('Pay 15,000 FCFA');
  });
});

describe('language switch', () => {
  it('links to the same page in the other language', () => {
    pathname = '/en/reserver/date';
    renderI18n(<LanguageSwitch />, { locale: 'en' });
    expect(screen.getByRole('link', { name: 'FR' })).toHaveAttribute('href', '/reserver/date');
    expect(screen.getByRole('link', { name: 'EN' })).toHaveAttribute('aria-current', 'true');
  });
});
