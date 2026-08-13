import { describe, expect, it } from 'vitest';
import { materializeSlots, slotDurationMs, type RoomShape } from './slots.js';

function shape(overrides: Partial<RoomShape> = {}): RoomShape {
  return {
    anchorZone: 'America/New_York',
    dates: ['2026-08-20', '2026-08-21'],
    dayStartMinute: 9 * 60,
    dayEndMinute: 17 * 60,
    slotMinutes: 30,
    ...overrides,
  };
}

describe('materializeSlots', () => {
  it('produces one slot per step per day on an ordinary week', () => {
    const { slots, skipped } = materializeSlots(shape());
    expect(slots).toHaveLength(32); // 8 hours / 30 min = 16, twice
    expect(skipped).toHaveLength(0);
    expect(slots[0]?.instant).toBe(Date.UTC(2026, 7, 20, 13, 0)); // 09:00 EDT
  });

  it('returns instants in strictly ascending order with no duplicates', () => {
    const { slots } = materializeSlots(
      shape({ dates: ['2026-08-20', '2026-08-21', '2026-08-22'] }),
    );
    const instants = slots.map((slot) => slot.instant);
    expect([...new Set(instants)]).toHaveLength(instants.length);
    for (let i = 1; i < instants.length; i += 1) {
      expect(instants[i]).toBeGreaterThan(instants[i - 1] ?? Number.NEGATIVE_INFINITY);
    }
  });

  it('omits the hour that does not exist when the clocks go forward', () => {
    // 2026-03-08 in New York: 02:00 becomes 03:00, so 02:00 and 02:30 never happen.
    const { slots, skipped } = materializeSlots(
      shape({ dates: ['2026-03-08'], dayStartMinute: 0, dayEndMinute: 6 * 60 }),
    );

    expect(slots).toHaveLength(10); // 12 wall times minus the 2 that do not exist
    expect(skipped).toEqual([
      { anchorDate: '2026-03-08', anchorMinute: 120 },
      { anchorDate: '2026-03-08', anchorMinute: 150 },
    ]);
    expect(slots.some((slot) => slot.anchorMinute === 120)).toBe(false);
  });

  it('keeps both occurrences of the hour that happens twice when the clocks go back', () => {
    // 2026-11-01 in New York: 01:00-02:00 happens once at -04:00 and again at -05:00.
    // Both are real, schedulable hours. Dropping one silently deletes availability.
    const { slots, skipped } = materializeSlots(
      shape({ dates: ['2026-11-01'], dayStartMinute: 0, dayEndMinute: 6 * 60 }),
    );

    expect(skipped).toHaveLength(0);
    expect(slots).toHaveLength(14); // 12 wall times plus the 2 that happen twice

    const oneAm = slots.filter((slot) => slot.anchorMinute === 60);
    expect(oneAm).toHaveLength(2);
    expect(oneAm.map((slot) => slot.repeatIndex)).toEqual([0, 1]);
    expect(oneAm[0]?.instant).toBe(Date.UTC(2026, 10, 1, 5, 0));
    expect(oneAm[1]?.instant).toBe(Date.UTC(2026, 10, 1, 6, 0));
  });

  it('marks ordinary slots with a null repeat index', () => {
    const { slots } = materializeSlots(shape({ dates: ['2026-08-20'] }));
    expect(slots.every((slot) => slot.repeatIndex === null)).toBe(true);
  });

  it('handles a room whose anchor zone never observes DST', () => {
    const { slots, skipped } = materializeSlots(
      shape({ anchorZone: 'Asia/Kolkata', dates: ['2026-03-08', '2026-11-01'] }),
    );
    expect(slots).toHaveLength(32);
    expect(skipped).toHaveLength(0);
  });

  it('supports every allowed granularity', () => {
    expect(materializeSlots(shape({ dates: ['2026-08-20'], slotMinutes: 15 })).slots).toHaveLength(
      32,
    );
    expect(materializeSlots(shape({ dates: ['2026-08-20'], slotMinutes: 30 })).slots).toHaveLength(
      16,
    );
    expect(materializeSlots(shape({ dates: ['2026-08-20'], slotMinutes: 60 })).slots).toHaveLength(
      8,
    );
  });
});

describe('room shape validation', () => {
  it('rejects a room with no dates', () => {
    expect(() => materializeSlots(shape({ dates: [] }))).toThrow(/at least one date/);
  });

  it('rejects an inverted or empty day window', () => {
    expect(() => materializeSlots(shape({ dayStartMinute: 600, dayEndMinute: 600 }))).toThrow(
      /precede/,
    );
    expect(() => materializeSlots(shape({ dayStartMinute: 900, dayEndMinute: 600 }))).toThrow(
      /precede/,
    );
  });

  it('rejects a window that leaves the calendar day', () => {
    expect(() => materializeSlots(shape({ dayStartMinute: -60 }))).toThrow(/single calendar day/);
    expect(() => materializeSlots(shape({ dayEndMinute: 1500 }))).toThrow(/single calendar day/);
  });

  it('rejects a window that does not divide evenly into slots', () => {
    expect(() => materializeSlots(shape({ dayStartMinute: 0, dayEndMinute: 50 }))).toThrow(
      /divide evenly/,
    );
  });

  it('rejects an unsupported granularity', () => {
    expect(() =>
      // Deliberately bypassing the type to prove the runtime guard is real, not decorative.
      materializeSlots({ ...shape(), slotMinutes: 7 } as unknown as RoomShape),
    ).toThrow(/Slot length/);
  });
});

describe('slotDurationMs', () => {
  it('converts granularity to milliseconds', () => {
    expect(slotDurationMs(15)).toBe(900_000);
    expect(slotDurationMs(30)).toBe(1_800_000);
    expect(slotDurationMs(60)).toBe(3_600_000);
  });
});
