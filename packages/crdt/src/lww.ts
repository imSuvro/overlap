import { compareHlc, hlcEquals, type Hlc } from './hlc.js';

/**
 * A deterministic total order over values, used *only* to break an exact stamp tie.
 *
 * A well-behaved client never issues the same stamp twice, because `tick()` always advances
 * and every writer has its own actor id. But the server accepts frames from arbitrary
 * browsers, and if two frames ever carried the same stamp with different values, replicas
 * that saw them in different orders would silently diverge — which is a far worse failure
 * than bad data, because nothing would ever detect it.
 *
 * Ordering by the value itself closes that hole, and costs nothing: this runs only on an
 * exact three-field stamp collision, which does not otherwise occur.
 */
function canonicalCompare<T>(a: T, b: T): number {
  if (Object.is(a, b)) return 0;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const left = typeof a === 'string' ? a : (JSON.stringify(a) ?? 'undefined');
  const right = typeof b === 'string' ? b : (JSON.stringify(b) ?? 'undefined');
  return left < right ? -1 : left > right ? 1 : 0;
}

/** A value together with the stamp that last wrote it. */
export interface Register<T> {
  readonly value: T;
  readonly stamp: Hlc;
}

/**
 * Compact serialised form.
 *
 * Actor ids are interned into a side table because a large room holds tens of thousands of
 * entries written by a handful of people, and repeating a 22-character id on every one of them
 * would dominate the payload.
 */
export interface LwwSnapshot<T> {
  readonly v: 1;
  readonly actors: readonly string[];
  /** `[key, value, wallMs, counter, actorIndex]` — tuples, not objects, to keep JSON small. */
  readonly entries: readonly (readonly [string, T, number, number, number])[];
}

/**
 * A grow-only map of last-writer-wins registers — the whole conflict-resolution model.
 *
 * Merge is per-key maximum by stamp. Because `max` over a total order is commutative,
 * associative, and idempotent, the state space is a join-semilattice and the map has **strong
 * eventual consistency**: two replicas that have observed the same set of writes are identical,
 * regardless of the order they arrived in or how many times they were delivered.
 *
 * Three consequences make the rest of the system simple:
 *
 * - Replaying an offline outbox is free. Idempotence means no dedup table and no acknowledgement
 *   protocol.
 * - Optimistic local writes need no rollback, because a locally-applied value is already a valid
 *   replica value.
 * - The server needs no ordering authority; it merges exactly like a client.
 *
 * Mutable by design. A room holds tens of thousands of entries and merges on every op, so
 * copy-on-write would be O(n) per keystroke. React invalidation is driven by {@link version}
 * instead of by identity.
 */
export class LwwMap<T> {
  private readonly registers = new Map<string, Register<T>>();
  private revision = 0;

  get size(): number {
    return this.registers.size;
  }

  /**
   * Increments on every *accepted* write. A losing write does not bump it, so a UI keyed on
   * this value re-renders only when something actually changed.
   */
  get version(): number {
    return this.revision;
  }

  get(key: string): T | undefined {
    return this.registers.get(key)?.value;
  }

  getRegister(key: string): Register<T> | undefined {
    return this.registers.get(key);
  }

  has(key: string): boolean {
    return this.registers.has(key);
  }

  keys(): IterableIterator<string> {
    return this.registers.keys();
  }

  entries(): IterableIterator<[string, Register<T>]> {
    return this.registers.entries();
  }

  /**
   * Applies a write, keeping it only if its stamp beats what is already there.
   *
   * @returns `true` when the write won and the map changed.
   */
  apply(key: string, value: T, stamp: Hlc): boolean {
    const existing = this.registers.get(key);
    if (existing) {
      const order = compareHlc(stamp, existing.stamp);
      if (order < 0) return false;
      // Equal stamps fall through to the value order. Replaying an op redelivers an identical
      // stamp *and* an identical value, which compares equal and is therefore a no-op — that
      // is what makes offline replay free.
      if (order === 0 && canonicalCompare(value, existing.value) <= 0) return false;
    }
    this.registers.set(key, { value, stamp });
    this.revision += 1;
    return true;
  }

  /** Applies an already-formed register. */
  applyRegister(key: string, register: Register<T>): boolean {
    return this.apply(key, register.value, register.stamp);
  }

  /**
   * Merges another replica into this one.
   *
   * @returns how many entries changed, so a caller can skip a broadcast when nothing did.
   */
  merge(other: LwwMap<T> | Iterable<readonly [string, Register<T>]>): number {
    const source = other instanceof LwwMap ? other.entries() : other;
    let changed = 0;
    for (const [key, register] of source) {
      if (this.apply(key, register.value, register.stamp)) changed += 1;
    }
    return changed;
  }

  /**
   * Structural equality, including stamps.
   *
   * This is the assertion convergence tests are written against: not "the values look the
   * same" but "these replicas are indistinguishable, down to who wrote each entry and when".
   */
  equals(other: LwwMap<T>): boolean {
    if (this.registers.size !== other.registers.size) return false;
    for (const [key, register] of this.registers) {
      const theirs = other.registers.get(key);
      if (!theirs) return false;
      if (!hlcEquals(register.stamp, theirs.stamp)) return false;
      if (canonicalCompare(register.value, theirs.value) !== 0) return false;
    }
    return true;
  }

  clone(): LwwMap<T> {
    const copy = new LwwMap<T>();
    for (const [key, register] of this.registers) copy.registers.set(key, register);
    copy.revision = this.revision;
    return copy;
  }

  /**
   * Entries whose stamp is strictly newer than `since`, for sending a delta instead of a
   * whole snapshot to a reconnecting client.
   */
  since(cutoff: Hlc): [string, Register<T>][] {
    const result: [string, Register<T>][] = [];
    for (const [key, register] of this.registers) {
      if (compareHlc(register.stamp, cutoff) > 0) result.push([key, register]);
    }
    return result;
  }

  /** The newest stamp anywhere in the map, or `null` when empty. */
  maxStamp(): Hlc | null {
    let max: Hlc | null = null;
    for (const register of this.registers.values()) {
      if (max === null || compareHlc(register.stamp, max) > 0) max = register.stamp;
    }
    return max;
  }

  toSnapshot(): LwwSnapshot<T> {
    const actorIndex = new Map<string, number>();
    const actors: string[] = [];
    const entries: (readonly [string, T, number, number, number])[] = [];

    for (const [key, register] of this.registers) {
      let index = actorIndex.get(register.stamp.actorId);
      if (index === undefined) {
        index = actors.length;
        actors.push(register.stamp.actorId);
        actorIndex.set(register.stamp.actorId, index);
      }
      entries.push([key, register.value, register.stamp.wallMs, register.stamp.counter, index]);
    }

    return { v: 1, actors, entries };
  }

  static fromSnapshot<T>(snapshot: LwwSnapshot<T>): LwwMap<T> {
    const map = new LwwMap<T>();
    for (const [key, value, wallMs, counter, actorIndex] of snapshot.entries) {
      const actorId = snapshot.actors[actorIndex];
      if (actorId === undefined) {
        throw new RangeError(`Snapshot references unknown actor index ${actorIndex}`);
      }
      map.apply(key, value, { wallMs, counter, actorId });
    }
    return map;
  }
}
