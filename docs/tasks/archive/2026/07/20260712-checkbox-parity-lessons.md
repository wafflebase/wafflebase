# Lessons — checkbox parity follow-ups

## Store batches do not nest — use the `removeData` pattern for multi-cell writes

`Sheet.setData` calls `store.beginBatch()/endBatch()` internally, and the store's
batches **do not nest** (`docs/design/sheets/batch-transactions.md`:177). My first
`toggleCheckboxesInRange` looped `setData` inside an outer batch; each inner
`endBatch` flushes its own `doc.update`, so the result is N undo units, not one —
the outer batch is dead. The correct precedent is `removeData`: one outer
`beginBatch`, low-level `store.set(anchor, compactCell(...))` per cell, then
`calculate` over the changed srefs, all inside the single batch.

**Rule:** to write many cells as one undo unit, mirror `removeData` (low-level
store + `calculate`), never loop `setData`. Check whether a helper self-batches
before wrapping it.

## A range op must not scan the raw selection — bound to what it acts on

The happy-path loop walked every coordinate of the selection rectangle. A
whole-column / Ctrl+A selection is up to 1,000,000 × 18,278 cells → the tab
hangs. The fix: bound the scan to the intersection of the selection with the
**checkbox rules' own ranges** (the cells the op actually touches), plus a cap
that bails to a no-op (the `setRangeBorders` `MaxBorderSelectionCells`
precedent). `removeData` sidesteps this differently — it iterates only populated
cells via `getGrid(range)` — but a checkbox toggle must also reach empty ruled
cells, so intersect-with-rules + cap is the right bound here.

**Rule:** any op driven off a user selection must bound its work to the cells it
truly acts on and cap pathological whole-row/column/all selections; never
iterate the raw selection densely.

## Copy the full read-only guard set from the write path you're replacing

Replacing `setData` with low-level `store.set` also drops `setData`'s guards.
The review caught three: `spillAnchor` (spill ghosts are read-only, and have no
`.f` so the formula check misses them), `pivotDefinition` (no writes on a pivot
sheet), and the spill-anchor cleanup. When bypassing a high-level mutation for a
low-level one, enumerate every guard/side-effect the high-level path performs and
carry the relevant ones over.

## Deliberately diverging from a sibling path can be the correct call

The review flagged that the range path stores the raw checkbox value while the
single-cell path normalizes via `inferInput`. But `isCheckboxChecked`
exact-matches custom values, so normalizing `"01"→"1"` would *break* a custom
`checkedValue` — the raw store is the correct side. Don't reflexively "align"
with a sibling; verify which behavior is actually right first. Relates to
[[feedback_debug_root_cause]].

## Merge-aware hit-tests: resolve covered ref → anchor, use the merged rect

An in-cell control glyph is drawn once, centered in the full merged rect (the
renderer passes `mergeSpan` to `toCellRect`). The hit-test used the single
anchor-cell rect, so the clickable target drifted. Fix: resolve the clicked ref
to its merge via `Sheet.getMergeRangeForRef` (covered cells → anchor) and reuse
`getCellInputRect` (already merge-expanding) for the rect. Any glyph/hit-test
pair must compute geometry from the *same* rect.
