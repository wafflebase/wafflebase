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
- ~~`getCanvasOffsetTop` returns `-Theme.pageGap` (pure logical pixels),
  so once `getScaleFactor` returns the real scale, the y-axis math
  works out automatically~~ **Wrong** — see follow-up below.

## Follow-up: Y-axis sibling of the same bug

User report after the first fix landed: x lands correctly but y is
still off; clicking paragraph N puts the caret in paragraph N+1 at
scale ≠ 1.

Root cause: `TextEditor.getPositionFromMouse` computes
`(clientY - rect.top - canvasOffsetTop) / scale`. The `clientY -
rect.top` term is in HOST pixels, so `canvasOffsetTop` has to be in
host pixels too — but the shim returned the raw logical `-Theme.pageGap`.
At scale ≠ 1 every click y picked up an extra
`(1 - scale) * pageGap / scale` logical pixels of bias. At
scale = 0.5 that's an extra 40 px, enough to skip ~2 paragraphs.

Fix: `getCanvasOffsetTop: () => -Theme.pageGap * scale`. At scale = 1
this is a no-op (matching the prior behaviour), so the docs full-doc
factory and the existing slides-text-box smoke tests are unaffected.

Regression test added: `y-axis: a click on a specific paragraph lands
in that paragraph at scale != 1` in
`packages/slides/test/view/editor/text-box-click-scale.test.ts` —
4 paragraphs, click at host y = 15 at scale = 0.5 must land in `p2`;
pre-fix it lands in `p3`.
