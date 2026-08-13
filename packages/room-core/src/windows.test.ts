import { encodeHlc } from '@overlap/crdt';
import { availabilityKey, generateParticipantId, type Level } from '@overlap/protocol';
import { materializeSlots, type RoomShape } from '@overlap/time';
import { describe, expect, it } from 'vitest';
import { RoomState } from './state.js';
import { findBestWindows, slotScore } from './windows.js';

const SHAPE: RoomShape = {
  anchorZone: 'America/New_York',
  dates: ['2026-08-20', '2026-08-21'],
  dayStartMinute: 9 * 60,
  dayEndMinute: 17 * 60,
  slotMinutes: 30,
};

const slots = materializeSlots(SHAPE).slots;

let sequence = 0;
function paint(state: RoomState, participantId: string, instants: number[], level: Level): void {
  for (const instant of instants) {
    sequence += 1;
    state.applyOp({
      k: 'a',
      key: availabilityKey(participantId, instant),
      v: level,
      s: encodeHlc({ wallMs: 1_000 + sequence, counter: 0, actorId: participantId }),
    });
  }
}

function instantsAt(...indexes: number[]): number[] {
  return indexes.map((index) => slots[index]?.instant ?? 0);
}

describe('findBestWindows', () => {
  it('ranks the window that suits the most people first', () => {
    const state = new RoomState();
    const [alice, bob, carol] = [
      generateParticipantId(),
      generateParticipantId(),
      generateParticipantId(),
    ];

    // Slots 4 and 5 work for everyone; slots 0 and 1 work only for Alice.
    paint(state, alice, instantsAt(0, 1, 4, 5), 2);
    paint(state, bob, instantsAt(4, 5), 2);
    paint(state, carol, instantsAt(4, 5), 2);

    const [best] = findBestWindows({
      slots,
      state,
      participantIds: [alice, bob, carol],
      slotMinutes: 30,
      windowSlots: 2,
      limit: 3,
    });

    expect(best?.startInstant).toBe(slots[4]?.instant);
    expect(best?.score).toBe(3);
    expect(best?.available).toHaveLength(3);
    expect(best?.unavailable).toHaveLength(0);
  });

  it('counts a participant at their worst level across the whole window', () => {
    // Scoring each slot independently and averaging would happily recommend a meeting half
    // the room can only attend the first half of.
    const state = new RoomState();
    const alice = generateParticipantId();

    paint(state, alice, instantsAt(0), 2);
    paint(state, alice, instantsAt(1), 0);

    const windows = findBestWindows({
      slots,
      state,
      participantIds: [alice],
      slotMinutes: 30,
      windowSlots: 2,
      limit: 5,
    });

    const spanningBoth = windows.find((window) => window.startInstant === slots[0]?.instant);
    expect(spanningBoth).toBeUndefined();
  });

  it('classifies someone who can only make it grudgingly as “if need be”', () => {
    const state = new RoomState();
    const alice = generateParticipantId();
    const bob = generateParticipantId();

    paint(state, alice, instantsAt(0, 1), 2);
    paint(state, bob, instantsAt(0), 2);
    paint(state, bob, instantsAt(1), 1);

    const [best] = findBestWindows({
      slots,
      state,
      participantIds: [alice, bob],
      slotMinutes: 30,
      windowSlots: 2,
      limit: 1,
    });

    expect(best?.available).toEqual([alice]);
    expect(best?.ifNeedBe).toEqual([bob]);
    expect(best?.score).toBe(1.5); // 1 for available, 0.5 for if-need-be
  });

  it('never proposes a window that spans the overnight gap between two days', () => {
    const state = new RoomState();
    const alice = generateParticipantId();
    // Paint everything, so the only thing preventing an overnight window is the run split.
    paint(
      state,
      alice,
      slots.map((slot) => slot.instant),
      2,
    );

    const windows = findBestWindows({
      slots,
      state,
      participantIds: [alice],
      slotMinutes: 30,
      windowSlots: 2,
      limit: 50,
    });

    const lastOfDayOne = slots[15]?.instant ?? 0;
    expect(windows.some((window) => window.startInstant === lastOfDayOne)).toBe(false);
    for (const window of windows) {
      expect(window.endInstant - window.startInstant).toBe(60 * 60_000);
    }
  });

  it('does not return overlapping near-duplicates of the same suggestion', () => {
    const state = new RoomState();
    const alice = generateParticipantId();
    paint(
      state,
      alice,
      slots.map((slot) => slot.instant),
      2,
    );

    const windows = findBestWindows({
      slots,
      state,
      participantIds: [alice],
      slotMinutes: 30,
      windowSlots: 2,
      limit: 3,
    });

    expect(windows).toHaveLength(3);
    for (let i = 1; i < windows.length; i += 1) {
      const previous = windows[i - 1];
      const current = windows[i];
      if (!previous || !current) continue;
      const overlaps =
        current.startInstant < previous.endInstant && current.endInstant > previous.startInstant;
      expect(overlaps).toBe(false);
    }
  });

  it('shrinks the window rather than returning nothing when the room is short', () => {
    const shortSlots = materializeSlots({
      ...SHAPE,
      dates: ['2026-08-20'],
      dayStartMinute: 9 * 60,
      dayEndMinute: 10 * 60,
    }).slots;
    const state = new RoomState();
    const alice = generateParticipantId();
    paint(
      state,
      alice,
      shortSlots.map((slot) => slot.instant),
      2,
    );

    const windows = findBestWindows({
      slots: shortSlots,
      state,
      participantIds: [alice],
      slotMinutes: 30,
      windowSlots: 8, // four hours, in a one-hour room
      limit: 1,
    });

    expect(windows).toHaveLength(1);
    expect(windows[0]?.slotCount).toBe(2);
  });

  it('returns nothing when nobody is available', () => {
    const state = new RoomState();
    const alice = generateParticipantId();
    expect(
      findBestWindows({ slots, state, participantIds: [alice], slotMinutes: 30, limit: 3 }),
    ).toEqual([]);
  });

  it('returns nothing for degenerate inputs', () => {
    const state = new RoomState();
    expect(findBestWindows({ slots, state, participantIds: [], slotMinutes: 30 })).toEqual([]);
    expect(findBestWindows({ slots: [], state, participantIds: ['x'], slotMinutes: 30 })).toEqual(
      [],
    );
    expect(
      findBestWindows({ slots, state, participantIds: ['x'], slotMinutes: 30, limit: 0 }),
    ).toEqual([]);
  });

  it('defaults to a one-hour window', () => {
    const state = new RoomState();
    const alice = generateParticipantId();
    paint(
      state,
      alice,
      slots.map((slot) => slot.instant),
      2,
    );

    const [best] = findBestWindows({ slots, state, participantIds: [alice], slotMinutes: 30 });
    expect(best?.slotCount).toBe(2);
  });

  it('spans a DST transition without breaking the run', () => {
    // Clocks jumping from 01:59 to 03:00 leaves the instants 30 minutes apart, because only
    // the labels moved. A meeting across a transition needs no special handling.
    const dstSlots = materializeSlots({
      anchorZone: 'America/New_York',
      dates: ['2026-03-08'],
      dayStartMinute: 0,
      dayEndMinute: 6 * 60,
      slotMinutes: 30,
    }).slots;
    const state = new RoomState();
    const alice = generateParticipantId();
    paint(
      state,
      alice,
      dstSlots.map((slot) => slot.instant),
      2,
    );

    const windows = findBestWindows({
      slots: dstSlots,
      state,
      participantIds: [alice],
      slotMinutes: 30,
      windowSlots: 10,
      limit: 1,
    });

    expect(windows).toHaveLength(1);
    expect(windows[0]?.slotCount).toBe(10);
  });
});

describe('slotScore', () => {
  it('weights if-need-be at half of available', () => {
    const state = new RoomState();
    const [alice, bob, carol] = [
      generateParticipantId(),
      generateParticipantId(),
      generateParticipantId(),
    ];
    const instant = slots[0]?.instant ?? 0;

    paint(state, alice, [instant], 2);
    paint(state, bob, [instant], 1);
    paint(state, carol, [instant], 0);

    expect(slotScore(state, [alice, bob, carol], instant)).toBe(1.5);
  });

  it('treats an unanswered slot as unavailable', () => {
    const state = new RoomState();
    expect(slotScore(state, [generateParticipantId()], slots[0]?.instant ?? 0)).toBe(0);
  });
});
