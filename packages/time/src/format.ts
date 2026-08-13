import type { Instant, TimeZoneId } from './types.js';

/**
 * ICU separates the time from the day period with U+202F (narrow no-break space) and uses
 * U+00A0 in several locales. Both are invisible in a diff, break naive string comparison in
 * tests, and are not what anyone copying a time out of the UI expects to paste. Normalised to
 * a plain space at the single point where formatted output leaves this package.
 */
const NARROW_SPACES = /[\u202F\u00A0]/g;

interface FormatterKey {
  readonly locale: string;
  readonly timeZone: TimeZoneId;
  readonly variant: string;
}

const cache = new Map<string, Intl.DateTimeFormat>();

function formatter(key: FormatterKey, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const id = `${key.locale}|${key.timeZone}|${key.variant}`;
  const cached = cache.get(id);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat(key.locale, { ...options, timeZone: key.timeZone });
  cache.set(id, created);
  return created;
}

function render(
  instant: Instant,
  timeZone: TimeZoneId,
  locale: string,
  variant: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return formatter({ locale, timeZone, variant }, options)
    .format(new Date(instant))
    .replace(NARROW_SPACES, ' ');
}

/** `2:30 PM`, or the locale's equivalent. */
export function formatTimeOfDay(instant: Instant, timeZone: TimeZoneId, locale = 'en-US'): string {
  return render(instant, timeZone, locale, 'time', { hour: 'numeric', minute: '2-digit' });
}

/** `Thu` */
export function formatWeekdayShort(
  instant: Instant,
  timeZone: TimeZoneId,
  locale = 'en-US',
): string {
  return render(instant, timeZone, locale, 'weekday', { weekday: 'short' });
}

/** `Thursday` */
export function formatWeekdayLong(
  instant: Instant,
  timeZone: TimeZoneId,
  locale = 'en-US',
): string {
  return render(instant, timeZone, locale, 'weekdayLong', { weekday: 'long' });
}

/** `20 Aug` */
export function formatDayAndMonth(
  instant: Instant,
  timeZone: TimeZoneId,
  locale = 'en-US',
): string {
  return render(instant, timeZone, locale, 'dayMonth', { day: 'numeric', month: 'short' });
}

/** `Thursday, 20 August` */
export function formatFullDate(instant: Instant, timeZone: TimeZoneId, locale = 'en-US'): string {
  return render(instant, timeZone, locale, 'fullDate', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

/**
 * `Thursday, 20 August, 2:30 PM to 3:00 PM`
 *
 * The spoken form used by the accessibility layer's cell labels, so it deliberately reads as
 * a sentence rather than as a compact UI string.
 */
export function formatSlotRange(
  instant: Instant,
  durationMs: number,
  timeZone: TimeZoneId,
  locale = 'en-US',
): string {
  const start = formatTimeOfDay(instant, timeZone, locale);
  const end = formatTimeOfDay(instant + durationMs, timeZone, locale);
  return `${formatFullDate(instant, timeZone, locale)}, ${start} to ${end}`;
}
