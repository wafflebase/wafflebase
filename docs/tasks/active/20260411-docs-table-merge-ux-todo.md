# Docs Table Merge UX Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement
> task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make table cell merge/unmerge a first-class context-menu action,
with drag-time selection auto-expansion so users can preview the exact
merge area before invoking it.

**Architecture:** A pure helper in `selection.ts` expands a `TableCellRange`
to a bounding rectangle that fully contains every merged cell it touches
(fixed-point loop). The expansion is invoked at write-time by the drag and
Shift+Arrow handlers, and at read-time by `normalizeRange` for safety
(peer cursor renders, programmatic ranges). A new pure
`computeTableMergeContext` function returns `'none' | 'canMerge' |
'canUnmerge'` plus the data needed to act, and `EditorAPI.getTableMergeContext`
exposes it. The frontend context menu reads this once on open and renders a
single hybrid slot whose label/icon/disabled state follow the result.

**Tech Stack:** TypeScript, Vitest, React (frontend menu), Tabler icons.

**Design:** [docs-tables.md — Cell Range Normalization & Cell Merge UX](../../design/docs/docs-tables.md#cell-range-normalization)
**Lessons:** [20260411-docs-table-merge-ux-lessons.md](20260411-docs-table-merge-ux-lessons.md)

---

## Conventions

- Test runner: `pnpm test` (Vitest, runs in the `packages/docs` workspace).
- Pre-commit gate: `pnpm verify:fast` (lint + unit tests).
- Frequent commits: one commit per task (after the task's tests pass).
- All file paths in this plan are relative to the worktree root
  `.claude/worktrees/feature+header-footer/`.

---

## Task 1 — Pure helpers: `findMergeTopLeft` and `expandCellRangeForMerges`

**Files:**
- Modify: `packages/docs/src/view/selection.ts` (add helpers above existing
  `normalizeCellRange`)
- Create: `packages/docs/test/view/cell-range-expand.test.ts`

These two helpers are pure functions over `TableData` and a
`TableCellRange`. They have no dependency on layout, DOM, or
`DocumentLayout`. Tests can construct `TableData` directly.

- [ ] **Step 1: Write the failing test file**

Create `packages/docs/test/view/cell-range-expand.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  expandCellRangeForMerges,
  findMergeTopLeft,
} from '../../src/view/selection.js';
import type { TableCell, TableData, TableCellRange } from '../../src/model/types.js';

function plainCell(): TableCell {
  return {
    blocks: [{ id: 'b', type: 'paragraph', inlines: [{ text: '', style: {} }], style: {} as any }],
    style: {},
  };
}

function coveredCell(): TableCell {
  return { ...plainCell(), colSpan: 0 };
}

function mergedTopLeft(rowSpan: number, colSpan: number): TableCell {
  return { ...plainCell(), rowSpan, colSpan };
}

function makeTable(rows: number, cols: number, overrides: Record<string, TableCell> = {}): TableData {
  const data: TableData = { rows: [], columnWidths: Array(cols).fill(1 / cols) };
  for (let r = 0; r < rows; r++) {
    const cells: TableCell[] = [];
    for (let c = 0; c < cols; c++) {
      cells.push(overrides[`${r},${c}`] ?? plainCell());
    }
    data.rows.push({ cells });
  }
  return data;
}

function rect(r1: number, c1: number, r2: number, c2: number): TableCellRange {
  return { blockId: 't', start: { rowIndex: r1, colIndex: c1 }, end: { rowIndex: r2, colIndex: c2 } };
}

describe('findMergeTopLeft', () => {
  it('returns the cell itself when it is a plain cell', () => {
    const t = makeTable(3, 3);
    expect(findMergeTopLeft(t, 1, 1)).toEqual({ rowIndex: 1, colIndex: 1 });
  });

  it('returns the cell itself when it is a merge top-left', () => {
    const t = makeTable(3, 3, { '0,0': mergedTopLeft(2, 2), '0,1': coveredCell(), '1,0': coveredCell(), '1,1': coveredCell() });
    expect(findMergeTopLeft(t, 0, 0)).toEqual({ rowIndex: 0, colIndex: 0 });
  });

  it('walks back from a covered cell to its top-left', () => {
    const t = makeTable(3, 3, { '0,0': mergedTopLeft(2, 2), '0,1': coveredCell(), '1,0': coveredCell(), '1,1': coveredCell() });
    expect(findMergeTopLeft(t, 1, 1)).toEqual({ rowIndex: 0, colIndex: 0 });
    expect(findMergeTopLeft(t, 0, 1)).toEqual({ rowIndex: 0, colIndex: 0 });
    expect(findMergeTopLeft(t, 1, 0)).toEqual({ rowIndex: 0, colIndex: 0 });
  });
});

describe('expandCellRangeForMerges', () => {
  it('returns input rect unchanged when no merges touched', () => {
    const t = makeTable(3, 3);
    const r = rect(0, 0, 1, 1);
    expect(expandCellRangeForMerges(r, t)).toEqual(r);
  });

  it('expands when range partially overlaps a merge top-left', () => {
    // (1,1) is a 2x2 merged top-left covering (1,1)..(2,2)
    const t = makeTable(4, 4, {
      '1,1': mergedTopLeft(2, 2), '1,2': coveredCell(), '2,1': coveredCell(), '2,2': coveredCell(),
    });
    // User selects (0,0)..(1,1) — overlaps merge top-left
    const result = expandCellRangeForMerges(rect(0, 0, 1, 1), t);
    expect(result.start).toEqual({ rowIndex: 0, colIndex: 0 });
    expect(result.end).toEqual({ rowIndex: 2, colIndex: 2 });
  });

  it('walks back from a covered cell to include its top-left', () => {
    const t = makeTable(4, 4, {
      '1,1': mergedTopLeft(2, 2), '1,2': coveredCell(), '2,1': coveredCell(), '2,2': coveredCell(),
    });
    // User selects (2,2)..(3,3) — starts on a covered cell
    const result = expandCellRangeForMerges(rect(2, 2, 3, 3), t);
    expect(result.start).toEqual({ rowIndex: 1, colIndex: 1 });
    expect(result.end).toEqual({ rowIndex: 3, colIndex: 3 });
  });

  it('chains expansion across multiple merges (fixed-point)', () => {
    const t = makeTable(5, 5, {
      // Merge A: (0,2)..(1,3)
      '0,2': mergedTopLeft(2, 2), '0,3': coveredCell(),
      '1,2': coveredCell(), '1,3': coveredCell(),
      // Merge B: (1,0)..(2,1)
      '1,0': mergedTopLeft(2, 2), '1,1': coveredCell(),
      '2,0': coveredCell(), '2,1': coveredCell(),
    });
    // User picks (0,0)..(0,2): touches Merge A's top-left → expands to (0,0)..(1,3),
    // which now contains Merge B's top-left → expands to (0,0)..(2,3).
    const result = expandCellRangeForMerges(rect(0, 0, 0, 2), t);
    expect(result.start).toEqual({ rowIndex: 0, colIndex: 0 });
    expect(result.end).toEqual({ rowIndex: 2, colIndex: 3 });
  });

  it('handles a range whose start is greater than end (caller has not ordered)', () => {
    const t = makeTable(3, 3);
    const r = rect(2, 2, 0, 0);
    const result = expandCellRangeForMerges(r, t);
    expect(result.start).toEqual({ rowIndex: 0, colIndex: 0 });
    expect(result.end).toEqual({ rowIndex: 2, colIndex: 2 });
  });

  it('preserves blockId', () => {
    const t = makeTable(2, 2);
    const r: TableCellRange = { blockId: 'my-table', start: { rowIndex: 0, colIndex: 0 }, end: { rowIndex: 1, colIndex: 1 } };
    expect(expandCellRangeForMerges(r, t).blockId).toBe('my-table');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @wafflebase/docs test --run test/view/cell-range-expand.test.ts
```

Expected: failure with "expandCellRangeForMerges is not exported from
'../../src/view/selection.js'" (or equivalent).

- [ ] **Step 3: Implement the helpers in `selection.ts`**

In `packages/docs/src/view/selection.ts`, immediately after the imports
(before the `NormalizedRange` interface), add:

```typescript
import type { TableData, CellAddress } from '../model/types.js';
```

(The first import line currently imports from `'../model/types.js'`. Add
`TableData` and `CellAddress` to that import — do not duplicate the import
statement.)

Then add the two helpers above the existing `normalizeCellRange`
(currently at line 17):

```typescript
/**
 * Walk back from `(r, c)` to the top-left of the merged cell that covers it.
 * Returns `(r, c)` itself if the cell is plain or already a merge top-left.
 *
 * The data model has no back-pointer, so we scan upward and leftward looking
 * for a cell whose `colSpan`/`rowSpan` reaches `(r, c)`. Tables are small in
 * practice; the cost is bounded by the table area.
 */
export function findMergeTopLeft(table: TableData, r: number, c: number): CellAddress {
  const cell = table.rows[r]?.cells[c];
  if (!cell) return { rowIndex: r, colIndex: c };
  if (cell.colSpan !== 0) return { rowIndex: r, colIndex: c };

  for (let rr = r; rr >= 0; rr--) {
    for (let cc = c; cc >= 0; cc--) {
      const candidate = table.rows[rr]?.cells[cc];
      if (!candidate) continue;
      const span = candidate.colSpan ?? 1;
      const rspan = candidate.rowSpan ?? 1;
      if (span > 1 || rspan > 1) {
        if (rr + rspan - 1 >= r && cc + span - 1 >= c) {
          return { rowIndex: rr, colIndex: cc };
        }
      }
    }
  }
  return { rowIndex: r, colIndex: c };
}

/**
 * Expand a cell range to a bounding rectangle that fully contains every
 * merged cell it touches. Runs a fixed-point loop because expanding for one
 * merge can pull a previously-out-of-range merge into the rect.
 *
 * Caller may pass an unordered range — this helper orders start/end first.
 */
export function expandCellRangeForMerges(
  cr: TableCellRange,
  table: TableData,
): TableCellRange {
  let rowStart = Math.min(cr.start.rowIndex, cr.end.rowIndex);
  let rowEnd = Math.max(cr.start.rowIndex, cr.end.rowIndex);
  let colStart = Math.min(cr.start.colIndex, cr.end.colIndex);
  let colEnd = Math.max(cr.start.colIndex, cr.end.colIndex);

  let changed = true;
  while (changed) {
    changed = false;
    for (let r = rowStart; r <= rowEnd; r++) {
      for (let c = colStart; c <= colEnd; c++) {
        const cell = table.rows[r]?.cells[c];
        if (!cell) continue;
        const span = cell.colSpan ?? 1;
        const rspan = cell.rowSpan ?? 1;

        // Top-left of a merge whose span extends past current rect.
        if (span > 1 || rspan > 1) {
          const r2 = r + rspan - 1;
          const c2 = c + span - 1;
          if (r2 > rowEnd) { rowEnd = r2; changed = true; }
          if (c2 > colEnd) { colEnd = c2; changed = true; }
        }

        // Covered cell whose top-left is outside current rect.
        if (cell.colSpan === 0) {
          const tl = findMergeTopLeft(table, r, c);
          if (tl.rowIndex < rowStart) { rowStart = tl.rowIndex; changed = true; }
          if (tl.colIndex < colStart) { colStart = tl.colIndex; changed = true; }
        }
      }
    }
  }

  return {
    blockId: cr.blockId,
    start: { rowIndex: rowStart, colIndex: colStart },
    end: { rowIndex: rowEnd, colIndex: colEnd },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @wafflebase/docs test --run test/view/cell-range-expand.test.ts
```

Expected: all 9 tests pass.

- [ ] **Step 5: Run the full docs test suite to confirm nothing else broke**

```bash
pnpm --filter @wafflebase/docs test --run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/docs/src/view/selection.ts packages/docs/test/view/cell-range-expand.test.ts
git commit -m "$(cat <<'EOF'
Add cell range expansion helpers for merged-cell-aware selection

Pure helpers in selection.ts: findMergeTopLeft walks back from a covered
cell to its merge top-left, and expandCellRangeForMerges runs a fixed-point
loop to grow a bounding rectangle until it fully contains every merged cell
it touches. These will back the drag-time auto-expand of cell-range
selections so users see the exact area that will be merged.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 — Wire `normalizeCellRange` to expand at read time

**Files:**
- Modify: `packages/docs/src/view/selection.ts:17` (`normalizeCellRange`)
  and `packages/docs/src/view/selection.ts:25` (`normalizeRange` call site)

`normalizeRange` already has access to `DocumentLayout`. We can look up the
table block from there and pass its `tableData` into `normalizeCellRange`.
This protects read paths (peer cursor rendering, programmatic ranges) even
if the write-time path (Task 3) misses an edge case.

- [ ] **Step 1: Write a regression test against `Selection.getNormalizedRange`**

Append to `packages/docs/test/view/cell-range-expand.test.ts`:

```typescript
import { Selection } from '../../src/view/selection.js';
import type { DocumentLayout, LayoutBlock } from '../../src/view/layout.js';

describe('Selection.getNormalizedRange — cell range expansion at read time', () => {
  it('expands a partially-overlapping cell range using layout TableData', () => {
    // Build a minimal fake DocumentLayout with one table block
    const t = makeTable(4, 4, {
      '1,1': mergedTopLeft(2, 2), '1,2': coveredCell(),
      '2,1': coveredCell(), '2,2': coveredCell(),
    });
    const tableBlock: any = {
      id: 't', type: 'table', inlines: [], style: {},
      tableData: t,
    };
    const lb: LayoutBlock = {
      block: tableBlock,
      lines: [],
      width: 0, height: 0, top: 0,
    } as unknown as LayoutBlock;
    const layout: DocumentLayout = {
      blocks: [lb],
      blockParentMap: new Map(),
    } as unknown as DocumentLayout;

    const sel = new Selection();
    sel.setRange({
      anchor: { blockId: 'anchor', offset: 0 },
      focus: { blockId: 'focus', offset: 0 },
      tableCellRange: rect(0, 0, 1, 1),
    });

    const normalized = sel.getNormalizedRange(layout);
    expect(normalized?.tableCellRange?.start).toEqual({ rowIndex: 0, colIndex: 0 });
    expect(normalized?.tableCellRange?.end).toEqual({ rowIndex: 2, colIndex: 2 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @wafflebase/docs test --run test/view/cell-range-expand.test.ts
```

Expected: the new test fails — current `normalizeCellRange` only orders,
does not expand.

- [ ] **Step 3: Update `normalizeCellRange` and `normalizeRange`**

In `packages/docs/src/view/selection.ts`, replace the existing
`normalizeCellRange` (line 17) with:

```typescript
function normalizeCellRange(cr: TableCellRange, table?: TableData): TableCellRange {
  const ordered: TableCellRange = {
    blockId: cr.blockId,
    start: {
      rowIndex: Math.min(cr.start.rowIndex, cr.end.rowIndex),
      colIndex: Math.min(cr.start.colIndex, cr.end.colIndex),
    },
    end: {
      rowIndex: Math.max(cr.start.rowIndex, cr.end.rowIndex),
      colIndex: Math.max(cr.start.colIndex, cr.end.colIndex),
    },
  };
  return table ? expandCellRangeForMerges(ordered, table) : ordered;
}
```

In the same file, update the cell-range branch of `normalizeRange`
(currently lines 29–36):

```typescript
  // Cell-range mode: tableCellRange is set
  if (range.tableCellRange) {
    const lb = layout.blocks.find((b) => b.block.id === range.tableCellRange!.blockId);
    const table = lb?.block.tableData;
    return {
      start: range.anchor,
      end: range.focus,
      tableCellRange: normalizeCellRange(range.tableCellRange, table),
    };
  }
```

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter @wafflebase/docs test --run test/view/cell-range-expand.test.ts
```

Expected: all tests pass, including the new read-time test.

- [ ] **Step 5: Run the full docs suite**

```bash
pnpm --filter @wafflebase/docs test --run
```

Expected: pass. If `table-selection.test.ts` or any other selection-related
test fails, investigate before continuing.

- [ ] **Step 6: Commit**

```bash
git add packages/docs/src/view/selection.ts packages/docs/test/view/cell-range-expand.test.ts
git commit -m "$(cat <<'EOF'
Auto-expand cell ranges at read time using table data from layout

normalizeCellRange now optionally takes TableData and runs the fixed-point
expander before returning. normalizeRange looks the table up from layout
and threads it through, so peer cursor rendering and programmatic ranges
get the expanded rectangle even without a write-time normalization pass.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 — Expand at write time in `text-editor.ts`

**Files:**
- Modify: `packages/docs/src/view/text-editor.ts:1156` (drag selection
  cell-range branch) and `packages/docs/src/view/text-editor.ts:1820`
  (Shift+arrow cross-cell branch).

Read-time normalization (Task 2) handles correctness, but for the drag
preview to actually show the expanded rectangle in real time, the value
written to `selection.range.tableCellRange` must already be expanded.
Otherwise the highlight reflects the raw drag rect on the cell-range path
that bypasses `normalizeRange` (e.g. `applyTableCellStyle` reads
`selection.range.tableCellRange` directly).

- [ ] **Step 1: Add the import for the expander**

At the top of `packages/docs/src/view/text-editor.ts`, find the existing
import from `'./selection.js'`. If one exists, add `expandCellRangeForMerges`
to it. Otherwise add a new import:

```typescript
import { expandCellRangeForMerges } from './selection.js';
```

(Check existing imports first to avoid duplicates.)

- [ ] **Step 2: Expand the drag-selection cell-range write**

Replace the cell-range branch around line 1156 in `updateDragSelection`:

```typescript
            } else if (currentCA) {
              // Different cell — cell-range mode
              const tableData = this.doc.getBlock(tableBlockId).tableData!;
              tableCellRange = expandCellRangeForMerges(
                {
                  blockId: tableBlockId,
                  start: anchorCA,
                  end: currentCA,
                },
                tableData,
              );
              const targetCell = tableData.rows[tableCellRange.end.rowIndex]
                .cells[tableCellRange.end.colIndex];
              pos = {
                blockId: targetCell.blocks[0].id,
                offset: 0,
              };
            }
```

Note: this initial draft of the step moved `pos` to the expanded `end`, but
that lands the cursor on a covered cell (`colSpan === 0`) whenever the
expansion extends rightward into a merge. The implemented code (see code
review fix commit) keeps `pos` derived from the raw `currentCA`, which
`resolveTableCellClick` guarantees is a visible top-left. The expanded
range is still the one stored on `selection.range.tableCellRange` for
highlighting — only the cursor target stays at the raw hit-test cell.

- [ ] **Step 3: Expand the Shift+Arrow cell-range write**

Find the second `tableCellRange:` write at line ~1820 (in the Shift+Arrow
cross-cell branch). The current shape is:

```typescript
              tableCellRange: {
                ...
              },
```

Replace the inline literal with an `expandCellRangeForMerges` call. Read
that block first to see exactly which fields are present, then wrap the
literal:

```typescript
              tableCellRange: expandCellRangeForMerges(
                {
                  blockId: <tableBlockIdVar>,
                  start: <startVar>,
                  end: <endVar>,
                },
                this.doc.getBlock(<tableBlockIdVar>).tableData!,
              ),
```

(Use the actual local-variable names from the surrounding code — do not
guess. Read lines 1810–1830 first, identify the variables, then make the
edit.)

- [ ] **Step 4: Build the docs package to catch type errors**

```bash
pnpm --filter @wafflebase/docs build
```

Expected: clean build.

- [ ] **Step 5: Run the docs test suite**

```bash
pnpm --filter @wafflebase/docs test --run
```

Expected: pass. If selection or table tests fail, investigate.

- [ ] **Step 6: Commit**

```bash
git add packages/docs/src/view/text-editor.ts
git commit -m "$(cat <<'EOF'
Expand cell ranges at write time so drag preview reflects merge bounds

The drag-selection and Shift+Arrow cross-cell paths now run the cell range
through expandCellRangeForMerges before storing it on the selection. The
highlight is built from this stored value, so users see the exact area
that will be merged before they open the context menu.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4 — `computeTableMergeContext` pure helper

**Files:**
- Create: `packages/docs/src/view/table-merge-context.ts`
- Create: `packages/docs/test/view/table-merge-context.test.ts`

A pure function that, given the doc, the cursor, and the current selection
range, returns the state the menu needs. Pure = no DOM, no editor instance,
trivially testable.

- [ ] **Step 1: Write the failing test**

Create `packages/docs/test/view/table-merge-context.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { Doc } from '../../src/model/document.js';
import { computeTableMergeContext } from '../../src/view/table-merge-context.js';
import type { BlockCellInfo, CellAddress, DocPosition } from '../../src/model/types.js';

function buildParentMap(doc: Doc, tableBlockId: string): Map<string, BlockCellInfo> {
  const map = new Map<string, BlockCellInfo>();
  const block = doc.getBlock(tableBlockId);
  if (!block.tableData) return map;
  for (let r = 0; r < block.tableData.rows.length; r++) {
    for (let c = 0; c < block.tableData.rows[r].cells.length; c++) {
      for (const b of block.tableData.rows[r].cells[c].blocks) {
        map.set(b.id, { tableBlockId, rowIndex: r, colIndex: c });
      }
    }
  }
  return map;
}

function cellBlockId(doc: Doc, tableId: string, cell: CellAddress): string {
  return doc.getBlock(tableId).tableData!.rows[cell.rowIndex].cells[cell.colIndex].blocks[0].id;
}

describe('computeTableMergeContext', () => {
  let doc: Doc;
  let tableId: string;
  let parentMap: Map<string, BlockCellInfo>;

  beforeEach(() => {
    doc = Doc.create();
    tableId = doc.insertTable(1, 3, 3);
    parentMap = buildParentMap(doc, tableId);
  });

  it('returns none when cursor is not in a table', () => {
    const pos: DocPosition = { blockId: doc.document.blocks[0].id, offset: 0 };
    expect(computeTableMergeContext(doc, parentMap, pos, null)).toEqual({ state: 'none' });
  });

  it('returns none for a single-cell cursor with no selection', () => {
    const pos: DocPosition = { blockId: cellBlockId(doc, tableId, { rowIndex: 0, colIndex: 0 }), offset: 0 };
    expect(computeTableMergeContext(doc, parentMap, pos, null).state).toBe('none');
  });

  it('returns canMerge when a 2x2 cell range is active', () => {
    const pos: DocPosition = { blockId: cellBlockId(doc, tableId, { rowIndex: 0, colIndex: 0 }), offset: 0 };
    const ctx = computeTableMergeContext(doc, parentMap, pos, {
      anchor: pos,
      focus: pos,
      tableCellRange: {
        blockId: tableId,
        start: { rowIndex: 0, colIndex: 0 },
        end: { rowIndex: 1, colIndex: 1 },
      },
    });
    expect(ctx.state).toBe('canMerge');
    if (ctx.state === 'canMerge') {
      expect(ctx.tableBlockId).toBe(tableId);
      expect(ctx.range.start).toEqual({ rowIndex: 0, colIndex: 0 });
      expect(ctx.range.end).toEqual({ rowIndex: 1, colIndex: 1 });
    }
  });

  it('returns none when the range covers exactly one cell (area 1)', () => {
    const pos: DocPosition = { blockId: cellBlockId(doc, tableId, { rowIndex: 0, colIndex: 0 }), offset: 0 };
    const ctx = computeTableMergeContext(doc, parentMap, pos, {
      anchor: pos,
      focus: pos,
      tableCellRange: {
        blockId: tableId,
        start: { rowIndex: 0, colIndex: 0 },
        end: { rowIndex: 0, colIndex: 0 },
      },
    });
    expect(ctx.state).toBe('none');
  });

  it('returns canUnmerge when cursor is inside an existing merged cell', () => {
    doc.mergeCells(tableId, { start: { rowIndex: 0, colIndex: 0 }, end: { rowIndex: 1, colIndex: 1 } });
    parentMap = buildParentMap(doc, tableId);
    const pos: DocPosition = { blockId: cellBlockId(doc, tableId, { rowIndex: 0, colIndex: 0 }), offset: 0 };
    const ctx = computeTableMergeContext(doc, parentMap, pos, null);
    expect(ctx.state).toBe('canUnmerge');
    if (ctx.state === 'canUnmerge') {
      expect(ctx.cell).toEqual({ rowIndex: 0, colIndex: 0 });
      expect(ctx.tableBlockId).toBe(tableId);
    }
  });

  it('canMerge wins when cursor is in a merged cell and a range is also active', () => {
    doc.mergeCells(tableId, { start: { rowIndex: 0, colIndex: 0 }, end: { rowIndex: 1, colIndex: 1 } });
    parentMap = buildParentMap(doc, tableId);
    const pos: DocPosition = { blockId: cellBlockId(doc, tableId, { rowIndex: 0, colIndex: 0 }), offset: 0 };
    const ctx = computeTableMergeContext(doc, parentMap, pos, {
      anchor: pos,
      focus: pos,
      tableCellRange: {
        blockId: tableId,
        start: { rowIndex: 0, colIndex: 0 },
        end: { rowIndex: 0, colIndex: 2 },
      },
    });
    expect(ctx.state).toBe('canMerge');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @wafflebase/docs test --run test/view/table-merge-context.test.ts
```

Expected: failure — module does not exist.

- [ ] **Step 3: Implement `table-merge-context.ts`**

Create `packages/docs/src/view/table-merge-context.ts`:

```typescript
import type { Doc } from '../model/document.js';
import type {
  BlockCellInfo,
  CellAddress,
  CellRange,
  DocPosition,
  DocRange,
} from '../model/types.js';

export type TableMergeContext =
  | { state: 'none' }
  | { state: 'canMerge'; tableBlockId: string; range: CellRange }
  | { state: 'canUnmerge'; tableBlockId: string; cell: CellAddress };

/**
 * Decide which merge action (if any) the context menu should offer.
 *
 * Rules:
 *  - Cursor outside a table → none.
 *  - Active cell range covering ≥ 2 cells → canMerge (range from selection).
 *    Wins over canUnmerge so a user can grow an existing merge.
 *  - Cursor in a cell with `colSpan > 1` or `rowSpan > 1` → canUnmerge.
 *  - Otherwise → none.
 *
 * Pure: no DOM, no editor reference. Reads only `doc`, the parent map, the
 * cursor position, and the selection range.
 */
export function computeTableMergeContext(
  doc: Doc,
  blockParentMap: Map<string, BlockCellInfo>,
  cursorPos: DocPosition,
  selectionRange: DocRange | null,
): TableMergeContext {
  const cellInfo = blockParentMap.get(cursorPos.blockId);
  if (!cellInfo) return { state: 'none' };

  const tableBlockId = cellInfo.tableBlockId;
  const cr = selectionRange?.tableCellRange;
  if (cr && cr.blockId === tableBlockId) {
    const rowSpan = Math.abs(cr.end.rowIndex - cr.start.rowIndex) + 1;
    const colSpan = Math.abs(cr.end.colIndex - cr.start.colIndex) + 1;
    if (rowSpan * colSpan >= 2) {
      return {
        state: 'canMerge',
        tableBlockId,
        range: {
          start: {
            rowIndex: Math.min(cr.start.rowIndex, cr.end.rowIndex),
            colIndex: Math.min(cr.start.colIndex, cr.end.colIndex),
          },
          end: {
            rowIndex: Math.max(cr.start.rowIndex, cr.end.rowIndex),
            colIndex: Math.max(cr.start.colIndex, cr.end.colIndex),
          },
        },
      };
    }
  }

  const tableData = doc.getBlock(tableBlockId).tableData;
  const cell = tableData?.rows[cellInfo.rowIndex]?.cells[cellInfo.colIndex];
  if (cell && ((cell.colSpan ?? 1) > 1 || (cell.rowSpan ?? 1) > 1)) {
    return {
      state: 'canUnmerge',
      tableBlockId,
      cell: { rowIndex: cellInfo.rowIndex, colIndex: cellInfo.colIndex },
    };
  }

  return { state: 'none' };
}
```

- [ ] **Step 4: Run the new tests**

```bash
pnpm --filter @wafflebase/docs test --run test/view/table-merge-context.test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 5: Run the full docs suite**

```bash
pnpm --filter @wafflebase/docs test --run
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add packages/docs/src/view/table-merge-context.ts packages/docs/test/view/table-merge-context.test.ts
git commit -m "$(cat <<'EOF'
Add computeTableMergeContext pure helper for menu state

Returns 'none' | 'canMerge' | 'canUnmerge' plus the data the menu needs to
act. Pure function over Doc, parent map, cursor, and selection range — no
DOM, no editor reference, fully unit-testable. Range presence wins over
canUnmerge so a user inside an existing merged cell can still grow the
merge by selecting a wider range.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 — Expose `getTableMergeContext` on `EditorAPI`

**Files:**
- Modify: `packages/docs/src/view/editor.ts:21` (`EditorAPI` interface) and
  `packages/docs/src/view/editor.ts:293` (the `initialize` factory body)
- Modify: `packages/docs/src/index.ts` (re-export `TableMergeContext`)

- [ ] **Step 1: Add the type re-export**

Open `packages/docs/src/index.ts`. Find the existing exports. Add:

```typescript
export type { TableMergeContext } from './view/table-merge-context.js';
```

If `index.ts` already re-exports types via `export type { ... } from './view/...'`,
follow the existing pattern.

- [ ] **Step 2: Add the API method to the `EditorAPI` interface**

In `packages/docs/src/view/editor.ts`, add an import at the top:

```typescript
import { computeTableMergeContext, type TableMergeContext } from './table-merge-context.js';
```

In the `EditorAPI` interface (around line 87, near `mergeTableCells`), add:

```typescript
  /** Compute the merge/unmerge state for the menu (current cursor + selection) */
  getTableMergeContext(): TableMergeContext;
```

- [ ] **Step 3: Implement the method in the factory return object**

In the same file, find the section returning the EditorAPI object (the
block containing `mergeTableCells: ...` at line 1359 and `splitTableCell: ...`
at line 1372). Add a new entry directly after `splitTableCell`:

```typescript
    getTableMergeContext: () =>
      computeTableMergeContext(doc, layout.blockParentMap, cursor.position, selection.range),
```

- [ ] **Step 4: Build to catch type errors**

```bash
pnpm --filter @wafflebase/docs build
```

Expected: clean build.

- [ ] **Step 5: Run all docs tests**

```bash
pnpm --filter @wafflebase/docs test --run
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add packages/docs/src/view/editor.ts packages/docs/src/index.ts
git commit -m "$(cat <<'EOF'
Expose getTableMergeContext on EditorAPI

Thin wrapper around computeTableMergeContext that the frontend context menu
calls when it opens, so the merge/unmerge slot can render the right label,
icon, and enabled state without duplicating selection logic.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6 — Verify `Doc.mergeCells` handles a range that already contains a merge

**Files:**
- Modify: `packages/docs/test/model/table.test.ts` (add a regression test)
- Possibly modify: `packages/docs/src/model/document.ts:669` (only if test fails)

The current `mergeCells` algorithm assumes a rectangular range and iterates
each cell, hoisting blocks to the top-left and marking the rest covered.
Auto-expansion (Tasks 1–3) will routinely produce ranges that contain an
already-merged cell. We need to verify the algorithm handles that, and add
a regression test.

- [ ] **Step 1: Write the regression test**

Append to `packages/docs/test/model/table.test.ts` inside the existing
`describe('mergeCells', ...)` block:

```typescript
    it('absorbs an existing merged cell when the new range contains it', () => {
      const doc = Doc.create();
      const tableId = doc.insertTable(0, 4, 4);
      doc.setBlockParentMap(buildParentMap(doc, tableId));

      // Pre-merge (1,1)..(2,2) with text "M"
      const cellBlock11 = getCellBlock(doc, tableId, { rowIndex: 1, colIndex: 1 });
      doc.insertText({ blockId: cellBlock11.id, offset: 0 }, 'M');
      doc.mergeCells(tableId, { start: { rowIndex: 1, colIndex: 1 }, end: { rowIndex: 2, colIndex: 2 } });

      // Add some text outside the merge
      const cellBlock00 = getCellBlock(doc, tableId, { rowIndex: 0, colIndex: 0 });
      doc.insertText({ blockId: cellBlock00.id, offset: 0 }, 'X');

      // Now merge a 4x4 range containing the existing merge
      doc.mergeCells(tableId, { start: { rowIndex: 0, colIndex: 0 }, end: { rowIndex: 3, colIndex: 3 } });

      const block = doc.getBlock(tableId);
      const tl = block.tableData!.rows[0].cells[0];
      expect(tl.colSpan).toBe(4);
      expect(tl.rowSpan).toBe(4);

      // The text from the inner merge should be preserved in the outer top-left
      const allText = tl.blocks.flatMap(b => b.inlines).map(i => i.text).join('');
      expect(allText).toContain('X');
      expect(allText).toContain('M');

      // Every other cell should be covered
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          if (r === 0 && c === 0) continue;
          const cell = block.tableData!.rows[r].cells[c];
          expect(cell.colSpan).toBe(0);
        }
      }
    });
```

- [ ] **Step 2: Run the test**

```bash
pnpm --filter @wafflebase/docs test --run test/model/table.test.ts
```

Expected outcome: most likely **passes** (the existing algorithm already
handles this — see `document.ts:678`–`705`). If it fails, that is a real
bug surfaced by the new test and must be fixed before continuing.

- [ ] **Step 3: If the test passed, commit it as a regression guard**

```bash
git add packages/docs/test/model/table.test.ts
git commit -m "$(cat <<'EOF'
Add regression test for merging a range that contains an existing merge

The auto-expansion path will routinely produce ranges that contain a
pre-existing merged cell, so we lock in the current Doc.mergeCells
behavior: outer top-left absorbs inner span and inner content, every
other cell ends up covered.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

If the test failed instead, fix `Doc.mergeCells` to handle the nested case,
re-run the test until it passes, then commit the test + fix together with
an explanatory message.

---

## Task 7 — Context menu UI: hybrid Merge/Unmerge slot

**Files:**
- Modify: `packages/frontend/src/app/docs/docs-table-context-menu.tsx`

- [ ] **Step 1: Add the new icon and type imports**

At the top of `packages/frontend/src/app/docs/docs-table-context-menu.tsx`,
add `IconArrowsJoin` to the existing `@tabler/icons-react` import:

```typescript
import {
  IconRowInsertTop,
  IconRowInsertBottom,
  IconColumnInsertLeft,
  IconColumnInsertRight,
  IconRowRemove,
  IconColumnRemove,
  IconArrowsJoin,
  IconArrowsSplit,
  IconDropletOff,
  IconPalette,
  IconTableOff,
} from "@tabler/icons-react";
```

Add the type import next to the existing `EditorAPI` import:

```typescript
import type { EditorAPI, TableMergeContext } from "@wafflebase/docs";
```

- [ ] **Step 2: Cache the merge context in component state**

Add a new state hook alongside the existing ones (after `useState<MenuPosition | null>`):

```typescript
  const [mergeCtx, setMergeCtx] = useState<TableMergeContext>({ state: 'none' });
```

In `handleContextMenu`, capture the merge context when the menu opens:

```typescript
  const handleContextMenu = useCallback(
    (e: MouseEvent) => {
      if (!editor?.isInTable()) return;
      e.preventDefault();
      setPosition({ x: e.clientX, y: e.clientY });
      setMergeCtx(editor.getTableMergeContext());
      setShowColors(false);
    },
    [editor],
  );
```

- [ ] **Step 3: Replace the unconditional "Split cell" button with the hybrid slot**

Find the existing block (around line 135–139):

```tsx
      <button className={item} onClick={act(() => editor.splitTableCell())}>
        <IconArrowsSplit size={iconSize} className="text-muted-foreground" />
        Split cell
      </button>
```

Replace it with:

```tsx
      {/* Cell merge / unmerge — single hybrid slot */}
      {mergeCtx.state === 'canUnmerge' ? (
        <button className={item} onClick={act(() => editor.splitTableCell())}>
          <IconArrowsSplit size={iconSize} className="text-muted-foreground" />
          Unmerge cells
        </button>
      ) : (
        <button
          className={`${item} disabled:opacity-50 disabled:pointer-events-none`}
          disabled={mergeCtx.state !== 'canMerge'}
          onClick={
            mergeCtx.state === 'canMerge'
              ? act(() => editor.mergeTableCells(mergeCtx.range))
              : undefined
          }
        >
          <IconArrowsJoin size={iconSize} className="text-muted-foreground" />
          Merge cells
        </button>
      )}
```

- [ ] **Step 4: Build the frontend to catch type errors**

```bash
pnpm --filter @wafflebase/frontend build
```

Expected: clean build. If `TableMergeContext` is not found, double-check
Task 5 Step 1 (the `index.ts` re-export).

- [ ] **Step 5: Lint**

```bash
pnpm --filter @wafflebase/frontend lint
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/app/docs/docs-table-context-menu.tsx
git commit -m "$(cat <<'EOF'
Show Merge/Unmerge as a single hybrid slot in the table context menu

The Cell section of the table context menu now exposes one slot whose
label, icon, and enabled state follow editor.getTableMergeContext().
A single non-merged cell shows "Merge cells" disabled (discoverability),
a 2+ cell range shows it enabled, and a merged cell shows "Unmerge cells".
Replaces the previous Split-only entry, which was unreachable for users
who never knew the merge API existed.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8 — Verification: `pnpm verify:fast` and manual smoke

- [ ] **Step 1: Run the pre-commit gate**

```bash
pnpm verify:fast
```

Expected: pass. Investigate any failure before continuing.

- [ ] **Step 2: Manual smoke test in dev**

In a separate terminal:

```bash
docker compose up -d
pnpm dev
```

Open the docs editor in a new doc and verify:

1. Insert a 3×3 table.
2. Drag-select cells (0,0)..(1,1) → right-click → "Merge cells" is
   enabled → click → 2×2 merged cell with cursor inside.
3. Right-click the merged cell → menu now shows "Unmerge cells" → click
   → cells restored.
4. Click a single non-merged cell → right-click → menu shows
   "Merge cells" greyed out (disabled).
5. With a 2×2 merged cell at (1,1)..(2,2), drag from (0,0) to (1,1).
   The drag highlight should snap out to include the full merge —
   visually covering (0,0)..(2,2) before the menu opens.
6. Right-click and merge that expanded selection → result is a 3×3
   merged cell.

If any step misbehaves, capture the failure in the lessons file before
fixing.

- [ ] **Step 3: Stop dev**

```bash
# Ctrl+C the dev server when done
docker compose down
```

---

## Task 9 — Wrap up

- [ ] **Step 1: Capture any non-obvious lessons**

If the implementation surfaced surprises (corrections, near-misses,
non-obvious gotchas), append them to
`docs/tasks/active/20260411-docs-table-merge-ux-lessons.md` under
"Patterns to keep" or "Mistakes to avoid".

- [ ] **Step 2: Archive and reindex tasks**

```bash
pnpm tasks:archive && pnpm tasks:index
```

- [ ] **Step 3: Verify the worktree status is clean**

```bash
git status
```

Expected: clean working tree, all task work committed.

---

## Spec coverage check

| Spec section | Implemented in |
|---|---|
| Cell range normalization (fixed-point) | Tasks 1–3 |
| `findMergeTopLeft` helper | Task 1 |
| Drag-time visual preview of expanded area | Task 3 |
| Read-time normalization (peers, programmatic) | Task 2 |
| `getTableMergeContext` API + states | Tasks 4–5 |
| Hybrid context-menu slot (Merge/Unmerge) | Task 7 |
| `Doc.mergeCells` handles nested merge | Task 6 |
| Manual smoke test | Task 8 |
| Wrap up + archive | Task 9 |

## Review Notes

(Filled in during/after implementation.)
