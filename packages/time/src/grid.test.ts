import { describe, expect, it } from 'vitest';
import { buildViewerGrid, type ViewerGrid } from './grid.js';
import { materializeSlots, type RoomShape } from './slots.js';

const WEEK_IN_NEW_YORK: RoomShape = {
  anchorZone: 'America/New_York',
  dates: [
    '2026-08-20',
    '2026-08-21',
    '2026-08-22',
    '2026-08-23',
    '2026-08-24',
    '2026-08-25',
    '2026-08-26',
  ],
  dayStartMinute: 9 * 60,
  dayEndMinute: 17 * 60,
  slotMinutes: 30,
};

function occupiedCells(grid: ViewerGrid): number {
  return grid.cells.flat().filter((cell) => cell !== null).length;
}

describe('buildViewerGrid — the same instants, arranged for each viewer', () => {
  const slots = materializeSlots(WEEK_IN_NEW_YORK).slots;

  it('renders the host their own seven columns', () => {
    const grid = buildViewerGrid(slots, 'America/New_York');
    expect(grid.columns).toHaveLength(7);
    expect(grid.rows).toHaveLength(16);
    expect(grid.columns[0]?.dateKey).toBe('2026-08-20');
    expect(grid.rows[0]?.label).toBe('9:00 AM');
    expect(occupiedCells(grid)).toBe(112);
  });

  it('renders the same room as eight columns for a viewer in Tokyo', () => {
    // 9am-5pm in New York is 10pm-6am in Tokyo, so those instants genuinely straddle eight
    // Tokyo dates. Nothing special-cases this — it falls out of grouping by the viewer's date.
    const grid = buildViewerGrid(slots, 'Asia/Tokyo');
    expect(grid.columns).toHaveLength(8);
    expect(grid.columns[0]?.dateKey).toBe('2026-08-20');
    expect(grid.columns[7]?.dateKey).toBe('2026-08-27');

    // The instants themselves are unchanged; only their arrangement is.
    expect(occupiedCells(grid)).toBe(112);
  });

  it('keeps an overnight block contiguous instead of splitting it around midnight', () => {
    // Sorting rows from 00:00 upward would put 22:00-23:30 at the bottom of the grid and
    // 00:00-05:30 at the top, with eighteen empty hours in between.
    const grid = buildViewerGrid(slots, 'Asia/Tokyo');
    expect(grid.rows).toHaveLength(16);
    expect(grid.rows[0]?.minuteOfDay).toBe(22 * 60);
    expect(grid.rows[0]?.label).toBe('10:00 PM');
    expect(grid.rows[15]?.minuteOfDay).toBe(5 * 60 + 30);
    expect(grid.rows[15]?.label).toBe('5:30 AM');
  });

  it('preserves every instant regardless of the viewer zone', () => {
    const canonical = new Set(slots.map((slot) => slot.instant));
    for (const zone of ['America/New_York', 'Asia/Tokyo', 'Pacific/Chatham', 'Europe/London']) {
      const rendered = new Set(
        buildViewerGrid(slots, zone)
          .cells.flat()
          .flatMap((cell) => (cell ? [cell.instant] : [])),
      );
      expect(rendered).toEqual(canonical);
    }
  });
});

describe('buildViewerGrid — DST in the viewer zone', () => {
  it('gives the repeated hour its own row and labels the two apart', () => {
    // The room is anchored in Kolkata, which has never observed DST. The repeated hour is
    // created entirely by the *viewer's* zone falling back — so this cannot be handled by
    // looking at the room's own zone.
    const slots = materializeSlots({
      anchorZone: 'Asia/Kolkata',
      dates: ['2026-11-01'],
      dayStartMinute: 9 * 60,
      dayEndMinute: 13 * 60,
      slotMinutes: 30,
    }).slots;
    expect(slots).toHaveLength(8);

    const grid = buildViewerGrid(slots, 'America/New_York');

    // Those eight instants land across two New York dates.
    expect(grid.columns.map((column) => column.dateKey)).toEqual(['2026-10-31', '2026-11-01']);

    // 1:00 AM and 1:30 AM each happen twice, so each gets a second row.
    const repeatedRows = grid.rows.filter((row) => row.occurrence === 1);
    expect(repeatedRows.map((row) => row.label)).toEqual(['1:00 AM', '1:30 AM']);

    const novemberFirst = grid.cells[1] ?? [];
    const oneAmCells = novemberFirst.filter((cell) => cell?.isRepeatedHour === true);
    expect(oneAmCells).toHaveLength(4); // two rows x two occurrences

    const abbreviations = new Set(oneAmCells.map((cell) => cell?.abbreviation));
    expect(abbreviations).toEqual(new Set(['EDT', 'EST']));

    // Every instant survives the projection.
    expect(occupiedCells(grid)).toBe(8);
  });

  it('leaves a hole where the room spans an hour that does not exist for the viewer', () => {
    const slots = materializeSlots({
      anchorZone: 'America/New_York',
      dates: ['2026-03-08'],
      dayStartMinute: 0,
      dayEndMinute: 6 * 60,
      slotMinutes: 30,
    }).slots;

    const grid = buildViewerGrid(slots, 'America/New_York');
    // The two non-existent wall times are simply absent — the grid never invents them.
    expect(occupiedCells(grid)).toBe(10);
    expect(grid.rows.map((row) => row.label)).not.toContain('2:00 AM');
    expect(grid.rows.map((row) => row.label)).not.toContain('2:30 AM');
  });

  it('marks ordinary cells as not repeated and skips the abbreviation lookup', () => {
    const slots = materializeSlots(WEEK_IN_NEW_YORK).slots;
    const grid = buildViewerGrid(slots, 'America/New_York');
    const cell = grid.cells[0]?.[0];
    expect(cell?.isRepeatedHour).toBe(false);
    expect(cell?.abbreviation).toBeNull();
  });
});

describe('buildViewerGrid — degenerate inputs', () => {
  it('returns an empty grid for no slots', () => {
    const grid = buildViewerGrid([], 'UTC');
    expect(grid.rows).toHaveLength(0);
    expect(grid.columns).toHaveLength(0);
    expect(grid.cells).toHaveLength(0);
  });

  it('handles a single slot', () => {
    const slots = materializeSlots({
      anchorZone: 'UTC',
      dates: ['2026-08-20'],
      dayStartMinute: 600,
      dayEndMinute: 660,
      slotMinutes: 60,
    }).slots;
    const grid = buildViewerGrid(slots, 'UTC');
    expect(grid.columns).toHaveLength(1);
    expect(grid.rows).toHaveLength(1);
    expect(grid.cells[0]?.[0]?.instant).toBe(Date.UTC(2026, 7, 20, 10));
  });
});
