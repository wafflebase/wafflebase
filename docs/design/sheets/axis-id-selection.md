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

```text
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

```text
User clicks cell / drags range
  → Sheet.setActiveCell(ref)  &  Sheet.setRanges(ranges)
  → Store.updateSelection(
      refToAnchor(activeCell),
      ranges.map(r => rangeToRangeAnchor(r))
    )
  → Yorkie presence.set({ selection: { activeCell, ranges } })
```

#### Remote structural edit → Local selection correction

```text
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

```text
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
2. Active cell falls back to `{ r: 1, c: 1 }` and a new anchor is created
   from that position.
3. Repaired selection is republished to presence.

For ranges, each endpoint is resolved independently. If one endpoint's axis ID
is deleted, it snaps to the surviving endpoint. If both endpoints are deleted,
the range is dropped from the selection.

### Coverage Bound

Axis-ID coverage is **dense**: `rowOrder[i]` is the ID of visual row `i + 1`,
so referencing row N requires N entries. `ensureAxisOrder` therefore costs one
CRDT array insert per row, and coverage is only ever extended, never trimmed.

`MaxAxisCoverage` (10,000, in `sheet.ts`) bounds how far
`syncSelectionToPresence` will **extend** it — not how far a selection may
reach. Coverage that already exists is free to use: `writeWorksheetCell` grows
both axes to reach the ref it writes, so a 50,000-row import leaves 50,000 row
IDs and a selection over that data is anchored as before. The budget is
relative — `Store.getAxisCoverage()` (O(1), unlike `getRowOrder()`, which
copies) reports what exists, and a selection may reach `MaxAxisCoverage` rows
past it, paying only for the entries it adds.

Only a selection that would push coverage further than that degrades. It
publishes **no anchors at all** — `updateSelection(null, [], activeCellRef)`,
which the Yorkie store turns into `selection: undefined` plus the legacy
`activeCell` Sref — and the local `activeCellAnchor` / `rangeAnchors` are
cleared so `resolveAnchorsToRefs()` leaves the visual selection alone instead
of resolving anchors that no longer describe it.

Nothing meaningful is lost: axis IDs exist so a selection survives a peer's
row/column insert or delete, which only happens where the sheet has content.
Peers still see the cursor via the Sref fallback; they lose only the range
highlight, out in empty space.

An unbounded version of this is what made `Shift+Arrow` at row 1,000,000
unusable — a single keypress asked for 1M axis IDs (measured ~7 minutes of
Yorkie pushes in one `doc.update`, and ~300 ms per keystroke afterwards just
to walk the array). Anchors must stay proportional to the data, not to the
visual coordinate, because the grid is 1,000,000 × 18,278 regardless of how
sparse the sheet is.

`Store.ensureAxisOrder` implementations must also return without opening a
document update when coverage already suffices: every arrow key re-publishes
the selection and so calls it again.

#### What this does not bound

`MaxAxisCoverage` is a bound on one code path, not a global invariant. Three
other callers still extend the axis straight from a visual coordinate, and all
three reproduce the same freeze at row 1,000,000:

- `worksheet-grid.ts` `ensureWorksheetGrid` — writing a cell grows both axes to
  reach its ref. Inherent to the ID-keyed cell model: a cell at row 1,000,000
  has to be addressable. This is the reason coverage may legitimately exceed
  the cap, and the reason the cap governs extension rather than reach.
- `worksheet-axis.ts` `insertWorksheetAxis` / `moveWorksheetAxis`
  — "Insert row above" at a far-out row materializes everything before it.
- `sheet-view.tsx` `openCommentComposerForActiveCell` — seeds coverage from the
  raw active cell so a comment can be anchored.

Bounding those needs a sparse anchor (an ID plus an offset, rather than a
position in a dense array), which would replace this scheme rather than tune
it. Until then, a single chokepoint — one `Store` method that queries and
extends coverage with the cap applied inside it — would at least keep new
callers from routing around the bound.

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
  // Replace updateActiveCell. `activeCell` may be null when the cell sits
  // beyond axis-ID coverage (e.g. after Cmd+Down on an empty sheet).
  // `activeCellRef` is always provided so the legacy Sref can be emitted
  // for peer rendering fallback even without an anchor.
  updateSelection(
    activeCell: CellAnchor | null,
    ranges: RangeAnchor[],
    activeCellRef: Ref,
  ): void;

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

  // Extend axis orders to cover selection range, bounded by the caller
  // against the coverage that already exists (see Coverage Bound)
  getAxisCoverage(): { rows: number; cols: number };
  ensureAxisOrder(minRows: number, minCols: number): void;
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

### Peer Cursor Name Labels

A small name tag (the peer's `username`, white text on the peer's cursor color,
~10–11px, truncated with ellipsis at 120px logical width) renders on the overlay
canvas just above a peer's active cell. The tag is **transient**: it auto-shows
for ~4 seconds when a peer moves to a new cell, and shows while the local user
hovers over a peer's active cell; otherwise it is hidden so cell content stays
readable. The local user's own cursor never shows a label.

Rendering stays stateless in `overlay.ts`, which receives a `visiblePeerLabels`
map and draws only the tags it is told to. The visibility state, ~4s timers, and
hover detection live in `worksheet.ts`. The Store presence type carries an
optional `username?`, so `MemStore`/`ReadOnlyStore` can omit it and the label
simply doesn't render.

Edge cases handled at paint time:

- Flip the tag below the cell at the top viewport boundary.
- Clamp to the left/right viewport edges.
- When multiple peers share a cell, stack tags vertically, sorted by `clientID`.
- Render within each quadrant's clip region under frozen panes.

### Migration / Backward Compatibility

During rollout, peers may run old code that sets `activeCell: Sref` in presence
instead of the new `selection: SelectionPresence`.

- The new presence subscriber checks for both formats.
- If `activeCell` is a string (old format), parse it as `Sref → Ref` directly
  (existing behavior).
- If `selection` exists (new format), use the axis ID conversion path.

Note: the legacy `activeCell` Sref is also retained **permanently** as a
fallback for cells beyond axis-ID coverage. When activeCell sits outside the
materialized `rowOrder`/`colOrder` (e.g. after Cmd+Down on an empty sheet),
`presence.selection` is `undefined` but `presence.activeCell` carries the
visual position. Peer renderers must keep the dual-format path; the legacy
field is no longer just a migration tool.

## Risks and Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Presence payload size with many ranges | Increased sync traffic | Cap `ranges` array to a reasonable limit (e.g. 32). Multi-select beyond that is rare. |
| `indexOf` on `rowOrder` for every render | O(n) per lookup on large sheets | Build a `Map<string, number>` index from `rowOrder` on change, not on every render. Already done for cell lookups in `getWorksheetEntries`. |
| `ensureAxisOrder` extending to dimension boundary on Cmd+Down/Right | Multi-second freeze from ~1M Yorkie pushes | Only ranges drive axis-order extension; activeCell never extends. activeCell beyond coverage falls back to legacy Sref via `overlay.ts` dual-format path. |
| Ranges reaching the dimension boundary (Shift+Arrow / row header at row 1M) | ~7-minute freeze materializing 1M axis IDs, then ~300 ms per keystroke walking them | `MaxAxisCoverage` caps requested coverage; beyond it the selection publishes no anchors and falls back to the same legacy Sref path. See [Coverage Bound](#coverage-bound). |
| Deleted axis ID detection requires previous state | Complexity in tracking deletions | Cache previous `rowOrder` snapshot on each remote sync. Diff is cheap (array comparison). |
| Mixed old/new client presence during rollout | Rendering glitches | Dual-format presence parsing with fallback. |
