import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { cells, createRoomViaApi, joinRoom, ordinaryRoom, paintedCount } from './helpers.js';

test.describe('accessibility', () => {
  test('the landing page has no detectable violations', async ({ page }) => {
    await page.goto('/');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test('the room has no detectable violations', async ({ page, request }) => {
    const roomId = await createRoomViaApi(request, ordinaryRoom());
    await joinRoom(page, roomId, 'Priya');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test('a room can be completed with the keyboard alone', async ({ page, request }) => {
    const roomId = await createRoomViaApi(request, ordinaryRoom());
    await page.goto(`/r/${roomId}`);

    // Join without touching the pointer.
    await page.locator('#participant-name').focus();
    await page.keyboard.type('Priya');
    await page.keyboard.press('Enter');
    await expect(cells(page).first()).toBeAttached();

    // Roving tabindex means the whole grid is a single tab stop.
    await cells(page).first().focus();
    await expect(cells(page).first()).toBeFocused();

    await page.keyboard.press('Space');
    await expect.poll(() => paintedCount(page)).toBe(1);

    // Arrow keys move within the grid.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Space');
    await expect.poll(() => paintedCount(page)).toBe(2);

    // Shift with an arrow paints a block, the keyboard peer of a drag.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.up('Shift');
    await expect.poll(() => paintedCount(page)).toBeGreaterThan(2);
  });

  test('every grid cell is announced with its time and who is free', async ({ page, request }) => {
    const roomId = await createRoomViaApi(request, ordinaryRoom());
    await joinRoom(page, roomId, 'Priya');

    const labels = await cells(page).evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('aria-label') ?? ''),
    );

    expect(labels).toHaveLength(24);
    for (const label of labels) {
      // A canvas heatmap says nothing to a screen reader; this layer is the whole reason the
      // rendering decision did not cost accessibility.
      expect(label).toMatch(/\d{1,2}:\d{2} (AM|PM) to \d{1,2}:\d{2} (AM|PM)/);
      expect(label).toMatch(/you are (free|not free|could)|you could/);
      expect(label).toMatch(/\d+ other/);
    }
  });

  test('focus is always visible', async ({ page, request }) => {
    const roomId = await createRoomViaApi(request, ordinaryRoom());
    await joinRoom(page, roomId, 'Priya');

    // Reached by keyboard, because `:focus-visible` deliberately does not fire for a
    // programmatic focus — testing it any other way would test the wrong thing.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');

    const shadow = await page.evaluate(() => {
      const active = document.activeElement;
      return active ? getComputedStyle(active).boxShadow : 'none';
    });

    expect(shadow).not.toBe('none');
    expect(shadow.length).toBeGreaterThan(0);
  });

  test('the skip link reaches the grid', async ({ page, request }) => {
    const roomId = await createRoomViaApi(request, ordinaryRoom());
    await joinRoom(page, roomId, 'Priya');

    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement?.textContent ?? '');
    expect(focused).toContain('Skip to the availability grid');
  });
});
