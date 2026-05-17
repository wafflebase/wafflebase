# Slides text-box click position wrong at scale ≠ 1

## Problem

Clicking inside a slides text-box places the caret at the wrong position
when the editor is rendered at any scale other than 1 (i.e. essentially
every real session, since `scale = hostWidth / SLIDE_WIDTH`). The
symptom is especially obvious on center / right aligned paragraphs:
clicking on visually rendered text makes the caret jump to offset 0 of
the block.

## Root Cause

`packages/docs/src/view/text-box-editor.ts` mounts the docs `TextEditor`
with `getScaleFactor = () => 1`. The slides text-box container is
sized in **host pixels** (`frame.w * scale`) but the layout is computed
in **logical pixels** (`contentWidth = frame.w`).
`TextEditor.getPositionFromMouse` does `x = (clientX - rect.left) / s`,
so with `s = 1` the click coords come out in host pixels and are
compared against logical-pixel `run.x` values that include the
alignment offset. Clicks on the visible text land left of `firstRun.x`
→ snap to `offset 0`.

`findPositionAtPixel` itself handles alignment correctly — the bug is
strictly in the coord-space conversion at the shim boundary.

## Plan

- [x] Reproduce with a failing unit test
- [x] Add `scale` to `TextBoxEditorOptions`, plumb through to the
      `TextEditor` `getScaleFactor` shim
- [x] Update `mountSlidesTextBox` to forward `opts.scale`
- [x] Add scale != 1 case to slides text-box-editor test
- [x] `pnpm verify:fast` green
- [x] Commit

## Notes

- The shim already accounts for HiDPI via `dpr` (which is
  `browser_dpr * scale`); that path only affects the canvas bitmap,
  not the pointer math.
- `getCanvasOffsetTop` returns `-Theme.pageGap` (pure logical pixels),
  so once `getScaleFactor` returns the real scale, the y-axis math
  works out automatically: `(clientY - rect.top - (-pageGap)) / scale`
  = logical y + pageGap, which is what `paginatedPixelToPosition`
  expects for the shim's single page at pageIndex 0.
