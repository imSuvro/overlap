import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  HybridLogicalClock,
  MAX_CLOCK_DRIFT_MS,
  compareHlc,
  decodeHlc,
  encodeHlc,
  hlcEquals,
  hlcGreaterThan,
  type Hlc,
} from './hlc.js';

/** A controllable clock, so tests can freeze time, skip forward, or run it backwards. */
function fakeClock(start = 1_000_000) {
  let current = start;
  return {
    now: () => current,
    set: (value: number) => {
      current = value;
    },
    advance: (by: number) => {
      current += by;
    },
  };
}

const arbStamp: fc.Arbitrary<Hlc> = fc.record({
  wallMs: fc.integer({ min: 0, max: 5_000 }),
  counter: fc.integer({ min: 0, max: 8 }),
  actorId: fc.constantFrom('alice', 'bob', 'carol', 'dave'),
});

describe('compareHlc — a total order', () => {
  it('is antisymmetric', () => {
    fc.assert(
      fc.property(arbStamp, arbStamp, (a, b) => {
        expect(Math.sign(compareHlc(a, b))).toBe(-Math.sign(compareHlc(b, a)));
      }),
    );
  });

  it('is transitive', () => {
    fc.assert(
      fc.property(arbStamp, arbStamp, arbStamp, (a, b, c) => {
        if (compareHlc(a, b) <= 0 && compareHlc(b, c) <= 0) {
          expect(compareHlc(a, c)).toBeLessThanOrEqual(0);
        }
      }),
    );
  });

  it('only calls stamps equal when every field matches', () => {
    fc.assert(
      fc.property(arbStamp, arbStamp, (a, b) => {
        expect(compareHlc(a, b) === 0).toBe(hlcEquals(a, b));
      }),
    );
  });

  it('breaks wall-time and counter ties by actor, so every replica picks the same winner', () => {
    const alice: Hlc = { wallMs: 100, counter: 0, actorId: 'alice' };
    const bob: Hlc = { wallMs: 100, counter: 0, actorId: 'bob' };
    expect(hlcGreaterThan(bob, alice)).toBe(true);
    expect(hlcGreaterThan(alice, bob)).toBe(false);
  });
});

describe('HybridLogicalClock — local events', () => {
  it('issues strictly increasing stamps as time advances', () => {
    const clock = fakeClock();
    const hlc = new HybridLogicalClock('alice', { now: clock.now });
    let previous = hlc.tick();
    for (let i = 0; i < 50; i += 1) {
      clock.advance(10);
      const next = hlc.tick();
      expect(hlcGreaterThan(next, previous)).toBe(true);
      previous = next;
    }
  });

  it('disambiguates by counter when physical time has not moved', () => {
    const clock = fakeClock();
    const hlc = new HybridLogicalClock('alice', { now: clock.now });
    const first = hlc.tick();
    const second = hlc.tick();
    const third = hlc.tick();

    expect(first.wallMs).toBe(second.wallMs);
    expect(second.counter).toBe(first.counter + 1);
    expect(third.counter).toBe(second.counter + 1);
    expect(hlcGreaterThan(third, first)).toBe(true);
  });

  it('never goes backwards when the system clock does', () => {
    // NTP corrections really do move clocks backwards. A pure wall-clock stamp would start
    // losing conflicts it should win.
    const clock = fakeClock();
    const hlc = new HybridLogicalClock('alice', { now: clock.now });
    const before = hlc.tick();

    clock.advance(-60_000);
    const after = hlc.tick();

    expect(hlcGreaterThan(after, before)).toBe(true);
    expect(after.wallMs).toBe(before.wallMs);
  });
});

describe('HybridLogicalClock — causality', () => {
  it('stamps every later local event after the remote event it observed', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -50_000, max: MAX_CLOCK_DRIFT_MS }),
        fc.integer({ min: 0, max: 5 }),
        (offset, counter) => {
          const clock = fakeClock();
          const hlc = new HybridLogicalClock('alice', { now: clock.now });
          const remote: Hlc = {
            wallMs: clock.now() + offset,
            counter,
            actorId: 'bob',
          };

          hlc.observe(remote);
          const local = hlc.tick();

          // If bob -> alice, then stamp(bob) < stamp(alice). This is the property that makes
          // the order causal rather than merely total.
          expect(hlcGreaterThan(local, remote)).toBe(true);
        },
      ),
    );
  });

  it('preserves causality along a chain across three actors', () => {
    const clock = fakeClock();
    const alice = new HybridLogicalClock('alice', { now: clock.now });
    const bob = new HybridLogicalClock('bob', { now: clock.now });
    const carol = new HybridLogicalClock('carol', { now: clock.now });

    // Same frozen instant throughout, so only the logical part can order these.
    const a = alice.tick();
    bob.observe(a);
    const b = bob.tick();
    carol.observe(b);
    const c = carol.tick();

    expect(hlcGreaterThan(b, a)).toBe(true);
    expect(hlcGreaterThan(c, b)).toBe(true);
    expect(hlcGreaterThan(c, a)).toBe(true);
  });
});

describe('HybridLogicalClock — clock skew', () => {
  it('refuses to be dragged forward by a peer whose clock is wildly ahead', () => {
    const clock = fakeClock();
    const hlc = new HybridLogicalClock('alice', { now: clock.now });

    const oneYear = 365 * 24 * 60 * 60_000;
    hlc.observe({ wallMs: clock.now() + oneYear, counter: 0, actorId: 'broken-device' });

    // Without the clamp this clock would now be a year in the future, permanently, and would
    // win every conflict against every correctly-set device from here on.
    expect(hlc.peek().wallMs).toBeLessThanOrEqual(clock.now() + MAX_CLOCK_DRIFT_MS);
  });

  it('still accepts a peer that is only plausibly out of sync', () => {
    const clock = fakeClock();
    const hlc = new HybridLogicalClock('alice', { now: clock.now });
    const modestlyAhead = clock.now() + 30_000;

    hlc.observe({ wallMs: modestlyAhead, counter: 0, actorId: 'bob' });
    expect(hlc.peek().wallMs).toBe(modestlyAhead);
  });

  it('does not move backwards when a peer is behind', () => {
    const clock = fakeClock();
    const hlc = new HybridLogicalClock('alice', { now: clock.now });
    const before = hlc.tick();

    hlc.observe({ wallMs: 0, counter: 0, actorId: 'stale' });
    expect(hlc.peek().wallMs).toBeGreaterThanOrEqual(before.wallMs);
  });
});

describe('encoding', () => {
  it('round-trips every stamp', () => {
    fc.assert(
      fc.property(arbStamp, (stamp) => {
        expect(decodeHlc(encodeHlc(stamp))).toEqual(stamp);
      }),
    );
  });

  it('survives actor ids containing the delimiter', () => {
    const stamp: Hlc = { wallMs: 42, counter: 7, actorId: 'weird.actor.id' };
    expect(decodeHlc(encodeHlc(stamp))).toEqual(stamp);
  });

  it('rejects malformed input rather than producing a garbage stamp', () => {
    expect(() => decodeHlc('')).toThrow(SyntaxError);
    expect(() => decodeHlc('123')).toThrow(SyntaxError);
    expect(() => decodeHlc('123.4')).toThrow(SyntaxError);
    expect(() => decodeHlc('123.4.')).toThrow(SyntaxError);
    expect(() => decodeHlc('abc.def.alice')).toThrow(SyntaxError);
  });
});

describe('construction', () => {
  it('requires an actor id, because without one the order is not total', () => {
    expect(() => new HybridLogicalClock('')).toThrow(RangeError);
  });
});
