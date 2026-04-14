---
title: axis-id-selection
target-version: 0.3.3
---

# Axis ID Based Selection & Presence

## Summary

Replace coordinate-based selection (`Ref: {r, c}`, `Sref: "A5"`) in Yorkie
presence with stable axis ID references (`CellAnchor: {rowId, colId}`). When
remote peers insert or delete rows/columns, `rowOrder`/`colOrder` shift but
axis IDs stay the same, so every client's selection automatically tracks the
correct cell without any shift-correction logic.

## Goals

- Selection follows the intended cell across remote structural edits (row/column
  insert, delete, move) without explicit shift logic.
- Peer cursors show both active cell (border) and selected ranges (translucent
  background), Google Sheets style.
- Multi-range selection (Ctrl+click) is shared via presence.
- Entire-row / entire-column selection is represented uniformly within the range
  structure (no separate `selectionType` flag in presence).

## Non-Goals

- Changing how Sheet engine internals work — the engine continues to use `Ref`
  for cell access, rendering, and formula evaluation.
- Modifying cell data storage — cells are already keyed by axis IDs.

## Proposal Details

### New Types

```typescript
/**
 * Stable cell reference using axis IDs instead of visual coordinates.
 */
type CellAnchor = {
  rowId: string; // e.g. "r3k9a"
  colId: string; // e.g. "cmfvz"
};

/**
 * Stable range reference. A null field means "all" on that axis:
 * - colId null → entire-row selection
 * - rowId null → entire-column selection
 * - both null  → select-all
 */
type RangeAnchor = {
  startRowId: string | null;
  startColId: string | null;
  endRowId: string | null;
  endColId: string | null;
};

/**
 * Full selection state stored in Yorkie presence.
 */
type SelectionPresence = {
  activeCell: CellAnchor;
  ranges: RangeAnchor[]; // multi-select (Ctrl+click)
};
```

### Presence Schema Change

```typescript
// Before
type UserPresence = {
  activeCell?: Sref;        // "A5"
  activeTabId?: string;
} & User;

// After
type UserPresence = {
  selection?: SelectionPresence;
  activeTabId?: string;
} & User;
```

### Coordinate Conversion Layer

Axis ID ↔ visual coordinate conversion happens **only at the Store boundary**.
The Sheet engine keeps using `Ref` internally.

```
Presence (axis ID)  ←→  Conversion Layer  ←→  Sheet Engine (Ref)  →  Canvas
```

Four conversion functions, placed in a new module
`packages/sheets/src/model/workbook/anchor-conversion.ts`:

| Function | Input | Output | Description |
|----------|-------|--------|-------------|
| `anchorToRef` | `CellAnchor, rowOrder, colOrder` | `Ref \| null` | axis ID → visual position. Returns null if axis ID was deleted. |
| `refToAnchor` | `Ref, rowOrder, colOrder` | `CellAnchor` | visual position → axis ID |
| `rangeAnchorToRange` | `RangeAnchor, rowOrder, colOrder` | `Range \| null` | range conversion. null fields → 1 / max dimension. Returns null if both endpoints deleted. |
| `rangeToRangeAnchor` | `Range, rowOrder, colOrder, selectionType` | `RangeAnchor` | range → anchor. Entire-row/col → null on the "all" axis. |

### Data Flow

#### Local selection → Presence

```
User clicks cell / drags range
  → Sheet.setActiveCell(ref)  &  Sheet.setRanges(ranges)
  → Store.updateSelection(
      refToAnchor(activeCell),
      ranges.map(r => rangeToRangeAnchor(r))
    )
  → Yorkie presence.set({ selection: { activeCell, ranges } })
```

#### Remote structural edit → Local selection correction

```
Remote peer inserts row at index 3
  → Yorkie syncs: rowOrder changes (new ID spliced in)
  → reloadDimensions() called
  → Stored CellAnchor unchanged (still "r3k9a")
  → anchorToRef("r3k9a", newRowOrder) → new Ref (e.g. {r:5} instead of {r:4})
  → Sheet.activeCell = new Ref
  → No explicit shift logic needed — the axis ID's position in rowOrder IS the
    new coordinate
```

#### Peer cursor rendering

```
Peer presence received
  → SelectionPresence { activeCell: CellAnchor, ranges: RangeAnchor[] }
  → anchorToRef(activeCell, rowOrder, colOrder) → Ref
  → rangeAnchorToRange(range, rowOrder, colOrder) → Range
  → Render: active cell = colored border + name label
  → Render: ranges = translucent background fill in peer color
  → If axis ID not in rowOrder/colOrder → skip rendering (deleted)
```

### Deleted Axis ID Handling

When a remote peer deletes a row/column that the local user has selected:

1. `anchorToRef(anchor, rowOrder, colOrder)` returns `null`.
2. Find the **previous visual index** of the deleted axis ID. Since the ID is
   no longer in `rowOrder`, use a cached previous-order snapshot or track the
   deletion index from the remote change event.
3. Clamp to `Math.min(prevIndex, rowOrder.length)` to find the nearest valid
   row.
4. Update `activeCell` to the new axis ID at that clamped index.
5. Push updated presence.

For ranges, each endpoint is resolved independently. If an endpoint's axis ID
is deleted, it snaps to the nearest valid position. If both endpoints are
deleted, the range is dropped from the selection.

### Sheet Engine Changes

The Sheet class keeps `activeCell: Ref` and `ranges: Ranges` as-is. Changes:

- **New field**: `private activeCellAnchor: CellAnchor` — the authoritative
  selection stored as axis IDs. On every remote sync, this is re-resolved to
  `Ref` via `anchorToRef()`.
- **New field**: `private rangeAnchors: RangeAnchor[]` — same pattern for
  ranges.
- **setActiveCell(ref)**: updates both `this.activeCell` (Ref) and
  `this.activeCellAnchor` (CellAnchor). Calls `store.updateSelection()`.
- **Remove shift logic** in `shiftCells()` (lines 1105-1143 of sheet.ts): the
  activeCell/range shift block becomes unnecessary because the anchor's position
  is derived from `rowOrder` on every read.
- **reloadDimensions()**: after reloading row/col order from store, re-resolve
  `activeCellAnchor → activeCell` and `rangeAnchors → ranges`. This is where
  the automatic correction happens.

### Store Interface Changes

```typescript
interface Store {
  // Replace updateActiveCell
  updateSelection(activeCell: CellAnchor, ranges: RangeAnchor[]): void;

  // Replace getPresences return type
  getPresences(): Array<{
    clientID: string;
    presence: {
      selection?: SelectionPresence;
      username?: string;
    };
  }>;

  // Expose axis orders for conversion
  getRowOrder(): string[];
  getColOrder(): string[];
}
```

### Overlay Rendering Changes

`overlay.ts` currently renders peer cursors as single-cell borders. Changes:

- Accept `SelectionPresence` instead of `Sref` for each peer.
- For `activeCell`: convert `CellAnchor → Ref`, draw colored border + name
  label (existing logic, just different input).
- For each `range` in `ranges`: convert `RangeAnchor → Range`, fill the range
  area with the peer's color at ~10% opacity.
- Skip peers whose `activeCell` axis ID is not found in current row/col order.

### Migration / Backward Compatibility

During rollout, peers may run old code that sets `activeCell: Sref` in presence
instead of the new `selection: SelectionPresence`.

- The new presence subscriber checks for both formats.
- If `activeCell` is a string (old format), parse it as `Sref → Ref` directly
  (existing behavior).
- If `selection` exists (new format), use the axis ID conversion path.
- Once all clients are updated, the old `activeCell` field can be removed.

## Risks and Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Presence payload size with many ranges | Increased sync traffic | Cap `ranges` array to a reasonable limit (e.g. 32). Multi-select beyond that is rare. |
| `indexOf` on `rowOrder` for every render | O(n) per lookup on large sheets | Build a `Map<string, number>` index from `rowOrder` on change, not on every render. Already done for cell lookups in `getWorksheetEntries`. |
| Deleted axis ID detection requires previous state | Complexity in tracking deletions | Cache previous `rowOrder` snapshot on each remote sync. Diff is cheap (array comparison). |
| Mixed old/new client presence during rollout | Rendering glitches | Dual-format presence parsing with fallback. |
