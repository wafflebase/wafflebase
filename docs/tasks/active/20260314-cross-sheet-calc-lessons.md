# Cross-Sheet Calculation Improvements — Lessons

## Phase 1 re-evaluation
- Initial analysis identified "local edits don't update other sheets" as a bug,
  but the actual architecture only maintains one Sheet instance at a time.
  Tab switch already calls `runCrossSheetRecalc()`.
- **Lesson:** Verify architecture at the code level before defining problems.
  Distinguish between theoretical issues and actual bugs.

## Yorkie remote-change event structure
- `event.value.operations` exposes each op's `path` field for change location
- Path format: `$.sheets.<tabId>.cells...`
- Non-cell changes (styles, dimensions) also arrive as remote-change events,
  so filtering is necessary to avoid unnecessary recalculation
