import {
  cachedRoomSchema,
  opSchema,
  parseStored,
  type CachedRoom,
  type Op,
  type RoomConfig,
  type RoomSnapshot,
} from '@overlap/protocol';
import { z } from 'zod';

const DB_NAME = 'overlap';
const DB_VERSION = 1;
const ROOM_STORE = 'rooms';
const OUTBOX_STORE = 'outbox';

/**
 * The outbox is stored whole, keyed by room, rather than one record per op.
 *
 * Idempotent merge means the outbox has no per-op lifecycle worth tracking — an entry is
 * either still outstanding or acknowledged. Storing the array wholesale removes an index, a
 * cursor walk, and a class of partial-delete bugs, and the array is small by construction.
 */
const storedOutboxSchema = z.object({
  v: z.literal(1),
  roomId: z.string(),
  ops: z.array(opSchema),
  updatedAt: z.number(),
});
type StoredOutbox = z.infer<typeof storedOutboxSchema>;

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB request failed'));
    };
  });
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

/**
 * Opens the database, resolving to `null` if it is unavailable.
 *
 * IndexedDB is blocked entirely in some privacy configurations. Offline caching is a bonus
 * here, not a requirement — the CRDT keeps working in memory — so an unavailable database
 * degrades the experience rather than breaking it.
 */
export function openDatabase(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise<IDBDatabase | null>((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ROOM_STORE)) {
        db.createObjectStore(ROOM_STORE, { keyPath: 'roomId' });
      }
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        db.createObjectStore(OUTBOX_STORE, { keyPath: 'roomId' });
      }
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      resolve(null);
    };
    request.onblocked = () => {
      resolve(null);
    };
  });
  return dbPromise;
}

async function read(store: string, key: string): Promise<unknown> {
  const db = await openDatabase();
  if (!db) return null;
  try {
    const transaction = db.transaction(store, 'readonly');
    return await promisify<unknown>(transaction.objectStore(store).get(key));
  } catch {
    return null;
  }
}

async function write(store: string, value: unknown): Promise<void> {
  const db = await openDatabase();
  if (!db) return;
  try {
    const transaction = db.transaction(store, 'readwrite');
    await promisify(transaction.objectStore(store).put(value));
  } catch {
    // A failed cache write costs an offline reload, not correctness.
  }
}

/**
 * Reads a cached room.
 *
 * Storage is a trust boundary like any other: the value may have been written by an older
 * build of the app or edited by hand in devtools. A failed parse yields `null` and the room
 * loads from the network, rather than a malformed object reaching the CRDT.
 */
export async function loadCachedRoom(roomId: string): Promise<CachedRoom | null> {
  return parseStored(cachedRoomSchema, await read(ROOM_STORE, roomId));
}

export async function saveCachedRoom(
  roomId: string,
  config: RoomConfig,
  snapshot: RoomSnapshot,
): Promise<void> {
  const record: CachedRoom = { v: 1, roomId, config, snapshot, cachedAt: Date.now() };
  await write(ROOM_STORE, record);
}

export async function loadOutbox(roomId: string): Promise<Op[]> {
  const parsed = parseStored(storedOutboxSchema, await read(OUTBOX_STORE, roomId));
  return parsed?.ops ?? [];
}

export async function saveOutbox(roomId: string, ops: readonly Op[]): Promise<void> {
  const record: StoredOutbox = { v: 1, roomId, ops: [...ops], updatedAt: Date.now() };
  await write(OUTBOX_STORE, record);
}
