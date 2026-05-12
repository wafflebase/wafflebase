# Slides Shapes P3-A.2 — Adjustment Handles Sweep (24 shapes) Implementation Plan

**Goal:** Register `ADJUSTMENT_HANDLES` entries for the 24 P1/P2 shapes that already have `ADJUSTMENT_SPECS` entries but no drag handle yet. Mechanical sweep on top of the P3-A.1 (PR #210) pilot — no new abstractions; one factory per axis family at most.

**Architecture:** Each shape ships a `*_HANDLES: readonly AdjustmentHandle[]` next to its `PathBuilder`, then registers in `packages/slides/src/view/canvas/shapes/index.ts`. Where multiple shapes share an axis pattern, a family `handles.ts` (analogous to existing `stars/handles.ts`) holds the shared factory. No editor-side changes beyond Task 1's deferred-limitation cleanups.

**Tech stack:** TypeScript, Vitest, Canvas2D (untouched), DOM overlay (untouched). Reuses `ADJUSTMENT_HANDLES`, `renderOverlay` `data-handle="adjust-N"`, `startAdjustmentDrag`, `paintLiveAdjustments` from P3-A.1.

**Reference docs:**
- Spec: `docs/design/slides/slides-shapes-p3a-adjustments.md` (§1, Out-of-scope follow-ups)
- Predecessor lessons: `docs/tasks/archive/2026/05/20260510-slides-shapes-p3a-pilot-lessons.md` — read first; this plan operationalises its "What to do differently for P3-A.2" section

**Branch:** `slides-shapes-p3a2-sweep` (off `main`)

**Conventions:** subject ≤70 chars; body explains WHY; one task = one commit; `pnpm verify:fast` green between commits.

---

## Scope reference — 24 shapes by family

| # | ShapeKind | File | Adj count | Axis type (draft) | Task |
|---|---|---|---|---|---|
| 1 | `triangle` | `basic/triangle.ts` | 1 | linear-x (apex) | T2 |
| 2 | `parallelogram` | `basic/parallelogram.ts` | 1 | linear-x (slant) | T2 |
| 3 | `trapezoid` | `basic/trapezoid.ts` | 1 | linear-x (inset) | T2 |
| 4 | `hexagon` | `basic/hexagon.ts` | 1 | linear-x (side inset) | T2 |
| 5 | `octagon` | `basic/octagon.ts` | 1 | linear-x (corner inset) | T2 |
| 6 | `plus` | `basic/plus.ts` | 1 | linear-x (arm thickness) | T2 |
| 7 | `pentagonArrow` | `arrows/pentagon-arrow.ts` | 1 | linear-x (notch) | T2 |
| 8 | `can` | `basic/can.ts` | 1 | linear-y (top ellipse) | T3 |
| 9 | `donut` | `basic/donut.ts` | 1 | radial (inner ratio) | T3 |
| 10-14 | 5× directional arrow | `arrows/{right,left,up,down,left-right}-arrow.ts` | 2 each | 2× linear (shaft + head) | T4 |
| 15 | `quadArrow` | `arrows/quad-arrow.ts` | 3 | 3× linear | T5 |
| 16 | `wedgeRoundRectCallout` | `callouts/wedge-round-rect-callout.ts` | 2 | point + linear (radius) | T6 |
| 17 | `wedgeEllipseCallout` | `callouts/wedge-ellipse-callout.ts` | 2 | point | T6 |
| 18 | `cloudCallout` | `callouts/cloud-callout.ts` | 2 | point | T6 |
| 19-22 | `mathPlus`, `mathMinus`, `mathMultiply`, `mathEqual` | `equation/*.ts` | 1-2 | linear | T7 |
| 23 | `mathDivide` | `equation/math-divide.ts` | 3 | 3× linear | T7 |
| 24 | `mathNotEqual` | `equation/math-not-equal.ts` | 3 | 3× linear | T7 |

> Axis types and counts are **draft inferences** from filenames + `ADJUSTMENT_SPECS` declarations. The path builder is source-of-truth — reconcile each row before writing its handle and correct this table in-place if it disagrees. (P2's design doc mis-stated P1's `ADJUSTMENT_SPECS` baseline — see pilot lessons §1; same risk applies here.)

---

## Tasks

Each task = one commit on `slides-shapes-p3a2-sweep`. Mark complete when the commit lands locally and `pnpm verify:fast` is green.

### Setup

- [ ] **T0 — Branch + commit todo+lessons skeleton**
  - `git checkout -b slides-shapes-p3a2-sweep origin/main`
  - `pnpm verify:fast` green baseline
  - commit `20260512-slides-shapes-p3a2-sweep-{todo,lessons}.md`

### Deferred-limitation cleanups from P3-A.1

- [ ] **T1 — 8px corner inset guard, rotated-paint test, drop `STAR_MIN`/`STAR_MAX`**
  - Closes pilot deferred #1, #2, #3
  - `roundRect` and `wedgeRectCallout` `position` functions add an 8px element-local inset near edges/corners so the diamond never overlaps the resize handle. Underlying `adjustments` data still reaches the boundary value; only paint position is clipped. Unit test asserts ≥ 8px from frame edge for boundary `adjustments`.
  - Add `interactions/adjustment.test.ts` case: 30°-rotated star → world point of handle via `position` + rotation matches `hitAdjustmentHandle` inverse.
  - Refactor `radialStarHandle` (in `stars/handles.ts`) to source `(min, max)` from `ADJUSTMENT_SPECS.get(kind)` instead of hardcoded 50000; existing star tests must still pass unchanged.

### Shape sweep

- [ ] **T2 — Linear-x family: 7 shapes via shared `linearXHandle` factory**
  - New: `basic/handles.ts` exporting `linearXHandle({ axisOf, projectTo, min, max })` — generic linear-on-edge factory (per-shape inverse function kept tiny).
  - Register `triangle`, `parallelogram`, `trapezoid`, `hexagon`, `octagon`, `plus`, `pentagonArrow`.
  - Factory unit test (`basic/handles.test.ts`): 3-case round-trip identity (position → apply → position within ±50 OOXML inside clamp range).
  - One smoke test per shape (`<kind>.handles.test.ts`): asserts `position(frame, default)` returns a point on the expected edge. Per pilot lessons: no per-axis-type retesting at shape level.

- [ ] **T3 — `can` (linear-y), `donut` (radial)**
  - `can`: add `linearYHandle` to `basic/handles.ts` (mirror of `linearXHandle`).
  - `donut`: reuse the radial factory. If `radialStarHandle`'s signature fits, lift it from `stars/handles.ts` to `shapes/handles.ts` so both stars and donut share it; otherwise wrap it inline. Decide based on actual signature, not speculation.
  - Register both; one smoke test each.

- [ ] **T4 — 5 directional arrows via shared `directionalArrowHandles(direction)` factory**
  - Right, Left, Up, Down, LeftRight all share `ARROW_ADJUSTMENTS` and 4-way rotational symmetry. New `arrows/handles.ts` exposes a single direction-parameterised factory returning **two handles** (shaft thickness + arrowhead length).
  - If symmetry collapses cleanly: one factory, 5 one-line registrations. If not: split per-direction and record the divergence in lessons doc.
  - Factory test exercises one direction with 4 cases (default/min/max/off-axis); rely on symmetry for the rest. One smoke test per shape ("registers two handles").

- [ ] **T5 — `quadArrow` (3 adjustments, ad-hoc)**
  - 4-way arrow doesn't fit the directional factory. Implement 3 handles directly in `arrows/quad-arrow.ts` matching the path builder's 3 adjustments (likely shaft, head length, head breadth — confirm from builder).
  - Three handles painted in distinct positions; smoke test asserts count and rough placement.

- [ ] **T6 — 3 point-axis callouts**
  - Promote `wedgeRectCallout`'s tail-tip logic into a `pointHandle(...)` factory in `callouts/handles.ts`. Existing `wedgeRectCallout` re-points at the factory; tests must remain green with no semantic change.
  - `wedgeEllipseCallout`, `cloudCallout`: tail-only — single point handle.
  - `wedgeRoundRectCallout`: tail point + corner-radius linear handle (reuses `linearXHandle` from `basic/handles.ts`).
  - Register all 3; one smoke test each.

- [ ] **T7 — 6 math equation shapes**
  - `mathPlus`, `mathMinus`, `mathMultiply`: 1 adjustment each (bar thickness). Reuse `linearXHandle`/`linearYHandle` from `basic/handles.ts` where the axis matches.
  - `mathEqual`: 2 adjustments (bar thickness, gap). Likely two linear handles.
  - `mathDivide`, `mathNotEqual`: 3 adjustments each. Implement ad-hoc per-shape if no clean shared pattern emerges. Match Google Slides' UX (3 visible diamonds).
  - Smoke test per shape; record any shared `equation/handles.ts` if one emerges.

### Editor / harness / closeout

- [ ] **T8 — `axisLabel` on `AdjustmentSpec` for multi-axis tooltip**
  - Lessons-doc recommendation. The `lastWord("Tail x")` heuristic breaks as Tasks 4-7 add ~12 multi-axis shapes (quadArrow's 3, mathDivide's 3, equations' bar+gap pairs).
  - Add `axisLabel?: string` to `AdjustmentSpec` in `builder.ts`. `formatAdjustments` (in `adjustment-tooltip.ts`) prefers it; `lastWord` remains as fallback.
  - Populate `axisLabel` only where the heuristic collides or produces an unclear label (don't blanket-populate). Update `adjustment-tooltip.test.ts` with one new case.

- [ ] **T9 — Visual harness scenario expansion**
  - Rename `shapes-adjustments-pilot` → `shapes-adjustments-all` in `packages/frontend/src/app/harness/visual/slides-scenarios.tsx`. Cover all 33 shapes with `ADJUSTMENT_HANDLES` registered. Pick a layout that produces a stable baseline (e.g. 5-column grid with default+authored rows).
  - Regen: `pnpm verify:browser:docker:update`. Verify regen baseline visually before commit. Commit baseline + scenario together.

- [ ] **T10 — Self-review + PR**
  - Dispatch `code-review` skill over full branch diff. Resolve blockers; note non-blockers in lessons doc.
  - Rebase on latest `origin/main`. Re-run `pnpm verify:fast` and `pnpm verify:browser:docker`.
  - Push branch; open PR (title ≤70 chars, body = summary + test plan + scenario screenshot).

- [ ] **T11 — After merge: archive + design-doc strike-through**
  - Fill lessons in `20260512-slides-shapes-p3a2-sweep-lessons.md`.
  - Strike-through the P3-A.2 row in `docs/design/slides/slides-shapes-p3a-adjustments.md` "Out-of-scope follow-ups"; note PR number.
  - Flip all `- [ ]` in this todo → `- [x]`; run `pnpm tasks:archive && pnpm tasks:index` so the pair lands in `archive/2026/05/`.
  - Commit the archive move + design-doc edit together.

---

## Verification (must all be true before opening PR)

- [ ] `pnpm verify:fast` green
- [ ] `pnpm verify:self` green
- [ ] `pnpm verify:browser:docker` green with regenerated `shapes-adjustments-all` baseline
- [ ] Every key in `ADJUSTMENT_SPECS` (33 total) also has an `ADJUSTMENT_HANDLES` entry — asserted by extending the existing `shapes/index.test.ts` registry consistency test
- [ ] T1's rotated-paint test still green after every later commit (the regression guard for the sweep)
- [ ] No P1/P2 visual scenario baselines drifted beyond the renamed adjustments scenario

## Accepted limitations

- Pilot deferred #4 (thin per-star tests): unchanged — the factory in `stars/handles.ts` carries geometric coverage; per-shape files stay one-line smoke tests by design (lessons-doc recommendation).
- Pilot deferred #5 (module-level tooltip singleton): unchanged — single-editor v1 architecture; multi-editor split-pane revisits later.

## Out of scope (recorded for later phases)

| Phase | Item |
|---|---|
| P3-A.3 | Popover number-input fallback for typed adjustment values |
| P3-B | +50 shapes for Google Slides parity (banners, action buttons, more callouts) |
| P3-C | Action button click handlers in presentation mode |
| P4 | DrawingML formula evaluator (`<a:avLst>` PPTX adjustment round-trip) |
