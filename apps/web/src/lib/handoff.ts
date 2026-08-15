const STORAGE_KEY = 'overlap.just-created.v1';

/**
 * The one thing the room needs to know that the URL does not say: you just made this.
 *
 * Deliberately not a query parameter. The whole point of the screen it unlocks is that the host
 * copies the address of the room, and `?created=1` riding along on the link they paste into a
 * group chat would be both ugly and, for anyone who followed it, wrong.
 *
 * `sessionStorage` rather than `localStorage`: the handoff is meaningful for exactly one
 * navigation in one tab. It should not survive the tab, and it should not leak into a second
 * window opened on the same room.
 */
let memoryFallback: string | null = null;

/** Reading storage throws outright in some private-browsing modes, not merely returning null. */
function read(): string | null {
  if (memoryFallback !== null) return memoryFallback;
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function rememberJustCreated(roomId: string): void {
  memoryFallback = roomId;
  try {
    sessionStorage.setItem(STORAGE_KEY, roomId);
  } catch {
    // Already held in memory for this tab; nothing further to do.
  }
}

export function wasJustCreated(roomId: string): boolean {
  return read() === roomId;
}

/**
 * Cleared when the host moves on, not when the flag is read.
 *
 * Reading is not the same as being finished with it: someone who reloads the share screen
 * before they have sent the link should still be looking at the link.
 */
export function forgetJustCreated(): void {
  memoryFallback = null;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to remove.
  }
}
