import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { generateSessionId, roomDraftSchema } from '@overlap/protocol';
import type { HubPeer, RoomHub } from '@overlap/room-core';
import { WebSocketServer, type WebSocket } from 'ws';
import { decodeFrame } from './frames.js';
import { RoomRegistry } from './rooms.js';

/** Well above any legitimate room draft, well below anything worth buffering. */
const MAX_BODY_BYTES = 64 * 1024;

const ROOM_SOCKET_PATTERN = /^\/api\/rooms\/([^/]+)\/socket$/;
const ROOM_PATTERN = /^\/api\/rooms\/([^/]+)$/;

export interface OverlapServer {
  readonly port: number;
  readonly httpUrl: string;
  readonly wsUrl: string;
  readonly registry: RoomRegistry;
  close(): Promise<void>;
}

export interface OverlapServerOptions {
  /** `0` asks the OS for a free port, which is what the integration suite wants. */
  readonly port?: number;
  readonly now?: () => number;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    // The dev server is reached through Vite's proxy in normal use; this only matters when a
    // test drives it directly. Production is a single origin and needs no CORS at all.
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  });
  response.end(payload);
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.from(chunk as Buffer);
    size += buffer.byteLength;
    if (size > MAX_BODY_BYTES) throw new RangeError('Request body too large');
    chunks.push(buffer);
  }

  if (size === 0) return null;
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

/**
 * A real Node.js WebSocket server over the same room engine the edge runs.
 *
 * This is what `pnpm dev` runs and what the multi-client integration tests drive. Because all
 * the rules live in `@overlap/room-core`, this file is plumbing: parse, route, adapt the socket
 * to a {@link HubPeer}, and get out of the way. Anything that could be wrong is tested once,
 * against the engine, rather than once per transport.
 */
export async function startOverlapServer(
  options: OverlapServerOptions = {},
): Promise<OverlapServer> {
  const now = options.now ?? (() => Date.now());
  const registry = new RoomRegistry(now);

  const httpServer: Server = createServer((request, response) => {
    void handleHttp(request, response);
  });

  async function handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://localhost');

    if (request.method === 'OPTIONS') {
      sendJson(response, 204, null);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/rooms') {
      let body: unknown;
      try {
        body = await readBody(request);
      } catch {
        sendJson(response, 413, { error: 'Request body too large' });
        return;
      }

      const draft = roomDraftSchema.safeParse(body);
      if (!draft.success) {
        sendJson(response, 400, { error: draft.error.issues[0]?.message ?? 'Invalid room' });
        return;
      }

      const { engine } = registry.create(draft.data);
      sendJson(response, 201, { config: engine.config, title: engine.state.title() });
      return;
    }

    const roomMatch = ROOM_PATTERN.exec(url.pathname);
    if (request.method === 'GET' && roomMatch) {
      const record = registry.get(roomMatch[1] ?? '');
      if (!record) {
        sendJson(response, 404, { error: 'No such room' });
        return;
      }
      sendJson(response, 200, {
        config: record.engine.config,
        title: record.engine.state.title(),
      });
      return;
    }

    if (url.pathname === '/api/health') {
      sendJson(response, 200, { ok: true, rooms: registry.size });
      return;
    }

    sendJson(response, 404, { error: 'Not found' });
  }

  const wsServer = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const match = ROOM_SOCKET_PATTERN.exec(url.pathname);
    const record = match ? registry.get(match[1] ?? '') : undefined;

    if (!record) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    wsServer.handleUpgrade(request, socket, head, (socketConnection) => {
      attach(socketConnection, record.hub);
    });
  });

  function attach(socket: WebSocket, hub: RoomHub): void {
    // Server-assigned, so a client cannot claim to be someone else's connection.
    const sessionId = generateSessionId();
    const peer: HubPeer = {
      sessionId,
      send: (payload) => {
        socket.send(payload);
      },
      close: (code, reason) => {
        socket.close(code, reason);
      },
    };

    hub.add(peer);
    socket.on('message', (data) => {
      hub.handleMessage(sessionId, decodeFrame(data));
    });
    socket.on('close', () => {
      hub.remove(sessionId);
    });
    socket.on('error', () => {
      hub.remove(sessionId);
    });
  }

  await new Promise<void>((resolve) => {
    httpServer.listen(options.port ?? 8787, '127.0.0.1', resolve);
  });

  const address = httpServer.address() as AddressInfo;
  const { port } = address;

  return {
    port,
    httpUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}`,
    registry,
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const client of wsServer.clients) client.terminate();
        wsServer.close(() => {
          httpServer.close((error) => {
            if (error) reject(error);
            else resolve();
          });
        });
      }),
  };
}
