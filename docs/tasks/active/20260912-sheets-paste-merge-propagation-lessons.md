# Lessons — Sheets: paste carries merge metadata (#936)

## The copy source range is already merge-expanded

`getRangeOrActiveCell()` runs `expandRangeToMergedBoundaries`, so a copy or
cut can never capture *part* of a merged block through the UI. That removes
the `merge-source-split` case `moveRangeTo` has to refuse: there is no
equivalent refusal on the paste path, and the snapshot filter
(`isRangeInRange(m.range, sourceRange)`) is a belt-and-braces guard for a
programmatic caller, not a user-reachable branch.

## A pasted grid's bounding box is not the pasted region

The obvious geometry for "what did this paste cover" — the bounding box of
the grid — is wrong for exactly the feature being built: a merged block's
covered cells are empty, so `fetchGrid` omits them and the box is smaller
than the block. The internal paste uses the *translated source range*
instead, which is the user's selection and therefore the real footprint.
PR #941 got this right and it is worth restating, because the same mistake
is what made its external-paste branch refuse valid pastes.

## A clipboard snapshot may say what to create, never what to delete

The copy buffer is deliberately a snapshot, so it decides which blocks the
paste *re-creates*. The first cut of this PR let it decide deletions too: the
"a cut's own blocks cannot be split by its paste" exclusion keyed on the
recorded anchors, so unmerging between the cut and the paste — or re-merging a
wider block at the same anchor — made the paste skip the split check and
silently shrink a block it never copied. The exclusion now only covers blocks
the live merge map still holds unchanged (`liveMergesAmong`). The general rule:
an exclusion that says "this is safe because we delete it anyway" has to be
derived from what is actually deleted, not from a stale record of intent.

Folding the cut's source drops into `planPasteMerges`'s own `replaced` list is
what makes that enforceable — with the drop loop sitting in `paste()`, the
exclusion and the deletion were two lists that could disagree.

## A helper's cost model travels with it

`selectPastedRange` was simplified onto the shared `rangeOf`, which is correct
and is the tidier code — but `rangeOf` spread one argument per grid key into
`Math.min`, and a paste is exactly the caller whose grid is unbounded. The
hand-rolled loop it replaced was stack-safe by accident. Fixed in `rangeOf`
rather than by reverting the call site, so every caller gets the bound.

## Scope discipline beat the first attempt

PR #941 was closed not because the merge core was wrong — it was lifted
almost verbatim here — but because it also changed external paste, where the
propagate-or-reject rule does not belong. A drag-move is a small deliberate
gesture and can afford a refusal; a paste from Excel cannot. Same invariant,
different gesture, different answer.
