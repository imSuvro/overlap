/**
 * A Hybrid Logical Clock timestamp.
 *
 * Three fields, compared lexicographically, giving a **total** order — which is what makes
 * conflict resolution deterministic. Two replicas handed the same pair of stamps always pick
 * the same winner, so they cannot diverge.
 */
export interface Hlc {
  /** Physical time, monotonically non-decreasing for this actor. */
  readonly wallMs: number;
  /** Disambiguates events that share a wall time. Reset whenever wall time advances. */
  readonly counter: number;
  /** Final tiebreaker. Without it the order is partial and ties could resolve differently. */
  readonly actorId: string;
}

/**
 * How far ahead of local time a peer's clock is allowed to drag us.
 *
 * Without a bound, one device with a badly-wrong clock wins every conflict for as long as its
 * skew lasts — and drags every other replica's clock forward with it, permanently. Five
 * minutes is comfortably above real-world NTP drift and well below "this device thinks it is
 * next year".
 */
export const MAX_CLOCK_DRIFT_MS = 5 * 60_000;

/** Total order over stamps. Negative when `a` precedes `b`. */
export function compareHlc(a: Hlc, b: Hlc): number {
  if (a.wallMs !== b.wallMs) return a.wallMs - b.wallMs;
  if (a.counter !== b.counter) return a.counter - b.counter;
  return a.actorId < b.actorId ? -1 : a.actorId > b.actorId ? 1 : 0;
}

export function hlcGreaterThan(a: Hlc, b: Hlc): boolean {
  return compareHlc(a, b) > 0;
}

export function hlcEquals(a: Hlc, b: Hlc): boolean {
  return a.wallMs === b.wallMs && a.counter === b.counter && a.actorId === b.actorId;
}

/** Compact wire form: `wallMs.counter.actorId`. */
export function encodeHlc(stamp: Hlc): string {
  return `${stamp.wallMs}.${stamp.counter}.${stamp.actorId}`;
}

export function decodeHlc(encoded: string): Hlc {
  const firstDot = encoded.indexOf('.');
  const secondDot = encoded.indexOf('.', firstDot + 1);
  if (firstDot < 0 || secondDot < 0) {
    throw new SyntaxError(`Malformed HLC: ${JSON.stringify(encoded)}`);
  }

  const wallMs = Number.parseInt(encoded.slice(0, firstDot), 10);
  const counter = Number.parseInt(encoded.slice(firstDot + 1, secondDot), 10);
  const actorId = encoded.slice(secondDot + 1);

  if (!Number.isFinite(wallMs) || !Number.isFinite(counter) || actorId.length === 0) {
    throw new SyntaxError(`Malformed HLC: ${JSON.stringify(encoded)}`);
  }
  return { wallMs, counter, actorId };
}

export interface HybridLogicalClockOptions {
  /** Injectable for tests; defaults to `Date.now`. */
  readonly now?: () => number;
  readonly maxDriftMs?: number;
}

/**
 * Generates and advances Hybrid Logical Clock stamps for one actor.
 *
 * The point of an HLC over the two obvious alternatives:
 *
 * - A pure Lamport counter is causally correct but reads as a bug. A phone that has been
 *   asleep offline has a low counter, so the edit someone just made on it loses to an older
 *   edit from a laptop that has been chattering all afternoon.
 * - A pure wall clock is intuitive until a device's clock is wrong, at which point that device
 *   wins every conflict indefinitely.
 *
 * An HLC tracks physical time closely enough that the newer edit usually wins, never moves
 * backwards, and still guarantees that if `a` happened before `b` then `stamp(a) < stamp(b)`.
 */
export class HybridLogicalClock {
  private wallMs = 0;
  private counter = 0;
  private readonly now: () => number;
  private readonly maxDriftMs: number;

  constructor(
    public readonly actorId: string,
    options: HybridLogicalClockOptions = {},
  ) {
    if (actorId.length === 0) throw new RangeError('An HLC needs a non-empty actor id');
    this.now = options.now ?? (() => Date.now());
    this.maxDriftMs = options.maxDriftMs ?? MAX_CLOCK_DRIFT_MS;
  }

  /** Stamps a locally-generated event. */
  tick(): Hlc {
    const physical = this.now();
    if (physical > this.wallMs) {
      this.wallMs = physical;
      this.counter = 0;
    } else {
      // Physical time has not advanced since the last event (or has gone backwards, which
      // happens across an NTP correction). Keep the wall time and disambiguate by counter, so
      // stamps stay strictly increasing either way.
      this.counter += 1;
    }
    return { wallMs: this.wallMs, counter: this.counter, actorId: this.actorId };
  }

  /**
   * Advances this clock to account for having seen a remote stamp, preserving causality:
   * anything stamped after this observation sorts strictly after `remote`.
   */
  observe(remote: Hlc): void {
    const physical = this.now();
    // Clamp a peer whose clock is implausibly far ahead, so it cannot drag us with it.
    const remoteWall = Math.min(remote.wallMs, physical + this.maxDriftMs);
    const nextWall = Math.max(this.wallMs, remoteWall, physical);

    if (nextWall === this.wallMs && nextWall === remoteWall) {
      this.counter = Math.max(this.counter, remote.counter) + 1;
    } else if (nextWall === this.wallMs) {
      this.counter += 1;
    } else if (nextWall === remoteWall) {
      this.counter = remote.counter + 1;
    } else {
      this.counter = 0;
    }

    this.wallMs = nextWall;
  }

  /** The most recent stamp this clock issued or observed, without advancing it. */
  peek(): Hlc {
    return { wallMs: this.wallMs, counter: this.counter, actorId: this.actorId };
  }
}
