/**
 * Grid geometry.
 *
 * The canvas layer and the DOM accessibility layer must agree on where every cell is, to the
 * pixel — if they drift, keyboard focus lands somewhere other than what the eye sees. Both
 * consume this module, so there is one source of truth rather than two implementations that
 * are correct until one of them is edited.
 */

export interface GridMetrics {
  readonly columns: number;
  readonly rows: number;
  readonly columnWidth: number;
  readonly rowHeight: number;
  /** Room for the time labels down the left edge. */
  readonly gutter: number;
  /** Room for the day labels along the top. */
  readonly header: number;
  readonly gap: number;
  readonly width: number;
  readonly height: number;
}

export interface CellRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface CellAddress {
  readonly column: number;
  readonly row: number;
}

// Wide enough for "12:00 AM" on one line *plus* the daylight rail that runs between the labels
// and the first column. At 62 the label wrapped onto two lines the moment the rail took its 4px.
const GUTTER = 74;
const HEADER = 44;
const GAP = 2;
const MIN_COLUMN_WIDTH = 44;
const MAX_COLUMN_WIDTH = 132;
const MIN_ROW_HEIGHT = 22;
const MAX_ROW_HEIGHT = 34;

export interface MetricsInput {
  readonly columns: number;
  readonly rows: number;
  /** Space the grid may occupy. Columns shrink to fit, down to a floor. */
  readonly availableWidth: number;
  readonly compact?: boolean;
}

export function computeMetrics(input: MetricsInput): GridMetrics {
  const { columns, rows, availableWidth } = input;
  const gutter = input.compact === true ? 62 : GUTTER;

  if (columns <= 0 || rows <= 0) {
    return {
      columns: 0,
      rows: 0,
      columnWidth: 0,
      rowHeight: 0,
      gutter,
      header: HEADER,
      gap: GAP,
      width: gutter,
      height: HEADER,
    };
  }

  const usable = Math.max(0, availableWidth - gutter);
  const ideal = usable / columns;
  // Below the floor the grid scrolls horizontally instead of shrinking further: a 20px-wide
  // column cannot be hit reliably with a thumb, and an unreadable grid is worse than a
  // scrollable one.
  const columnWidth = Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, ideal)));

  // Taller rows when there are few of them, so a short room does not render as a thin strip.
  const rowHeight = Math.round(
    Math.min(MAX_ROW_HEIGHT, Math.max(MIN_ROW_HEIGHT, 720 / Math.max(rows, 1))),
  );

  return {
    columns,
    rows,
    columnWidth,
    rowHeight,
    gutter,
    header: HEADER,
    gap: GAP,
    width: gutter + columnWidth * columns,
    height: HEADER + rowHeight * rows,
  };
}

export function cellRect(metrics: GridMetrics, column: number, row: number): CellRect {
  return {
    x: metrics.gutter + column * metrics.columnWidth,
    y: metrics.header + row * metrics.rowHeight,
    width: metrics.columnWidth - metrics.gap,
    height: metrics.rowHeight - metrics.gap,
  };
}

/**
 * Resolves a point to a cell by arithmetic rather than hit-testing.
 *
 * Hit-testing 672 rectangles per pointer event is the thing that makes a drag feel heavy on a
 * mid-range phone. Two divisions do not.
 */
export function cellAtPoint(metrics: GridMetrics, x: number, y: number): CellAddress | null {
  if (x < metrics.gutter || y < metrics.header) return null;

  const column = Math.floor((x - metrics.gutter) / metrics.columnWidth);
  const row = Math.floor((y - metrics.header) / metrics.rowHeight);

  if (column < 0 || column >= metrics.columns) return null;
  if (row < 0 || row >= metrics.rows) return null;

  return { column, row };
}

/**
 * Every cell on the straight line between two addresses.
 *
 * A drag reports positions, not paths. Without interpolating, a fast flick paints only the
 * cells that happened to fall under a sampled pointer position and leaves gaps through the
 * ones it crossed between them.
 */
export function cellsBetween(from: CellAddress, to: CellAddress): CellAddress[] {
  const cells: CellAddress[] = [];
  const columnStep = Math.sign(to.column - from.column);
  const rowStep = Math.sign(to.row - from.row);
  const columnSpan = Math.abs(to.column - from.column);
  const rowSpan = Math.abs(to.row - from.row);
  const steps = Math.max(columnSpan, rowSpan);

  if (steps === 0) return [to];

  for (let step = 1; step <= steps; step += 1) {
    cells.push({
      column: from.column + columnStep * Math.round((columnSpan * step) / steps),
      row: from.row + rowStep * Math.round((rowSpan * step) / steps),
    });
  }
  return cells;
}

/** Every cell in the rectangle spanned by two corners, for Shift-extended keyboard painting. */
export function cellsInRectangle(from: CellAddress, to: CellAddress): CellAddress[] {
  const cells: CellAddress[] = [];
  const columnStart = Math.min(from.column, to.column);
  const columnEnd = Math.max(from.column, to.column);
  const rowStart = Math.min(from.row, to.row);
  const rowEnd = Math.max(from.row, to.row);

  for (let column = columnStart; column <= columnEnd; column += 1) {
    for (let row = rowStart; row <= rowEnd; row += 1) {
      cells.push({ column, row });
    }
  }
  return cells;
}
