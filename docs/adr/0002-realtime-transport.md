# ADR-0002 — Realtime transport: native WebSocket to a per-room Durable Object

- **Status:** Accepted
- **Date:** 2026-08-13
- **Deciders:** Suvra Samajder

## Context

Overlap needs two very different streams over the same session:

- **Durable CRDT ops** — low volume, must not be lost, must be persisted
- **Ephemeral presence** — cursors at ~20 Hz, worthless one second later, must never be persisted

It must work on mobile radios that suspend and resume, stay inside a free tier, and require no
accounts. Rooms are idle most of their life and then briefly busy when a link is shared into a
group chat.

## Decision

A **single native WebSocket per client**, connecting to the **Durable Object that owns that
room**, using Cloudflare's **WebSocket Hibernation API**. Both streams share the connection and
are discriminated by a Zod-validated message `type`.

Presence is broadcast-only: relayed to peers, never merged into the CRDT, never written to
storage, dropped on disconnect.

## Consequences

### Positive

- One connection, one origin, no CORS, no signalling infrastructure.
- Hibernation lets the Durable Object be evicted from memory while its sockets stay open, so an
  idle room costs essentially nothing. This is the specific mechanism that keeps a
  "share a link and forget about it for three days" product inside the free tier.
- Cloudflare bills incoming WebSocket messages at 20:1 and outgoing messages and protocol pings
  at zero, which suits a broadcast-heavy, presence-heavy workload well.
- A Durable Object is single-threaded, so the room's apply-and-broadcast step has no
  read-modify-write race and needs no locking.
- Backpressure and close semantics come from the platform rather than being reimplemented.

### Negative

- Hibernation means in-memory state cannot be assumed across messages; anything that must
  survive has to be in DO storage or re-derived on wake. This constrains how the adapter is
  written.
- A single connection means presence floods share a pipe with durable ops. Mitigated by
  rAF-batching and throttling cursor updates client-side to ~20 Hz before they ever hit the wire.
- WebSockets are blocked by a small number of corporate proxies. No long-polling fallback is
  implemented; recorded as a known limitation.

## Alternatives considered

**WebRTC data channels (e.g. y-webrtc).** Rejected. It still needs a signalling server, so it
does not remove infrastructure. It needs TURN relays for symmetric NATs, and hosted TURN is a
paid service, which the brief forbids. And it has no durable copy — when the last peer closes
the tab, the room is gone, which is fatal for a link shared across days.

**Server-Sent Events downstream + POST upstream.** Rejected. Two connections to manage, no
upstream backpressure signal, and noticeably worse behaviour across mobile radio transitions
than a single WebSocket with a reconnect policy.

**HTTP long-polling.** Rejected as a primary transport — cursor presence at 20 Hz over polling
is both laggy and far more billable requests than the free tier allows.
