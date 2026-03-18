# Add `Ranges` Type — Multi-Range Data Type

**Goal:** Introduce a `Ranges` type and utility functions to represent multiple disjoint rectangular regions, then incrementally integrate into the selection model and UI.

**Status:** Phase 2 DONE

**Context:** The current `Range = [Ref, Ref]` can only represent a single rectangle. Multi-range support is needed for Ctrl+click multi-selection, formula engine, conditional formatting, and chart data ranges. This task is broken into three phases to allow incremental delivery.

## Design

### Type Definition (`types.ts`)

```typescript
type Ranges = Range[];
```

- Empty array `[]` means "no selection"
- A single Range is representable as `[range]` (backward-compatible)

### Utility Functions (`coordinates.ts`)

| Function | Signature | Description |
|----------|-----------|-------------|
| `toRanges` | `(...ranges: Range[]) => Ranges` | Creation helper; normalizes each Range |
| `inRanges` | `(ref: Ref, ranges: Ranges) => boolean` | Whether ref falls inside any Range |
| `isIntersectRanges` | `(a: Ranges, b: Ranges) => boolean` | Whether two Ranges overlap |
| `toRefsFromRanges` | `(ranges: Ranges) => Generator<Ref>` | Iterate all cells across all ranges |
| `toSrngFromRanges` | `(ranges: Ranges) => string` | Serialize to `"A1:A2,B1,B2:B3"` |
| `parseRanges` | `(s: string) => Ranges` | Parse comma-separated string |
| `mergeOverlapping` | `(ranges: Ranges) => Ranges` | Merge overlapping ranges |
| `removeRange` | `(ranges: Ranges, target: Range) => Ranges` | Remove a specific range |

### Design Principles

- Reuse existing `Range` utilities (`inRange`, `isIntersect`, `toRefs`, etc.) internally
- Follow the existing pattern of adding functions to `coordinates.ts`
- Unit tests for every function

## Phase 1: Type and Utility Functions (current scope)

- [x] Task 1: Add `Ranges` type definition and export in `types.ts`
- [x] Task 2: Add `toRanges`, `inRanges` to `coordinates.ts`
- [x] Task 3: Add `isIntersectRanges`, `toRefsFromRanges` to `coordinates.ts`
- [x] Task 4: Add `toSrngFromRanges`, `parseRanges` to `coordinates.ts`
- [x] Task 5: Add `mergeOverlapping`, `removeRange` to `coordinates.ts`
- [x] Task 6: Write unit tests for all functions (33 tests)
- [x] Task 7: Confirm `pnpm verify:fast` passes

## Phase 2: Sheet Selection Model

Replace the single-range selection in Sheet with `Ranges` support.

- [x] Replace `range?: Range` field with `ranges: Ranges` in `Sheet`
- [x] Add `addSelection(ref: Ref)` and `addSelectionEnd(ref: Ref)` methods
- [x] Active cell follows the start of the last added range (Google Sheets behavior)
- [x] Update `getRange()` / `getRangeOrActiveCell()` for backward compatibility
- [x] Add `getRanges()` method to Sheet and Spreadsheet
- [x] Update selection-related methods (`selectRow`, `selectColumn`, etc.)
- [x] Expose `addSelection()` / `addSelectionEnd()` in Spreadsheet view
- [x] Unit tests for multi-selection behavior (6 tests)

## Phase 3: Frontend UI Integration

Wire multi-range selection into the frontend rendering and interaction layer.

- [ ] Handle Ctrl+click / Cmd+click events in `sheet-view.tsx` to call `addSelection()`
- [ ] Render multiple selection highlights on the Canvas
- [ ] Update selection-dependent UI (formula bar range display, context menu)
- [ ] Update copy/paste to operate on multiple ranges
- [ ] Interaction tests for multi-selection

## Future Phases (out of scope)

- **Phase 4:** Data model expansion — formula engine multi-range arguments, conditional formatting with `Ranges`, chart data ranges
