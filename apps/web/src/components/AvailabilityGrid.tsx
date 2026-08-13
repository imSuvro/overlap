import { LEVEL, type Level, type Participant, type Presence } from '@overlap/protocol';
import { slotScore, type RoomState } from '@overlap/room-core';
import { formatSlotRange, slotDurationMs, type SlotMinutes, type ViewerGrid } from '@overlap/time';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  cellAtPoint,
  cellRect,
  cellsBetween,
  cellsInRectangle,
  computeMetrics,
  type CellAddress,
  type GridMetrics,
} from '../lib/layout.js';
import { heatColour, readPalette, type Palette } from '../lib/palette.js';
import { PresenceLayer } from './PresenceLayer.js';

export interface AvailabilityGridProps {
  readonly grid: ViewerGrid;
  readonly state: RoomState;
  readonly participants: readonly Participant[];
  readonly participantId: string;
  readonly slotMinutes: SlotMinutes;
  readonly viewerZone: string;
  readonly paintLevel: Level;
  readonly finalizedInstant: number | null;
  readonly peers: readonly Presence[];
  readonly commitVersion: number;
  readonly onPaint: (entries: readonly { instant: number; level: Level }[]) => void;
  readonly onBeginDrag: () => void;
  readonly onEndDrag: () => void;
  readonly onCursor: (cursor: { x: number; y: number } | null, hovered: number | null) => void;
}

interface DragState {
  readonly level: Level;
  last: CellAddress;
}

/** High-DPI phones gain nothing visible above 2x here, and pay for it in fill rate. */
const MAX_DEVICE_PIXEL_RATIO = 2;

export function AvailabilityGrid(props: AvailabilityGridProps): React.JSX.Element {
  const { grid, state, participants, participantId, slotMinutes, viewerZone } = props;

  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const paletteRef = useRef<Palette | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const hoveredRef = useRef<CellAddress | null>(null);
  const frameRef = useRef<number | null>(null);

  /** Cached per-cell scores, recomputed only when the CRDT actually changed. */
  const scoresRef = useRef<{ version: number; scores: number[]; peak: number } | null>(null);

  const [availableWidth, setAvailableWidth] = useState(960);
  const [focused, setFocused] = useState<CellAddress>({ column: 0, row: 0 });

  const participantIds = useMemo(
    () => participants.map((participant) => participant.participantId),
    [participants],
  );

  const metrics = useMemo(
    () =>
      computeMetrics({
        columns: grid.columns.length,
        rows: grid.rows.length,
        availableWidth,
        compact: availableWidth < 520,
      }),
    [grid.columns.length, grid.rows.length, availableWidth],
  );

  const durationMs = slotDurationMs(slotMinutes);

  useLayoutEffect(() => {
    const stage = stageRef.current?.parentElement;
    if (!stage) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setAvailableWidth(entry.contentRect.width);
    });
    observer.observe(stage);
    setAvailableWidth(stage.clientWidth);
    return () => {
      observer.disconnect();
    };
  }, []);

  // --------------------------------------------------------------- painting

  /**
   * Indirection through a ref so `requestPaint` can stay referentially stable.
   *
   * Memoising `requestPaint` with an empty dependency list would otherwise freeze it around
   * the *first* render's `draw` — the one that ran before the grid had been measured — and the
   * canvas would never repaint at its real size. Reading the current `draw` at call time keeps
   * one identity for the pointer handlers and always paints with current geometry.
   */
  const drawRef = useRef<() => void>(() => undefined);

  const requestPaint = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      drawRef.current();
    });
  }, []);

  /**
   * Recomputes per-cell scores only when the CRDT version has moved.
   *
   * Scoring every cell against every participant on every frame is the one genuinely
   * superlinear thing in the render path, and during a drag the state changes far less often
   * than the pointer moves.
   */
  const ensureScores = useCallback((): { scores: number[]; peak: number } => {
    const version = state.availability.version;
    const cached = scoresRef.current;
    if (cached?.version === version) return cached;

    const scores = new Array<number>(metrics.columns * metrics.rows).fill(0);
    let peak = 0;

    for (let column = 0; column < metrics.columns; column += 1) {
      const cells = grid.cells[column];
      if (!cells) continue;
      for (let row = 0; row < metrics.rows; row += 1) {
        const cell = cells[row];
        if (!cell) continue;
        const score = slotScore(state, participantIds, cell.instant);
        scores[column * metrics.rows + row] = score;
        if (score > peak) peak = score;
      }
    }

    const computed = { version, scores, peak };
    scoresRef.current = computed;
    return computed;
  }, [state, metrics, grid, participantIds]);

  const draw = useCallback((): void => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    paletteRef.current ??= readPalette(stage);
    const palette = paletteRef.current;

    const ratio = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
    const pixelWidth = Math.round(metrics.width * ratio);
    const pixelHeight = Math.round(metrics.height * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, metrics.width, metrics.height);

    const scores = ensureScores();

    for (let column = 0; column < metrics.columns; column += 1) {
      const cells = grid.cells[column];
      if (!cells) continue;

      for (let row = 0; row < metrics.rows; row += 1) {
        const cell = cells[row];
        const rect = cellRect(metrics, column, row);
        const index = column * metrics.rows + row;

        if (!cell) {
          // Not an error: either the edge of the room's daily window as it lands in this
          // viewer's zone, or an hour that genuinely does not exist because the clocks moved.
          // Hatching says "nothing can happen here" without pretending it is merely empty.
          drawVoid(context, rect, palette);
          continue;
        }

        const score = scores.scores[index] ?? 0;
        context.fillStyle = heatColour(palette, score, scores.peak);
        roundedRect(context, rect.x, rect.y, rect.width, rect.height, 3);
        context.fill();

        const mine = state.levelFor(participantId, cell.instant);
        if (mine !== LEVEL.unavailable) drawMyMark(context, rect, palette, mine);

        if (props.finalizedInstant === cell.instant) {
          context.strokeStyle = palette.ink;
          context.lineWidth = 2;
          roundedRect(context, rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2, 3);
          context.stroke();
        }
      }
    }

    const hovered = hoveredRef.current;
    if (hovered) {
      const rect = cellRect(metrics, hovered.column, hovered.row);
      context.strokeStyle = palette.accent;
      context.lineWidth = 2;
      roundedRect(context, rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2, 3);
      context.stroke();
    }
  }, [metrics, grid, participantId, props.finalizedInstant, state, ensureScores]);

  drawRef.current = draw;

  useEffect(() => {
    paletteRef.current = null;
    requestPaint();
  }, [props.commitVersion, metrics, grid, requestPaint]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onSchemeChange = (): void => {
      paletteRef.current = null;
      requestPaint();
    };

    /*
     * Browsers do not run animation frames in a hidden page, so a room opened in a background
     * tab — cmd-clicked from a chat, which is exactly how these links get shared — would have
     * queued its first paint and never run it. Repainting when the tab is revealed is what
     * makes the grid there on arrival rather than after the first stray event.
     */
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') requestPaint();
    };

    media.addEventListener('change', onSchemeChange);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      media.removeEventListener('change', onSchemeChange);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [requestPaint]);

  // --------------------------------------------------------------- interaction

  const instantAt = useCallback(
    (address: CellAddress): number | null =>
      grid.cells[address.column]?.[address.row]?.instant ?? null,
    [grid],
  );

  const applyCells = useCallback(
    (addresses: readonly CellAddress[], level: Level): void => {
      const entries: { instant: number; level: Level }[] = [];
      for (const address of addresses) {
        const instant = instantAt(address);
        if (instant !== null) entries.push({ instant, level });
      }
      if (entries.length > 0) {
        props.onPaint(entries);
        requestPaint();
      }
    },
    [instantAt, props, requestPaint],
  );

  const pointFromEvent = useCallback(
    (event: React.PointerEvent | PointerEvent): CellAddress | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const bounds = canvas.getBoundingClientRect();
      return cellAtPoint(
        metricsRef.current,
        event.clientX - bounds.left,
        event.clientY - bounds.top,
      );
    },
    [],
  );

  // Kept in a ref so the pointer handlers do not need to be recreated when metrics change.
  const metricsRef = useRef<GridMetrics>(metrics);
  metricsRef.current = metrics;

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>): void => {
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      const address = pointFromEvent(event);
      if (!address) return;
      const instant = instantAt(address);
      if (instant === null) return;

      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();

      // Spreadsheet behaviour: starting on a cell you already painted erases instead, so one
      // gesture both fills and clears and there is no mode to remember.
      const current = state.levelFor(participantId, instant);
      const level: Level = current === props.paintLevel ? LEVEL.unavailable : props.paintLevel;

      dragRef.current = { level, last: address };
      setFocused(address);
      props.onBeginDrag();
      applyCells([address], level);
    },
    [applyCells, instantAt, participantId, pointFromEvent, props, state],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>): void => {
      const address = pointFromEvent(event);

      if (address !== hoveredRef.current) {
        hoveredRef.current = address;
        requestPaint();

        const canvas = canvasRef.current;
        if (canvas) {
          const bounds = canvas.getBoundingClientRect();
          props.onCursor(
            {
              x: clamp01((event.clientX - bounds.left) / Math.max(bounds.width, 1)),
              y: clamp01((event.clientY - bounds.top) / Math.max(bounds.height, 1)),
            },
            address ? instantAt(address) : null,
          );
        }
      }

      const drag = dragRef.current;
      if (!drag) return;

      // Coalesced events recover the positions the browser batched between frames. Without
      // them a fast flick paints only where the pointer happened to be sampled and skips the
      // cells it crossed in between.
      const points =
        'getCoalescedEvents' in event.nativeEvent ? event.nativeEvent.getCoalescedEvents() : [];
      const path = points.length > 0 ? points : [event.nativeEvent];

      const touched: CellAddress[] = [];
      for (const point of path) {
        const next = pointFromEvent(point);
        if (!next) continue;
        for (const between of cellsBetween(drag.last, next)) touched.push(between);
        drag.last = next;
      }
      if (touched.length > 0) applyCells(touched, drag.level);
    },
    [applyCells, instantAt, pointFromEvent, props, requestPaint],
  );

  const endDrag = useCallback((): void => {
    if (!dragRef.current) return;
    dragRef.current = null;
    props.onEndDrag();
  }, [props]);

  const handlePointerLeave = useCallback((): void => {
    hoveredRef.current = null;
    props.onCursor(null, null);
    requestPaint();
  }, [props, requestPaint]);

  // --------------------------------------------------------------- keyboard

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>, address: CellAddress): void => {
      const move = (columnDelta: number, rowDelta: number): void => {
        const next: CellAddress = {
          column: clamp(address.column + columnDelta, 0, metrics.columns - 1),
          row: clamp(address.row + rowDelta, 0, metrics.rows - 1),
        };
        event.preventDefault();

        // Shift extends a painted selection, mirroring what a drag does with a pointer, so the
        // keyboard path is a peer of the mouse path rather than a reduced version of it.
        if (event.shiftKey) {
          const instant = instantAt(address);
          const level =
            instant !== null && state.levelFor(participantId, instant) === props.paintLevel
              ? props.paintLevel
              : props.paintLevel;
          applyCells(cellsInRectangle(address, next), level);
        }

        setFocused(next);
        focusCell(next);
      };

      switch (event.key) {
        case 'ArrowLeft':
          move(-1, 0);
          break;
        case 'ArrowRight':
          move(1, 0);
          break;
        case 'ArrowUp':
          move(0, -1);
          break;
        case 'ArrowDown':
          move(0, 1);
          break;
        case 'Home':
          event.preventDefault();
          setFocused({ column: 0, row: address.row });
          focusCell({ column: 0, row: address.row });
          break;
        case 'End':
          event.preventDefault();
          setFocused({ column: metrics.columns - 1, row: address.row });
          focusCell({ column: metrics.columns - 1, row: address.row });
          break;
        case ' ':
        case 'Enter': {
          event.preventDefault();
          const instant = instantAt(address);
          if (instant === null) return;
          const current = state.levelFor(participantId, instant);
          applyCells(
            [address],
            current === props.paintLevel ? LEVEL.unavailable : props.paintLevel,
          );
          props.onEndDrag();
          break;
        }
        default:
          break;
      }
    },
    [applyCells, instantAt, metrics, participantId, props, state],
  );

  // --------------------------------------------------------------- render

  const labelFor = useCallback(
    (column: number, row: number): string => {
      const cell = grid.cells[column]?.[row];
      if (!cell) return 'Not available in your timezone';

      const when = formatSlotRange(cell.instant, durationMs, viewerZone);
      const mine = state.levelFor(participantId, cell.instant);
      const mineText =
        mine === LEVEL.available
          ? 'you are free'
          : mine === LEVEL.ifNeedBe
            ? 'you could make it work'
            : 'you are not free';

      const others = participantIds.filter(
        (id) => id !== participantId && state.levelFor(id, cell.instant) !== LEVEL.unavailable,
      ).length;
      const suffix = cell.abbreviation === null ? '' : `, ${cell.abbreviation}`;

      return `${when}${suffix}. ${mineText}. ${String(others)} other ${others === 1 ? 'person' : 'people'} free.`;
    },
    [grid, durationMs, viewerZone, state, participantId, participantIds],
  );

  return (
    <div className="grid-scroll">
      <div
        className="grid-stage"
        ref={stageRef}
        style={{ width: metrics.width, height: metrics.height }}
      >
        <ColumnHeaders metrics={metrics} grid={grid} />
        <RowLabels metrics={metrics} grid={grid} />

        <canvas
          ref={canvasRef}
          className="grid-stage__canvas"
          style={{ width: metrics.width, height: metrics.height }}
          aria-hidden="true"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerLeave={handlePointerLeave}
        />

        {/*
          The semantic twin of the canvas: one focusable gridcell per slot, invisible but real.
          Rebuilt only when `commitVersion` moves, never during a drag.
        */}
        <div
          className="grid-a11y"
          role="grid"
          aria-label="Availability grid"
          aria-rowcount={metrics.rows}
          aria-colcount={metrics.columns}
        >
          {grid.rows.map((gridRow, row) => (
            <div role="row" key={`${gridRow.minuteOfDay}#${gridRow.occurrence}`}>
              {grid.columns.map((column, columnIndex) => {
                const rect = cellRect(metrics, columnIndex, row);
                const cell = grid.cells[columnIndex]?.[row];
                const isFocusTarget = focused.column === columnIndex && focused.row === row;
                return (
                  <button
                    key={column.dateKey}
                    type="button"
                    role="gridcell"
                    id={cellDomId(columnIndex, row)}
                    className="grid-a11y__cell"
                    style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
                    // Roving tabindex: one stop for the whole grid, then arrows inside it.
                    tabIndex={isFocusTarget ? 0 : -1}
                    disabled={!cell}
                    aria-label={labelFor(columnIndex, row)}
                    aria-disabled={cell ? undefined : true}
                    onFocus={() => {
                      setFocused({ column: columnIndex, row });
                    }}
                    onKeyDown={(event) => {
                      handleKeyDown(event, { column: columnIndex, row });
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>

        <PresenceLayer peers={props.peers} width={metrics.width} height={metrics.height} />
      </div>
    </div>
  );
}

function ColumnHeaders({
  metrics,
  grid,
}: {
  metrics: GridMetrics;
  grid: ViewerGrid;
}): React.JSX.Element {
  return (
    <div aria-hidden="true">
      {grid.columns.map((column, index) => (
        <div
          key={column.dateKey}
          style={{
            position: 'absolute',
            left: metrics.gutter + index * metrics.columnWidth,
            top: 0,
            width: metrics.columnWidth,
            height: metrics.header,
            display: 'grid',
            placeContent: 'center',
            textAlign: 'center',
            lineHeight: 1.15,
          }}
        >
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-faint)', fontWeight: 600 }}>
            {column.weekdayLabel}
          </span>
          <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{column.dayLabel}</span>
        </div>
      ))}
    </div>
  );
}

function RowLabels({
  metrics,
  grid,
}: {
  metrics: GridMetrics;
  grid: ViewerGrid;
}): React.JSX.Element {
  return (
    <div aria-hidden="true">
      {grid.rows.map((row, index) => {
        // Labelling every half-hour row turns the gutter into noise. On the hour is enough to
        // read the grid, plus the first row so the block always has a stated start.
        const show = row.minuteOfDay % 60 === 0 || index === 0 || row.occurrence > 0;
        if (!show) return null;
        return (
          <div
            key={`${row.minuteOfDay}#${row.occurrence}`}
            style={{
              position: 'absolute',
              left: 0,
              top: metrics.header + index * metrics.rowHeight - 7,
              width: metrics.gutter - 8,
              textAlign: 'right',
              fontSize: 'var(--text-xs)',
              color: 'var(--ink-faint)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {row.label}
          </div>
        );
      })}
    </div>
  );
}

// --------------------------------------------------------------------- drawing helpers

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function drawVoid(
  context: CanvasRenderingContext2D,
  rect: { x: number; y: number; width: number; height: number },
  palette: Palette,
): void {
  context.fillStyle = palette.void;
  roundedRect(context, rect.x, rect.y, rect.width, rect.height, 3);
  context.fill();

  context.save();
  context.clip();
  context.strokeStyle = palette.voidStripe;
  context.lineWidth = 1;
  for (let offset = -rect.height; offset < rect.width; offset += 6) {
    context.beginPath();
    context.moveTo(rect.x + offset, rect.y + rect.height);
    context.lineTo(rect.x + offset + rect.height, rect.y);
    context.stroke();
  }
  context.restore();
}

function drawMyMark(
  context: CanvasRenderingContext2D,
  rect: { x: number; y: number; width: number; height: number },
  palette: Palette,
  level: Level,
): void {
  context.save();
  context.strokeStyle = palette.accent;
  if (level === LEVEL.ifNeedBe) {
    context.lineWidth = 1.5;
    context.setLineDash([3, 2]);
  } else {
    context.lineWidth = 2;
  }
  roundedRect(context, rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2, 3);
  context.stroke();
  context.restore();
}

// --------------------------------------------------------------------- small helpers

function cellDomId(column: number, row: number): string {
  return `cell-${String(column)}-${String(row)}`;
}

/**
 * Moves focus synchronously.
 *
 * Deferring to an animation frame loses races against fast key repeat: an Arrow followed
 * immediately by Space would land on the cell focus had not left yet, toggling it back off
 * instead of painting the next one. Every cell is always in the DOM, so there is nothing to
 * wait for.
 */
function focusCell(address: CellAddress): void {
  document.getElementById(cellDomId(address.column, address.row))?.focus();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}
