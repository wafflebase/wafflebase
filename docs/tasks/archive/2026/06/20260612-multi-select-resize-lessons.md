# Multi-Select Resize — Lessons

## Surprises caught only by reviewers / integration tests

### 1. Inverted matched-delta signs for W and N handles

`startMultiResize`'s `onMove` re-runs `resizeMultiFrames` after `matchSize`
snaps the bbox to a peer's dimension. The first implementation derived
the new pointer delta as `startBbox.x - matched.x` for the W handle and
`startBbox.y - matched.y` for N. Both were inverted: `resizeFrame`
applies `dx` to `start.x` for `'w'` and `dy` to `start.y` for `'n'`, so
the correct delta is `matched.x - startBbox.x` (and the matching `y`
form for N).

The flipped Task 1 baseline test used the SE handle, which derives its
delta from the **size** change (`matched.w - startBbox.w`) where the
sign convention is symmetric — so the unit-style flipped test didn't
catch the W/N bug. Code review did. Task 6 then added a W-handle snap
regression that exercises the matchSize redistribution path.

**Takeaway:** When pure-function results are re-fed back through their
own input space (delta → frame → snap → delta'), tests must cover all
handle families, not just one. The sign convention can differ between
size-derived and position-derived deltas.

### 2. `updateElementFrame` throws for all connectors

The slides store treats connector frames as derived from their
endpoints — calling `updateElementFrame` on any connector throws "update
its endpoints instead". The first multi-resize wiring guarded only
against fully-attached connectors (`if (snap.kind === 'connector' &&
!connectorEndpoints.has(snap.id)) continue`), letting connectors with
one free endpoint through to `updateElementFrame` — which threw and
killed the gesture.

Task 6's "connector with attached endpoint preserves attachment" test
surfaced the bug. The fix is `if (snap.kind === 'connector') continue`
in the frame-update loop; the separate `connectorEndpoints` loop
handles all endpoint writes.

**Takeaway:** Heterogeneous-selection multi-resize must dispatch on
element type explicitly. Connectors are not "shapes with a frame" — they
are endpoint-derived. Any batch operation across mixed element types
needs unit tests per type AND an integration test that combines them.

## `paintLiveScoped` had no callers after the migration

The spec (§5.5) claimed `paintLiveScoped` would stay available for
connector-endpoint drag and adjustment-handle drag. Both of those use
`this.renderer.forceRender(...)` directly. After Task 3 migrated
single resize off `paintLiveScoped`, the function had zero callers.
The implementer correctly removed it (and its sole helper
`patchElementFrames`), but left an orphaned `/** Scope-aware live
paint... */` doc comment that the controller cleaned up post-hoc.

**Takeaway:** When a design doc claims "X stays because callers Y and
Z still use it", verify by `rg`-searching the callers *before*
shipping the doc. Specs that lie about call graphs invite the wrong
deletions or, worse, the wrong abstentions.

## The visual harness has no pointer-drive precedent

The plan called for mid-drag scenarios that dispatch `pointerdown` +
`pointermove` without `pointerup`. The implementer correctly noted
that the existing harness has zero pointer-drive precedent — every
existing scenario is a static `SlideRenderer.forceRender(slide, doc)`.

Instead of introducing a pointer-event-driven scenario type (timing
fragile, React-batching sensitive), the implementer routed the ghost
scenarios through `forceRender(slide, doc, ghosts)` — the same
internal API the editor's live paint delegates to. This locks in the
ghost composition's visual output deterministically with zero
flakiness, at the cost of NOT catching regressions upstream of
`forceRender`. That tradeoff is correct for visual baselines;
upstream-of-forceRender regressions belong in interaction tests.

**Takeaway:** A visual baseline only needs to reproduce the *paint
inputs* the editor would produce; it does not need to reproduce the
event chain that builds those inputs. Push timing complexity out of
the harness when possible.

## Multi-rotate was already wired before this task started

The spec opening claimed "no multi-element rotate path" exists. In
fact `startRotate`'s `buildLiveState` had a complete `isMulti` branch
that rotated each entry around the bbox centre and used the
`paintMoveGhost` ghost path with handles anchored to originals
(matching Google Slides' rotate UX). The spec was updated mid-flight
to acknowledge this; the only change the plan needed was a `rename
paintMoveGhost → paintGhostPreview` follow-through in that file.

**Takeaway:** Before claiming a feature is missing, grep for it. The
multi-rotate code had been in place for at least the lifetime of
`paintMoveGhost` (which predated the spec by months). The cost of
this miss was small (one sentence in the spec), but the same mistake
on a larger scope would have wasted hours.

## Process notes

- A subagent used `git reset` to squash Task 2 + Task 3 because it
  noticed an issue mid-flight and rolled back. The controller's
  instruction to NOT rewrite history was added to subsequent
  implementer prompts; from Task 4 onward, the pattern held.
- A subagent reported 6 tests but actually delivered 7 (the
  characterization sweep + one bonus). Reviewers verifying counts
  surfaced this. Cheap to verify, high value when right.
