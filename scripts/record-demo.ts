/**
 * Records the README's demo: three people painting one room at the same time.
 *
 * Driven through the real UI against a real server, so what the GIF shows is the product
 * working rather than a mock-up of it. Frames are captured from one participant's viewport
 * while the other two paint, which is the only way to show what this product is actually for —
 * the heatmap darkening under someone else's cursor.
 *
 * Run with: pnpm tsx scripts/record-demo.ts [baseUrl]
 */
import { mkdir, rm } from 'node:fs/promises';
import { chromium, type Browser, type Page } from '@playwright/test';

const BASE_URL = process.argv[2] ?? 'http://127.0.0.1:5173';
const FRAMES_DIR = 'scripts/.frames';
const VIEWPORT = { width: 1180, height: 720 };
const FRAME_INTERVAL_MS = 110;

interface Painter {
  readonly page: Page;
  readonly name: string;
}

async function createRoom(): Promise<string> {
  const response = await fetch(`${BASE_URL}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'Team offsite',
      anchorZone: 'America/New_York',
      dates: ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18'],
      dayStartMinute: 9 * 60,
      dayEndMinute: 17 * 60,
      slotMinutes: 30,
    }),
  });
  if (!response.ok) throw new Error(`Could not create a room: ${String(response.status)}`);
  const body = (await response.json()) as { config: { roomId: string } };
  return body.config.roomId;
}

async function join(browser: Browser, roomId: string, name: string): Promise<Painter> {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    timezoneId: 'America/New_York',
    locale: 'en-US',
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/r/${roomId}`);
  await page.locator('#participant-name').fill(name);
  await page.getByRole('button', { name: 'Start picking times' }).click();
  await page.locator('.grid-a11y__cell').first().waitFor({ state: 'attached' });
  return { page, name };
}

/** DOM index of a cell: the accessibility layer renders rows outer, columns inner. */
function at(row: number, column: number, columns = 5): number {
  return row * columns + column;
}

async function paint(painter: Painter, fromIndex: number, toIndex: number): Promise<void> {
  const cells = painter.page.locator('.grid-a11y__cell');
  const from = await cells.nth(fromIndex).boundingBox();
  const to = await cells.nth(toIndex).boundingBox();
  if (!from || !to) return;

  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const end = { x: to.x + to.width / 2, y: to.y + to.height / 2 };

  await painter.page.mouse.move(start.x, start.y);
  await painter.page.mouse.down();
  // Stepped so the drag reads as a gesture rather than a jump, and so peers see the cursor
  // travel rather than teleport.
  for (let step = 1; step <= 10; step += 1) {
    await painter.page.mouse.move(
      start.x + ((end.x - start.x) * step) / 10,
      start.y + ((end.y - start.y) * step) / 10,
    );
    await painter.page.waitForTimeout(28);
  }
  await painter.page.mouse.up();
}

async function main(): Promise<void> {
  await rm(FRAMES_DIR, { recursive: true, force: true });
  await mkdir(FRAMES_DIR, { recursive: true });

  const browser = await chromium.launch();
  const roomId = await createRoom();
  console.log(`Recording room ${roomId} at ${BASE_URL}`);

  // Priya is the camera; the other two are what she sees happening.
  const priya = await join(browser, roomId, 'Priya');
  const marcus = await join(browser, roomId, 'Marcus');
  const yuki = await join(browser, roomId, 'Yuki');

  let frame = 0;
  let recording = true;
  const capture = async (): Promise<void> => {
    while (recording) {
      await priya.page.screenshot({
        path: `${FRAMES_DIR}/frame-${String(frame).padStart(4, '0')}.png`,
      });
      frame += 1;
      await priya.page.waitForTimeout(FRAME_INTERVAL_MS);
    }
  };
  const capturing = capture();

  await priya.page.waitForTimeout(700);

  // Priya blocks out her own mornings first.
  await paint(priya, at(0, 0), at(5, 0));
  await paint(priya, at(0, 2), at(6, 2));

  // Marcus and Yuki paint at the same time — the point of the whole product.
  await Promise.all([
    (async () => {
      await paint(marcus, at(2, 0), at(9, 0));
      await paint(marcus, at(1, 2), at(8, 2));
    })(),
    (async () => {
      await yuki.page.waitForTimeout(500);
      await paint(yuki, at(3, 0), at(11, 0));
      await paint(yuki, at(2, 2), at(7, 2));
    })(),
  ]);

  await priya.page.waitForTimeout(600);
  await paint(priya, at(4, 4), at(10, 4));
  await Promise.all([paint(marcus, at(5, 4), at(9, 4)), paint(yuki, at(4, 4), at(8, 4))]);

  // Let the best-times panel settle so the last frames show the payoff.
  await priya.page.waitForTimeout(1_400);

  recording = false;
  await capturing;
  await browser.close();
  console.log(`Captured ${String(frame)} frames into ${FRAMES_DIR}`);
}

await main();
