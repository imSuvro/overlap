import { isValidTimeZone } from '@overlap/time';
import { z } from 'zod';
import { PARTICIPANT_ID_LENGTH, ROOM_ID_LENGTH, SESSION_ID_LENGTH, isWellFormedId } from './ids.js';

/**
 * How available someone is for a slot.
 *
 * Three levels rather than a boolean is the entire "weighted yes/maybe" feature, and it costs
 * one enum widening. `unavailable` is an explicit value, not an absence — which is what keeps
 * the CRDT free of tombstones.
 */
export const LEVEL = { unavailable: 0, ifNeedBe: 1, available: 2 } as const;
export const levelSchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);
export type Level = z.infer<typeof levelSchema>;

/** What each level contributes when ranking candidate windows. */
export const LEVEL_WEIGHT: Readonly<Record<Level, number>> = { 0: 0, 1: 0.5, 2: 1 };

export const MAX_ROOM_DATES = 31;
export const MAX_ROOM_SLOTS = 2_000;
export const MAX_NAME_LENGTH = 40;
export const MAX_TITLE_LENGTH = 120;

export const roomIdSchema = z
  .string()
  .refine((value) => isWellFormedId(value, ROOM_ID_LENGTH), 'Not a valid room id');

export const participantIdSchema = z
  .string()
  .refine((value) => isWellFormedId(value, PARTICIPANT_ID_LENGTH), 'Not a valid participant id');

export const sessionIdSchema = z
  .string()
  .refine((value) => isWellFormedId(value, SESSION_ID_LENGTH), 'Not a valid session id');

export const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates must be formatted YYYY-MM-DD');

export const timeZoneSchema = z
  .string()
  .refine(isValidTimeZone, 'Not a timezone this runtime recognises');

export const slotMinutesSchema = z.union([z.literal(15), z.literal(30), z.literal(60)]);

/** Everything a host chooses when creating a room. */
export const roomDraftSchema = z
  .object({
    title: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
    anchorZone: timeZoneSchema,
    dates: z.array(localDateSchema).min(1).max(MAX_ROOM_DATES),
    dayStartMinute: z.number().int().min(0).max(1_439),
    dayEndMinute: z.number().int().min(1).max(1_440),
    slotMinutes: slotMinutesSchema,
  })
  .refine((draft) => draft.dayStartMinute < draft.dayEndMinute, {
    message: 'The day must start before it ends',
    path: ['dayEndMinute'],
  })
  .refine((draft) => (draft.dayEndMinute - draft.dayStartMinute) % draft.slotMinutes === 0, {
    message: 'The chosen hours must divide evenly into slots',
    path: ['slotMinutes'],
  })
  .refine(
    (draft) =>
      (draft.dates.length * (draft.dayEndMinute - draft.dayStartMinute)) / draft.slotMinutes <=
      MAX_ROOM_SLOTS,
    {
      // Without a ceiling, a crafted request could ask for a room with millions of slots and
      // pin the Durable Object that owns it.
      message: 'That is more slots than a room can hold',
      path: ['dates'],
    },
  )
  .refine((draft) => new Set(draft.dates).size === draft.dates.length, {
    message: 'Dates must be distinct',
    path: ['dates'],
  });

export type RoomDraft = z.infer<typeof roomDraftSchema>;

export const roomConfigSchema = z.object({
  roomId: roomIdSchema,
  anchorZone: timeZoneSchema,
  dates: z.array(localDateSchema).min(1).max(MAX_ROOM_DATES),
  dayStartMinute: z.number().int().min(0).max(1_439),
  dayEndMinute: z.number().int().min(1).max(1_440),
  slotMinutes: slotMinutesSchema,
  createdAt: z.number().int().nonnegative(),
});

/**
 * The immutable half of a room.
 *
 * The title is deliberately absent — it is editable, so it lives in the CRDT as a register
 * rather than here, where changing it would mean rewriting a config every replica has cached.
 */
export type RoomConfig = z.infer<typeof roomConfigSchema>;

export const participantSchema = z.object({
  participantId: participantIdSchema,
  name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
});
export type Participant = z.infer<typeof participantSchema>;

/** Normalised grid coordinates, so a cursor lands in the same place on any screen size. */
export const cursorSchema = z.object({
  x: z.number().min(-0.1).max(1.1),
  y: z.number().min(-0.1).max(1.1),
});
export type Cursor = z.infer<typeof cursorSchema>;

export const presenceSchema = z.object({
  sessionId: sessionIdSchema,
  participantId: participantIdSchema,
  name: z.string().max(MAX_NAME_LENGTH),
  cursor: cursorSchema.nullable(),
  hoveredInstant: z.number().int().nullable(),
});
export type Presence = z.infer<typeof presenceSchema>;

/** Keys used in the settings register map. */
export const SETTING_KEYS = { title: 'title', finalizedInstant: 'finalizedInstant' } as const;
export const settingKeySchema = z.enum(['title', 'finalizedInstant']);
export type SettingKey = z.infer<typeof settingKeySchema>;

export const settingValueSchema = z.union([z.string().max(MAX_TITLE_LENGTH), z.number(), z.null()]);
export type SettingValue = z.infer<typeof settingValueSchema>;

/** `participantId|instant` — the availability key. */
export function availabilityKey(participantId: string, instant: number): string {
  return `${participantId}|${instant}`;
}

export function parseAvailabilityKey(
  key: string,
): { participantId: string; instant: number } | null {
  const separator = key.indexOf('|');
  if (separator <= 0) return null;

  const participantId = key.slice(0, separator);
  if (!isWellFormedId(participantId, PARTICIPANT_ID_LENGTH)) return null;

  const rawInstant = key.slice(separator + 1);
  const instant = Number(rawInstant);
  if (!Number.isSafeInteger(instant)) return null;

  // The instant must be in canonical decimal form, not merely *parseable* as one.
  //
  // `parseInt` is lenient: it reads "1755700000000abc" as a valid instant while leaving the
  // key itself distinct from "1755700000000". That would let a crafted client mint unlimited
  // distinct keys that all pass the room's slot check — precisely the unbounded keyspace this
  // validation exists to prevent. Comparing against `String(instant)` also rejects "01",
  // "+1", " 1", and "1e999".
  if (String(instant) !== rawInstant) return null;

  return { participantId, instant };
}
