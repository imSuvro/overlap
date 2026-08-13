import { expect, test } from '@playwright/test';
import {
  cellIndex,
  cellLabel,
  cells,
  createRoomViaApi,
  dragPaint,
  joinRoom,
  ordinaryRoom,
  paintedCount,
} from './helpers.js';

test.describe('creating and using a room', () => {
  test('a host can create a room from the landing page and land in it', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Find a time that works for everyone',
    );

    await page.getByLabel('What are you planning?').fill('Dinner with friends');
    await page.getByRole('button', { name: 'Create the room' }).click();

    // The URL is the room.
    await expect(page).toHaveURL(/\/r\/[A-Za-z0-9]{22}$/);
    await expect(page.getByRole('dialog')).toContainText('Dinner with friends');
  });

  test('a room survives a hard refresh of its URL', async ({ page, request }) => {
    const roomId = await createRoomViaApi(request, ordinaryRoom());
    await joinRoom(page, roomId, 'Priya');

    await page.reload();

    // No name prompt the second time: identity persists per browser profile, with no account.
    await expect(page.locator('.grid-a11y__cell').first()).toBeAttached();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.participant')).toContainText('Priya (you)');
  });

  test('the grid renders one cell per slot', async ({ page, request }) => {
    // 3 days x 4 hours at 30 minutes = 24 slots.
    const roomId = await createRoomViaApi(request, ordinaryRoom());
    await joinRoom(page, roomId, 'Priya');

    await expect(cells(page)).toHaveCount(24);
    expect(await cellLabel(page, 0)).toContain('9:00 AM to 9:30 AM');
  });

  test('the canvas actually paints pixels', async ({ page, request }) => {
    const roomId = await createRoomViaApi(request, ordinaryRoom());
    await joinRoom(page, roomId, 'Priya');

    // The heatmap is drawn, not styled, so "it rendered" has to be asserted against the
    // canvas itself rather than against the DOM sitting over it.
    const painted = await page.locator('.grid-stage__canvas').evaluate((node) => {
      const canvas = node as HTMLCanvasElement;
      const context = canvas.getContext('2d');
      if (!context || canvas.width === 0) return false;
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      for (let index = 3; index < data.length; index += 4) {
        if ((data[index] ?? 0) > 0) return true;
      }
      return false;
    });

    expect(painted).toBe(true);
  });

  test('dragging paints a run of cells, and dragging back clears them', async ({
    page,
    request,
  }) => {
    const roomId = await createRoomViaApi(request, ordinaryRoom());
    await joinRoom(page, roomId, 'Priya');

    // Straight down the first day: six consecutive half-hours.
    await dragPaint(page, cellIndex(0, 0), cellIndex(5, 0));
    await expect.poll(() => paintedCount(page)).toBe(6);

    // Starting a drag on a cell already painted erases instead — one gesture, no mode to
    // remember.
    await dragPaint(page, cellIndex(0, 0), cellIndex(5, 0));
    await expect.poll(() => paintedCount(page)).toBe(0);
  });

  test('a fast flick paints every cell it crossed, not just the sampled ones', async ({
    page,
    request,
  }) => {
    const roomId = await createRoomViaApi(request, ordinaryRoom());
    await joinRoom(page, roomId, 'Priya');

    const first = await cells(page).nth(cellIndex(0, 0)).boundingBox();
    const last = await cells(page).nth(cellIndex(7, 0)).boundingBox();
    if (!first || !last) throw new Error('Could not locate cells');

    // One move spanning eight cells. Without reading coalesced events and interpolating
    // between samples, this would paint the two ends and leave holes down the middle.
    await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
    await page.mouse.down();
    await page.mouse.move(last.x + last.width / 2, last.y + last.height / 2);
    await page.mouse.up();

    await expect.poll(() => paintedCount(page)).toBe(8);
  });

  test('the best-times panel names the overlap once there is one', async ({ page, request }) => {
    const roomId = await createRoomViaApi(request, ordinaryRoom());
    await joinRoom(page, roomId, 'Priya');

    await expect(page.locator('.panel__empty')).toContainText('No overlap yet');

    await dragPaint(page, 0, 3);
    await expect(page.locator('.window-card').first()).toContainText('Everyone can make it');
  });

  test('the host can pin a time and everyone sees it', async ({ page, request }) => {
    const roomId = await createRoomViaApi(request, ordinaryRoom());
    await joinRoom(page, roomId, 'Priya');
    await dragPaint(page, 0, 3);

    await page.getByRole('button', { name: 'Pin this time' }).first().click();

    await expect(page.locator('.finalized')).toBeVisible();
    await expect(page.locator('.finalized__label')).toContainText('Pinned');
  });

  test('renaming the room persists', async ({ page, request }) => {
    const roomId = await createRoomViaApi(request, ordinaryRoom());
    await joinRoom(page, roomId, 'Priya');

    const title = page.locator('#room-title');
    await title.fill('Retro instead');
    await title.blur();

    await page.reload();
    await expect(page.locator('#room-title')).toHaveValue('Retro instead');
  });

  test('an unknown room says so rather than hanging', async ({ page }) => {
    await page.goto('/r/aaaaaaaaaaaaaaaaaaaaaa');
    // Matched loosely because the copy uses a typographic apostrophe.
    await expect(page.getByRole('heading', { name: /This room isn.t here/ })).toBeVisible({
      timeout: 20_000,
    });
  });
});
