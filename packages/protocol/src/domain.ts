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

/**
 * A real day on the calendar, not merely something shaped like one.
 *
 * `2026-02-31` satisfies the pattern and every range check, then silently becomes 3 March when
 * the date arithmetic normalises it — so a room would materialise slots on a day nobody asked
 * for. Round-tripping through the date itself is the only check that catches it.
 */
function isRealCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const [, rawYear, rawMonth, rawDay] = match;
  if (rawYear === undefined || rawMonth === undefined || rawDay === undefined) return false;

  const year = Number.parseInt(rawYear, 10);
  const month = Number.parseInt(rawMonth, 10);
  const day = Number.parseInt(rawDay, 10);

  const probe = new Date(0);
  probe.setUTCFullYear(year, month - 1, day);
  probe.setUTCHours(0, 0, 0, 0);

  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

export const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates must be formatted YYYY-MM-DD')
  .refine(isRealCalendarDate, 'That date does not exist');

export const timeZoneSchema = z
  .string()
  .refine(isValidTimeZone, 'Not a timezone this runtime recognises');

export const slotMinutesSchema = z.union([z.literal(15), z.literal(30), z.literal(60)]);

interface SchedulingShape {
  readonly dates: readonly string[];
  readonly dayStartMinute: number;
  readonly dayEndMinute: number;
  readonly slotMinutes: number;
}

/**
 * The invariants that make a room's schedule coherent.
 *
 * Shared between the draft a host submits and the stored configuration, because the config is
 * read back from durable storage and from `welcome` frames — both of which can carry something
 * written by an older build or edited by hand. Validating only on the way in would leave the
 * way out unguarded.
 */
function checkSchedule(shape: SchedulingShape, ctx: z.RefinementCtx): void {
  if (shape.dayStartMinute >= shape.dayEndMinute) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'The day must start before it ends',
      path: ['dayEndMinute'],
    });
  }
  if ((shape.dayEndMinute - shape.dayStartMinute) % shape.slotMinutes !== 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'The chosen hours must divide evenly into slots',
      path: ['slotMinutes'],
    });
  }
  if (new Set(shape.dates).size !== shape.dates.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Dates must be distinct',
      path: ['dates'],
    });
  }
  // Without a ceiling, a crafted request could ask for a room with millions of slots and pin
  // the Durable Object that owns it.
  const slots =
    (shape.dates.length * (shape.dayEndMinute - shape.dayStartMinute)) / shape.slotMinutes;
  if (slots > MAX_ROOM_SLOTS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'That is more slots than a room can hold',
      path: ['dates'],
    });
  }
}

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
  .superRefine(checkSchedule);

export type RoomDraft = z.infer<typeof roomDraftSchema>;

export const roomConfigSchema = z
  .object({
    roomId: roomIdSchema,
    anchorZone: timeZoneSchema,
    dates: z.array(localDateSchema).min(1).max(MAX_ROOM_DATES),
    dayStartMinute: z.number().int().min(0).max(1_439),
    dayEndMinute: z.number().int().min(1).max(1_440),
    slotMinutes: slotMinutesSchema,
    createdAt: z.number().int().nonnegative(),
  })
  .superRefine(checkSchedule);

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
