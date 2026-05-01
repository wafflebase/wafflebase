---
title: Table row resize handle missing on page 2 — drag guideline off-screen
date: 2026-05-01
status: in_progress
---

# Row resize drag guideline does not appear when scrolled to page 2

## Symptom

On a multi-page document, scrolling to page 2 and starting a row
resize drag (`row-resize` cursor) on a table cell border:

- Cursor changes to `row-resize` correctly.
- Drag is accepted (mousedown starts the drag, applies on mouseup).
- **But the blue dashed guideline that should appear under the cursor
  during drag is invisible.**
- Column drag guideline (vertical) stays visible.

## Root cause

`editor.ts` draws the drag guideline AFTER `docCanvas.render()` returns.
`render()` does its drawing inside `ctx.save()` / `ctx.restore()` with
a `translate(0, -scrollY)` and a `scale(scaleFactor, scaleFactor)`
applied. After it restores, the canvas context is back to identity.

But `dragGuideline.x` / `dragGuideline.y` are in **unscaled document
coordinates** (set by `TextEditor.handleMouseMove` from `mouseY` =
`(e.clientY - rect.top - canvasOffsetTop) / s + scrollTop / s`). The
guideline draw used these directly as canvas pixel coords:

```ts
ctx.moveTo(0, dragGuideline.y);
ctx.lineTo(canvasWidth, dragGuideline.y);
```

When scrolled to page 2 with `scrollTop ≈ 1118`, `dragGuideline.y`
becomes ~1605 (absolute doc coord). Drawing at canvas pixel y=1605
falls way below the visible canvas area (~787 pixels tall), so the
horizontal line is rendered off-screen.

The vertical (column) guideline accidentally works because
`scrollLeft` is almost always 0 in this app — drawing at canvas pixel
x = `dragGuideline.x` happens to land at the right viewport position.
With horizontal scroll it would break the same way.

## Fix

In `editor.ts` guideline draw, convert the unscaled doc coords to
canvas pixel coords by subtracting the scroll and applying the scale:

```ts
const x = (dragGuideline.x - container.scrollLeft / scaleFactor) * scaleFactor;
const y = (dragGuideline.y - scrollY) * scaleFactor;
```

`scrollY` is already in scope (`container.scrollTop / scaleFactor`).

## Bonus refactor in same change

While investigating, I also extracted a shared
`getTableOriginYForPageLine(pageY, pl, rowYOffsets)` helper in
`pagination.ts` so `DocCanvas` (renderer) and `TextEditor`
(`resolveTableFromMouse`, hit-test) compute the same virtual table
origin. The previous resolver formula dropped the `rowSplitOffset`
term that the renderer used, so on a page where the table starts
with a split-row continuation the row-border hit area was offset by
the page-1 fragment height. This was a real latent bug; even if it
wasn't the user's primary complaint, the refactor prevents the two
formulas from drifting apart again.

## Tasks

- [x] Reproduce the missing guideline via puppeteer drag simulation
      on the user's shared URL (page 2 row drag → no guideline)
- [x] Identify root cause: editor.ts guideline draw uses unscaled
      doc coords as canvas pixel coords
- [x] Apply fix: convert to canvas pixels by subtracting scroll and
      scaling
- [x] Verify guideline visible on row drag at page 2 via puppeteer
- [x] Verify column guideline still visible (no regression)
- [x] Keep helper extraction (`getTableOriginYForPageLine`) — fixes
      latent split-row hit-test bug
- [ ] Investigate follow-up: cell resize on page 2 with cursor on
      page 1 scrolls back to page 1
- [ ] Run `pnpm verify:fast`
- [ ] Move work to a worktree + feature branch (per user request)
- [ ] Archive task and update index
