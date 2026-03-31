# Docs Yorkie-Native Undo/Redo

Design doc: [docs-collaboration.md](../../design/docs-collaboration.md)
Issue: [#97](https://github.com/wafflebase/wafflebase/issues/97)

## Problem

Snapshot-based undo calls `writeFullDocument()` which deletes all tree nodes
and reinserts from a snapshot. During concurrent editing, Yorkie's CRDT merge
can preserve both old and new tree nodes, producing duplicate block IDs.
Clicking a block then jumps to the wrong position because `.find()` returns
the first match.

## Solution

Migrate to `doc.history.undo()/redo()` with ref-counted `beginBatch/endBatch`
to ensure compound user actions undo atomically.

## Steps

- [x] 1. DocStore interface: replace `snapshot()` with `beginBatch()/endBatch()`
- [x] 2. MemDocStore: implement ref-counted batching (snapshot on outer beginBatch)
- [x] 3. YorkieDocStore: implement batch buffering (buffer ops, flush in endBatch)
- [x] 4. YorkieDocStore: switch undo/redo to `doc.history.undo()/redo()`
- [x] 5. YorkieDocStore: remove `undoStack`, `redoStack` (writeFullDocument kept for setDocument only)
- [x] 6. Doc: wrap compound methods in beginBatch/endBatch
      - splitBlock, mergeBlocks, deleteRow, insertColumn, deleteColumn
- [x] 7. editor.ts: convert 21 `docStore.snapshot()` → beginBatch/endBatch pairs
- [x] 8. text-editor.ts: replace `saveSnapshot` callback with beginBatch/endBatch
      - Constructor signature change
      - Convert 27 saveSnapshot call sites
- [x] 9. Run `pnpm verify:fast` — all tests pass (280/280)
- [ ] 10. Manual test: concurrent editing + undo → no duplicate block IDs

## Files

| File | Changes |
|------|---------|
| `packages/docs/src/store/store.ts` | Interface: remove snapshot, add beginBatch/endBatch |
| `packages/docs/src/store/memory.ts` | Ref-counted batch + snapshot-based undo |
| `packages/frontend/src/app/docs/yorkie-doc-store.ts` | Batch buffer + doc.history.undo |
| `packages/docs/src/model/document.ts` | Wrap compound ops in batch |
| `packages/docs/src/view/editor.ts` | snapshot → beginBatch/endBatch |
| `packages/docs/src/view/text-editor.ts` | saveSnapshot → beginBatch/endBatch |
