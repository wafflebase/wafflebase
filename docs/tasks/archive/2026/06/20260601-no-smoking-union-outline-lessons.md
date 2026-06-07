# Slides: noSmoking union-outline — lessons

**Date:** 2026-06-01

## What worked

- **`mathNotEqual` as the reference fix.** The same overlapping-stroke
  pattern was already solved twice in this repo (`mathMultiply`,
  `mathNotEqual`). Re-applying the same recipe (single connected union
  outline, no overlapping closed sub-paths) made the design cheap.

- **OOXML preset semantics for adjustments.** Treating `adj1` as a
  shared ring + slash thickness (the OOXML convention) instead of the
  V0's "ring = adj1, slash = 2·adj1" mismatch removed a long-standing
  visual inconsistency in addition to fixing the stroke artefact.

- **`lineEllipseRoots` + signed-perpendicular sign test.** Closed-form
  quadratic for line ∩ axis-aligned ellipse is six lines; combined with
  a sign-of-midpoint test it picks the correct hole arc deterministically
  without needing trig comparisons against angle wraparounds.

## What surprised me

- **The JSDOM test shim's `nonzero` rule is NOT a winding-rule
  implementation.** `test-canvas-env.isPointInPathImpl` for the
  default `'nonzero'` rule returns `true` if the point hits ANY sub-
  path's op — it does not compute winding numbers, so CCW holes do not
  punch through CW outers. Only the `'evenodd'` branch is parity-based
  and behaves like a real browser. Real Canvas2D honours winding, but
  tests must either (a) pass `'evenodd'` explicitly when hit-testing
  multi-subpath paths, or (b) register the shape kind in
  `EVENODD_KINDS` so the renderer fills it with even-odd at draw time
  (which is what we did — `noSmoking` joined `donut`).

  **Why:** the shim treats sub-paths as independent membership tests.
  CW/CCW vertex order has no effect under its default rule.

  **How to apply:** any new builder that relies on CCW sub-paths
  cancelling out CW outers (donut, frame-style hollows, this fix's
  C-shaped holes) must use `'evenodd'` in tests and live in
  `EVENODD_KINDS`. Geometry can still be wound CCW for safety — both
  rules then agree — but the renderer-side selection is the load-
  bearing decision.

- **`registry.snap.test.ts` catches geometry changes loudly.** Forgot
  this snapshot existed; the snap diff was scoped to the noSmoking
  section (lines 7423–7718) which made the update safe to `vitest -u`
  without worry. Worth keeping in mind whenever a `PATH_BUILDERS` entry
  changes — diff is the source of truth for "what visually changed".

## Watch-outs

- The visual band thickness changed: OLD slash was `2t` perpendicular-
  wide (because the corner offsets were `±half` in `(1, −1)` direction,
  giving perpendicular distance `t` per side → full band `2t`). NEW
  band is `t` wide, matching the ring. If anyone visually A/B's the
  pre-fix and post-fix decks, the slash will read as thinner — that is
  intentional and matches the OOXML preset / Google Slides.

- `polylineArc(... , 16)` segments for inner-hole arcs is plenty at
  slide scale, but only because the arc endpoints are pinned to the
  exact `lineEllipseRoots` solutions before the polyline runs. Without
  that pinning, the 16-segment endpoint would land a few sub-pixels
  off the band edge and the straight-back closing segment would leave
  a tiny "fillet" gap. Lesson: when stitching analytic-line edges to
  polyline-approximated arcs, always pin the polyline endpoints to the
  analytic intersection points.
