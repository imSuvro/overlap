import { expect, type APIRequestContext, type Page } from '@playwright/test';

export interface RoomDraftInput {
  readonly title: string;
  readonly anchorZone: string;
  readonly dates: readonly string[];
  readonly dayStartMinute: number;
  readonly dayEndMinute: number;
  readonly slotMinutes: 15 | 30 | 60;
}

/**
 * The dev server is reached directly; a deployed origin serves the API from the same host as
 * the app, so there is nothing separate to point at.
 */
const API_ORIGIN = process.env.OVERLAP_BASE_URL ?? 'http://127.0.0.1:8787';

/**
 * Creates a room straight through the API.
 *
 * Driving the date picker for a room in a specific month is several interactions of setup that
 * say nothing about what the test is actually asserting. The creation *flow* is covered on its
 * own in `room.spec.ts`; everything else starts from a room that already exists.
 */
export async function createRoomViaApi(
  request: APIRequestContext,
  draft: RoomDraftInput,
): Promise<string> {
  const response = await request.post(`${API_ORIGIN}/api/rooms`, { data: draft });
  expect(response.status(), await response.text()).toBe(201);
  const body = (await response.json()) as { config: { roomId: string } };
  return body.config.roomId;
}

/** A room on ordinary days, for tests that are not about the calendar. */
export function ordinaryRoom(overrides: Partial<RoomDraftInput> = {}): RoomDraftInput {
  return {
    title: 'Sprint planning',
    anchorZone: 'America/New_York',
    dates: ['2026-09-14', '2026-09-15', '2026-09-16'],
    dayStartMinute: 9 * 60,
    dayEndMinute: 13 * 60,
    slotMinutes: 30,
    ...overrides,
  };
}

/** Opens a room and gets past the name prompt. */
export async function joinRoom(page: Page, roomId: string, name: string): Promise<void> {
  await page.goto(`/r/${roomId}`);
  const nameField = page.locator('#participant-name');
  await nameField.waitFor({ state: 'visible' });
  await nameField.fill(name);
  await page.getByRole('button', { name: 'Start picking times' }).click();
  await expect(page.locator('.grid-a11y__cell').first()).toBeAttached();
  await expect(page.locator('.status')).toContainText('Live');
}

export function cells(page: Page) {
  return page.locator('.grid-a11y__cell');
}

/** Columns in {@link ordinaryRoom} — three days. */
export const ORDINARY_COLUMNS = 3;

/**
 * The DOM index of the cell at a given row and column.
 *
 * The accessibility layer renders rows outer and columns inner, so indices run across the
 * grid rather than down it. Naming that here keeps the drag tests from quietly asserting a
 * diagonal when they meant a column.
 */
export function cellIndex(row: number, column: number, columns = ORDINARY_COLUMNS): number {
  return row * columns + column;
}

/**
 * Paints by driving the real pointer across the canvas.
 *
 * The accessibility layer is `pointer-events: none`, so these coordinates land on the canvas
 * exactly as a user's would — which means this exercises the coalesced-pointer drag path
 * rather than a shortcut around it.
 */
export async function dragPaint(page: Page, fromIndex: number, toIndex: number): Promise<void> {
  const from = await cells(page).nth(fromIndex).boundingBox();
  const to = await cells(page).nth(toIndex).boundingBox();
  if (!from || !to) throw new Error('Could not locate the cells to paint');

  const centre = (box: { x: number; y: number; width: number; height: number }) => ({
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  });

  const start = centre(from);
  const end = centre(to);

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  // Several intermediate moves, so the drag crosses cells rather than teleporting.
  for (let step = 1; step <= 6; step += 1) {
    await page.mouse.move(
      start.x + ((end.x - start.x) * step) / 6,
      start.y + ((end.y - start.y) * step) / 6,
    );
  }
  await page.mouse.up();
}

/** Reads back what the accessibility layer says about a cell — the user-visible truth. */
export async function cellLabel(page: Page, index: number): Promise<string> {
  return (await cells(page).nth(index).getAttribute('aria-label')) ?? '';
}

export async function paintedCount(page: Page): Promise<number> {
  const labels = await cells(page).evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('aria-label') ?? ''),
  );
  return labels.filter((label) => label.includes('you are free')).length;
}

/** How many people this viewer can see marked as free for a given cell. */
export async function othersFree(page: Page, index: number): Promise<number> {
  const label = await cellLabel(page, index);
  const match = /(\d+) other/.exec(label);
  return match?.[1] ? Number.parseInt(match[1], 10) : 0;
}
