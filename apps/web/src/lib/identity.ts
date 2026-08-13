import {
  generateParticipantId,
  generateSessionId,
  parseStored,
  persistedIdentitySchema,
  type PersistedIdentity,
} from '@overlap/protocol';

const STORAGE_KEY = 'overlap.identity.v1';

/**
 * Reading and writing `localStorage` throws outright in some private-browsing configurations,
 * rather than merely returning nothing. Falling back to an in-memory identity keeps the app
 * usable for the length of the tab instead of failing to load.
 */
let memoryFallback: PersistedIdentity | null = null;

function readStore(): PersistedIdentity | null {
  if (memoryFallback) return memoryFallback;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    return parseStored(persistedIdentitySchema, JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeStore(identity: PersistedIdentity): void {
  memoryFallback = identity;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  } catch {
    // Already held in memory; nothing further to do.
  }
}

/**
 * The stable identity for this browser profile.
 *
 * Persisting it is what lets someone close the tab, come back tomorrow, and still own the
 * cells they painted — with no account to sign into. The trade-off, recorded in ADR-0007, is
 * that a second device is a second participant.
 */
export function loadIdentity(): PersistedIdentity {
  const existing = readStore();
  if (existing) return existing;

  const created: PersistedIdentity = { v: 1, participantId: generateParticipantId(), name: '' };
  writeStore(created);
  return created;
}

export function rememberName(name: string): void {
  const identity = loadIdentity();
  writeStore({ ...identity, name: name.trim().slice(0, 40) });
}

/**
 * The HLC actor for this tab.
 *
 * Deliberately *not* persisted and deliberately not the participant id: two tabs sharing an
 * actor could mint byte-identical stamps, and replicas that saw those writes in different
 * orders would diverge. One writer, one actor.
 */
const tabSessionId = generateSessionId();

export function sessionId(): string {
  return tabSessionId;
}
