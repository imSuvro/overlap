import { MAX_CLOCK_DRIFT_MS, decodeHlc, type Hlc } from '@overlap/crdt';
import {
  SETTING_KEYS,
  parseAvailabilityKey,
  persistedRoomSchema,
  type Op,
  type PersistedRoom,
  type RoomConfig,
  type RoomSnapshot,
} from '@overlap/protocol';
import { materializeSlots, type Slot } from '@overlap/time';
import { RoomState } from './state.js';

export interface ApplyContext {
  /** Whose connection this is. A client may only write its own availability and name. */
  readonly participantId: string;
  readonly now: number;
}

export interface RejectedOp {
  readonly op: Op;
  readonly reason: string;
}

export interface ApplyResult {
  /** Well-formed and incorporated, whether or not they won. */
  readonly accepted: Op[];
  /**
   * The subset that actually changed state — what peers need to hear about.
   *
   * Broadcasting the losers too would be *correct*, since merge is idempotent, but it would
   * put the whole of a reconnecting client's replayed outbox back on everyone else's wire.
   */
  readonly effective: Op[];
  readonly rejected: RejectedOp[];
  readonly changed: boolean;
}

/**
 * A room, its rules, and the state it owns.
 *
 * Deliberately free of any transport or storage concern: no sockets, no database, no timers.
 * The Node server and the Cloudflare Durable Object are ~150-line adapters around this one
 * class, which is why the multi-client convergence tests can run the whole system in a single
 * process, and why the server can never disagree with a client about ordering — they run the
 * same merge.
 */
export class RoomEngine {
  private slotSet: ReadonlySet<number> | null = null;
  private materialized: readonly Slot[] | null = null;

  private constructor(
    readonly config: RoomConfig,
    readonly state: RoomState,
    private lastWriteAt: number,
  ) {}

  static create(config: RoomConfig, initialState = new RoomState()): RoomEngine {
    return new RoomEngine(config, initialState, config.createdAt);
  }

  static restore(persisted: PersistedRoom): RoomEngine {
    return new RoomEngine(
      persisted.config,
      RoomState.fromSnapshot(persisted.snapshot),
      persisted.lastWriteAt,
    );
  }

  /** Parses and restores in one step, returning `null` if storage held something unreadable. */
  static restoreFrom(raw: unknown): RoomEngine | null {
    const parsed = persistedRoomSchema.safeParse(raw);
    return parsed.success ? RoomEngine.restore(parsed.data) : null;
  }

  /** The room's slots, materialised once and cached. */
  get slots(): readonly Slot[] {
    this.materialized ??= materializeSlots(this.config).slots;
    return this.materialized;
  }

  private get instants(): ReadonlySet<number> {
    this.slotSet ??= new Set(this.slots.map((slot) => slot.instant));
    return this.slotSet;
  }

  /**
   * Validates and applies a batch of ops.
   *
   * Rejections are returned rather than thrown, and rather than silently dropped, so the
   * client can tell the user a write did not stick instead of showing state that will vanish
   * on the next reload.
   */
  apply(ops: readonly Op[], context: ApplyContext): ApplyResult {
    const accepted: Op[] = [];
    const effective: Op[] = [];
    const rejected: RejectedOp[] = [];

    for (const op of ops) {
      const reason = this.validate(op, context);
      if (reason !== null) {
        rejected.push({ op, reason });
        continue;
      }

      // An op that lost to a newer write is still *accepted* — it was well-formed and has been
      // incorporated. Only the broadcast is skipped.
      if (this.state.applyOp(op)) effective.push(op);
      accepted.push(op);
    }

    const changed = effective.length > 0;
    if (changed) this.lastWriteAt = context.now;
    return { accepted, effective, rejected, changed };
  }

  private validate(op: Op, context: ApplyContext): string | null {
    let stamp: Hlc;
    try {
      stamp = decodeHlc(op.s);
    } catch {
      return 'malformed stamp';
    }

    // The server is the one place every op passes through, so it is where a device with a
    // badly-wrong clock can be stopped from winning every future conflict. The client clamps
    // its own clock too, but a clamp only protects the clamping replica.
    if (stamp.wallMs > context.now + MAX_CLOCK_DRIFT_MS) {
      return 'stamp is too far in the future; check this device’s clock';
    }

    switch (op.k) {
      case 'a': {
        const parsed = parseAvailabilityKey(op.key);
        if (!parsed) return 'malformed availability key';
        if (parsed.participantId !== context.participantId) {
          return 'you can only change your own availability';
        }
        // Without this the keyspace is unbounded: a crafted client could write availability at
        // arbitrary instants and grow the room's storage without limit.
        if (!this.instants.has(parsed.instant)) return 'that time is not part of this room';
        return null;
      }
      case 'n': {
        if (op.key !== context.participantId) return 'you can only change your own name';
        return null;
      }
      case 's': {
        if (op.key === SETTING_KEYS.finalizedInstant) {
          if (op.v !== null && (typeof op.v !== 'number' || !this.instants.has(op.v))) {
            return 'that time is not part of this room';
          }
          return null;
        }
        // Only `title` remains, and it must be text.
        return typeof op.v === 'string' ? null : 'a room title must be text';
      }
    }
  }

  /** Ops newer than the client's cursor, for catching up a reconnection with a delta. */
  opsSince(cursor: Hlc | null): Op[] {
    return this.state.opsSince(cursor);
  }

  snapshot(): RoomSnapshot {
    return this.state.toSnapshot();
  }

  persist(): PersistedRoom {
    return {
      v: 1,
      config: this.config,
      snapshot: this.state.toSnapshot(),
      lastWriteAt: this.lastWriteAt,
    };
  }

  get lastWrittenAt(): number {
    return this.lastWriteAt;
  }
}
