import { SETTING_KEYS, generateSessionId, roomConfigSchema } from '@overlap/protocol';
import { HybridLogicalClock } from '@overlap/crdt';
import { RoomEngine, RoomHub, type HubPeer } from '@overlap/room-core';

/** Rooms are swept this long after their last write. Documented in the README, not implied. */
const RETENTION_MS = 60 * 24 * 60 * 60 * 1_000;

const STORAGE_KEY = 'room';

interface SocketAttachment {
  readonly sessionId: string;
  participantId: string | null;
}

/**
 * One Durable Object per room.
 *
 * The hosting primitive and the architecture agree here rather than being bridged: a Durable
 * Object *is* the single-threaded per-room actor this design already wanted, so applying an op
 * and broadcasting it has no read-modify-write race and needs no locking.
 *
 * All the rules live in `@overlap/room-core`, shared with the Node server. This class is the
 * Cloudflare-shaped plumbing around it — which is also what keeps the vendor lock-in confined
 * to one file.
 */
export class RoomDurableObject implements DurableObject {
  private engine: RoomEngine | null = null;
  private hub: RoomHub | null = null;

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: unknown,
  ) {
    void this.env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/create') {
      return this.handleCreate(request);
    }

    const loaded = await this.load();
    if (!loaded) return json({ error: 'No such room' }, 404);

    if (request.method === 'GET' && url.pathname === '/config') {
      return json({ config: loaded.engine.config, title: loaded.engine.state.title() });
    }

    if (url.pathname === '/socket') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected a WebSocket upgrade', { status: 426 });
      }
      return this.handleSocket(loaded.hub);
    }

    return json({ error: 'Not found' }, 404);
  }

  private async handleCreate(request: Request): Promise<Response> {
    if (await this.ctx.storage.get(STORAGE_KEY)) {
      return json({ error: 'Room already exists' }, 409);
    }

    const body: unknown = await request.json();
    const parsed = roomConfigSchema.safeParse(
      (body as { config?: unknown } | null)?.config ?? null,
    );
    const title = (body as { title?: unknown } | null)?.title;
    if (!parsed.success || typeof title !== 'string') {
      return json({ error: 'Invalid room' }, 400);
    }

    const engine = RoomEngine.create(parsed.data);
    // The title is a register, not config, so it can be edited later without rewriting a
    // config every replica has cached.
    const clock = new HybridLogicalClock('origin');
    engine.state.settings.apply(SETTING_KEYS.title, title, clock.tick());

    await this.ctx.storage.put(STORAGE_KEY, engine.persist());
    await this.ctx.storage.setAlarm(Date.now() + RETENTION_MS);

    return json({ config: engine.config, title }, 201);
  }

  /**
   * Rehydrates after hibernation.
   *
   * Hibernation is what makes an idle room free: the object is evicted from memory while its
   * sockets stay open. Nothing may be assumed to survive in memory between messages, so the
   * hub is rebuilt from durable storage plus the sockets the platform hands back.
   */
  private async load(): Promise<{ engine: RoomEngine; hub: RoomHub } | null> {
    if (this.engine && this.hub) return { engine: this.engine, hub: this.hub };

    const stored = await this.ctx.storage.get(STORAGE_KEY);
    const engine = RoomEngine.restoreFrom(stored);
    if (!engine) return null;

    const hub = new RoomHub(engine, {
      onStateChanged: () => {
        this.ctx.waitUntil(this.persist(engine));
      },
    });

    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      if (!attachment) continue;
      hub.add(this.peerFor(socket, attachment.sessionId), attachment.participantId ?? undefined);
    }

    this.engine = engine;
    this.hub = hub;
    return { engine, hub };
  }

  private async persist(engine: RoomEngine): Promise<void> {
    await this.ctx.storage.put(STORAGE_KEY, engine.persist());
    await this.ctx.storage.setAlarm(Date.now() + RETENTION_MS);
  }

  private handleSocket(hub: RoomHub): Response {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    const sessionId = generateSessionId();
    server.serializeAttachment({ sessionId, participantId: null } satisfies SocketAttachment);

    // The hibernation API, rather than `server.accept()`. This is the specific mechanism that
    // lets a room hold open sockets for days without consuming memory or billing duration.
    this.ctx.acceptWebSocket(server);
    hub.add(this.peerFor(server, sessionId));

    return new Response(null, { status: 101, webSocket: client });
  }

  private peerFor(socket: WebSocket, sessionId: string): HubPeer {
    return {
      sessionId,
      send: (payload) => {
        socket.send(payload);
      },
      close: (code, reason) => {
        socket.close(code, reason);
      },
    };
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const loaded = await this.load();
    if (!loaded) return;

    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    if (!attachment) return;

    const raw = typeof message === 'string' ? message : new TextDecoder().decode(message);
    loaded.hub.handleMessage(attachment.sessionId, raw);

    // Remember who this connection is, so a later hibernation wake can restore the identity
    // rather than asking a mid-session client to introduce itself again. Read back from the
    // hub rather than re-parsing the frame, so there is one parser and one source of truth.
    if (attachment.participantId === null) {
      const participantId = loaded.hub.participantIdFor(attachment.sessionId);
      if (participantId !== null) {
        socket.serializeAttachment({
          sessionId: attachment.sessionId,
          participantId,
        } satisfies SocketAttachment);
      }
    }
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    const loaded = await this.load();
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    if (loaded && attachment) loaded.hub.remove(attachment.sessionId);
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.webSocketClose(socket);
  }

  /** Retention sweep. Re-armed on every write, so it only fires on a genuinely idle room. */
  async alarm(): Promise<void> {
    const stored = await this.ctx.storage.get(STORAGE_KEY);
    const engine = RoomEngine.restoreFrom(stored);
    if (engine && Date.now() - engine.lastWrittenAt < RETENTION_MS) {
      await this.ctx.storage.setAlarm(engine.lastWrittenAt + RETENTION_MS);
      return;
    }
    await this.ctx.storage.deleteAll();
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
