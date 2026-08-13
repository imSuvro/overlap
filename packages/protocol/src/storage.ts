import { z } from 'zod';
import { MAX_NAME_LENGTH, participantIdSchema, roomConfigSchema, roomIdSchema } from './domain.js';
import { opSchema, roomSnapshotSchema } from './messages.js';

/**
 * What the server writes to durable storage.
 *
 * Versioned from day one. A room can sit untouched for weeks, so a deploy will routinely read
 * back state written by an older build — the version tag is what lets that be handled rather
 * than discovered.
 */
export const persistedRoomSchema = z.object({
  v: z.literal(1),
  config: roomConfigSchema,
  snapshot: roomSnapshotSchema,
  lastWriteAt: z.number().int().nonnegative(),
});
export type PersistedRoom = z.infer<typeof persistedRoomSchema>;

/** Identity, held in `localStorage` per browser profile. See ADR-0007. */
export const persistedIdentitySchema = z.object({
  v: z.literal(1),
  participantId: participantIdSchema,
  name: z.string().max(MAX_NAME_LENGTH),
});
export type PersistedIdentity = z.infer<typeof persistedIdentitySchema>;

/** A room snapshot cached in IndexedDB so an offline reload still renders. */
export const cachedRoomSchema = z.object({
  v: z.literal(1),
  roomId: roomIdSchema,
  config: roomConfigSchema,
  snapshot: roomSnapshotSchema,
  cachedAt: z.number().int().nonnegative(),
});
export type CachedRoom = z.infer<typeof cachedRoomSchema>;

/**
 * One locally-generated op awaiting delivery.
 *
 * There is no "sent, unconfirmed" state. Because merge is idempotent, an entry can be resent
 * any number of times, so the outbox only needs to know what has not yet been acknowledged as
 * durable — not what is in flight.
 */
export const outboxEntrySchema = z.object({
  v: z.literal(1),
  seq: z.number().int().nonnegative(),
  roomId: roomIdSchema,
  op: opSchema,
  queuedAt: z.number().int().nonnegative(),
});
export type OutboxEntry = z.infer<typeof outboxEntrySchema>;

/**
 * Reads a value that came out of local storage.
 *
 * Storage is a trust boundary like any other: the value may have been written by an older
 * version of the app, edited by hand in devtools, or corrupted. Returning `null` on a bad read
 * lets the caller fall back cleanly instead of propagating a malformed object into the CRDT.
 */
export function parseStored<T>(schema: z.ZodType<T>, raw: unknown): T | null {
  const result = schema.safeParse(raw);
  return result.success ? result.data : null;
}
