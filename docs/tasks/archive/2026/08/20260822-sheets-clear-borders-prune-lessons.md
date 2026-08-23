# Lessons: Sheets clear-borders residue (#878)

## What the bug actually was

Not a missing feature — the pruning machinery (`DefaultStyleValues` +
`pruneRedundantDefaultStyleKeys`) already listed all four border keys. One
write path simply never reached it: `setRangeBorders` goes cell-by-cell
through `setStyle`, and `setStyle` is the primitive that must be able to
persist an explicit `false`. The fix belongs at the caller, not in the
primitive.

## Pruning a patch vs pruning the merged style

`pruneRedundantDefaultStyleKeys` decides each key independently, so pruning
the *patch* alone gives the same per-key verdicts as pruning the merged cell
style. That keeps the blast radius to the keys the border preset touched
instead of silently cleaning unrelated residue on the same cell.

## Explicit `false` is still sometimes required

Dropping a default-valued key is only safe when no higher layer
(sheet/column/row/range style) sets that key to something else — otherwise the
cell would start inheriting a border it was just told to clear.
`hasConflictingStyleSourceForKey` is what makes the difference, which is why
reusing it beat hand-deleting the four keys.

## Tests encoded the bug

Three existing border tests asserted the `false` residue as expected output.
A behavior fix like this is half test rewrite; the useful signal was that the
new assertions are strictly shorter than the old ones.
