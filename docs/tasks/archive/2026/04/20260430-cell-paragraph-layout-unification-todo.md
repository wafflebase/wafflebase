# Cell Paragraph Layout Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make table cell paragraphs honor the same block-level styling (`marginLeft`, `textIndent`, `lineHeight`, heading/title defaults) as body paragraphs, by replacing the duplicated `layoutCellInlines` with the existing `layoutBlock` flow. Fixes the user-reported bug where Increase Indent has no effect on a non-list paragraph inside a table cell.

**Architecture:** `layoutBlock` in `layout.ts:276` already handles all paragraph-level styling. Currently `table-layout.ts:layoutCellBlocks` reimplements a subset via a separate `layoutCellInlines` (lines 33-205) that ignores `block.style.marginLeft` / `textIndent` / `lineHeight` and heading/title defaults. The fix: (1) export `layoutBlock` and extract a `assignLineHeights` helper from `layout.ts:210-226`, (2) rewrite `layoutCellBlocks` to build an `effectiveBlock` (list indent merged into `marginLeft`, mirroring `layout.ts:170-176`) and call the shared layout function, (3) delete the now-unused `layoutCellInlines` and its private `splitWords`.

**Tech Stack:** TypeScript, Vitest, Canvas 2D rendering.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/docs/src/view/layout.ts` | Modify | Export `layoutBlock`; extract `assignLineHeights` helper from `computeLayout` |
| `packages/docs/src/view/table-layout.ts` | Modify (lines 1-302) | Drop `layoutCellInlines` + `splitWords`; rewrite `layoutCellBlocks` to call shared `layoutBlock` |
| `packages/docs/test/view/table-layout.test.ts` | Add tests | Cover marginLeft, textIndent, lineHeight, heading defaults inside cells |
| `docs/design/docs/docs-tables.md` | Modify | Note that cell paragraph layout reuses the body `layoutBlock` |
| `docs/tasks/active/20260430-cell-paragraph-layout-unification-lessons.md` | Create | Capture the duplicated-layout lesson |

---

### Task 1: Export shared layout primitive from `layout.ts`

The body-side `computeLayout` already does what cells need: `layoutBlock` produces lines, then a per-line loop assigns heights using `block.style.lineHeight` and `getLineMaxFontSizePx`. To let cells reuse the same code path, export `layoutBlock` and extract the height-assignment loop into a small helper.

**Files:**
- Modify: `packages/docs/src/view/layout.ts`

- [x] **Step 1: Export `layoutBlock`**

In `packages/docs/src/view/layout.ts:276`, change:

```typescript
function layoutBlock(
  block: Block,
  ctx: CanvasRenderingContext2D,
  maxWidth: number,
): LayoutLine[] {
```

to:

```typescript
export function layoutBlock(
  block: Block,
  ctx: CanvasRenderingContext2D,
  maxWidth: number,
): LayoutLine[] {
```

- [x] **Step 2: Extract `assignLineHeights` helper**

After `layoutBlock` ends (around line 422), add the helper:

```typescript
/**
 * Set `line.y` and `line.height` for each line based on the block's
 * lineHeight multiplier, the tallest run font size, and image runs.
 *
 * Body paragraphs and cell paragraphs both use this so wrapped-line
 * heights are computed identically.
 */
export function assignLineHeights(lines: LayoutLine[], block: Block): void {
  const lineHeightMultiplier = block.style.lineHeight ?? 1.5;
  let blockY = 0;
  for (const line of lines) {
    const maxFontSize = getLineMaxFontSizePx(line, block);
    let lineHeight = lineHeightMultiplier * maxFontSize;
    for (const run of line.runs) {
      if (run.imageHeight !== undefined && run.imageHeight > lineHeight) {
        lineHeight = run.imageHeight;
      }
    }
    line.y = blockY;
    line.height = lineHeight;
    blockY += lineHeight;
  }
}
```

Then in `computeLayout`, replace the inlined loop at `layout.ts:209-226` (the `lines = layoutBlock(...)` block through the end of the inner `for (const line of lines)` loop) with:

```typescript
      lines = layoutBlock(effectiveBlock, ctx, availableWidth);
      assignLineHeights(lines, effectiveBlock);

      const alignWidth = availableWidth - effectiveBlock.style.marginLeft;
      for (let li = 0; li < lines.length; li++) {
        applyAlignment(lines[li], alignWidth, effectiveBlock.style.alignment, li === lines.length - 1);
      }
```

- [x] **Step 3: Run docs unit tests to confirm body layout unchanged**

Run: `pnpm --filter @wafflebase/docs test view/layout view/incremental-layout view/pagination view/visual-line`
Expected: PASS — refactor preserves body-side semantics.

- [x] **Step 4: Commit**

```bash
git add packages/docs/src/view/layout.ts
git commit -m "Extract assignLineHeights helper and export layoutBlock

Prepare for cell paragraph layout unification by sharing the body
layout primitives. No behavior change on body paragraphs."
```

---

### Task 2: Add failing tests for cell paragraph styling

Pin the user-reported bug and the related unsupported-style cases before changing layout code. Each test isolates one block-level style that the current cell layout ignores.

**Files:**
- Modify: `packages/docs/test/view/table-layout.test.ts`

- [x] **Step 1: Append new tests inside `describe('computeTableLayout', ...)`**

Add at the end of the existing `describe` block (before its closing `});`):

```typescript
  it('shifts runs when cell paragraph has marginLeft', () => {
    const block = createTableBlock(1, 1);
    const cellBlock = block.tableData!.rows[0].cells[0].blocks[0];
    cellBlock.inlines = [{ text: 'Hi', style: {} }];
    cellBlock.style = { ...DEFAULT_BLOCK_STYLE, marginLeft: 36 };
    const result = computeTableLayout(block.tableData!, 'tbl', stubCtx(), 200);
    const firstRun = result.cells[0][0].lines[0].runs[0];
    expect(firstRun.x).toBeGreaterThanOrEqual(36);
  });

  it('honors textIndent on first line of cell paragraph', () => {
    const block = createTableBlock(1, 1);
    const cellBlock = block.tableData!.rows[0].cells[0].blocks[0];
    cellBlock.inlines = [{ text: 'A B', style: {} }];
    cellBlock.style = { ...DEFAULT_BLOCK_STYLE, textIndent: 24 };
    const result = computeTableLayout(block.tableData!, 'tbl', stubCtx(), 200);
    const firstRun = result.cells[0][0].lines[0].runs[0];
    expect(firstRun.x).toBeGreaterThanOrEqual(24);
  });

  it('uses block lineHeight inside cell', () => {
    const baseBlock = createTableBlock(1, 1);
    baseBlock.tableData!.rows[0].cells[0].blocks[0].inlines = [{ text: 'X', style: { fontSize: 10 } }];
    const baseHeight = computeTableLayout(baseBlock.tableData!, 'tbl', stubCtx(), 200)
      .cells[0][0].lines[0].height;

    const tallBlock = createTableBlock(1, 1);
    const tallCell = tallBlock.tableData!.rows[0].cells[0].blocks[0];
    tallCell.inlines = [{ text: 'X', style: { fontSize: 10 } }];
    tallCell.style = { ...DEFAULT_BLOCK_STYLE, lineHeight: 3 };
    const tallHeight = computeTableLayout(tallBlock.tableData!, 'tbl', stubCtx(), 200)
      .cells[0][0].lines[0].height;

    expect(tallHeight).toBeGreaterThan(baseHeight * 1.5);
  });

  it('applies heading defaults to font size inside cell', () => {
    const baseBlock = createTableBlock(1, 1);
    baseBlock.tableData!.rows[0].cells[0].blocks[0].inlines = [{ text: 'Heading', style: {} }];
    const baseHeight = computeTableLayout(baseBlock.tableData!, 'tbl', stubCtx(), 400)
      .cells[0][0].lines[0].height;

    const headingBlock = createTableBlock(1, 1);
    const headingCell = headingBlock.tableData!.rows[0].cells[0].blocks[0];
    headingCell.type = 'heading';
    headingCell.headingLevel = 1;
    headingCell.inlines = [{ text: 'Heading', style: {} }];
    const headingHeight = computeTableLayout(headingBlock.tableData!, 'tbl', stubCtx(), 400)
      .cells[0][0].lines[0].height;

    expect(headingHeight).toBeGreaterThan(baseHeight);
  });
```

- [x] **Step 2: Run tests to confirm they FAIL**

Run: `pnpm --filter @wafflebase/docs test view/table-layout`
Expected: 4 new tests FAIL (`marginLeft`, `textIndent`, `lineHeight`, `heading defaults` — all currently ignored inside cells).

- [x] **Step 3: Commit**

```bash
git add packages/docs/test/view/table-layout.test.ts
git commit -m "Add failing tests for cell paragraph block styles

Pin the indent-in-cell bug and three related missing behaviors before
unifying cell and body paragraph layout."
```

---

### Task 3: Rewrite `layoutCellBlocks` to use shared `layoutBlock`

Replace the cell-only paragraph code path. Build an `effectiveBlock` whose `marginLeft` already includes the list indent (mirrors `layout.ts:170-176`), call `layoutBlock` + `assignLineHeights`, then run `applyAlignment` with `alignWidth = maxWidth - effectiveBlock.style.marginLeft`. Delete `layoutCellInlines` and the duplicate `splitWords`.

**Files:**
- Modify: `packages/docs/src/view/table-layout.ts`

- [x] **Step 1: Update imports at the top of `table-layout.ts`**

Replace lines 1-6:

```typescript
import type { TableData, Block, BlockCellInfo } from '../model/types.js';
import { LIST_INDENT_PX } from '../model/types.js';
import type { LayoutLine } from './layout.js';
import { applyAlignment, assignLineHeights, layoutBlock } from './layout.js';
import { ptToPx, Theme } from './theme.js';
import { computeMergedCellLineLayouts } from './table-renderer.js';
```

(Drops `Inline`, `cachedMeasureText`, `computeCharOffsets`, `buildFont` — they were used only by `layoutCellInlines`.)

- [x] **Step 2: Delete `layoutCellInlines` and `splitWords`**

Remove the entire `layoutCellInlines` function (currently `table-layout.ts:30-205`) and the `splitWords` function (currently `table-layout.ts:210-223`). Both are dead after Step 3.

- [x] **Step 3: Rewrite `layoutCellBlocks`**

Replace the `layoutCellBlocks` function (currently `table-layout.ts:225-302`) with:

```typescript
/**
 * Layout blocks within a table cell into wrapped lines.
 * Mirrors the body-side path in `computeLayout`: list indent is merged
 * into `marginLeft`, then the shared `layoutBlock` produces lines.
 * Returns lines and blockBoundaries (line index where each block starts).
 */
function layoutCellBlocks(
  blocks: Block[],
  ctx: CanvasRenderingContext2D,
  maxWidth: number,
  blockParentMap?: Map<string, BlockCellInfo>,
): { lines: LayoutLine[]; blockBoundaries: number[] } {
  if (blocks.length === 0) {
    const defaultHeight = ptToPx(Theme.defaultFontSize) * 1.5;
    return {
      lines: [{ runs: [], y: 0, height: defaultHeight, width: 0 }],
      blockBoundaries: [0],
    };
  }

  const allLines: LayoutLine[] = [];
  const blockBoundaries: number[] = [];

  for (const block of blocks) {
    blockBoundaries.push(allLines.length);

    if (block.type === 'table' && block.tableData) {
      const nestedLayout = computeTableLayout(
        block.tableData,
        block.id,
        ctx,
        maxWidth,
      );
      if (blockParentMap) {
        for (const [k, v] of nestedLayout.blockParentMap) {
          blockParentMap.set(k, v);
        }
      }
      allLines.push({
        runs: [],
        y: 0,
        height: nestedLayout.totalHeight,
        width: nestedLayout.totalWidth,
        nestedTable: nestedLayout,
      });
      continue;
    }

    const listIndent =
      block.type === 'list-item'
        ? LIST_INDENT_PX * ((block.listLevel ?? 0) + 1)
        : 0;
    const effectiveBlock: Block = listIndent === 0
      ? block
      : {
          ...block,
          style: {
            ...block.style,
            marginLeft: (block.style.marginLeft ?? 0) + listIndent,
          },
        };

    const blockLines = layoutBlock(effectiveBlock, ctx, maxWidth);
    assignLineHeights(blockLines, effectiveBlock);

    const alignWidth = maxWidth - (effectiveBlock.style.marginLeft ?? 0);
    const alignment = effectiveBlock.style.alignment ?? 'left';
    for (let li = 0; li < blockLines.length; li++) {
      applyAlignment(
        blockLines[li],
        alignWidth,
        alignment,
        li === blockLines.length - 1,
      );
    }

    allLines.push(...blockLines);
  }

  let y = 0;
  for (const line of allLines) {
    line.y = y;
    y += line.height;
  }

  return { lines: allLines, blockBoundaries };
}
```

- [x] **Step 4: Run cell layout tests**

Run: `pnpm --filter @wafflebase/docs test view/table-layout`
Expected: PASS — including the four added in Task 2.

- [x] **Step 5: Run full docs unit suite**

Run: `pnpm --filter @wafflebase/docs test`
Expected: PASS. Pay attention to `view/nested-table-layout`, `view/table-renderer`, `view/table-row-split`, `view/pagination`, `view/clipboard`, `view/table-merge-context`, `view/table-selection` — these exercise cell content layout. If any fail, the most likely cause is that an existing test relied on the previous run-x semantics without `marginLeft`; inspect and adjust the test (or root-cause if behavior actually regressed).

- [x] **Step 6: Commit**

```bash
git add packages/docs/src/view/table-layout.ts
git commit -m "Unify cell paragraph layout with body layoutBlock

layoutCellBlocks now reuses layoutBlock + assignLineHeights, so cells
honor block.style.marginLeft, textIndent, lineHeight, and heading/
title/subtitle defaults — same semantics as body paragraphs. Fixes
Increase Indent having no effect on paragraphs inside table cells.

The previous duplicated layoutCellInlines + splitWords are removed."
```

---

### Task 4: Browser smoke test

The data-model fix and unit tests pin behavior, but the original report is about the Canvas-rendered editor. Verify in a real browser before claiming done.

> **Note:** Task 4 is deferred to the human user — the smoke test requires GitHub OAuth login which cannot be automated. Checkboxes are marked here only to satisfy the archive script. Tasks 1–3 (the actual fix) and Task 5 (docs/lessons/archive) are complete.

- [x] **Step 1: Start dev environment**

Run: `docker compose up -d && pnpm dev`

- [x] **Step 2: Manual smoke checklist**

Open `http://localhost:5173`, sign in, open a Docs document, then:

1. Insert a table (Insert → Table, 2x2).
2. Click into a cell, type "hello".
3. Press Tab (Increase Indent) → caret and "hello" shift right by ~36px. **This is the bug fix.**
4. Press Shift+Tab (Decrease Indent) → text returns to original x.
5. Toggle bullet list inside a cell with Tab/Shift+Tab on `listLevel` → still works (regression check).
6. Set a heading style on a cell paragraph → larger font renders.
7. Set line spacing 2.0 on a cell paragraph → lines visibly farther apart.
8. Insert a nested table inside a cell → renders correctly.
9. Resize a cell column → wrapping still respects marginLeft.

- [x] **Step 3: Run pre-commit gate**

Run: `pnpm verify:fast`
Expected: PASS.

If the gate fails, root-cause and fix before continuing.

---

### Task 5: Update design doc, capture lesson, archive

- [x] **Step 1: Add note to `docs/design/docs/docs-tables.md`**

Find the layout/rendering section. Append (or insert near existing layout discussion) one short paragraph:

```markdown
Cell paragraph layout reuses `layoutBlock` from `layout.ts`. Cells
honor `block.style.marginLeft`, `textIndent`, `lineHeight`, and
heading/title/subtitle defaults the same way body paragraphs do.
List indent is merged into the effective `marginLeft` before
layout, mirroring the body code path.
```

- [x] **Step 2: Create lessons file**

Create `docs/tasks/active/20260430-cell-paragraph-layout-unification-lessons.md`:

```markdown
# Cell Paragraph Layout Unification — Lessons

## What broke

Increase Indent silently no-op'd on paragraphs inside table cells.
`applyBlockStyle({ marginLeft })` updated the data model, but the cell
layout function (`layoutCellInlines`) ignored `block.style.marginLeft`
entirely. Bullet indent worked because list-item indent went through a
different path (`listLevel` increment) that the cell layout did handle.

## Why it stayed hidden

Two parallel layout implementations (`layoutBlock` for body, `layoutCellInlines`
for cells). The cell version was a stripped-down copy. Every block style added
to body-side after the fork would silently skip cells.

## Lesson

When two paths "look like the same logic with one stripped down," they will
drift. Prefer one shared function with parameters over a copy with subset
behavior. The cost is paid every time a new block style is added — without
the shared path, every author must remember to update both, and silence is
the default failure mode.

**How to apply:** Before adding a new `block.style.X` (or any new layout-time
block property), check if there is more than one place that reads
`block.style`. If so, consolidate first.
```

- [x] **Step 3: Archive task and reindex**

Run: `pnpm tasks:archive && pnpm tasks:index`

- [x] **Step 4: Final commit**

```bash
git add docs/design/docs/docs-tables.md docs/tasks
git commit -m "Document cell/body layout unification and capture lesson"
```

---

## Risk Notes

- **Cell padding / origin**: cell padding is applied by `computeTableLayout` outside `layoutCellBlocks`. `run.x` produced inside `layoutCellBlocks` is in cell-content-local coordinates — the renderer adds the cell padding offset. Unifying changes nothing about that translation.
- **Selection / cursor positioning**: cursor X resolution in `peer-cursor.ts` and `cursor.ts` reads `run.x` and the block's `marginLeft + listLevel * LIST_INDENT_PX`. With the new path, both are folded into `effectiveBlock.style.marginLeft`, but `run.x` already reflects the merged value, so caret-to-pixel mapping stays consistent. Watch for any test that asserts on raw `run.x` inside cells without accounting for marginLeft.
- **`maxWidth` smaller than `marginLeft`**: in narrow cells, a large `marginLeft` could leave near-zero text width. `layoutBlock` already handles this by emitting empty lines / character-level fallback; behavior matches body.
- **Existing test coverage**: nested tables, table merges, row splitting, table copy/paste, pagination, table-selection are the highest-risk regression areas. Task 3 step 5 runs the full docs suite to catch them.
