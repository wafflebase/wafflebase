# Hide/Show Feature — Lessons

## Pattern: Separate hidden state sets
- Filter-hidden and user-hidden should be independent sets
- Union them in the getter, keep them separate in storage
- This prevents filter operations from clobbering manual visibility

## Pattern: Navigation helper approach
- Instead of updating every `this.hiddenRows.has()` call, use `isRowHidden()` helper
- This centralizes the union logic and makes it easy to add more hidden sources

## Pattern: Dimension backup for hiding
- Follow the existing `syncHiddenRowsFromSheet` pattern exactly for columns
- Back up original size before setting to 0, restore on show

## Pattern: Shift/move hidden indices
- Use existing `shiftDimensionMap`/`moveDimensionMap` utilities
- Convert Set<number> → Map<number, number> → apply → convert back
