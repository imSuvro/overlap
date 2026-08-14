# Overlap — UI/UX overhaul report

Branch `feature/ui-overhaul`, cut from `develop` at `ec59adf`. Ten commits, one per phase.

The app's behaviour was already finished and tested. This pass changed how it looks, how it
reads, and what it does when things go wrong — plus four defects that only became visible once
somebody looked at every screen in every state.

- **The contract:** [`DESIGN.md`](../DESIGN.md)
- **What was wrong:** [`AUDIT.md`](AUDIT.md)
- **Decisions and dead ends:** [`NOTES.md`](NOTES.md)
- **Evidence:** [`audit/before/`](audit/before/) · [`audit/after/`](audit/after/)

Both screenshot sets come from the same committed harness
([`design/capture.spec.ts`](capture.spec.ts)), same viewports, same pinned timezone. The *before*
set was re-shot from the base commit after the harness changed, so the pair is one camera, not
two.

```bash
npx playwright test --config design/capture.config.ts
```

---

## 1. Before and after, screen by screen

Each row links all three widths: **1440**, **768**, **360**.

### The landing page

| | Before | After |
|---|---|---|
| Untouched | [desktop](audit/before/01-landing-empty--desktop.png) · [tablet](audit/before/01-landing-empty--tablet.png) · [mobile](audit/before/01-landing-empty--mobile.png) | [desktop](audit/after/01-landing-empty--desktop.png) · [tablet](audit/after/01-landing-empty--tablet.png) · [mobile](audit/after/01-landing-empty--mobile.png) |
| Part-filled | [desktop](audit/before/02-landing-filled--desktop.png) · [tablet](audit/before/02-landing-filled--tablet.png) · [mobile](audit/before/02-landing-filled--mobile.png) | [desktop](audit/after/02-landing-filled--desktop.png) · [tablet](audit/after/02-landing-filled--tablet.png) · [mobile](audit/after/02-landing-filled--mobile.png) |

**Before:** a 1,500px configuration form wearing a headline. The product it sells — a block of
time darkening where a group agrees — appeared nowhere. The primary action sat roughly 1,200px
below the fold, rendered at half opacity so it read as unavailable rather than waiting.

**After:** the hero shows a worked example of the heatmap, built from the same tokens the real
grid uses so it cannot drift from what it advertises, next to a headline, a sentence naming who
this is for, and a button. The setup form follows, with a heading of its own. The calendar is
capped so the month is no longer the loudest thing on a page whose subject is not the month.

### The room

| | Before | After |
|---|---|---|
| Name prompt | [desktop](audit/before/03-room-name-prompt--desktop.png) · [tablet](audit/before/03-room-name-prompt--tablet.png) · [mobile](audit/before/03-room-name-prompt--mobile.png) | [desktop](audit/after/03-room-name-prompt--desktop.png) · [tablet](audit/after/03-room-name-prompt--tablet.png) · [mobile](audit/after/03-room-name-prompt--mobile.png) |
| Empty room | [desktop](audit/before/08-room-empty--desktop.png) · [tablet](audit/before/08-room-empty--tablet.png) · [mobile](audit/before/08-room-empty--mobile.png) | [desktop](audit/after/08-room-empty--desktop.png) · [tablet](audit/after/08-room-empty--tablet.png) · [mobile](audit/after/08-room-empty--mobile.png) |
| Others have painted | [desktop](audit/before/04-room-others-only--desktop.png) · [tablet](audit/before/04-room-others-only--tablet.png) · [mobile](audit/before/04-room-others-only--mobile.png) | [desktop](audit/after/04-room-others-only--desktop.png) · [tablet](audit/after/04-room-others-only--tablet.png) · [mobile](audit/after/04-room-others-only--mobile.png) |
| You have painted | [desktop](audit/before/05-room-painted--desktop.png) · [tablet](audit/before/05-room-painted--tablet.png) · [mobile](audit/before/05-room-painted--mobile.png) | [desktop](audit/after/05-room-painted--desktop.png) · [tablet](audit/after/05-room-painted--tablet.png) · [mobile](audit/after/05-room-painted--mobile.png) |
| A time is pinned | [desktop](audit/before/06-room-pinned--desktop.png) · [tablet](audit/before/06-room-pinned--tablet.png) · [mobile](audit/before/06-room-pinned--mobile.png) | [desktop](audit/after/06-room-pinned--desktop.png) · [tablet](audit/after/06-room-pinned--tablet.png) · [mobile](audit/after/06-room-pinned--mobile.png) |
| Dark mode | *not captured* | [desktop](audit/after/10-room-dark--desktop.png) · [tablet](audit/after/10-room-dark--tablet.png) · [mobile](audit/after/10-room-dark--mobile.png) |

**The empty room was the worst screen in the product.** The first person into a room — including
the host, immediately after creating one — saw a silent beige lattice with the only instruction
in small grey text *below* the legend. It now invites the first drag in the middle of the grid,
and because an empty room is an invitation problem rather than a scheduling one, sharing the
link is the visually dominant action until somebody else arrives.

**The name prompt** was rendered over a flat `#959188` — a dead grey produced by compositing a
near-black scrim over cream paper, erasing the entire palette behind the first screen every
invitee sees. The scrim is now tinted toward clay. Its heading also stranded a closing quote on
its own line for any room name of ordinary length; the name is now its own line under an
eyebrow.

**Dark mode is new evidence, not new code** — it existed and was never photographed. The
capture now proves the ramp still climbs from near-background to bright, which is the whole
reason dark mode is a rebalance rather than an inversion.

### When something is wrong

| | Before | After |
|---|---|---|
| Room not found | [desktop](audit/before/07-room-missing--desktop.png) · [tablet](audit/before/07-room-missing--tablet.png) · [mobile](audit/before/07-room-missing--mobile.png) | [desktop](audit/after/07-room-missing--desktop.png) · [tablet](audit/after/07-room-missing--tablet.png) · [mobile](audit/after/07-room-missing--mobile.png) |
| Link cut short | [desktop](audit/before/09-link-malformed--desktop.png) · [tablet](audit/before/09-link-malformed--tablet.png) · [mobile](audit/before/09-link-malformed--mobile.png) | [desktop](audit/after/09-link-malformed--desktop.png) · [tablet](audit/after/09-link-malformed--tablet.png) · [mobile](audit/after/09-link-malformed--mobile.png) |

Compare the *link cut short* pair directly. Before, it is the landing page — because it **was**
the landing page. A room id that failed validation was indistinguishable from no room id at all,
so a link truncated on its way through a chat app silently offered to create a new room, and the
person who followed it believed they were already in their group's. It now says what happened.

---

## 2. Changes by phase

### P0 — Reconnaissance ([`64b5d38`](../../commit/64b5d38))

Walked nine screens at three widths with a committed harness. Wrote `AUDIT.md`: screen and state
inventory, four-state coverage table, ten visual inconsistencies with file and line, ten ranked
UX frictions, and a line-by-line account of where the three-second test failed.

### P1 — Product framing ([`bfa67b0`](../../commit/bfa67b0))

Named the target user (the person who got stuck organising something they did not volunteer
for), the core problem, and one primary action per screen. The room turned out to have three
across its life — share, paint, pin — presented with equal weight at all times, which became the
largest single UX change in the pass.

### P2 — Design lock ([`5f6ba69`](../../commit/5f6ba69), no implementation)

Three directions developed and self-critiqued; **Density** selected — the interface is a warm
instrument and availability density is the only saturated colour in the product, so the heat ramp
*is* the brand. **Daylight** was cut as a whole because a diurnal wash under the grid breaks the
one reason the ramp exists, but its insight was promoted to the signature element. `DESIGN.md`
locks tokens, four elevation levels, motion, a five-state component contract, a voice guide with
three rewrites, and twelve anti-patterns.

One amendment since ([`0e020f5`](../../commit/0e020f5)): the daylight rail's noon band was a
near-white cream and vanished on the white grid panel for any room inside working hours — most
rooms. The signature element cannot only appear for rooms that run overnight.

### P3 — Foundations ([`463c69c`](../../commit/463c69c))

Tokens for the layers that were missing: fluid hero step, weight/tracking/leading scales, named
elevation, motion durations and easings, daylight. Primitives refitted with rest, hover,
focus-visible, active, disabled and loading, plus skeleton and empty-state patterns.

### P4 — Screen overhaul ([`8b7d848`](../../commit/8b7d848))

Every route rebuilt on tokens and primitives; microcopy, motion and accessibility passes; the
daylight rail shipped.

### P5 — QA ([`9dcebc8`](../../commit/9dcebc8), [`af09c57`](../../commit/af09c57))

Per-route smoke coverage, both screenshot sets re-shot at 360, and the flaky-test investigation
that turned out to be a real defect (§4).

---

## 3. Defects found and fixed

Six, four of which were invisible until every state was examined.

| | Defect | Consequence |
|---|---|---|
| 1 | **A truncated room link rendered the landing page in silence.** `roomIdFromLocation` returned `null` for both "no room" and "invalid room", and the router had no third case. | Someone following a link cut short by a chat app believed they were in their group's room and started building a second one. |
| 2 | **The not-found screen reopened a WebSocket against a 404 forever.** Absence was inferred from a socket that had not connected within four seconds, and nothing ever stopped the client. | A console error on every backoff tick for as long as the tab stayed open. |
| 3 | **The offline banner shifted the page on every room load.** It keyed on `status === 'offline'`, and status starts at `offline` before the first connection. It also blinked out on each reconnection attempt, because a retrying client flips to `connecting`. | A layout shift on load, and a grid that jumped two rows mid-drag whenever the network wobbled. |
| 4 | **The invitation panel moved the grid when someone else joined.** It sat above the grid and disappeared on a purely remote event. | A drag in progress finished two rows from where it started and painted the wrong cells. |
| 5 | **Presence labels could be blank, and never updated on rename.** The server stamps a name onto a presence record when that participant's first cursor arrives; a cursor that beats its own owner's name op leaves an unlabelled arrow. | Anonymous cursors; renaming yourself never reached anyone else's screen. |
| 6 | **`<a class="button">` inherited the link underline**, and disabled controls used `opacity: 0.5`. | The only action on the not-found screen looked broken, and every disabled primary read as broken glass rather than as a control waiting for input. |

Defects 3 and 4 presented as intermittent test failures. They were attributed by running the
same spec against the pre-overhaul client — 12/12 green — which proved the regression was in this
branch rather than a pre-existing race. Both are now guarded by a smoke test that joins a second
person and asserts the grid's bounding box has not moved.

---

## 4. Test results

Evidence from the current working tree, not from memory.

| Suite | Count | Result |
|---|---|---|
| Unit and integration (`pnpm test`) | 194 across 13 files | pass |
| End to end (`pnpm test:e2e`) | 38 across 7 specs | pass |
| Consecutive full E2E runs | 4 | all green |
| Lint (`eslint . --max-warnings 0`) | — | clean |
| Typecheck (all projects) | — | clean |
| Build (`pnpm build`) | web + Worker dry-run | clean |

Started at 212 tests (181 + 31); now 232.

**New coverage**

- `e2e/smoke.spec.ts` — one test per route: it loads, its load-bearing elements are present,
  the console is clean, and the page does not scroll sideways at 360, 768 or 1440. Plus the
  layout-stability guard.
- `e2e/room.spec.ts` — a truncated link shows the broken-link screen and, specifically, does
  **not** become the create-a-room page.
- `apps/web/src/lib/duration.test.ts` (6) — every quarter-hour fraction each slot size can
  produce, and the singular/plural boundary at exactly one hour.
- `apps/web/src/lib/daylight.test.ts` (7) — band boundaries, and the wrap for a grid whose rows
  cross midnight.

**Accessibility.** The existing axe-core checks on the landing page and the room still pass, and
keyboard completion of a room is still covered end to end. Contrast was designed against the
locked tokens: disabled ink is 4.6:1 on the disabled surface, and presence chips now ring the
participant's colour rather than filling it — a generated hue cannot carry a contrast guarantee,
since yellow and blue at equal lightness differ four-fold in luminance, and white-on-hue was
failing AA across part of the wheel.

**One console entry survives, deliberately.** The not-found screen probes `GET /api/rooms/:id`
and Chrome logs a resource-level error for the 404 — which is the correct API answer for a room
that is genuinely gone. The smoke spec classifies these separately from script errors and
asserts **exactly one** on that screen, so a retry loop would still fail the test. It is not
filtered away silently. Removing it altogether means changing the API to answer `200` with
`{ found: false }`, which is a contract change and is listed below rather than done.

---

## 5. Definition of done

| | |
|---|---|
| Every core journey has a Playwright spec; 3 consecutive green runs | ✅ 4 consecutive, 38 tests |
| Zero console errors or warnings on any route | ⚠️ see the deliberate exception above — asserted, not filtered |
| 100% of screens derive from the token system | ✅ 11 inline styles remain, all dynamic geometry or generated data (canvas metrics, cell rects, stagger delays, participant hue); zero static values. One hex remains, `FALLBACK = '#cccccc'` in `palette.ts`, which exists for the case where the stylesheet failed to load and so cannot itself be a token |
| 3-second test passes from the entry screenshot alone | ✅ headline, audience sentence, worked example and primary action all above the fold |
| Four states on every data-bearing screen | ✅ empty, loading (skeleton), error (gone / unreachable / broken link), success |
| AA contrast, keyboard, visible focus, reduced motion | ✅ axe clean; one global reduced-motion block; `:focus-visible` never removed |
| `REPORT.md` with before/after pairs per screen | ✅ |
| No functional regressions | ✅ full suite green; three assertions updated to follow copy that changed on purpose |

---

## 6. PENDING — awaiting a decision

Surfaced rather than guessed, per the brief. None is implemented.

**P-1 — A dedicated share step after room creation.** *Create the room* still hard-navigates
into the room, where the next thing is a modal asking for a name; the host never gets a moment
that says "here is your link". This pass shipped the non-flow-changing half — the in-room
invitation is dominant while you are alone. A real interstitial adds a screen to the critical
path and delays first paint of the grid. Option C would skip the name prompt for the host, who
has already typed the room title, and ask for their name inline instead.

**P-2 — Letting people see a room before naming themselves.** The name prompt is a hard gate.
Keeping it means every mark belongs to a named person and the participant list is never full of
anonymous entries; removing it means an invitee can check they have the right room before
committing. Changing it touches the identity model in `useRoom`/`RoomClient`, not just
presentation.

**P-3 — Answering "room not found" with `200 { found: false }`.** Would remove the last console
entry on the not-found screen. It is an API contract change, and arguably a worse API: a 404 is
the honest status code for a resource that is not there.

---

## 7. Recommended next, out of scope here

1. **A visual regression gate.** The harness already produces a deterministic screenshot set;
   wiring it to a pixel-diff check in CI would catch the class of bug this pass found by eye.
2. **A layout-stability budget.** The two worst defects were both unrequested layout shifts.
   Measuring CLS in the smoke spec, rather than asserting one bounding box, would generalise the
   guard.
3. **`prefers-contrast: more`.** The heat ramp is deliberately low-contrast at its pale end;
   a high-contrast variant would help without compromising the default ranking.
4. **A dark-mode axe pass.** Contrast was verified against the light palette; the dark tokens
   are photographed but not asserted.
5. **Reduce the aside's emptiness in a fresh room.** With one participant and no marks, the right
   rail carries an invitation and two near-empty panels. Worth revisiting once P-1 is decided,
   since the answer depends on it.
