import { expect, test } from '@playwright/test';
import { cells, createRoomViaApi, dragPaint, joinRoom, ordinaryRoom } from './helpers.js';

/**
 * One test per defect confirmed by the pre-merge review of the UI overhaul.
 *
 * Kept together, and named after the failure rather than the fix, so that a future change which
 * reintroduces one of these fails with a description of what the user would experience.
 */

/** Consecutive dates, for rooms wide enough to overflow their panel. */
function consecutiveDates(count: number, from = '2026-09-14'): string[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(start + index * 86_400_000);
    return day.toISOString().slice(0, 10);
  });
}

test.describe('regressions found in review', () => {
  /*
   * The grid was centred with `justify-content: center` on a flex scroll container. A flex item
   * centred inside a scroll container overflows both ways, and the start-side overflow cannot be
   * scrolled to — so on a month-long room the time gutter and the daylight rail sat permanently
   * off the left edge with no way to reach them.
   */
  test('a room too wide for its panel can still be scrolled to its left edge', async ({
    page,
    request,
  }) => {
    const roomId = await createRoomViaApi(
      request,
      ordinaryRoom({ dates: consecutiveDates(31), title: 'A whole month' }),
    );
    await joinRoom(page, roomId, 'Priya');

    const scroller = page.locator('.grid-scroll');
    const stage = page.locator('.grid-stage');

    // Confirm the fixture actually overflows, or the test proves nothing.
    const overflow = await scroller.evaluate((node) => node.scrollWidth - node.clientWidth);
    expect(overflow, 'fixture is not wide enough to overflow its panel').toBeGreaterThan(0);

    await scroller.evaluate((node) => {
      node.scrollLeft = 0;
    });

    const scrollBox = await scroller.boundingBox();
    const stageBox = await stage.boundingBox();
    expect(scrollBox).not.toBeNull();
    expect(stageBox).not.toBeNull();

    // At scrollLeft 0 the start of the grid must be visible, not clipped off to the left.
    expect(
      stageBox!.x,
      'the left edge of the grid is unreachable — the time gutter is cut off',
    ).toBeGreaterThanOrEqual(scrollBox!.x - 1);

    // And the first column's cells are genuinely on screen.
    const firstCell = await cells(page).first().boundingBox();
    expect(firstCell!.x).toBeGreaterThanOrEqual(scrollBox!.x - 1);
  });

  /*
   * `identity.name` is one global value, not per room. It satisfied the join gate — skipping the
   * name dialog for anyone who had used the product before — but `setName` was only ever called
   * from that dialog. From a returning visitor's second room onwards no name register existed,
   * so they were absent from the participant list, the best-times scoring and the heat fill,
   * while their own marks still drew back to them. Invisible to the room's arithmetic.
   */
  test('a returning visitor is a real participant in the next room they open', async ({
    page,
    request,
  }) => {
    const first = await createRoomViaApi(request, ordinaryRoom({ title: 'Room one' }));
    await joinRoom(page, first, 'Priya');

    // Same browser profile, a different room: the name prompt is skipped from here on.
    const second = await createRoomViaApi(request, ordinaryRoom({ title: 'Room two' }));
    await page.goto(`/r/${second}`);
    await expect(page.locator('.grid-a11y__cell').first()).toBeAttached();
    await expect(page.locator('#participant-name')).toHaveCount(0);

    await expect(page.locator('#participants-title')).toContainText('In this room (1)');
    await expect(page.locator('.participant--me')).toContainText('Priya');

    await dragPaint(page, 0, 6);

    // The proof the marks are counted, not merely stored: the invitation card clears and the
    // participant's own total stops reading "nothing yet".
    await expect(page.locator('.grid-invite')).toHaveCount(0);
    await expect(page.locator('.participant--me .participant__meta')).not.toContainText(
      'nothing yet',
    );
  });

  /*
   * The selected paint-mode toggle carries a box-shadow for its pressed state, which outranked
   * the global bare-pseudo-class focus ring on specificity — so a keyboard user landing on it
   * saw nothing change at all.
   */
  test('the selected paint-mode toggle shows a focus ring', async ({ page, request }) => {
    const roomId = await createRoomViaApi(request, ordinaryRoom());
    await joinRoom(page, roomId, 'Priya');

    const selected = page.locator('.paint-modes__option[aria-pressed="true"]');
    const resting = await selected.evaluate((node) => getComputedStyle(node).boxShadow);

    /*
     * Reached by Tab, not by `.focus()`. `:focus-visible` is a claim about how focus *arrived*,
     * and programmatic focus does not satisfy it — so a scripted focus would report no ring even
     * on correct CSS, and would keep reporting none after the bug was fixed.
     */
    let reached = false;
    for (let press = 0; press < 20 && !reached; press += 1) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(() => {
        const active = document.activeElement;
        return (
          active instanceof HTMLElement &&
          active.classList.contains('paint-modes__option') &&
          active.getAttribute('aria-pressed') === 'true'
        );
      });
    }
    expect(reached, 'never tabbed onto the selected paint-mode toggle').toBe(true);

    const focused = await selected.evaluate((node) => getComputedStyle(node).boxShadow);

    expect(focused, 'focus is invisible on the selected toggle').not.toBe(resting);
    expect(focused).not.toBe('none');
  });

  /*
   * Losing the network is a remote event, and the offline banner used to be a normal row above
   * the grid. It appeared mid-drag and pushed the grid down about 100px, so the drag finished
   * four rows from where it started.
   */
  test('going offline does not move the grid', async ({ browser, request }) => {
    const roomId = await createRoomViaApi(request, ordinaryRoom());
    const context = await browser.newContext();
    const page = await context.newPage();
    await joinRoom(page, roomId, 'Priya');

    const before = await page.locator('.grid-stage').boundingBox();

    await context.setOffline(true);
    await expect(page.locator('.offline-notice')).toBeVisible({ timeout: 20_000 });

    const after = await page.locator('.grid-stage').boundingBox();
    expect(after?.y, 'the grid moved when the connection dropped').toBe(before?.y);
    expect(after?.x).toBe(before?.x);

    await context.close();
  });
});
