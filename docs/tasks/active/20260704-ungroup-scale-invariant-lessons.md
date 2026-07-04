# Lessons — ungroup scale invariant

## Investigation

- The symptom "looks fine grouped, distorts on ungroup" is only possible
  when a rotated child sits under a **residual non-uniform group scale**.
  Proven by comparing the two 2×2 maps the shape geometry sees:
  renderer = `Scale(sx,sy)·Rotate(φ)` vs ungroup bake =
  `Rotate(φ)·Scale`. They commute (Δ = 0) iff scale is uniform or the
  child is unrotated; otherwise Δ ≈ 0.71 (2:1 scale, 30°). Rotation is a
  *necessary* condition — a throwaway test at rotation 0 and at uniform
  scale both showed Δ = 0.

- Watch out for coincidental matches when reproducing: at exactly 45°,
  `scaleRotatedFrame`'s degenerate fallback returns per-axis
  `(w·sx, h·sy)` whose aspect equals the renderer's singular-value aspect
  `{sx,sy}` — the mismatch is in *orientation*, not aspect, for a square
  child. Compare the full 2×2 map, not just the width:height ratio.

- Two parallel store implementations exist (`MemSlidesStore`,
  `YorkieSlidesStore`); a store-level fix must be applied to both, with
  shared math kept in `model/group.ts`. `bakeGroupResize` also has a
  no-op stub in `layout-edit-store.ts`.

- PPTX import does **not** leak residual scale: it bakes `chExt/ext` into
  child world frames and sets `refSize = frame`. Don't assume "imported →
  non-uniform group"; verify.

## Implementation

- An existing test (`multi-resize.test.ts` Test A) asserted the group's
  `refSize` is **unchanged** after multi-resize — it encoded the old
  no-bake behavior. Fixing the bug flips that expectation; the test had
  to be rewritten to assert the group is baked (`refSize == frame`,
  child frames scaled). Search for tests that lock in the buggy behavior
  before assuming a green suite means "no behavior change".

- Regression tests must use a **non-square** rotated child with a
  **mild** non-uniform scale (e.g. 60×40 @ 20°, sx=1.5). A square child
  or a large stretch drives `scaleRotatedFrame` into its degenerate
  fallback (`w·sx, h·sy`), which coincidentally equals the per-axis bake
  and masks the divergence. Verified the equivalence test fails with the
  settle-first line removed, and passes with it — a real guard.

- `bakeGroupResize` recursion in the Yorkie store must run **inside the
  single `withUpdate`** on the proxies (`bakeProxyGroupTree`); you can't
  recurse by calling `this.bakeGroupResize(childId)` because that opens a
  nested `withUpdate`/`doc.update`. `bakeGroupScale` stays a pure
  per-level model function; recursion lives in the store layer so its
  contract (and its tests) are untouched.

- `bakeGroupScale` scales a child group's `frame` but not its `refSize`
  (documented non-recursive contract), so after baking a parent the
  child group carries the parent's scale — which is exactly why the
  store-layer recursion is needed to hold the invariant through nesting.
