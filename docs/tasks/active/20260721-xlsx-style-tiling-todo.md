# XLSX import: compact rangeStyles via maximal-rectangle tiling

## Problem

Uploading `[15] '25 프로젝트 멘티선발_Yorkie …xlsx` (482KB on disk) fails with
`document size exceeded: 18770104 > 10485760` (Yorkie 10MB per-document cap).

## Root cause (measured, not assumed)

Reproduced with `importXlsxWorkbook` + Yorkie `Document.getDocSize()`:

| Variant                                   | Yorkie total | meta     |
| ----------------------------------------- | ------------ | -------- |
| FULL (current importer)                   | 17.90 MB ❌  | 14.82 MB |
| intern style objects into a palette       | 15.96 MB     | 13.45 MB |
| drop style content entirely, keep ranges  | 14.39 MB     | 12.00 MB |
| **greedy maximal-rectangle re-tiling**    | **7.35 MB ✅**| 5.06 MB  |

- The cost is **not** style content — it is the number of `rangeStyle`
  entries. Each `{ range: [{r,c},{r,c}], style }` spawns ~7+ CRDT nodes for
  the range alone; ×31,422 entries ⇒ ~14MB of CRDT **metadata** (83% of doc).
- Whole-row/column style promotion (the first idea) fires on **nothing** here:
  every table has a header row *and* a label column, so `uniform rows = 0`,
  `uniform cols ≈ 0`.
- The importer today runs only a 2-pass adjacent merge
  (`coalesceAdjacentRangeStylePatches` column→row), far weaker than a maximal
  rectangle tiling. Only 10–14 distinct styles back all 31,422 rectangles.

## Approach

Add an importer-only **maximal-rectangle tiling** of the style patches:
expand patches to a per-cell style map (last-write-wins in apply order), then
greedily emit maximal same-style rectangles in row-major order. Behavior-
preserving: identical resolved style per cell, non-overlapping output so apply
order is irrelevant. Edit-path re-coalescing (shift/move) keeps the cheap
incremental adjacent merge — unchanged.

## Plan

- [x] TDD: failing unit test for `coalesceRangeStylePatchesMaximal` — count
      reduction + per-cell resolution equivalence on a case the adjacent
      2-pass handles poorly (header row + label col).
- [x] Implement `coalesceRangeStylePatchesMaximal` in `range-styles.ts`
      (guarded by a bounding-box area cap → fall back to adjacent coalesce).
- [x] Wire `xlsx-importer.ts` `parseWorksheet` to use it.
- [x] Run existing importer/style tests + new test green.
- [x] Verify the real file drops under 10MB (scratch measurement).
- [x] `pnpm verify:fast`.

## Non-goals

- Style interning / palette (separate model+schema change; deferred — retiling
  alone clears the cap with margin).
- Changing the runtime edit re-coalescing path.

## Review / Results

Implemented `coalesceRangeStylePatchesMaximal` (greedy row-major maximal
rectangle tiling, area-capped fallback to the adjacent merge) and switched the
importer's `parseWorksheet` to it. Exported from `@wafflebase/sheets`.

End-to-end (real importer → Yorkie `getDocSize()`) on the failing mentee file:

- rangeStyle patches: **31,422 → 8,131**
- document size: **17.90 MB → 7.35 MB** (7,711,106 bytes < 10,485,760) ✅

Correctness locked by 5 new unit tests: per-cell resolution equivalence,
patch-count reduction vs the adjacent 2-pass, non-overlapping output,
apply-order overrides, and sparse gaps left unstyled. `pnpm verify:fast` green
(all packages).

Edit-path re-coalescing (`shift`/`move`) intentionally left on the cheap
incremental adjacent merge — unchanged.

Follow-up (deferred, not needed for the cap): style interning/palette would
shave a further ~1.5 MB for even larger files.

### Code review (workflow-backed, high effort)

4 verified findings, all addressed in `coalesceRangeStylePatchesMaximal`:

1. **Overlap resolution wrong (correctness).** Original resolved each cell to a
   whole-style last-write-wins key, diverging from `resolveRangeStyleAt`'s
   key-wise merge — a latent bug in the exported utility (the importer's
   disjoint 1×1 patches masked it). Fixed: fold overlapping patches with
   `mergeStylePatch` in apply order. The disjoint import path is untouched (the
   merge branch never runs) so output is byte-identical (8,131 patches, 7.35MB).
2. **`length<=1` fast path skipped normalization.** A single empty-style patch
   was returned verbatim instead of dropped. Fixed by normalizing up front.
3. **Area cap checked after grid materialization.** Reordered: normalize +
   bounding box first, cap-check before expanding.
4. **Cap too generous for a client-side op (4M).** Lowered to 1M; above it we
   fall back to the adjacent merge (prior behavior, no OOM).

Added 2 regression tests (key-wise overlap merge; single empty-style patch
dropped). 13 range-styles tests green; real-file measurement unchanged.
