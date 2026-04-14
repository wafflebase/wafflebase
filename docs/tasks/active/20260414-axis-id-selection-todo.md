# Axis ID Based Selection & Presence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace coordinate-based selection with stable axis ID references in Yorkie presence so selections automatically track cells across remote structural edits.

**Architecture:** New `CellAnchor`/`RangeAnchor` types represent selection via axis IDs. A conversion layer at the Store boundary translates between axis IDs and visual `Ref` coordinates. The Sheet engine keeps `Ref` internally; presence stores axis IDs. Peer cursors render both active cell borders and range backgrounds.

**Tech Stack:** TypeScript, Vitest, Yorkie CRDT presence

---

### Task 1: Anchor Types and Conversion Functions

**Files:**
- Create: `packages/sheets/src/model/workbook/anchor-conversion.ts`
- Create: `packages/sheets/test/workbook/anchor-conversion.test.ts`

- [ ] **Step 1: Write failing tests for `anchorToRef`**

```typescript
// packages/sheets/test/workbook/anchor-conversion.test.ts
import { describe, it, expect } from 'vitest';
import {
  anchorToRef,
  refToAnchor,
  rangeAnchorToRange,
  rangeToRangeAnchor,
} from '../../src/model/workbook/anchor-conversion';
import type { CellAnchor, RangeAnchor } from '../../src/model/workbook/anchor-conversion';

describe('anchorToRef', () => {
  const rowOrder = ['r1', 'r2', 'r3', 'r4', 'r5'];
  const colOrder = ['c1', 'c2', 'c3'];

  it('converts axis IDs to visual position', () => {
    const anchor: CellAnchor = { rowId: 'r3', colId: 'c2' };
    expect(anchorToRef(anchor, rowOrder, colOrder)).toEqual({ r: 3, c: 2 });
  });

  it('returns null when rowId is not in rowOrder (deleted)', () => {
    const anchor: CellAnchor = { rowId: 'rDeleted', colId: 'c1' };
    expect(anchorToRef(anchor, rowOrder, colOrder)).toBeNull();
  });

  it('returns null when colId is not in colOrder (deleted)', () => {
    const anchor: CellAnchor = { rowId: 'r1', colId: 'cDeleted' };
    expect(anchorToRef(anchor, rowOrder, colOrder)).toBeNull();
  });

  it('reflects position change after row insertion', () => {
    const anchor: CellAnchor = { rowId: 'r3', colId: 'c1' };
    // Before insertion: r3 is at index 2 → Ref {r:3}
    expect(anchorToRef(anchor, rowOrder, colOrder)).toEqual({ r: 3, c: 1 });
    // After inserting a new row before r3:
    const newRowOrder = ['r1', 'r2', 'rNew', 'r3', 'r4', 'r5'];
    expect(anchorToRef(anchor, newRowOrder, colOrder)).toEqual({ r: 4, c: 1 });
  });
});
```

- [ ] **Step 2: Write failing tests for `refToAnchor`**

```typescript
// append to the same test file
describe('refToAnchor', () => {
  const rowOrder = ['r1', 'r2', 'r3'];
  const colOrder = ['c1', 'c2', 'c3'];

  it('converts visual position to axis IDs', () => {
    expect(refToAnchor({ r: 2, c: 3 }, rowOrder, colOrder)).toEqual({
      rowId: 'r2',
      colId: 'c3',
    });
  });

  it('returns null for out-of-bounds ref', () => {
    expect(refToAnchor({ r: 10, c: 1 }, rowOrder, colOrder)).toBeNull();
  });
});
```

- [ ] **Step 3: Write failing tests for `rangeAnchorToRange` and `rangeToRangeAnchor`**

```typescript
// append to the same test file
describe('rangeAnchorToRange', () => {
  const rowOrder = ['r1', 'r2', 'r3', 'r4'];
  const colOrder = ['c1', 'c2', 'c3'];

  it('converts a normal range', () => {
    const anchor: RangeAnchor = {
      startRowId: 'r2', startColId: 'c1',
      endRowId: 'r4', endColId: 'c3',
    };
    expect(rangeAnchorToRange(anchor, rowOrder, colOrder)).toEqual([
      { r: 2, c: 1 },
      { r: 4, c: 3 },
    ]);
  });

  it('entire-row selection (null colIds)', () => {
    const anchor: RangeAnchor = {
      startRowId: 'r2', startColId: null,
      endRowId: 'r3', endColId: null,
    };
    expect(rangeAnchorToRange(anchor, rowOrder, colOrder)).toEqual([
      { r: 2, c: 1 },
      { r: 3, c: colOrder.length },
    ]);
  });

  it('entire-column selection (null rowIds)', () => {
    const anchor: RangeAnchor = {
      startRowId: null, startColId: 'c2',
      endRowId: null, endColId: 'c2',
    };
    expect(rangeAnchorToRange(anchor, rowOrder, colOrder)).toEqual([
      { r: 1, c: 2 },
      { r: rowOrder.length, c: 2 },
    ]);
  });

  it('select-all (all null)', () => {
    const anchor: RangeAnchor = {
      startRowId: null, startColId: null,
      endRowId: null, endColId: null,
    };
    expect(rangeAnchorToRange(anchor, rowOrder, colOrder)).toEqual([
      { r: 1, c: 1 },
      { r: rowOrder.length, c: colOrder.length },
    ]);
  });

  it('returns null when both start and end axis IDs are deleted', () => {
    const anchor: RangeAnchor = {
      startRowId: 'rGone', startColId: 'c1',
      endRowId: 'rAlsoGone', endColId: 'c2',
    };
    expect(rangeAnchorToRange(anchor, rowOrder, colOrder)).toBeNull();
  });
});

describe('rangeToRangeAnchor', () => {
  const rowOrder = ['r1', 'r2', 'r3', 'r4'];
  const colOrder = ['c1', 'c2', 'c3'];

  it('converts a normal range to anchor', () => {
    const anchor = rangeToRangeAnchor(
      [{ r: 2, c: 1 }, { r: 4, c: 3 }],
      rowOrder, colOrder, 'cell',
    );
    expect(anchor).toEqual({
      startRowId: 'r2', startColId: 'c1',
      endRowId: 'r4', endColId: 'c3',
    });
  });

  it('encodes entire-row selection with null colIds', () => {
    const anchor = rangeToRangeAnchor(
      [{ r: 2, c: 1 }, { r: 3, c: colOrder.length }],
      rowOrder, colOrder, 'row',
    );
    expect(anchor).toEqual({
      startRowId: 'r2', startColId: null,
      endRowId: 'r3', endColId: null,
    });
  });

  it('encodes entire-column selection with null rowIds', () => {
    const anchor = rangeToRangeAnchor(
      [{ r: 1, c: 2 }, { r: rowOrder.length, c: 2 }],
      rowOrder, colOrder, 'column',
    );
    expect(anchor).toEqual({
      startRowId: null, startColId: 'c2',
      endRowId: null, endColId: 'c2',
    });
  });

  it('encodes select-all with all nulls', () => {
    const anchor = rangeToRangeAnchor(
      [{ r: 1, c: 1 }, { r: rowOrder.length, c: colOrder.length }],
      rowOrder, colOrder, 'all',
    );
    expect(anchor).toEqual({
      startRowId: null, startColId: null,
      endRowId: null, endColId: null,
    });
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `pnpm --filter @wafflebase/sheets exec vitest run test/workbook/anchor-conversion.test.ts`
Expected: FAIL — module not found

- [ ] **Step 5: Implement anchor-conversion module**

```typescript
// packages/sheets/src/model/workbook/anchor-conversion.ts
import type { Range, Ref, SelectionType } from '../core/types';

/**
 * Stable cell reference using axis IDs instead of visual coordinates.
 */
export type CellAnchor = {
  rowId: string;
  colId: string;
};

/**
 * Stable range reference. A null field means "all" on that axis:
 * - colId null → entire-row selection
 * - rowId null → entire-column selection
 * - both null  → select-all
 */
export type RangeAnchor = {
  startRowId: string | null;
  startColId: string | null;
  endRowId: string | null;
  endColId: string | null;
};

/**
 * Full selection state stored in Yorkie presence.
 */
export type SelectionPresence = {
  activeCell: CellAnchor;
  ranges: RangeAnchor[];
};

/**
 * Convert a CellAnchor to a visual Ref using current axis ordering.
 * Returns null if the axis ID has been deleted (not found in order).
 */
export function anchorToRef(
  anchor: CellAnchor,
  rowOrder: string[],
  colOrder: string[],
): Ref | null {
  const r = rowOrder.indexOf(anchor.rowId);
  const c = colOrder.indexOf(anchor.colId);
  if (r === -1 || c === -1) return null;
  return { r: r + 1, c: c + 1 };
}

/**
 * Convert a visual Ref to a CellAnchor using current axis ordering.
 * Returns null if the ref is out of bounds.
 */
export function refToAnchor(
  ref: Ref,
  rowOrder: string[],
  colOrder: string[],
): CellAnchor | null {
  const rowId = rowOrder[ref.r - 1];
  const colId = colOrder[ref.c - 1];
  if (!rowId || !colId) return null;
  return { rowId, colId };
}

/**
 * Convert a RangeAnchor to a visual Range.
 * null axis fields expand to 1 (start) or max dimension (end).
 * Returns null if both row endpoints are deleted or both col endpoints are deleted.
 */
export function rangeAnchorToRange(
  anchor: RangeAnchor,
  rowOrder: string[],
  colOrder: string[],
): Range | null {
  const startR = anchor.startRowId
    ? rowOrder.indexOf(anchor.startRowId) + 1
    : 1;
  const startC = anchor.startColId
    ? colOrder.indexOf(anchor.startColId) + 1
    : 1;
  const endR = anchor.endRowId
    ? rowOrder.indexOf(anchor.endRowId) + 1
    : rowOrder.length;
  const endC = anchor.endColId
    ? colOrder.indexOf(anchor.endColId) + 1
    : colOrder.length;

  // indexOf returns -1 → +1 = 0 means deleted
  if (
    (anchor.startRowId && startR === 0) &&
    (anchor.endRowId && endR === 0)
  ) return null;
  if (
    (anchor.startColId && startC === 0) &&
    (anchor.endColId && endC === 0)
  ) return null;

  return [
    { r: Math.max(1, startR), c: Math.max(1, startC) },
    { r: Math.max(1, endR), c: Math.max(1, endC) },
  ];
}

/**
 * Convert a visual Range to a RangeAnchor.
 * selectionType determines which axes get null (entire-row/column/all).
 */
export function rangeToRangeAnchor(
  range: Range,
  rowOrder: string[],
  colOrder: string[],
  selectionType: SelectionType,
): RangeAnchor {
  const [start, end] = range;
  const useRow = selectionType !== 'column' && selectionType !== 'all';
  const useCol = selectionType !== 'row' && selectionType !== 'all';

  return {
    startRowId: useRow ? (rowOrder[start.r - 1] ?? null) : null,
    startColId: useCol ? (colOrder[start.c - 1] ?? null) : null,
    endRowId: useRow ? (rowOrder[end.r - 1] ?? null) : null,
    endColId: useCol ? (colOrder[end.c - 1] ?? null) : null,
  };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @wafflebase/sheets exec vitest run test/workbook/anchor-conversion.test.ts`
Expected: ALL PASS

- [ ] **Step 7: Export new types from sheets package**

Add to `packages/sheets/src/index.ts`:

```typescript
import type { CellAnchor, RangeAnchor, SelectionPresence } from './model/workbook/anchor-conversion';
// ... in the export block:
export { type CellAnchor, type RangeAnchor, type SelectionPresence };
export { anchorToRef, refToAnchor, rangeAnchorToRange, rangeToRangeAnchor } from './model/workbook/anchor-conversion';
```

- [ ] **Step 8: Commit**

```bash
git add packages/sheets/src/model/workbook/anchor-conversion.ts \
       packages/sheets/test/workbook/anchor-conversion.test.ts \
       packages/sheets/src/index.ts
git commit -m "Add anchor conversion layer for axis ID based selection

CellAnchor/RangeAnchor types reference cells by stable axis IDs.
Conversion functions translate between axis IDs and visual Ref
coordinates at the Store boundary."
```

---

### Task 2: Store Interface — Replace `updateActiveCell` with `updateSelection`

**Files:**
- Modify: `packages/sheets/src/store/store.ts:76,208`
- Modify: `packages/sheets/src/store/memory.ts:297-302,318-323`
- Modify: `packages/sheets/src/store/readonly.ts:140-149`

- [ ] **Step 1: Update Store interface**

In `packages/sheets/src/store/store.ts`, replace:

```typescript
// Line 73-76: change getPresences signature
/**
 * `getPresences` method gets the user presences.
 */
getPresences(): Array<{
  clientID: string;
  presence: { activeCell: string; username?: string };
}>;
```

with:

```typescript
/**
 * `getPresences` method gets the user presences with axis-ID-based selection.
 */
getPresences(): Array<{
  clientID: string;
  presence: {
    selection?: SelectionPresence;
    activeCell?: string; // legacy fallback
    username?: string;
  };
}>;
```

And replace:

```typescript
// Line 205-208: change updateActiveCell to updateSelection
/**
 * `updateActiveCell` method updates the active cell of the current user.
 */
updateActiveCell(activeCell: Ref): void;
```

with:

```typescript
/**
 * `updateSelection` updates the selection of the current user in presence.
 */
updateSelection(
  activeCell: CellAnchor,
  ranges: RangeAnchor[],
): void;

/**
 * `getRowOrder` returns the current row axis ID ordering.
 */
getRowOrder(): string[];

/**
 * `getColOrder` returns the current column axis ID ordering.
 */
getColOrder(): string[];
```

Add the imports at the top of `store.ts`:

```typescript
import type { CellAnchor, RangeAnchor, SelectionPresence } from '../model/workbook/anchor-conversion';
```

- [ ] **Step 2: Update MemStore**

In `packages/sheets/src/store/memory.ts`, replace `getPresences` and `updateActiveCell`:

```typescript
getPresences(): Array<{
  clientID: string;
  presence: {
    selection?: SelectionPresence;
    activeCell?: string;
    username?: string;
  };
}> {
  return [];
}

updateSelection(_activeCell: CellAnchor, _ranges: RangeAnchor[]): void {
  // No-op for memory store
}

getRowOrder(): string[] {
  return [];
}

getColOrder(): string[] {
  return [];
}
```

Add import: `import type { CellAnchor, RangeAnchor, SelectionPresence } from '../model/workbook/anchor-conversion';`

- [ ] **Step 3: Update ReadOnlyStore**

In `packages/sheets/src/store/readonly.ts`, apply the same changes as MemStore — replace `getPresences` and `updateActiveCell` with the new signatures and no-op implementations.

Add import: `import type { CellAnchor, RangeAnchor, SelectionPresence } from '../model/workbook/anchor-conversion';`

- [ ] **Step 4: Verify typecheck passes**

Run: `pnpm sheets typecheck`
Expected: FAIL — Sheet class and YorkieStore still use old signatures. That is expected; they will be updated in Tasks 3 and 4.

- [ ] **Step 5: Commit**

```bash
git add packages/sheets/src/store/store.ts \
       packages/sheets/src/store/memory.ts \
       packages/sheets/src/store/readonly.ts
git commit -m "Update Store interface for axis ID based selection

Replace updateActiveCell(Ref) with updateSelection(CellAnchor, RangeAnchor[]).
Add getRowOrder/getColOrder for axis order access.
Update getPresences to include SelectionPresence."
```

---

### Task 3: Sheet Engine — Anchor-Based Selection State

**Files:**
- Modify: `packages/sheets/src/model/worksheet/sheet.ts`

- [ ] **Step 1: Add anchor fields and update setActiveCell**

In `packages/sheets/src/model/worksheet/sheet.ts`, add imports:

```typescript
import {
  type CellAnchor,
  type RangeAnchor,
  refToAnchor,
  anchorToRef,
  rangeToRangeAnchor,
  rangeAnchorToRange,
} from '../workbook/anchor-conversion';
```

After the existing `private ranges: Ranges = [];` (line 157), add:

```typescript
/**
 * `activeCellAnchor` is the authoritative selection as axis IDs.
 * On remote sync, re-resolved to `activeCell` (Ref) via anchorToRef().
 */
private activeCellAnchor: CellAnchor | null = null;

/**
 * `rangeAnchors` are the authoritative range selections as axis IDs.
 */
private rangeAnchors: RangeAnchor[] = [];
```

Replace `setActiveCell` (lines 2609-2613):

```typescript
public setActiveCell(ref: Ref): void {
  const anchor = this.normalizeRefToAnchor(ref);
  this.activeCell = anchor;

  const cellAnchor = refToAnchor(anchor, this.store.getRowOrder(), this.store.getColOrder());
  if (cellAnchor) {
    this.activeCellAnchor = cellAnchor;
  }

  this.syncSelectionToPresence();
}
```

- [ ] **Step 2: Add `syncSelectionToPresence` helper and update selection methods**

Add a private helper method:

```typescript
private syncSelectionToPresence(): void {
  if (!this.activeCellAnchor) return;
  const rowOrder = this.store.getRowOrder();
  const colOrder = this.store.getColOrder();
  const rangeAnchors = this.ranges.map((range) =>
    rangeToRangeAnchor(range, rowOrder, colOrder, this.selectionType),
  );
  this.rangeAnchors = rangeAnchors;
  this.store.updateSelection(this.activeCellAnchor, rangeAnchors);
}
```

Update `selectRow` (lines 2666-2674) — replace `this.store.updateActiveCell(this.activeCell)` with `this.syncSelectionToPresence()`.

Update `selectColumn` (lines 2679-2687) — same replacement.

Update `selectAllCells` (lines 2718-2723) — same replacement.

Update any other method that calls `this.store.updateActiveCell(...)` — replace with `this.syncSelectionToPresence()`. Search for all occurrences of `store.updateActiveCell` in `sheet.ts`.

- [ ] **Step 3: Add `resolveAnchorsToRefs` for remote sync**

Add a public method that `reloadDimensions` flow can call:

```typescript
/**
 * Re-resolve axis-ID-based anchors to visual Refs after rowOrder/colOrder change.
 * Called on remote structural edits to correct selection position.
 */
public resolveAnchorsToRefs(): void {
  if (!this.activeCellAnchor) return;
  const rowOrder = this.store.getRowOrder();
  const colOrder = this.store.getColOrder();

  const newRef = anchorToRef(this.activeCellAnchor, rowOrder, colOrder);
  if (newRef) {
    this.activeCell = this.normalizeRefToAnchor(newRef);
  } else {
    // Axis ID was deleted — snap to nearest valid position
    this.handleDeletedAnchor(rowOrder, colOrder);
  }

  // Re-resolve ranges
  const newRanges: Range[] = [];
  for (const anchor of this.rangeAnchors) {
    const range = rangeAnchorToRange(anchor, rowOrder, colOrder);
    if (range) {
      newRanges.push(range);
    }
  }
  this.ranges = newRanges;
}

private handleDeletedAnchor(rowOrder: string[], colOrder: string[]): void {
  // Fallback: place activeCell at row 1, col 1 and update anchor
  const fallbackRef: Ref = { r: 1, c: 1 };
  this.activeCell = fallbackRef;
  const newAnchor = refToAnchor(fallbackRef, rowOrder, colOrder);
  if (newAnchor) {
    this.activeCellAnchor = newAnchor;
    this.syncSelectionToPresence();
  }
}
```

Note: The `handleDeletedAnchor` uses a simple fallback to {r:1, c:1}. A smarter approach (snapping to the nearest row) requires caching previous rowOrder, which can be added as a follow-up refinement. The simple fallback is correct and safe.

- [ ] **Step 4: Remove activeCell shift logic from `shiftCells`**

In `shiftCells()` (lines 1105-1144), replace the entire activeCell shift block:

```typescript
// Adjust activeCell if it's at or beyond the insertion/deletion point
const value = axis === 'row' ? this.activeCell.r : this.activeCell.c;
if (count > 0 && value >= index) {
  // ... all the shift logic ...
}
this.activeCell = this.normalizeRefToAnchor(this.activeCell);
```

with:

```typescript
// ActiveCell adjustment is handled by resolveAnchorsToRefs() via axis IDs.
// For local edits, re-resolve immediately since rowOrder has already changed.
this.resolveAnchorsToRefs();
```

- [ ] **Step 5: Update `getPresences` return type**

In `sheet.ts`, update the `getPresences` method (lines 2635-2640):

```typescript
getPresences(): Array<{
  clientID: string;
  presence: {
    selection?: SelectionPresence;
    activeCell?: string;
    username?: string;
  };
}> {
  return this.store.getPresences();
}
```

Add import: `import type { SelectionPresence } from '../workbook/anchor-conversion';`

- [ ] **Step 6: Verify typecheck passes**

Run: `pnpm sheets typecheck`
Expected: FAIL — YorkieStore not yet updated (Task 4). MemStore/ReadOnlyStore should be fine.

- [ ] **Step 7: Commit**

```bash
git add packages/sheets/src/model/worksheet/sheet.ts
git commit -m "Add anchor-based selection state to Sheet engine

Sheet maintains CellAnchor/RangeAnchor alongside Ref-based fields.
resolveAnchorsToRefs() re-resolves on remote sync.
Remove manual activeCell shift logic from shiftCells()."
```

---

### Task 4: YorkieStore — Implement `updateSelection` and Axis Order Access

**Files:**
- Modify: `packages/frontend/src/app/spreadsheet/yorkie-store.ts:602-612`
- Modify: `packages/frontend/src/types/users.ts`

- [ ] **Step 1: Update UserPresence type**

In `packages/frontend/src/types/users.ts`:

```typescript
import type { Sref, SelectionPresence } from "@wafflebase/sheets";

export type User = {
  id: number;
  authProvider: string;
  username: string;
  email: string;
  photo: string;
};

export type UserPresence = {
  selection?: SelectionPresence;
  activeCell?: Sref; // legacy fallback for mixed-version peers
  activeTabId?: string;
} & User;
```

- [ ] **Step 2: Update YorkieStore methods**

In `packages/frontend/src/app/spreadsheet/yorkie-store.ts`, add imports:

```typescript
import type { CellAnchor, RangeAnchor } from "@wafflebase/sheets";
```

Replace `updateActiveCell` (lines 602-606):

```typescript
updateSelection(activeCell: CellAnchor, ranges: RangeAnchor[]) {
  this.doc.update((_, p) => {
    p.set({
      selection: { activeCell, ranges },
      activeTabId: this.tabId,
    });
  });
}
```

Add `getRowOrder` and `getColOrder`:

```typescript
getRowOrder(): string[] {
  const ws = this.getSheet();
  return ws.rowOrder ? [...ws.rowOrder] : [];
}

getColOrder(): string[] {
  const ws = this.getSheet();
  return ws.colOrder ? [...ws.colOrder] : [];
}
```

- [ ] **Step 3: Verify full typecheck passes**

Run: `pnpm sheets typecheck && pnpm --filter @wafflebase/frontend exec tsc --noEmit`
Expected: PASS (all implementations now match the interface)

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/app/spreadsheet/yorkie-store.ts \
       packages/frontend/src/types/users.ts
git commit -m "Implement updateSelection and axis order access in YorkieStore

YorkieStore writes SelectionPresence to Yorkie presence.
UserPresence type includes both new selection and legacy activeCell
fields for backward compatibility."
```

---

### Task 5: Remote Sync — Re-resolve Anchors on Structural Change

**Files:**
- Modify: `packages/sheets/src/view/worksheet.ts:4175-4190`
- Modify: `packages/frontend/src/app/spreadsheet/sheet-view.tsx:640-664`

- [ ] **Step 1: Add `resolveAnchorsToRefs` call in `reloadDimensions`**

In `packages/sheets/src/view/worksheet.ts`, update `reloadDimensions()` (lines 4175-4190):

```typescript
public async reloadDimensions() {
  await this.sheet!.loadDimensions();
  await this.sheet!.loadStyles();
  await this.sheet!.loadMerges();
  await this.sheet!.loadFreezePane();
  await this.sheet!.loadFilterState();
  await this.sheet!.loadHiddenState();
  await this.sheet!.loadPivotDefinition();

  // Re-resolve axis-ID-based selection after structural changes
  this.sheet!.resolveAnchorsToRefs();

  this.hiddenRows.clear();
  this.hiddenRowSizeBackup.clear();
  this.hiddenColumns.clear();
  this.hiddenColSizeBackup.clear();
  this.syncHiddenRowsFromSheet();
  this.syncHiddenColumnsFromSheet();
  this.updateFreezeState();
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm sheets typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/sheets/src/view/worksheet.ts
git commit -m "Re-resolve selection anchors on remote structural changes

reloadDimensions() calls resolveAnchorsToRefs() so activeCell
automatically tracks its axis ID after remote row/col inserts."
```

---

### Task 6: Overlay — Render Peer Selection Ranges

**Files:**
- Modify: `packages/sheets/src/view/overlay.ts:135-165,602-656`
- Modify: `packages/sheets/src/view/worksheet.ts:4509-4541`

- [ ] **Step 1: Update overlay `render()` signature for new presence type**

In `packages/sheets/src/view/overlay.ts`, update the `peerPresences` parameter type in `render()` (line 138) and `renderPeerCursorsSimple()` (line 605):

Change the presence type from:

```typescript
Array<{ clientID: string; presence: { activeCell: string; username?: string } }>
```

to:

```typescript
Array<{
  clientID: string;
  presence: {
    selection?: SelectionPresence;
    activeCell?: string;
    username?: string;
  };
}>
```

Add imports at the top of `overlay.ts`:

```typescript
import type { SelectionPresence } from '../model/workbook/anchor-conversion';
import { anchorToRef, rangeAnchorToRange } from '../model/workbook/anchor-conversion';
```

- [ ] **Step 2: Update `renderPeerCursorsSimple` to handle both formats and render ranges**

Replace the body of `renderPeerCursorsSimple` (lines 614-656):

```typescript
private renderPeerCursorsSimple(
  ctx: CanvasRenderingContext2D,
  port: BoundingRect,
  peerPresences: Array<{
    clientID: string;
    presence: {
      selection?: SelectionPresence;
      activeCell?: string;
      username?: string;
    };
  }>,
  scroll: { left: number; top: number },
  rowDim?: DimensionIndex,
  colDim?: DimensionIndex,
  mergeData?: {
    anchors: Map<string, MergeSpan>;
    coverToAnchor: Map<string, string>;
  },
  visiblePeerLabels?: Set<string>,
  rowOrder?: string[],
  colOrder?: string[],
): void {
  const cellPeers = new Map<string, Array<{ clientID: string; username: string; rect: BoundingRect }>>();

  for (const { clientID, presence } of peerPresences) {
    let peerActiveCell: Ref | null = null;
    let peerRanges: Range[] = [];

    if (presence.selection && rowOrder && colOrder) {
      // New format: axis ID based
      peerActiveCell = anchorToRef(presence.selection.activeCell, rowOrder, colOrder);
      for (const rangeAnchor of presence.selection.ranges) {
        const range = rangeAnchorToRange(rangeAnchor, rowOrder, colOrder);
        if (range) peerRanges.push(range);
      }
    } else if (presence.activeCell) {
      // Legacy format: Sref string
      peerActiveCell = parseRef(presence.activeCell);
    }

    if (!peerActiveCell) continue;

    const peerColor = getPeerCursorColor(this.theme, clientID);

    // Draw range backgrounds
    for (const range of peerRanges) {
      this.renderPeerRangeBackground(ctx, range, peerColor, scroll, rowDim, colDim);
    }

    // Draw active cell border
    const rect = this.toCellRect(peerActiveCell, scroll, rowDim, colDim, mergeData);
    if (rect.left >= -rect.width && rect.left < port.width &&
        rect.top >= -rect.height && rect.top < port.height) {
      ctx.strokeStyle = peerColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(rect.left, rect.top, rect.width, rect.height);

      if (visiblePeerLabels?.has(clientID) && presence.username) {
        const key = peerActiveCell.r + ',' + peerActiveCell.c;
        if (!cellPeers.has(key)) {
          cellPeers.set(key, []);
        }
        cellPeers.get(key)!.push({ clientID, username: presence.username, rect });
      }
    }
  }

  // Draw labels grouped by cell, stacked in stable clientID order.
  for (const peers of cellPeers.values()) {
    peers.sort((a, b) => a.clientID.localeCompare(b.clientID));
    for (let i = 0; i < peers.length; i++) {
      const { clientID, username, rect } = peers[i];
      const peerColor = getPeerCursorColor(this.theme, clientID);
      drawPeerLabel(ctx, username, peerColor, rect, port, i);
    }
  }
}
```

- [ ] **Step 3: Add `renderPeerRangeBackground` helper**

Add after `renderPeerCursorsSimple`:

```typescript
private renderPeerRangeBackground(
  ctx: CanvasRenderingContext2D,
  range: Range,
  color: string,
  scroll: { left: number; top: number },
  rowDim?: DimensionIndex,
  colDim?: DimensionIndex,
): void {
  const startRect = this.toCellRect(range[0], scroll, rowDim, colDim);
  const endRect = this.toCellRect(range[1], scroll, rowDim, colDim);
  const x = startRect.left;
  const y = startRect.top;
  const w = endRect.left + endRect.width - startRect.left;
  const h = endRect.top + endRect.height - startRect.top;

  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.1;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}
```

- [ ] **Step 4: Pass rowOrder/colOrder through render() → renderPeerCursorsSimple()**

Add `rowOrder?: string[]` and `colOrder?: string[]` parameters to the `render()` method signature (after `cellDragMovePreview`):

```typescript
rowOrder?: string[],
colOrder?: string[],
```

Pass them through to `renderPeerCursorsSimple()` call inside `render()`.

- [ ] **Step 5: Update worksheet.ts `renderOverlay` to pass rowOrder/colOrder**

In `packages/sheets/src/view/worksheet.ts` `renderOverlay()` method (lines 4509-4541), add the new arguments:

```typescript
public renderOverlay() {
  this.updatePeerLabelVisibility();
  this.overlay.render(
    this.viewport,
    this.scroll,
    this.sheet!.getActiveCell(),
    this.sheet!.getPresences(),
    this.sheet!.getRanges(),
    this.rowDim,
    this.colDim,
    this.resizeHover,
    this.resizeDragging,
    this.sheet!.getSelectionType(),
    this.dragMove
      ? { axis: this.dragMove.axis, dropIndex: this.dragMove.dropIndex }
      : null,
    this.formulaRanges,
    this.freezeState,
    this.freezeDrag,
    this.sheet!.getCopyRange(),
    this.sheet!.isCutMode(),
    this.autofillPreview,
    this.shouldShowAutofillHandle(),
    this.sheet!.getMerges(),
    this.sheet!.getFilterRange(),
    this.zoom,
    this.showMobileHandles,
    this._searchResults.length > 0 ? this._searchResults : undefined,
    this._searchCurrentIndex >= 0 ? this._searchCurrentIndex : undefined,
    this.getVisiblePeerLabels(),
    this.cellDragMovePreview,
    this.sheet!.getStore().getRowOrder(),
    this.sheet!.getStore().getColOrder(),
  );
}
```

Note: This requires `Sheet.getStore()` to be accessible. If it's not public, add a public getter:

```typescript
// In sheet.ts, add:
public getStore(): Store {
  return this.store;
}
```

- [ ] **Step 6: Verify typecheck and tests pass**

Run: `pnpm verify:fast`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/sheets/src/view/overlay.ts \
       packages/sheets/src/view/worksheet.ts \
       packages/sheets/src/model/worksheet/sheet.ts
git commit -m "Render peer selection ranges with translucent background

Overlay handles both axis-ID-based and legacy Sref-based peer
presences. Peer ranges are drawn with 10% opacity fill.
Active cell keeps colored border + name label."
```

---

### Task 7: Initialize Anchors on Sheet Load

**Files:**
- Modify: `packages/sheets/src/model/worksheet/sheet.ts`

- [ ] **Step 1: Initialize `activeCellAnchor` when sheet loads**

Find the Sheet constructor or initialization method where `activeCell` is first set. After `this.activeCell = { r: 1, c: 1 }` (or wherever the default is set), add anchor initialization.

In the constructor or `init()`-like method, after active cell is established:

```typescript
// Initialize anchor from the default activeCell
const rowOrder = this.store.getRowOrder();
const colOrder = this.store.getColOrder();
if (rowOrder.length > 0 && colOrder.length > 0) {
  this.activeCellAnchor = refToAnchor(this.activeCell, rowOrder, colOrder);
}
```

- [ ] **Step 2: Verify tests pass**

Run: `pnpm verify:fast`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/sheets/src/model/worksheet/sheet.ts
git commit -m "Initialize selection anchors on sheet load

Ensures activeCellAnchor is set from the start so
resolveAnchorsToRefs works on the first remote change."
```

---

### Task 8: Verify End-to-End and Clean Up

**Files:**
- Modify: `docs/design/sheets/axis-id-selection.md` (if needed)
- Modify: `docs/tasks/active/20260414-axis-id-selection-todo.md`

- [ ] **Step 1: Run full verification**

Run: `pnpm verify:fast`
Expected: ALL PASS

- [ ] **Step 2: Run typecheck across all packages**

Run: `pnpm sheets typecheck && pnpm --filter @wafflebase/frontend exec tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Search for leftover `updateActiveCell` references**

Search for any remaining `updateActiveCell` calls in the codebase that haven't been updated. These would be compile errors but verify none are hidden:

```bash
grep -r "updateActiveCell" packages/ --include="*.ts" --include="*.tsx"
```

Expected: No matches (all replaced with `updateSelection` or `syncSelectionToPresence`)

- [ ] **Step 4: Manual testing checklist**

1. Open sheet in two browser tabs (ClientA, ClientB)
2. ClientA selects cell D4
3. ClientB inserts a row at row 2
4. Verify: ClientA's selection moves to D5
5. ClientB deletes row 3
6. Verify: ClientA's selection adjusts correctly
7. ClientA selects range B2:D5, verify ClientB sees translucent range overlay
8. ClientA selects entire row 3, verify ClientB sees full-row highlight
9. Both clients select different cells — verify both peer cursors visible with labels

- [ ] **Step 5: Final commit with task completion**

```bash
pnpm tasks:archive && pnpm tasks:index
git add docs/
git commit -m "Complete axis ID based selection implementation

Verified end-to-end: remote structural edits preserve selection,
peer ranges render correctly, backward compatibility works."
```
