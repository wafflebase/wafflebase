# Concurrency Move Tests — Add Missing Concurrent Editing Test Scenarios

**Goal:** Add move-rows/move-columns concurrent editing tests and fill coverage gaps in the concurrency matrix.

**Status:** DONE

## Completed

- [x] Task 1: Add move-rows/move-columns to ConcurrencyOp type
- [x] Task 2: Add move op handling to concurrency drivers (concurrency-driver.ts + two-user-yorkie.ts)
- [x] Task 3: Add move vs value-edit concurrency cases (3 cases)
- [x] Task 4: Add move vs structural-change concurrency cases (4 cases)
- [x] Task 5: Add move vs formula concurrency case (1 case)
- [x] Task 6: Add column-symmetric and gap-coverage cases (3 cases)
- [x] Task 7: Register new cases in Yorkie concurrency test
- [x] Task 8: Run verify:fast — all pass

## New cases added (11 total)

| # | Case | Category |
|---|------|----------|
| 1 | value edit vs row move forward | move + value |
| 2 | value edit vs row move backward | move + value |
| 3 | value edit vs column move forward | move + value |
| 4 | row move vs row insert at same index | move + structure |
| 5 | row move vs row delete at source | move + structure |
| 6 | row move vs row move (different rows) | move + move |
| 7 | column move vs column insert at same index | move + structure |
| 8 | formula reference vs row move | move + formula |
| 9 | column insert at adjacent indexes | gap coverage |
| 10 | row delete at different indexes | gap coverage |
| 11 | column delete vs column insert adjacent | gap coverage |

Total: 24 → 35 concurrency cases.
All new cases are characterization cases (aThenB ≠ bThenA in serial execution).
