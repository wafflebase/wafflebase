# Slides — table cell text-edit box shrinks on entry

## Problem

Double-clicking a table cell to enter text-edit mode collapses the
editing box to the text height instead of keeping the full cell size.

## Root cause

`enterEditMode` passes `growMode` to the text-box mount as:

```ts
growMode: target.kind === 'shape' ? 'never' : 'auto',
```

Only shapes get `'never'`; cells fall through to `'auto'`. Combined
with the cell's `autofit: 'none'`, `text-box-editor.ts` computes
`allowEditorGrow = true`, so the editing canvas resizes to the content
height — shrinking a tall cell down to a single text line.

Cells are structurally identical to shapes here: fixed box, vertical
anchor, and row auto-grow happens only on commit via the renderer
(`computeTableLayout`'s `max(declared, contentHeight)` rule). So the
editing box must stay at the cell's inner-frame height → `growMode:
'never'`, exactly like shapes.

## Plan

- [x] Investigate root cause (systematic-debugging)
- [x] Failing test: dblclick a cell asserts mount `growMode === 'never'`
      and the editFrame keeps the cell's inner height
- [x] Fix: `editor.ts` growMode → `target.kind === 'text' ? 'auto' : 'never'`
- [x] `pnpm test` (slides) green — 257 files, 1789 passed
- [x] `pnpm verify:fast` — EXIT 0
- [x] Self code-review over the branch diff
- [x] PR

## Review

Three-line behavioural change plus a test-env stub gap:

- `editor.ts` — cell text-edit now passes `growMode: 'never'` (was
  `'auto'`). Shapes already did this; cells are structurally identical
  (fixed box, vertical anchor, row auto-grow deferred to commit-time
  renderer). The other two grow-related gates (`editingGrowApplicable`
  and the commit-time frame fit) were already `kind === 'text'`-only, so
  the mount `growMode` was the lone inconsistency.
- `test-canvas-env.ts` — added `setLineDash`/`getLineDash` noop stubs.
  Rendering a `table` element through the editor in jsdom was previously
  untested; the table border renderer calls `setLineDash`, which the
  fake 2D context lacked.

Verification: new `cell-text-edit-entry.test.ts` goes red (`'auto'`)
before the fix, green after. Full slides suite + `verify:fast` green.
