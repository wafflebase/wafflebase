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

## Approach (option A — make editing mirror the committed slide canvas)

The committed render clips only at the slide canvas. So mount the editing
canvas as a **full-slide surface positioned over the slide** — the box
sits at its slide coordinates inside it — and shift the docs paint so the
box content still lands at the box position. Overflow then paints in
EVERY direction exactly where the committed renderer puts it.

- `container` stays editFrame-sized: outline, mouse listeners, and all
  `getBoundingClientRect` math live on the container, so click→cursor
  mapping is unchanged. Set `container.style.cursor = 'text'` (the
  `pointer-events: none` canvas no longer carries the I-beam).
- `canvas` becomes `SLIDE_WIDTH × SLIDE_HEIGHT`, absolutely positioned at
  `(-editFrame.x, -editFrame.y) * scale`, `pointer-events: none` so
  overflow-region clicks fall through to "click-outside-to-commit".
- New docs option `paintOriginX/Y` (default 0) shifts all painting (runs,
  selection, cursor) by `(editFrame.x, editFrame.y)`. Cancelled by the
  canvas's negative CSS offset, so box content lands at the container
  origin and pointer math (container-relative) is untouched.
- `contentWidth/contentHeight` stay `frame.w/h` → wrapping + vertical
  anchor unchanged.
- Gate: `growMode === 'never'` (shapes + cells). Auto-grow text
  elements never overflow, so they keep the frame-sized canvas.

`initializeTextBox` is called only from the slides wrapper, so the new
docs option is safe (defaults preserve every other path).

## Plan

- [x] Root-cause investigation (systematic-debugging)
- [x] docs `TextBoxEditorOptions.paintOriginX/Y` (default 0) → `paintLayout`
- [x] `MountSlidesTextBoxOptions.overflowBounds?: { left; top; width; height }`
- [x] Wrapper: full-slide canvas, absolute offset, pointer-events none,
      container cursor, `paintOriginX/Y` pass-through
- [x] editor.ts: pass overflowBounds = full slide rect for shape/cell
- [x] Wrapper unit test: canvas size / offset / pointer-events / container
- [x] Editor test: cell dblclick passes full-slide overflowBounds
- [x] docs + slides suites + `pnpm verify:fast` — all green (docs rebuilt)

## Review

- `docs/.../text-box-editor.ts` — added `paintOriginX/Y` (default 0),
  applied to the single `paintLayout` call (which already offsets runs,
  selection, and cursor by its `originX/originY` args). Only the slides
  wrapper calls `initializeTextBox`, so no other path is affected.
- `slides/.../text-box-editor.ts` — `overflowBounds` now describes the
  full paint rect (`left/top/width/height`). When set, the canvas is
  mounted at that size, absolutely positioned at `(-left, -top) * scale`,
  and `pointer-events: none`; the container stays frame-sized and gains
  `cursor: text`. `paintOriginX/Y = left/top` is forwarded so the box
  content lands at the container origin while overflow spills into the
  surrounding canvas in every direction. All mouse / rect math in the
  docs `TextEditor` is container-relative, so cursor placement, IME, and
  click-outside-to-commit are unchanged.
- `slides/.../editor.ts` — passes the whole slide rect (`left = editFrame.x,
  top = editFrame.y, width/height = SLIDE_WIDTH/HEIGHT`) for every non-text
  target (`growMode === 'never'`: shapes + cells), so the editing canvas
  mirrors the committed slide canvas one-to-one. Shapes share the identical
  commit-vs-edit clip mismatch and are fixed by the same gate.

Verification: `text-box-overflow.test.ts` (full-slide canvas + offset +
pointer-events; no-op when bounds absent or zero-margin) and a
`cell-text-edit-entry` case asserting the full-slide overflowBounds. Docs
(59 files) + slides (258 files, 1793 passed) + `verify:fast` green.

Note: `initializeTextBox`'s cosmetic link-hover cursor (set on the now
`pointer-events: none` canvas) no longer shows during shape/cell edit; the
container carries the `text` I-beam. Functionally inert.
