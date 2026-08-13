import { MAX_CLOCK_DRIFT_MS, encodeHlc, type Hlc } from '@overlap/crdt';
import {
  availabilityKey,
  generateParticipantId,
  generateRoomId,
  type Level,
  type Op,
  type RoomConfig,
} from '@overlap/protocol';
import { describe, expect, it } from 'vitest';
import { RoomEngine } from './engine.js';
import { RoomState } from './state.js';

const NOW = Date.UTC(2026, 7, 14, 12, 0);

function config(overrides: Partial<RoomConfig> = {}): RoomConfig {
  return {
    roomId: generateRoomId(),
    anchorZone: 'America/New_York',
    dates: ['2026-08-20', '2026-08-21'],
    dayStartMinute: 9 * 60,
    dayEndMinute: 17 * 60,
    slotMinutes: 30,
    createdAt: NOW,
    ...overrides,
  };
}

let sequence = 0;
function stamp(actorId: string, wallMs = NOW): Hlc {
  sequence += 1;
  return { wallMs, counter: sequence, actorId };
}

function availabilityOp(participantId: string, instant: number, level: Level, at?: Hlc): Op {
  return {
    k: 'a',
    key: availabilityKey(participantId, instant),
    v: level,
    s: encodeHlc(at ?? stamp(participantId)),
  };
}

describe('RoomEngine — accepting writes', () => {
  it('applies a valid availability op', () => {
    const engine = RoomEngine.create(config());
    const participantId = generateParticipantId();
    const instant = engine.slots[0]?.instant ?? 0;

    const result = engine.apply([availabilityOp(participantId, instant, 2)], {
      participantId,
      now: NOW,
    });

    expect(result.rejected).toHaveLength(0);
    expect(result.changed).toBe(true);
    expect(engine.state.levelFor(participantId, instant)).toBe(2);
  });

  it('accepts an op that lost to a newer write, but reports nothing changed', () => {
    // The op was well-formed and has been incorporated; only the broadcast is skipped.
    const engine = RoomEngine.create(config());
    const participantId = generateParticipantId();
    const instant = engine.slots[0]?.instant ?? 0;

    engine.apply(
      [availabilityOp(participantId, instant, 2, { wallMs: NOW, counter: 9, actorId: 'a' })],
      {
        participantId,
        now: NOW,
      },
    );
    const second = engine.apply(
      [availabilityOp(participantId, instant, 0, { wallMs: NOW, counter: 1, actorId: 'a' })],
      { participantId, now: NOW },
    );

    expect(second.rejected).toHaveLength(0);
    expect(second.accepted).toHaveLength(1);
    expect(second.changed).toBe(false);
    expect(engine.state.levelFor(participantId, instant)).toBe(2);
  });
});

describe('RoomEngine — rejecting writes', () => {
  it('refuses to let one participant edit another’s availability', () => {
    const engine = RoomEngine.create(config());
    const me = generateParticipantId();
    const someoneElse = generateParticipantId();
    const instant = engine.slots[0]?.instant ?? 0;

    const result = engine.apply([availabilityOp(someoneElse, instant, 2)], {
      participantId: me,
      now: NOW,
    });

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toMatch(/your own availability/);
    expect(engine.state.levelFor(someoneElse, instant)).toBe(0);
  });

  it('refuses an instant that is not part of the room', () => {
    // Without this the keyspace is unbounded — a crafted client could write availability at
    // arbitrary instants and grow the room's storage without limit.
    const engine = RoomEngine.create(config());
    const participantId = generateParticipantId();

    const result = engine.apply([availabilityOp(participantId, Date.UTC(2030, 0, 1), 2)], {
      participantId,
      now: NOW,
    });

    expect(result.rejected[0]?.reason).toMatch(/not part of this room/);
    expect(engine.state.availability.size).toBe(0);
  });

  it('refuses a stamp from a device whose clock is far in the future', () => {
    // The client clamps its own clock, but a clamp only protects the clamping replica. The
    // server is the one place every op passes through.
    const engine = RoomEngine.create(config());
    const participantId = generateParticipantId();
    const instant = engine.slots[0]?.instant ?? 0;
    const skewed = { wallMs: NOW + MAX_CLOCK_DRIFT_MS + 60_000, counter: 0, actorId: 'broken' };

    const result = engine.apply([availabilityOp(participantId, instant, 2, skewed)], {
      participantId,
      now: NOW,
    });

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toMatch(/clock/);
  });

  it('accepts a stamp that is only modestly ahead', () => {
    const engine = RoomEngine.create(config());
    const participantId = generateParticipantId();
    const instant = engine.slots[0]?.instant ?? 0;
    const slightlyAhead = { wallMs: NOW + 30_000, counter: 0, actorId: 'a' };

    const result = engine.apply([availabilityOp(participantId, instant, 2, slightlyAhead)], {
      participantId,
      now: NOW,
    });
    expect(result.rejected).toHaveLength(0);
  });

  it('refuses to let one participant rename another', () => {
    const engine = RoomEngine.create(config());
    const me = generateParticipantId();
    const someoneElse = generateParticipantId();

    const result = engine.apply(
      [{ k: 'n', key: someoneElse, v: 'Impostor', s: encodeHlc(stamp(me)) }],
      { participantId: me, now: NOW },
    );

    expect(result.rejected[0]?.reason).toMatch(/your own name/);
  });

  it('refuses to finalize on a time that is not in the room', () => {
    const engine = RoomEngine.create(config());
    const participantId = generateParticipantId();

    const result = engine.apply(
      [{ k: 's', key: 'finalizedInstant', v: 123, s: encodeHlc(stamp(participantId)) }],
      { participantId, now: NOW },
    );
    expect(result.rejected[0]?.reason).toMatch(/not part of this room/);
  });

  it('allows finalizing on a real slot, and clearing it again', () => {
    const engine = RoomEngine.create(config());
    const participantId = generateParticipantId();
    const instant = engine.slots[4]?.instant ?? 0;

    engine.apply([{ k: 's', key: 'finalizedInstant', v: instant, s: encodeHlc(stamp('a')) }], {
      participantId,
      now: NOW,
    });
    expect(engine.state.finalizedInstant()).toBe(instant);

    engine.apply([{ k: 's', key: 'finalizedInstant', v: null, s: encodeHlc(stamp('a')) }], {
      participantId,
      now: NOW,
    });
    expect(engine.state.finalizedInstant()).toBeNull();
  });

  it('refuses a non-text room title', () => {
    const engine = RoomEngine.create(config());
    const participantId = generateParticipantId();

    const result = engine.apply(
      [{ k: 's', key: 'title', v: 42, s: encodeHlc(stamp(participantId)) }],
      { participantId, now: NOW },
    );
    expect(result.rejected[0]?.reason).toMatch(/must be text/);
  });

  it('refuses a malformed availability key', () => {
    const engine = RoomEngine.create(config());
    const participantId = generateParticipantId();

    const result = engine.apply(
      [{ k: 'a', key: 'garbage', v: 1, s: encodeHlc(stamp(participantId)) }],
      { participantId, now: NOW },
    );
    expect(result.rejected[0]?.reason).toMatch(/malformed availability key/);
  });

  it('keeps the good ops in a batch that also contains bad ones', () => {
    const engine = RoomEngine.create(config());
    const participantId = generateParticipantId();
    const instant = engine.slots[0]?.instant ?? 0;

    const result = engine.apply(
      [
        availabilityOp(participantId, instant, 2),
        availabilityOp(generateParticipantId(), instant, 2),
      ],
      { participantId, now: NOW },
    );

    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
    expect(engine.state.levelFor(participantId, instant)).toBe(2);
  });
});

describe('RoomEngine — persistence', () => {
  it('round-trips through persisted form', () => {
    const engine = RoomEngine.create(config());
    const participantId = generateParticipantId();
    const instant = engine.slots[0]?.instant ?? 0;
    engine.apply([availabilityOp(participantId, instant, 1)], { participantId, now: NOW });

    const restored = RoomEngine.restore(engine.persist());
    expect(restored.state.equals(engine.state)).toBe(true);
    expect(restored.config).toEqual(engine.config);
  });

  it('returns null rather than throwing when storage holds something unreadable', () => {
    // A room can sit untouched for weeks, so a deploy will routinely read back state written
    // by an older build.
    expect(RoomEngine.restoreFrom({ v: 99, nonsense: true })).toBeNull();
    expect(RoomEngine.restoreFrom(null)).toBeNull();
  });

  it('restores from a valid persisted payload', () => {
    const engine = RoomEngine.create(config());
    expect(RoomEngine.restoreFrom(engine.persist())).not.toBeNull();
  });

  it('advances the last-write time only when state actually changed', () => {
    const engine = RoomEngine.create(config({ createdAt: 1_000 }));
    const participantId = generateParticipantId();
    const instant = engine.slots[0]?.instant ?? 0;

    expect(engine.lastWrittenAt).toBe(1_000);
    engine.apply([availabilityOp(participantId, instant, 2)], { participantId, now: NOW });
    expect(engine.lastWrittenAt).toBe(NOW);
  });
});

describe('RoomEngine — catching up a reconnecting client', () => {
  it('returns only the ops newer than the client’s cursor', () => {
    const engine = RoomEngine.create(config());
    const participantId = generateParticipantId();
    const [first, second] = engine.slots;

    engine.apply(
      [
        availabilityOp(participantId, first?.instant ?? 0, 2, {
          wallMs: 100,
          counter: 0,
          actorId: 'a',
        }),
      ],
      { participantId, now: NOW },
    );
    engine.apply(
      [
        availabilityOp(participantId, second?.instant ?? 0, 1, {
          wallMs: 300,
          counter: 0,
          actorId: 'a',
        }),
      ],
      { participantId, now: NOW },
    );

    const delta = engine.opsSince({ wallMs: 200, counter: 0, actorId: 'a' });
    expect(delta).toHaveLength(1);
    expect(delta[0]?.v).toBe(1);

    expect(engine.opsSince(null)).toHaveLength(2);
  });
});

describe('RoomState — room-level convergence', () => {
  it('reaches identical state regardless of the order ops arrive in', () => {
    // The same assertion the CRDT property tests make, but through the real op pipeline:
    // three participants, interleaved availability, names, and settings.
    const people = [generateParticipantId(), generateParticipantId(), generateParticipantId()];
    const engine = RoomEngine.create(config());
    const instants = engine.slots.slice(0, 6).map((slot) => slot.instant);

    const ops: Op[] = [];
    people.forEach((participantId, personIndex) => {
      instants.forEach((instant, slotIndex) => {
        ops.push(
          availabilityOp(participantId, instant, ((slotIndex + personIndex) % 3) as Level, {
            wallMs: NOW + slotIndex,
            counter: personIndex,
            actorId: participantId,
          }),
        );
      });
      ops.push({
        k: 'n',
        key: participantId,
        v: `Person ${personIndex}`,
        s: encodeHlc({ wallMs: NOW, counter: personIndex, actorId: participantId }),
      });
    });

    const forwards = new RoomState();
    for (const op of ops) forwards.applyOp(op);

    const backwards = new RoomState();
    for (const op of [...ops].reverse()) backwards.applyOp(op);

    const duplicated = new RoomState();
    for (const op of [...ops, ...ops].reverse()) duplicated.applyOp(op);

    expect(backwards.equals(forwards)).toBe(true);
    expect(duplicated.equals(forwards)).toBe(true);
    expect(forwards.participants()).toHaveLength(3);
  });

  it('orders participants by when they first introduced themselves', () => {
    const state = new RoomState();
    const [early, late] = [generateParticipantId(), generateParticipantId()];

    state.applyOp({
      k: 'n',
      key: late,
      v: 'Later',
      s: encodeHlc({ wallMs: 200, counter: 0, actorId: 'b' }),
    });
    state.applyOp({
      k: 'n',
      key: early,
      v: 'Earlier',
      s: encodeHlc({ wallMs: 100, counter: 0, actorId: 'a' }),
    });

    expect(state.participants().map((p) => p.name)).toEqual(['Earlier', 'Later']);
  });

  it('falls back to a readable title before anyone sets one', () => {
    expect(new RoomState().title()).toBe('Untitled room');
    expect(new RoomState().finalizedInstant()).toBeNull();
  });

  it('reports the newest stamp across all three maps', () => {
    const state = new RoomState();
    expect(state.maxStamp()).toBeNull();

    state.applyOp({ k: 'n', key: generateParticipantId(), v: 'A', s: '100.0.a' });
    state.applyOp({ k: 's', key: 'title', v: 'Plans', s: '400.0.b' });
    expect(state.maxStamp()).toEqual({ wallMs: 400, counter: 0, actorId: 'b' });
  });
});
