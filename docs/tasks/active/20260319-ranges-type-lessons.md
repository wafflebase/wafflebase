# Ranges Type — Lessons

## Phase 1: Type and Utility Functions

- **Roundtrip symmetry matters**: `toSrngFromRanges([])` returns `''`, so
  `parseRanges` must handle empty strings gracefully instead of throwing.
  Always test serialize/deserialize roundtrip for edge cases (empty, single
  element, etc.).

## Phase 2: Sheet Selection Model

- **Mechanical refactoring at scale**: Replacing `range?: Range` with
  `ranges: Ranges` touched 40+ sites. The patterns were consistent:
  - `this.range = undefined` → `this.ranges = []`
  - `this.range = [a, b]` → `this.ranges = [[a, b]]`
  - `if (this.range)` → `if (this.ranges.length > 0)`
  - `this.range[0]` → `this.ranges[this.ranges.length - 1][0]`
- **Backward compatibility through last-range convention**: `getRange()` and
  `getRangeOrActiveCell()` operate on the last range in the array, so all
  existing callers work without changes.

## Phase 3: Frontend UI Integration

- **Overlay has two rendering paths**: The overlay renders selections via
  `renderSelectionsSimple` (no-freeze) and `renderSelectionFrozen` (freeze).
  Both needed updating to loop over `Ranges`. The frozen path nests a
  range loop inside the quadrant loop.
- **Formula bar backward compat**: Single-range display uses `toSrng()`,
  multi-range uses `toSrngFromRanges()`. Avoids showing "A1:A1" for
  collapsed ranges thanks to the serializer's single-cell shorthand.
