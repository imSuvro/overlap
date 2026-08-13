import { decodeHlc } from '@overlap/crdt';
import { z } from 'zod';
import {
  MAX_NAME_LENGTH,
  cursorSchema,
  levelSchema,
  participantIdSchema,
  presenceSchema,
  roomConfigSchema,
  sessionIdSchema,
  settingKeySchema,
  settingValueSchema,
} from './domain.js';

/** A drag across a large grid can generate hundreds of cells; this bounds one flush. */
export const MAX_OPS_PER_MESSAGE = 512;

/** Anything larger than this is not a legitimate client, so it is closed rather than parsed. */
export const MAX_MESSAGE_BYTES = 256 * 1024;

const hlcStringSchema = z.string().max(64).refine(isDecodableHlc, 'Malformed stamp');

function isDecodableHlc(value: string): boolean {
  try {
    decodeHlc(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * A single CRDT write.
 *
 * Field names are one character because these fly at drag rate over a mobile connection —
 * `k`ind, `key`, `v`alue, `s`tamp. The discriminant `k` is: `a`vailability, `n`ame, `s`etting.
 */
export const opSchema = z.discriminatedUnion('k', [
  z.object({
    k: z.literal('a'),
    key: z.string().max(64),
    v: levelSchema,
    s: hlcStringSchema,
  }),
  z.object({
    k: z.literal('n'),
    key: participantIdSchema,
    v: z.string().trim().min(1).max(MAX_NAME_LENGTH),
    s: hlcStringSchema,
  }),
  z.object({
    k: z.literal('s'),
    key: settingKeySchema,
    v: settingValueSchema,
    s: hlcStringSchema,
  }),
]);
export type Op = z.infer<typeof opSchema>;

/** Serialised form of one {@link import('@overlap/crdt').LwwMap}. */
function lwwSnapshotSchema<T extends z.ZodTypeAny>(value: T) {
  return z.object({
    v: z.literal(1),
    actors: z.array(z.string().max(64)),
    entries: z.array(
      z.tuple([z.string().max(64), value, z.number(), z.number().int(), z.number().int()]),
    ),
  });
}

export const roomSnapshotSchema = z.object({
  availability: lwwSnapshotSchema(levelSchema),
  names: lwwSnapshotSchema(z.string().max(MAX_NAME_LENGTH)),
  settings: lwwSnapshotSchema(settingValueSchema),
});
export type RoomSnapshot = z.infer<typeof roomSnapshotSchema>;

export const errorCodeSchema = z.enum([
  'room-not-found',
  'malformed-message',
  'message-too-large',
  'rate-limited',
  'internal',
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const clientMessageSchema = z.discriminatedUnion('t', [
  /**
   * Sent on every connect, including reconnects. Carries the entire outstanding outbox —
   * idempotent merge means resending is always safe and needs no acknowledgement protocol.
   */
  z.object({
    t: z.literal('hello'),
    participantId: participantIdSchema,
    sessionId: sessionIdSchema,
    ops: z.array(opSchema).max(MAX_OPS_PER_MESSAGE),
  }),
  z.object({
    t: z.literal('ops'),
    ops: z.array(opSchema).min(1).max(MAX_OPS_PER_MESSAGE),
  }),
  z.object({
    t: z.literal('presence'),
    cursor: cursorSchema.nullable(),
    hoveredInstant: z.number().int().nullable(),
  }),
  z.object({ t: z.literal('ping') }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

export const serverMessageSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('welcome'),
    config: roomConfigSchema,
    snapshot: roomSnapshotSchema,
    peers: z.array(presenceSchema),
    /**
     * The id this *connection* is known by, assigned by the server.
     *
     * Distinct from the `sessionId` the client uses as its HLC actor: that one has to exist
     * before any socket does, because writes happen offline. This one identifies the peer in
     * presence and `left` messages, and being server-assigned means a client cannot claim to
     * be someone else's connection.
     */
    sessionId: sessionIdSchema,
    /** Lets the client measure its own clock skew against the room. */
    serverTime: z.number().int(),
  }),
  z.object({ t: z.literal('ops'), ops: z.array(opSchema) }),
  /**
   * Confirms the server holds these ops, identified by stamp, so the sender can drop them from
   * its outbox.
   *
   * Without an acknowledgement the client would have to choose between clearing the outbox on
   * send — losing writes whenever a socket dies mid-flight — and never clearing it at all.
   * Merge is idempotent, so a redundant resend is free; a dropped write is not.
   */
  z.object({ t: z.literal('ack'), stamps: z.array(z.string().max(64)) }),
  z.object({ t: z.literal('presence'), presence: presenceSchema }),
  z.object({ t: z.literal('left'), sessionId: sessionIdSchema }),
  /**
   * Ops the server declined, with the reason. The client surfaces this rather than silently
   * dropping a write the user believes they made.
   */
  z.object({
    t: z.literal('rejected'),
    reason: z.string().max(200),
    ops: z.array(opSchema),
  }),
  z.object({ t: z.literal('error'), code: errorCodeSchema, message: z.string().max(200) }),
  z.object({ t: z.literal('pong'), serverTime: z.number().int() }),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

export const createRoomResponseSchema = z.object({
  config: roomConfigSchema,
  title: z.string(),
});
export type CreateRoomResponse = z.infer<typeof createRoomResponseSchema>;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function parseWith<T>(schema: z.ZodType<T>, raw: unknown): ParseResult<T> {
  const result = schema.safeParse(raw);
  if (result.success) return { ok: true, value: result.data };
  const first = result.error.issues[0];
  const path = first && first.path.length > 0 ? `${first.path.join('.')}: ` : '';
  return { ok: false, error: `${path}${first?.message ?? 'invalid message'}` };
}

/**
 * Parses a frame arriving from a client.
 *
 * Every boundary validates. This one matters most: it is the only thing standing between an
 * arbitrary browser and the room's persisted state, and it fails closed — an unrecognised
 * message type is rejected rather than ignored, so a protocol mismatch surfaces instead of
 * quietly doing nothing.
 */
export function parseClientMessage(raw: string): ParseResult<ClientMessage> {
  if (raw.length > MAX_MESSAGE_BYTES) return { ok: false, error: 'message too large' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'not valid JSON' };
  }
  return parseWith(clientMessageSchema, parsed);
}

/**
 * Parses a frame arriving from the server.
 *
 * Validated on the client too, not out of distrust but because a deployed client can outlive a
 * server version. Failing loudly on an unknown shape beats rendering half a room.
 */
export function parseServerMessage(raw: string): ParseResult<ServerMessage> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'not valid JSON' };
  }
  return parseWith(serverMessageSchema, parsed);
}

export function encodeClientMessage(message: ClientMessage): string {
  return JSON.stringify(message);
}

export function encodeServerMessage(message: ServerMessage): string {
  return JSON.stringify(message);
}
