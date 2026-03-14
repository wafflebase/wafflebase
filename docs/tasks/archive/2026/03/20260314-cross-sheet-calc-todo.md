# Cross-Sheet Calculation Improvements

## Background

The multi-sheet formula calculation logic has several inefficiencies:
- Every `remote-change` event triggers a full formula scan regardless of relevance
- `recalculateAllFormulaCells` uses a hardcoded 1000x100 range
- No caching for cross-sheet formula cell lookup

Related files:
- `packages/sheet/src/model/worksheet/sheet.ts` — `recalculateCrossSheetFormulas()`, `fetchGridByReferences()`
- `packages/sheet/src/model/worksheet/calculator.ts` — `calculate()`, `topologicalSort()`
- `packages/frontend/src/app/spreadsheet/sheet-view.tsx` — GridResolver, remote-change subscription
- `packages/frontend/src/app/spreadsheet/yorkie-store.ts` — `buildDependantsMap()`, `getFormulaGrid()`
- `packages/sheet/src/store/memory.ts` — MemStore dependency map

---

## ~~Phase 1: Local edit reverse propagation~~ — Not needed

> **Finding:** Only one Sheet instance exists at a time in the current architecture.
> On tab switch, `runCrossSheetRecalc()` is already called (sheet-view.tsx:716),
> so cross-sheet formulas are refreshed when switching to a tab.
> Since there is no inactive Sheet instance to push updates to, reverse
> propagation has no target. Multi-client sync is already handled by
> Yorkie `remote-change` events.

## Phase 2: Cross-sheet formula cell cache (Medium)

`recalculateCrossSheetFormulas()` scans all formula cells via `getFormulaGrid()`
and calls `extractReferences()` + `isCrossSheetRef()` on each one every time.
Cost grows linearly with the number of formulas.

- [x] 2-1. Add `crossSheetFormulaSrefs: Set<Sref> | null` cache field to Sheet class
- [x] 2-2. Invalidate cache on formula mutations (`invalidateCrossSheetCache()`)
      - `setData`, `removeData`, `shiftCells`, `moveCells`, `paste`, `sortFilterByColumn`
- [x] 2-3. Skip full scan in `recalculateCrossSheetFormulas()` on cache hit
- [x] 2-4. All existing tests pass
- [x] 2-5. `pnpm verify:fast` passed

## Phase 3: Remote-change event filtering (High)

Previously every `remote-change` event triggered cross-sheet recalculation,
even for irrelevant changes like style or dimension updates on unrelated sheets.

- [x] 3-1. Investigate path extraction from Yorkie remote-change events
      - `event.value.operations[].path` exposes the changed document path
- [x] 3-2. Filter to cell-data changes only (`$.sheets.<tabId>.cells` pattern match)
- [x] 3-3. `pnpm verify:fast` passed

## Phase 4: Remove hardcoded range in `recalculateAllFormulaCells` (Low)

`sheet.ts` used a fixed `{ r: 1000, c: 100 }` range to scan for formula cells.
Data beyond this range would be silently missed; smaller data caused wasted iteration.

- [x] 4-1. Replace hardcoded range scan with `getFormulaGrid()` call
- [x] 4-2. Verified existing callers (`shiftCells`, `moveCells`, `sortRange`) still work
- [x] 4-3. `pnpm verify:fast` passed

## Phase 5: Global dependency graph — cross-sheet cycle detection (Low)

Each sheet builds its dependency map independently, skipping cross-sheet refs.
Circular references across sheets (e.g. `Sheet1!A1 = Sheet2!A1`,
`Sheet2!A1 = Sheet1!A1`) are not detected and may cause incorrect values.

- [x] 5-1. Design a workbook-level global dependency graph
- [x] 5-2. Include cross-sheet refs in topological sort for cycle detection
- [x] 5-3. Mark cycles with `#REF!` error
- [x] 5-4. Tests for cross-sheet circular reference error handling
- [x] 5-5. `pnpm verify:fast` passed

---

## Priority Summary

| Phase | Description | Severity | Effort | Status |
|-------|-------------|----------|--------|--------|
| 1 | Local edit reverse propagation | — | — | Not needed |
| 2 | Cross-sheet formula cache | Medium | Low | Done |
| 3 | Remote-change event filtering | High | Medium | Done |
| 4 | Remove hardcoded range | Low | Low | Done |
| 5 | Global dependency graph | Low | High | Done |
