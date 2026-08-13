# ADR-0004 — Timezone model: absolute instants, with a zero-dependency Intl kernel

- **Status:** Accepted
- **Date:** 2026-08-13
- **Deciders:** Suvra Samajder

## Context

Every participant must see the grid in their own IANA timezone. The brief requires correctness
across IANA zones, DST transitions, and **historical offsets**, and explicitly forbids naive
UTC offsets.

The two classic failure modes are storing a numeric offset (which is wrong for any date outside
the currently-active rule) and mishandling the two DST edge cases — the hour that does not
exist in spring, and the hour that happens twice in autumn.

## Decision

**The canonical unit of time is an absolute UTC instant (epoch milliseconds). Nothing else is
ever stored.**

A room stores its _shape_ — `anchorZone` (IANA id), `dates` (calendar dates in that zone),
`dayStartMinute`, `dayEndMinute`, `slotMinutes` — and slots are materialised by resolving each
anchor-zone wall time to instants:

| Case                          | Instants | Behaviour                                                                                                       |
| ----------------------------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| Normal                        | 1        | Ordinary slot                                                                                                   |
| **DST gap** (spring forward)  | 0        | Slot does not exist; grid renders a hatched "this hour doesn't exist here" band                                 |
| **DST ambiguity** (fall back) | 2        | **Both** instants exist as distinct slots, disambiguated in the label by offset — "1:30 AM EDT" / "1:30 AM EST" |

Rendering formats each instant with `Intl.DateTimeFormat(locale, { timeZone: viewerZone })` and
groups columns by the **viewer's** local date.

Implemented as a **zero-dependency kernel over `Intl.DateTimeFormat.formatToParts`**
(`@overlap/time`, ~150 lines), not a datetime library.

## Consequences

### Positive

- Historical offsets are correct by construction, because the offset is always resolved _at a
  specific instant_, so the full IANA history applies — Brazil abolishing DST in 2019, Egypt
  reintroducing it in 2023, Lord Howe Island's 30-minute DST shift, Chatham's +12:45/+13:45.
- Cross-timezone rendering needs no special cases. A room created as seven days in New York
  renders as **eight** columns for a viewer in Tokyo, because those instants genuinely straddle
  eight Tokyo dates. That falls out of the model rather than being coded.
- The ambiguous-hour case preserves an hour of real availability that naive implementations
  silently delete once a year.
- Zero bytes of dependency shipped to a mobile client, and the IANA database used is the one
  already in the platform, so it stays current without a package upgrade.
- The kernel is small enough to read end to end and is validated against a table of real
  transitions in eight zones.

### Negative

- We own the correctness of offset resolution. Mitigated by the DST transition table test, but
  it is a real burden a library would have absorbed.
- `Intl.DateTimeFormat` offset probing is more verbose than `Temporal.ZonedDateTime` and less
  self-documenting. The kernel exists partly to hide that.
- Very old dates (pre-1970 LMT offsets) are subject to engine-level IANA data variation. Out of
  scope for a scheduling tool, but not claimed as correct.
- Rooms spanning a DST transition have columns of unequal height. Handled explicitly in layout,
  but it is genuine extra UI complexity.

## Alternatives considered

**`temporal-polyfill`.** The semantically ideal answer — `getPossibleInstantsFor` models gap and
ambiguity natively, which is exactly the hard part. Rejected on size: ~50 KB gzipped against a
mobile-first budget for roughly six operations. If Temporal ships natively in the baseline
browser set, this decision should be revisited and the kernel deleted.

**`date-fns-tz` / `luxon` / `dayjs` + timezone plugin.** Rejected. All are heavier than the
kernel, and none of them model the ambiguous hour as _two distinct instants_ — they pick one,
which is precisely the bug being avoided.

**Storing wall times plus a numeric offset.** Rejected outright. It is wrong for any date
outside the currently-active DST rule and is the exact failure the brief calls out.
