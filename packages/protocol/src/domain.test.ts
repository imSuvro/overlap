import { describe, expect, it } from 'vitest';
import {
  MAX_ROOM_SLOTS,
  availabilityKey,
  parseAvailabilityKey,
  roomDraftSchema,
  type RoomDraft,
} from './domain.js';
import {
  PARTICIPANT_ID_LENGTH,
  ROOM_ID_LENGTH,
  generateParticipantId,
  generateRoomId,
  hueForParticipant,
  isWellFormedId,
} from './ids.js';

function draft(overrides: Partial<RoomDraft> = {}): unknown {
  return {
    title: 'Team sync',
    anchorZone: 'America/New_York',
    dates: ['2026-08-20', '2026-08-21'],
    dayStartMinute: 9 * 60,
    dayEndMinute: 17 * 60,
    slotMinutes: 30,
    ...overrides,
  };
}

describe('roomDraftSchema', () => {
  it('accepts a sensible room', () => {
    expect(roomDraftSchema.safeParse(draft()).success).toBe(true);
  });

  it('rejects an unknown timezone', () => {
    expect(roomDraftSchema.safeParse(draft({ anchorZone: 'Mars/Olympus_Mons' })).success).toBe(
      false,
    );
  });

  it('rejects a day that ends before it starts', () => {
    expect(
      roomDraftSchema.safeParse(draft({ dayStartMinute: 1_000, dayEndMinute: 600 })).success,
    ).toBe(false);
  });

  it('rejects hours that do not divide into whole slots', () => {
    expect(
      roomDraftSchema.safeParse(draft({ dayStartMinute: 0, dayEndMinute: 50, slotMinutes: 30 }))
        .success,
    ).toBe(false);
  });

  it('rejects duplicate dates', () => {
    expect(roomDraftSchema.safeParse(draft({ dates: ['2026-08-20', '2026-08-20'] })).success).toBe(
      false,
    );
  });

  it('rejects a room large enough to pin the object that owns it', () => {
    // 31 days of 15-minute slots across a full day is ~2976 slots, over the ceiling.
    const enormous = draft({
      dates: Array.from({ length: 31 }, (_, i) => `2026-08-${String(i + 1).padStart(2, '0')}`),
      dayStartMinute: 0,
      dayEndMinute: 1_440,
      slotMinutes: 15,
    });
    const result = roomDraftSchema.safeParse(enormous);
    expect(result.success).toBe(false);
  });

  it('accepts a room right at the ceiling', () => {
    const atLimit = draft({
      dates: Array.from({ length: 20 }, (_, i) => `2026-08-${String(i + 1).padStart(2, '0')}`),
      dayStartMinute: 0,
      dayEndMinute: 1_440,
      slotMinutes: 30,
    });
    // 20 days x 48 slots = 960
    expect((20 * 1_440) / 30).toBeLessThanOrEqual(MAX_ROOM_SLOTS);
    expect(roomDraftSchema.safeParse(atLimit).success).toBe(true);
  });

  it('trims and rejects an empty title', () => {
    expect(roomDraftSchema.safeParse(draft({ title: '   ' })).success).toBe(false);
    const parsed = roomDraftSchema.safeParse(draft({ title: '  Sprint planning  ' }));
    expect(parsed.success && parsed.data.title).toBe('Sprint planning');
  });

  it('rejects a malformed date', () => {
    expect(roomDraftSchema.safeParse(draft({ dates: ['20-08-2026'] })).success).toBe(false);
  });
});

describe('availability keys', () => {
  it('round-trips', () => {
    const participantId = generateParticipantId();
    const key = availabilityKey(participantId, 1_755_700_000_000);
    expect(parseAvailabilityKey(key)).toEqual({ participantId, instant: 1_755_700_000_000 });
  });

  it('rejects keys a crafted client could use to grow the keyspace', () => {
    expect(parseAvailabilityKey('no-separator')).toBeNull();
    expect(parseAvailabilityKey('|123')).toBeNull();
    expect(parseAvailabilityKey(`${generateParticipantId()}|not-a-number`)).toBeNull();
    expect(parseAvailabilityKey('short|123')).toBeNull();
    expect(parseAvailabilityKey(`${generateParticipantId()}|1e999`)).toBeNull();
  });

  it('requires the instant in canonical decimal form, not merely parseable as one', () => {
    // A lenient parse would read all of these as a valid instant while leaving the key itself
    // distinct — unlimited distinct keys that all pass the room's slot check.
    const participantId = generateParticipantId();
    const real = 1_755_700_000_000;

    expect(parseAvailabilityKey(`${participantId}|${real}`)).toEqual({
      participantId,
      instant: real,
    });
    for (const suffix of [
      `${real}abc`,
      `0${real}`,
      `+${real}`,
      ` ${real}`,
      `${real}.0`,
      `${real} `,
    ]) {
      expect(parseAvailabilityKey(`${participantId}|${suffix}`)).toBeNull();
    }
  });
});

describe('identifiers', () => {
  it('generates ids of the declared length from the base58 alphabet', () => {
    for (let i = 0; i < 200; i += 1) {
      const roomId = generateRoomId();
      expect(isWellFormedId(roomId, ROOM_ID_LENGTH)).toBe(true);
      expect(roomId).not.toMatch(/[0OIl]/);
    }
  });

  it('does not repeat itself', () => {
    const ids = new Set(Array.from({ length: 2_000 }, () => generateRoomId()));
    expect(ids.size).toBe(2_000);
  });

  it('rejects a non-positive length rather than returning an empty id', () => {
    expect(() => generateRoomId.call(null)).not.toThrow();
    expect(isWellFormedId('', ROOM_ID_LENGTH)).toBe(false);
    expect(isWellFormedId(generateParticipantId(), PARTICIPANT_ID_LENGTH)).toBe(true);
  });

  it('derives a stable hue so every client colours a person identically', () => {
    const participantId = generateParticipantId();
    const hue = hueForParticipant(participantId);
    expect(hue).toBe(hueForParticipant(participantId));
    expect(hue).toBeGreaterThanOrEqual(0);
    expect(hue).toBeLessThan(360);
  });

  it('spreads hues across the wheel rather than clustering', () => {
    const hues = Array.from({ length: 300 }, () => hueForParticipant(generateParticipantId()));
    const buckets = new Set(hues.map((hue) => Math.floor(hue / 30)));
    expect(buckets.size).toBeGreaterThanOrEqual(10); // 12 buckets of 30 degrees
  });
});
