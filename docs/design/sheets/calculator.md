---
title: calculator
target-version: 0.2.0
---

# Calculator

## Summary

The calculator recalculates formulas after cell changes, propagating updates
through a dependency graph in topological order. It detects circular references
— both within a single sheet and across multiple sheets — and marks them with
`#REF!`.

### Goals

- Recalculate dependent cells in topological order after any cell change.
- Detect circular references and mark them with `#REF!` instead of looping.
- Detect cross-sheet circular references (e.g., Sheet1!A1 → Sheet2!B1 →
  Sheet1!A1) via a global dependency graph.

### Non-Goals

- Server-side recalculation — all computation runs in the browser.
- Real-time cross-client cycle detection — each client detects cycles
  independently during its own recalculation pass.

## Proposal Details

### Single-Sheet Recalculation

Source: `packages/sheets/src/model/worksheet/calculator.ts`

**Algorithm:**

1. **Build dependants map** — `Sheet.setData` calls
   `store.buildDependantsMap(srefs)` to get a map of `Sref → Set<Sref>`
   (which cells are depended upon by which formula cells). Cross-sheet refs
   are excluded from this map since they are resolved through a different
   mechanism.
2. **Topological sort** — `topologicalSort(dependantsMap, refs)` performs a
   DFS on the dependants graph:
   - Tracks `visited` and `stack` (in-progress) sets to detect cycles.
   - When a cycle is detected, all refs currently on the stack are added to
     `cycledRefs`.
   - Returns `[sortedRefs, cycledRefs]` with refs in evaluation order
     (reversed post-order).
3. **Evaluate** — For each ref in topological order:
   - If the ref is in `cycledRefs`, its value is set to `#REF!`.
   - Otherwise, `expandUnboundedRanges` rewrites whole-column/row/open-ended
     ranges (e.g. `A:A`, `1:1`, `A1:B`) to concrete ranges clamped to the
     used bounds, `extractReferences` finds all referenced cells,
     `fetchGridByReferences` loads their current values (including
     cross-sheet data), `evaluateWithSpill` computes the result, and the cell
     is updated.
   - No-op writes are skipped when the evaluated result matches the existing
     cell value to reduce CRDT churn.

**Array spill** — `evaluateWithSpill` may return a `SpillResult` (a 2-D block
of `values` with `rows`/`cols`) instead of a scalar. When it does, the
calculator writes the top-left result to the anchor cell (tagged with
`spillRows`/`spillCols`) and fills the rest of the block with ghost cells
carrying a `spillAnchor` back-reference. Before re-evaluating, an anchor's
prior ghosts are cleared. The footprint is screened by
`sheet.findSpillBlocker`, which owns the rule: real user data (a cell with a
value/formula and no `spillAnchor`) blocks, and so does any cell belonging to a
**merged block** — a covered ref resolves onto the merge anchor, so a ghost
written there would overwrite the anchor instead of filling the block, and the
anchor's own cleanup (reading through the same resolution) could never remove
it again. When something blocks, the anchor shows `#REF!` with
`spillBlocked: true`, no ghosts are written, and the blocker is recorded via
`sheet.registerSpillBlocker`; a subsequent unblocked evaluation clears it via
`sheet.clearSpillBlockers`.

**The unblocking contract** — nothing re-evaluates an anchor on its own, so
every gesture that erases or overwrites a cell owes the blocked anchor a fresh
attempt: it consumes the registration (`consumeSpillBlocker`) and hands the
anchor to `recalculateWithUnblocked`, which folds the anchor into the changed
set *before* the dependants map is built so formulas reading the spill are
re-evaluated too. `setData`, `removeData`, `moveRangeTo`, cut-`paste`,
`mergeSelection`, `unmergeSelection`, and `autofill` all follow it; a clearing
path that skips it leaves the anchor stuck on a `#REF!` no longer true. Two
consequences of the map being a *side effect of calculation*: a path that
replaces cell data without calculating (`undo`/`redo`, opening a document) has
to derive it again with `sheet.loadSpillBlockers`, and a merge that erases a
blocker does not resurrect the spill — the block it just created blocks in the
erased data's place, until `unmergeSelection` releases it.

**Ghosts never travel** — a ghost is derived from its anchor, so a copy of one
names an anchor that does not spill there and then reads as user data blocking
that anchor's own re-spill. `moveRangeTo` and cut-`paste` therefore drop a
ghost whose anchor travels with it (the anchor re-creates it on landing) and
delete a ghost the anchor leaves behind, clear the destination offsets the
ghosts would have covered — the offsets belong to the moved block, so data left
there would survive inside it — and materialize a copy-pasted ghost into the
static value an external paste would have produced. `clearCellForOverwrite` is
the single clearing primitive behind the merge and move paths: it drops an
anchor's ghosts before clearing it, removes a ghost whose position is being
taken and re-queues its anchor, keeps styles, and consumes the position's
blocker registration.

```text
setData(ref, value)
  │
  ├── store.set(ref, cell)
  ├── store.buildDependantsMap([ref])  ──→  { A1 → {B1, C1}, B1 → {D1} }
  └── calculate(sheet, dependantsMap, [ref])
        │
        ├── topologicalSort(...)  ──→  [A1, B1, C1, D1], cycled={}
        └── for each sref in sorted:
              ├── expandUnboundedRanges(formula, usedBounds)
              ├── extractReferences(formula)
              ├── fetchGridByReferences(refs)  ──→  Grid (including cross-sheet data)
              └── evaluateWithSpill(formula, grid)  ──→  value or SpillResult
```

### Cross-Sheet Recalculation

Cross-sheet dependencies are **not** included in `buildDependantsMap` — both
`MemStore` and `YorkieStore` skip refs where `isCrossSheetRef(r)` is true.
This means local `setData` recalculation does not automatically propagate
across sheets.

Instead, cross-sheet recalculation is handled explicitly:

- **`Sheet.recalculateCrossSheetFormulas()`** — Scans formula cells, selects
  only formulas that include at least one cross-sheet reference, and runs a
  dependency recalculation pass. Starting from cross-sheet roots still
  propagates through local dependant chains while avoiding unrelated
  local-only formula recalculation.

- **`Spreadsheet.recalculateCrossSheetFormulas()`** — Calls the Sheet method
  and then re-renders.

#### Cross-sheet formula cache

The set of local cells with cross-sheet references is cached in
`crossSheetFormulaSrefs`. The cache is invalidated on formula mutations
(`setData`, `removeData`, `shiftCells`, `moveCells`, `paste`,
`sortFilterByColumn`).

### Cross-Sheet Cycle Detection

#### Problem

Without cross-sheet cycle detection, formulas like `Sheet1!A1 = =Sheet2!B1`
and `Sheet2!B1 = =Sheet1!A1` are silently accepted. The local dependency map
never sees the cycle because cross-sheet refs are skipped during
`buildDependantsMap`.

#### Solution: Global Dependency Graph

When a `FormulaResolver` is available (see [formula.md](formula.md)),
`recalculateCrossSheetFormulas` builds a **global dependency graph** that
includes cross-sheet edges before running `topologicalSort`.

**Algorithm (`buildGlobalDependantsMap`):**

1. Start with the local dependants map (single-sheet edges only).
2. For each local cross-sheet formula cell, add cross-sheet edges to the
   global map. For example, if `A1 = =Sheet2!B1`, add edge
   `SHEET2!B1 → A1`.
3. Use BFS to follow transitive cross-sheet dependencies: fetch formula
   strings from remote sheets via `FormulaResolver`, and add their
   dependency edges to the global map.
4. Normalize references back to the current sheet using `sheetName`
   (e.g., `SHEET1!A1` → `A1` when running on Sheet1) so local and
   cross-sheet keys match in the graph.
5. Feed the global map into `topologicalSort`, which detects cycles spanning
   any number of sheets.

```text
Sheet1!A1 = =Sheet2!B1
Sheet2!B1 = =Sheet1!A1

buildGlobalDependantsMap:
  local map:       (empty — cross-sheet refs skipped)
  + cross-sheet:   SHEET2!B1 → {A1}         (A1 depends on Sheet2!B1)
  + BFS Sheet2:    A1 → {SHEET2!B1}         (Sheet2!B1's formula =Sheet1!A1
                                              → SHEET1!A1 normalized to A1)

topologicalSort({SHEET2!B1 → {A1}, A1 → {SHEET2!B1}}, [A1]):
  DFS: A1 → SHEET2!B1 → A1 (in stack) → CYCLE
  cycled = {A1, SHEET2!B1}

Result: A1 gets #REF!
```

#### Transitive Cycles

The BFS traversal follows cross-sheet references transitively, so cycles
spanning three or more sheets are detected:

```text
Sheet1!A1 = =Sheet2!A1
Sheet2!A1 = =Sheet3!A1
Sheet3!A1 = =Sheet1!A1  →  cycle detected, A1 = #REF!
```

#### Backward Compatibility

When no `FormulaResolver` is set, `buildGlobalDependantsMap` returns the
local dependants map unchanged. Cross-sheet cycle detection is skipped but
everything else works as before.

### Frontend Triggers

Source: `packages/frontend/src/app/spreadsheet/sheet-view.tsx`

1. **Resolver setup** — When a `SheetView` mounts, it sets both a
   `GridResolver` (cell data) and a `FormulaResolver` (formula strings) that
   look up other sheet tabs in the Yorkie document by name
   (case-insensitive).

2. **Remote changes** — `doc.subscribe("remote-change")` triggers a coalesced
   recalculation flow. Only cell/merge/tab-name changes are relevant; other
   operations (styles, dimensions) are filtered out. If multiple events
   arrive while recalculation is running, they are merged into one follow-up
   pass.

3. **Tab switch** — When the user switches tabs, the `SheetView` component
   re-mounts and calls `recalculateCrossSheetFormulas()` on initialization,
   so any changes made in other sheets are reflected immediately.

## Risks and Mitigation

**Circular references** — The calculator's topological sort detects cycles
(both single-sheet and cross-sheet) and marks affected cells with `#REF!`
rather than entering an infinite loop.

**Cross-sheet stale values** — Because cross-sheet refs are excluded from the
local dependants map, values can become stale until
`recalculateCrossSheetFormulas()` is called. The frontend mitigates this by
calling it on tab switch and remote changes.

**Performance** — Cross-sheet refresh starts from cross-sheet formula roots
only (not all formulas), and calculator writes are skipped when evaluated
results are unchanged. Additional mitigations:

1. Batched writes during recalculation to reduce transaction overhead.
2. Coalesced remote-change triggers in the frontend to avoid overlapping
   recalculation runs.
3. Cross-sheet formula cell cache avoids repeated full-grid scans.
4. Remote-change event filtering skips irrelevant operations (styles,
   dimensions).
