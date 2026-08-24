# Debug Report — report from the screen, verify, land (PR 1a)

**Goal:** A person who notices something wrong in the running app presses a
hotkey, points at it, says what is wrong in one sentence, collects a few more,
and hands the batch over once. An agent writes the issue text, proposes how the
batch splits into PRs, and — after the person confirms — verifies and lands each
one. The person supplies coordinates and curation; the agent supplies
translation, verification and assembly.

**Why now:** the tracker currently asks the reporter to do the translation too
(reproduction steps, file locations, labels), which costs more than the
observation did, so most observations are never filed at all. This is the
generalisation of what was planned as the design-editor's Phase 4 agent loop;
the design editor becomes the second `HostAdapter` host rather than the only one.

**Shape (from `~/.claude/plans/binary-enchanting-sparrow.md`):** SP0 spike
(done, throwaway) → SP1 in three PRs (1 client capture, 2 preview + draft, 3
intake → verify → PR) → SP1.5 auto-detection → SP2 deployed environment.
This task file covers **PR 1a**.

**SP0 findings that already changed the design** (measured on
`/harness/hunt?surface=sheet` and `/login`, 2026-08-21):

1. `elementsFromPoint` cannot find a canvas — both sheet canvases are
   `pointer-events: none` with events on the wrapper `div`, so a hit-test
   locator would have captured nothing on exactly the surfaces this feature
   exists for. The locator queries the DOM (`querySelectorAll('canvas')` + box
   containment) instead.
2. Two canvases share one box (grid + overlay), so a capture must **composite**
   the layers; one layer alone loses either the content or the selection.
3. `elementFromPoint` returns a glyph (`svg.lucide-sun` for the theme toggle),
   so a pick **promotes** to the nearest meaningful ancestor.
4. `pick` must not fall back to the DOM on a canvas surface — the promotion
   finds nothing and the capture becomes a 1280×721 photograph of the whole
   sheet, which does not say *which cell*.

## Tasks (PR 1a)

- [x] `docs/design/debug-report.md` (template format) + a row in
      `docs/design/README.md` + `harness-engineering.md` **Phase 32**.
- [x] `packages/debug-report/` — framework-agnostic core package:
      `package.json` / `tsconfig.json` / `vite.config.ts` (test runner only —
      no library build) / `README.md`, plus a row in `packages/README.md` and in
      the root `README.md`.
- [x] `src/types.ts` — `DebugItem` / `Target` / `Capture` / `Bundle` +
      `parseBundle` (fail-closed).
- [x] `src/session.ts` — the session singleton (`mode`, `items`, `subscribe`),
      no React state; pattern is `app/slides/zoom-controller.ts`.
- [x] `src/store.ts` — blobs in IndexedDB, metadata in `localStorage`, quota
      guard that evicts the oldest capture and reports what it dropped.
- [x] `src/host.ts` — the `HostAdapter` interface only (route / build SHA /
      theme / locator / `draft` / `send`).
- [x] Register `typecheck` + `test` in the root `verify:fast` and `test` scripts.

## Known gap carried into 1b

The IndexedDB backend itself is not covered by a unit test: jsdom has no
IndexedDB, and a hand-written fake would test the fake. What IS tested is
everything around it — eviction order, the oversized-capture refusal, eviction
reported on a failed write, reconciliation when a blob is missing or the store
is unreachable, and the memory fallback that a blocked profile gets. The real
database is proven by the browser lane and by the plan's manual check 2 (collect
12 items, reload, read what the quota guard says it dropped); wiring that into
`verify:browser` belongs with 1b, where the capture path — and therefore the
first real blob — lands.

## Deliberate deviation from the plan

The plan said to register the package in `scripts/verify-dts-entries.mjs`. It is
**not** registered, because that script checks the `dist/**/*.d.ts` graph of the
*published* engine packages and this package has no dist: like
`@wafflebase/design-editor` it exports `./src/index.ts` directly and reaches
production the same way `sheets`/`docs`/`slides` do — through the frontend's
source alias. Registering it would demand a build that exists only to satisfy
the gate. Recorded here rather than silently skipped.

## Tasks (PR 1b) — capture + locators

Requirements 1-3 below came out of driving the SP0 spike by hand on 2026-08-23,
after 1a landed; they are recorded in `docs/design/debug-report.md` as measured
findings 5-7. The first is a requirement the plan did not have.

- [ ] **State-preserving capture.** The trigger is a key (`c`), not a click, and
      the overlay observes the pointer PASSIVELY while idle — no
      `preventDefault`, no `stopPropagation` — so the app underneath keeps
      tracking hover and keeps a held drag. The key is intercepted at capture
      phase so nothing underneath sees it. Capture completes before the note
      field opens. Click-to-pick stays as a convenience path.
- [ ] **`region.ts` selects canvases that INTERSECT the rect**, not those
      containing its centre. Regression test uses the vertical-stack layout
      (`/harness/docs`, 12 canvases): a region crossing the seam must composite
      both pairs. Measured failure today: bottom third of the image black.
- [ ] **A DOM region records the DOM under it** — the meaningful elements
      intersecting the rect as a bounded list of selector + text excerpt.
      Measured failure today: `/login` yields an item with no capture, no
      selector, no text.
- [ ] `pick.ts` — promotion rule (SP0 finding 3), and NO container fallback on a
      canvas surface (SP0 finding 4): route to the engine locator, or degrade to
      a small automatic region around the cursor.
- [ ] `region.ts` — drag rectangle, canvas composite (SP0 finding 2), JPEG at
      1280 px max side. DOM is described, never photographed.
- [ ] `packages/frontend/src/debug/locators/{sheet,doc}.ts` — point → semantic
      address, reusing `parseRef` / `toSref` / `formatValue`; reader names mirror
      `app/harness/hunt/bridge.ts`.
- [ ] `hotkey.ts` — `Mod+Shift+Y`, avoiding the engine catalogs and the
      browser's reserved combos; one catalog line so the binding is a one-line
      change.
- [ ] Frontend alias for `@wafflebase/debug-report` (first importer appears
      here) + the DEV-gated mount.

### Deferred out of 1b, deliberately

- **Frozen frame.** Aiming at a tooltip rendered AWAY from the cursor still
  loses it, since moving the pointer is what destroys it. The fix is to snapshot
  every visible canvas and aim inside the snapshot; at DPR 2 with the 12
  canvases `/harness/docs` mounts, that is not cheap, and it is not the common
  case (usually the pointer is already on the thing).

## Carried into PR 2

- [ ] **Nothing is dropped in silence** (design doc section of the same name),
      unit-tested: cancelling drops the item and never the mode, an empty note
      is refused visibly, every capture eviction is named in the panel. Measured
      violations: the `window.prompt` the spike started with broke all three.

## Verification checklist

- [ ] The eight surfaces that open without a login, all confirmed to mount the
      overlay and take a capture (swept 2026-08-23):
      `/harness/hunt?surface={sheet,doc,slides,board}`, `/harness/docs`,
      `/harness/interaction`, `/harness/visual`, `/login`. Canvas counts differ
      (2 / 3 / 1 / 1 / 12 / 4 / 0 / 0), which is what makes the set worth
      keeping — the two zero-canvas routes are the DOM path.
- [ ] **Retina (DPR 2) capture size** — still unmeasured. At DPR 1 a 160×60
      region is 1-3 KB and a full 1280×721 screen is 81 KB; the quota guard is
      sized for the DPR 2 case but has not been checked against it.
- [ ] Pre-existing, unrelated, and worth its own report: `/harness/docs` throws
      `TypeError: s.destroy is not a function` three times on load with debug
      mode untouched. Exactly the class SP1.5's console-error detection is for.

## Out of scope for 1a

- Capture, locators, hotkey (PR 1b) and the preview panel, drafting and PR
  grouping proposals (PR 2) — no React lands in this PR.
- The `packages/frontend` alias and mount: added by 1b/2, where the first
  import appears. An alias with no importer is dead config.
- Anything in `scripts/agent/` (PR 3), auto-detection (SP1.5) and the backend
  mailbox (SP2).
- `packages/design-editor` — another session is working in it; the host adapter
  for it waits until that lands.
