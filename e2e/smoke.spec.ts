import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { createRoomViaApi, joinRoom, ordinaryRoom } from './helpers.js';

/**
 * Per-route smoke: does it load, are the load-bearing elements there, and is the console clean.
 *
 * Deliberately separate from the journey specs. Those prove the product works; this proves every
 * screen is *shippable* — nothing throwing in the background, nothing missing at 360px.
 */

interface Noise {
  readonly kind: 'console' | 'pageerror' | 'requestfailed';
  readonly text: string;
}

/**
 * Everything the page complained about.
 *
 * Chrome logs a resource-level "Failed to load resource" for any non-2xx response, including
 * ones the app asks for on purpose and handles — the room-existence probe answers 404 for a room
 * that is genuinely gone, and that is the correct API design, not a defect. Rather than dropping
 * those quietly, they are classified separately so a test can assert exactly which ones it
 * expects and still fail on anything else.
 */
function watch(page: Page): { noise: Noise[]; probes: string[] } {
  const noise: Noise[] = [];
  const probes: string[] = [];

  const isRoomProbe404 = (text: string): boolean =>
    text.includes('Failed to load resource') && text.includes('404');

  page.on('console', (message: ConsoleMessage) => {
    const type = message.type();
    if (type !== 'error' && type !== 'warning') return;
    const text = message.text();
    if (isRoomProbe404(text)) {
      probes.push(text);
      return;
    }
    noise.push({ kind: 'console', text: `${type}: ${text}` });
  });

  page.on('pageerror', (error) => {
    noise.push({ kind: 'pageerror', text: error.message });
  });

  return { noise, probes };
}

const WIDTHS = [360, 768, 1440] as const;

/** 360 is the floor the layout is designed to; nothing may spill sideways at any width. */
async function expectNoSidewaysScroll(page: Page): Promise<void> {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    await page.waitForTimeout(120);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `page scrolls sideways at ${String(width)}px`).toBeLessThanOrEqual(1);
  }
}

test.describe('every route loads clean', () => {
  test('the landing page', async ({ page }) => {
    const { noise, probes } = watch(page);

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Find a time');
    // The three-second test, as an assertion: what it does, and what to do first, both present
    // without scrolling past the hero.
    await expect(page.getByRole('button', { name: 'Create a room' })).toBeVisible();
    await expect(page.locator('.demo__cells .demo__cell').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create the room' })).toBeDisabled();

    await expectNoSidewaysScroll(page);
    expect(noise, 'console output on the landing page').toEqual([]);
    expect(probes, 'the landing page probes nothing').toEqual([]);
  });

  test('the name prompt', async ({ page, request }) => {
    const { noise } = watch(page);
    const roomId = await createRoomViaApi(request, ordinaryRoom());

    await page.goto(`/r/${roomId}`);
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.locator('#participant-name')).toBeFocused();
    await expect(page.getByRole('button', { name: 'Start picking times' })).toBeDisabled();

    await expectNoSidewaysScroll(page);
    expect(noise, 'console output on the name prompt').toEqual([]);
  });

  test('a room you are the first into', async ({ page, request }) => {
    const { noise } = watch(page);
    const roomId = await createRoomViaApi(request, ordinaryRoom());
    await joinRoom(page, roomId, 'Priya');

    // Alone in a room, sharing is the primary action and the grid says what to do.
    await expect(page.locator('.invite')).toBeVisible();
    await expect(page.locator('.grid-invite__card')).toContainText('Drag across the times');
    await expect(page.locator('.daylight-rail')).toBeVisible();
    await expect(page.locator('.panel__title').first()).toBeVisible();

    await expectNoSidewaysScroll(page);
    expect(noise, 'console output in a room').toEqual([]);
  });

  /*
   * The grid must not move once it is on screen.
   *
   * This is a regression guard with a story: an offline banner and an invitation panel both sat
   * above the grid and both appeared or vanished on events the user had not caused — the socket
   * coming up, a second person joining. Each shifted the grid by roughly two rows, so a drag in
   * progress finished somewhere other than where it started and silently painted the wrong
   * cells. It reads as flakiness; it is a real defect with a real victim.
   */
  test('the grid does not move under the user', async ({ page, request, browser }) => {
    const roomId = await createRoomViaApi(request, ordinaryRoom());
    await joinRoom(page, roomId, 'Priya');

    const grid = page.locator('.grid-stage');
    const before = await grid.boundingBox();
    expect(before).not.toBeNull();

    // Someone else arrives and marks availability — the exact remote event that used to remove
    // the invitation panel and drag the grid up with it.
    const context = await browser.newContext();
    const other = await context.newPage();
    await joinRoom(other, roomId, 'Marcus');
    await expect(page.locator('#participants-title')).toContainText('In this room (2)');
    await page.waitForTimeout(500);

    const after = await grid.boundingBox();
    expect(after?.y, 'the grid moved vertically after a remote join').toBe(before?.y);
    expect(after?.x, 'the grid moved horizontally after a remote join').toBe(before?.x);

    await context.close();
  });

  test('a room that is gone', async ({ page }) => {
    const { noise, probes } = watch(page);

    await page.goto('/r/aaaaaaaaaaaaaaaaaaaaaa');
    await expect(page.getByRole('heading', { name: /This room is gone/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Start a new room' })).toBeVisible();

    await expectNoSidewaysScroll(page);
    expect(noise, 'console output on the not-found screen').toEqual([]);
    // Exactly one probe, and it is the one this screen exists to report. More than one would
    // mean the client is retrying something it has already been given an answer about.
    expect(probes).toHaveLength(1);
  });

  test('a link that was cut short', async ({ page }) => {
    const { noise, probes } = watch(page);

    await page.goto('/r/toshort');
    await expect(page.getByRole('heading', { name: /This link is incomplete/ })).toBeVisible();

    await expectNoSidewaysScroll(page);
    expect(noise, 'console output on the broken-link screen').toEqual([]);
    // Nothing is fetched at all: the id cannot be real, so there is nothing worth asking about.
    expect(probes, 'a malformed id is rejected without a request').toEqual([]);
  });
});
