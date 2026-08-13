import { describe, expect, it } from 'vitest';
import {
  addDays,
  formatOffsetLabel,
  getOffsetMs,
  isValidTimeZone,
  localDateAt,
  minuteOfDayAt,
  parseLocalDate,
  resolveWallTime,
  toLocalDate,
  wallFieldsAt,
  zoneAbbreviation,
} from './zone.js';

const HOUR = 3_600_000;
const MINUTE = 60_000;

/**
 * Real transitions, verified against the IANA database.
 *
 * These zones are chosen because each one breaks a different naive assumption:
 * whole-hour offsets, northern-hemisphere DST, DST existing at all, and DST rules being
 * stable over time.
 */
describe('getOffsetMs — offsets are a property of an instant, not of a zone', () => {
  it('resolves fixed-offset zones that are not whole hours', () => {
    // India has never observed DST and sits at +05:30.
    expect(getOffsetMs(Date.UTC(2026, 0, 15), 'Asia/Kolkata')).toBe(5.5 * HOUR);
    expect(getOffsetMs(Date.UTC(2026, 6, 15), 'Asia/Kolkata')).toBe(5.5 * HOUR);
    expect(getOffsetMs(Date.UTC(1998, 3, 2), 'Asia/Kolkata')).toBe(5.5 * HOUR);
  });

  it('resolves UTC and the extreme eastern offset', () => {
    expect(getOffsetMs(Date.UTC(2026, 0, 15), 'UTC')).toBe(0);
    expect(getOffsetMs(Date.UTC(2026, 0, 15), 'Pacific/Kiritimati')).toBe(14 * HOUR);
  });

  it('tracks the US spring-forward transition to the second', () => {
    // 2026-03-08 02:00 EST becomes 03:00 EDT.
    expect(getOffsetMs(Date.UTC(2026, 2, 8, 6, 59, 59), 'America/New_York')).toBe(-5 * HOUR);
    expect(getOffsetMs(Date.UTC(2026, 2, 8, 7, 0, 0), 'America/New_York')).toBe(-4 * HOUR);
  });

  it('tracks the US fall-back transition to the second', () => {
    // 2026-11-01 02:00 EDT becomes 01:00 EST.
    expect(getOffsetMs(Date.UTC(2026, 10, 1, 5, 59, 59), 'America/New_York')).toBe(-4 * HOUR);
    expect(getOffsetMs(Date.UTC(2026, 10, 1, 6, 0, 0), 'America/New_York')).toBe(-5 * HOUR);
  });

  it('handles a 30-minute DST shift in the southern hemisphere', () => {
    // Lord Howe Island moves between +10:30 and +11:00 — a half-hour DST shift.
    expect(getOffsetMs(Date.UTC(2026, 0, 15), 'Australia/Lord_Howe')).toBe(11 * HOUR);
    expect(getOffsetMs(Date.UTC(2026, 6, 15), 'Australia/Lord_Howe')).toBe(10.5 * HOUR);
  });

  it('handles a 45-minute base offset', () => {
    // Chatham Islands: +12:45 standard, +13:45 daylight.
    expect(getOffsetMs(Date.UTC(2026, 0, 15), 'Pacific/Chatham')).toBe(13.75 * HOUR);
    expect(getOffsetMs(Date.UTC(2026, 6, 15), 'Pacific/Chatham')).toBe(12.75 * HOUR);
  });

  it('uses the rule in force at the time, not the rule in force today', () => {
    // Brazil observed DST until it was abolished in 2019. A stored numeric offset would get
    // both of these wrong — this is the exact bug the model exists to prevent.
    expect(getOffsetMs(Date.UTC(2018, 0, 15, 12), 'America/Sao_Paulo')).toBe(-2 * HOUR);
    expect(getOffsetMs(Date.UTC(2020, 0, 15, 12), 'America/Sao_Paulo')).toBe(-3 * HOUR);

    // Egypt went the other way, reintroducing DST in April 2023.
    expect(getOffsetMs(Date.UTC(2020, 6, 15, 12), 'Africa/Cairo')).toBe(2 * HOUR);
    expect(getOffsetMs(Date.UTC(2023, 6, 15, 12), 'Africa/Cairo')).toBe(3 * HOUR);
  });
});

describe('resolveWallTime — the three outcomes', () => {
  it('resolves an ordinary wall time to exactly one instant', () => {
    const result = resolveWallTime(
      { year: 2026, month: 8, day: 20, hour: 14, minute: 30, second: 0 },
      'America/New_York',
    );
    expect(result).toEqual({ kind: 'unique', instant: Date.UTC(2026, 7, 20, 18, 30) });
  });

  it('reports a spring-forward wall time as a gap (US)', () => {
    // 02:30 on 2026-03-08 never happens in New York.
    for (const minute of [0, 30]) {
      expect(
        resolveWallTime(
          { year: 2026, month: 3, day: 8, hour: 2, minute, second: 0 },
          'America/New_York',
        ),
      ).toEqual({ kind: 'gap' });
    }
  });

  it('reports a spring-forward wall time as a gap (UK)', () => {
    // 01:30 on 2026-03-29 never happens in London.
    expect(
      resolveWallTime(
        { year: 2026, month: 3, day: 29, hour: 1, minute: 30, second: 0 },
        'Europe/London',
      ),
    ).toEqual({ kind: 'gap' });
  });

  it('reports a spring-forward wall time as a gap across a 30-minute shift', () => {
    // Lord Howe jumps 02:00 -> 02:30 on 2026-10-04, so 02:15 does not exist.
    expect(
      resolveWallTime(
        { year: 2026, month: 10, day: 4, hour: 2, minute: 15, second: 0 },
        'Australia/Lord_Howe',
      ),
    ).toEqual({ kind: 'gap' });
  });

  it('reports a fall-back wall time as two distinct instants (US)', () => {
    // 01:30 on 2026-11-01 happens twice in New York: once at -04:00, once at -05:00.
    expect(
      resolveWallTime(
        { year: 2026, month: 11, day: 1, hour: 1, minute: 30, second: 0 },
        'America/New_York',
      ),
    ).toEqual({
      kind: 'ambiguous',
      earlier: Date.UTC(2026, 10, 1, 5, 30),
      later: Date.UTC(2026, 10, 1, 6, 30),
    });
  });

  it('reports a fall-back wall time as two distinct instants (UK)', () => {
    expect(
      resolveWallTime(
        { year: 2026, month: 10, day: 25, hour: 1, minute: 30, second: 0 },
        'Europe/London',
      ),
    ).toEqual({
      kind: 'ambiguous',
      earlier: Date.UTC(2026, 9, 25, 0, 30),
      later: Date.UTC(2026, 9, 25, 1, 30),
    });
  });

  it('reports a fall-back wall time as two instants across a 30-minute shift', () => {
    // Lord Howe falls back 02:00 -> 01:30 on 2026-04-05, so 01:45 happens twice.
    expect(
      resolveWallTime(
        { year: 2026, month: 4, day: 5, hour: 1, minute: 45, second: 0 },
        'Australia/Lord_Howe',
      ),
    ).toEqual({
      kind: 'ambiguous',
      earlier: Date.UTC(2026, 3, 4, 14, 45),
      later: Date.UTC(2026, 3, 4, 15, 15),
    });
  });

  it('never reports a gap or ambiguity in a zone without DST', () => {
    for (let day = 1; day <= 28; day += 1) {
      const result = resolveWallTime(
        { year: 2026, month: 3, day, hour: 2, minute: 30, second: 0 },
        'Asia/Kolkata',
      );
      expect(result.kind).toBe('unique');
    }
  });
});

describe('round-tripping', () => {
  it('is stable for instants away from transitions', () => {
    const zones = ['America/New_York', 'Europe/London', 'Asia/Kolkata', 'Pacific/Chatham', 'UTC'];
    // A deterministic spread of instants across two decades, stepped by a prime number of
    // minutes so it lands at irregular times of day rather than always on the hour.
    for (const zone of zones) {
      for (let step = 0; step < 400; step += 1) {
        const instant = Date.UTC(2015, 0, 1) + step * 9_973 * MINUTE;
        const wall = wallFieldsAt(instant, zone);
        const resolved = resolveWallTime(wall, zone);
        if (resolved.kind === 'unique') {
          expect(resolved.instant).toBe(instant);
        } else if (resolved.kind === 'ambiguous') {
          expect([resolved.earlier, resolved.later]).toContain(instant);
        } else {
          throw new Error(`An instant that exists resolved to a gap in ${zone}`);
        }
      }
    }
  });
});

describe('zone abbreviations', () => {
  it('distinguishes the two halves of a repeated hour', () => {
    const earlier = zoneAbbreviation(Date.UTC(2026, 10, 1, 5, 30), 'America/New_York');
    const later = zoneAbbreviation(Date.UTC(2026, 10, 1, 6, 30), 'America/New_York');
    expect(earlier).toBe('EDT');
    expect(later).toBe('EST');
    expect(earlier).not.toBe(later);
  });
});

describe('calendar helpers', () => {
  it('reads the local date and minute-of-day an instant falls on', () => {
    // 2026-08-20 18:30 UTC is still 2026-08-20 in New York, but already the 21st in Tokyo.
    const instant = Date.UTC(2026, 7, 20, 18, 30);
    expect(localDateAt(instant, 'America/New_York')).toBe('2026-08-20');
    expect(minuteOfDayAt(instant, 'America/New_York')).toBe(14 * 60 + 30);
    expect(localDateAt(instant, 'Asia/Tokyo')).toBe('2026-08-21');
    expect(minuteOfDayAt(instant, 'Asia/Tokyo')).toBe(3 * 60 + 30);
  });

  it('adds days across month, year, and leap boundaries', () => {
    expect(addDays('2026-08-20', 1)).toBe('2026-08-21');
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2025-02-28', 1)).toBe('2025-03-01');
  });

  it('rejects malformed dates rather than coercing them', () => {
    expect(() => parseLocalDate('2026-8-20')).toThrow(RangeError);
    expect(() => parseLocalDate('20-08-2026')).toThrow(RangeError);
    expect(() => parseLocalDate('2026-13-01')).toThrow(RangeError);
    expect(() => parseLocalDate('2026-08-32')).toThrow(RangeError);
    expect(() => parseLocalDate('')).toThrow(RangeError);
  });

  it('formats dates with zero padding', () => {
    expect(toLocalDate({ year: 2026, month: 8, day: 5 })).toBe('2026-08-05');
    expect(toLocalDate({ year: 999, month: 12, day: 31 })).toBe('0999-12-31');
  });
});

describe('zone validation and offset labels', () => {
  it('accepts real zones and rejects invented ones', () => {
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });

  it('formats offsets in the conventional form', () => {
    expect(formatOffsetLabel(0)).toBe('Z');
    expect(formatOffsetLabel(5.5 * HOUR)).toBe('+05:30');
    expect(formatOffsetLabel(-4 * HOUR)).toBe('-04:00');
    expect(formatOffsetLabel(13.75 * HOUR)).toBe('+13:45');
    expect(formatOffsetLabel(-9.5 * HOUR)).toBe('-09:30');
  });
});
