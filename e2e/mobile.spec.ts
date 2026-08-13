import { expect, test } from '@playwright/test';
import { cells, createRoomViaApi, joinRoom, ordinaryRoom, paintedCount } from './helpers.js';

/**
 * Runs under Pixel 5 emulation — touch input, a 393px viewport, and mouse-to-touch
 * translation. Drag painting on a mid-range phone is the interaction the whole rendering
 * decision was made for, so it gets asserted on a phone rather than assumed from desktop.
 */
test.describe('on a phone', () => {
  test('the room fits the viewport without the page scrolling sideways', async ({
    page,
    request,
  }) => {
    const roomId = await createRoomViaApi(request, ordinaryRoom());
    await joinRoom(page, roomId, 'Priya');

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

    // A wide room scrolls *inside* the grid, never by pushing the page off-screen.
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('tapping a cell marks it', async ({ page, request }) => {
    const roomId = await createRoomViaApi(request, ordinaryRoom());
    await joinRoom(page, roomId, 'Priya');

    const box = await cells(page).first().boundingBox();
    if (!box) throw new Error('Could not locate the first cell');

    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expect.poll(() => paintedCount(page)).toBe(1);
  });

  test('cells stay big enough to hit with a thumb', async ({ page, request }) => {
    const roomId = await createRoomViaApi(request, ordinaryRoom());
    await joinRoom(page, roomId, 'Priya');

    const box = await cells(page).first().boundingBox();
    if (!box) throw new Error('Could not locate the first cell');

    // Below roughly this size a cell cannot be hit reliably, which is why the grid scrolls
    // rather than shrinking without limit.
    expect(box.width).toBeGreaterThanOrEqual(40);
    expect(box.height).toBeGreaterThanOrEqual(20);
  });

  test('the panels stack below the grid instead of squeezing beside it', async ({
    page,
    request,
  }) => {
    const roomId = await createRoomViaApi(request, ordinaryRoom());
    await joinRoom(page, roomId, 'Priya');

    const grid = await page.locator('.grid-panel').boundingBox();
    const aside = await page.locator('.room__aside').boundingBox();
    if (!grid || !aside) throw new Error('Missing layout regions');

    expect(aside.y).toBeGreaterThan(grid.y);
  });
});
