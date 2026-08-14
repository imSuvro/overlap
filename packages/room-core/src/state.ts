import { LwwMap, compareHlc, decodeHlc, encodeHlc, type Hlc } from '@overlap/crdt';
import {
  LEVEL,
  SETTING_KEYS,
  availabilityKey,
  settingKeySchema,
  type Level,
  type Op,
  type Participant,
  type RoomSnapshot,
  type SettingValue,
} from '@overlap/protocol';

/**
 * The full replicated state of a room: three register maps, merged the same way on every
 * replica by the same code.
 *
 * They are separate maps rather than one heterogeneous map so each stays statically typed —
 * an availability register cannot hold a room title, and the compiler enforces that rather
 * than a runtime check hoping to catch it.
 */
export class RoomState {
  readonly availability = new LwwMap<Level>();
  readonly names = new LwwMap<string>();
  readonly settings = new LwwMap<SettingValue>();

  /** Bumps whenever any map accepts a write. Cheap invalidation for the UI. */
  get version(): number {
    return this.availability.version + this.names.version + this.settings.version;
  }

  /** @returns `true` when the op won and state changed. */
  applyOp(op: Op): boolean {
    const stamp = decodeHlc(op.s);
    switch (op.k) {
      case 'a':
        return this.availability.apply(op.key, op.v, stamp);
      case 'n':
        return this.names.apply(op.key, op.v, stamp);
      case 's':
        return this.settings.apply(op.key, op.v, stamp);
    }
  }

  merge(other: RoomState): number {
    return (
      this.availability.merge(other.availability) +
      this.names.merge(other.names) +
      this.settings.merge(other.settings)
    );
  }

  /** Structural equality including stamps — the assertion convergence tests are written against. */
  equals(other: RoomState): boolean {
    return (
      this.availability.equals(other.availability) &&
      this.names.equals(other.names) &&
      this.settings.equals(other.settings)
    );
  }

  levelFor(participantId: string, instant: number): Level {
    // Built with the protocol's own helper rather than an inline template, so a change to the
    // key format cannot compile cleanly here and fail silently at runtime.
    return this.availability.get(availabilityKey(participantId, instant)) ?? LEVEL.unavailable;
  }

  title(): string {
    const value = this.settings.get(SETTING_KEYS.title);
    return typeof value === 'string' ? value : 'Untitled room';
  }

  finalizedInstant(): number | null {
    const value = this.settings.get(SETTING_KEYS.finalizedInstant);
    return typeof value === 'number' ? value : null;
  }

  /** Everyone who has introduced themselves, in join order (which is stamp order). */
  participants(): Participant[] {
    const result: Participant[] = [];
    for (const [participantId, register] of this.names.entries()) {
      result.push({ participantId, name: register.value });
    }
    return result.sort((a, b) => {
      const left = this.names.getRegister(a.participantId);
      const right = this.names.getRegister(b.participantId);
      if (!left || !right) return 0;
      return compareHlc(left.stamp, right.stamp);
    });
  }

  /**
   * Every write newer than `cursor`, as ops.
   *
   * Lets a reconnecting client be caught up with a delta instead of a full snapshot. Sending
   * the whole snapshot would also be correct — merge is idempotent — just wasteful.
   */
  opsSince(cursor: Hlc | null): Op[] {
    const ops: Op[] = [];
    const newer = (stamp: Hlc): boolean => cursor === null || compareHlc(stamp, cursor) > 0;

    for (const [key, register] of this.availability.entries()) {
      if (newer(register.stamp)) {
        ops.push({ k: 'a', key, v: register.value, s: encodeHlc(register.stamp) });
      }
    }
    for (const [key, register] of this.names.entries()) {
      if (newer(register.stamp)) {
        ops.push({ k: 'n', key, v: register.value, s: encodeHlc(register.stamp) });
      }
    }
    for (const [key, register] of this.settings.entries()) {
      if (!newer(register.stamp)) continue;
      const settingKey = settingKeySchema.safeParse(key);
      if (settingKey.success) {
        ops.push({ k: 's', key: settingKey.data, v: register.value, s: encodeHlc(register.stamp) });
      }
    }

    return ops;
  }

  /** The newest stamp anywhere in the room — the cursor a client sends back on reconnect. */
  maxStamp(): Hlc | null {
    const candidates = [
      this.availability.maxStamp(),
      this.names.maxStamp(),
      this.settings.maxStamp(),
    ];
    let max: Hlc | null = null;
    for (const candidate of candidates) {
      if (candidate && (max === null || compareHlc(candidate, max) > 0)) max = candidate;
    }
    return max;
  }

  toSnapshot(): RoomSnapshot {
    return {
      availability: this.availability.toSnapshot(),
      names: this.names.toSnapshot(),
      settings: this.settings.toSnapshot(),
    };
  }

  static fromSnapshot(snapshot: RoomSnapshot): RoomState {
    const state = new RoomState();
    state.availability.merge(LwwMap.fromSnapshot(snapshot.availability));
    state.names.merge(LwwMap.fromSnapshot(snapshot.names));
    state.settings.merge(LwwMap.fromSnapshot(snapshot.settings));
    return state;
  }

  clone(): RoomState {
    return RoomState.fromSnapshot(this.toSnapshot());
  }
}
