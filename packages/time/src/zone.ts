import type { Instant, LocalDate, TimeZoneId, WallFields, WallResolution } from './types.js';

const MS_PER_SECOND = 1_000;
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

/**
 * Constructing an `Intl.DateTimeFormat` is by far the expensive part of offset resolution —
 * roughly two orders of magnitude more than using one. Slot materialisation calls this
 * hundreds of times per room, so the formatters are cached per zone.
 */
const wallFormatters = new Map<TimeZoneId, Intl.DateTimeFormat>();
const abbreviationFormatters = new Map<TimeZoneId, Intl.DateTimeFormat>();

function wallFormatter(timeZone: TimeZoneId): Intl.DateTimeFormat {
  const cached = wallFormatters.get(timeZone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat('en-US', {
    timeZone,
    // h23 rather than hour12:false — the latter yields "24" for midnight on some engines.
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  wallFormatters.set(timeZone, created);
  return created;
}

function abbreviationFormatter(timeZone: TimeZoneId): Intl.DateTimeFormat {
  const cached = abbreviationFormatters.get(timeZone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' });
  abbreviationFormatters.set(timeZone, created);
  return created;
}

/** True when the runtime's ICU data recognises this identifier. */
export function isValidTimeZone(timeZone: string): boolean {
  if (timeZone.length === 0) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The viewer's own zone, as reported by the runtime. */
export function localTimeZone(): TimeZoneId {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Reads the wall-clock fields an observer in `timeZone` would see at `instant`. */
export function wallFieldsAt(instant: Instant, timeZone: TimeZoneId): WallFields {
  const parts = wallFormatter(timeZone).formatToParts(new Date(instant));
  let year = 0;
  let month = 1;
  let day = 1;
  let hour = 0;
  let minute = 0;
  let second = 0;

  for (const part of parts) {
    switch (part.type) {
      case 'year':
        year = Number.parseInt(part.value, 10);
        break;
      case 'month':
        month = Number.parseInt(part.value, 10);
        break;
      case 'day':
        day = Number.parseInt(part.value, 10);
        break;
      case 'hour':
        hour = Number.parseInt(part.value, 10);
        break;
      case 'minute':
        minute = Number.parseInt(part.value, 10);
        break;
      case 'second':
        second = Number.parseInt(part.value, 10);
        break;
      default:
        break;
    }
  }

  return { year, month, day, hour, minute, second };
}

/**
 * Interprets wall-clock fields *as if they were UTC*.
 *
 * `Date.UTC` is not used because it remaps years 0-99 into the 20th century, which would
 * silently corrupt any historical date. Setting the fields explicitly avoids that.
 */
export function wallFieldsToUtcMs(wall: WallFields): number {
  const date = new Date(0);
  date.setUTCFullYear(wall.year, wall.month - 1, wall.day);
  date.setUTCHours(wall.hour, wall.minute, wall.second, 0);
  return date.getTime();
}

/**
 * The UTC offset in force in `timeZone` **at that specific instant**, in milliseconds.
 *
 * Because the offset is always resolved at an instant, the full IANA history applies for
 * free: Brazil abolishing DST in 2019, Egypt reintroducing it in 2023, Lord Howe Island's
 * 30-minute shift, and so on.
 */
export function getOffsetMs(instant: Instant, timeZone: TimeZoneId): number {
  // Offsets are whole seconds (historical LMT offsets are not whole minutes), so align to
  // the second before comparing — sub-second precision would otherwise leak into the result.
  const aligned = Math.floor(instant / MS_PER_SECOND) * MS_PER_SECOND;
  return wallFieldsToUtcMs(wallFieldsAt(aligned, timeZone)) - aligned;
}

/**
 * Resolves a wall-clock time in a zone to the instant(s) where it actually occurs.
 *
 * This is the heart of the package. Two probes a day either side of the naive guess bracket
 * any real transition, producing at most two candidate instants; each is then verified by
 * checking that it really does read back as the requested wall time. Candidates that fail
 * that check are transitions the wall time fell *inside*, which is exactly the DST gap.
 *
 * Mirrors the semantics of `Temporal.TimeZone#getPossibleInstantsFor`.
 */
export function resolveWallTime(wall: WallFields, timeZone: TimeZoneId): WallResolution {
  const naive = wallFieldsToUtcMs(wall);
  const offsetBefore = getOffsetMs(naive - MS_PER_DAY, timeZone);
  const offsetAfter = getOffsetMs(naive + MS_PER_DAY, timeZone);

  const candidates =
    offsetBefore === offsetAfter
      ? [naive - offsetBefore]
      : [naive - offsetBefore, naive - offsetAfter];

  const valid: Instant[] = [];
  for (const candidate of candidates) {
    // Round-trip check: does this instant actually read back as the wall time we asked for?
    if (getOffsetMs(candidate, timeZone) === naive - candidate && !valid.includes(candidate)) {
      valid.push(candidate);
    }
  }

  valid.sort((a, b) => a - b);

  const [earlier, later] = valid;
  if (earlier === undefined) return { kind: 'gap' };
  if (later === undefined) return { kind: 'unique', instant: earlier };
  return { kind: 'ambiguous', earlier, later };
}

/** Parses `YYYY-MM-DD`, rejecting anything else rather than coercing it. */
export function parseLocalDate(date: LocalDate): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    throw new RangeError(`Expected a YYYY-MM-DD date, received ${JSON.stringify(date)}`);
  }
  const [, rawYear, rawMonth, rawDay] = match;
  // The regex guarantees these, but `noUncheckedIndexedAccess` is on for a reason.
  if (rawYear === undefined || rawMonth === undefined || rawDay === undefined) {
    throw new RangeError(`Expected a YYYY-MM-DD date, received ${JSON.stringify(date)}`);
  }

  const year = Number.parseInt(rawYear, 10);
  const month = Number.parseInt(rawMonth, 10);
  const day = Number.parseInt(rawDay, 10);

  if (month < 1 || month > 12) throw new RangeError(`Month out of range in ${date}`);
  if (day < 1 || day > 31) throw new RangeError(`Day out of range in ${date}`);

  return { year, month, day };
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** Formats wall-clock fields back to a `YYYY-MM-DD` key. */
export function toLocalDate(wall: Pick<WallFields, 'year' | 'month' | 'day'>): LocalDate {
  return `${String(wall.year).padStart(4, '0')}-${pad2(wall.month)}-${pad2(wall.day)}`;
}

/** The calendar date an instant falls on, as seen from `timeZone`. */
export function localDateAt(instant: Instant, timeZone: TimeZoneId): LocalDate {
  return toLocalDate(wallFieldsAt(instant, timeZone));
}

/** Minutes since local midnight for an instant, as seen from `timeZone`. */
export function minuteOfDayAt(instant: Instant, timeZone: TimeZoneId): number {
  const wall = wallFieldsAt(instant, timeZone);
  return wall.hour * 60 + wall.minute;
}

/** Advances a `YYYY-MM-DD` key by whole days, using proleptic Gregorian arithmetic. */
export function addDays(date: LocalDate, days: number): LocalDate {
  const { year, month, day } = parseLocalDate(date);
  const cursor = new Date(0);
  cursor.setUTCFullYear(year, month - 1, day);
  cursor.setUTCHours(0, 0, 0, 0);
  cursor.setUTCDate(cursor.getUTCDate() + days);
  return toLocalDate({
    year: cursor.getUTCFullYear(),
    month: cursor.getUTCMonth() + 1,
    day: cursor.getUTCDate(),
  });
}

/**
 * The short zone abbreviation in force at an instant — `EDT`, `EST`, `GMT+5:30`.
 *
 * Used to disambiguate the repeated hour at a fall-back transition, where two slots are
 * otherwise labelled identically.
 */
export function zoneAbbreviation(instant: Instant, timeZone: TimeZoneId): string {
  const parts = abbreviationFormatter(timeZone).formatToParts(new Date(instant));
  for (const part of parts) {
    if (part.type === 'timeZoneName') return part.value;
  }
  return formatOffsetLabel(getOffsetMs(instant, timeZone));
}

/** Formats an offset in milliseconds as `+05:30` / `-04:00` / `Z`. */
export function formatOffsetLabel(offsetMs: number): string {
  if (offsetMs === 0) return 'Z';
  const sign = offsetMs < 0 ? '-' : '+';
  const totalMinutes = Math.abs(Math.trunc(offsetMs / MS_PER_MINUTE));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${sign}${pad2(hours)}:${pad2(minutes)}`;
}
