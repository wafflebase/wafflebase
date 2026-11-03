# Lessons — Sheets auto-fit row height (#1115)

## What the bug really was

Not a missing call site. Auto-fit was modelled as an *action* performed by
the local editor after a commit, so it could only ever cover the one write
path that knew to invoke it. Every other writer — the v1 cells API, the
CLI, xlsx import, paste, undo, a remote collaborator — produced the same
stored content and a clipped row.

Modelling it as a *rendering rule* ("a row with no explicit height is as
tall as its content") makes the number of write paths irrelevant.

## Why the fitted height is not persisted

`rowHeights` is the only place a manual height can live, and there is no
flag distinguishing a user-chosen height from a previously auto-fitted
one. Persisting the fit would make every edited row look manual, and the
next API write would then correctly refuse to touch it — re-creating the
reported bug one step later. Keeping the fit in memory keeps the meaning
of a `rowHeights` entry unambiguous: somebody asked for that height.

It also keeps collaborative churn out of the document: N clients viewing
the same sheet would otherwise each race to write the same height.

## Convergence of the re-render

`applyAutoRowHeights` can change row heights, which changes `viewRange`,
which changes the rows fetched on the next pass. Rows that fall *out* of
the fetched range are deliberately left at their current height rather
than shrunk back to the default — without that, growing a row at the
bottom edge would shrink the row that left the range, which would grow the
range again, and the render loop would oscillate.

## The two states a `DimensionIndex` entry can already mean

Moving auto-fit into the render pass made it collide with two existing uses
of the same in-memory row sizes, both found in self-review round 1 and both
blocking:

- **Hidden rows are zero-height rows.** `syncHiddenRowsFromSheet` stores a
  filter-hidden or user-hidden row as `rowDim.setSize(row, 0)`. Sizing that
  row to its content is exactly what un-hides it — and `syncHiddenRows…`
  only zeroes rows on the hidden transition, so it would have stayed
  un-hidden. The pass now skips `this.hiddenRows` on both sides: they are
  excluded from the measurement and left as candidates, so a row shown again
  is re-checked against content that may have changed while it was hidden.
- **A row-border drag has no stored height until mouseup.** `onMove` writes
  the preview size straight into `rowDim`; only `onComplete` persists it. The
  pass would have pulled the row back to its content on every frame of the
  drag, so the gesture would have looked dead. It now returns early while
  `resizeDragging`.

The lesson generalizes: a shared in-memory index is not the same thing as
the document field it was loaded from, and anything that writes to it is
competing with every other writer. The authority for "did somebody choose
this height" has to be the stored `rowHeights`, never `rowDim`.

## Self-review rounds

Round 1 (correctness/tests) — two blocking findings above, both fixed with
regression tests in `test/view/worksheet-auto-row-height.test.ts`. Also
added: skip the stored-height read entirely when there is nothing to size,
which is the whole per-frame cost of the pass on an ordinary sheet.
