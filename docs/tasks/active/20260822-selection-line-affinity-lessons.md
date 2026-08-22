# Lessons — Selection endpoint lineAffinity (#66)

## What the ambiguity actually is

`findPageForPosition` walks a block's lines accumulating character counts.
An offset equal to a cumulative count is claimed by *two* lines: the one
that ends there and the one that starts there. `lineAffinity` picks. The
default is `backward` (the ending line), which is right for a caret that
arrived by typing but wrong for a caret the user placed by clicking at the
start of a wrapped line — which is exactly where a selection anchor or
focus can land.

## Notes

- `DocPosition` is the selection endpoint type; `DocRange.anchor` /
  `.focus` are `DocPosition`s. Extending `DocPosition` with an optional
  field is therefore the whole "extend the Selection endpoint type"
  change, and it also keeps the presence/undo shapes unchanged.
- `normalizeRange` returns the endpoint objects verbatim (it only chooses
  which is `start`), so the affinity survives normalization — including
  the reversed case — with no extra code.
- Interior blocks of a multi-block selection do not need affinity: their
  boundaries are offset `0` and the block text length, neither of which is
  ambiguous in the middle of the block. Only the two real endpoints are.
- Making `'forward'` the *start* default is behavior-neutral off the
  boundary and strictly better on it: a backward-affinity start that sits
  on a wrap boundary resolves to the very end of the previous line, so the
  rect it produces there has zero width. Forward affinity only drops that
  invisible rect. The mirror case is the same — a forward-affinity *end*
  turns the old end rect into a zero-width one and promotes its line into
  the fully-painted middle-lines loop, covering the identical pixels.
- `selection.ts` already had the same forward/backward split hard-coded in
  the cell-internal branch (`resolvePositionPixel(start, 'forward')` /
  `lineIdxForOffset(..., 'backward')`), which is a good confirmation that
  the start/end asymmetry is the intended model.
