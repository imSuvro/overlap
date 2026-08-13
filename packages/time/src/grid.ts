import { formatDayAndMonth, formatTimeOfDay, formatWeekdayShort } from './format.js';
import { MINUTES_PER_DAY, type Slot } from './slots.js';
import type { Instant, LocalDate, TimeZoneId } from './types.js';
import { localDateAt, minuteOfDayAt, zoneAbbreviation } from './zone.js';

export interface ViewerCell {
  readonly instant: Instant;
  /**
   * Only populated when this wall time occurs more than once on this day *in the viewer's
   * zone*, where the label alone would be ambiguous. `EDT` versus `EST`.
   */
  readonly abbreviation: string | null;
  readonly isRepeatedHour: boolean;
}

export interface ViewerRow {
  /** Minutes since midnight in the viewer's zone. */
  readonly minuteOfDay: number;
  /**
   * Which occurrence of this wall time this row represents. Always `0`, except on the day
   * the clocks go back in the viewer's zone, where a second row appears for the repeat.
   */
  readonly occurrence: number;
  readonly label: string;
}

export interface ViewerColumn {
  readonly dateKey: LocalDate;
  readonly weekdayLabel: string;
  readonly dayLabel: string;
  readonly firstInstant: Instant;
}

export interface ViewerGrid {
  readonly timeZone: TimeZoneId;
  readonly rows: readonly ViewerRow[];
  readonly columns: readonly ViewerColumn[];
  /**
   * `cells[columnIndex][rowIndex]`, or `null` where no slot exists there.
   *
   * A `null` is not an error — it is either the edge of the room's daily window as it lands
   * in this viewer's zone, or an hour that does not exist because of a DST transition. The UI
   * renders the two differently, which is why the grid keeps the holes rather than compacting
   * them away.
   */
  readonly cells: readonly (readonly (ViewerCell | null)[])[];
}

interface Placement {
  readonly instant: Instant;
  readonly dateKey: LocalDate;
  readonly minuteOfDay: number;
  readonly occurrence: number;
}

function rowKey(minuteOfDay: number, occurrence: number): string {
  return `${minuteOfDay}#${occurrence}`;
}

function cellKey(dateKey: LocalDate, minuteOfDay: number, occurrence: number): string {
  return `${dateKey}|${minuteOfDay}#${occurrence}`;
}

/**
 * Picks the minute-of-day the grid's rows should start from.
 *
 * Rows cannot simply be sorted 00:00 upward. A 9am-5pm room in New York lands at 10pm-5:30am
 * in Tokyo, so a naive sort would split one contiguous evening into a block at the very top of
 * the grid and another at the very bottom, with eighteen empty hours between them.
 *
 * The times present in a room form an arc on a 24-hour circle. Cutting that circle at its
 * widest empty gap always yields the one ordering where the occupied times stay contiguous.
 */
function circularRowOrigin(minutes: Iterable<number>): number {
  const distinct = [...new Set(minutes)].sort((a, b) => a - b);
  const firstMinute = distinct[0];
  if (firstMinute === undefined) return 0;
  if (distinct.length === 1) return firstMinute;

  let widestGap = -1;
  let origin = firstMinute;
  let previous: number | null = null;

  for (const minute of distinct) {
    if (previous !== null && minute - previous > widestGap) {
      widestGap = minute - previous;
      origin = minute;
    }
    previous = minute;
  }

  // The gap that wraps around midnight, from the last time of day back to the first.
  const lastMinute = previous ?? firstMinute;
  if (MINUTES_PER_DAY - lastMinute + firstMinute > widestGap) {
    origin = firstMinute;
  }

  return origin;
}

/**
 * Projects a room's instants into the grid a specific viewer sees.
 *
 * The room's instants are fixed; only their labels and their arrangement change. That is why
 * a room created as seven days in New York can render as **eight** columns for a viewer in
 * Tokyo — those instants genuinely straddle eight Tokyo dates. Nothing special-cases that; it
 * falls out of grouping by the viewer's own local date.
 */
export function buildViewerGrid(
  slots: readonly Slot[],
  timeZone: TimeZoneId,
  locale = 'en-US',
): ViewerGrid {
  const ordered = [...slots].sort((a, b) => a.instant - b.instant);

  // Assign each slot an occurrence index within its (viewer date, viewer minute) bucket.
  // Anything above 0 means the viewer's own clocks went back — which can happen even when the
  // room's anchor zone has no DST at all.
  const occurrenceCounter = new Map<string, number>();
  const placements: Placement[] = [];

  for (const slot of ordered) {
    const dateKey = localDateAt(slot.instant, timeZone);
    const minuteOfDay = minuteOfDayAt(slot.instant, timeZone);
    const bucket = `${dateKey}|${minuteOfDay}`;
    const occurrence = occurrenceCounter.get(bucket) ?? 0;
    occurrenceCounter.set(bucket, occurrence + 1);
    placements.push({ instant: slot.instant, dateKey, minuteOfDay, occurrence });
  }

  const columnOrder: LocalDate[] = [];
  const columnFirstInstant = new Map<LocalDate, Instant>();
  const rowSeen = new Map<string, { minuteOfDay: number; occurrence: number; instant: Instant }>();
  const byCell = new Map<string, Placement>();

  for (const placement of placements) {
    if (!columnFirstInstant.has(placement.dateKey)) {
      columnFirstInstant.set(placement.dateKey, placement.instant);
      columnOrder.push(placement.dateKey);
    }
    const rKey = rowKey(placement.minuteOfDay, placement.occurrence);
    if (!rowSeen.has(rKey)) {
      rowSeen.set(rKey, {
        minuteOfDay: placement.minuteOfDay,
        occurrence: placement.occurrence,
        instant: placement.instant,
      });
    }
    byCell.set(cellKey(placement.dateKey, placement.minuteOfDay, placement.occurrence), placement);
  }

  const origin = circularRowOrigin(placements.map((placement) => placement.minuteOfDay));
  const fromOrigin = (minuteOfDay: number): number =>
    (minuteOfDay - origin + MINUTES_PER_DAY) % MINUTES_PER_DAY;

  const rows: ViewerRow[] = [...rowSeen.values()]
    .sort(
      (a, b) =>
        fromOrigin(a.minuteOfDay) - fromOrigin(b.minuteOfDay) || a.occurrence - b.occurrence,
    )
    .map((row) => ({
      minuteOfDay: row.minuteOfDay,
      occurrence: row.occurrence,
      label: formatTimeOfDay(row.instant, timeZone, locale),
    }));

  const columns: ViewerColumn[] = columnOrder.map((dateKey) => {
    const firstInstant = columnFirstInstant.get(dateKey) ?? 0;
    return {
      dateKey,
      firstInstant,
      weekdayLabel: formatWeekdayShort(firstInstant, timeZone, locale),
      dayLabel: formatDayAndMonth(firstInstant, timeZone, locale),
    };
  });

  const cells: (ViewerCell | null)[][] = columns.map((column) =>
    rows.map((row) => {
      const placement = byCell.get(cellKey(column.dateKey, row.minuteOfDay, row.occurrence));
      if (!placement) return null;

      const isRepeatedHour =
        (occurrenceCounter.get(`${column.dateKey}|${row.minuteOfDay}`) ?? 1) > 1;
      return {
        instant: placement.instant,
        isRepeatedHour,
        // Resolving the abbreviation costs an Intl call, so it is only paid where it is
        // actually needed to tell two identically-labelled cells apart.
        abbreviation: isRepeatedHour ? zoneAbbreviation(placement.instant, timeZone) : null,
      };
    }),
  );

  return { timeZone, rows, columns, cells };
}
