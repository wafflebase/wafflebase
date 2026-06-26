# DOCX table deferred follow-ups — lessons

## Verify the stated root cause before implementing it

The todo claimed structural HF edits were no-ops because "the table store
ops (`resolveTableBlock` / `findTableIndex` / `resolveTableTreePath`) assume
the body path." Those functions don't exist, and the store table ops
(`insertTableRow`, etc.) were *already* region-aware (keyed by block id via
`findBlock` → `findBlockInAnyArray`). The real blockers were elsewhere:

1. Body-only block-array reads (`this.doc.document.blocks`) in
   `ensureBlockAfter`, `getPositionBeforeTable`, `getPositionAfterTable` —
   these already used the context-aware `getBlockIndex()` for the index but
   then indexed into the body array. Switch to `getContextBlocks()`.
2. The `editContext === 'body'` guards in `text-editor.ts`.
3. The editor API table commands resolving the cursor cell via the
   **body-only** `layout.blockParentMap`. The merged body+header+footer map
   lives on `doc.blockParentMap` (built in the render loop, line ~1140).

Lesson: when a todo names a mechanism, grep for it first. Map the real data
flow rather than trusting the description.

## Two parallel block-parent maps exist — pick the right one

`editor.ts` keeps a body-only `layout.blockParentMap` and a merged
`doc.blockParentMap` (= body ∪ header ∪ footer, set via
`doc.setBlockParentMap`). Anything that must work across regions (table
structural commands, `isInTable`, merge context) must use `doc.blockParentMap`.
`doc.editContext` is kept in sync by `setEditContext` (line 222), so
`doc.getContextBlocks()` / `getBlockIndex()` resolve correctly from the API.

## Don't let a width fallback re-enable structural hardening

First cut derived `columnWidths` from `tcW` *before* computing the structural
`numCols`, which re-enabled the grid shape-hardening (clamp, gridBefore
padding) that the gridless tests intentionally disable — silently dropping
cell content. Fix: keep the structural `numCols` gated on the real
`<w:tblGrid>` (0 when absent) and derive render-time `columnWidths`
*after* the row loop. Structural behavior and rendering width are separate
concerns; don't couple them through one array length.

## Mirror existing behavior exactly for affinity math

The HF caret resolvers had the same wrap-boundary bug the body resolver
(`resolvePositionPixel`) already solved. Copy the exact condition
(`affinity === 'forward' && remaining === lineChars && li < end - 1` →
jump to next line) rather than reinventing it, so all caret paths agree.

## Scope notes that became "known limitations"

- Absolute `<w:tblW>` import needs a model field (`TableData` only has
  fractional `columnWidths`). Calling that out kept the item honest rather
  than faking support.
- PDF export doesn't paint HF tables at all (`paintHFRegion` walks only
  `lb.lines`), so the page-number-in-HF-table fix is canvas-only. Checking
  the sibling renderer surfaced that the todo's "shared with PDF painter"
  note was inaccurate.
