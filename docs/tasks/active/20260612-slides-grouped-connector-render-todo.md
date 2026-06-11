# Slides: render attached connectors correctly inside a group

**Owner:** @hackerwins
**Date:** 2026-06-12

## Why

When the user selects two shapes plus the `Line` connector that joins
them and runs `Group` (`Cmd/Ctrl + Alt + G`), the line jumps to a
visibly wrong position on the slide. Both shapes still render at the
same on-screen location; only the line is offset by roughly the
group's `(x, y)` (plus the group's rotation/scale if any).

Reproduced from a shared deck at
`http://localhost:5173/shared/6f9bc4c8-3dbd-48a8-bb88-b6044ad1529b`.

Root cause is a contract collision between the store and the
renderer:

1. `MemSlidesStore.group()` keeps a connector as a child of the new
   `GroupElement` when both endpoints reference elements that are
   themselves joining the group
   (`packages/slides/src/store/memory.ts:684-708`, partition added by
   PR #263). Children's frames are stored in **group-local**
   coordinates.

2. `slide-renderer.ts` builds an element lookup with
   `buildElementWorldLookup(slide.elements)`
   (`packages/slides/src/view/canvas/slide-renderer.ts:201`). For
   elements inside a group, that helper lifts each child's frame into
   **world** space via `applyMatrix(child.frame, accum)`
   (`packages/slides/src/model/group.ts:411-465`). PR #320 introduced
   this so connectors from outside a group could correctly target
   grouped shapes.

3. `drawElement` for a `GroupElement` applies the group's transform to
   `ctx` (`packages/slides/src/view/canvas/element-renderer.ts:118-136`)
   and then recurses into children
   (`element-renderer.ts:150-152`). Shape / text / image children
   apply their **local** frame on top of that ctx transform, so they
   end up in the correct world position.

4. **Connector children take an early return** at
   `element-renderer.ts:80-85`: they skip the per-element frame
   transform and call `drawConnector` directly. `drawConnector` reads
   its endpoint positions from the world-lookup (so they arrive in
   slide-world coordinates) and calls `ctx.moveTo/lineTo` with those
   coordinates (`connector-renderer.ts:15-17`, `36-43`). But the ctx
   is **still in the group's transformed space** from step 3.

   Net effect: the group transform is applied a second time on top of
   already-world endpoints. The line moves by the group's translation
   (plus any rotation / scale).

Free endpoints inside grouped connectors don't trigger the user-visible
bug because they are normalised to group-local in `group()`
(`memory.ts:787-799`) and `drawConnector` then draws them under the
group's ctx transform, which moves them back to world. They render
correctly **only by accident** — undoing the parent transform (the
attached-endpoint fix) would break them unless the renderer also picks
up the world-coord version of the connector that
`buildElementWorldLookup` already exposes (it lifts `free` endpoints
to world inside its `walkWorld` connector branch, group.ts:441-460).
So the fix is unified: undo the parent transform, hand `drawConnector`
the lookup's view of the connector, and both endpoint kinds agree on
slide-world coords.

The stale "NOTE" at `element-renderer.ts:146-149` ("In v1, group()
never includes connectors as children") still encodes the original
invariant from before PR #263 wired connector partitioning in. The
store and the renderer disagree.

Test gap: `packages/slides/test/store/group-mutations.test.ts:336-377`
only checks that the connector becomes a child; nothing asserts the
rendered geometry. `slide-renderer.test.ts` has no group + connector
case.

## Scope

- `drawElement` learns the cumulative parent-group transform (chain of
  `groupToTransform`s from slide root down to the current parent).
- When the child is a connector and the parent transform is not
  identity, swap the connector for the lookup's view (free endpoints
  lifted to world), save the ctx, multiply by the inverse of the
  parent transform so the ctx returns to slide-world, draw, then
  restore.
- `drawSlide` (slide-renderer.ts) does not need to change — the
  default arg on `drawElement` already feeds `IDENTITY_GROUP_TRANSFORM`
  to top-level calls.
- Replace the stale "group() never includes connectors" NOTE with a
  short note describing the new transform-reset path.
- Add unit tests in `slide-renderer.test.ts`:
  - Attached: assert `ctx.transform` runs before `moveTo` with the
    expected inverse coefficients.
  - Free: assert the `moveTo` / `lineTo` arguments match the pre-group
    world coords (the swap to the lookup version is what makes this
    hold).

Out of scope:

- The connector's cached `frame` (`connector-frame.ts:103`) is still
  a world-bbox after grouping. It is only used as a hit-test /
  selection bbox; fixing that is a separate cleanup.
- Connectors with `free` endpoints inside groups already render
  correctly; no behavioral change for them.

## Bundled fix: rotation tooltip offset

While testing the grouped-connector fix, a separate pre-existing bug
surfaced: the `'45°'` tooltip that floats next to the cursor during a
rotate drag is drawn `(slideOffsetCssX, slideOffsetCssY)` to the top-
left of where the cursor actually is.

Root cause:

- `acquireRotateTooltip` in `editor.ts:5145-5149` appends the tooltip
  to `overlay.parentElement` (= `canvasWrap` in the slides-view) so
  `renderOverlay`'s `innerHTML` reset can't wipe it mid-drag.
- `showTooltip` in `editor.ts:5049-5063` then computes the tooltip
  position against `overlay.getBoundingClientRect()` — the WRONG
  reference frame for an element parented to `canvasWrap`.
- This was harmless until PR #353 (variable pasteboard) gave the
  overlay a non-zero `left/top` relative to its parent so off-slide
  shapes could stay paint-/selectable. After #353 the two
  containers' origins differ by exactly the pasteboard offset, which
  is the visible miss distance.

Not a regression of this PR — `element-renderer.ts` doesn't touch any
overlay/tooltip code. But the user requested it be bundled here.

Fix (`editor.ts:5049-5054`): cache the tooltip's actual parent once,
and compute `localX/Y` against the parent rect. One-line containment
change; no other call sites of the tooltip are affected.

Regression test (`editor.test.ts`, new `describe('rotate — angle
tooltip positioning')`): stand up `wrap > canvas + overlay` with the
overlay's `getBoundingClientRect` stubbed to a non-zero origin,
dispatch a real `pointerdown` on the rotate handle + `pointermove`
on the document, and assert the tooltip's `style.transform` encodes
client-coord-relative offsets (parent-frame), not overlay-relative
ones.

## Bundled fix: rotate tooltip flicker on re-acquire

After the first rotate completed, the next pointerdown on the rotate
handle visibly flickered the tooltip at the previous drag's last
position before snapping to the new click.

Root cause:

- `acquireRotateTooltip` (`editor.ts:5135-5139`) re-used the existing
  element and flipped `display: block` immediately.
- `transform` was last written by `showTooltip` at the previous
  drag's terminal pointermove and was never reset.
- `startRotate` only set `transform` in the FIRST pointermove of the
  new drag — one paint frame later. The intermediate frame painted
  the stale position.

Fix:

- `acquireRotateTooltip` (`editor.ts:5135-5147`) returns the cached
  element AS-IS, leaving `display: none`.
- `startRotate` (`editor.ts:5083`) calls
  `showTooltip(clientX, clientY, 0)` immediately after defining it,
  so `transform` and `display: block` are written together on the
  pointerdown frame.

Regression test: complete one rotate cycle (pointerdown → pointermove
at (400, 200) → pointerup) so the tooltip carries
`translate(414px, 214px)`; dispatch a second pointerdown on the
rotate handle WITHOUT any pointermove; assert the tooltip's
`transform` now matches the new pointerdown coords + 14, not the
stale (414, 214) value, and `display === 'block'`. Pre-fix this
fails on the transform check; post-fix it passes.

## Plan

- [ ] `packages/slides/src/view/canvas/element-renderer.ts` — extend
      `drawElement` signature with `parentTransform: GroupTransform`
      (defaulting to `IDENTITY_GROUP_TRANSFORM`). In the group branch,
      compose with `groupToTransform(group)` and pass to the recursive
      calls. In the connector branch, if `parentTransform` is not
      identity, save / invert via the existing `applyInverseMatrix`
      math (point form already lives in `applyInversePoint`; we need
      the 6-number matrix form for `ctx.transform`) and apply.
- [ ] `packages/slides/src/view/canvas/slide-renderer.ts` — pass
      `IDENTITY_GROUP_TRANSFORM` at the top-level loop call.
- [ ] `packages/slides/test/view/canvas/slide-renderer.test.ts` — new
      test "draws a connector inside a group at the same world
      coords as it did before grouping". Uses two rects and an
      attached connector. Records `moveTo` / `lineTo` calls into the
      existing 2D-context stub before and after `store.group()`.
- [ ] `packages/slides/src/view/canvas/element-renderer.ts` — replace
      the stale `// NOTE: Connectors inside groups are painted in
      raw ctx space …` comment.
- [ ] `pnpm verify:fast` green.

## Verification

- `pnpm --filter @wafflebase/slides test` — new regression test +
  existing suite passes.
- `pnpm verify:fast` — lint + unit tests across the monorepo.
- Manual smoke (deferred to the next session): open the shared deck,
  group the two shapes + line, confirm the line stays anchored to the
  shapes.
