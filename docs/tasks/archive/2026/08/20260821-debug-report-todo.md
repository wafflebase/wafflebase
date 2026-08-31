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

- [x] **State-preserving capture.** The trigger is a key (`c`), not a click, and
      the overlay observes the pointer PASSIVELY while idle — no
      `preventDefault`, no `stopPropagation` — so the app underneath keeps
      tracking hover and keeps a held drag. The key is intercepted at capture
      phase so nothing underneath sees it. Capture completes before the note
      field opens. Click-to-pick stays as a convenience path.
- [x] **`capture.ts` selects canvases that INTERSECT the rect**, not those
      containing its centre. Regression test uses the vertical-stack layout
      (`/harness/docs`, 12 canvases): a region crossing the seam must composite
      both pairs. Measured failure today: bottom third of the image black.
- [x] **A DOM region records the DOM under it** — the meaningful elements
      intersecting the rect as a bounded list of selector + text excerpt.
      Measured failure today: `/login` yields an item with no capture, no
      selector, no text.
- [x] `pick.ts` — promotion rule (SP0 finding 3), and NO container fallback on a
      canvas surface (SP0 finding 4): route to the engine locator, or degrade to
      a small automatic region around the cursor.
- [x] `capture.ts` — drag rectangle, canvas composite (SP0 finding 2), JPEG at
      1280 px max side. DOM is described, never photographed.
- [x] `packages/frontend/src/debug/locators/{sheet,doc}.ts` — point → semantic
      address, reusing `parseRef` / `toSref` / `formatValue`; reader names mirror
      `app/harness/hunt/bridge.ts`.
- [x] `hotkey.ts` — `Mod+Shift+Y`, avoiding the engine catalogs and the
      browser's reserved combos; one catalog line so the binding is a one-line
      change.
- [x] Frontend alias for `@wafflebase/debug-report` (first importer appears
      here) + the DEV-gated mount.

### Deferred out of 1b, deliberately

- **Frozen frame.** Aiming at a tooltip rendered AWAY from the cursor still
  loses it, since moving the pointer is what destroys it. The fix is to snapshot
  every visible canvas and aim inside the snapshot; at DPR 2 with the 12
  canvases `/harness/docs` mounts, that is not cheap, and it is not the common
  case (usually the pointer is already on the thing).

## Carried into PR 2

- [x] **Nothing is dropped in silence** — landed with the note field in 1b
      rather than waiting for the panel, because a captured target cannot be
      stored without a sentence and the rules govern whichever surface takes
      it. PR 2's panel inherits them; what it adds is eviction reporting for
      items already collected.
      The rules (design doc section of the same name) are unit-tested in
      `packages/debug-report/src/ui/overlay.test.tsx`: cancelling drops the item
      and never the mode, an empty note is refused visibly, and a browser that
      refuses persistent storage says so. Measured violations they exist for:
      the `window.prompt` the spike started with broke all three at once.

## Tasks (PR 2) — preview, drafting, dev transport

- [x] `src/bundle.ts` — assemble what crosses the boundary; discarded items and
      the groups naming them are filtered out together, so an approved shape can
      never name something that is not being sent.
- [x] `src/draft.ts` — `DRAFT_SCHEMA`, fail-closed `parseDraftResult` (a bad
      SHAPE is rejected whole; one hallucinated item id is dropped and
      reported), the grouping rules, the reporter's three operations, and the
      per-session PR cap.
- [x] `packages/debug-report/src/plugin/report-endpoint.ts` —
      `POST /__wb_debug_report` writing `.wb-reports/<session>/`, with a capture
      id that is not a plain filename REFUSED rather than sanitised.
- [x] `packages/debug-report/src/plugin/draft-endpoint.ts` — the drafting call.
      No `tools` parameter at all.
- [x] `packages/debug-report/src/ui/handover.ts` — request drafts, degrade when
      there is no credential, send with the captures read back out of the store.
- [x] `packages/debug-report/src/ui/panel.tsx` — the preview panel: editable
      sentences and drafts, thumbnails (the consent gate), disposition,
      `agent:candidate`, the three PR operations, the handover report.
- [x] `packages/debug-report/src/ui/host.ts` — the dev `HostAdapter`
      implementation (`createDevHost`); the interface is
      `packages/debug-report/src/host.ts`.
- [x] `Enter` opens the panel; Escape peels one layer at a time.

**These paths are PR 3's, not PR 2's.** PR 2 built all six inside
`packages/frontend` (`src/debug/`, `vite/`); PR 3 moved them into the package so
any web project can install the reporter, and left `packages/frontend/src/debug/`
holding only what is wafflebase-specific — the route rules, the sheet and doc
locators, the surface registry, and the mount. The list above names where the
code is now, because a task file nobody can follow to the file is a task file
that has stopped being a record.

### Deliberate deviation from the plan (PR 2)

The plan routed drafting through `scripts/agent/ask.mjs`. It cannot go there:
`buildSessionOptions` REQUIRES at least one built-in read tool ("an agent that
can act but not read cannot cite evidence"), which is correct for the verifier
sessions that wrapper exists for and wrong for a call whose security argument is
that it holds none. That package is also a separate npm install outside this
workspace. The call is therefore a plain Messages API request from the dev-server
process — which is what the design doc already describes the dev host doing —
rather than a widened grant on a shared security module.

`vite/**/*.test.ts` was added to the frontend's vitest `include`: the plugin is
Node-side code that must not be bundled into the app, so it cannot live under
`src/`, and its tests belong next to it rather than in `tests/`.

## Tasks (PR 3) — intake, verification, PR assembly

- [x] `scripts/agent/report-bundle.mjs` — fail-closed read of a bundle off disk,
      plus `captureFiles` / `missingCaptures` read from the DIRECTORY rather than
      trusted from the bundle.
- [x] Shared fixtures (`scripts/agent/fixtures/debug-report/`) loaded by both
      validators, so the pipeline's narrower checker cannot drift from
      `parseBundle`.
- [x] `report-intake.mjs` — `redactSecrets` over the prose, dedupe via
      `findingKey` + `tokenOverlap`, destination routing (verify / appearance /
      duplicate / thin), plan emit. A destination is never a deletion.
- [x] `report-verify.mjs` — two-way delegation; conservative plan synthesis (no
      invented actions); a failed replay lowers the destination and files both
      the expectation and the failed replay.
- [x] `report-to-pr.mjs` — forced split (`logic`/`layout`, caps), forced merge by
      file overlap (transitive), one item = one commit with the reporter's
      sentence as the *why*, disclosure trailer, size disclosure, session cap,
      and the delta record. Spawns nothing.
- [x] `report-back.mjs` — the outcome written next to the bundle, with every
      adjustment's reason.
- [x] `scripts/agent/lenses/visual-intent.md` + one `lenses.json` row.
- [x] `.claude/commands/report-intake.md`.

### Deliberately not done in PR 3

- **Running the lanes.** `report-verify.mjs` prints the `hunt-ui replay` and
  visual-lane commands rather than executing them: replay needs a browser and the
  visual lane needs Docker, and both belong to whoever schedules the run. That
  also keeps one code path for dry and real runs.
- **Locating the code.** The file map that decides forced merges is an input
  (`--touches`). Guessing it would produce conflicting PRs; an unchecked overlap
  reported as unchecked costs nothing.
- **Opening anything.** No script here creates a branch, a commit, an issue or a
  PR. `spec-to-pr.mjs handoff` does that, after a person reads the assembly.

## Verification checklist

- [x] The eight surfaces that open without a login. **Re-swept 2026-08-31
      against the shipped overlay** (`pnpm frontend dev`, headless Chrome),
      not the SP0 spike. All eight open logged-out, and `Mod+Shift+Y` renders
      `[data-testid="debug-overlay"]` + `debug-badge` on every one:

      | Surface | Canvases expected | Actual | Overlay |
      | --- | --- | --- | --- |
      | `/harness/hunt?surface=sheet` | 2 | 2 | yes |
      | `/harness/hunt?surface=doc` | 3 | 3 | yes |
      | `/harness/hunt?surface=slides` | 1 | 1 | yes |
      | `/harness/hunt?surface=board` | 1 | 1 | yes |
      | `/harness/docs` | 12 (wrong, see below) | 12 before #997, **6** after | yes |
      | `/harness/interaction` | 4 | 4 | yes |
      | `/harness/visual` | 0 | **59** | yes |
      | `/login` | 0 | 0 | yes |

      **Six of eight match outright. Two do not, and both matter more than
      the six that do.** `/harness/visual` invalidates the sentence this
      checklist item ended on. That sentence said "the two
      zero-canvas routes are the DOM path" — the set was kept precisely
      because it covered both paths. Only `/login` is DOM-only now; the visual
      harness has grown 59 canvases since 2026-08-23. The canvas/DOM split the
      sweep was designed to exercise is therefore carried by a single route,
      which is thinner coverage than the item assumed.

      Recorded rather than silently re-baselined: the number moving is not the
      finding, the collapse of the two-path property is.

      **`/harness/docs` matched, and the match was wrong.** Fixing #997
      revealed that `12` was never the correct count — it was the leak. Each
      scenario mounts one `Spreadsheet` painting two canvases (grid +
      overlay), and there are three scenarios, so the correct total is **6**.
      Twelve is what you get when StrictMode's double-invoke builds a second
      instance per scenario and the teardown throws before disposing either.
      After the fix: 3 scenarios × 2 canvases = 6, stable across repeated
      unmount/remount.

      So this row agreeing with its baseline was the least trustworthy result
      in the table — a checklist that only compares against a previously
      recorded number cannot tell a correct value from a reproducible bug. The
      one row that "passed" hardest is the one that was broken.
- **Retina (DPR 2) capture size** — still unmeasured. At DPR 1 a 160×60
  region is 1-3 KB and a full 1280×721 screen is 81 KB; the quota guard is
  sized for the DPR 2 case but has not been checked against it. A plain
  bullet rather than a box: its text is a negative disclosure, so ticking it
  would assert the opposite of what it says.
- [x] Pre-existing, unrelated, and worth its own report. **Filed as #997** on
      2026-08-31 and fixed in #996, with the root cause rather than just the
      symptom. Exactly the class SP1.5's console-error detection is for.

      As originally recorded: "`/harness/docs` throws
      `TypeError: s.destroy is not a function` three times on load with debug
      mode untouched." Reproducing it showed **"on load" was wrong** — the
      wording is kept only because it is what the original observation said.

      Two corrections the reproduction produced, both worth keeping because the
      original note would have sent someone to the wrong place:

      - **It is not "on load".** A fresh load of `/harness/docs` is clean — 12
        canvases, zero console errors. The throw is on **unmount**, and the
        damage only becomes visible on the *next* mount, which is what made it
        look load-shaped.
      - **The harness does not recover.** After the throw, navigating back
        renders **0 canvases instead of 12**; every docs scenario is blank
        until a full reload. The original note recorded three console errors
        and stopped there.

      Root cause is one line, twice: `page.tsx:52` and `:63` call `.destroy()`
      on the `Spreadsheet` that `initialize()` resolves to, but `Spreadsheet`'s
      teardown method is `cleanup()` (`spreadsheet.ts:932`). `instance` is
      typed `Awaited<ReturnType<typeof initialize>>`, so this should have been
      a compile error — #997 flags that separately, since whatever hides it
      hides the same mistake on every other harness page.

## Out of scope for 1a

- Capture, locators, hotkey (PR 1b) and the preview panel, drafting and PR
  grouping proposals (PR 2) — no React lands in this PR.
- The `packages/frontend` alias and mount: added by 1b/2, where the first
  import appears. An alias with no importer is dead config.
- Anything in `scripts/agent/` (PR 3), auto-detection (SP1.5) and the backend
  mailbox (SP2).
- `packages/design-editor` — another session is working in it; the host adapter
  for it waits until that lands.
