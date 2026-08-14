import { describe, expect, it } from 'vitest';
import { daylightBand, daylightGradient } from './daylight.js';

const NIGHT = 'var(--daylight-night)';
const DAWN = 'var(--daylight-dawn)';
const NOON = 'var(--daylight-noon)';
const DUSK = 'var(--daylight-dusk)';

describe('daylightBand', () => {
  it('maps each part of the day to its own band', () => {
    expect(daylightBand(0)).toBe(NIGHT);
    expect(daylightBand(4 * 60 + 59)).toBe(NIGHT);
    expect(daylightBand(5 * 60)).toBe(DAWN);
    expect(daylightBand(7 * 60 + 59)).toBe(DAWN);
    expect(daylightBand(8 * 60)).toBe(NOON);
    expect(daylightBand(16 * 60 + 59)).toBe(NOON);
    expect(daylightBand(17 * 60)).toBe(DUSK);
    expect(daylightBand(19 * 60 + 59)).toBe(DUSK);
    expect(daylightBand(20 * 60)).toBe(NIGHT);
    expect(daylightBand(23 * 60 + 59)).toBe(NIGHT);
  });

  it('wraps rather than falling off either end', () => {
    // A grid spanning midnight carries minutes from two calendar days, and the row origin is
    // cut at the widest gap, so both of these genuinely occur.
    expect(daylightBand(24 * 60)).toBe(NIGHT);
    expect(daylightBand(25 * 60)).toBe(NIGHT);
    expect(daylightBand(32 * 60)).toBe(NOON);
    expect(daylightBand(-60)).toBe(NIGHT);
    expect(daylightBand(-5 * 60)).toBe(DUSK);
  });
});

describe('daylightGradient', () => {
  it('is transparent with no rows', () => {
    expect(daylightGradient([])).toBe('transparent');
  });

  it('is a flat colour with a single row', () => {
    expect(daylightGradient([12 * 60])).toBe(NOON);
  });

  it('places one stop per row at that row s midpoint', () => {
    const gradient = daylightGradient([0, 12 * 60]);
    expect(gradient).toBe(`linear-gradient(to bottom, ${NIGHT} 25.00%, ${NOON} 75.00%)`);
  });

  it('climbs through the day across a morning-to-evening room', () => {
    const rows = [6 * 60, 9 * 60, 12 * 60, 18 * 60, 22 * 60];
    const gradient = daylightGradient(rows);
    expect(gradient.indexOf(DAWN)).toBeLessThan(gradient.indexOf(NOON));
    expect(gradient.indexOf(NOON)).toBeLessThan(gradient.indexOf(DUSK));
    expect(gradient.indexOf(DUSK)).toBeLessThan(gradient.lastIndexOf(NIGHT));
  });

  it('handles a grid whose rows wrap past midnight', () => {
    const rows = [22 * 60, 23 * 60, 0, 60];
    expect(() => daylightGradient(rows)).not.toThrow();
    expect(daylightGradient(rows).startsWith('linear-gradient(to bottom,')).toBe(true);
  });
});
