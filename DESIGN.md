# Overlap — design contract

Locked at commit `docs(design): lock the Density direction`. From that commit forward this file
is law: every visual decision in the app derives from a token or a standard defined here.

**Amending it** requires its own commit, touching this file and nothing else, subject:

```
docs(design): design-amendment — <what changed and why>
```

The `design-amendment` marker cannot lead the subject line: this repo gates commits through
commitlint with a `type-enum`, enforced by both a git hook and CI, and every subject must open
with a conventional type. The marker sits immediately after the type instead, which keeps
amendments greppable (`git log --grep 'design-amendment'`) without weakening a gate that
predates this document.

Written after the audit in [`design/AUDIT.md`](design/AUDIT.md), which this file assumes.

---

## 1. Directions considered

Three were developed properly. All three had to honour the brand assets already in the repo —
the two-overlapping-squares wordmark, the favicon, and the warm paper palette — because those
are deliberate work, not scaffold. See `design/NOTES.md` for that decision.

### A. "Ledger" — the app as a kept book

A warm paper planner. Ruled rows, an ink-annotation feel, a humanist serif throughout, the time
gutter drawn as a notebook margin. Palette pulled toward parchment and iron-gall ink.
Signature: the ruled margin. Motion: ink settling — everything eases out, nothing springs.

**Self-critique — rejected.** Two problems, and the second is fatal. First, "notebook UI" is a
well-trodden skeuomorphic cliché; the moment it is recognised it reads as costume. Second and
worse, a paper metaphor actively lies about the product. The whole reason Overlap exists is that
it is _live_ — other people's marks appear under your cursor while you work. Dressing that as a
static book undersells the one thing no paper planner can do.

### B. "Density" — the data is the only thing with colour

The interface is a warm, quiet instrument. Every chrome surface is paper, ink and line; the only
saturated colour anywhere in the product is availability density. The heat ramp stops being a
chart palette and becomes the brand: the primary button, the focus ring, the wordmark, the
pinned state and the busiest cell on the grid are all drawn from the same six stops.

Layout: the grid is the screen, edge to edge, with chrome demoted to a thin rail.
Type: display serif for headings, system sans for interface, tabular figures for anything
countable. Motion: cells bloom on commit; the orchestrated moment is the overlap resolving as a
newcomer's marks land.

**Self-critique — selected, with one correction.** The idea is genuinely grounded: in a product
whose entire job is to make one pattern visible, spending the colour budget on that pattern and
nowhere else is a real argument, not a mood board. The risk is that "neutral chrome" slides into
cold and clinical — the exact opposite of the warm consumer feel that already works. The
correction: the neutral is **warm paper, never grey**. Nothing in this app is `#f5f5f5`.

### C. "Daylight" — time of day as the organising idea

The grid carries a diurnal wash: pre-dawn cool, midday warm, evening dim. Cross-timezone becomes
legible without reading, because two people's 9am sit at different heights against the same band
of light.

**Self-critique — rejected as a whole, one part promoted.** The concept is the most on-subject of
the three: it makes the app's hardest-to-explain feature _visible_. But washing the grid
background in a second colour system directly breaks the documented reason the heat ramp exists —
a single hue climbing in lightness so the strongest overlap is the most dominant thing on the
page. Two colour systems in one plane muddy each other and the ranking stops being readable.
Fatal for the grid.

What survives: the idea belongs **beside** the grid, not underneath it. Promoted to the
signature element below.

---

## 2. The chosen direction

**Density**, with Daylight's insight relocated to the time gutter.

**Signature element — the daylight rail.** A narrow vertical band running down the time gutter,
shading from night through dawn to midday and back to dusk, drawn in the _viewer's_ timezone.
It is the one bold thing in the product. It earns its place three ways:

1. You can feel what part of the day you are looking at before reading a single label.
2. It makes the timezone promise visible. A viewer in Berlin and one in Chicago see the same
   room with their own daylight — the strongest possible argument that the app is not doing
   naive UTC arithmetic.
3. It sits _outside_ the grid plane, so it cannot compete with the heat ramp.

It is deliberately low-chroma. It whispers. Everything else in the interface is disciplined so
this can be the thing people remember.

**Motion language — settle, never bounce.** This is a tool for finishing a chore. Motion exists
to explain what changed and where it came from. Nothing overshoots, nothing springs, nothing
loops. One orchestrated moment: when a room's marks first resolve, the heatmap rises through the
ramp rather than appearing fully formed.

---

## 3. Tokens

Implemented as CSS custom properties in `apps/web/src/styles/tokens.css`. **No colour, size,
radius, shadow or duration may appear anywhere else in the codebase.** Values marked _kept_ were
already in the system and survive review unchanged; values marked _new_ are added by this pass;
values marked _changed_ are amendments with a stated reason.

### 3.1 Colour — light

| Token                      | Value                 |             | Role                                                                                                                                                                                                                                        |
| -------------------------- | --------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--paper`                  | `#fbf7f1`             | kept        | The page. Warm, never grey.                                                                                                                                                                                                                 |
| `--surface`                | `#ffffff`             | kept        | Cards, panels.                                                                                                                                                                                                                              |
| `--surface-sunken`         | `#f4ede3`             | kept        | Wells, inset areas, hover on quiet controls.                                                                                                                                                                                                |
| `--surface-raised`         | `#ffffff`             | kept        | Dialogs, popovers.                                                                                                                                                                                                                          |
| `--ink`                    | `#2c2621`             | kept        | Body and headings.                                                                                                                                                                                                                          |
| `--ink-soft`               | `#6b6058`             | kept        | Secondary text.                                                                                                                                                                                                                             |
| `--ink-faint`              | `#6f665c`             | kept        | Tertiary. Already contrast-corrected; do not lighten.                                                                                                                                                                                       |
| `--ink-inverse`            | `#fdfaf6`             | kept        | Text on dark fills.                                                                                                                                                                                                                         |
| `--line`                   | `#e6dcce`             | kept        | Hairlines, dividers.                                                                                                                                                                                                                        |
| `--line-strong`            | `#d3c4b0`             | kept        | Input borders, emphasis edges.                                                                                                                                                                                                              |
| `--accent`                 | `#c94a24`             | kept        | Primary fill. White sits on it at 4.7:1.                                                                                                                                                                                                    |
| `--accent-hover`           | `#ad3d1b`             | kept        |                                                                                                                                                                                                                                             |
| `--accent-soft`            | `#fdeee7`             | kept        | Tint backgrounds.                                                                                                                                                                                                                           |
| `--accent-ink`             | `#ffffff`             | kept        | Text on `--accent`.                                                                                                                                                                                                                         |
| `--accent-strong`          | `#a93a15`             | kept        | Accent-coloured **text**. Never use `--accent` for type.                                                                                                                                                                                    |
| `--heat-0` … `--heat-5`    | `#f1e8db` → `#b8431c` | kept        | The ramp. Single hue climbing in lightness and saturation.                                                                                                                                                                                  |
| `--void` / `--void-stripe` | `#e9e0d2` / `#d8cbb8` | kept        | A wall-clock time that does not exist in this zone.                                                                                                                                                                                         |
| `--positive`               | `#2f7d5f`             | kept        |                                                                                                                                                                                                                                             |
| `--caution`                | `#a9722a`             | kept        |                                                                                                                                                                                                                                             |
| `--danger`                 | `#b3392a`             | kept        |                                                                                                                                                                                                                                             |
| `--scrim`                  | `rgb(74 38 20 / 44%)` | **changed** | Was `rgb(24 19 16 / 45%)`, which composites over paper to a flat `#959188` — a dead grey that erased the palette behind every dialog (audit V1). Tinted toward clay so the world behind a modal stays warm.                                 |
| `--disabled-surface`       | `#efe7dc`             | **new**     | A control that is waiting, not broken. Replaces `opacity: 0.5` (audit V4).                                                                                                                                                                  |
| `--disabled-ink`           | `#6f665c`             | **amended** | 4.59:1 on `--disabled-surface`, measured. Was `#9a8e81`, whose note claimed 4.6:1 and is actually **2.61:1** — unreadable on the disabled submit button a first-time visitor looks at before typing anything.                               |
| `--daylight-night`         | `#a7a0b4`             | **amended** | Signature rail, 20:00–05:00.                                                                                                                                                                                                                |
| `--daylight-dawn`          | `#f3bd83`             | **amended** | 05:00–08:00.                                                                                                                                                                                                                                |
| `--daylight-noon`          | `#ffdf9e`             | **amended** | 08:00–17:00. Was `#fff6e0`, which is a near-white cream: on the white grid panel the rail vanished entirely for any room inside working hours — which is most rooms. The signature element cannot only appear for rooms that run overnight. |
| `--daylight-dusk`          | `#d59583`             | **amended** | 17:00–20:00.                                                                                                                                                                                                                                |

### 3.2 Colour — dark

Dark mode is a rebalance, not an inversion. The heat ramp climbs from near-background to bright
so the busiest cells stay the loudest. All light-mode tokens are redefined; the ones that differ
in kind:

| Token                                                                                | Value                                                     |         |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------- | ------- |
| `--paper` / `--surface` / `--surface-sunken` / `--surface-raised`                    | `#171310` / `#211c18` / `#12100e` / `#292320`             | kept    |
| `--ink` / `--ink-soft` / `--ink-faint` / `--ink-inverse`                             | `#f2eae0` / `#b5a99c` / `#9c9086` / `#171310`             | kept    |
| `--accent` / `--accent-hover` / `--accent-soft` / `--accent-ink` / `--accent-strong` | `#f0784e` / `#f68b64` / `#331e15` / `#1a1310` / `#f89066` | kept    |
| `--heat-0` … `--heat-5`                                                              | `#241e1a` → `#ee8b45`                                     | kept    |
| `--scrim`                                                                            | `rgb(0 0 0 / 62%)`                                        | **new** |
| `--disabled-surface` / `--disabled-ink`                                              | `#2b2521` / `#9c9086`                                     | **new** |
| `--daylight-night` / `--dawn` / `--noon` / `--dusk`                                  | `#2a2733` / `#6b4a30` / `#8a7448` / `#55353a`             | **new** |

Both a `prefers-color-scheme` block and a `[data-theme='dark']` block define every one, so an
explicit choice wins in both directions and no token has its only definition inside a media
query.

### 3.3 Type

**No webfonts.** This is a decision, not an omission. Overlap is opened from a chat link, often
on mobile data, and often once. System stacks mean zero font requests, zero FOUT, zero
layout shift, and text on the first paint. A self-hosted display face would buy cross-platform
consistency and cost the thing the product is better off keeping. `font-display: swap` is
therefore not present anywhere and does not need to be — there is no web font to swap. If one is
ever added it must be self-hosted, preloaded, `display: swap`, and metric-matched with
`size-adjust` so this property survives.

| Token            | Value                                                                                              |                                                                                                                                                                                                                            |
| ---------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--font-display` | `ui-serif, Charter, 'Bitstream Charter', 'Iowan Old Style', Georgia, serif`                        | **changed** — narrowed from the old `--font-serif`. Charter first: it is present on both macOS and Windows and is far closer to Iowan than Georgia is, so the headline reads the same on both. Georgia stays as the floor. |
| `--font-sans`    | `ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif` | kept                                                                                                                                                                                                                       |
| `--font-mono`    | `ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace`                              | kept                                                                                                                                                                                                                       |

Scale — a modular ramp; `--text-hero` is the only fluid step:

| Token         | Size                                      | Use                                 |
| ------------- | ----------------------------------------- | ----------------------------------- |
| `--text-xs`   | `0.75rem`                                 | Eyebrows, chip labels, grid axis    |
| `--text-sm`   | `0.875rem`                                | Secondary text, hints, metadata     |
| `--text-base` | `1rem`                                    | Body, controls                      |
| `--text-lg`   | `1.125rem`                                | Lead paragraphs                     |
| `--text-xl`   | `1.375rem`                                | Card titles                         |
| `--text-2xl`  | `1.75rem`                                 | Section headings                    |
| `--text-3xl`  | `2.5rem`                                  | Page headings                       |
| `--text-hero` | `clamp(2.25rem, 1.4rem + 3.4vw, 3.75rem)` | **new** — the landing headline only |

Weights `--weight-regular 400`, `--weight-medium 500`, `--weight-semibold 600`, `--weight-bold 700`.
Tracking `--tracking-tight -0.02em` (display sizes), `--tracking-normal 0`, `--tracking-wide 0.08em`
(all-caps eyebrows only). Leading `--leading-tight 1.15`, `--leading-snug 1.35`,
`--leading-normal 1.55`.

**Numbers that can be compared are `font-variant-numeric: tabular-nums`,** without exception —
times, counts, durations, the participant list. A column of figures that shifts as it updates is
the cheapest possible tell that a product is unfinished.

### 3.4 Space, radius, elevation

Space is a 4px scale, kept as-is: `--space-1` `0.25rem` through `--space-8` `4rem`.

Radius: `--radius-xs 4px` (**new**, chips and swatches), `--radius-sm 6px`, `--radius-md 10px`,
`--radius-lg 16px`, `--radius-full 999px` — all kept.

Elevation is four named levels, not a free choice of shadow:

| Token                  | Shadow        | Use                                |
| ---------------------- | ------------- | ---------------------------------- |
| `--elevation-flat`     | `none`        | Anything sitting directly on paper |
| `--elevation-raised`   | `--shadow-sm` | Cards, panels                      |
| `--elevation-floating` | `--shadow-md` | Popovers, the share panel, toasts  |
| `--elevation-overlay`  | `--shadow-lg` | Dialogs only                       |

### 3.5 Motion

| Token              | Value                        | Use                           |
| ------------------ | ---------------------------- | ----------------------------- |
| `--motion-instant` | `90ms`                       | Press feedback, hover         |
| `--motion-quick`   | `160ms`                      | Colour and border transitions |
| `--motion-settle`  | `260ms`                      | Things entering or leaving    |
| `--motion-arrive`  | `420ms`                      | The orchestrated moment only  |
| `--ease-standard`  | `cubic-bezier(0.2, 0, 0, 1)` | Default                       |
| `--ease-enter`     | `cubic-bezier(0, 0, 0.2, 1)` | Appearing                     |
| `--ease-exit`      | `cubic-bezier(0.4, 0, 1, 1)` | Leaving                       |

No spring, no overshoot, no `infinite` outside a loading indicator. Every one of these is
neutralised under `prefers-reduced-motion: reduce`, which must remain a single global block —
never a per-component afterthought. That block zeroes **delays as well as durations**: zeroing
duration alone still lets a staggered sequence pop in element by element, which is exactly the
flicker the setting exists to prevent.

---

## 4. Component standards

Every interactive component defines all five of: **rest, hover, focus-visible, active,
disabled** — plus **loading** where it can trigger work. A component missing a state is
unfinished, not minimal.

**Focus is one thing everywhere:** `--focus-ring`, a double ring (paper then accent) so it is
visible on any surface. It is never removed, never replaced by a colour change alone, and
`:focus-visible` — not `:focus` — so a mouse press does not leave a ring behind.

### Buttons

Pill (`--radius-full`), `--weight-semibold`, `--text-base`, `--space-3` × `--space-5`.

- **Primary** — `--accent` fill, `--accent-ink` text. One per screen. This is the primary
  action from §10 of the audit and nothing else on the screen may look like it.
- **Secondary** — `--surface` fill, `--line-strong` border, `--ink` text.
- **Ghost** — transparent, `--ink-soft` text, for tertiary and icon actions.
- **Hover** darkens the fill by one step. **Active** is `translateY(1px)` — the only transform
  in the system.
- **Disabled** is `--disabled-surface` / `--disabled-ink`, never opacity. A disabled control
  should read as _waiting for you_, not as broken glass. `cursor: not-allowed`.
- **Loading** keeps the button's width, swaps the label for a label-plus-spinner, and sets
  `aria-busy`. It never collapses — a button that resizes mid-press moves the thing under the
  user's finger.
- An `<a>` that carries `.button` **must** reset `text-decoration`. This was audit finding V2.

### Inputs and selects

`--surface` fill, `--line-strong` border, `--radius-md`, `--text-base`, generous padding.
Hover lifts the border to `--ink-faint`. Focus applies `--focus-ring` and an `--accent` border.
Invalid gets `--danger` border **plus** a message — colour alone never carries meaning.
Every input has a real `<label>`; placeholder text is an example, never a label.

### Cards

`--surface`, `1px --line`, `--radius-lg`, `--elevation-raised`. Interactive cards raise to
`--elevation-floating` on hover and carry a full focus ring. A card is a container, not a
decoration: no card that holds a single line of text.

### Navigation

The room header is the only persistent chrome: sticky, `--paper` at 88% with a blur, one
hairline beneath. It holds identity (room name), state (connection), and the room's current
primary action — nothing else. **On mobile the room name outranks the wordmark** (audit F10).

### Tables and lists

Tabular figures, right-aligned numerics, `--line` row separators, no zebra striping — striping
is a crutch for rows that are too tall. Row hover is `--surface-sunken`.

### Modals

`--surface-raised`, `--radius-lg`, `--elevation-overlay`, over `--scrim` with a 6px blur.
Focus is trapped and returns to the trigger on close. `Escape` always closes — unless the dialog
is a required step in a flow, in which case there is no dismiss affordance at all rather than
one that silently fails. Dialog copy leads with a heading that says what is being asked.

### Toasts

`--elevation-floating`, bottom-centre on mobile, bottom-left on desktop. `role="status"`,
`aria-live="polite"`. They confirm; they never carry the only copy of an error, and they never
hold the only route to an action.

### The four states, on every data-bearing surface

- **Empty** — invites the first action _in the place the action happens_, not in a caption
  underneath it. An empty state that only explains is a failed empty state.
- **Loading** — a skeleton in the shape of the content that is coming, so nothing jumps when it
  lands. `--surface-sunken` blocks, a slow sheen, `aria-busy` on the region.
- **Error** — says what happened, in the user's terms, and what to do next. Always offers the
  next action as a control, never as instructions.
- **Success** — visible, brief, and warm. The end of a flow gets a moment; a routine save does
  not.

---

## 5. Voice and tone

Plain, warm, and unhurried. Write like a competent friend who has done this before and is not
making a fuss about it. Second person. Active voice. Sentence case everywhere — including
buttons, including headings.

| Register         | Rule                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Headings**     | A statement, not a label. "Find a time that works for everyone", not "Room setup".                                                                                                    |
| **Body**         | One idea per sentence. Explain the mechanic, never the implementation. The words "sync", "CRDT", "socket", "slot" and "session" never reach the user.                                 |
| **Buttons**      | A verb the user would use. An action keeps **exactly the same name** for its whole life — if it is "Share link" in the header it is "Share link" in the empty state, not "Copy link". |
| **Errors**       | What happened, then the fix, then the control that performs the fix. Never "Something went wrong". Never an error code alone.                                                         |
| **Empty states** | Invite, don't explain. One sentence, then the action.                                                                                                                                 |
| **Success**      | Short and warm. Never exclamation marks — warmth comes from word choice, not punctuation.                                                                                             |

### Three rewrites

**1. The grid instructions.** _(audit F5 — currently a 40-word paragraph of grey text below the
legend, where nobody reads it)_

> **Before:** "Drag to paint when you're free. Drag again over the same cells to clear them.
> Using a keyboard: Tab to the grid, arrow keys to move, Space to toggle, Shift with arrows to
> paint a block."
>
> **After:** In the empty grid, in place: **"Drag across the times you're free."** The keyboard
> instructions move into a "Keyboard shortcuts" disclosure next to the legend, closed by
> default, and are announced to screen readers regardless.

Why: the mouse instruction is one short sentence placed where the hand already is. The keyboard
instruction is essential to the people who need it and noise to everyone else, so it gets a
place rather than a paragraph.

**2. The not-found screen.** _(audit V2, F2)_

> **Before:** "This room isn't here. The link may be mistyped, or the room may have been swept
> after 60 days without any activity."
>
> **After:** "This link doesn't open a room. It may have been cut short when it was copied, or
> the room may have been cleared after 60 days of quiet. Starting a new one takes about ten
> seconds." — with **Start a new room** as a real primary button.

Why: "swept" is our vocabulary for our garbage collector. "Cut short when it was copied" names
the thing that actually happened to them. The last sentence lowers the cost of the only
remaining action, which is the whole job of this screen.

**3. The participant list.** _(audit F8)_

> **Before:** "Priya — 5 slots"
>
> **After:** "Priya — 2½ hours free"

Why: nobody planning dinner thinks in slots. It is the same number, rendered in the unit the
user came with.

---

## 6. Anti-patterns

This app must never look like, or read like, any of these. Each is a specific failure, not a
general caution.

1. **Purple-to-blue gradient heroes.** Overlap has a palette with an argument behind it.
2. **Inter for everything.** Or any single geometric grotesque doing display, body and data.
3. **Default blues and neutral greys.** No `#f5f5f5`, no `#e5e7eb`, no `#3b82f6`. Every neutral
   in this product is warm. The one grey that existed — the modal scrim — is fixed by this
   document.
4. **Generic three-across card grids** used as a substitute for saying something.
5. **Emoji as icons.** Also bare glyph arrows as button labels (`←`, `→` — audit V10):
   they carry a different baseline and weight in every fallback font.
6. **Vague error text.** "Something went wrong", "Oops!", "An error occurred", or a raw status
   code shown to a user.
7. **Colour as the only carrier of meaning.** Every state that has a colour also has a shape, an
   icon, or a word.
8. **`opacity` as a disabled state.** It is why the current primary buttons read as broken.
9. **Decorative motion.** Anything that loops, bounces, or animates on scroll for its own sake.
10. **Placeholder text used as a label.** It vanishes exactly when the user needs it.
11. **A second colour system competing with the heat ramp.** This is why direction C was cut.
    The grid plane belongs to density and nothing else.
12. **Skeleton loaders that do not match the shape of what loads.** A spinner where a grid is
    coming is a layout shift with extra steps.
