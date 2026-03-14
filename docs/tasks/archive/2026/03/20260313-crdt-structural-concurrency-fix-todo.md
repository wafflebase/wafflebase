# CRDT Structural Concurrency Fix

Implement a concrete fix for the structural concurrency bug now that the
problem space and reproductions are encoded as tests.

## Target

Make the known structure-heavy concurrent edit cases behave closer to the
serial intent oracle without regressing the existing value-vs-structure cases.

## Required Repros

- `row insert vs row insert at same index`
- `row insert vs row delete at same index`
- `column insert vs column insert at same index`
- `column insert vs column delete at same index`
- `column delete vs column delete at same index`
- `row delete vs row delete at same index`
- `row insert vs row insert at adjacent indexes`
- `row delete vs row insert at adjacent indexes`

## Tasks

- [x] Re-inspect the current `shiftCells` path and identify the exact source of
      non-serial structural results
- [x] Evaluate whether a local deterministic transform can stabilize the
      existing coordinate-key model
- [x] If not, define the smallest structural metadata change needed to carry
      stable ordering intent across collaborators
- [x] Implement the chosen fix
- [x] Verify the red repro slice improves as intended
- [x] Record tradeoffs and residual risks

## Findings

### 1. The current failure is fundamental to coordinate-key remapping

`YorkieStore.shiftCells()` rewrites the entire worksheet by remapping `A1`-style
keys in place. Concurrent structural edits therefore do not merge as
"operations on the same logical row/column order"; they merge as independent
bulk rewrites of derived coordinates.

That explains the observed repros:

- one of two concurrent inserts is effectively lost
- one of two concurrent deletes is effectively lost
- adjacent inserts can duplicate the same logical cell at two coordinates

### 2. A small local patch in `shiftCells()` will not be enough

By the time two structure edits merge, the document no longer contains enough
intent to infer the desired serial result from the final coordinate-key object
alone. The missing information is stable row/column identity.

### 3. The smallest credible fix direction is stable structural identity

The next implementation step should introduce row/column order metadata in the
Yorkie-backed store, then key cell persistence off that stable ordering instead
of raw visual coordinates.

### 4. Stable row/column identity flips most structural repros

The implemented stable grid model stores cells by stable row/column ids and
uses `rowOrder` / `colOrder` to derive visual coordinates. With that change in
place, concurrent insert/insert, insert/delete, and adjacent insert/delete
cases now converge to one of the serial oracles under real two-user Yorkie
sync.

### 5. Concurrent delete/delete still needs a stronger semantic model

Two users deleting the same visual row or column index concurrently still
collapse onto the same stable id. A plain stable-id list CRDT keeps that as a
single delete, but the serial oracle expects two consecutive deletions. Closing
that gap requires an operation-log / delete-marker style model, not another
local remap tweak.

For this iteration, those two delete/delete cases are explicitly deferred and
kept as characterization coverage rather than active acceptance criteria.

## Review

### Implementation

- Added stable grid helpers in `@wafflebase/sheet` for stable cell storage,
  row/column order, and legacy `sheet` projection rebuilds.
- Updated `YorkieStore` to persist cells through stable row/column identity
  while keeping `sheet` as a compatibility projection.
- Moved frontend direct readers and the backend cells API onto stable-grid
  reads/writes so they observe the authoritative cell state.

### Verification

- `pnpm --filter @wafflebase/sheet test concurrency-matrix.test.ts`
- `pnpm --filter @wafflebase/frontend test tests/app/spreadsheet/yorkie-concurrency.test.ts`
- `YORKIE_RPC_ADDR=http://localhost:8080 pnpm --filter @wafflebase/frontend test tests/app/spreadsheet/yorkie-concurrency.test.ts`
- `YORKIE_RPC_ADDR=http://localhost:8080 YORKIE_RUN_KNOWN_FAILURES=1 pnpm --filter @wafflebase/frontend test tests/app/spreadsheet/yorkie-concurrency-repro.test.ts`

### Outcome

- Resolved under real Yorkie sync:
  - `row insert vs row insert at same index`
  - `row insert vs row delete at same index`
  - `column insert vs column insert at same index`
  - `column insert vs column delete at same index`
  - `row insert vs row insert at adjacent indexes`
  - `row delete vs row insert at adjacent indexes`
- Still failing:
  - `row delete vs row delete at same index`
  - `column delete vs column delete at same index`
- Deferred this iteration:
  - the two remaining delete/delete same-index cases are no longer treated as
    current-scope red repros
