# Docs: large-paste freeze — measure, batch, report progress

Pasting a large document into the Docs editor freezes the UI for a
noticeable time. Goal: remove as much of the cost as possible, then
report progress for whatever remains.

## Phase 0 — Measure (spike, throwaway code)

- [x] Bench ① parse: 220 ms for 2000 paragraphs — linear, minor
- [x] Bench ② CRDT insert: super-linear confirmed (0.72 → 4.19 ms per block
      as the document grows 100 → 2000 blocks); ~63 % of it is the
      per-block `cloneDocument()` full-document deep clone
- [x] Bench ③ layout: 38 ms cold for 2000 blocks in Chromium — **not** a
      contributor; incremental layout is out of scope
- [x] Record the numbers in the lessons file

Headline: 1000-block paste into a 1000-block doc = 3037 ms of insert,
470 ms batched. Full numbers in the lessons file.

## Phase 1 — Batch the insert path

- [x] `DocStore.insertBlocksAfter(siblingId, blocks[])` — `MemDocStore` +
      `YorkieDocStore`, the latter via Yorkie `editBulkByPath` (one tree
      operation, not N edits in one transaction)
- [x] `Doc.insertBlocksAfter()` — one `refresh()` for the batch
- [x] Route `insertBlocks()`'s middle-block loop through it
- [x] Verify: one CRDT change per paste, one undo unit, cache agrees with a
      fresh read of the tree
- [x] Re-run the bench: **3119 ms → 61 ms** (51×) for 1000 blocks into a
      1000-block doc

## Phase 2 — Busy indicator for the residual cost

- [x] `EditorAPI.onLargePaste(cb)` — host returns a dismiss function
- [x] `yieldToPaintedFrame()` (rAF + macrotask). Measured in Chromium:
      `yieldToPaint()` renders **0** frames before the blocking work,
      `yieldToPaintedFrame()` renders 1 — the bare macrotask would have
      shipped an indicator nobody could ever see
- [x] Gate on clipboard characters (`LARGE_PASTE_WEIGHT_THRESHOLD = 400_000`),
      not parsed blocks: parse is ~half the remaining cost and runs before any
      block count exists, so a block gate left half the freeze unreported
- [x] Indeterminate `toast.loading()` in `docs-view.tsx` — the write is one
      atomic transaction, so there is no fraction to report without giving up
      the single undo unit / single CRDT change
- [x] `pasting` guard drops input queued during the yield
- [ ] Smoke in the real app (`pnpm dev`) with a >400 K-character paste

## Notes

- Paste entry: `packages/docs/src/view/text-editor.ts` — `planPaste()` /
  `runPastePlan()` / `applyPastePlan()`, then `insertBlocks()`
- Batched store op: `packages/frontend/src/app/docs/yorkie-doc-store.ts`
  `insertBlocksAfter()`

## Review

The reported symptom was a UI freeze; the fix was almost entirely a
data-layer one. Measuring first moved ~90% of the work from "show a
progress bar" to "delete the wait", and inverted the Phase 2 design: with
the write down to 61 ms for a 1000-block paste there is nothing to report
progress *through*, so the indicator is indeterminate and only appears
above 2000 blocks.

Two bugs fell out of the same change without being asked for: a large
paste used to cost one undo step and one CRDT change **per block** (a
1000-block paste needed 1000 Cmd+Z presses and pushed 1000 changes to
every peer). Both are now one.

Known limitations:

- The `insertBlockAfter`/`deleteBlock`/`splitBlock` single-block paths still
  deep-clone the whole document per call (`getDocument()` →
  `JSON.parse(JSON.stringify(...))`, ~2.6 ms on a 2000-block doc). Harmless
  at one call per user action, and no other hot loop remains — left alone
  rather than widening the blast radius. Worth revisiting if another
  batch-write path appears.
- Parsing (`parseHtmlToBlocks`, ~1.7 s at 8000 paragraphs) is now half of a
  very large paste and is still a single synchronous pass. It runs *inside*
  the indicator, so the wait is reported — but it cannot be interrupted or
  reported through.
- The character-count gate is a proxy. Characters per block swing widely by
  source (heavy Google Docs HTML runs several hundred per paragraph, plain
  text a few dozen), so it is tuned to fail toward a brief toast on a paste
  that turned out quick, never a missed indicator on a slow one.
