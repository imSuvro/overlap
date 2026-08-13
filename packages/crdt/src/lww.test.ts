import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Hlc } from './hlc.js';
import { LwwMap } from './lww.js';

interface Write {
  readonly key: string;
  readonly value: number;
  readonly stamp: Hlc;
}

/**
 * Deliberately tiny domains. Four actors and five keys across a narrow band of wall times
 * means generated writes collide constantly, which is the only way to actually exercise the
 * conflict path — wide random values would almost never contend for the same key.
 */
const arbWrite: fc.Arbitrary<Write> = fc.record({
  key: fc.constantFrom('k1', 'k2', 'k3', 'k4', 'k5'),
  value: fc.integer({ min: 0, max: 2 }),
  stamp: fc.record({
    wallMs: fc.integer({ min: 0, max: 20 }),
    counter: fc.integer({ min: 0, max: 3 }),
    actorId: fc.constantFrom('alice', 'bob', 'carol', 'dave'),
  }),
});

const arbWrites = fc.array(arbWrite, { maxLength: 40 });

function build(writes: readonly Write[]): LwwMap<number> {
  const map = new LwwMap<number>();
  for (const write of writes) map.apply(write.key, write.value, write.stamp);
  return map;
}

function merged(...maps: readonly LwwMap<number>[]): LwwMap<number> {
  const result = new LwwMap<number>();
  for (const map of maps) result.merge(map);
  return result;
}

/** Applies a permutation derived from generated sort keys, so the order is genuinely random. */
function shuffle<T>(items: readonly T[], sortKeys: readonly number[]): T[] {
  return items
    .map((item, index) => ({ item, key: sortKeys[index] ?? 0 }))
    .sort((a, b) => a.key - b.key)
    .map((entry) => entry.item);
}

const arbWritesWithShuffle = arbWrites.chain((writes) =>
  fc.tuple(
    fc.constant(writes),
    fc.array(fc.double({ min: 0, max: 1, noNaN: true }), {
      minLength: writes.length,
      maxLength: writes.length,
    }),
  ),
);

describe('LwwMap — the algebraic laws that guarantee convergence', () => {
  it('merge is commutative', () => {
    fc.assert(
      fc.property(arbWrites, arbWrites, (left, right) => {
        const a = build(left);
        const b = build(right);
        expect(merged(a, b).equals(merged(b, a))).toBe(true);
      }),
    );
  });

  it('merge is associative', () => {
    fc.assert(
      fc.property(arbWrites, arbWrites, arbWrites, (x, y, z) => {
        const a = build(x);
        const b = build(y);
        const c = build(z);

        const leftGrouped = merged(merged(a, b), c);
        const rightGrouped = merged(a, merged(b, c));
        expect(leftGrouped.equals(rightGrouped)).toBe(true);
      }),
    );
  });

  it('merge is idempotent', () => {
    fc.assert(
      fc.property(arbWrites, (writes) => {
        const a = build(writes);
        const twice = a.clone();
        twice.merge(a);
        expect(twice.equals(a)).toBe(true);
      }),
    );
  });

  it('converges regardless of delivery order or duplication', () => {
    // This is the property the whole product rests on: two people painting the same grid over
    // a lossy connection end up with byte-identical state.
    fc.assert(
      fc.property(arbWritesWithShuffle, ([writes, sortKeys]) => {
        const reference = build(writes);

        const reordered = build(shuffle(writes, sortKeys));
        expect(reordered.equals(reference)).toBe(true);

        const reversed = build([...writes].reverse());
        expect(reversed.equals(reference)).toBe(true);

        // Redelivery is the normal case on reconnect, not an edge case.
        const duplicated = build([...writes, ...shuffle(writes, sortKeys), ...writes]);
        expect(duplicated.equals(reference)).toBe(true);
      }),
    );
  });

  it('never loses a write to a key nobody else touched', () => {
    // Cross-participant edits are disjoint by construction, which is why the common case has
    // no conflict at all. This asserts that directly.
    fc.assert(
      fc.property(arbWrites, arbWrites, (left, right) => {
        const a = build(left.map((w) => ({ ...w, key: `a:${w.key}` })));
        const b = build(right.map((w) => ({ ...w, key: `b:${w.key}` })));
        const both = merged(a, b);

        expect(both.size).toBe(a.size + b.size);
        for (const [key, register] of a.entries()) {
          expect(both.getRegister(key)).toEqual(register);
        }
        for (const [key, register] of b.entries()) {
          expect(both.getRegister(key)).toEqual(register);
        }
      }),
    );
  });
});

describe('LwwMap — write semantics', () => {
  it('keeps the newer write and reports whether it won', () => {
    const map = new LwwMap<number>();
    expect(map.apply('k', 1, { wallMs: 10, counter: 0, actorId: 'alice' })).toBe(true);
    expect(map.apply('k', 2, { wallMs: 20, counter: 0, actorId: 'alice' })).toBe(true);
    expect(map.get('k')).toBe(2);

    expect(map.apply('k', 3, { wallMs: 5, counter: 0, actorId: 'alice' })).toBe(false);
    expect(map.get('k')).toBe(2);
  });

  it('treats redelivery of an identical write as a no-op', () => {
    const map = new LwwMap<number>();
    const stamp: Hlc = { wallMs: 10, counter: 0, actorId: 'alice' };

    expect(map.apply('k', 1, stamp)).toBe(true);
    const versionAfterFirst = map.version;

    expect(map.apply('k', 1, stamp)).toBe(false);
    expect(map.version).toBe(versionAfterFirst);
  });

  it('resolves an exact stamp tie deterministically by actor', () => {
    // The same person on two devices, both offline, both writing the same cell at the same
    // millisecond. Every replica must pick the same winner.
    const forwards = new LwwMap<number>();
    forwards.apply('k', 1, { wallMs: 10, counter: 0, actorId: 'alice' });
    forwards.apply('k', 2, { wallMs: 10, counter: 0, actorId: 'bob' });

    const backwards = new LwwMap<number>();
    backwards.apply('k', 2, { wallMs: 10, counter: 0, actorId: 'bob' });
    backwards.apply('k', 1, { wallMs: 10, counter: 0, actorId: 'alice' });

    expect(forwards.get('k')).toBe(2);
    expect(backwards.get('k')).toBe(2);
    expect(forwards.equals(backwards)).toBe(true);
  });

  it('cannot diverge even if two frames carry the same stamp with different values', () => {
    // A well-behaved client never does this: `tick()` always advances, and every writer has
    // its own actor id. But the server accepts frames from arbitrary browsers, and divergence
    // is a worse failure than bad data because nothing would ever detect it.
    const stamp: Hlc = { wallMs: 10, counter: 0, actorId: 'alice' };

    const forwards = new LwwMap<number>();
    forwards.apply('k', 0, stamp);
    forwards.apply('k', 2, stamp);

    const backwards = new LwwMap<number>();
    backwards.apply('k', 2, stamp);
    backwards.apply('k', 0, stamp);

    expect(forwards.equals(backwards)).toBe(true);
    expect(forwards.get('k')).toBe(2);
  });

  it('bumps the version only when something actually changed', () => {
    const map = new LwwMap<number>();
    map.apply('k', 1, { wallMs: 10, counter: 0, actorId: 'alice' });
    const version = map.version;

    map.apply('k', 9, { wallMs: 1, counter: 0, actorId: 'alice' });
    expect(map.version).toBe(version);

    map.apply('k', 9, { wallMs: 11, counter: 0, actorId: 'alice' });
    expect(map.version).toBe(version + 1);
  });

  it('reports how many entries a merge changed', () => {
    const a = new LwwMap<number>();
    a.apply('k1', 1, { wallMs: 10, counter: 0, actorId: 'alice' });

    const b = new LwwMap<number>();
    b.apply('k1', 2, { wallMs: 5, counter: 0, actorId: 'bob' }); // loses
    b.apply('k2', 3, { wallMs: 5, counter: 0, actorId: 'bob' }); // wins, new key

    expect(a.merge(b)).toBe(1);
  });
});

describe('LwwMap — deltas and snapshots', () => {
  it('returns only entries newer than a cutoff', () => {
    const map = new LwwMap<number>();
    map.apply('old', 1, { wallMs: 10, counter: 0, actorId: 'alice' });
    map.apply('new', 2, { wallMs: 30, counter: 0, actorId: 'alice' });

    const delta = map.since({ wallMs: 20, counter: 0, actorId: 'alice' });
    expect(delta.map(([key]) => key)).toEqual(['new']);
  });

  it('reports the newest stamp in the map', () => {
    const map = new LwwMap<number>();
    expect(map.maxStamp()).toBeNull();

    map.apply('a', 1, { wallMs: 10, counter: 0, actorId: 'alice' });
    map.apply('b', 2, { wallMs: 30, counter: 1, actorId: 'bob' });
    expect(map.maxStamp()).toEqual({ wallMs: 30, counter: 1, actorId: 'bob' });
  });

  it('round-trips through a snapshot without losing stamps', () => {
    fc.assert(
      fc.property(arbWrites, (writes) => {
        const original = build(writes);
        const restored = LwwMap.fromSnapshot(original.toSnapshot());
        expect(restored.equals(original)).toBe(true);
      }),
    );
  });

  it('interns actor ids so a large room does not repeat them on every entry', () => {
    const map = new LwwMap<number>();
    for (let i = 0; i < 100; i += 1) {
      map.apply(`k${i}`, i, { wallMs: i, counter: 0, actorId: 'a-long-participant-identifier' });
    }
    const snapshot = map.toSnapshot();
    expect(snapshot.actors).toEqual(['a-long-participant-identifier']);
    expect(snapshot.entries).toHaveLength(100);
  });

  it('rejects a snapshot that references an actor it does not carry', () => {
    expect(() => LwwMap.fromSnapshot({ v: 1, actors: [], entries: [['k', 1, 10, 0, 3]] })).toThrow(
      RangeError,
    );
  });

  it('clones without sharing state', () => {
    const original = new LwwMap<number>();
    original.apply('k', 1, { wallMs: 10, counter: 0, actorId: 'alice' });

    const copy = original.clone();
    copy.apply('k', 2, { wallMs: 20, counter: 0, actorId: 'alice' });

    expect(original.get('k')).toBe(1);
    expect(copy.get('k')).toBe(2);
  });
});

describe('LwwMap — equality', () => {
  it('distinguishes maps that agree on values but disagree on who wrote them', () => {
    // Same visible state, different provenance. Treating these as equal would let a genuine
    // divergence slip past the convergence tests.
    const a = new LwwMap<number>();
    a.apply('k', 1, { wallMs: 10, counter: 0, actorId: 'alice' });

    const b = new LwwMap<number>();
    b.apply('k', 1, { wallMs: 10, counter: 0, actorId: 'bob' });

    expect(a.get('k')).toBe(b.get('k'));
    expect(a.equals(b)).toBe(false);
  });

  it('distinguishes maps of different sizes', () => {
    const a = new LwwMap<number>();
    a.apply('k', 1, { wallMs: 10, counter: 0, actorId: 'alice' });
    expect(a.equals(new LwwMap<number>())).toBe(false);
  });
});
