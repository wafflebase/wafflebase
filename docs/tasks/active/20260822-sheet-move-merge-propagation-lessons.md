# Lessons — merge propagation in cell drag-move (#74)

## What I learned

- Merge state in `Sheet` is fully separate from cell storage: `fetchGrid` and
  `setGrid` are raw `Store` pass-throughs with no anchor normalization, so a
  move can relocate cells and merges as two independent passes inside one
  batch.
- `expandChangedSrefsWithMergeAliases` reads `merges` / `mergeCoverMap`, so the
  merge pass has to land *before* the recalculation at the end of
  `moveRangeTo` — otherwise dependants of the destination merge are recomputed
  against the old layout.
- The PR #73 review comment asked to *block* moves involving merges. The issue
  narrowed that to propagation for the common case (whole merged block moved);
  blocking is kept only for the genuinely ambiguous cases — a merge split by
  the source range, or a merge partially overwritten at the destination.

## Follow-ups

- Copy/paste (`paste`) still ignores merge metadata; the same propagation
  question applies there and is out of scope for this issue.
