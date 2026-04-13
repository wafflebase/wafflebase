# Random Axis ID — Fix Concurrent Row Insert Duplicate Bug

## Problem
`createWorksheetAxisId(prefix, number)` uses shared `nextRowId` counter, causing
duplicate row IDs when two clients insert rows simultaneously (observed: `r93`
appears at both row 15 and row 30 in production document).

## Tasks

- [x] 1. Change `createWorksheetAxisId()` in `worksheet-record.ts` to generate 4-char base36 random IDs
- [x] 2. Update `ensureAxisLength()` in `worksheet-grid.ts` to drop counter dependency
- [x] 3. Update `ensureAxisLength()` + `insertYorkieWorksheetAxis()` in `yorkie-worksheet-axis.ts`
- [x] 4. Add concurrency test for simultaneous row insert producing unique IDs
- [x] 5. Run `pnpm verify:fast` and confirm pass
