# Overlap — Engineering Plan

> Real-time collaborative group scheduling. A host creates a room, shares a URL, and
> everyone paints their availability onto a shared time grid. No accounts, no install.
> The URL is the room.

This document is the plan of record. It was written before implementation began.
Each decision that the brief flagged as a "Gray Area" is resolved here with reasoning,
and mirrored into a numbered ADR under [`docs/adr/`](./adr).

---

## 1. Product shape

A room is a set of **candidate meeting instants**. Every participant marks each instant
as one of three levels. The room aggregates those marks into a heatmap, surfaces the
windows that work for the most people, and lets the host pin a final choice.

| Level               | Meaning            | Weight |
| ------------------- | ------------------ | ------ |
| `0` — `unavailable` | Can't do it        | 0.0    |
| `1` — `ifNeedBe`    | Could make it work | 0.5    |
| `2` — `available`   | Free               | 1.0    |

Three levels rather than a boolean is a deliberate, cheap win: it is the entire
"weighted yes/maybe" feature request, and it costs one enum widening instead of a
boolean. The weight column is what the best-windows solver scores against.

### What is in scope

- Drag-to-paint availability on a time grid, with paint/erase latching
- Full keyboard parity with dragging (arrows, Space, Shift+Arrow range paint)
- Live cursors, live name editing, and presence for everyone in the room
- Overlap heatmap that updates as people paint
- Every participant sees the grid in **their own** IANA timezone
- Best-windows panel — ranked contiguous windows scored by weighted attendance
- Finalize-and-share — host pins a window; everyone sees it; copyable plaintext summary
- Works offline; reconciles on reconnect with no lost writes

### What is cut, and why

| Cut                                                                   | Reason                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Recurring windows**                                                 | Needs an RRULE model, expansion, and per-occurrence exception handling. That is a calendar-application feature, not a one-off-meeting feature. It would roughly double the data model to serve the least-travelled path in this product.                                                                       |
| **Duration preferences** ("find me 90 minutes where ≥80% can attend") | Needs a constraint search over contiguous runs plus UI to express the constraint. The best-windows panel already delivers the useful 80% of this at ~5% of the cost, and does it without a new input surface.                                                                                                  |
| **Calendar (ICS) import**                                             | Parsing ICS is easy. The value is _merging an external busy-calendar into availability_, which introduces a second source of truth and a whole conflict semantics that this design deliberately does not have. Adding it would compromise the core claim that all state converges under one commutative merge. |
| **Accounts, email, notifications**                                    | Excluded by the brief. The URL is the room.                                                                                                                                                                                                                                                                    |
| **QR code for room sharing**                                          | Genuinely nice on mobile, but needs either a dependency or ~200 lines of QR encoder for a feature that the native share sheet already covers. Listed honestly as a known gap.                                                                                                                                  |

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Browser (React 19 + Vite)                                          │
│                                                                     │
│   ┌───────────────┐   ┌──────────────┐   ┌──────────────────────┐   │
│   │ Canvas 2D     │   │ DOM role=    │   │ IndexedDB            │   │
│   │ heatmap layer │   │ "grid" a11y  │   │ snapshot + outbox    │   │
│   └───────┬───────┘   └──────┬───────┘   └──────────┬───────────┘   │
│           └──────────┬───────┘                      │               │
│                 ┌────▼──────────────────────────────▼────┐          │
│                 │  Local CRDT replica (@overlap/crdt)    │          │
│                 └────────────────┬──────────────────────-┘          │
│                                  │ zod-validated wire messages      │
└──────────────────────────────────┼──────────────────────────────────┘
                                   │  WebSocket  (same origin)
┌──────────────────────────────────▼──────────────────────────────────┐
│  Cloudflare Worker  (edge, free tier)                               │
│    • serves the SPA from Workers Static Assets (free, unmetered)    │
│    • routes /r/:roomId/socket → Durable Object stub for that room   │
│                                                                     │
│   ┌──────────────────────────────────────────────────────────────┐  │
│   │  RoomDurableObject   — one per room, single-threaded         │  │
│   │    • WebSocket Hibernation API (idle rooms cost nothing)     │  │
│   │    • @overlap/room-core — the same merge fn the client runs  │  │
│   │    • SQLite-backed DO storage — durable replica              │  │
│   └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

The server is **not a coordinator**. It is a relay plus a durable replica that runs the
_identical_ merge function the clients run, imported from the same package. That symmetry
is the point: there is no server-only ordering logic that could disagree with a client,
and the convergence tests can run the whole system in one process.

### Packages

| Package              | Responsibility                                                                             | Dependencies          |
| -------------------- | ------------------------------------------------------------------------------------------ | --------------------- |
| `@overlap/time`      | IANA timezone kernel: offsets, wall-time↔instant, slot generation, viewer-local formatting | **zero**              |
| `@overlap/crdt`      | Hybrid logical clock, LWW register map, merge/snapshot/compact                             | **zero**              |
| `@overlap/protocol`  | Zod schemas for every wire message and persisted shape; shared domain types                | `zod`                 |
| `@overlap/room-core` | Transport-agnostic room engine: apply op → new state + broadcast set                       | the three above       |
| `apps/web`           | React client                                                                               | react, the four above |
| `apps/edge`          | Cloudflare Worker + Durable Object (production)                                            | `room-core`           |
| `apps/dev-server`    | Node.js `ws` server (local dev + integration tests)                                        | `ws`, `room-core`     |

`@overlap/time` and `@overlap/crdt` have **zero runtime dependencies** on purpose. They are
the two places where a subtle bug is expensive and hard to detect, so they are small enough
to read end to end and are covered by property-based tests.

### Why both a Node server and a Cloudflare Durable Object

The brief prefers Node.js; the free-tier WebSocket reality points at Cloudflare. Rather than
choosing one and compromising, the room engine is transport-agnostic and there are two thin
adapters over it:

- `apps/dev-server` — a real Node.js `ws` server. Used for `pnpm dev`, and it is what the
  multi-client integration tests drive. It is a genuine deployment target for any Node host.
- `apps/edge` — a Cloudflare Worker + Durable Object. This is what production runs on.

The adapters are ~150 lines each. Everything that could be wrong lives in `room-core`, which
both share, and which is tested once. This also means the integration suite runs in-process
against real WebSockets in milliseconds instead of needing an edge runtime in the loop.

---

## 3. Concurrent editing and conflict resolution — the core decision

> **Resolved in [ADR-0001](./adr/0001-conflict-resolution.md).**

### The domain insight that drives everything

State is keyed by **(participant, instant)**. A participant only ever writes _their own_
cells. So the overwhelmingly common case — six people painting the same grid at the same
time — involves **disjoint keys**. There is no conflict to resolve at all.

Genuine concurrency only arises in two narrow cases:

1. The same person on two devices (phone and laptop) painting the same cell.
2. A queued offline edit racing a newer live edit for the same cell.

That is a dramatically smaller problem than "collaborative editing" usually implies, and the
right solution is correspondingly smaller.

### The chosen model: a state-based CRDT — map of LWW registers

Room state is a grow-only map from key → `{ value, stamp }`. Merge is per-key maximum by stamp:

```ts
merge(a, b)[k] = k in a && k in b ? (gt(a[k].stamp, b[k].stamp) ? a[k] : b[k]) : (a[k] ?? b[k]);
```

Because `max` over a total order is commutative, associative, and idempotent, the merge
forms a **join-semilattice**, which gives **strong eventual consistency**: any two replicas
that have observed the same set of updates are byte-identical, regardless of the order they
arrived in or how many times they were delivered. That property is asserted directly by
property-based tests in `packages/crdt`.

Three consequences worth naming, because they are what make the rest of the system simple:

- **Replaying the offline outbox is always safe.** Idempotence means no dedup bookkeeping,
  no "have I already sent this?" table, no sequence-number negotiation.
- **Optimistic local application needs no rollback path.** The local value _is_ a valid
  replica value the instant it is written, so there is no pending/confirmed visual state
  and nothing ever snaps back.
- **The server needs no ordering authority.** It merges like everyone else.

### Stamps: Hybrid Logical Clock

`stamp = (wallMs, counter, actorId)`, compared lexicographically.

- On local event: `wallMs = max(now, prevWallMs)`; `counter = wallMs === prevWallMs ? counter+1 : 0`
- On receive: `wallMs = max(now, prevWallMs, incomingWallMs)`, counter advanced to preserve causality
- Incoming `wallMs` more than a bounded skew ahead of local `now` is clamped, so one device
  with a badly wrong clock cannot win every future write forever

Why HLC rather than the alternatives:

| Option               | Problem                                                                                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pure Lamport counter | A device that has been idle offline has a low counter, so its _newer_ edit loses to an _older_ edit from a chatty device. Correct, but reads as a bug to a user. |
| Pure wall clock      | Breaks under clock skew — a device with a fast clock wins every conflict indefinitely.                                                                           |
| **HLC**              | Tracks physical time closely enough to feel right, never moves backwards, and preserves causality: if `a` happened before `b`, then `stamp(a) < stamp(b)`.       |

`actorId` is the final tiebreaker, which makes the order **total** — and therefore the
winner of an exact tie is the same on every replica. That is what "converge deterministically"
requires.

### On "no lost writes"

Stated precisely, because the honest version matters: for **disjoint** keys — every
cross-participant edit — nothing is ever lost; all writes survive the merge. For a genuine
same-key concurrent write, LWW keeps one value. That case is one person's two devices
disagreeing about one of their own cells, where a deterministic, causally-sensible winner is
the correct product behaviour, and every replica picks the _same_ winner. There is no
divergence and no split-brain.

### Why not OT, Yjs, or Automerge

- **OT** exists to preserve _positional intent_ in sequences — insert at index 5 must shift
  when someone inserts at index 2. Our keys are absolute instants; they never shift. OT would
  add a server-side transformation matrix and buy us nothing.
- **Yjs / Automerge** would work correctly. But they cost ~40–90 KB gzipped on a mobile-first
  budget, and their general document model would be used here to hold... a map of enums. We
  would also inherit tombstone and GC semantics for a problem that has none.
- Writing it here is ~250 lines of zero-dependency code whose central claim is provable by
  property tests. The brief calls this the core design decision; a dependency would be an
  answer to a different question.

### Tombstones

There are none. "Unavailable" is `level: 0` — an explicit value, not an absence. Keys are
never deleted, so there is no delete-versus-update conflict and no GC problem. Growth is
bounded by `participants × slots` (a 14-day × 48-slot room with 30 people is ~20k entries,
~500 KB before compaction), and snapshots run-length-encode contiguous same-level runs.

---

## 4. Offline and sync model

> **Resolved in [ADR-0003](./adr/0003-persistence-and-offline.md).**

**Client storage: IndexedDB**, via a ~120-line typed wrapper (no dependency). Chosen over
`localStorage` because it is asynchronous (never blocks the paint thread mid-drag), has a
real size budget rather than ~5 MB of strings, and stores structured values without a
JSON round-trip on every write.

Two object stores:

- `snapshots` — the last known merged room state, keyed by room id
- `outbox` — locally-generated ops not yet acknowledged by the server

The sync loop:

1. Painting applies to the in-memory replica **immediately** and appends to `outbox`.
2. A flush task batches outbox ops on a ~60 ms timer and sends them if the socket is open.
3. On (re)connect the client sends `hello` with its room id, identity, and its entire
   outstanding outbox. The server merges it and replies with either a delta or, if the client
   is too far behind, a full snapshot.
4. Merge is idempotent, so steps 2 and 3 can overlap, duplicate, or repeat with no harm.
5. Reconnection uses exponential backoff with jitter. The socket is a performance
   optimisation, never a source of truth.

Offline is therefore not a special mode with its own code path. It is just the case where the
flush task has nowhere to send to yet.

**Server storage: SQLite-backed Durable Object storage.** It is transactional, colocated with
the single-threaded object that owns the room (so there is no read-modify-write race), and
free on the Workers free plan. No external database, so no second free-tier account to
depend on and no cold-start on a sleeping database.

Rooms are retained for 60 days after last write, then swept — documented in the README as a
real limitation rather than an implied forever.

---

## 5. Timezone model

> **Resolved in [ADR-0004](./adr/0004-timezone-model.md).**

**The canonical unit of time in Overlap is an absolute UTC instant (epoch milliseconds).**
Nothing else is ever stored. No local times, no numeric offsets.

A room stores its shape, not its slots:

```ts
{ anchorZone: "America/New_York",     // IANA id — the host's zone at creation
  dates: ["2026-08-20", "2026-08-21"], // calendar dates in the anchor zone
  dayStartMinute: 540,                 // 09:00 anchor-local wall time
  dayEndMinute:  1260,                 // 21:00 anchor-local wall time
  slotMinutes: 30 }
```

Slots are **materialised** by resolving each anchor-zone wall time to instants. That
resolution is where the correctness lives:

| Case                                                                                   | Instants | Behaviour                                                                                                                                   |
| -------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Normal                                                                                 | 1        | Ordinary slot.                                                                                                                              |
| **DST gap** (spring forward — 02:30 on the US spring transition simply does not exist) | 0        | The slot **does not exist**. The grid renders a hatched band labelled "this hour doesn't exist here" rather than silently inventing a time. |
| **DST ambiguity** (fall back — 01:30 happens twice)                                    | 2        | **Both** slots exist as distinct instants, disambiguated in the label by offset: "1:30 AM EDT" and "1:30 AM EST".                           |

The ambiguous case is the one nearly every naive implementation silently collapses,
quietly deleting an hour of real availability once a year.

**Rendering for the viewer** formats each instant with
`Intl.DateTimeFormat(locale, { timeZone: viewerZone })` and groups columns by the
**viewer's** local date. A consequence that falls out for free: a room created as seven
days in New York renders as eight columns for a viewer in Tokyo, because those instants
genuinely straddle eight Tokyo dates. No special-casing required.

**Historical offsets** are correct because the offset is always asked for _at a specific
instant_, so the full IANA history applies — Brazil abolishing DST in 2019, Egypt
reintroducing it in 2023, Lord Howe Island's 30-minute DST shift, Chatham's +12:45/+13:45.
A stored numeric offset would be wrong for any date outside the currently-active rule, which
is exactly the bug the brief calls out.

**Implementation: a zero-dependency kernel over `Intl.DateTimeFormat.formatToParts`.**
`temporal-polyfill` would give this for free but costs ~50 KB gzipped against a mobile budget,
for an app that needs perhaps six of its operations. The kernel is ~150 lines and is validated
against a table of real transitions in eight zones, including half-hour and 45-minute offsets.
Trade-off recorded in the ADR.

---

## 6. Data model

```ts
// Immutable after creation (except title, which is an LWW register)
type Room = {
  roomId: string; // 22-char base58, CSPRNG — the URL is the room
  title: string; // LWW
  anchorZone: IanaZoneId;
  dates: LocalDate[];
  dayStartMinute: number;
  dayEndMinute: number;
  slotMinutes: 15 | 30 | 60;
  createdAt: number;
};

type Participant = {
  participantId: string; // client-generated, persisted in localStorage
  name: string; // LWW
  colorSeed: number; // deterministic hue assignment
  joinedAt: number;
};

// The CRDT payload
type AvailabilityKey = `${ParticipantId}|${InstantMs}`;
type Level = 0 | 1 | 2;
type Registers = Map<AvailabilityKey, { value: Level; stamp: Hlc }>;

// Ephemeral — broadcast only, never persisted, never in the CRDT
type Presence = {
  participantId: string;
  cursor: { x: number; y: number } | null; // normalised grid coords
  hoveredSlot: InstantMs | null;
  lastSeenAt: number;
};
```

Presence is deliberately outside the CRDT. Cursors are worthless one second later, so
persisting or merging them would be pure cost. They are relayed at ~20 Hz, rAF-batched, and
dropped on disconnect.

Every one of these shapes has a Zod schema in `@overlap/protocol`, and **every boundary
validates**: inbound WebSocket frames on both ends, IndexedDB reads (storage can be corrupted
or written by an older version), and URL parameters. Types are inferred _from_ the schemas, so
the static and runtime views cannot drift.

---

## 7. Rendering strategy

> **Resolved in [ADR-0005](./adr/0005-grid-rendering.md).**

**Hybrid: Canvas 2D for pixels, DOM for semantics.**

The heatmap is one `<canvas>`, DPR-scaled, repainted inside a `requestAnimationFrame` loop
only when marked dirty. A 14-day × 48-slot grid is 672 cells — one `fillRect` loop, well
under a millisecond. The pure-DOM alternative mutates `background-color` on up to 672
elements on every `pointermove`, which is style-recalc and paint work on the main thread of a
mid-range Android phone during the exact interaction that must stay smooth.

Accessibility is not sacrificed to get that. A sibling `role="grid"` carries one
`role="gridcell"` button per slot, absolutely positioned over the canvas and visually
transparent but focusable, with a full label — _"Thursday 20 August, 2:30 to 3:00 PM, you are
available, 4 of 6 people available"_. Critically, that layer is updated **on commit only**,
never per `pointermove`, so it costs nothing during a drag.

Pointer handling uses `setPointerCapture`, reads `getCoalescedEvents()` so fast drags do not
skip cells between frames, resolves the cell by arithmetic rather than hit-testing, and
latches paint-vs-erase from the first cell touched (spreadsheet behaviour).

**Trade-off, stated honestly:** we give up CSS-based styling of cells and carry ~700 DOM
nodes for the a11y layer, in exchange for constant-time repaint during drag and full
assistive-technology support. Text rendering inside the canvas also needs manual DPR handling.
Both are worth it for the interaction this product is built around.

---

## 8. Realtime transport

> **Resolved in [ADR-0002](./adr/0002-realtime-transport.md).**

**Native WebSocket to the room's Durable Object**, using the WebSocket Hibernation API.

- One connection carries both CRDT ops and ephemeral presence, discriminated by message type
- Hibernation lets the Durable Object be evicted from memory while sockets stay open, so an
  idle room costs nothing — which is what keeps this inside the free tier
- Incoming messages bill at 20:1 and outgoing messages are free, which suits a
  presence-heavy, broadcast-heavy workload

Rejected: **WebRTC / y-webrtc** needs a signalling server anyway, needs TURN for symmetric
NATs (which is a paid service), and has no durable copy when the last peer closes the tab.
**SSE + POST** needs two connections, gives no backpressure signal, and behaves worse on
mobile radio transitions.

---

## 9. Hosting

> **Resolved in [ADR-0006](./adr/0006-hosting.md).**

| Option                                   | Verdict                                                                                                                                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cloudflare Workers + Durable Objects** | **Chosen.** Static assets free and unmetered; 100k req/day; SQLite-backed DOs on the free plan; WebSocket Hibernation; one origin so no CORS; a DO _is_ the per-room single-threaded actor this design wants. |
| Render free web service                  | Spins down after ~15 min idle with a ~50 s cold start. A scheduling link shared in a group chat is exactly the "idle then sudden traffic" pattern this breaks on.                                             |
| Fly.io                                   | No longer meaningfully free.                                                                                                                                                                                  |
| Railway                                  | Trial credit, then paid.                                                                                                                                                                                      |
| Deno Deploy                              | Good WebSocket support, but room state would need Deno KV, which is a weaker fit than a single-threaded per-room actor.                                                                                       |

The Cloudflare free-plan ceilings (100k requests/day, ~3M row-writes/month) are recorded in
the README's limitations section rather than left implied.

---

## 10. Git branching and release strategy

- **`main`** — protected. Always deployable, always tagged. No direct pushes; PR only;
  linear history; force-push and deletion blocked; all CI checks required.
- **`develop`** — protected integration branch. Same checks required.
- **`feature/*`, `fix/*`, `chore/*`, `docs/*`** — short-lived, branched from `develop`,
  squash-merged back into `develop`.
- **Release** — `develop` → `main` via PR, then an annotated semver tag `vX.Y.Z` on `main`.
- **Conventional Commits** — enforced by commitlint, both as a local hook and as a CI job,
  so history is machine-readable and changelogs can be generated from it.

One honest note recorded in the ADR: required-approval counts are set to 0. On a solo repo
GitHub will not let an author approve their own PR, so a non-zero requirement would deadlock
every merge. The _enforceable_ gates — PR required, status checks required, branch up to date,
conversations resolved, linear history — are all on. On a team this is the one line that
changes.

---

## 11. Test strategy

> **Detailed in [`docs/TEST-STRATEGY.md`](./TEST-STRATEGY.md).**

| Layer       | Tool                              | What it proves                                                                                                                                                                                                                          |
| ----------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit        | Vitest                            | Timezone kernel against a table of real DST transitions in eight zones; best-window solver; formatting                                                                                                                                  |
| Property    | Vitest + fast-check               | CRDT merge is commutative, associative, idempotent; random op interleavings converge; HLC preserves causality under skew                                                                                                                |
| Schema      | Vitest                            | Every wire message rejects malformed input; round-trips preserve values                                                                                                                                                                 |
| Integration | Vitest + real `ws`                | N in-process clients against the real Node server over real WebSockets: concurrent paint storms, assert byte-identical state on every client _and_ the server; outbox replay; partition and heal                                        |
| Worker      | `@cloudflare/vitest-pool-workers` | The Durable Object adapter against the real Workers runtime                                                                                                                                                                             |
| E2E         | Playwright                        | Multi-browser-context concurrent painting with convergence assertion; keyboard-only completion; offline → paint → reconnect → converge; cross-timezone rendering; DST-boundary rooms; mobile-viewport drag; axe-core accessibility scan |

CI gates every PR into `develop` and `main` on **lint, typecheck, test, build, and e2e**.
Coverage thresholds are enforced on the two zero-dependency packages where correctness is
subtle (`time` and `crdt`), rather than chasing a single global number that rewards testing
trivial code.

---

## 12. Sequencing

1. Plan and ADRs _(this document)_
2. Monorepo scaffold, tooling, branch protection
3. `@overlap/time` — kernel + DST test table
4. `@overlap/crdt` — HLC + LWW map + property tests
5. `@overlap/protocol` + `@overlap/room-core`
6. `apps/dev-server`, then `apps/edge`
7. `apps/web` — design system, canvas grid, a11y layer, sync, panels
8. Integration and E2E suites, CI wiring
9. Deploy and verify in production, including a real mobile browser
10. README, demo GIF, architecture diagram
