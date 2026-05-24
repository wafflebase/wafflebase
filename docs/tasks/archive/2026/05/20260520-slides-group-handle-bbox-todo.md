# Slides group — handle bbox refit + rotation UX

**Goal:** Selection box for a group always reflects the current visible
extent of its children, including after a child was moved inside
drill-in and including when the group itself is rotated. Multi-select
rotation works as a single rigid body. Rotate gesture uses a ghost
preview + angle tooltip.

**Layered fix:**

1. **Overlay (render-time, no model change).** Replace the group's
   stored frame with a rotation-preserving tight world frame
   (`worldTightFrame`) when feeding the overlay. Drill-in mid-edit and
   re-selection both show a tight box without touching the data model.
   For rotation = 0 groups this is an axis-aligned wrap; for rotated
   groups it's a rotated rectangle so `renderRotatedHandles` fires.

2. **Model normalize on drill-out.** When the user pops drill-in scope
   (Esc, click outside the drilled-in group, click empty canvas while
   drilled in, right-click outside scope), call
   `SlidesStore.refitGroup(slideId, groupId)`. The refit re-anchors
   `group.frame`, `data.refSize`, and each child's local frame so the
   stored shape matches the (now consistent) visible shape. Rotation
   and scale are preserved; children's world positions are invariant.
   Done in a single `store.batch` so undo restores the pre-drill state
   in one step.

3. **Multi-select rotation.** Rotate handle is shown for multi-select
   too; pre-fix it was visible but a no-op. Pivot = combined-bbox
   center (where the handle visually sits). Each element's center
   rotates around the pivot and the delta is added to its own
   `frame.rotation`. Connectors rotate free endpoints around the pivot
   and leave attached endpoints anchored to their host.

4. **Rotate ghost + angle tooltip.** Rotate gesture mirrors the
   shape-move ghost pattern: original stays in place during drag,
   translucent ghost shows where it will land, handles anchor to the
   start frame. A small "45°" tooltip follows the cursor with the
   absolute new rotation (single) or delta (multi).

**Tech Stack:** TypeScript, Vitest, jsdom.

## Steps

- [x] **Step 1:** Add `worldChildrenAABB` (axis-aligned) and
  `worldTightFrame` (rotation-preserving) helpers to
  `packages/slides/src/model/group.ts`.
- [x] **Step 2:** Wire `worldTightFrame` into the overlay path
  (`editor.ts` repaintOverlay). Groups now lift through the tight
  frame; leaves keep `el.frame`.
- [x] **Step 3:** Add `SlidesStore.refitGroup` to the interface and
  implement in `MemSlidesStore` using the shared `worldTightFrame`
  math. Rotation and scale preserved.
- [x] **Step 4:** Same on `YorkieSlidesStore` inside one `doc.update`.
- [x] **Step 5:** Esc handler in `interactions/keyboard.ts` refits the
  innermost scoped group before `selection.escape()`.
- [x] **Step 6:** `refitPoppedScope` hook called from
  `onPointerDown` (element hit), `onPointerDown` empty-canvas branch
  (was previously missing → root cause of "left/top off after
  re-select"), and `onContextMenu`.
- [x] **Step 7:** Multi-select rotation in `startRotate`: drop the
  `length !== 1` guard, pivot = combined bbox center, ghost-based
  preview, commit on release.
- [x] **Step 8:** Rotate ghost (replaces `paintLiveScoped` with
  `paintMoveGhost`). Handles stay anchored to start frames.
- [x] **Step 9:** Angle tooltip (`acquireRotateTooltip` /
  `releaseRotateTooltip`). Appended to the overlay's parent so
  `renderOverlay.innerHTML` rebuilds don't wipe it.
- [x] **Step 10:** Unit tests for `worldChildrenAABB`,
  `worldTightFrame`, and `MemSlidesStore.refitGroup` covering rotation
  preservation, scale preservation, child world-position invariance,
  and the no-op fast path.
- [x] **Step 11:** `pnpm verify:fast` green.

## Manual smoke

1. `pnpm dev`, open a slide.
2. Insert 2 shapes; group (Cmd+Alt+G); resize the group via SE corner.
3. Double-click to drill in; drag one child far outside the original bbox.
4. Click empty canvas (or another element, or Esc) — group should
   refit; subsequent group re-select shows a tight handle box.
5. Rotate the group via the rotate handle. Tooltip shows the angle.
   Ghost previews the rotation; release commits.
6. Re-select the rotated group → rotated handle box.
7. Multi-select two shapes (Shift+click); rotate via the rotate handle
   on the union bbox; both shapes rotate as a rigid body around the
   shared pivot.
8. Drill into a rotated group, move a child, exit drill-in → group
   stays rotated and the rotated handle box wraps tight.

## Review

- Layer-1 overlay was already in place from the earlier session — the
  recent rotation work extended it via `worldTightFrame` so the
  rotation-detection branch (`frame.rotation !== 0`) in
  `renderOverlay` correctly fires `renderRotatedHandles`.
- The "left/top off after re-select" bug turned out to be caused by
  the empty-canvas click path bypassing `selection.click`, which meant
  `refitPoppedScope` was never invoked. Fixed by adding scope-pop to
  the `hitResult === null` branch and to `onContextMenu`.
- `refitGroup` math derivation:
  `O_new = O_old − R_θ(S · (C_old − shift − C_new))` where `shift` is
  the children's local AABB corner; each child shifts by `−shift`.
  Verified by property tests at depth 1 with rotation × non-uniform
  scale combinations.
- Multi-rotate uses combined-bbox center as the pivot, which matches
  where the rotate handle is visually drawn — so the gesture feels
  consistent with the affordance.
