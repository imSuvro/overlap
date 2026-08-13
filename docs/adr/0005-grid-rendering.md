# ADR-0005 — Grid rendering: Canvas 2D for pixels, DOM for semantics

- **Status:** Accepted
- **Date:** 2026-08-13
- **Deciders:** Suvra Samajder

## Context

Drag-painting is the product's central interaction and must stay smooth on a mid-range phone.
A large room is 14 days × 48 slots = **672 cells**, and during a drag the heatmap must repaint
as the pointer moves.

The same grid must also be fully operable by keyboard and legible to a screen reader, which is
the requirement that usually kills a canvas approach.

## Decision

**Hybrid.** Two layers over the same coordinate space:

1. **Canvas 2D — pixels.** One `<canvas>`, DPR-scaled, repainted in a `requestAnimationFrame`
   loop only when marked dirty.
2. **DOM — semantics.** A sibling `role="grid"` with one `role="gridcell"` button per slot,
   absolutely positioned, visually transparent, focusable, each carrying a full label such as
   _"Thursday 20 August, 2:30 to 3:00 PM, you are available, 4 of 6 people available"_.

The DOM layer is updated **on commit only** — never per `pointermove`.

Pointer handling uses `setPointerCapture`, reads `getCoalescedEvents()` so fast drags do not
skip cells between frames, resolves the target cell by arithmetic rather than hit-testing, and
latches paint-vs-erase from the first cell touched (spreadsheet behaviour).

Keyboard parity: roving tabindex, arrow navigation, Space/Enter to cycle level, Shift+Arrow to
paint a range.

## Consequences

### Positive

- Repaint is a single `fillRect` loop over 672 cells — well under a millisecond, and constant
  work per frame regardless of how much changed.
- Avoids the pure-DOM failure mode: mutating `background-color` on up to 672 elements on every
  `pointermove` triggers style recalculation and paint on the main thread of the exact device
  class that must stay smooth.
- `getCoalescedEvents()` means a fast flick paints every cell it crossed, not just the ones
  sampled at frame boundaries — the difference between feeling precise and feeling lossy.
- Full assistive-technology support is retained, and costs nothing during a drag because the
  semantic layer is only touched on commit.
- Heatmap opacity, hatching for non-existent DST hours, and cursor overlays are all trivial in
  canvas and awkward in DOM.

### Negative

- Cells cannot be styled with CSS; all visual states live in the paint routine, so the design
  system's tokens must be readable from JS. Handled by resolving CSS custom properties once per
  theme change and caching them.
- ~700 DOM nodes are carried for the accessibility layer. They are inert and never restyled, so
  the cost is memory rather than per-frame work, but it is not free.
- Text inside the canvas needs manual DPR handling and does not inherit font loading behaviour;
  axis labels are therefore kept in DOM, not canvas.
- Two layers must agree on geometry. A single shared layout module computes cell rectangles and
  both consume it, so there is one source of truth rather than two.

## Alternatives considered

**Pure DOM (one element per cell).** Rejected on mobile performance for the reason above. It
would be simpler and fully accessible for free, and would be the right call for a grid an order
of magnitude smaller.

**Pure Canvas.** Rejected on accessibility. Without a DOM layer there is nothing for a screen
reader to read and nothing to focus, which fails a hard requirement of the brief.

**WebGL.** Rejected as unjustified. 672 rectangles is nowhere near the point where 2D canvas
stops being fast, and it would add shader complexity and context-loss handling for no gain.

**SVG.** Rejected. It has the same per-element cost as DOM plus a heavier layout model.
