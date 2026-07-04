# Ungroup scale invariant — fix smiley distortion on ungroup

## Problem

Ungrouping a group in the slides editor distorts a rotated shape child
(reported: a smiley face squishes on ungroup).

Root cause: a group can **rest with a non-uniform render scale**
(`data.refSize != frame`). The renderer applies that scale *outside* a
child's own rotation (`Scale(sx,sy)·Rotate(φ)` — a shear for non-uniform
scale), but `ungroup()` bakes the child as an axis-aligned rotated rect
(`Rotate(φ)·Scale`, no shear). The two agree only when scale is uniform
or the child is unrotated; otherwise the child's geometry changes the
instant it is ungrouped (Frobenius Δ of the 2×2 maps ≈ 0.71 for 2:1
scale + 30° child — proven with the real transform functions).

Residual non-uniform scale is not created by PPTX import (it bakes
`chExt/ext` into child world frames) or by group creation (`refSize`
seeded = `frame`). It leaks in through commit paths that change a
group's `frame.w/h` without baking.

Design: `docs/design/slides/slides-group.md` §6.1 (resting-scale
invariant).

## Approach

Enforce the invariant: **after any committed edit, every group at every
depth has `refSize == frame` (scale 1).** Non-uniform scale exists only
transiently during a resize drag; it is baked on commit.

## Checklist

### Store / model
- [ ] Make `bakeGroupResize` **recursive** in `store/memory.ts` (DFS into
      child groups after baking direct children). Keep `bakeGroupScale`
      (`model/group.ts`) per-level contract unchanged.
- [ ] Mirror the recursive `bakeGroupResize` in
      `frontend/.../yorkie-slides-store.ts`.
- [ ] `ungroup()` (both stores) settles the target group's scale to 1
      (recursive bake) **before** baking translate/rotate into children.
      Confirm this removes the nested-child-group `refSize` leak.
- [ ] Add `assertGroupsSettled(elements)` DEV/test helper (walks tree,
      asserts `refSize ≈ frame` for every group).

### Editor / panel commit sites
- [ ] Multi-select resize `onUp` (`editor.ts` `startMultiResize`): call
      `store.bakeGroupResize` for each selected element that is a group,
      inside the existing commit `batch`.
- [ ] Format panel `commitFrame` (`format-panel/index.tsx`): bake if the
      target element is a group.
- [ ] Format panel `lockedResize` (`format-panel/index.tsx`): bake if the
      target element is a group.

### Tests (packages/slides, MemSlidesStore)
- [ ] Regression: group resting with non-uniform scale + rotated shape
      child → `ungroup` → assert (a) no output group has residual scale,
      (b) rotated child's post-ungroup transform == its pre-ungroup
      *rendered* transform within eps (render-map == ungroup-map).
- [ ] Multi-resize a group → assert `refSize == frame` after commit.
- [ ] Nested: resize outer group → assert inner group also settled
      (recursive bake).
- [ ] Format panel `commitFrame` / `lockedResize` on a group → settled.
- [ ] `assertGroupsSettled` used as the shared guard in the above.

### Verify
- [ ] `pnpm verify:fast` green.
- [ ] Manual smoke in `pnpm dev`: group a smiley (rotated) with another
      shape, resize the group non-uniformly (single + multi + panel),
      ungroup → smiley unchanged.

## Review

Implemented on branch `fix/ungroup-scale-invariant` (commit
`Bake group render-scale on every resize commit and ungroup`).

- Store: `bakeGroupResize` → recursive `bakeGroupTree` (memory) /
  `bakeProxyGroupTree` (Yorkie); `ungroup` settles scale first.
- Commit sites baked: multi-resize `onUp`, Format panel `commitFrame` /
  `lockedResize`. (single-resize already baked; align/distribute/rotate/
  move/crop/autofit don't change w/h — confirmed by enumeration.)
- Guard `collectUnsettledGroups` / `isGroupSettled` live in
  `test/support/group-invariant.ts` (test-only).
- Tests: recursive nested settle, ungroup settle-equivalence (verified to
  FAIL pre-fix), legacy-nested-group grandchild scaling, editor
  multi-resize integration. `pnpm verify:fast` green.

High-effort code review (workflow) — 4 findings, all resolved:

1. **Legacy nested group w/ `undefined refSize`** (correctness, confirmed)
   — child group frame scaled but grandchildren dropped the parent scale.
   Fixed: seed missing child-group `refSize` with pre-scale frame before
   baking (both stores) + regression test.
2. **Recursion flattens nested rotated children on resize** (contested)
   — kept recursion (the approved invariant requires it; consistent with
   the existing single-level bake) and documented the trade-off in
   slides-group.md §6.1 (no shear at rest — data model has no shear).
3. **Duplicated recursion across stores** (cleanup) — added reciprocal
   "keep in sync" cross-reference comments; per-level math already shared
   via `bakeGroupScale`.
4. **Test-only predicates in production source** (cleanup) — moved to
   `test/support/group-invariant.ts`.

Smoke test: the editable browser editor needs GitHub OAuth (backend
returned 401 headless), so the live-app path was smoked by driving the
real `YorkieSlidesStore` against a local Yorkie document
(`yorkie-slides-equivalence.test.ts`) — group → dirty non-uniform resize
→ ungroup, asserting the Yorkie proxy result matches the proven-correct
Mem path and every group rests settled. Verified to FAIL with the Yorkie
ungroup-settle removed.

PR: https://github.com/wafflebase/wafflebase/pull/441
