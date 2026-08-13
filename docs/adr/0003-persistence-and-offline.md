# ADR-0003 — Persistence: SQLite-backed Durable Object storage; IndexedDB offline outbox

- **Status:** Accepted
- **Date:** 2026-08-13
- **Deciders:** Suvra Samajder

## Context

The product must survive every client closing their tab, must work with no network at all, and
must reconcile cleanly on reconnect. It must do this on free-tier infrastructure with no
external database account.

## Decision

**Server:** SQLite-backed **Durable Object storage**, colocated with the single-threaded object
that owns the room.

**Client:** **IndexedDB**, through a ~120-line typed wrapper written in-repo, with two object
stores — `snapshots` (last merged room state) and `outbox` (locally-generated ops not yet
acknowledged).

**Sync loop:**

1. A paint applies to the in-memory replica immediately and appends to `outbox`.
2. A flush task batches the outbox on a ~60 ms timer and sends when the socket is open.
3. On (re)connect the client sends `hello` carrying its room id, identity, and entire
   outstanding outbox. The server merges and replies with a delta, or a full snapshot if the
   client is too far behind.
4. Merge is idempotent, so 2 and 3 may overlap, duplicate, or repeat harmlessly.
5. Reconnect uses exponential backoff with jitter.

## Consequences

### Positive

- No external database, so no second free-tier account, no connection pooling, and no cold
  start on a sleeping database instance.
- DO storage is transactional and colocated with the only writer, so there is no
  read-modify-write race and no distributed locking.
- IndexedDB is asynchronous, so persistence never blocks the paint thread mid-drag — the exact
  failure mode `localStorage` would introduce during the product's most important interaction.
- Structured values are stored without a JSON round-trip on every write, and the size budget is
  real rather than ~5 MB of strings.
- **Offline is not a mode.** It is simply the state where the flush task has nowhere to send
  yet. There is no separate offline code path to keep correct.
- Writing the IndexedDB wrapper in-repo keeps the client dependency-free at this boundary and
  lets every read be Zod-validated — important because stored data may have been written by an
  older version of the app.

### Negative

- Durable Object storage is Cloudflare-specific. Portability is preserved only because all room
  logic lives in `@overlap/room-core` behind a small storage interface; the Node adapter
  implements the same interface over a different backing store.
- IndexedDB's API is genuinely awkward, and a hand-written wrapper is a place bugs can hide.
  Mitigated by testing it against `fake-indexeddb` in CI.
- Free-plan SQLite storage limits (~3M row writes/month) are generous for this workload but not
  unlimited; recorded in the README.
- Rooms are swept 60 days after last write. This is a deliberate retention policy, documented in
  the README rather than left as an implied "forever".

## Alternatives considered

**`localStorage`.** Rejected — synchronous, so it blocks the main thread during drag painting,
and it forces a JSON round-trip per write.

**Cloudflare D1 or KV.** Rejected. KV is eventually consistent, which is the wrong primitive for
a room's authoritative replica. D1 would work but adds a second service and a network hop from
the Durable Object that already owns the room, for no gain.

**Supabase / Neon free tier.** Rejected. Adds an external account dependency, free tiers pause
idle databases (reintroducing the cold-start problem this design avoids), and it would put the
authoritative state somewhere other than the single-threaded actor that serialises writes.
