import {
  addDays,
  datesOfMonth,
  daysInMonth,
  isValidLocalDate,
  isoWeekday,
  localToUtc,
  timeToMinutes,
  utcToLocalDate,
  utcToLocalTime,
} from './time';

describe('time helpers', () => {
  it('Lomé is UTC+0: local 08:00 is 08:00Z', () => {
    expect(localToUtc('2026-11-12', 8 * 60, 'Africa/Lome').toISOString()).toBe(
      '2026-11-12T08:00:00.000Z',
    );
  });

  it('handles a zone with an offset (Lagos, UTC+1)', () => {
    expect(localToUtc('2026-11-12', 8 * 60, 'Africa/Lagos').toISOString()).toBe(
      '2026-11-12T07:00:00.000Z',
    );
    expect(utcToLocalTime(new Date('2026-11-12T07:00:00Z'), 'Africa/Lagos')).toBe('08:00');
  });

  it('handles daylight saving (Paris summer vs winter)', () => {
    expect(localToUtc('2026-07-01', 10 * 60, 'Europe/Paris').toISOString()).toBe(
      '2026-07-01T08:00:00.000Z',
    );
    expect(localToUtc('2026-12-01', 10 * 60, 'Europe/Paris').toISOString()).toBe(
      '2026-12-01T09:00:00.000Z',
    );
  });

  it('gives the local date even when it differs from the UTC date', () => {
    expect(utcToLocalDate(new Date('2026-11-12T23:30:00Z'), 'Africa/Lagos')).toBe('2026-11-13');
    expect(utcToLocalDate(new Date('2026-11-12T23:30:00Z'), 'Africa/Lome')).toBe('2026-11-12');
  });

  it('computes ISO weekdays (1 = Monday, 7 = Sunday)', () => {
    expect(isoWeekday('2026-11-09')).toBe(1);
    expect(isoWeekday('2026-11-08')).toBe(7);
    expect(isoWeekday('2026-11-12')).toBe(4);
  });

  it('adds days across months and years', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-11-08', 90)).toBe('2027-02-06');
  });

  it('knows month lengths, including leap years', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(datesOfMonth('2026-11')).toHaveLength(30);
    expect(datesOfMonth('2026-11')[0]).toBe('2026-11-01');
  });

  it('rejects invalid dates, months and times', () => {
    expect(isValidLocalDate('2026-02-30')).toBe(false);
    expect(isValidLocalDate('2026-13-01')).toBe(false);
    expect(isValidLocalDate('12/11/2026')).toBe(false);
    expect(() => datesOfMonth('2026-13')).toThrow(RangeError);
    expect(() => timeToMinutes('25:00')).toThrow(RangeError);
    expect(timeToMinutes('21:30:00')).toBe(1290);
  });
});
