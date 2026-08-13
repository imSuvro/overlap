# ADR-0006 — Hosting: Cloudflare Workers + Durable Objects on the free plan

- **Status:** Accepted
- **Date:** 2026-08-13
- **Deciders:** Suvra Samajder

## Context

The build must deploy to a live public URL on **free-tier infrastructure only**, with **no AWS**
and **no paid services**, while serving long-lived WebSocket connections and durable per-room
state.

The traffic shape matters: a scheduling link is shared into a group chat, sees a burst of
activity, then sits idle for days before another burst. Anything that charges for idle time, or
cold-starts badly after idle, is a poor fit.

## Decision

**Cloudflare Workers + Durable Objects**, single Worker, free plan.

- The SPA is served from **Workers Static Assets** — free and unmetered on both plans
- `/r/:roomId/socket` routes to the **Durable Object** stub for that room
- Room state lives in **SQLite-backed DO storage**
- Sockets use the **WebSocket Hibernation API**

## Consequences

### Positive

- One origin serves both the app and the socket, so there is no CORS layer and no second
  deployment to keep in sync.
- A Durable Object _is_ the per-room single-threaded actor this design already wanted. The
  hosting primitive and the architecture agree rather than being bridged.
- Hibernation means idle rooms hold open sockets without consuming memory or billing duration,
  which directly matches the burst-then-idle traffic shape.
- Free plan headroom is real for this workload: 100k requests/day, incoming WebSocket messages
  billed 20:1 with outgoing free, 5 GB SQLite storage, ~3M row writes/month.
- Edge deployment puts presence relay physically close to participants, which is where latency
  is most visible.
- No cold start on a sleeping database, because there is no separate database.

### Negative

- **Vendor lock-in at the storage and runtime boundary.** Mitigated deliberately: all room logic
  lives in `@overlap/room-core` behind a small storage interface, and `apps/dev-server` proves
  portability by running the same engine on plain Node.js with `ws`. Moving providers means
  rewriting a ~150-line adapter, not the product.
- Workers are not Node.js. Node built-ins are unavailable unless `nodejs_compat` is enabled, so
  shared packages are written against web-standard APIs only — which is also why they are
  zero-dependency.
- Free-plan ceilings are per-account, not per-project. Recorded in the README's limitations
  section rather than left implied.
- Deploying requires a Cloudflare account and an API token, which is a manual step outside the
  repository.

## Alternatives considered

| Option                      | Verdict                                                                                                                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Render free web service** | Rejected. Spins down after ~15 minutes idle with a ~50 s cold start. "Idle for days, then a burst when someone opens the link" is precisely the pattern this breaks on — the first participant would wait nearly a minute.                              |
| **Fly.io**                  | Rejected. No longer meaningfully free for an always-reachable service.                                                                                                                                                                                  |
| **Railway**                 | Rejected. Trial credit, then paid. Violates the free-tier constraint.                                                                                                                                                                                   |
| **Deno Deploy**             | Reasonable runner-up. Good WebSocket support and a real free tier, but room state would live in Deno KV, which is a weaker fit than a single-threaded per-room actor and would reintroduce read-modify-write races the DO model eliminates.             |
| **Vercel / Netlify**        | Rejected for the server half. Both are excellent for the static SPA, but their serverless functions do not hold long-lived WebSocket connections, so a second provider would be needed for realtime — two free tiers, two deploys, and a CORS boundary. |
