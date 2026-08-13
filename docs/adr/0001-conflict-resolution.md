# ADR-0001 — Conflict resolution: a map of LWW registers over a Hybrid Logical Clock

- **Status:** Accepted
- **Date:** 2026-08-13
- **Deciders:** Suvra Samajder
- **Supersedes:** —

## Context

Overlap lets several people paint availability onto one shared grid at the same time, from
devices that may be offline for arbitrary stretches. The brief requires that concurrent edits
"converge deterministically with no lost writes", and explicitly flags the choice between
CRDT, OT, and a simpler commutative model as the core design decision.

The decisive property of this domain is that **state is keyed by (participant, instant), and a
participant only ever writes their own cells**. Six people painting the same grid simultaneously
are writing six disjoint key sets. The "collaborative editing" framing suggests a much harder
problem than the one actually present.

Real concurrency is confined to two narrow cases:

1. The same person editing the same cell from two devices.
2. A queued offline edit racing a newer live edit for the same cell.

## Decision

Model room state as a **state-based CRDT (CvRDT): a grow-only map of last-writer-wins
registers**, where each entry is `{ value: Level, stamp: Hlc }` and merge is per-key maximum
by stamp.

Stamps are **Hybrid Logical Clocks** — `(wallMs, counter, actorId)` compared lexicographically:

- Local event: `wallMs = max(now, prevWallMs)`, `counter` increments only on a tie
- Receive: `wallMs = max(now, prevWallMs, incomingWallMs)`, counter advanced to preserve causality
- Incoming wall times beyond a bounded skew ahead of local `now` are clamped

`actorId` is the final tiebreaker, making the order **total**. Where two stamps are equal in all
three fields — which a well-behaved client never produces, but an arbitrary browser could — the
order falls through to the value itself, so even a forged duplicate cannot cause divergence.
See [ADR-0007](./0007-identity-without-accounts.md).

Implement it as a zero-dependency package (`@overlap/crdt`, ~250 lines) rather than adopting a
CRDT library.

## Consequences

### Positive

- Merge is commutative, associative, and idempotent, so the state space is a join-semilattice
  and replicas that have seen the same updates are **byte-identical**. This is asserted
  directly by property-based tests rather than assumed.
- **Idempotence makes offline replay free.** The outbox can be resent wholesale on every
  reconnect with no dedup table, no sequence-number negotiation, no acknowledgement protocol.
- **Optimistic local writes need no rollback path.** A locally-applied value is already a valid
  replica value, so there is no pending/confirmed visual state and the UI never snaps back.
- **The server needs no ordering authority** — it merges exactly like a client, using the same
  imported function. That symmetry is what lets the entire system be tested in one process.
- No tombstones: "unavailable" is `level: 0`, an explicit value, so keys are never deleted and
  there is no delete-versus-update conflict or GC problem.
- HLC tracks physical time closely enough that a newer edit from a long-idle device wins, which
  is what a user expects, while still never moving backwards and still preserving causality.

### Negative

- For a genuine **same-key** concurrent write, LWW keeps one value. Stated honestly: writes are
  never lost across participants (those keys are disjoint), but one person's two devices
  disagreeing about one of their own cells resolves to a single deterministic winner. Every
  replica picks the _same_ winner, so there is no divergence — but this is LWW, not a merge of
  intent, and it should not be described as stronger than it is.
- Clock-skew clamping is a heuristic. A device hours ahead is bounded, but within the skew
  window its writes are still favoured.
- Hand-rolled means the correctness burden is ours. Mitigated by property tests over random
  interleavings, and by the code being small enough to read end to end.
- Keyspace grows as `participants × slots` and is never pruned within a room's life. Bounded in
  practice (~20k entries, ~500 KB for a large room) and compacted via run-length encoding at
  snapshot time.

## Alternatives considered

**Operational Transformation.** Rejected. OT exists to preserve _positional intent_ in
sequences — an insert at index 5 must shift when someone inserts at index 2. Overlap's keys are
absolute UTC instants; they never shift. OT would introduce a server-side transformation matrix
and a central sequencer to solve a problem this domain does not have.

**Yjs or Automerge.** Rejected, though both would be correct. They cost roughly 40–90 KB
gzipped against a mobile-first budget, and their general document model would be used here to
hold a map of enums. We would also inherit tombstone and garbage-collection semantics for a
data model that has neither. Given the brief names this as _the_ core design decision,
importing an answer would be answering a different question.

**Server-authoritative last-write-wins with no client CRDT.** Rejected. It is simpler until the
offline requirement arrives, at which point the client needs conflict handling anyway — and
without idempotent merge, offline replay needs an acknowledgement and dedup protocol that is
strictly more machinery than the CRDT it was avoiding.
