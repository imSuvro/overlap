import type { Instant, LocalDate, TimeZoneId } from './types.js';
import { parseLocalDate, resolveWallTime } from './zone.js';

export const MINUTES_PER_DAY = 1440;

/** The slot granularities a room may use. */
export const SLOT_MINUTES = [15, 30, 60] as const;
export type SlotMinutes = (typeof SLOT_MINUTES)[number];

/**
 * A room's *shape* — not its slots.
 *
 * Slots are derived, never stored. Storing them would mean storing wall times, and a stored
 * wall time is a stored assumption about a DST rule that may not hold.
 */
export interface RoomShape {
  /** The host's IANA zone at room creation. Defines what the chosen hours *mean*. */
  readonly anchorZone: TimeZoneId;
  /** Calendar dates in the anchor zone. */
  readonly dates: readonly LocalDate[];
  /** Minutes from anchor-zone midnight, inclusive. */
  readonly dayStartMinute: number;
  /** Minutes from anchor-zone midnight, exclusive. */
  readonly dayEndMinute: number;
  readonly slotMinutes: SlotMinutes;
}

export interface Slot {
  readonly instant: Instant;
  readonly anchorDate: LocalDate;
  readonly anchorMinute: number;
  /**
   * `null` normally. `0` or `1` when this anchor-zone wall time occurred twice because the
   * clocks went back — both occurrences are real, distinct, schedulable instants.
   */
  readonly repeatIndex: 0 | 1 | null;
}

/** A wall time that simply does not exist in the anchor zone, because the clocks went forward. */
export interface SkippedWallTime {
  readonly anchorDate: LocalDate;
  readonly anchorMinute: number;
}

export interface MaterializedSlots {
  readonly slots: readonly Slot[];
  readonly skipped: readonly SkippedWallTime[];
}

export function slotDurationMs(slotMinutes: SlotMinutes): number {
  return slotMinutes * 60_000;
}

function assertShape(shape: RoomShape): void {
  if (shape.dates.length === 0) {
    throw new RangeError('A room must cover at least one date');
  }
  if (!Number.isInteger(shape.dayStartMinute) || !Number.isInteger(shape.dayEndMinute)) {
    throw new RangeError('Day bounds must be whole minutes');
  }
  if (shape.dayStartMinute < 0 || shape.dayEndMinute > MINUTES_PER_DAY) {
    throw new RangeError('Day bounds must fall within a single calendar day');
  }
  if (shape.dayStartMinute >= shape.dayEndMinute) {
    throw new RangeError('Day start must precede day end');
  }
  if (!SLOT_MINUTES.includes(shape.slotMinutes)) {
    throw new RangeError(`Slot length must be one of ${SLOT_MINUTES.join(', ')} minutes`);
  }
  if ((shape.dayEndMinute - shape.dayStartMinute) % shape.slotMinutes !== 0) {
    throw new RangeError('The day window must divide evenly into slots');
  }
}

/**
 * Turns a room shape into the concrete set of instants people can actually be scheduled at.
 *
 * Every anchor-zone wall time in the window is resolved against the real IANA rules, which
 * produces exactly the three outcomes the timezone model is built around:
 *
 * - one instant  — the ordinary case
 * - no instant   — the hour does not exist (spring forward); recorded in `skipped` so the UI
 *                  can say so out loud instead of silently shortening the day
 * - two instants — the hour happens twice (fall back); **both** are kept as distinct slots,
 *                  because both are genuinely schedulable and dropping one quietly deletes an
 *                  hour of real availability once a year
 */
export function materializeSlots(shape: RoomShape): MaterializedSlots {
  assertShape(shape);

  const slots: Slot[] = [];
  const skipped: SkippedWallTime[] = [];

  for (const anchorDate of shape.dates) {
    const { year, month, day } = parseLocalDate(anchorDate);

    for (
      let anchorMinute = shape.dayStartMinute;
      anchorMinute < shape.dayEndMinute;
      anchorMinute += shape.slotMinutes
    ) {
      const resolution = resolveWallTime(
        {
          year,
          month,
          day,
          hour: Math.floor(anchorMinute / 60),
          minute: anchorMinute % 60,
          second: 0,
        },
        shape.anchorZone,
      );

      switch (resolution.kind) {
        case 'unique':
          slots.push({ instant: resolution.instant, anchorDate, anchorMinute, repeatIndex: null });
          break;
        case 'ambiguous':
          slots.push({ instant: resolution.earlier, anchorDate, anchorMinute, repeatIndex: 0 });
          slots.push({ instant: resolution.later, anchorDate, anchorMinute, repeatIndex: 1 });
          break;
        case 'gap':
          skipped.push({ anchorDate, anchorMinute });
          break;
      }
    }
  }

  slots.sort((a, b) => a.instant - b.instant);
  return { slots, skipped };
}

/** Every instant in the room, ascending. Convenience for callers that only need the keys. */
export function slotInstants(shape: RoomShape): readonly Instant[] {
  return materializeSlots(shape).slots.map((slot) => slot.instant);
}
