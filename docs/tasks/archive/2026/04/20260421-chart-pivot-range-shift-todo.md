# Chart & Pivot Table Range Shift on Row/Column Insert/Delete/Move

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shift chart `sourceRange`/`xAxisColumn`/`seriesColumns` and pivot table `sourceRange` when rows or columns are inserted, deleted, or moved.

**Architecture:** Add pure utility functions (`shiftA1Range`, `moveA1Range`, `shiftColumnLabel`, `moveColumnLabel`) to `shifting.ts`, then call them from `yorkie-worksheet-structure.ts` (chart + pivot) and `memory.ts` (pivot only). Charts live only in the Yorkie document; pivot definitions exist in both MemStore and Yorkie.

**Tech Stack:** TypeScript, Vitest

---

### Task 1: Add `parseColumnLabel` to coordinates.ts

Converts a column letter string (e.g. `"A"`, `"BC"`) to a 1-based column index.
The reverse of `toColumnLabel` which already exists.

**Files:**
- Modify: `packages/sheets/src/model/core/coordinates.ts:286-302`
- Modify: `packages/sheets/src/index.ts:173` (add export)
- Test: `packages/sheets/test/sheet/shifting.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/sheets/test/sheet/shifting.test.ts`:

```typescript
import {
  parseColumnLabel,
  toColumnLabel,
} from '../../src/model/core/coordinates';

describe('parseColumnLabel', () => {
  it('should parse single letter columns', () => {
    expect(parseColumnLabel('A')).toBe(1);
    expect(parseColumnLabel('B')).toBe(2);
    expect(parseColumnLabel('Z')).toBe(26);
  });

  it('should parse multi-letter columns', () => {
    expect(parseColumnLabel('AA')).toBe(27);
    expect(parseColumnLabel('AZ')).toBe(52);
    expect(parseColumnLabel('BA')).toBe(53);
  });

  it('should be case-insensitive', () => {
    expect(parseColumnLabel('a')).toBe(1);
    expect(parseColumnLabel('az')).toBe(52);
  });

  it('should round-trip with toColumnLabel', () => {
    for (let i = 1; i <= 100; i++) {
      expect(parseColumnLabel(toColumnLabel(i))).toBe(i);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/sheets && npx vitest run test/sheet/shifting.test.ts --reporter=verbose`
Expected: FAIL — `parseColumnLabel` is not exported

- [ ] **Step 3: Write the implementation**

Add to `packages/sheets/src/model/core/coordinates.ts` right after `toColumnLabel`:

```typescript
/**
 * `parseColumnLabel` converts a column label (e.g. "A", "BC") to a 1-based column index.
 * The inverse of `toColumnLabel`.
 */
export function parseColumnLabel(label: string): number {
  const upper = label.toUpperCase();
  let col = 0;
  for (let i = 0; i < upper.length; i++) {
    col = col * 26 + (upper.charCodeAt(i) - 64);
  }
  return col;
}
```

Add to `packages/sheets/src/index.ts` exports (in the export block, after `toColumnLabel`):

```typescript
parseColumnLabel,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/sheets && npx vitest run test/sheet/shifting.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```
feat(sheets): add parseColumnLabel utility

Inverse of toColumnLabel — converts column letter strings like "A" or
"BC" to 1-based column indices. Needed for chart/pivot range shifting.
```

---

### Task 2: Add `shiftA1Range` and `shiftColumnLabel` to shifting.ts

Pure functions that shift an A1-notation range string and a column label string
when rows/columns are inserted or deleted.

**Files:**
- Modify: `packages/sheets/src/model/worksheet/shifting.ts` (append new functions)
- Modify: `packages/sheets/src/index.ts` (add exports)
- Test: `packages/sheets/test/sheet/shifting.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/sheets/test/sheet/shifting.test.ts`:

```typescript
import {
  shiftA1Range,
  shiftColumnLabel,
} from '../../src/model/worksheet/shifting';

describe('shiftColumnLabel', () => {
  describe('insert (count > 0)', () => {
    it('should shift column at index forward', () => {
      // Insert 1 column at col 2 (B). "B" → "C"
      expect(shiftColumnLabel('B', 2, 1)).toBe('C');
    });

    it('should not shift column before index', () => {
      // Insert 1 column at col 3 (C). "A" stays "A"
      expect(shiftColumnLabel('A', 3, 1)).toBe('A');
    });

    it('should shift column after index forward', () => {
      // Insert 2 columns at col 2. "D" (4) → "F" (6)
      expect(shiftColumnLabel('D', 2, 2)).toBe('F');
    });
  });

  describe('delete (count < 0)', () => {
    it('should return null when column is in deleted zone', () => {
      // Delete 1 column at col 2 (B). "B" → null
      expect(shiftColumnLabel('B', 2, -1)).toBeNull();
    });

    it('should shift column after deleted zone backward', () => {
      // Delete 1 column at col 2. "C" (3) → "B" (2)
      expect(shiftColumnLabel('C', 2, -1)).toBe('B');
    });

    it('should not shift column before deleted zone', () => {
      // Delete 1 column at col 3. "A" stays "A"
      expect(shiftColumnLabel('A', 3, -1)).toBe('A');
    });

    it('should return null for column in multi-delete zone', () => {
      // Delete 2 columns at col 2. "C" (3) → null
      expect(shiftColumnLabel('C', 2, -2)).toBeNull();
    });
  });
});

describe('shiftA1Range', () => {
  describe('row insert', () => {
    it('should expand range when inserting within it', () => {
      // Insert 2 rows at row 5 within "A1:D10"
      expect(shiftA1Range('A1:D10', 'row', 5, 2)).toBe('A1:D12');
    });

    it('should shift range entirely below insertion', () => {
      // Insert 1 row at row 1 above "A3:B5"
      expect(shiftA1Range('A3:B5', 'row', 1, 1)).toBe('A4:B6');
    });

    it('should not change range entirely above insertion', () => {
      // Insert 1 row at row 20 below "A1:D10"
      expect(shiftA1Range('A1:D10', 'row', 20, 1)).toBe('A1:D10');
    });
  });

  describe('column insert', () => {
    it('should expand range when inserting within it', () => {
      // Insert 1 column at col 2 (B) within "A1:D10"
      expect(shiftA1Range('A1:D10', 'column', 2, 1)).toBe('A1:E10');
    });
  });

  describe('row delete', () => {
    it('should shrink range when deleting within it', () => {
      // Delete rows 3-5 (3 rows at index 3) from "A1:D10"
      expect(shiftA1Range('A1:D10', 'row', 3, -3)).toBe('A1:D7');
    });

    it('should return null when range is fully deleted', () => {
      // Delete rows 1-10 from "A1:D10"
      expect(shiftA1Range('A1:D10', 'row', 1, -10)).toBeNull();
    });

    it('should shift range after deleted zone', () => {
      // Delete 2 rows at row 1 from "A5:D10"
      expect(shiftA1Range('A5:D10', 'row', 1, -2)).toBe('A3:D8');
    });
  });

  describe('column delete', () => {
    it('should shrink range when deleting within it', () => {
      // Delete column 2 (B) from "A1:D10"
      expect(shiftA1Range('A1:D10', 'column', 2, -1)).toBe('A1:C10');
    });

    it('should return null when range is fully deleted', () => {
      // Delete columns 1-4 from "A1:D10"
      expect(shiftA1Range('A1:D10', 'column', 1, -4)).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/sheets && npx vitest run test/sheet/shifting.test.ts --reporter=verbose`
Expected: FAIL — `shiftA1Range` and `shiftColumnLabel` not found

- [ ] **Step 3: Write the implementation**

Add to `packages/sheets/src/model/worksheet/shifting.ts` at the end:

```typescript
import { parseColumnLabel, toColumnLabel } from '../core/coordinates';

/**
 * `shiftColumnLabel` shifts a column label (e.g. "B") when columns are
 * inserted or deleted. Returns `null` if the column falls in a deleted zone.
 */
export function shiftColumnLabel(
  label: string,
  index: number,
  count: number,
): string | null {
  const col = parseColumnLabel(label);
  const shifted = shiftRef({ r: 1, c: col }, 'column', index, count);
  if (!shifted) return null;
  return toColumnLabel(shifted.c);
}

/**
 * `shiftA1Range` shifts an A1-notation range string (e.g. "A1:D10") when
 * rows or columns are inserted or deleted.
 * Returns `null` if the entire range is deleted.
 */
export function shiftA1Range(
  range: string,
  axis: Axis,
  index: number,
  count: number,
): string | null {
  const parts = range.split(':');
  if (parts.length !== 2) return range;

  const start = shiftRef(parseRef(parts[0]), axis, index, count);
  const end = shiftRef(parseRef(parts[1]), axis, index, count);

  if (!start || !end) return null;
  return toSref(start) + ':' + toSref(end);
}
```

Update the existing import at the top of `shifting.ts` to include `parseColumnLabel` and `toColumnLabel`:

```typescript
import { parseARef, parseColumnLabel, parseRef, toASref, toColumnLabel, toSref } from '../core/coordinates';
```

Add to `packages/sheets/src/index.ts` exports:

```typescript
shiftA1Range,
shiftColumnLabel,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/sheets && npx vitest run test/sheet/shifting.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```
feat(sheets): add shiftA1Range and shiftColumnLabel utilities

Pure functions to shift A1-notation range strings and column labels
when rows/columns are inserted or deleted. Building blocks for
chart and pivot table range shifting.
```

---

### Task 3: Add `moveA1Range` and `moveColumnLabel` to shifting.ts

Pure functions for row/column move operations.

**Files:**
- Modify: `packages/sheets/src/model/worksheet/shifting.ts`
- Modify: `packages/sheets/src/index.ts` (add exports)
- Test: `packages/sheets/test/sheet/shifting.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/sheets/test/sheet/shifting.test.ts`:

```typescript
import {
  moveA1Range,
  moveColumnLabel,
} from '../../src/model/worksheet/shifting';

describe('moveColumnLabel', () => {
  it('should remap column in moved block', () => {
    // Move 1 column from col 2 to col 4. "B" (2) → "D" (4-1=3, actually remapIndex)
    expect(moveColumnLabel('B', 2, 1, 4)).toBe('C');
  });

  it('should remap column in shifted region', () => {
    // Move 1 column from col 2 to col 4. "C" (3) → "B" (2)
    expect(moveColumnLabel('C', 2, 1, 4)).toBe('B');
  });

  it('should not change column outside affected region', () => {
    // Move 1 column from col 2 to col 4. "A" stays "A"
    expect(moveColumnLabel('A', 2, 1, 4)).toBe('A');
  });
});

describe('moveA1Range', () => {
  it('should remap range endpoints on row move', () => {
    // Move row 2 (1 row) to before row 5. "A2:D2" → remapped
    expect(moveA1Range('A2:D2', 'row', 2, 1, 5)).toBe('A4:D4');
  });

  it('should remap range endpoints on column move', () => {
    // Move column 1 (1 col) to before column 4. "A1:A10" → "C1:C10"
    expect(moveA1Range('A1:A10', 'column', 1, 1, 4)).toBe('C1:C10');
  });

  it('should not change range outside affected region', () => {
    // Move row 10 to row 1. "A5:D8" is in between and shifts.
    expect(moveA1Range('A5:D8', 'row', 10, 1, 1)).toBe('A6:D9');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/sheets && npx vitest run test/sheet/shifting.test.ts --reporter=verbose`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

Append to `packages/sheets/src/model/worksheet/shifting.ts`:

```typescript
/**
 * `moveColumnLabel` remaps a column label when columns are moved.
 */
export function moveColumnLabel(
  label: string,
  src: number,
  count: number,
  dst: number,
): string {
  const col = parseColumnLabel(label);
  const moved = moveRef({ r: 1, c: col }, 'column', src, count, dst);
  return toColumnLabel(moved.c);
}

/**
 * `moveA1Range` remaps an A1-notation range string when rows or columns
 * are moved.
 */
export function moveA1Range(
  range: string,
  axis: Axis,
  src: number,
  count: number,
  dst: number,
): string {
  const parts = range.split(':');
  if (parts.length !== 2) return range;

  const start = moveRef(parseRef(parts[0]), axis, src, count, dst);
  const end = moveRef(parseRef(parts[1]), axis, src, count, dst);
  return toSref(start) + ':' + toSref(end);
}
```

Add to `packages/sheets/src/index.ts` exports:

```typescript
moveA1Range,
moveColumnLabel,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/sheets && npx vitest run test/sheet/shifting.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```
feat(sheets): add moveA1Range and moveColumnLabel utilities

Pure functions to remap A1-notation range strings and column labels
when rows/columns are moved. Completes the shift/move utility set
for chart and pivot table range shifting.
```

---

### Task 4: Wire chart range shifting into yorkie-worksheet-structure.ts

Apply `shiftA1Range`/`shiftColumnLabel` to chart `sourceRange`, `xAxisColumn`,
and `seriesColumns` during `applyYorkieWorksheetShift`.

**Files:**
- Modify: `packages/frontend/src/app/spreadsheet/yorkie-worksheet-structure.ts:1-25,137-193`
- Test: `packages/sheets/test/sheet/shifting.test.ts` (utilities already tested)

- [ ] **Step 1: Add imports**

In `packages/frontend/src/app/spreadsheet/yorkie-worksheet-structure.ts`, add
to the existing `@wafflebase/sheets` import:

```typescript
import {
  // ... existing imports ...
  shiftA1Range,
  shiftColumnLabel,
  moveA1Range,
  moveColumnLabel,
} from "@wafflebase/sheets";
```

- [ ] **Step 2: Add `shiftChartRanges` helper function**

Add after the existing `shiftAnchors` function (after line 108):

```typescript
/**
 * Shift chart data ranges (sourceRange, xAxisColumn, seriesColumns)
 * when rows/columns are inserted or deleted.
 */
function shiftChartRanges(
  charts: Record<string, SheetChart> | undefined,
  axis: Axis,
  index: number,
  count: number,
): void {
  if (!charts) return;

  for (const key of safeWorksheetRecordKeys(charts)) {
    const chart = charts[key];
    if (!chart) continue;

    if (chart.sourceRange) {
      const shifted = shiftA1Range(chart.sourceRange, axis, index, count);
      if (shifted) {
        chart.sourceRange = shifted;
      }
    }

    if (axis === 'column') {
      if (chart.xAxisColumn) {
        const shifted = shiftColumnLabel(chart.xAxisColumn, index, count);
        if (shifted) {
          chart.xAxisColumn = shifted;
        }
      }

      if (chart.seriesColumns) {
        const result: string[] = [];
        for (const col of chart.seriesColumns) {
          const shifted = shiftColumnLabel(col, index, count);
          if (shifted) {
            result.push(shifted);
          }
        }
        chart.seriesColumns = result;
      }
    }
  }
}
```

- [ ] **Step 3: Add `moveChartRanges` helper function**

Add after `shiftChartRanges`:

```typescript
/**
 * Move chart data ranges when rows/columns are reordered.
 */
function moveChartRanges(
  charts: Record<string, SheetChart> | undefined,
  axis: Axis,
  srcIndex: number,
  count: number,
  dstIndex: number,
): void {
  if (!charts) return;

  for (const key of safeWorksheetRecordKeys(charts)) {
    const chart = charts[key];
    if (!chart) continue;

    if (chart.sourceRange) {
      chart.sourceRange = moveA1Range(
        chart.sourceRange, axis, srcIndex, count, dstIndex,
      );
    }

    if (axis === 'column') {
      if (chart.xAxisColumn) {
        chart.xAxisColumn = moveColumnLabel(
          chart.xAxisColumn, srcIndex, count, dstIndex,
        );
      }

      if (chart.seriesColumns) {
        chart.seriesColumns = chart.seriesColumns.map((col) =>
          moveColumnLabel(col, srcIndex, count, dstIndex),
        );
      }
    }
  }
}
```

- [ ] **Step 4: Wire into `applyYorkieWorksheetShift`**

In `applyYorkieWorksheetShift`, add after line 192 (after `shiftAnchors` for images):

```typescript
  shiftChartRanges(ws.charts as Record<string, SheetChart>, axis, index, count);
```

Also add `SheetChart` to the existing `@wafflebase/sheets` import (it's already exported from the barrel):

```typescript
import {
  // ... existing imports ...
  type SheetChart,
} from "@wafflebase/sheets";
```

- [ ] **Step 5: Wire into `applyYorkieWorksheetMove`**

In `applyYorkieWorksheetMove`, add after line 255 (after `moveAnchors` for images):

```typescript
  moveChartRanges(ws.charts as Record<string, SheetChart>, axis, srcIndex, count, dstIndex);
```

- [ ] **Step 6: Run verify:fast**

Run: `pnpm verify:fast`
Expected: PASS (lint + unit tests)

- [ ] **Step 7: Commit**

```
feat(frontend): shift chart data ranges on row/column insert/delete/move

When rows or columns are inserted, deleted, or moved, chart sourceRange,
xAxisColumn, and seriesColumns are now updated to reflect the structural
change. Previously only the chart anchor position was shifted.
```

---

### Task 5: Wire pivot table sourceRange shifting

Apply `shiftA1Range`/`moveA1Range` to pivot table `sourceRange` in both
`yorkie-worksheet-structure.ts` (Yorkie) and `memory.ts` (MemStore).

**Files:**
- Modify: `packages/frontend/src/app/spreadsheet/yorkie-worksheet-structure.ts`
- Modify: `packages/sheets/src/store/memory.ts:157-255`
- Test: `packages/sheets/test/sheet/shifting.test.ts` (add pivot-specific integration test)

- [ ] **Step 1: Write failing test for MemStore pivot shift**

Add to `packages/sheets/test/sheet/shifting.test.ts`:

```typescript
import { shiftA1Range, moveA1Range } from '../../src/model/worksheet/shifting';

describe('shiftA1Range — pivot sourceRange scenarios', () => {
  it('should expand pivot range on row insert within range', () => {
    expect(shiftA1Range('A1:C20', 'row', 5, 3)).toBe('A1:C23');
  });

  it('should expand pivot range on column insert within range', () => {
    expect(shiftA1Range('A1:C20', 'column', 2, 1)).toBe('A1:D20');
  });

  it('should shrink pivot range on row delete within range', () => {
    expect(shiftA1Range('A1:C20', 'row', 10, -5)).toBe('A1:C15');
  });

  it('should return null when pivot range fully deleted', () => {
    expect(shiftA1Range('B2:D5', 'row', 2, -4)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it passes (already implemented)**

Run: `cd packages/sheets && npx vitest run test/sheet/shifting.test.ts --reporter=verbose`
Expected: PASS (shiftA1Range already exists from Task 2)

- [ ] **Step 3: Add pivot shift to MemStore.shiftCells**

In `packages/sheets/src/store/memory.ts`, add import:

```typescript
import {
  // ... existing imports ...
  shiftA1Range,
  moveA1Range,
} from '../model/worksheet/shifting';
```

In `shiftCells()` method, add after the hidden state block (after line 191):

```typescript
    if (this.pivotDefinition?.sourceRange) {
      const shifted = shiftA1Range(
        this.pivotDefinition.sourceRange,
        axis,
        index,
        count,
      );
      if (shifted) {
        this.pivotDefinition.sourceRange = shifted;
      }
    }
```

- [ ] **Step 4: Add pivot move to MemStore.moveCells**

In `moveCells()` method, add after the hidden state block (after line 254):

```typescript
    if (this.pivotDefinition?.sourceRange) {
      this.pivotDefinition.sourceRange = moveA1Range(
        this.pivotDefinition.sourceRange,
        axis,
        srcIndex,
        count,
        dstIndex,
      );
    }
```

- [ ] **Step 5: Add pivot shift to yorkie-worksheet-structure.ts**

In `applyYorkieWorksheetShift`, add after the chart ranges line:

```typescript
  if (ws.pivotTable?.sourceRange) {
    const shifted = shiftA1Range(ws.pivotTable.sourceRange, axis, index, count);
    if (shifted) {
      ws.pivotTable.sourceRange = shifted;
    }
  }
```

In `applyYorkieWorksheetMove`, add after the chart ranges line:

```typescript
  if (ws.pivotTable?.sourceRange) {
    ws.pivotTable.sourceRange = moveA1Range(
      ws.pivotTable.sourceRange, axis, srcIndex, count, dstIndex,
    );
  }
```

- [ ] **Step 6: Run verify:fast**

Run: `pnpm verify:fast`
Expected: PASS

- [ ] **Step 7: Commit**

```
feat(sheets): shift pivot table sourceRange on row/column insert/delete/move

Pivot table sourceRange is now updated when structural changes occur
in both MemStore and Yorkie document layers.
```

---

### Task 6: Final verification

- [ ] **Step 1: Run full verify**

Run: `pnpm verify:fast`
Expected: All lint + unit tests pass

- [ ] **Step 2: Review all changes**

Run: `git diff main --stat`
Verify only expected files changed.

- [ ] **Step 3: Manual smoke test (optional)**

If dev environment is available:
1. Create a chart with sourceRange "A1:D10"
2. Insert a row at row 5
3. Verify chart sourceRange became "A1:D11"
4. Insert a column at column B
5. Verify xAxisColumn and seriesColumns shifted
