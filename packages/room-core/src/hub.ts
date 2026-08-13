import {
  encodeServerMessage,
  parseClientMessage,
  type Op,
  type Presence,
  type ServerMessage,
} from '@overlap/protocol';
import type { ApplyResult, RejectedOp, RoomEngine } from './engine.js';

/**
 * One connected client, as the hub sees it.
 *
 * Everything transport-specific — `ws` sockets on Node, hibernatable `WebSocket` objects on a
 * Durable Object — lives behind this three-member surface.
 */
export interface HubPeer {
  readonly sessionId: string;
  send(payload: string): void;
  close(code: number, reason: string): void;
}

export interface RoomHubOptions {
  /** Called after any op changes state, so the adapter can persist. Debouncing is its business. */
  readonly onStateChanged?: () => void;
  readonly now?: () => number;
  /** Messages per second a single connection may send before being disconnected. */
  readonly messageRateLimit?: number;
}

interface PeerRecord {
  readonly peer: HubPeer;
  participantId: string | null;
  presence: Presence | null;
  /** Token bucket, refilled continuously. */
  tokens: number;
  lastRefillAt: number;
}

/**
 * High enough that a fast drag never trips it, low enough that a runaway client cannot
 * monopolise the room. Painting flushes on a ~60 ms timer, so legitimate traffic peaks around
 * 17 messages per second.
 */
const DEFAULT_RATE_LIMIT = 60;

/**
 * Connection and broadcast logic for a single room, with no transport in it.
 *
 * Sitting between the engine and the socket layer, this is the only place that decides who
 * hears about what. Keeping it transport-free means each adapter is thin plumbing, and the
 * multi-client tests exercise the real thing rather than a stand-in.
 */
export class RoomHub {
  private readonly records = new Map<string, PeerRecord>();
  private readonly now: () => number;
  private readonly rateLimit: number;
  private readonly onStateChanged: (() => void) | undefined;

  constructor(
    private readonly engine: RoomEngine,
    options: RoomHubOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
    this.rateLimit = options.messageRateLimit ?? DEFAULT_RATE_LIMIT;
    this.onStateChanged = options.onStateChanged;
  }

  get peerCount(): number {
    return this.records.size;
  }

  /**
   * Who this connection has identified as, or `null` before its `hello`.
   *
   * The Durable Object adapter reads this back after handling a message so it can persist the
   * identity onto the socket, letting a hibernation wake restore it.
   */
  participantIdFor(sessionId: string): string | null {
    return this.records.get(sessionId)?.participantId ?? null;
  }

  /**
   * Registers a connection.
   *
   * `knownParticipantId` exists for the hibernation case: a Durable Object can be evicted from
   * memory while its sockets stay open, so on wake the hub is rebuilt from live sockets whose
   * `hello` happened in a previous incarnation. Without restoring the identity, those clients
   * would be told to introduce themselves again mid-session.
   */
  add(peer: HubPeer, knownParticipantId?: string): void {
    this.records.set(peer.sessionId, {
      peer,
      participantId: knownParticipantId ?? null,
      presence: null,
      tokens: this.rateLimit,
      lastRefillAt: this.now(),
    });
  }

  remove(sessionId: string): void {
    const record = this.records.get(sessionId);
    if (!record) return;
    this.records.delete(sessionId);
    if (record.presence) this.broadcast({ t: 'left', sessionId }, sessionId);
  }

  handleMessage(sessionId: string, raw: string): void {
    const record = this.records.get(sessionId);
    if (!record) return;

    if (!this.consumeToken(record)) {
      this.send(record, { t: 'error', code: 'rate-limited', message: 'Too many messages' });
      record.peer.close(1008, 'rate limited');
      this.remove(sessionId);
      return;
    }

    const parsed = parseClientMessage(raw);
    if (!parsed.ok) {
      this.send(record, { t: 'error', code: 'malformed-message', message: parsed.error });
      return;
    }

    const message = parsed.value;
    switch (message.t) {
      case 'hello': {
        record.participantId = message.participantId;
        const applied = this.applyOps(record, message.ops);

        this.send(record, {
          t: 'welcome',
          config: this.engine.config,
          snapshot: this.engine.snapshot(),
          peers: this.otherPresences(sessionId),
          sessionId,
          serverTime: this.now(),
        });
        this.reportRejections(record, applied.rejected);

        record.presence = {
          sessionId,
          participantId: message.participantId,
          name: this.engine.state.names.get(message.participantId) ?? '',
          cursor: null,
          hoveredInstant: null,
        };
        this.broadcast({ t: 'presence', presence: record.presence }, sessionId);
        break;
      }

      case 'ops': {
        if (record.participantId === null) {
          this.send(record, { t: 'error', code: 'malformed-message', message: 'hello first' });
          return;
        }
        const applied = this.applyOps(record, message.ops);
        this.reportRejections(record, applied.rejected);
        break;
      }

      case 'presence': {
        if (!record.presence) return;
        record.presence = {
          ...record.presence,
          // A rename lands as an op, so presence reads the name back out of state rather than
          // carrying its own copy that could drift.
          name: this.engine.state.names.get(record.presence.participantId) ?? '',
          cursor: message.cursor,
          hoveredInstant: message.hoveredInstant,
        };
        this.broadcast({ t: 'presence', presence: record.presence }, sessionId);
        break;
      }

      case 'ping': {
        this.send(record, { t: 'pong', serverTime: this.now() });
        break;
      }
    }
  }

  private applyOps(record: PeerRecord, ops: readonly Op[]): ApplyResult {
    const participantId = record.participantId ?? '';
    const result = this.engine.apply(ops, { participantId, now: this.now() });

    if (result.accepted.length > 0) {
      // Acknowledge everything well-formed, including ops that lost — they are incorporated,
      // so the sender is free to stop retrying them.
      this.send(record, { t: 'ack', stamps: result.accepted.map((op) => op.s) });
    }

    if (result.changed) {
      // Only ops that actually changed something go out, and never back to their author — they
      // applied optimistically before the frame was even sent.
      this.broadcast({ t: 'ops', ops: result.effective }, record.peer.sessionId);
      this.onStateChanged?.();
    }
    return result;
  }

  private reportRejections(record: PeerRecord, rejected: readonly RejectedOp[]): void {
    if (rejected.length === 0) return;
    // Surfaced rather than silently dropped, so the client can tell the user a write did not
    // stick instead of showing state that will vanish on the next reload.
    this.send(record, {
      t: 'rejected',
      reason: rejected[0]?.reason ?? 'rejected',
      ops: rejected.map((entry) => entry.op),
    });
  }

  private otherPresences(exceptSessionId: string): Presence[] {
    const result: Presence[] = [];
    for (const [sessionId, record] of this.records) {
      if (sessionId !== exceptSessionId && record.presence) result.push(record.presence);
    }
    return result;
  }

  private broadcast(message: ServerMessage, exceptSessionId?: string): void {
    const payload = encodeServerMessage(message);
    for (const [sessionId, record] of this.records) {
      if (sessionId === exceptSessionId) continue;
      try {
        record.peer.send(payload);
      } catch {
        // A failed send means that socket is already gone. Dropping it here keeps one dead peer
        // from breaking the broadcast for everyone else.
        this.records.delete(sessionId);
      }
    }
  }

  private send(record: PeerRecord, message: ServerMessage): void {
    try {
      record.peer.send(encodeServerMessage(message));
    } catch {
      this.records.delete(record.peer.sessionId);
    }
  }

  private consumeToken(record: PeerRecord): boolean {
    const now = this.now();
    const elapsedSeconds = Math.max(0, now - record.lastRefillAt) / 1_000;
    record.tokens = Math.min(this.rateLimit, record.tokens + elapsedSeconds * this.rateLimit);
    record.lastRefillAt = now;

    if (record.tokens < 1) return false;
    record.tokens -= 1;
    return true;
  }
}
