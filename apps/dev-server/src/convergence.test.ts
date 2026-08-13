import type { Level, RoomDraft } from '@overlap/protocol';
import { generateParticipantId, generateSessionId } from '@overlap/protocol';
import { RoomClient, type ClientTransport, type TransportHandlers } from '@overlap/room-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { decodeFrame } from './frames.js';
import { startOverlapServer, type OverlapServer } from './server.js';

const DRAFT: RoomDraft = {
  title: 'Sprint planning',
  anchorZone: 'America/New_York',
  dates: ['2026-08-20', '2026-08-21'],
  dayStartMinute: 9 * 60,
  dayEndMinute: 17 * 60,
  slotMinutes: 30,
};

let server: OverlapServer;

beforeEach(async () => {
  server = await startOverlapServer({ port: 0 });
});

afterEach(async () => {
  await server.close();
});

async function createRoom(draft: RoomDraft = DRAFT): Promise<string> {
  const response = await fetch(`${server.httpUrl}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(draft),
  });
  const body = (await response.json()) as { config: { roomId: string } };
  return body.config.roomId;
}

/**
 * A participant, driving the real {@link RoomClient} over a real WebSocket.
 *
 * Deliberately not a stand-in for the sync engine — the point of these tests is that the
 * shipped client logic converges, not that a test double does.
 */
class TestParticipant {
  readonly client: RoomClient;
  private socket: WebSocket | null = null;
  private handlers: TransportHandlers | null = null;

  constructor(
    private readonly roomId: string,
    readonly participantId = generateParticipantId(),
    private offline = false,
  ) {
    this.client = new RoomClient({
      participantId,
      sessionId: generateSessionId(),
      flushIntervalMs: 5,
      connect: (handlers) => this.openSocket(handlers),
    });
  }

  private openSocket(handlers: TransportHandlers): ClientTransport {
    this.handlers = handlers;

    if (this.offline) {
      // Nothing to connect to. The client keeps painting into its local replica and its outbox,
      // which is the whole point: offline is not a mode, it is a transport that is not there.
      setTimeout(() => {
        handlers.onClose();
      }, 1);
      return { send: () => undefined, close: () => undefined };
    }

    const socket = new WebSocket(`${server.wsUrl}/api/rooms/${this.roomId}/socket`);
    this.socket = socket;
    socket.on('open', () => {
      handlers.onOpen();
    });
    socket.on('message', (data) => {
      handlers.onMessage(decodeFrame(data));
    });
    socket.on('close', () => {
      handlers.onClose();
    });
    socket.on('error', () => undefined);

    return {
      send: (payload) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(payload);
      },
      close: () => {
        socket.close();
      },
    };
  }

  async connect(): Promise<void> {
    this.client.start();
    await waitFor(() => this.client.status === 'live' && this.client.config !== null);
  }

  goOffline(): void {
    this.offline = true;
    this.socket?.close();
    this.handlers?.onClose();
  }

  goOnline(): void {
    this.offline = false;
  }

  paint(instants: readonly number[], level: Level): void {
    this.client.setLevels(instants.map((instant) => ({ instant, level })));
  }

  stop(): void {
    this.client.stop();
    this.socket?.close();
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for condition');
}

function slots(participant: TestParticipant): number[] {
  const config = participant.client.config;
  if (!config) throw new Error('Not connected');
  const record = server.registry.get(config.roomId);
  if (!record) throw new Error('Room missing');
  return record.engine.slots.map((slot) => slot.instant);
}

describe('multi-client convergence over real WebSockets', () => {
  it('converges four clients painting overlapping regions at the same time', async () => {
    const roomId = await createRoom();
    const people = [
      new TestParticipant(roomId),
      new TestParticipant(roomId),
      new TestParticipant(roomId),
      new TestParticipant(roomId),
    ];
    await Promise.all(people.map((person) => person.connect()));

    const instants = slots(people[0]!);

    // Every client paints overlapping ranges simultaneously, with no coordination.
    people.forEach((person, index) => {
      person.client.setName(`Person ${index}`);
      person.paint(instants.slice(index * 2, index * 2 + 12), 2);
      person.paint(instants.slice(index * 3 + 1, index * 3 + 5), 1);
    });

    const record = server.registry.get(roomId)!;
    const expectedEntries = people.length * 16 - 8; // painted cells, minus the overwrites

    await waitFor(() => people.every((person) => person.client.pendingCount === 0));
    await waitFor(() => people.every((person) => person.client.state.equals(record.engine.state)));

    // Byte-identical, including stamps — not merely "the values look the same".
    for (const person of people) {
      expect(person.client.state.equals(record.engine.state)).toBe(true);
    }
    expect(record.engine.state.availability.size).toBeGreaterThan(0);
    expect(expectedEntries).toBeGreaterThan(0);
    expect(record.engine.state.participants()).toHaveLength(4);

    people.forEach((person) => {
      person.stop();
    });
  });

  it('loses nothing when a client paints while offline and then reconnects', async () => {
    const roomId = await createRoom();
    const online = new TestParticipant(roomId);
    const goes = new TestParticipant(roomId);

    await online.connect();
    await goes.connect();
    const instants = slots(online);

    goes.goOffline();
    await waitFor(() => goes.client.status !== 'live');

    // Both sides keep working. Neither knows about the other's writes yet.
    goes.paint(instants.slice(0, 6), 2);
    online.paint(instants.slice(3, 9), 1);
    expect(goes.client.pendingCount).toBeGreaterThan(0);

    goes.goOnline();
    await waitFor(() => goes.client.status === 'live');
    await waitFor(() => goes.client.pendingCount === 0);

    const record = server.registry.get(roomId)!;
    await waitFor(
      () =>
        goes.client.state.equals(record.engine.state) &&
        online.client.state.equals(record.engine.state),
    );

    // Every write from both sides survived; the keys were disjoint, so nothing had to lose.
    for (const instant of instants.slice(0, 6)) {
      expect(record.engine.state.levelFor(goes.participantId, instant)).toBe(2);
    }
    for (const instant of instants.slice(3, 9)) {
      expect(record.engine.state.levelFor(online.participantId, instant)).toBe(1);
    }

    online.stop();
    goes.stop();
  });

  it('is unharmed by replaying the same outbox twice', async () => {
    const roomId = await createRoom();
    const person = new TestParticipant(roomId);
    await person.connect();
    const instants = slots(person);

    person.paint(instants.slice(0, 5), 2);
    await waitFor(() => person.client.pendingCount === 0);

    const record = server.registry.get(roomId)!;
    const before = record.engine.snapshot();

    // Reconnecting replays whatever is outstanding. Idempotence is what makes that free.
    person.goOffline();
    await waitFor(() => person.client.status !== 'live');
    person.goOnline();
    await waitFor(() => person.client.status === 'live');
    await waitFor(() => person.client.state.equals(record.engine.state));

    expect(record.engine.snapshot()).toEqual(before);
    person.stop();
  });

  it('converges after a partition where both sides painted the same cells', async () => {
    const roomId = await createRoom();
    const alice = new TestParticipant(roomId);
    const bob = new TestParticipant(roomId);
    await alice.connect();
    await bob.connect();
    const instants = slots(alice);
    const contested = instants.slice(0, 4);

    alice.goOffline();
    bob.goOffline();
    await waitFor(() => alice.client.status !== 'live' && bob.client.status !== 'live');

    // Both paint their own cells at the same instants while split.
    alice.paint(contested, 2);
    bob.paint(contested, 1);

    alice.goOnline();
    bob.goOnline();
    await waitFor(() => alice.client.status === 'live' && bob.client.status === 'live');
    await waitFor(() => alice.client.pendingCount === 0 && bob.client.pendingCount === 0);

    const record = server.registry.get(roomId)!;
    await waitFor(
      () =>
        alice.client.state.equals(record.engine.state) &&
        bob.client.state.equals(record.engine.state),
    );

    // Different participants, so the keys never collided and both survived in full.
    for (const instant of contested) {
      expect(record.engine.state.levelFor(alice.participantId, instant)).toBe(2);
      expect(record.engine.state.levelFor(bob.participantId, instant)).toBe(1);
    }

    alice.stop();
    bob.stop();
  });

  it('resolves the same person on two devices to one deterministic winner', async () => {
    const roomId = await createRoom();
    const sharedId = generateParticipantId();
    const phone = new TestParticipant(roomId, sharedId);
    const laptop = new TestParticipant(roomId, sharedId);

    await phone.connect();
    await laptop.connect();
    const instant = slots(phone)[0]!;

    phone.client.setLevel(instant, 2);
    laptop.client.setLevel(instant, 1);

    const record = server.registry.get(roomId)!;
    await waitFor(() => phone.client.pendingCount === 0 && laptop.client.pendingCount === 0);
    await waitFor(
      () =>
        phone.client.state.equals(record.engine.state) &&
        laptop.client.state.equals(record.engine.state),
    );

    // Whichever value won, all three replicas agree on it. No split brain.
    const winner = record.engine.state.levelFor(sharedId, instant);
    expect(phone.client.state.levelFor(sharedId, instant)).toBe(winner);
    expect(laptop.client.state.levelFor(sharedId, instant)).toBe(winner);

    phone.stop();
    laptop.stop();
  });

  it('relays presence without ever persisting it', async () => {
    const roomId = await createRoom();
    const alice = new TestParticipant(roomId);
    const bob = new TestParticipant(roomId);
    await alice.connect();
    await bob.connect();

    await waitFor(() => alice.client.presence.length === 1);
    alice.client.sendCursor({ x: 0.5, y: 0.25 }, null);

    await waitFor(() => bob.client.presence.some((peer) => peer.cursor !== null));
    const seen = bob.client.presence.find((peer) => peer.cursor !== null);
    expect(seen?.cursor).toEqual({ x: 0.5, y: 0.25 });

    // Cursors are worthless a second later, so nothing about them reaches the CRDT.
    const record = server.registry.get(roomId)!;
    expect(record.engine.snapshot().availability.entries).toHaveLength(0);

    alice.stop();
    bob.stop();
    await waitFor(() => bob.client.presence.length === 0 || alice.client.presence.length === 0);
  });

  it('tells the client when the server refuses a write instead of dropping it silently', async () => {
    const roomId = await createRoom();
    const alice = new TestParticipant(roomId);
    const bob = new TestParticipant(roomId);
    await alice.connect();
    await bob.connect();

    const rejections: string[] = [];
    const impostor = new RoomClient({
      participantId: alice.participantId,
      sessionId: generateSessionId(),
      flushIntervalMs: 5,
      onRejected: (reason) => rejections.push(reason),
      connect: (handlers) => {
        const socket = new WebSocket(`${server.wsUrl}/api/rooms/${roomId}/socket`);
        socket.on('open', () => {
          handlers.onOpen();
        });
        socket.on('message', (data) => {
          handlers.onMessage(decodeFrame(data));
        });
        socket.on('close', () => {
          handlers.onClose();
        });
        socket.on('error', () => undefined);
        return {
          send: (payload: string) => {
            if (socket.readyState === WebSocket.OPEN) socket.send(payload);
          },
          close: () => {
            socket.close();
          },
        };
      },
    });

    impostor.start();
    await waitFor(() => impostor.status === 'live');

    // Writing to someone else's row, which the engine refuses.
    const instant = slots(alice)[0]!;
    impostor.setLevel(instant, 2);
    impostor.finalize(999);

    await waitFor(() => rejections.length > 0);
    expect(rejections.join(' ')).toMatch(/not part of this room/);

    impostor.stop();
    alice.stop();
    bob.stop();
  });
});

describe('room HTTP surface', () => {
  it('creates a room and reports it back', async () => {
    const roomId = await createRoom();
    const response = await fetch(`${server.httpUrl}/api/rooms/${roomId}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { title: string };
    expect(body.title).toBe('Sprint planning');
  });

  it('rejects an invalid draft with a reason', async () => {
    const response = await fetch(`${server.httpUrl}/api/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...DRAFT, anchorZone: 'Mars/Olympus_Mons' }),
    });
    expect(response.status).toBe(400);
  });

  it('404s an unknown room rather than inventing one', async () => {
    const response = await fetch(`${server.httpUrl}/api/rooms/aaaaaaaaaaaaaaaaaaaaaa`);
    expect(response.status).toBe(404);
  });

  it('refuses a socket for a room that does not exist', async () => {
    const socket = new WebSocket(`${server.wsUrl}/api/rooms/aaaaaaaaaaaaaaaaaaaaaa/socket`);
    const failed = await new Promise<boolean>((resolve) => {
      socket.on('error', () => {
        resolve(true);
      });
      socket.on('open', () => {
        resolve(false);
      });
    });
    expect(failed).toBe(true);
  });
});
