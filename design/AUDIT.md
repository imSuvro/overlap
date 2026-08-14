# Overlap — design audit

Captured against `feature/ui-overhaul` at its base commit (`ec59adf`), by walking the running
app with Playwright rather than by reading the source and imagining the result. Every claim
below has a screenshot behind it in [`design/audit/before/`](audit/before/).

- **Harness:** [`design/capture.spec.ts`](capture.spec.ts) + [`design/capture.config.ts`](capture.config.ts)
- **Command:** `npx playwright test --config design/capture.config.ts`
- **Widths:** 1440 (desktop), 768 (tablet), 390 (mobile) — full-page, three per screen
- **Timezone:** pinned to `America/New_York` so the captured grid is reproducible

---

## 1. What the app is, technically

| | |
|---|---|
| **Stack** | React 19 + TypeScript, Vite 6, pnpm workspaces |
| **Styling** | Hand-written CSS: `styles/tokens.css` (custom properties) + `styles/global.css` (882 lines, BEM-ish class names). No CSS framework, no CSS-in-JS. |
| **Routing** | None. `App.tsx` reads `location.pathname`; two views. |
| **Existing tokens** | Yes — a real, thoughtful partial system. See §6. |
| **Fonts** | System stacks only (`ui-serif, Georgia…` / `ui-sans-serif, system-ui…`). No webfont requests, so no FOUT and no CLS today. |
| **Dark mode** | Implemented, via `prefers-color-scheme` and a `[data-theme]` override. |
| **Reduced motion** | Honoured — `global.css:68`. |

**Branch convention** (from `git log` / `git branch -a`): `feature/*`, `fix/*`, `docs/*`,
`chore/*`, `release/*` cut from `develop`; Conventional Commits; PR-only merges into protected
branches. This work sits on `feature/ui-overhaul`.

---

## 2. User journeys

There are only two, and the second is the product.

**J1 — Host: I need to find a time.**
Land on `/` → type what you're planning → pick days on a month calendar → set an hour range and
block size → *Create the room* → land in the room → name yourself → share the link.

**J2 — Invitee: someone sent me a link.**
Open `/r/:roomId` → (brief load) → name yourself → paint your free hours by dragging → watch
other people's availability darken the grid → someone pins a time.

Both journeys converge on the same screen. Everything the product promises happens there.

---

## 3. Screen and state inventory

| # | Screen / state | Route | Reached by | Captured |
|---|---|---|---|---|
| 01 | Landing, untouched | `/` | first visit | ✅ |
| 02 | Landing, part-filled | `/` | typing a title, changing hours | ✅ |
| 03 | Name prompt | `/r/:id` | arriving without a stored name | ✅ |
| 04 | Room, others have painted, you have not | `/r/:id` | joining a busy room | ✅ |
| 05 | Room, you have painted | `/r/:id` | dragging on the grid | ✅ |
| 06 | Room, a time is pinned | `/r/:id` | *Pin this time* | ✅ |
| 07 | Room not found | `/r/<valid-but-unknown>` | expired or wrong id | ✅ |
| 08 | Room, completely empty | `/r/:id` | being the first to arrive | ✅ |
| 09 | Mangled link | `/r/nosuchroomatall` | truncated/typo'd id | ✅ |
| — | Room loading | `/r/:id` | slow network | ⚠️ not designed (see F4) |
| — | Offline / reconnecting | `/r/:id` | losing the network | ⚠️ badge only |
| — | Landing submit error | `/`, on POST failure | server 5xx | ⚠️ one red line |

**Four states on every data-bearing screen — current coverage:**

| Screen | Empty | Loading | Error | Success |
|---|---|---|---|---|
| Landing | n/a | ❌ none | ⚠️ bare red text | ⚠️ full navigation, no confirmation |
| Room grid | ❌ **undesigned** | ⚠️ text line | ❌ none | ✅ heatmap |
| Best times | ✅ has a sentence | ❌ none | ❌ none | ✅ ranked cards |
| Participants | ⚠️ "nothing yet" | ❌ none | ❌ none | ✅ list |

---

## 4. Console output

Captured across all nine screens into [`audit/before/console.json`](audit/before/console.json).

**Eight of nine screens: clean.**

**One is not.** On the *room not found* screen, three errors:

```
WebSocket connection to 'ws://…/api/rooms/zzzzzzzzzzzzzzzzzzzzzz/socket' failed:
Error during WebSocket handshake: Unexpected response code: 404
```

The client keeps trying to open a socket to a room the API has already answered `404` for, and
retries on a backoff — forever, as long as the tab is open. This is a functional defect, not a
cosmetic one, and it blocks the "zero console errors" bar outright.

---

## 5. Visual inconsistencies

Ranked by how loudly they read as unfinished.

**V1 — The modal scrim is dead grey.** `global.css:806` sets `rgb(24 19 16 / 45%)`. Composited
over the cream paper that produces roughly `#959188` — a flat, cold grey that erases the entire
warm palette behind it. The name prompt is the first screen every invitee sees, and it looks
like a different application. *(`03-room-name-prompt--desktop.png`)*

**V2 — An anchor styled as a button is underlined.** `global.css` has no `a` reset and `.button`
never sets `text-decoration`, so `<a className="button">Start a new room</a>`
(`RoomView.tsx:59`) renders with a full underline through it. It reads as broken.
*(`07-room-missing--desktop.png`)*

**V3 — The grid leaves ~44% of its panel empty.** `MAX_COLUMN_WIDTH = 132` (`layout.ts:40`) caps
a four-day grid at ~588px, but the panel is ~1046px wide and the grid is left-aligned inside it.
The cap is right; the alignment is not. *(`05-room-painted--desktop.png`)*

**V4 — Disabled primaries look broken rather than waiting.** `.button:disabled` is
`opacity: 0.5`, which turns the terracotta CTA into a washed pink lozenge. It is the largest
element on both the landing form and the name prompt at the moment of first sight.

**V5 — One hardcoded colour.** `global.css:661` — `color: #fff`.

**V6 — Twenty inline `style={{…}}` sites.** Roughly half are legitimately dynamic (canvas
metrics, cursor translation, heat-ramp step, per-participant hue) and will stay. The rest are
static styling that escaped the stylesheet: `Chrome.tsx:72,131`, `Landing.tsx:149,161`,
`RoomView.tsx:41,52,55`, `BestWindows.tsx:100`, `AvailabilityGrid.tsx:618,621`.

**V7 — One breakpoint for the whole app.** `@media (min-width: 60rem)` is the only layout query
(`global.css:421`). Between 768 and 960 the room renders its mobile stack at desktop width, so
the tablet capture is a narrow column adrift in whitespace.

**V8 — Past dates outweigh future ones.** In the month picker, disabled past days render nearly
white while selectable future days are beige. The unusable half of the calendar is visually
lighter and *more* inviting than the usable half.

**V9 — Selected dates are solid alarm-red.** Full `--accent` fill at full saturation across a
block of days reads closer to an error than a choice.

**V10 — Bare glyph arrows.** `←` and `→` as button text (`Landing.tsx:157,171`) — different
metrics and baseline in every font stack the app falls back through.

---

## 6. Gray area: there is already a design system

`tokens.css` is not scaffold output. It is a deliberate, documented system — warm paper
surfaces, a terracotta accent, a single-hue heat ramp chosen so the busiest cell is the loudest
thing on screen, and two contrast corrections with the failing ratios written into the comments.
It also already covers dark mode and reduced motion.

**Per the "propose migration, don't silently replace" rule: I am extending it, not replacing
it.** The palette, the heat ramp, the wordmark (`Chrome.tsx:7`) and the favicon are brand
assets and they stay. What is missing is not taste — it is *coverage*: no elevation discipline,
no motion tokens, no state patterns, thin type scale, and no component contract. That is what
Phase 2 adds.

Recorded as a decision in [`NOTES.md`](NOTES.md).

---

## 7. Top 10 UX frictions, ranked by user impact

**F1 — An empty room tells you nothing.** *(`08-room-empty--desktop.png`)*
The first person into a room sees a silent beige lattice. The only instruction is a small
grey sentence *below* the grid, after the legend. Nothing invites the drag that the entire
product is built around. This is the single highest-impact failure in the app: the host arrives
here immediately after creating a room, and the invitee arrives here whenever they're first.

**F2 — A mangled link dead-ends on the landing page.** *(`09-link-malformed--desktop.png`)*
`roomIdFromLocation` (`api.ts:70`) validates the id against `roomIdSchema` and returns `null`
when it fails, so `App.tsx` renders `<Landing />`. A truncated link pasted out of a chat app
silently becomes "create a new room" — the user believes they're in their friend's room and
starts building a second one. No message, no explanation.

**F3 — Nothing confirms the room was created.** After *Create the room* the app hard-navigates
into the room, where the very next thing is a modal demanding a name. The host never sees "here
is your link, send it to people" — which is the entire point of having made a room. Sharing is
demoted to a header button they have to notice on their own.

**F4 — The load state is a bare line of text.** `RoomView.tsx:41` renders the wordmark and
"Opening the room…" centred on an empty page. No skeleton of the grid that's coming, so the
layout snaps into place when data lands.

**F5 — Instructions are a paragraph, and they're at the bottom.** `RoomView.tsx:200` puts
mouse *and* keyboard instructions into one 40-word block of small grey text below the legend.
It reads like a manual, and it is placed where nobody reads.

**F6 — "Pin this time" appears three times with equal weight.** Three stacked cards, three
identical buttons. The top card is tinted, but nothing states it's the recommendation, so the
choice looks like three equal options rather than one suggestion with runners-up.

**F7 — The room title doesn't look editable.** `RoomView.tsx:87` is a real `<input>` styled to
look like a heading, with no border, no hover affordance and no hint. Hosts don't discover it;
anyone who clicks it by accident can rename a shared room without meaning to.

**F8 — "5 slots" is internal vocabulary.** `ParticipantList` counts in *slots*. Nobody planning
dinner thinks in slots. "2½ hours" or "5 half-hours" is the same information in the user's units.

**F9 — Offline is a badge and nothing else.** The copy is genuinely good — "Offline — 3 changes
saved here" — but it lives in a small pill in the header. The one moment the app most needs to
be believed is the one moment it whispers.

**F10 — Long titles truncate to nothing on mobile.** *(`05-room-painted--mobile.png`)*
"Design review with the wh…" — the header gives the wordmark equal billing with the room name,
so the thing you're actually looking at loses.

---

## 8. Where the 3-second test fails

> *A screenshot of the entry screen alone must answer: what does this do, who is it for, what do
> I do first.*

Current entry screen: `01-landing-empty--desktop.png`.

| Question | Answered? | |
|---|---|---|
| What does it do? | **Partly** | The headline says "Find a time that works for everyone" and the subtitle explains the mechanic in words. But the page never *shows* the thing it sells. The overlap heatmap — the one image that would explain this product instantly and distinguish it from every other scheduling tool — appears nowhere before the fold, or indeed anywhere on the landing page. |
| Who is it for? | **No** | Nothing signals whether this is a consumer tool for friends or an enterprise scheduler. "Team retro, dinner with friends, standup…" in the placeholder is the only hint, and placeholder text is not a positioning statement. |
| What do I do first? | **No** | Above the fold you get a headline, a subtitle, and one empty text field. The primary action — *Create the room* — is roughly **1,200px below the fold**, and it is rendered disabled and washed-out, which reads as unavailable rather than waiting. |

**The verdict:** the landing page is a 1,500px-tall configuration form wearing a headline. It
asks for setup before it has earned any belief that the setup is worth doing. The three
explainer cards that would carry the argument are *below* the form they're meant to justify.

The room screen, by contrast, is close to passing already — the heatmap does explain itself.
The product's best asset is hidden behind its worst screen.
