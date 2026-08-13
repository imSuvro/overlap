import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  cellIndex,
  createRoomViaApi,
  dragPaint,
  joinRoom,
  ordinaryRoom,
  othersFree,
  paintedCount,
} from './helpers.js';

/**
 * Every context is a separate browser profile, so each gets its own `participantId` — these
 * really are different people, not one person in two tabs.
 */
async function openAs(context: BrowserContext, roomId: string, name: string): Promise<Page> {
  const page = await context.newPage();
  await joinRoom(page, roomId, name);
  return page;
}

test.describe('several people in one room', () => {
  test('concurrent painting converges on every client', async ({ browser, request }) => {
    const roomId = await createRoomViaApi(request, ordinaryRoom());

    const contexts = await Promise.all([
      browser.newContext(),
      browser.newContext(),
      browser.newContext(),
    ]);
    const [alice, bob, carol] = await Promise.all([
      openAs(contexts[0], roomId, 'Alice'),
      openAs(contexts[1], roomId, 'Bob'),
      openAs(contexts[2], roomId, 'Carol'),
    ]);

    // Overlapping runs down the first day, painted at the same time with no coordination.
    // Alice takes rows 0-4, Bob rows 3-7, Carol rows 4-7, so row 4 is the only slot all
    // three marked.
    await Promise.all([
      dragPaint(alice, cellIndex(0, 0), cellIndex(4, 0)),
      dragPaint(bob, cellIndex(3, 0), cellIndex(7, 0)),
      dragPaint(carol, cellIndex(4, 0), cellIndex(7, 0)),
    ]);

    // Row 4 is the one slot all three marked, so each sees the other two.
    for (const page of [alice, bob, carol]) {
      await expect.poll(() => othersFree(page, cellIndex(4, 0)), { timeout: 20_000 }).toBe(2);
    }

    // Row 6 was Bob and Carol only: Alice sees two others, they each see one.
    await expect.poll(() => othersFree(alice, cellIndex(6, 0))).toBe(2);
    await expect.poll(() => othersFree(bob, cellIndex(6, 0))).toBe(1);
    await expect.poll(() => othersFree(carol, cellIndex(6, 0))).toBe(1);

    // Row 1 was Alice alone.
    await expect.poll(() => othersFree(alice, cellIndex(1, 0))).toBe(0);
    await expect.poll(() => othersFree(bob, cellIndex(1, 0))).toBe(1);

    // And everyone agrees on who is in the room.
    for (const page of [alice, bob, carol]) {
      await expect(page.locator('#participants-title')).toContainText('In this room (3)');
    }

    await Promise.all(contexts.map((context) => context.close()));
  });

  test('a live cursor from one person shows up for another', async ({ browser, request }) => {
    const roomId = await createRoomViaApi(request, ordinaryRoom());
    const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
    const [alice, bob] = await Promise.all([
      openAs(contexts[0], roomId, 'Alice'),
      openAs(contexts[1], roomId, 'Bob'),
    ]);

    const box = await alice.locator('.grid-stage__canvas').boundingBox();
    if (!box) throw new Error('No canvas');
    await alice.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    await expect(bob.locator('.presence-cursor')).toHaveCount(1, { timeout: 15_000 });
    await expect(bob.locator('.presence-cursor__name')).toContainText('Alice');

    // Presence is ephemeral: closing the tab takes the cursor with it.
    await alice.close();
    await expect(bob.locator('.presence-cursor')).toHaveCount(0, { timeout: 15_000 });

    await Promise.all(contexts.map((context) => context.close()));
  });

  test('painting offline is kept and merges cleanly on reconnect', async ({ browser, request }) => {
    const roomId = await createRoomViaApi(request, ordinaryRoom());
    const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
    const [alice, bob] = await Promise.all([
      openAs(contexts[0], roomId, 'Alice'),
      openAs(contexts[1], roomId, 'Bob'),
    ]);

    await contexts[0].setOffline(true);
    await expect(alice.locator('.status')).toContainText('Offline', { timeout: 20_000 });

    // Both sides keep working while split, on different days so nothing collides.
    await dragPaint(alice, cellIndex(0, 0), cellIndex(3, 0));
    await dragPaint(bob, cellIndex(0, 2), cellIndex(3, 2));

    await expect.poll(() => paintedCount(alice)).toBe(4);
    // The badge says the changes are safe, which is the claim the CRDT actually backs.
    await expect(alice.locator('.status')).toContainText('saved here');

    await contexts[0].setOffline(false);
    await expect(alice.locator('.status')).toContainText('Live', { timeout: 30_000 });

    // Both sets of writes survive: different participants, so the keys never collided.
    await expect.poll(() => othersFree(alice, cellIndex(0, 2)), { timeout: 20_000 }).toBe(1);
    await expect.poll(() => othersFree(bob, cellIndex(0, 0)), { timeout: 20_000 }).toBe(1);
    await expect.poll(() => paintedCount(alice)).toBe(4);
    await expect.poll(() => paintedCount(bob)).toBe(4);

    await Promise.all(contexts.map((context) => context.close()));
  });

  test('marks made offline are written to the device, not just held in memory', async ({
    browser,
    request,
  }) => {
    const roomId = await createRoomViaApi(request, ordinaryRoom());
    const context = await browser.newContext();
    const page = await openAs(context, roomId, 'Alice');

    await context.setOffline(true);
    await expect(page.locator('.status')).toContainText('Offline', { timeout: 20_000 });

    await dragPaint(page, cellIndex(0, 0), cellIndex(3, 0));
    await expect.poll(() => paintedCount(page)).toBe(4);
    // Let the debounced snapshot write land.
    await page.waitForTimeout(1_500);

    // Closing the tab now must not lose the work, so it has to be on disk rather than in a
    // JavaScript heap that is about to be discarded.
    const stored = await page.evaluate(
      async (id) =>
        new Promise<{ outbox: number; availability: number }>((resolve, reject) => {
          const open = indexedDB.open('overlap');
          open.onerror = () => {
            reject(new Error('IndexedDB unavailable'));
          };
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction(['rooms', 'outbox'], 'readonly');
            const roomRequest = tx.objectStore('rooms').get(id);
            const outboxRequest = tx.objectStore('outbox').get(id);
            tx.oncomplete = () => {
              const room = roomRequest.result as
                { snapshot: { availability: { entries: unknown[] } } } | undefined;
              const outbox = outboxRequest.result as { ops: { k: string }[] } | undefined;
              resolve({
                // Counting availability ops specifically. The outbox may also still hold the
                // name op if its acknowledgement had not landed before the network was cut —
                // which is precisely the race this whole mechanism exists to survive, so it
                // must not be able to fail the test.
                outbox: (outbox?.ops ?? []).filter((op) => op.k === 'a').length,
                availability: room?.snapshot.availability.entries.length ?? 0,
              });
            };
          };
        }),
      roomId,
    );

    // Four painted cells, still queued because there was nowhere to send them.
    expect(stored.outbox).toBe(4);
    expect(stored.availability).toBeGreaterThanOrEqual(4);

    await context.close();
  });
});
