import { describe, expect, it } from 'vitest';
import { generateParticipantId, generateSessionId } from './ids.js';
import {
  MAX_OPS_PER_MESSAGE,
  encodeClientMessage,
  parseClientMessage,
  parseServerMessage,
  type ClientMessage,
} from './messages.js';

const participantId = generateParticipantId();
const sessionId = generateSessionId();

function hello(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    t: 'hello',
    participantId,
    sessionId,
    since: null,
    ops: [],
    ...overrides,
  });
}

describe('parseClientMessage — the boundary between an arbitrary browser and the room', () => {
  it('accepts a well-formed hello', () => {
    const result = parseClientMessage(hello());
    expect(result.ok).toBe(true);
  });

  it('round-trips an ops message without losing values', () => {
    const message: ClientMessage = {
      t: 'ops',
      ops: [{ k: 'a', key: `${participantId}|1755700000000`, v: 2, s: '1755700000000.0.abc' }],
    };
    const result = parseClientMessage(encodeClientMessage(message));
    expect(result).toEqual({ ok: true, value: message });
  });

  it('rejects input that is not JSON at all', () => {
    const result = parseClientMessage('not json {');
    expect(result).toEqual({ ok: false, error: 'not valid JSON' });
  });

  it('fails closed on an unrecognised message type', () => {
    // Silently ignoring an unknown type would turn a protocol mismatch into a mystery.
    const result = parseClientMessage(JSON.stringify({ t: 'drop-tables', ops: [] }));
    expect(result.ok).toBe(false);
  });

  it('rejects a malformed participant id', () => {
    expect(parseClientMessage(hello({ participantId: 'nope' })).ok).toBe(false);
    // Base58 excludes 0, O, I and l precisely so these cannot be confused for real ids.
    expect(parseClientMessage(hello({ participantId: '0OIl0OIl0OIl0OIl' })).ok).toBe(false);
  });

  it('rejects a stamp it cannot decode', () => {
    const result = parseClientMessage(
      JSON.stringify({
        t: 'ops',
        ops: [{ k: 'a', key: `${participantId}|1`, v: 1, s: 'not-a-stamp' }],
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects an availability level outside the three it defines', () => {
    const result = parseClientMessage(
      JSON.stringify({
        t: 'ops',
        ops: [{ k: 'a', key: `${participantId}|1`, v: 7, s: '1.0.abc' }],
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects an empty ops batch, which would be a wasted round trip', () => {
    expect(parseClientMessage(JSON.stringify({ t: 'ops', ops: [] })).ok).toBe(false);
  });

  it('caps how many ops one message may carry', () => {
    const op = { k: 'a', key: `${participantId}|1`, v: 1, s: '1.0.abc' };
    const tooMany = Array.from({ length: MAX_OPS_PER_MESSAGE + 1 }, () => op);
    expect(parseClientMessage(JSON.stringify({ t: 'ops', ops: tooMany })).ok).toBe(false);
  });

  it('refuses an oversized frame without trying to parse it', () => {
    const result = parseClientMessage('x'.repeat(300 * 1024));
    expect(result).toEqual({ ok: false, error: 'message too large' });
  });

  it('rejects a cursor outside the grid', () => {
    const result = parseClientMessage(
      JSON.stringify({ t: 'presence', cursor: { x: 42, y: 0.5 }, hoveredInstant: null }),
    );
    expect(result.ok).toBe(false);
  });

  it('reports which field was wrong', () => {
    const result = parseClientMessage(hello({ sessionId: 'bad' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('sessionId');
  });

  it('rejects a name that is only whitespace', () => {
    const result = parseClientMessage(
      JSON.stringify({ t: 'ops', ops: [{ k: 'n', key: participantId, v: '   ', s: '1.0.abc' }] }),
    );
    expect(result.ok).toBe(false);
  });
});

describe('parseServerMessage', () => {
  it('accepts a pong', () => {
    expect(parseServerMessage(JSON.stringify({ t: 'pong', serverTime: 1 })).ok).toBe(true);
  });

  it('rejects a server frame with an unknown error code', () => {
    // A deployed client can outlive a server version, so failing loudly on an unknown shape
    // beats rendering half a room.
    const result = parseServerMessage(
      JSON.stringify({ t: 'error', code: 'brand-new-code', message: 'x' }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects non-JSON', () => {
    expect(parseServerMessage('<html>').ok).toBe(false);
  });
});
