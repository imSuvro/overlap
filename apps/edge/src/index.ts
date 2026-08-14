import { generateRoomId, roomDraftSchema, type RoomConfig } from '@overlap/protocol';
import { RoomDurableObject } from './room.js';

export { RoomDurableObject };

export interface Env {
  readonly ROOM: DurableObjectNamespace;
  readonly ASSETS: Fetcher;
}

const ROOM_SOCKET_PATTERN = /^\/api\/rooms\/([A-Za-z0-9]+)\/socket$/;
const ROOM_PATTERN = /^\/api\/rooms\/([A-Za-z0-9]+)$/;

/** Well above any legitimate room draft, well below anything worth buffering. */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * The single Worker that is all of Overlap's server.
 *
 * It serves the SPA from Workers Static Assets — free and unmetered — and routes room traffic
 * to that room's Durable Object. One origin means no CORS layer and no second deployment to
 * keep in step with this one.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return json({ ok: true });
    }

    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      return createRoom(request, env);
    }

    const socketMatch = ROOM_SOCKET_PATTERN.exec(url.pathname);
    if (socketMatch?.[1]) {
      return forwardToRoom(env, socketMatch[1], request, '/socket');
    }

    const roomMatch = ROOM_PATTERN.exec(url.pathname);
    if (roomMatch?.[1] && request.method === 'GET') {
      return forwardToRoom(env, roomMatch[1], request, '/config');
    }

    if (url.pathname.startsWith('/api/')) {
      return json({ error: 'Not found' }, 404);
    }

    // Everything else is the SPA. `not_found_handling = "single-page-application"` in
    // wrangler.toml makes /r/:roomId serve index.html rather than 404.
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

async function createRoom(request: Request, env: Env): Promise<Response> {
  // Measured rather than trusted. A missing `content-length` reads as 0 and a malformed one as
  // NaN, and neither is greater than the limit — so a header check alone lets an unbounded
  // body straight through to the parser.
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return json({ error: 'Could not read the request body' }, 400);
  }
  if (raw.length > MAX_BODY_BYTES) {
    return json({ error: 'Request body too large' }, 413);
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'Expected JSON' }, 400);
  }

  const draft = roomDraftSchema.safeParse(body);
  if (!draft.success) {
    return json({ error: draft.error.issues[0]?.message ?? 'Invalid room' }, 400);
  }

  const config: RoomConfig = {
    roomId: generateRoomId(),
    anchorZone: draft.data.anchorZone,
    dates: [...draft.data.dates].sort(),
    dayStartMinute: draft.data.dayStartMinute,
    dayEndMinute: draft.data.dayEndMinute,
    slotMinutes: draft.data.slotMinutes,
    createdAt: Date.now(),
  };

  const stub = env.ROOM.get(env.ROOM.idFromName(config.roomId));
  return stub.fetch('https://room.invalid/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ config, title: draft.data.title }),
  });
}

function forwardToRoom(
  env: Env,
  roomId: string,
  request: Request,
  path: string,
): Promise<Response> {
  // `idFromName` maps the room id to its object deterministically, so any edge location that
  // receives a request for this room reaches the same single-threaded owner.
  const stub = env.ROOM.get(env.ROOM.idFromName(roomId));
  return stub.fetch(new Request(`https://room.invalid${path}`, request));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
