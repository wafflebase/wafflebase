# Lessons — merge metadata through copy/cut-paste (#936)

## What I learned

- The copied grid is sparse (`Store.getGrid` returns only cells that exist) and
  a merged block's covered cells are empty by invariant, so a copied merged
  block's bounding box is *smaller* than the block. The paste geometry therefore
  has to come from the copy buffer's source range translated by the paste
  delta, not from the grid's keys — otherwise a propagated merge extends past
  the range that was validated for it.
- `getRangeOrActiveCell` runs `expandRangeToMergedBoundaries`, so `copy` / `cut`
  can never capture a partially covered merged block through the UI. The
  containment check still lives at the paste site, because that is where the
  propagate-or-reject invariant is stated for both the source and destination
  sides.
- `selectStart` normalizes the active cell to its merge anchor, but
  `selectPastedRange` sets `activeCell` directly, so a paste target *can* be a
  covered cell. Normalizing the paste origin with `normalizeRefToAnchor` before
  the grid is built (rather than remapping grid keys afterwards) keeps formula
  relocation consistent with the write position.
- A single-cell paste had to stay exempt from the reject rule: the destination
  is the merge anchor, and the block only partially intersects it, so the
  generic "partial overlap refuses the paste" test would have broken pasting a
  value into a merged cell — a common operation that already worked.

## Follow-ups

- External spreadsheet HTML carries `rowspan` / `colspan`; `html2grid` drops it,
  so pasting a merged block *from* Google Sheets or Excel still lands as plain
  cells.
- A refused paste is silent, like a refused `moveRangeTo` and `autofill`.
