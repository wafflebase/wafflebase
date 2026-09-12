# Sheets: paste carries merge metadata (#936)

Follow-up to #74 / PR #927 (drag-move merge propagation), and to the closed
PR #941, whose review set the scope for this attempt.

## Problem

`Sheet.paste` is merge-blind. It touches merges only through
`expandChangedSrefsWithMergeAliases`, for recalculation. So:

- Copying a merged block reproduces its content but not its layout — the
  destination renders as ordinary cells.
- Pasting over a merged block writes values into cells that stay hidden under
  the merge and resurface as stale data on unmerge. That is exactly the class
  #927 fixed for `moveRangeTo`.

## Scope (from the #941 closing review)

The maintainer closed #941 for over-reaching: it applied a
propagate-or-reject rule to **external** (TSV/HTML) pastes too, so pasting a
block from Excel that clipped any merged cell silently wrote nothing. The
suggested shape for this attempt:

1. Land the internal-paste half only — copy/cut snapshot the contained
   blocks, paste re-creates them at the destination, destination blocks the
   paste fully covers are dropped, covered cells cleared.
2. Reuse `rangeOf` (`model/core/coordinates.ts`) and extract
   `clearCellsUnderMerge` out of `moveRangeTo` rather than writing a second
   implementation.
3. Decide the external-paste policy explicitly, and report every refusal
   through the #939 notice channel (`Sheet.setOnRefusal` →
   `Spreadsheet.onNotice`) instead of returning in silence.

### Decisions

- **External paste (TSV / HTML): policy unchanged.** A foreign grid carries
  no merge metadata we can trust, and a bounding box computed from a sparse
  grid is not the region the user pasted. Refusing it would trade "writes
  hidden data" for "does nothing, silently" on the most common paste there
  is. Out of scope for #936; noted as a Non-Goal in `sheet.md`.
- **`copyBuffer.merges` is a copy-time snapshot**, like `grid`, `rangeStyles`
  and `text` already are. Unmerging after the copy does not retro-edit the
  clipboard: the paste reproduces the layout that was copied, the same way it
  reproduces the values that were copied.
- **A refusal does not try to preserve the cut buffer.** Both view paste
  paths (`view/worksheet.ts`, `view/spreadsheet.ts`) call `clearCopyBuffer()`
  unconditionally right after `sheet.paste(...)`, so any model-level
  "the buffer survives a refusal" guarantee is unobservable. Not claimed, not
  tested.
- **An internal paste that carries neither content nor merges leaves the
  destination's merges alone** — pasting a copied blank range writes nothing
  today, so it must not drop a block either.
- **A single-cell destination is exempt from the reject rule.** It writes
  through the merge anchor (every path that sets `activeCell` normalizes it
  with `normalizeRefToAnchor`), so the block keeps its layout.
- **A cut's own blocks are excluded from the reject check** — they are
  deleted at the source whatever the destination clips, so they cannot be
  split by it. This is the exclusion `moveRangeTo` makes with `movedAnchors`;
  without it, cutting `A1:C3` (containing a `B2:C2` block) and pasting at
  `C1` refused a paste that is perfectly well defined. Found in self-review,
  covered by a regression test.

## Plan

- [x] Read `paste` / `moveRangeTo` / the merge helpers and the #941 review.
- [x] `copyBuffer` gains `merges` — blocks fully inside the copied range at
      copy/cut time.
- [x] Extract `clearCellsUnderMerge(anchor, span, written, changed, unblocked)`
      from `moveRangeTo`'s destination-clearing loop; call it from both.
- [x] Internal paste: compute the destination range as the translated source
      range (not the grid's bounding box — a merged block's covered cells are
      empty, so its box is smaller than the block).
- [x] Refuse an internal paste that would only partially overwrite a merged
      block, with a new `merge-paste-partial` reason + view message.
- [x] Propagate: drop the overwritten destination blocks (and, on a cut, the
      source blocks), re-create the copied blocks at the destination, clear
      the cells they newly hide, feed every deleted/created block's covered
      srefs into `changedSrefs` before the recalculation.
- [x] `selectPastedRange` uses `rangeOf` instead of its own bounding box.
- [x] Tests in `packages/sheets/test/sheet/merge.test.ts`.
- [x] Update `docs/design/sheets/sheet.md` (copy/paste bullet).

## Test plan

`packages/sheets/test/sheet/merge.test.ts`, new `Sheet merge + copy-paste`
block:

- copy a merged block → paste re-creates it at the destination, source keeps
  its own.
- cut a merged block → paste re-creates it at the destination and drops it at
  the source.
- paste fully covering a destination block → block dropped, its dependants
  recalculated (the alias is gone).
- paste that would split a destination block → nothing written, merges
  untouched, `merge-paste-partial` reported.
- single-cell paste into a merged block → writes through the anchor, block
  survives, no refusal.
- pasted merge hides no stale data → unmerge the destination afterwards and
  the covered cell reads empty.
- copied blank range over a merged block → block survives.
- external TSV paste over a merged block → unchanged behavior, no refusal.

## Review follow-up (round 1)

Blocking findings from the correctness and blast-radius review lanes:

- [x] `moveRangeTo` re-created a moved block at a translated anchor with no
      freeze check, so a drag reached exactly the state `planPasteMerges` now
      refuses. New `merge-move-frozen` refusal + view message.
- [x] The single-cell-destination exemption assumed `activeCell` is always a
      merge anchor. `selectRow` / `selectColumn` / `selectAllCells` do not
      normalize, so a single-cell paste onto a covered cell wrote a value
      hidden under the block. `paste` now normalizes its start ref, which
      covers the external paths too.
- [x] Both view paste paths cleared the copy buffer unconditionally, so merge
      propagation (and formula relocation) only ran on the first paste after a
      copy, and a refused paste threw away the clipboard the user needed to
      retry. The buffer now lives until Escape; `paste` still drops a consumed
      cut itself.

Not taken (non-blocking): the `Math.max` spread in the formula MAX/MIN
aggregate path, `setFreezePane` / the XLSX importer accepting a straddling
block, and `rangeOf`'s empty-grid bounds — all outside this change's paths.
