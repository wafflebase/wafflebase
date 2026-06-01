# Sheets: comment popover fits viewport (no off-screen clipping)

**Goal:** When the active cell with comments is near the right or
bottom edge of the grid, the comment popover should stay fully
visible by flipping its side / vertical anchor instead of clipping
off-screen. The active cell must never be obscured by the popover.

**Symptom:** Today `sheet-view.tsx:1310-1325` positions the popover
at `cellRect.right + 4px` and `cellRect.top` unconditionally. If the
active cell is in the rightmost columns or near the bottom of the
visible grid, the 320px-wide popover gets clipped by the panel /
window edge.

**Reference:** `DocsCommentPopover.tsx` already solves a similar
issue (clamp + flip-up), but it's a simple anchor-rect clamp. Sheets
needs **cell-aware side flipping** so the active cell stays visible
(Google Sheets parity).

## Google Sheets behavior (target)

1. Default placement: right of active cell, top-aligned with cell.
2. Right-edge overflow → flip to the left of the cell.
3. Bottom-edge overflow → align popover bottom with cell bottom
   (flip up) while keeping the same horizontal side.
4. Both sides fail (cell wider than half the viewport, extremely
   narrow harness) → stack below the cell, flip above if no room
   below. Horizontal clamp inside viewport padding.

Across all four states the active cell stays out from under the
popover.

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `packages/frontend/src/app/spreadsheet/sheet-view.tsx` | Replace inline `commentPopoverPosition` IIFE with `useLayoutEffect` that measures the rendered popover and chooses side / stack placement. Wrapper uses `visibility: hidden` until measured. | Modify |
| `docs/design/sheets/comments.md` | Add a "Popover placement" sub-section under §6 UI describing the side-flip algorithm and cell visibility invariant. | Modify |

## Tasks

- [x] **Task 1:** Read current `commentPopoverPosition` IIFE and identify the parent `<div className="relative flex-1 w-full">` as the coordinate origin (the popover wrapper is `absolute` inside it; sheet `getGridViewportRect()` is relative to `containerRef`, which sits at the same origin via two intermediate `h-full w-full` wrappers).
- [x] **Task 2:** Replace the IIFE with: `popoverWrapperRef`, `popoverPos` state (`{left, top} | null`), `useLayoutEffect` deps `[commentPopoverOpen, activeCellForComment, activeCellThreads.length, sheetRenderVersion]`. Algorithm:
  1. Try `right of cell` (`cellRect.right + GAP`); accept if `+ width <= parentW - PAD`.
  2. Else try `left of cell` (`cellRect.left - GAP - width`); accept if `>= PAD`.
  3. Side placement: top-align with cell, flip to `cellBottom - height` if bottom overflows.
  4. If neither side fits → stack: `top = cellBottom + GAP`, flip above if needed; clamp `left` to viewport padding.
- [x] **Task 3:** Wrapper `style={{ visibility: pos ? 'visible' : 'hidden', left, top }}` to avoid a flash on first paint.
- [x] **Task 4:** Update `docs/design/sheets/comments.md` §6 with a "Popover placement" sub-section: 4-state diagram + cell-visibility invariant + reference to the docs flip pattern.
- [x] **Task 5:** `pnpm verify:fast` green. No new unit tests are added — placement is a deterministic geometry function exercised through manual smoke in `pnpm dev` at the four edge cases (top-right cell, bottom-right cell, top-left cell, narrow viewport).

## Notes

- `getGridViewportRect()` returns coords relative to the sheet's
  internal `container` element (a child of `containerRef`). Because
  the two intermediate `h-full w-full` wrappers between
  `containerRef` and the popover's `position: relative` ancestor
  carry no padding / margin, the popover-wrapper origin matches the
  sheet-viewport origin — no extra offset needed.
- Padding constant `PAD = 8` matches `DocsCommentPopover`'s
  `VIEWPORT_PADDING`. Gap `GAP = 4` matches the existing `MARGIN`.
- The popover's outside-click handler lives inside `CommentPopover`
  and uses its own ref. Adding a wrapper ref for measurement does
  not affect dismiss logic.
- Out of scope: cross-tab cases (panel resize during open), keyboard
  scroll causing the cell to move during open. Both already invalidate
  the popover via `commentPopoverOpen=false` on selection change.
