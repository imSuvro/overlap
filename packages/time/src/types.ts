/**
 * An IANA timezone identifier, e.g. `America/New_York`.
 *
 * Deliberately not a numeric offset. An offset is a *property of an instant in a zone*, never a
 * property of the zone itself — storing one is wrong for any date outside the currently-active
 * DST rule, which is the single most common timezone bug in scheduling software.
 */
export type TimeZoneId = string;

/** A calendar date with no time and no zone, formatted `YYYY-MM-DD`. */
export type LocalDate = string;

/**
 * Milliseconds since the Unix epoch, UTC. The canonical unit of time in Overlap.
 *
 * Every slot, every op stamp, and every persisted timestamp is one of these. Wall-clock
 * times exist only at the two edges of the system: room configuration on the way in, and
 * rendering on the way out.
 */
export type Instant = number;

/** Broken-down wall-clock fields as they read on a clock in some zone. */
export interface WallFields {
  readonly year: number;
  /** 1-12, unlike `Date`'s 0-11. */
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

/**
 * How a wall-clock time maps onto the timeline in a given zone.
 *
 * The three cases are the whole reason this package exists:
 * - `unique`   — the ordinary case, one instant
 * - `gap`      — spring forward; this wall time never happens, so there is no instant
 * - `ambiguous`— fall back; this wall time happens twice, so there are two distinct instants
 */
export type WallResolution =
  | { readonly kind: 'unique'; readonly instant: Instant }
  | { readonly kind: 'gap' }
  | { readonly kind: 'ambiguous'; readonly earlier: Instant; readonly later: Instant };
