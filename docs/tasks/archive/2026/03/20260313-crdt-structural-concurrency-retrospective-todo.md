# CRDT Structural Concurrency Retrospective

Review the current stable-grid based concurrency fix, identify duplicated
state, and propose simplifications.

## Tasks

- [x] Inspect the current stable-grid implementation and identify authoritative
  vs derived state
- [x] Trace duplicated data and consistency-sensitive update paths across
  frontend, backend, and sheet packages
- [x] Summarize risks, simplification candidates, and recommended next steps

## Review

### What Improved

- The fix correctly moved cell identity away from raw coordinate keys and into
  `stableCells + rowOrder + colOrder`, which removes the biggest cause of
  structure-vs-cell merge breakage.
- Read paths in the main spreadsheet runtime now mostly go through stable-grid
  helpers instead of directly trusting `worksheet.sheet`.

### Remaining Complexity

1. The worksheet still persists both authoritative cell state and a full
   coordinate projection.
   - `stableCells` is the real source of truth for concurrency, but `sheet`
     still stores the same cells again.
   - Single-cell edits mirror both copies, and structural operations rebuild
     the whole `sheet` projection.
2. New sheets still start in the legacy shape.
   - Initial document creation and tab creation still seed only `sheet: {}`.
   - That forces lazy migration through `ensureStableGridShape()` and keeps
     fallback logic alive across the codebase.
3. Structural metadata is still mostly visual-index based.
   - Row/column sizes, row/column styles, merges, filters, hidden state,
     charts, and freeze panes still shift by numeric indices rather than stable
     row/column identity.
   - The cell model is more robust than the metadata model.
4. Responsibility is split across layers.
   - `YorkieStore` mutates persisted structure and some metadata.
   - `Sheet` applies a second copy of shift/move semantics for in-memory state.
   - This makes it easy for one path to miss a metadata class.
5. Backend and frontend document types have drift risk.
   - Backend keeps a duplicated `Worksheet` / `SpreadsheetDocument` definition
     that does not model the new stable-grid fields.

### Simplification Direction

1. Make the persisted worksheet model single-source-of-truth.
   - Keep `stableCells`, `rowOrder`, `colOrder`, and id counters as canonical.
   - Stop persisting `sheet` as a mirrored projection.
   - Materialize coordinate snapshots only at read/export boundaries.
2. Introduce a shared worksheet factory and canonical document types.
   - Replace ad-hoc `{ sheet: {}, ... }` construction sites with one helper.
   - Move document types to a shared package/module so backend and frontend use
     the same shape.
3. Collapse structural transforms into shared pure helpers.
   - Reuse existing dimension/range/merge shift helpers instead of repeating
     object-rewrite loops in the Yorkie adapter.
   - Add shared helpers for filter, hidden state, and freeze-pane transforms.
4. Expand stable identity to more metadata.
   - Row/column sizes and styles are the best next candidates.
   - Merge/chart/filter anchoring can follow once axis identity is shared more
     broadly.

### Recommended Next Step

- Treat this iteration as a successful first stabilization of cell concurrency,
  then spend the next cleanup pass removing the persisted `sheet` projection
  and introducing a shared worksheet factory/type layer before attempting
  broader metadata stabilization.
