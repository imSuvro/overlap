# ADR-0007 — Identity without accounts: stable participant, per-session writer

- **Status:** Accepted
- **Date:** 2026-08-14
- **Deciders:** Suvra Samajder

## Context

The brief forbids accounts, signup, and email — the URL is the room. But the CRDT still needs
two distinct notions of "who":

- **Whose availability is this?** — part of the key, must be stable across reloads and across
  a week of the room being open.
- **Who wrote this stamp?** — the HLC tiebreaker, must be unique per concurrent writer or the
  total order is not actually total.

Conflating the two is tempting and wrong. It surfaced while writing the convergence property
tests: two browser tabs sharing one identifier can mint byte-identical stamps in the same
millisecond, and two replicas that saw those writes in different orders would silently diverge.

## Decision

Two separate identifiers.

- **`participantId`** — a CSPRNG identifier generated once per browser profile and persisted in
  `localStorage`. It is part of the availability key, so it defines whose row a mark belongs to.
  Reloading, closing the tab, or going offline for a day all resume the same participant.
- **`sessionId`** — a fresh CSPRNG identifier per tab, used as the HLC `actorId`. Two tabs are
  two writers and can never mint the same stamp.

Additionally, the register merge is made **total on `(stamp, value)`** rather than on `stamp`
alone. Ordering by the value breaks an exact three-field stamp collision deterministically.

## Consequences

### Positive

- The order is genuinely total under all inputs, not just well-behaved ones. Since the server
  accepts frames from arbitrary browsers, a forged or buggy duplicate stamp is a real
  possibility, and divergence is a worse failure than bad data because nothing detects it.
- The value tiebreak costs nothing measurable — it runs only on an exact stamp collision, which
  does not otherwise occur.
- Idempotence is preserved: a replayed op carries an identical stamp _and_ value, compares
  equal, and is rejected. Offline replay stays free.
- Two tabs on the same device behave correctly: one participant, two writers, deterministic
  resolution.

### Negative

- **The same person on two devices is two participants.** Phone and laptop each get their own
  `participantId`, so they appear as two rows in the room. This is a genuine product limitation
  and is documented in the README rather than hidden.
- Clearing site data loses the identity, and there is no recovery path — by construction, since
  there is no account to recover into.
- `localStorage` is unavailable in some private-browsing configurations; the client falls back
  to an in-memory identity that lasts for the tab's lifetime.

## Alternatives considered

**One identifier for both roles.** Rejected — it is exactly what the property test caught. Two
tabs sharing an actor id can mint identical stamps.

**Resume identity by matching the typed name.** This is what several existing no-account
schedulers do, and it would solve the two-device problem. Rejected because it means anyone who
types your name inherits your availability and can edit it. For a link that gets forwarded into
group chats, that is an impersonation vector, not a feature.

**Put a secret in the URL fragment for cross-device identity.** Rejected. The whole product is
built on the URL being shareable; a URL that also carries your write credential is one paste
away from handing someone else your identity.
