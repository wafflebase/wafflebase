# Slides — text overflowing a cell/shape box is clipped while editing

## Problem

When text overflows the cell width during text-edit mode, the overflow
is not shown. After committing, the overflowing text renders normally.

## Root cause

Asymmetric clipping between the in-place editor and the committed
renderer:

- **Editing**: `mountSlidesTextBox` creates a single `<canvas>` sized
  exactly to the editFrame (cell inner rect). The canvas bitmap is the
  only clip — `paintLayout` draws every run with no `contentWidth`
  clip — so glyphs past `frame.w` / `frame.h` are cut at the bitmap
  edge.
- **Committed**: `paintCellContents` / `paintShapeText` translate to the
  box origin and call `paintTextBody` with **no `ctx.clip()`**. Overflow
  spills onto the full slide canvas, clipped only at the slide bounds.

So the same overflow exists in both, but only the editor clips it.

## Approach (option A — make editing match the committed render)

The committed render effectively clips at the slide canvas. Enlarge the
editing canvas to the slide's right/bottom edge so overflow paints
identically, while keeping the interactive box at the cell size.

- `container` stays editFrame-sized: outline, mouse listeners, and all
  `getBoundingClientRect` math live on the container, so click→cursor
  mapping is unchanged. Set `container.style.cursor = 'text'` (the
  `pointer-events: none` canvas no longer carries the I-beam).
- `canvas` grows to `max(frame, slideEdge - frame.origin)` and gets
  `pointer-events: none` so overflow-region clicks fall through to
  "click-outside-to-commit".
- `contentWidth/contentHeight` stay `frame.w/h` → wrapping + vertical
  anchor unchanged; only the paint surface grows.
- Gate: `growMode === 'never'` (shapes + cells). Auto-grow text
  elements never overflow, so they keep the frame-sized canvas.

Known limitation: only right/bottom overflow is covered. Left/top
overflow (center/right-aligned long tokens, middle/bottom-anchored
vertical overflow) stays clipped while editing; the common
top-left-anchored cell case is fully fixed.

## Plan

- [x] Root-cause investigation (systematic-debugging)
- [x] `MountSlidesTextBoxOptions.overflowBounds?: { width; height }`
- [x] Wrapper: enlarge canvas + pointer-events none + container cursor
- [x] editor.ts: pass overflowBounds for shape/cell (not text)
- [x] Wrapper unit test: canvas size / pointer-events / container size
- [x] Editor test: cell dblclick passes overflowBounds to slide bounds
- [x] `pnpm test` (slides, 258 files) + `pnpm verify:fast` — both green

## Review

- `text-box-editor.ts` — added `overflowBounds`. When set and larger than
  `frame`, the canvas grows to that logical size and gets
  `pointer-events: none`; the container stays frame-sized and gains
  `cursor: text` (the docs editor's I-beam rides on the canvas, which no
  longer receives pointer events). All mouse handling / rect math in the
  docs `TextEditor` is bound to the **container**, so cursor placement is
  unchanged; only the paint surface grows.
- `editor.ts` — passes `overflowBounds` for every non-text target
  (`growMode === 'never'`: shapes + cells), extending to the slide
  right/bottom edge. Shapes share the identical commit-vs-edit clip
  mismatch, so they are fixed by the same gate.

Verification: `text-box-overflow.test.ts` (3 cases — grow + pointer-events,
no-bounds no-op, bounds==frame no-op) and a new `cell-text-edit-entry`
case asserting the editor extends to `SLIDE_WIDTH/HEIGHT - frame.origin`.
Full slides suite (258 files, 1793 passed) + `verify:fast` green.

Known limitation (documented in todo): only right/bottom overflow is
covered; left/top overflow (center/right-aligned long tokens,
middle/bottom-anchored vertical overflow) stays clipped while editing.
