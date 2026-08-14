/**
 * The daylight rail — Overlap's signature element.
 *
 * A low-chroma band down the time gutter, shading from night through dawn to midday and back to
 * dusk, so you can feel what part of the day you are looking at before reading a label. It is
 * built from the viewer's own rows, which is what makes it an argument rather than decoration:
 * two people in different timezones open the same room and each sees their own daylight against
 * the same instants.
 *
 * It lives *outside* the grid plane deliberately. Inside it, a second colour system would fight
 * the heat ramp — one hue climbing in lightness so the busiest cell dominates — and neither
 * would rank. See DESIGN.md §2.
 */

const NIGHT = 'var(--daylight-night)';
const DAWN = 'var(--daylight-dawn)';
const NOON = 'var(--daylight-noon)';
const DUSK = 'var(--daylight-dusk)';

const HOUR = 60;

/** Which part of the day a wall-clock minute falls in. */
export function daylightBand(minuteOfDay: number): string {
  // Normalised because a grid that wraps past midnight carries minutes from two calendar days.
  const minute = ((minuteOfDay % (24 * HOUR)) + 24 * HOUR) % (24 * HOUR);
  if (minute < 5 * HOUR) return NIGHT;
  if (minute < 8 * HOUR) return DAWN;
  if (minute < 17 * HOUR) return NOON;
  if (minute < 20 * HOUR) return DUSK;
  return NIGHT;
}

/**
 * A gradient with one stop per row, placed at that row's midpoint.
 *
 * Per-row rather than computed from a start and end time because the rows are not guaranteed to
 * be monotonic — a room that spans midnight is cut at its widest gap, so the sequence can wrap.
 * Emitting a stop per row makes the wrap a non-issue instead of a special case.
 */
export function daylightGradient(minutesPerRow: readonly number[]): string {
  const count = minutesPerRow.length;
  if (count === 0) return 'transparent';
  if (count === 1) return daylightBand(minutesPerRow[0] ?? 0);

  const stops = minutesPerRow.map((minute, index) => {
    const percent = ((index + 0.5) / count) * 100;
    return `${daylightBand(minute)} ${percent.toFixed(2)}%`;
  });

  return `linear-gradient(to bottom, ${stops.join(', ')})`;
}
