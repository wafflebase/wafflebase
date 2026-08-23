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
- [x] Verify: one CRDT change and one undo unit **for the batch**, cache
      agrees with a fresh read of the tree (body, cell-internal, header)
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
- [x] Indeterminate `toast.loading()` in `docs-view.tsx` — the work is a
      short run of synchronous store writes with no interruption point, and
      splitting them to report a fraction would reintroduce the per-block
      cost this was fixed to remove
- [x] `pasting` guard drops input queued during the yield
- [x] Smoke in the real app (`pnpm dev`) with a >400 K-character paste

## Notes

- Paste entry: `packages/docs/src/view/text-editor.ts` — `planPaste()` /
  `runPaste()` / `deferPaste()` / `applyPastePlan()`, then `insertBlocks()`
- Batched store op: `packages/frontend/src/app/docs/yorkie-doc-store.ts`
  `insertBlocksAfter()`

## Code review fixes

Findings from the pre-PR review, all applied on this branch:

- **rAF stalls in a hidden tab.** Browsers pause `requestAnimationFrame`
  when a tab is backgrounded — exactly what a user does when they expect a
  wait — so the paste would never have applied and the toast never come
  down. `yieldToPaintedFrame()` now races a 100 ms `setTimeout` fallback.
- **IME composition was unguarded.** `handleKeyDown`'s `preventDefault()`
  does not suppress an IME (keydown fires with keyCode 229 and the browser
  composes anyway), so a CJK keystroke in the gap would `deleteSelection()`
  the range the paste was about to replace. `handleCompositionStart` and
  `handleMouseDown` now check `pasting` too.
- **Swallowed rejections.** `runPaste` is no longer `async`; the
  sub-threshold path — every ordinary paste — stays synchronous so failures
  propagate to `window.onerror` as before, and the deferred path rethrows
  from a bare task rather than dying as an unhandled rejection.
- **Overstated undo granularity** in three comments (see Review below).
- `pasteContent()` now refuses re-entry like `handlePaste`; a deferred job
  no longer writes through a disposed editor.
- Design docs updated: `docs-paste-table-into-cell.md` still prescribed the
  per-block chaining loop this replaced.

The undo-cost test lives in `editor-undo-selection.test.ts` rather than its
own file: a second frontend test file mounting the docs editor pulled in
another full `@wafflebase/docs` module graph and reliably timed out the
unrelated 5 s `TextEditSection` import smoke test.

Each fix has a test that fails without it — verified by mutation:
reverting to `yieldToPaint`, dropping the composition guard, and dropping
the timeout fallback each fail exactly one test. Notably the first of
those left every *other* test green, which is why the guard was added.

## Review

The reported symptom was a UI freeze; the fix was almost entirely a
data-layer one. Measuring first moved ~90% of the work from "show a
progress bar" to "delete the wait", and inverted the Phase 2 design: with
the write down to 61 ms for a 1000-block paste there is nothing to report
progress *through*, so the indicator is indeterminate and only appears
above a 400 K-character payload.

Two bugs fell out of the same change without being asked for: a large
paste used to cost one undo step and one CRDT change **per block** (a
1000-block paste needed 1000 Cmd+Z presses and pushed 1000 changes to
every peer). Both are now *constant* — measured at 4 undo units for any
multi-block paste, pinned by `editor-undo-selection.test.ts`. Not 1: the
surrounding split / head-rewrite / tail-rewrite are still separate store
writes, and collapsing them would need a `DocStore` transaction primitive
that does not exist. An early draft of this work claimed "one undo unit"
for the whole paste in three comments; code review caught it and the
claim is now scoped to `insertBlocksAfter` itself.

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
- `splice(idx, 0, ...blocks)` in both store implementations would hit V8's
  argument-count limit somewhere past ~65 K blocks. Far beyond the 8000-block
  measured ceiling (where a paste already takes seconds), so left as is —
  but it would surface as a `RangeError`, not a slow paste, if that ceiling
  ever moved.
- `LARGE_PASTE_WEIGHT_THRESHOLD` is duplicated in the indicator test rather
  than exported, since it is a view-internal constant. The test comments
  point at the source.
