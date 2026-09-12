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

## Scope discipline beat the first attempt

PR #941 was closed not because the merge core was wrong — it was lifted
almost verbatim here — but because it also changed external paste, where the
propagate-or-reject rule does not belong. A drag-move is a small deliberate
gesture and can afford a refusal; a paste from Excel cannot. Same invariant,
different gesture, different answer.
