import {
  createRoomResponseSchema,
  roomIdSchema,
  type CreateRoomResponse,
  type RoomDraft,
} from '@overlap/protocol';

/**
 * Relative paths throughout, because in production a single Worker serves both the app and the
 * API from one origin, and in development Vite proxies `/api` to the Node server. One code
 * path, no environment-specific base URL to configure or get wrong.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await response.json();
    const message = (body as { error?: unknown } | null)?.error;
    return typeof message === 'string' ? message : fallback;
  } catch {
    return fallback;
  }
}

export async function createRoom(draft: RoomDraft): Promise<CreateRoomResponse> {
  const response = await fetch('/api/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(draft),
  });

  if (!response.ok) {
    throw new ApiError(await readError(response, 'Could not create the room'), response.status);
  }

  const parsed = createRoomResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    // The server answered with a shape this build does not understand. Failing loudly beats
    // navigating to a room that will not load.
    throw new ApiError('The server sent a room this version cannot read', 502);
  }
  return parsed.data;
}

export async function fetchRoom(roomId: string): Promise<CreateRoomResponse | null> {
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new ApiError(await readError(response, 'Could not load the room'), response.status);
  }

  const parsed = createRoomResponseSchema.safeParse(await response.json());
  return parsed.success ? parsed.data : null;
}

export function socketUrl(roomId: string): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/api/rooms/${encodeURIComponent(roomId)}/socket`;
}

/**
 * What the current URL is asking for.
 *
 * The third case is the one that matters. A room id that fails `roomIdSchema` used to be
 * indistinguishable from no room id at all, so a link truncated on its way through a chat app
 * silently rendered the landing page — and the person who followed it believed they were in
 * their group's room and started building a second one. Naming the case is what lets the app
 * say so.
 */
export type Route =
  | { readonly kind: 'landing' }
  | { readonly kind: 'room'; readonly roomId: string }
  | { readonly kind: 'brokenLink' };

export function routeFromLocation(pathname = location.pathname): Route {
  const match = /^\/r\/([^/]+)\/?$/.exec(pathname);
  if (!match?.[1]) return { kind: 'landing' };

  const parsed = roomIdSchema.safeParse(match[1]);
  return parsed.success ? { kind: 'room', roomId: parsed.data } : { kind: 'brokenLink' };
}

export function roomPath(roomId: string): string {
  return `/r/${roomId}`;
}
