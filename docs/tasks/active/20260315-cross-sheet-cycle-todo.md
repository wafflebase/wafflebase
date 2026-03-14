# Cross-Sheet Cycle Detection — Task

## Goal
Detect circular references spanning multiple sheets (e.g., Sheet1!A1 = =Sheet2!B1,
Sheet2!B1 = =Sheet1!A1) and mark them with `#REF!`.

Parent task: `20260314-cross-sheet-calc-todo.md` Phase 5.

## Architecture
Add `FormulaResolver` callback that returns formula strings from other sheets.
In `recalculateCrossSheetFormulas()`, build a global dependency graph including
cross-sheet edges, then run existing `topologicalSort()` to detect cycles.
Sheet knows its own name via `setFormulaResolver(resolver, sheetName)` to
normalize references back to itself (e.g., `SHEET1!A1` → `A1`).

## Phase 1: FormulaResolver type + Sheet integration

- [x] 1-1. Add `FormulaResolver` type to `packages/sheet/src/model/core/types.ts`
- [x] 1-2. Add `formulaResolver` field + `setFormulaResolver()` to Sheet class
- [x] 1-3. Add `buildGlobalDependantsMap()` private method to Sheet
- [x] 1-4. Update `recalculateCrossSheetFormulas()` to use global map
- [x] 1-5. `pnpm test` passes (no regression)

## Phase 2: Tests

- [x] 2-1. Create `packages/sheet/test/sheet/cross-sheet-cycle.test.ts`
      - Simple two-sheet cycle → `#REF!`
      - Transitive three-sheet cycle → `#REF!`
      - Non-cyclic cross-sheet ref → normal value
      - Cycle recovery when broken
      - Backward compat without FormulaResolver
- [x] 2-2. All tests pass (1015/1015)

## Phase 3: Frontend wiring

- [x] 3-1. Wire `FormulaResolver` in `sheet-view.tsx` alongside `GridResolver`
- [x] 3-2. `pnpm verify:fast` passes

## Phase 4: Cleanup

- [ ] 4-1. Update `20260314-cross-sheet-calc-todo.md` Phase 5 as done
- [ ] 4-2. Archive tasks
