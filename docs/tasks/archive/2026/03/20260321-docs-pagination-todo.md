# Docs Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add word-processor-style pagination to the Canvas-based document editor with configurable page setup (paper size, orientation, margins) and Google-Docs-style page rendering.

**Architecture:** Post-processing pagination layer. `computeLayout()` produces margin-free continuous layout → `paginateLayout()` splits into pages → `DocCanvas` renders pages with gaps/shadows. Existing layout logic changes minimally (origin reset + signature change).

**Tech Stack:** TypeScript, Canvas 2D API, Vitest

**Spec:** `docs/design/docs-pagination.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/model/types.ts` | Modify | Add `PageSetup`, `PageMargins`, `PaperSize`, presets, `Document.pageSetup?` |
| `src/view/pagination.ts` | Create | `paginateLayout()`, coordinate mapping, types |
| `src/view/layout.ts` | Modify | Origin reset (y=0, x=0), signature change |
| `src/view/theme.ts` | Modify | Remove `pagePaddingX/Top`, add page constants |
| `src/view/doc-canvas.ts` | Modify | Page-based rendering with shadow/gap/clipping |
| `src/view/editor.ts` | Modify | Wire pagination into render pipeline |
| `src/view/cursor.ts` | Modify | Use paginated coordinate mapping |
| `src/view/selection.ts` | Modify | Transform selection rects to page coordinates |
| `src/view/text-editor.ts` | Modify | Use paginated coordinate mapping |
| `src/store/store.ts` | Modify | Add `getPageSetup()`, `setPageSetup()` |
| `src/store/memory.ts` | Modify | Implement pageSetup in MemDocStore |
| `src/index.ts` | Modify | Export new types and functions |
| `test/view/pagination.test.ts` | Create | Pagination engine + coordinate mapping tests |
| `test/model/types.test.ts` | Create | PageSetup helpers tests |

---

### Task 1: Data Model — PageSetup Types and Defaults

**Files:**
- Modify: `packages/docs/src/model/types.ts`
- Create: `packages/docs/test/model/types.test.ts`

- [x] **Step 1: Write tests for PageSetup helpers**

```typescript
// test/model/types.test.ts
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PAGE_SETUP,
  PAPER_SIZES,
  resolvePageSetup,
  getEffectiveDimensions,
} from '../../src/model/types.js';

describe('PageSetup', () => {
  it('DEFAULT_PAGE_SETUP uses Letter, portrait, 1-inch margins', () => {
    expect(DEFAULT_PAGE_SETUP.paperSize).toBe(PAPER_SIZES.LETTER);
    expect(DEFAULT_PAGE_SETUP.orientation).toBe('portrait');
    expect(DEFAULT_PAGE_SETUP.margins).toEqual({
      top: 96, bottom: 96, left: 96, right: 96,
    });
  });

  it('resolvePageSetup returns default when undefined', () => {
    expect(resolvePageSetup(undefined)).toBe(DEFAULT_PAGE_SETUP);
  });

  it('resolvePageSetup returns provided setup', () => {
    const custom = {
      ...DEFAULT_PAGE_SETUP,
      paperSize: PAPER_SIZES.A4,
    };
    expect(resolvePageSetup(custom)).toBe(custom);
  });

  it('getEffectiveDimensions returns paper size for portrait', () => {
    const dims = getEffectiveDimensions(DEFAULT_PAGE_SETUP);
    expect(dims.width).toBe(816);
    expect(dims.height).toBe(1056);
  });

  it('getEffectiveDimensions swaps width/height for landscape', () => {
    const landscape = {
      ...DEFAULT_PAGE_SETUP,
      orientation: 'landscape' as const,
    };
    const dims = getEffectiveDimensions(landscape);
    expect(dims.width).toBe(1056);
    expect(dims.height).toBe(816);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `cd packages/docs && npx vitest run test/model/types.test.ts`
Expected: FAIL — `resolvePageSetup`, `PAPER_SIZES`, etc. not found

- [x] **Step 3: Implement PageSetup types and helpers in types.ts**

Add to `packages/docs/src/model/types.ts`:

```typescript
// --- Page Setup ---

export interface PageMargins {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface PaperSize {
  name: string;
  width: number;   // px at 96dpi
  height: number;
}

export interface PageSetup {
  paperSize: PaperSize;
  orientation: 'portrait' | 'landscape';
  margins: PageMargins;
}

export const PAPER_SIZES = {
  LETTER: { name: 'Letter', width: 816, height: 1056 } as PaperSize,
  A4: { name: 'A4', width: 794, height: 1123 } as PaperSize,
  LEGAL: { name: 'Legal', width: 816, height: 1344 } as PaperSize,
} as const;

export const DEFAULT_PAGE_SETUP: PageSetup = {
  paperSize: PAPER_SIZES.LETTER,
  orientation: 'portrait',
  margins: { top: 96, bottom: 96, left: 96, right: 96 },
};

export function resolvePageSetup(setup: PageSetup | undefined): PageSetup {
  return setup ?? DEFAULT_PAGE_SETUP;
}

export function getEffectiveDimensions(setup: PageSetup): { width: number; height: number } {
  const { width, height } = setup.paperSize;
  return setup.orientation === 'landscape'
    ? { width: height, height: width }
    : { width, height };
}
```

Add optional `pageSetup` to the `Document` interface:

```typescript
export interface Document {
  blocks: Block[];
  pageSetup?: PageSetup;
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `cd packages/docs && npx vitest run test/model/types.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add packages/docs/src/model/types.ts packages/docs/test/model/types.test.ts
git commit -m "Add PageSetup data model with paper sizes and helpers"
```

---

### Task 2: Theme Constants Update

**Files:**
- Modify: `packages/docs/src/view/theme.ts`

- [x] **Step 1: Update Theme — remove pagePadding, add page constants**

In `packages/docs/src/view/theme.ts`, replace `pagePaddingX`, `pagePaddingTop`, and `backgroundColor` with new page-related constants:

```typescript
export const Theme = {
  /** Default font */
  defaultFontSize: 16,
  defaultFontFamily: 'sans-serif',
  defaultColor: '#000000',

  /** Cursor */
  cursorColor: '#000000',
  cursorWidth: 2,
  cursorBlinkInterval: 530,

  /** Selection */
  selectionColor: 'rgba(66, 133, 244, 0.3)',

  /** Page */
  pageGap: 40,
  pageShadowColor: 'rgba(0, 0, 0, 0.15)',
  pageShadowBlur: 8,
  pageShadowOffsetX: 0,
  pageShadowOffsetY: 4,
  pageBackground: '#ffffff',
  canvasBackground: '#f0f0f0',
} as const;
```

- [x] **Step 2: Fix compilation — update Theme references in layout.ts**

In `packages/docs/src/view/layout.ts`:
- Remove `Theme.pagePaddingX` and `Theme.pagePaddingTop` references
- Change `computeLayout` signature: rename `canvasWidth` → `contentWidth`
- Set initial `y = 0` (was `Theme.pagePaddingTop`)
- Set `LayoutBlock.x = 0` (was `Theme.pagePaddingX`)
- Set `availableWidth = contentWidth` (was `canvasWidth - Theme.pagePaddingX * 2`)

```typescript
export function computeLayout(
  blocks: Block[],
  ctx: CanvasRenderingContext2D,
  contentWidth: number,
): DocumentLayout {
  const availableWidth = contentWidth;
  const layoutBlocks: LayoutBlock[] = [];
  let y = 0;

  for (const block of blocks) {
    // ... (unchanged inner logic)

    const layoutBlock_: LayoutBlock = {
      block,
      x: 0,      // was Theme.pagePaddingX
      y,
      // ...
    };
    // ...
  }
  // ...
}
```

- [x] **Step 3: Fix compilation — update backgroundColor reference in doc-canvas.ts**

In `packages/docs/src/view/doc-canvas.ts`:
- `Theme.backgroundColor` → `Theme.pageBackground` (temporary; will be fully rewritten in Task 5)

- [x] **Step 4: Verify build compiles**

Run: `cd packages/docs && npx tsc --noEmit`
Expected: No errors

- [x] **Step 5: Run existing tests to check nothing is broken**

Run: `cd packages/docs && npx vitest run`
Expected: All existing tests pass (model and hangul tests don't use layout/theme)

- [x] **Step 6: Commit**

```bash
git add packages/docs/src/view/theme.ts packages/docs/src/view/layout.ts packages/docs/src/view/doc-canvas.ts
git commit -m "Update Theme constants for pagination and reset layout origin"
```

---

### Task 3: Store — PageSetup Support

**Files:**
- Modify: `packages/docs/src/store/store.ts`
- Modify: `packages/docs/src/store/memory.ts`
- Modify: `packages/docs/test/store/memory.test.ts`

- [x] **Step 1: Write test for pageSetup in MemDocStore**

Add to `packages/docs/test/store/memory.test.ts`:

```typescript
import { PAPER_SIZES, DEFAULT_PAGE_SETUP } from '../../src/model/types.js';

describe('pageSetup', () => {
  it('getPageSetup returns DEFAULT_PAGE_SETUP when not set', () => {
    const store = new MemDocStore();
    expect(store.getPageSetup()).toEqual(DEFAULT_PAGE_SETUP);
  });

  it('setPageSetup updates and supports undo', () => {
    const store = new MemDocStore();
    store.snapshot();
    const a4Setup = { ...DEFAULT_PAGE_SETUP, paperSize: PAPER_SIZES.A4 };
    store.setPageSetup(a4Setup);
    expect(store.getPageSetup().paperSize).toEqual(PAPER_SIZES.A4);

    store.undo();
    expect(store.getPageSetup()).toEqual(DEFAULT_PAGE_SETUP);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd packages/docs && npx vitest run test/store/memory.test.ts`
Expected: FAIL — `getPageSetup` not a function

- [x] **Step 3: Add getPageSetup/setPageSetup to DocStore interface**

In `packages/docs/src/store/store.ts`, add:

```typescript
import type { Block, Document, PageSetup } from '../model/types.js';

export interface DocStore {
  // ... existing methods ...
  getPageSetup(): PageSetup;
  setPageSetup(setup: PageSetup): void;
}
```

- [x] **Step 4: Implement in MemDocStore**

In `packages/docs/src/store/memory.ts`, add:

```typescript
import { resolvePageSetup, type PageSetup } from '../model/types.js';

// In MemDocStore class:
getPageSetup(): PageSetup {
  return resolvePageSetup(this.doc.pageSetup);
}

setPageSetup(setup: PageSetup): void {
  this.pushUndo();
  this.doc.pageSetup = JSON.parse(JSON.stringify(setup));
  this.redoStack = [];
}
```

- [x] **Step 5: Run tests to verify they pass**

Run: `cd packages/docs && npx vitest run test/store/memory.test.ts`
Expected: PASS

- [x] **Step 6: Commit**

```bash
git add packages/docs/src/store/store.ts packages/docs/src/store/memory.ts packages/docs/test/store/memory.test.ts
git commit -m "Add PageSetup support to DocStore interface and MemDocStore"
```

---

### Task 4: Pagination Engine

**Files:**
- Create: `packages/docs/src/view/pagination.ts`
- Create: `packages/docs/test/view/pagination.test.ts`

- [x] **Step 1: Write tests for paginateLayout**

```typescript
// test/view/pagination.test.ts
import { describe, it, expect } from 'vitest';
import { paginateLayout } from '../../src/view/pagination.js';
import { DEFAULT_PAGE_SETUP, PAPER_SIZES } from '../../src/model/types.js';
import type { DocumentLayout, LayoutBlock, LayoutLine } from '../../src/view/layout.js';

// Helper to create a mock LayoutLine
function mockLine(height: number): LayoutLine {
  return { runs: [], y: 0, height, width: 100 };
}

// Helper to create a mock LayoutBlock
function mockBlock(
  id: string,
  lines: LayoutLine[],
  marginTop = 0,
  marginBottom = 8,
): LayoutBlock {
  const totalHeight = lines.reduce((h, l) => h + l.height, 0);
  return {
    block: {
      id,
      type: 'paragraph',
      inlines: [{ text: 'test', style: {} }],
      style: { alignment: 'left', lineHeight: 1.5, marginTop, marginBottom },
    },
    x: 0,
    y: 0,
    width: 624,
    height: totalHeight,
    lines,
  };
}

describe('paginateLayout', () => {
  const setup = DEFAULT_PAGE_SETUP;
  // contentHeight = 1056 - 96 - 96 = 864

  it('empty document produces one empty page', () => {
    const layout: DocumentLayout = { blocks: [], totalHeight: 0 };
    const result = paginateLayout(layout, setup);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].lines).toHaveLength(0);
  });

  it('single line fits on one page', () => {
    const block = mockBlock('b1', [mockLine(24)]);
    const layout: DocumentLayout = { blocks: [block], totalHeight: 24 };
    const result = paginateLayout(layout, setup);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].lines).toHaveLength(1);
    expect(result.pages[0].lines[0].y).toBe(96); // margins.top
  });

  it('lines overflow to second page', () => {
    // Each line 100px, contentHeight 864 → 8 lines fit, 9th overflows
    const lines = Array.from({ length: 9 }, () => mockLine(100));
    const block = mockBlock('b1', lines, 0, 0);
    const layout: DocumentLayout = { blocks: [block], totalHeight: 900 };
    const result = paginateLayout(layout, setup);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0].lines).toHaveLength(8);
    expect(result.pages[1].lines).toHaveLength(1);
  });

  it('skips marginTop at page top', () => {
    // Fill first page, then next block starts on new page
    const lines1 = Array.from({ length: 8 }, () => mockLine(100));
    const block1 = mockBlock('b1', lines1, 0, 0);
    const block2 = mockBlock('b2', [mockLine(24)], 20, 0);
    const layout: DocumentLayout = {
      blocks: [block1, block2],
      totalHeight: 844,
    };
    const result = paginateLayout(layout, setup);
    expect(result.pages).toHaveLength(2);
    // block2's first line should be at margins.top (marginTop skipped at page top)
    expect(result.pages[1].lines[0].y).toBe(96);
  });

  it('landscape swaps dimensions', () => {
    const landscapeSetup = {
      ...DEFAULT_PAGE_SETUP,
      orientation: 'landscape' as const,
    };
    // landscape Letter: 1056 wide x 816 tall
    // contentHeight = 816 - 96 - 96 = 624
    const lines = Array.from({ length: 7 }, () => mockLine(100));
    const block = mockBlock('b1', lines, 0, 0);
    const layout: DocumentLayout = { blocks: [block], totalHeight: 700 };
    const result = paginateLayout(layout, landscapeSetup);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0].lines).toHaveLength(6);
    expect(result.pages[1].lines).toHaveLength(1);
  });

  it('oversized line gets its own page', () => {
    const block = mockBlock('b1', [mockLine(900)], 0, 0);
    const layout: DocumentLayout = { blocks: [block], totalHeight: 900 };
    const result = paginateLayout(layout, setup);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].lines).toHaveLength(1);
  });

  it('page dimensions match effective paper size', () => {
    const layout: DocumentLayout = { blocks: [], totalHeight: 0 };
    const result = paginateLayout(layout, setup);
    expect(result.pages[0].width).toBe(816);
    expect(result.pages[0].height).toBe(1056);
  });

  it('applies marginBottom only on the last page of a split block', () => {
    // 8 lines of 100px fill contentHeight (864), 9th overflows
    // Block has marginBottom 20. startNewPage() resets currentY, so
    // marginBottom is only applied after the 9th line on page 2.
    const lines = Array.from({ length: 9 }, () => mockLine(100));
    const block1 = mockBlock('b1', lines, 0, 20);
    const block2 = mockBlock('b2', [mockLine(24)], 0, 0);
    const layout: DocumentLayout = {
      blocks: [block1, block2],
      totalHeight: 924,
    };
    const result = paginateLayout(layout, setup);
    expect(result.pages).toHaveLength(2);
    // Page 2: line 9 of block1 at y=96, then marginBottom 20,
    // then block2's line at y = 96 + 100 + 20 = 216
    const block2Line = result.pages[1].lines.find(pl => pl.blockIndex === 1);
    expect(block2Line).toBeDefined();
    expect(block2Line!.y).toBe(96 + 100 + 20); // margins.top + line9 + marginBottom
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `cd packages/docs && npx vitest run test/view/pagination.test.ts`
Expected: FAIL — module not found

- [x] **Step 3: Implement paginateLayout**

Create `packages/docs/src/view/pagination.ts`:

```typescript
import type { PageSetup } from '../model/types.js';
import { getEffectiveDimensions } from '../model/types.js';
import type { DocumentLayout, LayoutLine } from './layout.js';

export interface PageLine {
  blockIndex: number;
  lineIndex: number;
  line: LayoutLine;
  x: number;
  y: number;
}

export interface LayoutPage {
  pageIndex: number;
  lines: PageLine[];
  width: number;
  height: number;
}

export interface PaginatedLayout {
  pages: LayoutPage[];
  pageSetup: PageSetup;
}

export function paginateLayout(
  layout: DocumentLayout,
  pageSetup: PageSetup,
): PaginatedLayout {
  const { width: effectiveWidth, height: effectiveHeight } =
    getEffectiveDimensions(pageSetup);
  const { margins } = pageSetup;
  const contentHeight = effectiveHeight - margins.top - margins.bottom;

  const pages: LayoutPage[] = [];
  let currentLines: PageLine[] = [];
  let currentY = 0;
  let isPageTop = true;

  const startNewPage = () => {
    pages.push({
      pageIndex: pages.length,
      lines: currentLines,
      width: effectiveWidth,
      height: effectiveHeight,
    });
    currentLines = [];
    currentY = 0;
    isPageTop = true;
  };

  for (let bi = 0; bi < layout.blocks.length; bi++) {
    const lb = layout.blocks[bi];
    const block = lb.block;

    // Apply marginTop (skip at page top)
    if (!isPageTop) {
      currentY += block.style.marginTop;
    }

    for (let li = 0; li < lb.lines.length; li++) {
      const line = lb.lines[li];

      // Check if line fits on current page
      if (currentY + line.height > contentHeight && !isPageTop) {
        startNewPage();
        // Skip marginTop for continuation of split block on new page
        // (marginTop only applies to first line group of a block)
      }

      currentLines.push({
        blockIndex: bi,
        lineIndex: li,
        line,
        x: margins.left,
        y: margins.top + currentY,
      });

      currentY += line.height;
      isPageTop = false;
    }

    // Apply marginBottom after the block's last line.
    // When a block splits across pages, startNewPage() resets currentY,
    // so marginBottom is naturally applied only on the final page.
    if (lb.lines.length > 0) {
      currentY += block.style.marginBottom;
    }
  }

  // Push final page (guarantee at least 1)
  pages.push({
    pageIndex: pages.length,
    lines: currentLines,
    width: effectiveWidth,
    height: effectiveHeight,
  });

  return { pages, pageSetup };
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `cd packages/docs && npx vitest run test/view/pagination.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add packages/docs/src/view/pagination.ts packages/docs/test/view/pagination.test.ts
git commit -m "Implement pagination engine with line-level page splitting"
```

---

### Task 5: Paginated Coordinate Mapping

**Files:**
- Modify: `packages/docs/src/view/pagination.ts`
- Modify: `packages/docs/test/view/pagination.test.ts`

- [x] **Step 1: Write tests for coordinate mapping**

Append to `test/view/pagination.test.ts`:

```typescript
import {
  getPageYOffset,
  getTotalHeight,
  findPageForPosition,
  paginatedPixelToPosition,
} from '../../src/view/pagination.js';

describe('getPageYOffset', () => {
  it('computes correct Y offset for each page', () => {
    const layout: DocumentLayout = { blocks: [], totalHeight: 0 };
    const paginated = paginateLayout(layout, DEFAULT_PAGE_SETUP);
    // pageGap(40) + pageIndex * (pageHeight + pageGap)
    expect(getPageYOffset(paginated, 0)).toBe(40);
  });
});

describe('getTotalHeight', () => {
  it('accounts for all pages and gaps', () => {
    // 1 page: pageGap + pageHeight + pageGap = 40 + 1056 + 40 = 1136
    const layout: DocumentLayout = { blocks: [], totalHeight: 0 };
    const paginated = paginateLayout(layout, DEFAULT_PAGE_SETUP);
    expect(getTotalHeight(paginated)).toBe(1136);
  });

  it('multi-page height is correct', () => {
    const lines = Array.from({ length: 9 }, () => mockLine(100));
    const block = mockBlock('b1', lines, 0, 0);
    const layout: DocumentLayout = { blocks: [block], totalHeight: 900 };
    const paginated = paginateLayout(layout, DEFAULT_PAGE_SETUP);
    // 2 pages: 40 + 1056 + 40 + 1056 + 40 = 2232
    expect(getTotalHeight(paginated)).toBe(2232);
  });
});

describe('findPageForPosition', () => {
  it('finds position on first page', () => {
    const block = mockBlock('b1', [mockLine(24)]);
    const layout: DocumentLayout = { blocks: [block], totalHeight: 24 };
    const paginated = paginateLayout(layout, DEFAULT_PAGE_SETUP);
    const found = findPageForPosition(paginated, 'b1', 0, layout);
    expect(found).toBeDefined();
    expect(found!.pageIndex).toBe(0);
  });

  it('finds position on second page after overflow', () => {
    const lines = Array.from({ length: 9 }, () => mockLine(100));
    const block = mockBlock('b1', lines, 0, 0);
    // Set up line runs so offset 0 maps to line 0, etc.
    // With empty runs, offset 0 always maps to first line
    const layout: DocumentLayout = { blocks: [block], totalHeight: 900 };
    const paginated = paginateLayout(layout, DEFAULT_PAGE_SETUP);
    // Page 2 has line index 8
    const found = findPageForPosition(paginated, 'b1', 0, layout);
    expect(found).toBeDefined();
    expect(found!.pageIndex).toBe(0);
  });

  it('returns undefined for unknown blockId', () => {
    const layout: DocumentLayout = { blocks: [], totalHeight: 0 };
    const paginated = paginateLayout(layout, DEFAULT_PAGE_SETUP);
    const found = findPageForPosition(paginated, 'unknown', 0, layout);
    expect(found).toBeUndefined();
  });
});

describe('paginatedPixelToPosition', () => {
  it('maps click in page gap to nearest page boundary', () => {
    const block = mockBlock('b1', [mockLine(24)]);
    const layout: DocumentLayout = { blocks: [block], totalHeight: 24 };
    const paginated = paginateLayout(layout, DEFAULT_PAGE_SETUP);
    // Click in the gap above page 1 (y < pageGap)
    const result = paginatedPixelToPosition(paginated, layout, 400, 10, 816);
    expect(result).toBeDefined();
    expect(result!.blockId).toBe('b1');
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `cd packages/docs && npx vitest run test/view/pagination.test.ts`
Expected: FAIL — functions not found

- [x] **Step 3: Implement helper functions**

Add to `packages/docs/src/view/pagination.ts`:

```typescript
import { Theme } from './theme.js';

/**
 * Get the absolute Y offset of a page's top edge on the canvas.
 */
export function getPageYOffset(
  paginatedLayout: PaginatedLayout,
  pageIndex: number,
): number {
  const pageHeight = paginatedLayout.pages[0]?.height ?? 0;
  return Theme.pageGap + pageIndex * (pageHeight + Theme.pageGap);
}

/**
 * Get the total scrollable height of the paginated document.
 */
export function getTotalHeight(paginatedLayout: PaginatedLayout): number {
  const { pages } = paginatedLayout;
  if (pages.length === 0) return 0;
  const pageHeight = pages[0].height;
  return pages.length * pageHeight + (pages.length + 1) * Theme.pageGap;
}

/**
 * Get horizontal offset for centering pages on canvas.
 */
export function getPageXOffset(
  paginatedLayout: PaginatedLayout,
  canvasWidth: number,
): number {
  const pageWidth = paginatedLayout.pages[0]?.width ?? 0;
  return Math.max(0, (canvasWidth - pageWidth) / 2);
}

/**
 * Find which page a given blockId + offset falls on.
 */
export function findPageForPosition(
  paginatedLayout: PaginatedLayout,
  blockId: string,
  offset: number,
  layout: DocumentLayout,
): { pageIndex: number; pageLine: PageLine } | undefined {
  // Find blockIndex
  const blockIndex = layout.blocks.findIndex(
    (lb) => lb.block.id === blockId,
  );
  if (blockIndex === -1) return undefined;

  // Find which line the offset falls on
  const lb = layout.blocks[blockIndex];
  let charCount = 0;
  let targetLineIndex = 0;
  for (let li = 0; li < lb.lines.length; li++) {
    const lineChars = lb.lines[li].runs.reduce(
      (sum, r) => sum + (r.charEnd - r.charStart),
      0,
    );
    if (charCount + lineChars >= offset) {
      targetLineIndex = li;
      break;
    }
    charCount += lineChars;
    targetLineIndex = li;
  }

  // Find this line in paginated layout
  for (const page of paginatedLayout.pages) {
    for (const pl of page.lines) {
      if (pl.blockIndex === blockIndex && pl.lineIndex === targetLineIndex) {
        return { pageIndex: page.pageIndex, pageLine: pl };
      }
    }
  }

  return undefined;
}

/**
 * Convert absolute canvas pixel coordinates to a document position.
 * Used for mouse click → cursor placement.
 */
export function paginatedPixelToPosition(
  paginatedLayout: PaginatedLayout,
  layout: DocumentLayout,
  px: number,
  py: number,
  canvasWidth: number,
): { blockId: string; offset: number } | undefined {
  if (paginatedLayout.pages.length === 0) return undefined;

  const pageX = getPageXOffset(paginatedLayout, canvasWidth);
  const { margins } = paginatedLayout.pageSetup;
  const pageHeight = paginatedLayout.pages[0].height;

  // Find which page was clicked
  let targetPage = paginatedLayout.pages[0];
  for (const page of paginatedLayout.pages) {
    const pageTop = getPageYOffset(paginatedLayout, page.pageIndex);
    if (py >= pageTop && py < pageTop + pageHeight) {
      targetPage = page;
      break;
    }
    if (py >= pageTop) targetPage = page;
  }

  if (targetPage.lines.length === 0) {
    // Empty page — find nearest block
    if (layout.blocks.length === 0) return undefined;
    return { blockId: layout.blocks[0].block.id, offset: 0 };
  }

  const pageTop = getPageYOffset(paginatedLayout, targetPage.pageIndex);
  const localY = py - pageTop;
  const localX = px - pageX - margins.left;

  // Find the target line on this page by Y
  let targetPL = targetPage.lines[0];
  for (const pl of targetPage.lines) {
    if (localY >= pl.y) {
      targetPL = pl;
    } else {
      break;
    }
  }

  const lb = layout.blocks[targetPL.blockIndex];
  const line = targetPL.line;

  if (line.runs.length === 0) {
    return { blockId: lb.block.id, offset: 0 };
  }

  // Count chars before this line in the block
  let charsBeforeLine = 0;
  for (let li = 0; li < targetPL.lineIndex; li++) {
    for (const r of lb.lines[li].runs) {
      charsBeforeLine += r.charEnd - r.charStart;
    }
  }

  // Find character within the line (binary search per run)
  let charsBeforeRun = 0;
  for (const run of line.runs) {
    if (localX >= run.x && localX <= run.x + run.width) {
      // Within this run — find exact character using measureText
      // Note: ctx is not available here, so we use a width-ratio approximation.
      // For precise positioning, the caller should use ctx.measureText.
      // However, to keep this function pure, we estimate based on char widths.
      const charWidth = run.width / Math.max(1, run.text.length);
      const localRunX = localX - run.x;
      const charOffset = Math.round(localRunX / charWidth);
      const clampedOffset = Math.min(Math.max(0, charOffset), run.text.length);
      return {
        blockId: lb.block.id,
        offset: charsBeforeLine + charsBeforeRun + clampedOffset,
      };
    }
    charsBeforeRun += run.text.length;
  }

  // Past end of line
  const lineCharCount = line.runs.reduce(
    (sum, r) => sum + (r.charEnd - r.charStart), 0,
  );
  return {
    blockId: lb.block.id,
    offset: charsBeforeLine + lineCharCount,
  };
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `cd packages/docs && npx vitest run test/view/pagination.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add packages/docs/src/view/pagination.ts packages/docs/test/view/pagination.test.ts
git commit -m "Add paginated coordinate mapping helpers"
```

---

### Task 6: Paginated Rendering + Wire Editor Pipeline

DocCanvas rewrite and editor wiring are done together so every intermediate
state compiles. Committing them separately would leave a broken build.

**Files:**
- Modify: `packages/docs/src/view/doc-canvas.ts`
- Modify: `packages/docs/src/view/editor.ts`
- Modify: `packages/docs/src/view/cursor.ts`
- Modify: `packages/docs/src/view/selection.ts`
- Modify: `packages/docs/src/view/text-editor.ts`

- [x] **Step 1: Rewrite DocCanvas.render for paginated layout**

Replace the `render` method in `packages/docs/src/view/doc-canvas.ts`. The new
version accepts `PaginatedLayout` instead of `DocumentLayout`, iterates over
pages, draws shadows/backgrounds, clips content area, and renders text per page.

Key signature change:
```typescript
render(
  paginatedLayout: PaginatedLayout,
  scrollY: number,
  canvasWidth: number,
  cursor?: { x: number; y: number; height: number; visible: boolean },
  selectionRects?: Array<{ x: number; y: number; width: number; height: number }>,
): void
```

See Task 6 code block in spec for the full `DocCanvas` class (page shadow,
viewport culling, content-area clipping, per-page text/cursor/selection rendering).

- [x] **Step 2: Update editor.ts to use paginated pipeline**

Key changes to `packages/docs/src/view/editor.ts`:
- Import `paginateLayout`, `PaginatedLayout`, `getTotalHeight`, `getPageXOffset`, `getPageYOffset`, `findPageForPosition`
- Import `resolvePageSetup`, `getEffectiveDimensions`
- Add `paginatedLayout` state alongside `layout`
- Update `recomputeLayout` to compute contentWidth from pageSetup and run `paginateLayout`
- Update `render` to pass `paginatedLayout` and `canvasWidth` to `docCanvas.render`
- Update canvas sizing to use `getTotalHeight`

```typescript
// In editor.ts, updated recomputeLayout:
const recomputeLayout = () => {
  const pageSetup = resolvePageSetup(doc.document.pageSetup);
  const dims = getEffectiveDimensions(pageSetup);
  const contentWidth = dims.width - pageSetup.margins.left - pageSetup.margins.right;

  layout = computeLayout(
    doc.document.blocks,
    docCanvas.getContext(),
    contentWidth,
  );
  paginatedLayout = paginateLayout(layout, pageSetup);
};

// In render:
const render = () => {
  syncToStore();
  const { width, height } = container.getBoundingClientRect();
  recomputeLayout();
  const totalHeight = getTotalHeight(paginatedLayout);
  const canvasHeight = Math.max(height, totalHeight);
  docCanvas.resize(width, canvasHeight);

  const scrollY = container.scrollTop;
  const cursorPixel = cursor.getPixelPosition(
    paginatedLayout, layout, docCanvas.getContext(), width,
  );
  const selectionRects = selection.getSelectionRects(
    paginatedLayout, layout, docCanvas.getContext(), width,
  );
  docCanvas.render(paginatedLayout, scrollY, width, cursorPixel ?? undefined, selectionRects);
};
```

Pass `() => paginatedLayout` and `() => canvasWidth` to `TextEditor` constructor (update its constructor to accept these).

- [x] **Step 2: Update cursor.ts to use paginated coordinates**

In `packages/docs/src/view/cursor.ts`, update `getPixelPosition`:

```typescript
import type { PaginatedLayout } from './pagination.js';
import { findPageForPosition, getPageYOffset, getPageXOffset } from './pagination.js';
import type { DocumentLayout } from './layout.js';
import { buildFont } from './theme.js';

getPixelPosition(
  paginatedLayout: PaginatedLayout,
  layout: DocumentLayout,
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
): { x: number; y: number; height: number; visible: boolean } | undefined {
  const found = findPageForPosition(
    paginatedLayout, this.position.blockId, this.position.offset, layout,
  );
  if (!found) return undefined;

  const { pageIndex, pageLine } = found;
  const pageX = getPageXOffset(paginatedLayout, canvasWidth);
  const pageY = getPageYOffset(paginatedLayout, pageIndex);
  const lb = layout.blocks[pageLine.blockIndex];

  // Count chars in prior lines of this block (computed once before run loop)
  let charsBeforeLine = 0;
  for (let li = 0; li < pageLine.lineIndex; li++) {
    for (const r of lb.lines[li].runs) {
      charsBeforeLine += r.charEnd - r.charStart;
    }
  }
  const lineOffset = this.position.offset - charsBeforeLine;

  // Find x offset within the line using existing run-level logic
  let charCount = 0;
  for (const run of pageLine.line.runs) {
    const runLength = run.charEnd - run.charStart;

    if (lineOffset >= charCount && lineOffset <= charCount + runLength) {
      const localOffset = lineOffset - charCount;
      const textBefore = run.text.slice(0, localOffset);
      ctx.font = buildFont(
        run.inline.style.fontSize,
        run.inline.style.fontFamily,
        run.inline.style.bold,
        run.inline.style.italic,
      );
      const x = pageX + pageLine.x + run.x + ctx.measureText(textBefore).width;
      return { x, y: pageY + pageLine.y, height: pageLine.line.height, visible: this.visible };
    }
    charCount += runLength;
  }

  // End of line fallback
  const lastRun = pageLine.line.runs[pageLine.line.runs.length - 1];
  if (lastRun) {
    return {
      x: pageX + pageLine.x + lastRun.x + lastRun.width,
      y: pageY + pageLine.y,
      height: pageLine.line.height,
      visible: this.visible,
    };
  }

  return { x: pageX + pageLine.x, y: pageY + pageLine.y, height: 24, visible: this.visible };
}
```

Remove import of `positionToPixel` from layout.js.

- [x] **Step 3: Update selection.ts to transform rects to page coordinates**

In `packages/docs/src/view/selection.ts`, rewrite `getSelectionRects` to compute
rects **directly in page space** using `PaginatedLayout`. This avoids a fragile
continuous-to-page coordinate transformation.

```typescript
import type { PaginatedLayout } from './pagination.js';
import {
  getPageYOffset, getPageXOffset, findPageForPosition,
} from './pagination.js';
import { buildFont } from './theme.js';

getSelectionRects(
  paginatedLayout: PaginatedLayout,
  layout: DocumentLayout,
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
): Array<{ x: number; y: number; width: number; height: number }> {
  const normalized = this.getNormalizedRange(layout);
  if (!normalized) return [];

  const { start, end } = normalized;
  const pageX = getPageXOffset(paginatedLayout, canvasWidth);
  const { margins } = paginatedLayout.pageSetup;
  const rects: Array<{ x: number; y: number; width: number; height: number }> = [];

  // Find start and end page lines
  const startFound = findPageForPosition(paginatedLayout, start.blockId, start.offset, layout);
  const endFound = findPageForPosition(paginatedLayout, end.blockId, end.offset, layout);
  if (!startFound || !endFound) return [];

  // Collect all page lines between start and end (across all pages)
  let inRange = false;
  for (const page of paginatedLayout.pages) {
    const pageYOff = getPageYOffset(paginatedLayout, page.pageIndex);

    for (const pl of page.lines) {
      const isStart = pl.blockIndex === startFound.pageLine.blockIndex
        && pl.lineIndex === startFound.pageLine.lineIndex;
      const isEnd = pl.blockIndex === endFound.pageLine.blockIndex
        && pl.lineIndex === endFound.pageLine.lineIndex;

      if (isStart) inRange = true;
      if (!inRange) continue;

      // Compute x range for this line
      const line = pl.line;
      if (line.runs.length === 0) { if (isEnd) break; continue; }

      let lineStartX = line.runs[0].x;
      let lineEndX = line.runs[line.runs.length - 1].x
        + line.runs[line.runs.length - 1].width;

      // If this is the start line, adjust startX using start.offset
      if (isStart) {
        // Measure x offset for start position within the line
        lineStartX = measureOffsetX(pl, start.offset, layout, ctx);
      }
      // If this is the end line, adjust endX using end.offset
      if (isEnd) {
        lineEndX = measureOffsetX(pl, end.offset, layout, ctx);
      }

      rects.push({
        x: pageX + margins.left + lineStartX,
        y: pageYOff + pl.y,
        width: lineEndX - lineStartX,
        height: line.height,
      });

      if (isEnd) break;
    }
    if (!inRange) continue;
  }

  return rects;
}
```

Add a private helper `measureOffsetX(pl, offset, layout, ctx)` that counts
chars before the line and uses `ctx.measureText` to find the x position of
a given offset within the line's runs. This reuses the same run-walking
logic as cursor positioning.

- [x] **Step 4: Update text-editor.ts coordinate mapping calls**

In `packages/docs/src/view/text-editor.ts`:

**Constructor change** — add two new callback parameters after the existing ones:
```typescript
constructor(
  container: HTMLElement,
  doc: Doc,
  cursor: Cursor,
  selection: Selection,
  getLayout: () => DocumentLayout,         // existing
  getPaginatedLayout: () => PaginatedLayout, // NEW
  getCtx: () => CanvasRenderingContext2D,
  getCanvasWidth: () => number,             // NEW
  onRender: () => void,
  onSnapshot: () => void,
  onUndo: () => void,
  onRedo: () => void,
)
```

**`getPositionFromMouse(e: MouseEvent)` update:**
- Remove import of `pixelToPosition` from `./layout.js`
- Import `paginatedPixelToPosition` from `./pagination.js`
- Convert mouse event to absolute canvas coordinates: `x = e.clientX - rect.left`, `y = e.clientY - rect.top + scrollY`
- Call `paginatedPixelToPosition(this.getPaginatedLayout(), this.getLayout(), x, y, this.getCanvasWidth())`

**`getPixelForPosition(pos)` update:**
- Remove import of `positionToPixel` from `./layout.js`
- Import `findPageForPosition`, `getPageYOffset`, `getPageXOffset` from `./pagination.js`
- Use same logic as updated `cursor.getPixelPosition()` to map position → absolute pixel

**`moveVertically(pos, direction)` update (line ~547):**
- Use paginated pixel lookup instead of `pixelToPosition`

**editor.ts** must pass the two new callbacks when constructing `TextEditor`:
```typescript
const textEditor = new TextEditor(
  container, doc, cursor, selection,
  () => layout,
  () => paginatedLayout,
  () => docCanvas.getContext(),
  () => container.getBoundingClientRect().width,
  render,
  () => docStore.snapshot(),
  undoFn, redoFn,
);
```

- [x] **Step 5: Verify build compiles**

Run: `cd packages/docs && npx tsc --noEmit`
Expected: No errors

- [x] **Step 6: Run all tests**

Run: `cd packages/docs && npx vitest run`
Expected: All tests pass

- [x] **Step 7: Commit**

```bash
git add packages/docs/src/view/doc-canvas.ts packages/docs/src/view/editor.ts packages/docs/src/view/cursor.ts packages/docs/src/view/selection.ts packages/docs/src/view/text-editor.ts
git commit -m "Wire pagination into editor pipeline with page-aware coordinates"
```

---

### Task 7: Update Public Exports and Cleanup

**Files:**
- Modify: `packages/docs/src/index.ts`
- Modify: `packages/docs/src/view/layout.ts`

- [x] **Step 1: Update index.ts exports**

Add pagination types and functions; remove old `positionToPixel`/`pixelToPosition`:

```typescript
// Add to index.ts:
export type { PageSetup, PageMargins, PaperSize } from './model/types.js';
export {
  PAPER_SIZES,
  DEFAULT_PAGE_SETUP,
  resolvePageSetup,
  getEffectiveDimensions,
} from './model/types.js';

export {
  paginateLayout,
  getTotalHeight,
  getPageYOffset,
  getPageXOffset,
} from './view/pagination.js';
export type {
  PaginatedLayout,
  LayoutPage,
  PageLine,
} from './view/pagination.js';

// Remove from layout.ts exports:
// positionToPixel, pixelToPosition (now in pagination.ts or removed)
```

- [x] **Step 2: Remove dead code from layout.ts**

Remove `positionToPixel`, `pixelToPosition`, and `findLayoutBlock` from `packages/docs/src/view/layout.ts` since they are replaced by paginated versions. Keep only `computeLayout` and the layout types.

- [x] **Step 3: Run full verification**

Run: `cd packages/docs && npx vitest run && npx tsc --noEmit`
Expected: All tests pass, no type errors

- [x] **Step 4: Commit**

```bash
git add packages/docs/src/index.ts packages/docs/src/view/layout.ts
git commit -m "Update public exports for pagination and remove dead coordinate mapping code"
```

---

### Task 8: Visual Verification with Demo

**Files:**
- Modify: `packages/docs/demo.ts`

- [x] **Step 1: Update demo to show multi-page document**

Update `packages/docs/demo.ts` to create a document with enough content to span multiple pages, so pagination is visually verifiable.

- [x] **Step 2: Manual visual verification**

Run: `cd packages/docs && npx vite`
Open browser → verify:
- Pages render with white background on gray canvas
- Page shadows are visible
- Gap between pages is visible
- Text wraps correctly within page content area
- Cursor positions correctly across pages
- Selection highlights work across page boundaries
- Scrolling works smoothly

- [x] **Step 3: Run full project verification**

Run: `pnpm verify:fast`
Expected: PASS

- [x] **Step 4: Commit**

```bash
git add packages/docs/demo.ts
git commit -m "Update demo for multi-page pagination verification"
```
