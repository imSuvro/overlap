# Overlap — Test Strategy

The goal is not a coverage number. It is to make the three things that are genuinely hard to get
right — **convergence**, **timezones**, and **offline reconciliation** — provable rather than
plausible, and to gate every merge on that proof.

## Where the risk actually is

| Area              | Risk                                                                                                | How it is addressed                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| CRDT merge        | A subtle ordering bug produces divergence that only appears under a rare interleaving in production | Property-based tests over randomly generated op sets, asserting the algebraic laws directly               |
| Timezone kernel   | Off-by-one-hour bugs that only appear twice a year, or only in one hemisphere                       | A table of real DST transitions across eight zones, including half-hour and 45-minute offsets             |
| Offline reconcile | Lost or duplicated writes after a partition                                                         | Integration tests that partition real clients, paint on both sides, heal, and assert byte-identical state |
| Drag painting     | Skipped cells on fast drags; jank on mobile                                                         | E2E drag with coalesced-event assertions; mobile-viewport run                                             |
| Accessibility     | Canvas rendering silently excluding screen-reader users                                             | axe-core scan plus a keyboard-only completion test                                                        |

## Layers

### 1. Unit — Vitest

- **`@overlap/time`** — the DST transition table. For each of `America/New_York`,
  `Europe/London`, `Australia/Lord_Howe` (30-minute DST), `Pacific/Chatham` (+12:45/+13:45),
  `Asia/Kolkata` (+05:30, no DST), `America/Sao_Paulo` (DST abolished 2019 — historical
  offsets), `Africa/Cairo` (DST reintroduced 2023), and `UTC`:
  - offset resolution at known instants either side of each transition
  - spring-forward wall times resolve to **zero** instants
  - fall-back wall times resolve to **two** distinct instants
  - round-trip `instant → wall → instant` is stable outside transitions
  - historical dates use the rule in force at the time, not today's rule
- **Best-windows solver** — ranking, tie-breaking, weighting of `ifNeedBe` at 0.5, and
  contiguity across a DST gap
- **Layout module** — cell geometry, DPR scaling, hit arithmetic

### 2. Property-based — Vitest + fast-check

Against `@overlap/crdt`, over randomly generated stamps and op sequences:

- `merge(a, b) === merge(b, a)` — **commutative**
- `merge(merge(a, b), c) === merge(a, merge(b, c))` — **associative**
- `merge(a, a) === a` — **idempotent**
- Applying a random op set in any random order, with arbitrary duplication, yields identical
  state — **convergence**
- HLC preserves causality: if `a` happened-before `b` then `stamp(a) < stamp(b)`, including
  under injected clock skew
- HLC never moves backwards, and clamps a peer whose clock is far ahead

### 3. Schema — Vitest

Every message in `@overlap/protocol`: malformed input is rejected, valid input round-trips
without value loss, and unknown message types fail closed rather than being ignored silently.

### 4. Integration — Vitest against the real Node server over real WebSockets

- **Concurrent paint storm** — N in-process clients paint overlapping regions simultaneously;
  assert every client _and_ the server hold byte-identical state
- **Outbox replay** — client goes offline, paints, reconnects; assert no lost and no duplicated
  writes, and that replaying the same outbox twice changes nothing
- **Partition and heal** — split clients, paint on both sides of the split, heal, assert
  convergence
- **Same participant, two devices** — assert the deterministic LWW winner is identical on both
- **Snapshot path** — a client far enough behind receives a full snapshot rather than a delta,
  and converges

### 5. Worker runtime — `@cloudflare/vitest-pool-workers`

The Durable Object adapter against the real Workers runtime under Miniflare: hibernation wake
behaviour, SQLite persistence across eviction, and socket lifecycle.

### 6. End-to-end — Playwright

- **Multi-client convergence** — several independent browser contexts paint the same room
  concurrently; assert the rendered heatmap converges in all of them
- **Cross-timezone rendering** — the same room opened with Playwright `timezoneId` set to
  `America/New_York`, `Asia/Kolkata`, and `Pacific/Chatham`; assert the same instants render
  under correct local labels and correct per-viewer column grouping
- **DST-boundary room** — a room spanning a spring-forward and a fall-back date; assert the
  non-existent hour is rendered as unavailable and the repeated hour appears twice
- **Offline → paint → reconnect** — CDP `setOffline`, paint while offline, restore, assert
  convergence with the peer that stayed online
- **Keyboard-only** — create, join, name, paint a range, and finalize without a pointer
- **Mobile viewport** — Pixel 5 emulation, touch drag painting
- **Accessibility** — axe-core scan on the landing and room views

## CI gates

Every PR into `develop` and `main` must pass, and each is an independently required check:

| Check              | Command                      |
| ------------------ | ---------------------------- |
| Lint               | `pnpm lint`                  |
| Typecheck          | `pnpm typecheck`             |
| Unit + integration | `pnpm test`                  |
| Build              | `pnpm build`                 |
| E2E                | `pnpm test:e2e`              |
| Commit messages    | commitlint over the PR range |

## On coverage thresholds

Thresholds are enforced on `@overlap/time` and `@overlap/crdt`, where the logic is subtle and
the code is small enough that high coverage is meaningful. A single global threshold across the
repo is deliberately not used — it rewards writing tests for trivial glue code and says nothing
about whether the merge function is actually correct. The property tests are the real gate.
