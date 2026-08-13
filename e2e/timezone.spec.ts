import { expect, test } from '@playwright/test';
import { cellLabel, cells, createRoomViaApi, joinRoom, ordinaryRoom } from './helpers.js';

/**
 * The room's instants never change. Only their labels and arrangement do.
 *
 * These tests open the *same* room from three very different zones and assert that each
 * viewer sees the same moments described in their own local terms — including a zone whose
 * offset is not a whole number of hours.
 */
test.describe('the same room, seen from different timezones', () => {
  test('a New York viewer sees the hours the host chose', async ({ page, request }) => {
    const roomId = await createRoomViaApi(request, ordinaryRoom());
    await joinRoom(page, roomId, 'Priya');

    await expect(cells(page)).toHaveCount(24);
    expect(await cellLabel(page, 0)).toContain('Monday, September 14, 9:00 AM to 9:30 AM');
  });

  test.describe('from Kolkata', () => {
    test.use({ timezoneId: 'Asia/Kolkata' });

    test('the same instants read as evening, on a half-hour offset', async ({ page, request }) => {
      const roomId = await createRoomViaApi(request, ordinaryRoom());
      await joinRoom(page, roomId, 'Ravi');

      // 9:00 AM in New York is 6:30 PM in Kolkata — a +05:30 offset, which a naive
      // whole-hour model gets wrong by half an hour.
      await expect(cells(page)).toHaveCount(24);
      expect(await cellLabel(page, 0)).toContain('Monday, September 14, 6:30 PM to 7:00 PM');
    });
  });

  test.describe('from the Chatham Islands', () => {
    test.use({ timezoneId: 'Pacific/Chatham' });

    test('the same instants land on the following day, at a 45-minute offset', async ({
      page,
      request,
    }) => {
      const roomId = await createRoomViaApi(request, ordinaryRoom());
      await joinRoom(page, roomId, 'Mere');

      // Chatham is +12:45. Monday morning in New York is very early Tuesday there, so this
      // viewer's grid is built from entirely different calendar dates than the host's.
      await expect(cells(page)).toHaveCount(24);
      expect(await cellLabel(page, 0)).toContain('Tuesday, September 15, 1:45 AM to 2:15 AM');
    });
  });

  test.describe('from Tokyo', () => {
    test.use({ timezoneId: 'Asia/Tokyo' });

    test('a room spanning the working day splits across more columns', async ({
      page,
      request,
    }) => {
      // 9am-5pm in New York is 10pm-6am in Tokyo, so seven New York days genuinely straddle
      // eight Tokyo dates. Nothing special-cases this; it falls out of grouping by the
      // viewer's own local date.
      const roomId = await createRoomViaApi(
        request,
        ordinaryRoom({
          dates: [
            '2026-09-14',
            '2026-09-15',
            '2026-09-16',
            '2026-09-17',
            '2026-09-18',
            '2026-09-19',
            '2026-09-20',
          ],
          dayStartMinute: 9 * 60,
          dayEndMinute: 17 * 60,
        }),
      );
      await joinRoom(page, roomId, 'Kenji');

      const dayLabels = await page
        .locator('.grid-stage > div:first-of-type > div')
        .evaluateAll((nodes) => nodes.map((node) => node.textContent ?? ''));

      expect(dayLabels.length).toBe(8);
      await expect(cells(page)).toHaveCount(8 * 16);
    });
  });
});

test.describe('daylight saving transitions', () => {
  test('the hour that happens twice appears twice, labelled apart', async ({ page, request }) => {
    // 2026-11-01 in New York: 01:00-02:00 happens once at -04:00 and again at -05:00. Both
    // are real, schedulable hours. Collapsing them would quietly delete an hour of
    // availability once a year.
    const roomId = await createRoomViaApi(
      request,
      ordinaryRoom({
        dates: ['2026-11-01'],
        dayStartMinute: 0,
        dayEndMinute: 6 * 60,
      }),
    );
    await joinRoom(page, roomId, 'Priya');

    // 12 wall times, plus the 2 that occur twice.
    await expect(cells(page)).toHaveCount(14);

    const labels = await cells(page).evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('aria-label') ?? ''),
    );

    const oneAm = labels.filter((label) => label.includes('1:00 AM to 1:30 AM'));
    expect(oneAm).toHaveLength(2);

    // And they are told apart by the offset in force, not left ambiguous.
    expect(oneAm.some((label) => label.includes('EDT'))).toBe(true);
    expect(oneAm.some((label) => label.includes('EST'))).toBe(true);
  });

  test('the hour that does not exist is never offered', async ({ page, request }) => {
    // 2026-03-08 in New York: 02:00 becomes 03:00, so 02:00 and 02:30 never happen.
    const roomId = await createRoomViaApi(
      request,
      ordinaryRoom({
        dates: ['2026-03-08'],
        dayStartMinute: 0,
        dayEndMinute: 6 * 60,
      }),
    );
    await joinRoom(page, roomId, 'Priya');

    await expect(cells(page)).toHaveCount(10);

    const labels = await cells(page).evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('aria-label') ?? ''),
    );
    expect(labels.some((label) => label.includes('2:00 AM to 2:30 AM'))).toBe(false);
    expect(labels.some((label) => label.includes('2:30 AM to 3:00 AM'))).toBe(false);

    // The slot that straddles the transition is thirty real minutes that reads as an
    // hour-and-a-half on the wall clock, because the clock itself jumped in the middle of it.
    // Deriving the end from the instant rather than from the label is what gets this right.
    expect(labels.some((label) => label.includes('1:30 AM to 3:00 AM'))).toBe(true);
    expect(labels.some((label) => label.includes('3:00 AM to 3:30 AM'))).toBe(true);
  });

  test('a viewer whose own clocks change sees the repeat, even in a room without DST', async ({
    browser,
    request,
  }) => {
    // The room is anchored in Kolkata, which has never observed DST. The repeated hour is
    // created entirely by the *viewer's* zone falling back, so it cannot be handled by
    // looking at the room's own timezone.
    const roomId = await createRoomViaApi(
      request,
      ordinaryRoom({
        anchorZone: 'Asia/Kolkata',
        dates: ['2026-11-01'],
        dayStartMinute: 9 * 60,
        dayEndMinute: 13 * 60,
      }),
    );

    const context = await browser.newContext({ timezoneId: 'America/New_York' });
    const page = await context.newPage();
    await joinRoom(page, roomId, 'Priya');

    const labels = await cells(page).evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('aria-label') ?? ''),
    );

    const oneAm = labels.filter((label) => label.includes('1:00 AM to 1:30 AM'));
    expect(oneAm).toHaveLength(2);
    expect(oneAm.some((label) => label.includes('EDT'))).toBe(true);
    expect(oneAm.some((label) => label.includes('EST'))).toBe(true);

    await context.close();
  });
});
