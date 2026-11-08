import { describe, expect, it } from 'vitest';
import { discountPercent, formatXof } from './money';

describe('formatXof', () => {
  it('groups thousands with spaces and appends FCFA', () => {
    expect(formatXof(51000)).toBe('51 000 FCFA');
    expect(formatXof(108000)).toBe('108 000 FCFA');
    expect(formatXof(1250000)).toBe('1 250 000 FCFA');
    expect(formatXof(0)).toBe('0 FCFA');
  });

  it('formats negative amounts (discount lines)', () => {
    expect(formatXof(-9000)).toBe('−9 000 FCFA');
  });

  it('rejects fractional amounts', () => {
    expect(() => formatXof(10.5)).toThrow(RangeError);
  });
});

describe('discountPercent', () => {
  it('computes the saving of the seed packages', () => {
    expect(discountPercent(27000, 15000, 2)).toBe(10);
    expect(discountPercent(51000, 15000, 4)).toBe(15);
    expect(discountPercent(108000, 15000, 9)).toBe(20);
  });

  it('returns 0 when the package is not cheaper', () => {
    expect(discountPercent(15000, 15000, 1)).toBe(0);
    expect(discountPercent(32000, 15000, 2)).toBe(0);
  });
});
