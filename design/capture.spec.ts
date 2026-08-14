import { expect, test, type Browser, type ConsoleMessage, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Walks every screen and every state of the app and writes a screenshot set.
 *
 * `OVERLAP_SHOT_DIR` selects the destination, so the identical walk produces `before/` at the
 * start of a design pass and `after/` at the end. Comparing two sets taken by different code is
 * how you end up "proving" an improvement that is really a different camera angle.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const SHOT_DIR = join(HERE, 'audit', process.env.OVERLAP_SHOT_DIR ?? 'before');

const API_ORIGIN = process.env.OVERLAP_BASE_URL ?? 'http://127.0.0.1:8787';

const WIDTHS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

interface ConsoleEntry {
  readonly screen: string;
  readonly type: string;
  readonly text: string;
}

const consoleLog: ConsoleEntry[] = [];

function watchConsole(page: Page, screen: string): void {
  const record = (message: ConsoleMessage): void => {
    if (message.type() !== 'error' && message.type() !== 'warning') return;
    consoleLog.push({ screen, type: message.type(), text: message.text() });
  };
  page.on('console', record);
  page.on('pageerror', (error) => {
    consoleLog.push({ screen, type: 'pageerror', text: error.message });
  });
}

/** One screen, captured at all three widths. */
async function shoot(page: Page, name: string): Promise<void> {
  for (const size of WIDTHS) {
    await page.setViewportSize({ width: size.width, height: size.height });
    // Let the canvas reflow and any transition settle before the shutter.
    await page.waitForTimeout(350);
    await page.screenshot({
      path: join(SHOT_DIR, `${name}--${size.name}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

async function makeRoom(page: Page, title: string): Promise<string> {
  const response = await page.request.post(`${API_ORIGIN}/api/rooms`, {
    data: {
      title,
      anchorZone: 'America/New_York',
      dates: ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17'],
      dayStartMinute: 9 * 60,
      dayEndMinute: 15 * 60,
      slotMinutes: 30,
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const body = (await response.json()) as { config: { roomId: string } };
  return body.config.roomId;
}

async function joinRoom(page: Page, roomId: string, name: string): Promise<void> {
  await page.goto(`/r/${roomId}`);
  const field = page.locator('#participant-name');
  await field.waitFor({ state: 'visible' });
  await field.fill(name);
  await page.getByRole('button', { name: /start picking times/i }).click();
  await expect(page.locator('.grid-a11y__cell').first()).toBeAttached();
}

/** Drags across the accessibility layer's geometry, exactly as `e2e/helpers.ts` does. */
async function paint(page: Page, fromIndex: number, toIndex: number): Promise<void> {
  const cells = page.locator('.grid-a11y__cell');
  const from = await cells.nth(fromIndex).boundingBox();
  const to = await cells.nth(toIndex).boundingBox();
  if (!from || !to) throw new Error('Could not locate the cells to paint');

  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const end = { x: to.x + to.width / 2, y: to.y + to.height / 2 };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let step = 1; step <= 6; step += 1) {
    await page.mouse.move(
      start.x + ((end.x - start.x) * step) / 6,
      start.y + ((end.y - start.y) * step) / 6,
    );
  }
  await page.mouse.up();
}

/** Fills a room with three other people's availability so the heatmap has something to show. */
async function seedCrowd(browser: Browser, roomId: string): Promise<void> {
  const crowd = [
    { name: 'Priya', from: 0, to: 14 },
    { name: 'Marcus', from: 4, to: 22 },
    { name: 'Ines', from: 8, to: 30 },
  ];

  for (const person of crowd) {
    const context = await browser.newContext({
      timezoneId: 'America/New_York',
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    await joinRoom(page, roomId, person.name);
    await paint(page, person.from, person.to);
    await page.waitForTimeout(400);
    await context.close();
  }
}

test.beforeAll(async () => {
  await mkdir(SHOT_DIR, { recursive: true });
});

test('landing, in every state', async ({ page }) => {
  watchConsole(page, 'landing');

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await shoot(page, '01-landing-empty');

  await page.locator('#room-title-input').fill('Design review with the whole team');
  await page.locator('#start-hour').selectOption('10');
  await page.locator('#end-hour').selectOption('18');
  await shoot(page, '02-landing-filled');
});

test('room, in every state', async ({ page, browser }) => {
  watchConsole(page, 'room');

  const roomId = await makeRoom(page, 'Design review with the whole team');
  await seedCrowd(browser, roomId);

  // The name prompt: the first thing anyone arriving from a shared link actually sees.
  await page.goto(`/r/${roomId}`);
  await expect(page.locator('#participant-name')).toBeVisible();
  await shoot(page, '03-room-name-prompt');

  await page.locator('#participant-name').fill('Sam');
  await page.getByRole('button', { name: /start picking times/i }).click();
  await expect(page.locator('.grid-a11y__cell').first()).toBeAttached();
  await page.waitForTimeout(600);
  await shoot(page, '04-room-others-only');

  await paint(page, 2, 18);
  await page.waitForTimeout(500);
  await shoot(page, '05-room-painted');

  // Pinning a time — the closing move of the whole product.
  const pin = page.getByRole('button', { name: /pin this time/i }).first();
  if (await pin.isVisible().catch(() => false)) {
    await pin.click();
    await page.waitForTimeout(500);
    await shoot(page, '06-room-pinned');
  }
});

/** Well-formed but unknown: 22 base58 characters that were never issued. */
const UNKNOWN_ROOM_ID = 'zzzzzzzzzzzzzzzzzzzzzz';

test('room that does not exist', async ({ page }) => {
  watchConsole(page, 'missing');

  await page.goto(`/r/${UNKNOWN_ROOM_ID}`);
  await expect(page.getByText(/isn.t here|not found/i)).toBeVisible();
  await shoot(page, '07-room-missing');
});

test('a link that got mangled on the way', async ({ page }) => {
  watchConsole(page, 'malformed');

  // A truncated or typo'd id fails `roomIdSchema`, so the router reports "no room" and the app
  // renders the landing page — silently. Captured because the silence is the finding.
  await page.goto('/r/nosuchroomatall');
  await page.waitForTimeout(600);
  await shoot(page, '09-link-malformed');
});

test('an empty room, seen by its first arrival', async ({ page }) => {
  watchConsole(page, 'empty-room');

  const roomId = await makeRoom(page, 'Coffee sometime next week');
  await joinRoom(page, roomId, 'Sam');
  await page.waitForTimeout(600);
  await shoot(page, '08-room-empty');
});

test.afterAll(async () => {
  await writeFile(join(SHOT_DIR, 'console.json'), `${JSON.stringify(consoleLog, null, 2)}\n`);
  // Printed as well as written: a silent file is easy to forget to open.
  if (consoleLog.length > 0) {
    console.log(`\n${String(consoleLog.length)} console error/warning entries:`);
    for (const entry of consoleLog) console.log(`  [${entry.screen}] ${entry.type}: ${entry.text}`);
  } else {
    console.log('\nConsole clean across every captured screen.');
  }
});
