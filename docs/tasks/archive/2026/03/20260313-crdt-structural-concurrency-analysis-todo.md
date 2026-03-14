# CRDT Structural Concurrency Analysis

Analyze why concurrent row/column insert/delete operations break more easily
than plain cell edits, then outline a defensible improvement path.

## Context

Current collaboration is built on Yorkie, with worksheet cells persisted as a
JSON object keyed by spreadsheet coordinates such as `A1` and `B3`. Plain cell
edits usually converge because both the CRDT identity and the application
identity are the same key. Structural edits are different: inserting or
deleting rows/columns changes the meaning of many coordinate keys at once.

The user report matches that design boundary exactly:

- Simple cell edits: mostly fine
- Row/column insert/delete: problems appear when large coordinate shifts happen

## Tasks

- [x] Trace row/column structural edit flow through `Sheet` and `YorkieStore`
- [x] Compare structural edit behavior with plain cell edit behavior
- [x] Identify concrete concurrent failure modes caused by the current data model
- [x] Identify secondary correctness gaps that amplify structural-edit issues
- [x] Document recommended improvement options and rollout order
- [x] Verify current local guarantees with targeted existing tests

## Findings

### 1. The core mismatch is identity

Plain edits mutate one logical cell at one stable key. Structural edits do not.

Today the persisted identity of a cell is its visual coordinate key
(`root.sheets[tabId].sheet["A1"]`). During insert/delete, the code rewrites the
entire affected key-space by computing new coordinate keys and then deleting or
upserting entries in place. See:

- `packages/frontend/src/app/spreadsheet/yorkie-store.ts`
  - `shiftCells()`
  - `moveCells()`
- `packages/sheet/src/model/shifting.ts`
  - `shiftSref()`
  - `shiftFormula()`

This means the application is expressing a semantic operation:

- "insert one row before row 5"

as a large derived-state rewrite:

- "delete these coordinate keys"
- "recreate these other coordinate keys"
- "rewrite every affected formula string"
- "rewrite merges/styles/filter metadata"

CRDTs merge individual field operations well when object identity is stable.
They do not automatically recover the higher-level intent of a coordinate-space
rewrite done independently by multiple peers from stale local snapshots.

### 2. Structural ops currently have a very wide conflict surface

`YorkieStore.shiftCells()` enumerates every populated cell, computes a new
coordinate key, deletes removed keys, and writes remapped keys back into the
same Yorkie object. It also rewrites row/column dimensions, row/column styles,
range styles, conditional formats, merges, and chart anchors in the same pass.

That means one insert/delete operation can concurrently touch:

- all shifted cells
- all formulas that mention shifted coordinates
- all row/column dimension metadata on the shifted axis
- merges
- filters and hidden rows/columns
- charts

So even when two users are not "editing the same business cell", they are often
writing the same CRDT fields after a structural shift.

### 3. Concurrent structural edits are not intention-preserving

Representative failure scenarios under the current model:

1. User A inserts a row above row 2.
2. User B edits `A2` concurrently.
3. A rewrites `A2 -> A3`; B writes to `A2`.

At merge time, the CRDT only sees field mutations on `sheet["A2"]` and
`sheet["A3"]`. It has no stable notion that B intended to edit "the old logical
row 2 cell, which should now live at A3".

The same problem appears for:

- insert vs insert at nearby indices
- delete vs edit inside/after deleted region
- delete vs delete with overlapping ranges
- insert/delete vs formula recalculation writes
- insert/delete vs metadata rewrites (`merges`, `rangeStyles`, `filter`)

This is the main reason plain edits look acceptable while structural edits do
not.

### 4. Structural edits are still a two-transaction operation

`Sheet.shiftCells()` first calls `store.shiftCells(...)`, then starts a batch
for freeze-pane adjustment and formula recalculation. The design doc explicitly
notes that full atomicity for `shiftCells` / `moveCells` is a non-goal and that
they produce two update steps.

That creates an interleaving window where peers can merge against:

- the remapped sheet/formula references
- before recalculated formula values and some derived metadata are fully settled

So the system is exposed to both:

- the identity problem above
- a second-order timing problem from multi-step structural writes

### 5. The code already shows structural-update stress symptoms

`YorkieStore` contains explicit fallback logic for Yorkie proxy
`ownKeys` duplicate-key errors when enumerating sheet objects. That is not the
root cause of the collaboration issue, but it is a clear signal that the
current delete-and-recreate pattern is pushing hard on object-key semantics.

### 6. Formula/value consistency after structure changes is incomplete

`recalculateAllFormulaCells()` only scans a hard-coded range of
`rows 1..1000, cols 1..100`.

That is a separate correctness gap: structure changes outside that window can
leave formula result values stale even in single-user mode. In collaborative
mode, stale derived values increase the chance that peers merge or render a
partially updated state for longer than expected.

### 7. Verification coverage is single-user only

Existing tests confirm local shift semantics and formula rewrites, but not
multi-client structural convergence. Relevant current coverage:

- `packages/sheet/test/sheet/manipulation.test.ts`
- `packages/sheet/test/sheet/shifting.test.ts`
- `packages/sheet/test/store/store.test.ts`

There is no concurrent structural-edit test that models two peers applying
insert/delete operations from diverged snapshots and then syncing.

## Recommended Direction

### Recommended target architecture: stable row/column identities

The durable fix is to stop using visual coordinates as the persisted identity
for collaborative structure.

Instead:

1. Persist row order as a CRDT list of stable `rowId`s
2. Persist column order as a CRDT list of stable `colId`s
3. Persist cells by logical identity, for example `(rowId, colId)` or a derived
   stable key from those ids
4. Treat insert/delete/move as operations on row/column identity lists, not as
   bulk coordinate rewrites
5. Derive `A1`-style coordinates at render/formula-serialization boundaries

Benefits:

- concurrent insert/delete becomes list-edit convergence, which CRDTs handle far
  better than derived key rewrites
- a concurrent plain cell edit stays attached to the same logical row/column id
  after structure changes
- conflict surface drops sharply because structure edits mostly touch row/column
  order lists instead of every shifted cell

### Formula strategy

Formulas are the hard part. There are two viable routes:

1. Keep formulas text-based for now, but resolve references through the current
   row/column order mapping and rewrite text only on commit/export boundaries.
2. Introduce an internal formula AST/reference model that stores structural
   references against row/column ids, then re-render to `A1` text for UI.

For a spreadsheet that aims to handle concurrent structure edits correctly,
option 2 is the cleaner long-term model. Option 1 is a practical stepping stone.

### Metadata strategy

The same stable-identity principle should be applied to:

- merges
- hidden rows/columns
- filters
- row/column styles
- range styles / conditional formats
- chart anchors

Anything still keyed directly by visual index will keep reintroducing the same
class of bug.

## Pragmatic Rollout Plan

### Phase 1: Prove the bug with concurrent tests

Add deterministic multi-peer tests that simulate:

- insert row vs edit shifted cell
- insert row vs insert row at same index
- delete column vs edit cell to the right
- insert row vs merge/style/filter updates

These tests should run against the Yorkie-backed store shape or a close local
simulation of two stale snapshots applying operations and then syncing.

### Phase 2: Reduce immediate risk without full redesign

Short-term mitigations:

- collapse structural change + derived recalculation into one logical remote
  transaction if possible
- stop full-sheet rewrites where a smaller axis-scoped transform can be encoded
- extend structural recalculation coverage beyond the `1000 x 100` cap
- add operation logging/telemetry for structural merges that rewrite many keys

This will not make concurrency correct, but it will reduce the failure window
and make behavior more diagnosable.

### Phase 3: Introduce stable row/column ids behind the model layer

Add:

- `rows: CRDTArray<RowId>`
- `columns: CRDTArray<ColId>`
- cell storage keyed by stable ids

Then adapt:

- render lookup
- selection mapping
- formula reference resolution
- merge/filter/style/chart metadata

### Phase 4: Migrate structural operations to list edits

Once ids exist, `insertRows`, `deleteRows`, `moveRows`, and their column
equivalents should primarily mutate row/column order lists. Cell payloads
should remain attached to ids unless explicitly deleted.

## Review

### Root Cause Summary

The current implementation is correct enough for local coordinate remapping, but
it is not a good semantic match for collaborative structural editing. The CRDT
layer is asked to merge large positional rewrites instead of small
identity-preserving operations.

### What I would change first

1. Add failing concurrent structural tests before changing architecture
2. Remove the formula recalculation scan cap
3. Design stable row/column ids and migrate structural metadata onto them

## Verification

- Read the current structural-edit path in:
  - `packages/frontend/src/app/spreadsheet/yorkie-store.ts`
  - `packages/sheet/src/model/sheet.ts`
  - `packages/sheet/src/model/shifting.ts`
  - `packages/sheet/src/view/worksheet.ts`
  - `packages/frontend/src/app/spreadsheet/sheet-view.tsx`
- Confirmed existing structural tests pass locally:
  - `pnpm --filter @wafflebase/sheet test manipulation.test.ts shifting.test.ts store.test.ts`
- Confirmed current test coverage is local/single-user and does not cover
  concurrent structural convergence
