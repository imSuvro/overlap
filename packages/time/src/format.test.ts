import { describe, expect, it } from 'vitest';
import {
  formatDayAndMonth,
  formatFullDate,
  formatSlotRange,
  formatTimeOfDay,
  formatWeekdayLong,
  formatWeekdayShort,
} from './format.js';

// 2026-08-20 18:30 UTC. Deliberately an instant that lands on different calendar days in
// different zones, so every assertion here is also a cross-timezone assertion.
const INSTANT = Date.UTC(2026, 7, 20, 18, 30);
const HALF_HOUR = 1_800_000;

describe('formatTimeOfDay', () => {
  it('renders the same instant in each viewer’s own zone', () => {
    expect(formatTimeOfDay(INSTANT, 'America/New_York')).toBe('2:30 PM');
    expect(formatTimeOfDay(INSTANT, 'UTC')).toBe('6:30 PM');
    expect(formatTimeOfDay(INSTANT, 'Asia/Kolkata')).toBe('12:00 AM');
    expect(formatTimeOfDay(INSTANT, 'Asia/Tokyo')).toBe('3:30 AM');
  });

  it('normalises the narrow no-break space ICU emits before the day period', () => {
    // U+202F is invisible in a diff and breaks naive string comparison, including for anyone
    // pasting a time out of the UI.
    const rendered = formatTimeOfDay(INSTANT, 'America/New_York');
    expect(rendered).not.toMatch(/[\u202F\u00A0]/);
    expect(rendered.split(' ')).toHaveLength(2);
  });

  it('honours a non-US locale', () => {
    expect(formatTimeOfDay(INSTANT, 'Europe/Berlin', 'de-DE')).toBe('20:30');
  });
});

describe('weekday and date formatting', () => {
  it('renders short and long weekdays', () => {
    expect(formatWeekdayShort(INSTANT, 'America/New_York')).toBe('Thu');
    expect(formatWeekdayLong(INSTANT, 'America/New_York')).toBe('Thursday');
  });

  it('rolls the weekday forward for a viewer already on the next day', () => {
    expect(formatWeekdayShort(INSTANT, 'Asia/Tokyo')).toBe('Fri');
    expect(formatWeekdayLong(INSTANT, 'Asia/Tokyo')).toBe('Friday');
  });

  it('renders the day and month', () => {
    expect(formatDayAndMonth(INSTANT, 'America/New_York')).toBe('Aug 20');
    expect(formatDayAndMonth(INSTANT, 'Asia/Tokyo')).toBe('Aug 21');
  });

  it('renders a full spoken date', () => {
    expect(formatFullDate(INSTANT, 'America/New_York')).toBe('Thursday, August 20');
  });
});

describe('formatSlotRange', () => {
  it('reads as a sentence, for the screen-reader label', () => {
    expect(formatSlotRange(INSTANT, HALF_HOUR, 'America/New_York')).toBe(
      'Thursday, August 20, 2:30 PM to 3:00 PM',
    );
  });

  it('crosses midnight without losing the start date', () => {
    // The label names the day the slot *starts* on, which is what someone scanning the grid
    // is looking for.
    const lateNight = Date.UTC(2026, 7, 21, 3, 45); // 11:45 PM on the 20th in New York
    expect(formatSlotRange(lateNight, HALF_HOUR, 'America/New_York')).toBe(
      'Thursday, August 20, 11:45 PM to 12:15 AM',
    );
  });

  it('describes the same slot correctly for a viewer a day ahead', () => {
    expect(formatSlotRange(INSTANT, HALF_HOUR, 'Asia/Tokyo')).toBe(
      'Friday, August 21, 3:30 AM to 4:00 AM',
    );
  });
});
