# Checkbox range-uniform Space toggle

Phase-1 deferred item (`docs/design/sheets/data-validation.md`, "Space —
toggles the active cell only. Range-uniform Space ('set all checked', GS/Excel
parity) is deferred").

## Goal

Pressing **Space** with a range selected toggles every checkbox-ruled cell in
the range **uniformly** (Google Sheets / Excel parity):

- If **all** checkbox cells in the selection are currently checked → uncheck all.
- Otherwise (some or none checked) → check all.

Formula-backed checkbox cells are read-only and skipped (consistent with the
just-shipped `toggleCheckboxAt` guard). The whole set is a single undo unit.
Cells without a checkbox rule in the selection are left untouched. A single-cell
selection behaves exactly as today (toggle that one cell).

## Plan (TDD)

- [x] Model helper: export `checkboxValue(rule, checked)` from
      `data-validation.ts`; `toggleCheckboxValue` reimplemented on top of it.
- [x] Sheet method `toggleCheckboxesInRange(range)`: collect checkbox-ruled,
      non-formula cells; uniform target = `!allChecked`; write via the
      **`removeData` pattern** (one outer batch + low-level `store.set` +
      `calculate`), NOT a `setData` loop — see lesson below.
- [x] Sheet tests: all-checked → all unchecked; mixed → all checked; none →
      all checked; formula cells skipped; non-checkbox cells untouched; single
      cell = toggle; formula dependent recomputes after toggle.
- [x] Wire the Space handler (`worksheet.ts`) to `getRangeOrActiveCell()` via
      the new method (gate unchanged: active cell carries a checkbox rule).
- [x] `pnpm verify:fast` green (EXIT 0).
- [x] Update design doc Phase-1 note (Space range parity now shipped).

## Key implementation note

`setData` self-batches (`beginBatch`/`endBatch` internally) and the store's
batches **do not nest** (`docs/design/sheets/batch-transactions.md`:177). Looping
`setData` inside an outer batch would flush one `doc.update` per cell = N undo
units. Correct pattern (mirrors `removeData`): one outer `beginBatch`, low-level
`store.set(anchor, compactCell({v}, style))` per cell, then `calculate` over the
changed srefs, all inside the single batch. MemStore undo is a no-op, so the
single-undo-unit property is covered by following this precedent, not a unit
test; the formula-recompute test confirms `calculate` runs.

## Out of scope

- Merged-cell checkbox glyph/hit-test alignment (rare, separate follow-up).
- Eager `FALSE` materialization; custom checkbox values UI.

## Review

(filled after implementation)
