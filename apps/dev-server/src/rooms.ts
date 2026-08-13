import { SETTING_KEYS, generateRoomId, type RoomConfig, type RoomDraft } from '@overlap/protocol';
import { HybridLogicalClock, encodeHlc } from '@overlap/crdt';
import { RoomEngine, RoomHub } from '@overlap/room-core';

export interface RoomRecord {
  readonly engine: RoomEngine;
  readonly hub: RoomHub;
}

/**
 * In-memory room storage for local development and the integration suite.
 *
 * Deliberately not durable: `pnpm dev` restarting should give a clean slate, and the
 * integration tests want isolation between cases. Production durability is the Durable
 * Object's SQLite storage, behind the same {@link RoomEngine} — see ADR-0003.
 */
export class RoomRegistry {
  private readonly rooms = new Map<string, RoomRecord>();
  private readonly clock: HybridLogicalClock;

  constructor(private readonly now: () => number = () => Date.now()) {
    this.clock = new HybridLogicalClock('server', { now });
  }

  create(draft: RoomDraft): RoomRecord {
    const config: RoomConfig = {
      roomId: generateRoomId(),
      anchorZone: draft.anchorZone,
      dates: [...draft.dates].sort(),
      dayStartMinute: draft.dayStartMinute,
      dayEndMinute: draft.dayEndMinute,
      slotMinutes: draft.slotMinutes,
      createdAt: this.now(),
    };

    const engine = RoomEngine.create(config);
    // The title is a register rather than config, so it arrives as an op like any other edit
    // and can be changed later without rewriting a config every replica has cached.
    engine.state.settings.apply(SETTING_KEYS.title, draft.title, this.clock.tick());

    const record: RoomRecord = {
      engine,
      hub: new RoomHub(engine, { now: this.now }),
    };
    this.rooms.set(config.roomId, record);
    return record;
  }

  get(roomId: string): RoomRecord | undefined {
    return this.rooms.get(roomId);
  }

  get size(): number {
    return this.rooms.size;
  }
}

export function encodeServerStamp(clock: HybridLogicalClock): string {
  return encodeHlc(clock.tick());
}
