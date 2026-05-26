---
title: Slides thumb context menu, mode toggles, dark-mode shapes, first-slide seed
target-version: 0.3.8
---

# Slides editor UX fixes

Five small UX fixes to the slides editor reported by the user.

## Goals

- Right-click on a slide thumbnail opens a basic editing menu (new / duplicate / delete / change layout).
- Shape preview outlines in the toolbar shape dropdown stay visible in dark mode.
- Toolbar exposes an explicit Select-mode button next to Text / Shape so the three insert-mode states are visible and switchable; exactly one is always pressed.
- Toolbar Shape trigger is icon-only (no "Shape" text label) and visually matches the Toggle pressed style.
- Brand-new presentations open with a seeded blank slide so the canvas isn't empty.

## Non-Goals

- New store ops — `addSlide`, `duplicateSlide`, `removeSlides`, `applyLayout` already exist.
- Reskinning the existing canvas right-click menu.
- Multi-slide layout change (Google Slides also limits to single-slide).

## Plan

1. **Thumbnail context menu** (`packages/slides/src/view/editor/thumbnail-panel.ts`)
   - Add a `contextmenu` listener per thumbnail item.
   - If the right-clicked slide isn't already in `selectedSlideIds`, replace selection with just that slide (matches canvas right-click semantics in `editor.ts`).
   - Build items: New slide (insert after), Duplicate (singular/plural), Delete (singular/plural), divider, Change layout… (disabled when >1 selected).
   - Wrap mutations in `store.batch()`. After delete, switch current slide to a sibling if the current was deleted. After insert/duplicate, switch current to the new slide id.
   - Add a unit test that confirms the menu items mount and call the corresponding store ops.

2. **Shape picker dark mode** (`packages/frontend/src/app/slides/shape-picker.tsx`)
   - Replace `ctx.strokeStyle = "currentColor"` (Canvas 2D doesn't understand the CSS keyword — silently falls back to black) with the resolved color from `getComputedStyle(canvas).color`.
   - Resolve after the canvas is in the DOM so the cascade has applied.

3. **Toolbar Select / Text / Shape group** (`packages/frontend/src/app/slides/slides-formatting-toolbar.tsx`, `shape-picker.tsx`)
   - Add a Select toggle (`IconPointer`) to the left of the Text toggle. Pressed when `insertMode === null`. Click sets `insertMode(null)`.
   - Strip the "Shape" text label from the shape picker trigger — icon-only.
   - Align the Shape trigger pressed visual with the Toggle component (`data-state=on/off`, `bg-accent / text-accent-foreground`, `h-8 min-w-8 px-1.5`).

4. **Seed first slide on new presentations** (`packages/frontend/src/app/slides/slides-view.tsx`)
   - The editor's `render()` bails out when no current slide exists, so a brand-new doc lands on a blank canvas.
   - After `ensureSlidesRoot`, when `store.read().slides.length === 0`, call `store.batch(() => store.addSlide("blank"))`.
   - Match Google Slides "new deck always opens with one slide" UX.
   - Concurrent first-mount race: two clients can both seed (yielding 2 slides). Acceptable — matches the established `docs-view.tsx` `ensureTree` pattern; future improvement could gate via a `meta.seeded` flag.

## Verification

- `pnpm verify:fast` green.
- Manual smoke in `pnpm dev`:
  - Right-click a thumbnail; check items, single + multi selection.
  - Toggle dark mode; confirm shape preview outlines visible.
  - Click Select / Text / Shape; confirm only one is pressed at a time and ESC also returns to Select.
