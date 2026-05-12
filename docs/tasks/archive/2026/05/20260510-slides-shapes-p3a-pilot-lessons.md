# Lessons — Slides Shapes P3-A.1 (Adjustment Drag Handles, pilot)

## Spec scoping

**`slides-shapes-p2.md` mis-stated the P1 baseline** — it said "P1 has none" for `ADJUSTMENT_SPECS`, implying P3-A would only need to wire 6 stars. The actual codebase had 33 entries from P1 (`roundRect`, `triangle`, 8 arrows, 4 callouts, 6 equation shapes, etc.). The pilot scope decision was made *after* reading the live `index.ts` rather than trusting the doc — without that step the task would have been triple-sized at scope-time.

**Lesson**: For task scoping, *read the live code* (`grep ADJUSTMENT_SPECS.set packages/slides/src`) instead of trusting the most recent design doc. Phase docs can drift out of sync as multi-task work lands incrementally.

## DOM-vs-Canvas overlay

**Selection chrome is DOM, not Canvas.** `renderOverlay` clears `overlay.innerHTML = ''` and rebuilds child `<div>`s with `data-handle` attributes. The original design doc described "Canvas painters back→front" for handle z-order; the actual implementation has handles in the DOM overlay above the canvas. This was corrected in the spec doc during brainstorming.

**Lesson**: Look at how existing handles (`nw`, `n`, `rotate`) are painted *before* designing the new handle's z-order, hit-test, and rendering layer. The visual harness implications follow from that — DOM overlay isn't captured in canvas-only screenshots.

## Module-level tooltip singletons

`adjustment-tooltip.ts` uses a `let current: HTMLDivElement | null = null` module singleton. The drag loop calls `paintLiveAdjustments` → `renderOverlay` → `overlay.innerHTML = ''` on every pointermove past the threshold. The wipe detached the tooltip div from the DOM, but the JS `current` reference still pointed to the orphaned node, so the next `showAdjustmentTooltip` short-circuited the `appendChild` and the tooltip went invisible from the second move event onward.

The fix (commit `999cf57c`): guard with `current.isConnected` and re-append when detached. A regression test in `adjustment-tooltip.test.ts` simulates the wipe between two `show` calls.

**Lesson**: Any DOM node a long-lived JS reference holds inside a parent that gets `innerHTML = ''` needs an `isConnected` guard. If you see a singleton + a parent that wipes itself between renders, that's the smell.

## Star geometry — unit-ellipse projection

Stars are inscribed in an *ellipse* (`rx = w/2`, `ry = h/2`), not a circle. The inner ring sits at `(rx × ratio, ry × ratio)`, so `hypot(pointer - center)` does NOT recover `ratio` for non-square frames — the radial distance depends on direction. The fix is to normalize the pointer into unit-ellipse space first (`u = (px - cx)/rx`, `v = (py - cy)/ry`) and then project onto the handle's unit-vector ray (`radial = u·cos θ + v·sin θ`).

The "perpendicular pointer → 0" unit test (`star5.handles.test.ts`) is the regression guard: a naive `hypot` implementation would fail it.

**Lesson**: When inverse-mapping pointer → adjustment in any radial axis, project onto the handle's ray rather than measuring scalar distance. The projection formulation also gives the desired "perpendicular wiggle does not change value" UX feel.

## Multi-axis tooltip labels

The first version of `formatAdjustments` used `s.name.charAt(0).toLowerCase()` for the per-axis label. For `wedgeRectCallout` whose specs are named "Tail x" / "Tail y" both resolved to "t", producing `"t: 75% / t: 100%"`. Switching to the last whitespace-delimited word (`lastWord("Tail x") → "x"`) gives the readable `"x: 75% / y: 100%"` while staying compatible with single-word names.

**Lesson**: When deriving short labels from human-readable names, last-word is more discriminating than first-letter. For a future `axisLabel?: string` field on `AdjustmentSpec` to be added, it would only matter for multi-axis shapes where the convention breaks.

## `forceRender` for live preview (Option A)

`paintLiveAdjustments` builds a synthetic slide with the target element's `data.adjustments` overridden, then calls the renderer's existing `forceRender(slide, doc)` which bypasses the dirty check. Zero renderer-side changes needed — the seam was already there for the existing frame-override `paintLive`. This was the cleanest of the three options brainstormed in the plan.

**Lesson**: When extending live-preview semantics beyond what an existing helper covers, look for the renderer's `forceRender`-style escape hatch first. It's usually been built for an earlier feature (in this case, frame drag) and is exactly the right primitive for new override channels.

## Deferred — known limitations of P3-A.1

These came out of the final code review (commit `42048c91` review pass) and are accepted as known limitations rather than blocking the pilot:

1. **8px inset guard near corners**: when `roundRect.adjustments = [0]` or `wedgeRectCallout` tail lands at a corner, the yellow diamond overlaps the green NW resize handle. Hit priority works (adjustment handle is appended last to overlay → wins `elementFromPoint`), but the diamond is visually hidden. Spec called for an inset guard; not implemented in the pilot. **Follow-up**: add the inset to `position` functions; ensure visual baseline regen.

2. **No unit test for adjustment-handle paint position on a rotated frame**: spec called for `interactions/adjustment.test.ts` to verify "30°-rotated star: world point computed forward, hit-test inverse, both must match." The math in `renderAdjustmentHandles` (paint) and `worldToLocal` inside `startAdjustmentDrag` (drag) are mirror-symmetric and likely correct, but a regression in either would manifest as "handle drifts off the rotated shape." **Follow-up**: add the unit test.

3. **`STAR_MIN`/`STAR_MAX` hardcoded** in `radialStarHandle` (50000) duplicates each star's `STAR_N_ADJUSTMENTS[0].max`. Currently uniform across all 6 stars; if a future star has a different max, the duplication will silently desync. Cheap fix when it becomes relevant: pass `(min, max)` into the factory or read from `ADJUSTMENT_SPECS.get(kind)`.

4. **Per-star handle tests are thinner than the spec asked** (2 cases instead of 6). The shared `radialStarHandle` factory IS exhaustively tested in `star5.handles.test.ts` (7 cases including the perpendicular-pointer projection guard), so the underlying geometry is well-covered. The thin per-star files mainly verify "the registration didn't break."

5. **Module-level tooltip singleton** breaks if two slides editors are mounted in the same JS realm (split-pane preview, multi-window). Single-editor v1 is the current architecture, so this is fine; if multi-editor scenarios appear, hoist `current` into the editor instance.

## What worked well

- **TDD per-shape**: each handle commit added a failing test first, then the implementation, then registration. Reviewers could read `<shape>.handles.test.ts` and immediately know what the contract was.
- **Plan's task-by-task structure was genuinely 1:1 with commits**. No tasks needed to be split or merged at execution time. Per-shape tasks (3-7) ran mechanically; integration tasks (9, 10, 11) had appropriate space for design judgment.
- **Two-stage review** caught the tooltip-detach bug in Task 11 before it shipped. The implementer's self-review missed it because their tests didn't simulate the `paintLive` path between `show` calls; the dedicated reviewer reading the diff caught the orphan-singleton pattern at a glance.
- **Subagent-driven execution kept the controller context clean**: the plan + spec docs + 14-task TaskCreate list were the only durable state the controller had to hold, while implementation details lived in the subagents' isolated contexts.

## What to do differently for P3-A.2

- **Skip per-star multi-case test files entirely**. The factory test in `star5.handles.test.ts` is the contract; per-star tests beyond a one-liner "registered" check don't add coverage. P3-A.2 should add the remaining 24 shapes with one test per shape (registry/import smoke) and rely on the per-axis-type tests (linear, radial, point) authored in the pilot.
- **Add the rotated-handle paint position test up front** in P3-A.2 since the codebase will start exercising the math on more shapes.
- **Consider an `axisLabel` field on `AdjustmentSpec`** before P3-B (50+ more shapes); the more multi-axis shapes land, the more the last-word heuristic will need to bend.
