import { HybridLogicalClock, encodeHlc } from '@overlap/crdt';
import {
  SETTING_KEYS,
  availabilityKey,
  encodeClientMessage,
  parseServerMessage,
  type Cursor,
  type Level,
  type Op,
  type Presence,
  type RoomConfig,
  type RoomSnapshot,
} from '@overlap/protocol';
import { RoomState } from './state.js';

export type ConnectionStatus = 'offline' | 'connecting' | 'live';

export interface ClientTransport {
  send(payload: string): void;
  close(): void;
}

export interface TransportHandlers {
  onOpen(): void;
  onMessage(raw: string): void;
  onClose(): void;
}

export interface RoomClientOptions {
  readonly participantId: string;
  /** The HLC actor for this tab. Distinct from the server-assigned connection id. */
  readonly sessionId: string;
  readonly connect: (handlers: TransportHandlers) => ClientTransport;
  readonly initialSnapshot?: RoomSnapshot | undefined;
  readonly initialOutbox?: readonly Op[] | undefined;
  readonly now?: () => number;
  readonly setTimer?: (fn: () => void, ms: number) => number;
  readonly clearTimer?: (handle: number) => void;
  readonly flushIntervalMs?: number;
  readonly onChange?: () => void;
  readonly onStatusChange?: (status: ConnectionStatus) => void;
  readonly onPresenceChange?: (peers: readonly Presence[]) => void;
  readonly onRejected?: (reason: string, ops: readonly Op[]) => void;
  readonly onOutboxChange?: (ops: readonly Op[]) => void;
  readonly onSnapshot?: (snapshot: RoomSnapshot) => void;
}

/** Batching window for painted cells: long enough to coalesce a drag, short enough to feel live. */
const DEFAULT_FLUSH_MS = 60;
const MAX_BACKOFF_MS = 15_000;
const BASE_BACKOFF_MS = 400;
const MAX_OPS_PER_FLUSH = 500;

/**
 * The client half of the sync model.
 *
 * Everything here rests on merge being idempotent, which is what lets the design skip the
 * machinery this problem usually needs:
 *
 * - **Writes apply locally and immediately.** A locally-applied value is already a valid replica
 *   value, so there is no pending state, no rollback path, and nothing that snaps back.
 * - **Offline is not a mode.** It is simply the state where the flush task has nowhere to send
 *   yet, so there is no separate offline code path to keep correct.
 * - **Reconnecting resends the whole outbox.** Redelivery is free, so there is no sequence-number
 *   negotiation and no dedup table — only an acknowledgement, so nothing is silently dropped.
 *
 * Transport and storage are injected, so this runs unchanged over a real WebSocket in the
 * integration suite and over the browser's in the app.
 */
export class RoomClient {
  readonly state: RoomState;

  private readonly clock: HybridLogicalClock;
  private readonly options: RoomClientOptions;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => number;
  private readonly clearTimer: (handle: number) => void;
  private readonly flushIntervalMs: number;

  private transport: ClientTransport | null = null;
  private connectionStatus: ConnectionStatus = 'offline';
  private roomConfig: RoomConfig | null = null;
  private connectionId: string | null = null;

  private outbox: Op[] = [];
  /** Sent but not yet acknowledged. Cleared on disconnect so everything is retried. */
  private readonly inFlight = new Set<string>();
  private readonly peers = new Map<string, Presence>();

  private flushHandle: number | null = null;
  private reconnectHandle: number | null = null;
  private reconnectAttempts = 0;
  private stopped = true;

  constructor(options: RoomClientOptions) {
    this.options = options;
    this.now = options.now ?? (() => Date.now());
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown as number);
    this.clearTimer =
      options.clearTimer ??
      ((handle) => {
        clearTimeout(handle);
      });
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_MS;
    this.clock = new HybridLogicalClock(options.sessionId, { now: this.now });

    this.state = options.initialSnapshot
      ? RoomState.fromSnapshot(options.initialSnapshot)
      : new RoomState();
    this.outbox = [...(options.initialOutbox ?? [])];
  }

  get status(): ConnectionStatus {
    return this.connectionStatus;
  }

  get config(): RoomConfig | null {
    return this.roomConfig;
  }

  get sessionId(): string | null {
    return this.connectionId;
  }

  get pendingCount(): number {
    return this.outbox.length;
  }

  get presence(): readonly Presence[] {
    return [...this.peers.values()];
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    this.cancelTimers();
    this.transport?.close();
    this.transport = null;
    this.peers.clear();
    this.setStatus('offline');
  }

  // ---------------------------------------------------------------- local writes

  setLevel(instant: number, level: Level): void {
    this.setLevels([{ instant, level }]);
  }

  /** One flush for a whole drag, rather than one per cell crossed. */
  setLevels(entries: readonly { instant: number; level: Level }[]): void {
    const ops: Op[] = [];
    for (const entry of entries) {
      const key = availabilityKey(this.options.participantId, entry.instant);
      if (this.state.availability.get(key) === entry.level) continue;
      ops.push({ k: 'a', key, v: entry.level, s: encodeHlc(this.clock.tick()) });
    }
    this.commit(ops);
  }

  setName(name: string): void {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    this.commit([
      { k: 'n', key: this.options.participantId, v: trimmed, s: encodeHlc(this.clock.tick()) },
    ]);
  }

  setTitle(title: string): void {
    const trimmed = title.trim();
    if (trimmed.length === 0) return;
    this.commit([{ k: 's', key: SETTING_KEYS.title, v: trimmed, s: encodeHlc(this.clock.tick()) }]);
  }

  finalize(instant: number | null): void {
    this.commit([
      { k: 's', key: SETTING_KEYS.finalizedInstant, v: instant, s: encodeHlc(this.clock.tick()) },
    ]);
  }

  sendCursor(cursor: Cursor | null, hoveredInstant: number | null): void {
    // Presence is ephemeral: never queued, never persisted, never merged. A cursor position is
    // worthless a second later, so buffering one to send after a reconnect would be worse than
    // dropping it.
    if (this.connectionStatus !== 'live') return;
    this.transport?.send(encodeClientMessage({ t: 'presence', cursor, hoveredInstant }));
  }

  private commit(ops: readonly Op[]): void {
    if (ops.length === 0) return;
    for (const op of ops) {
      this.state.applyOp(op);
      this.outbox.push(op);
    }
    this.options.onOutboxChange?.(this.outbox);
    this.options.onChange?.();
    this.scheduleFlush();
  }

  // ---------------------------------------------------------------- transport

  private open(): void {
    if (this.stopped) return;
    this.setStatus('connecting');

    this.transport = this.options.connect({
      onOpen: () => {
        this.reconnectAttempts = 0;
        this.setStatus('live');
        this.inFlight.clear();
        this.sendHello();
      },
      onMessage: (raw) => {
        this.receive(raw);
      },
      onClose: () => {
        this.handleClose();
      },
    });
  }

  private sendHello(): void {
    // The entire outstanding outbox rides along. Merge is idempotent, so resending is always
    // safe and needs no negotiation about what the server already has.
    const batch = this.outbox.slice(0, MAX_OPS_PER_FLUSH);
    for (const op of batch) this.inFlight.add(op.s);

    this.transport?.send(
      encodeClientMessage({
        t: 'hello',
        participantId: this.options.participantId,
        sessionId: this.options.sessionId,
        ops: batch,
      }),
    );
  }

  private handleClose(): void {
    this.transport = null;
    this.inFlight.clear();
    this.peers.clear();
    this.options.onPresenceChange?.([]);
    this.setStatus('offline');
    if (this.stopped) return;

    // Exponential backoff with jitter, so a server coming back up is not hit by every client in
    // the room at the same instant.
    this.reconnectAttempts += 1;
    const ceiling = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (this.reconnectAttempts - 1));
    const delay = ceiling / 2 + Math.random() * (ceiling / 2);
    this.reconnectHandle = this.setTimer(() => {
      this.reconnectHandle = null;
      this.open();
    }, delay);
  }

  private receive(raw: string): void {
    const parsed = parseServerMessage(raw);
    if (!parsed.ok) return;
    const message = parsed.value;

    switch (message.t) {
      case 'welcome': {
        this.roomConfig = message.config;
        this.connectionId = message.sessionId;
        // Merging rather than replacing: local offline writes must survive meeting the server's
        // view, and the CRDT resolves the two without either side being authoritative.
        this.state.merge(RoomState.fromSnapshot(message.snapshot));
        this.peers.clear();
        for (const presence of message.peers) this.peers.set(presence.sessionId, presence);
        this.options.onPresenceChange?.(this.presence);
        this.options.onSnapshot?.(this.state.toSnapshot());
        this.options.onChange?.();
        break;
      }

      case 'ops': {
        let changed = false;
        for (const op of message.ops) {
          if (this.state.applyOp(op)) changed = true;
        }
        if (changed) {
          this.options.onSnapshot?.(this.state.toSnapshot());
          this.options.onChange?.();
        }
        break;
      }

      case 'ack': {
        const acked = new Set(message.stamps);
        this.outbox = this.outbox.filter((op) => !acked.has(op.s));
        for (const stamp of acked) this.inFlight.delete(stamp);
        this.options.onOutboxChange?.(this.outbox);
        break;
      }

      case 'presence': {
        this.peers.set(message.presence.sessionId, message.presence);
        this.options.onPresenceChange?.(this.presence);
        break;
      }

      case 'left': {
        this.peers.delete(message.sessionId);
        this.options.onPresenceChange?.(this.presence);
        break;
      }

      case 'rejected': {
        // Dropped rather than retried forever: the server has said why, and a rejection is
        // deterministic, so resending would loop.
        const rejected = new Set(message.ops.map((op) => op.s));
        this.outbox = this.outbox.filter((op) => !rejected.has(op.s));
        for (const stamp of rejected) this.inFlight.delete(stamp);
        this.options.onOutboxChange?.(this.outbox);
        this.options.onRejected?.(message.reason, message.ops);
        break;
      }

      case 'error':
      case 'pong':
        break;
    }
  }

  // ---------------------------------------------------------------- flushing

  private scheduleFlush(): void {
    if (this.flushHandle !== null) return;
    this.flushHandle = this.setTimer(() => {
      this.flushHandle = null;
      this.flush();
    }, this.flushIntervalMs);
  }

  /** Sends anything queued that is not already awaiting acknowledgement. */
  flush(): void {
    if (this.connectionStatus !== 'live' || !this.transport) return;

    const pending = this.outbox
      .filter((op) => !this.inFlight.has(op.s))
      .slice(0, MAX_OPS_PER_FLUSH);
    if (pending.length === 0) return;

    for (const op of pending) this.inFlight.add(op.s);
    this.transport.send(encodeClientMessage({ t: 'ops', ops: pending }));
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.connectionStatus === status) return;
    this.connectionStatus = status;
    this.options.onStatusChange?.(status);
  }

  private cancelTimers(): void {
    if (this.flushHandle !== null) {
      this.clearTimer(this.flushHandle);
      this.flushHandle = null;
    }
    if (this.reconnectHandle !== null) {
      this.clearTimer(this.reconnectHandle);
      this.reconnectHandle = null;
    }
  }
}
