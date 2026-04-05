# Docs Rendering Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Optimize the docs editor rendering pipeline so that scroll, cursor blink, and single-character typing do not recompute the layout of the entire document.

**Architecture:** Split `render()` into layout + paint paths. Scroll and cursor blink use paint-only. Typing marks the affected block as dirty and only recomputes that block. A module-level measureText cache avoids redundant Canvas API calls.

**Tech Stack:** TypeScript, Canvas API, Vitest

**Spec:** `docs/design/docs/docs-rendering-optimization.md`

---

### Task 1: Split render into render() and paint()

**Files:**
- Modify: `packages/docs/src/view/editor.ts:94-142`

Extract the paint portion of `render()` into a separate `paint()` function. `render()` calls `recomputeLayout()` then `paint()`. A new `renderPaintOnly()` calls only `paint()`.

- [x] **Step 1: Extract paint() from render()**

In `editor.ts`, refactor `render()`:

```typescript
// Paint helper — reuses cached layout/paginatedLayout
const paint = () => {
  const { width: viewportWidth, height } = container.getBoundingClientRect();
  const pageWidth = paginatedLayout.pages[0]?.width ?? 0;
  const canvasWidth = Math.max(viewportWidth, pageWidth);
  const totalHeight = getTotalHeight(paginatedLayout);

  docCanvas.resize(canvasWidth, height);
  spacer.style.height = `${totalHeight}px`;
  spacer.style.marginTop = `${-height}px`;

  const cursorPixel = cursor.getPixelPosition(
    paginatedLayout, layout, docCanvas.getContext(), canvasWidth,
  );

  if (needsScrollIntoView && cursorPixel) {
    needsScrollIntoView = false;
    const viewportTop = container.scrollTop;
    const viewportHeight = height;
    const cursorTop = cursorPixel.y;
    const cursorBottom = cursorPixel.y + cursorPixel.height;
    const scrollMargin = 20;

    if (cursorBottom > viewportTop + viewportHeight - scrollMargin) {
      container.scrollTop = cursorBottom - viewportHeight + scrollMargin;
    } else if (cursorTop < viewportTop + scrollMargin) {
      container.scrollTop = Math.max(0, cursorTop - scrollMargin);
    }
  }

  const scrollY = container.scrollTop;
  const selectionRects = selection.getSelectionRects(
    paginatedLayout, layout, docCanvas.getContext(), canvasWidth,
  );

  docCanvas.render(
    paginatedLayout, scrollY, canvasWidth, height,
    cursorPixel ?? undefined, selectionRects, focused,
  );
};

// Full render: layout + paint
const render = () => {
  syncToStore();
  recomputeLayout();
  paint();
};

// Paint-only render: reuse cached layout
const renderPaintOnly = () => {
  paint();
};
```

- [x] **Step 2: Wire scroll to renderPaintOnly**

Change `handleScroll`:
```typescript
const handleScroll = () => renderPaintOnly();
```

- [x] **Step 3: Wire cursor blink to renderPaintOnly**

Change both `cursor.startBlink` calls:
```typescript
cursor.startBlink(renderPaintOnly);
```
(Lines 194 and 210 in the current file.)

- [x] **Step 4: Verify in browser**

Run: `pnpm --filter @wafflebase/docs exec vite --port 5174`

Open http://localhost:5174. Verify:
- Scrolling renders correctly (text doesn't disappear)
- Cursor blinks normally
- Typing still works (full render path)
- Click to move cursor works

- [x] **Step 5: Run tests and commit**

Run: `pnpm verify:fast`

```bash
git add packages/docs/src/view/editor.ts
git commit -m "Split render into layout and paint-only paths

Scroll and cursor blink now skip layout recomputation and only
repaint the canvas using the cached layout. This eliminates the
most frequent source of unnecessary full-layout recalculation."
```

---

### Task 2: Add measureText cache

**Files:**
- Modify: `packages/docs/src/view/layout.ts:216-250`
- Create: `packages/docs/test/view/measure-cache.test.ts`

Add a module-level Map cache keyed by `font\ttext` to avoid redundant `ctx.measureText()` calls.

- [x] **Step 1: Write the test**

Create `packages/docs/test/view/measure-cache.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { cachedMeasureText, clearMeasureCache } from '../../src/view/layout.js';

describe('cachedMeasureText', () => {
  let callCount: number;
  let mockCtx: CanvasRenderingContext2D;

  beforeEach(() => {
    clearMeasureCache();
    callCount = 0;
    mockCtx = {
      font: '',
      measureText: (text: string) => {
        callCount++;
        return { width: text.length * 8 } as TextMetrics;
      },
    } as unknown as CanvasRenderingContext2D;
  });

  it('returns measured width', () => {
    const width = cachedMeasureText(mockCtx, 'hello', '16px sans-serif');
    expect(width).toBe(40); // 5 chars * 8
  });

  it('caches result on second call with same args', () => {
    cachedMeasureText(mockCtx, 'hello', '16px sans-serif');
    cachedMeasureText(mockCtx, 'hello', '16px sans-serif');
    expect(callCount).toBe(1);
  });

  it('distinguishes different fonts', () => {
    cachedMeasureText(mockCtx, 'hello', '16px sans-serif');
    cachedMeasureText(mockCtx, 'hello', 'bold 16px sans-serif');
    expect(callCount).toBe(2);
  });

  it('distinguishes different text', () => {
    cachedMeasureText(mockCtx, 'hello', '16px sans-serif');
    cachedMeasureText(mockCtx, 'world', '16px sans-serif');
    expect(callCount).toBe(2);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/docs exec vitest --run test/view/measure-cache.test.ts`

Expected: FAIL — `cachedMeasureText` and `clearMeasureCache` not exported.

- [x] **Step 3: Implement cachedMeasureText**

In `layout.ts`, add near the top (after imports):

```typescript
const measureCache = new Map<string, number>();

export function cachedMeasureText(
  ctx: CanvasRenderingContext2D,
  text: string,
  font: string,
): number {
  const key = `${font}\t${text}`;
  let width = measureCache.get(key);
  if (width === undefined) {
    ctx.font = font;
    width = ctx.measureText(text).width;
    measureCache.set(key, width);
  }
  return width;
}

export function clearMeasureCache(): void {
  measureCache.clear();
}
```

- [x] **Step 4: Wire measureSegments to use the cache**

In `measureSegments()` (line ~224-236), replace the direct `ctx.measureText` call:

Before:
```typescript
ctx.font = buildFont(
  inline.style.fontSize,
  inline.style.fontFamily,
  inline.style.bold,
  inline.style.italic,
);
// ... word loop ...
const metrics = ctx.measureText(word);
```

After:
```typescript
const font = buildFont(
  inline.style.fontSize,
  inline.style.fontFamily,
  inline.style.bold,
  inline.style.italic,
);
// ... word loop ...
const width = cachedMeasureText(ctx, word, font);
```

Use `width` directly instead of `metrics.width`.

- [x] **Step 5: Run tests**

Run: `pnpm --filter @wafflebase/docs exec vitest --run test/view/measure-cache.test.ts`

Expected: PASS

- [x] **Step 6: Run full verify and commit**

Run: `pnpm verify:fast`

```bash
git add packages/docs/src/view/layout.ts packages/docs/test/view/measure-cache.test.ts
git commit -m "Add measureText cache to avoid redundant Canvas API calls

Cache word width measurements by font+text key. Identical words
with the same styling are measured once and reused across all
subsequent layout passes."
```

---

### Task 3: Implement incremental layout with dirty block tracking

**Files:**
- Modify: `packages/docs/src/view/layout.ts:63-106`
- Modify: `packages/docs/src/view/editor.ts`
- Create: `packages/docs/test/view/incremental-layout.test.ts`

Add a `LayoutCache` that stores per-block layout results. When `dirtyBlockIds` is provided, only those blocks are recomputed; others reuse cached results. Y offsets are always recalculated.

- [x] **Step 1: Write the test**

Create `packages/docs/test/view/incremental-layout.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { computeLayout, clearMeasureCache } from '../../src/view/layout.js';
import type { LayoutCache } from '../../src/view/layout.js';
import type { Block } from '../../src/model/types.js';
import { createEmptyBlock } from '../../src/model/types.js';

function makeBlock(text: string): Block {
  const block = createEmptyBlock();
  block.inlines = [{ text, style: {} }];
  return block;
}

// Minimal mock canvas context for measureText
function mockCtx(): CanvasRenderingContext2D {
  return {
    font: '',
    measureText: (text: string) => ({ width: text.length * 8 } as TextMetrics),
  } as unknown as CanvasRenderingContext2D;
}

describe('incremental layout', () => {
  beforeEach(() => clearMeasureCache());

  it('returns a cache on first call', () => {
    const blocks = [makeBlock('Hello'), makeBlock('World')];
    const result = computeLayout(blocks, mockCtx(), 500);
    expect(result.cache).toBeDefined();
    expect(result.cache.blocks.size).toBe(2);
  });

  it('reuses cached blocks when dirtyBlockIds is empty', () => {
    const blocks = [makeBlock('Hello'), makeBlock('World')];
    const first = computeLayout(blocks, mockCtx(), 500);
    const second = computeLayout(
      blocks, mockCtx(), 500,
      new Set(), first.cache,
    );
    // Cached blocks should be the same object references
    expect(second.layout.blocks[0].lines).toBe(first.layout.blocks[0].lines);
    expect(second.layout.blocks[1].lines).toBe(first.layout.blocks[1].lines);
  });

  it('recomputes only the dirty block', () => {
    const blocks = [makeBlock('Hello'), makeBlock('World')];
    const first = computeLayout(blocks, mockCtx(), 500);

    // Modify second block
    blocks[1] = makeBlock('Changed');
    const dirty = new Set([blocks[1].id]);
    const second = computeLayout(
      blocks, mockCtx(), 500, dirty, first.cache,
    );

    // First block reused, second block recomputed
    expect(second.layout.blocks[0].lines).toBe(first.layout.blocks[0].lines);
    expect(second.layout.blocks[1].lines).not.toBe(first.layout.blocks[1].lines);
  });

  it('recalculates Y offsets even for cached blocks', () => {
    const blocks = [makeBlock('Hello'), makeBlock('World')];
    const first = computeLayout(blocks, mockCtx(), 500);
    const origY = first.layout.blocks[1].y;

    // Change first block to be taller (more text = more lines)
    blocks[0] = makeBlock('A '.repeat(200));
    const dirty = new Set([blocks[0].id]);
    const second = computeLayout(
      blocks, mockCtx(), 500, dirty, first.cache,
    );

    // Second block's Y should shift down
    expect(second.layout.blocks[1].y).toBeGreaterThan(origY);
  });

  it('does full recompute when cache contentWidth differs', () => {
    const blocks = [makeBlock('Hello')];
    const first = computeLayout(blocks, mockCtx(), 500);
    const second = computeLayout(
      blocks, mockCtx(), 400,
      new Set(), first.cache,
    );
    // Different content width → full recompute, new lines object
    expect(second.layout.blocks[0].lines).not.toBe(first.layout.blocks[0].lines);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/docs exec vitest --run test/view/incremental-layout.test.ts`

Expected: FAIL — `LayoutCache` type not exported, `computeLayout` signature mismatch.

- [x] **Step 3: Update computeLayout signature and implement caching**

In `layout.ts`:

Add the `LayoutCache` type:
```typescript
export interface LayoutCache {
  blocks: Map<string, LayoutBlock>;
  contentWidth: number;
}
```

Change `computeLayout` signature:
```typescript
export function computeLayout(
  blocks: Block[],
  ctx: CanvasRenderingContext2D,
  contentWidth: number,
  dirtyBlockIds?: Set<string>,
  cache?: LayoutCache,
): { layout: DocumentLayout; cache: LayoutCache }
```

Implementation (replaces current body). Note: `layoutBlock(block, ctx, maxWidth)` takes 3 params. Line heights and alignment are applied in `computeLayout`, not inside `layoutBlock`. Cached blocks already have correct line heights from their original computation. `LayoutBlock.height` excludes margins (matching existing semantics).

```typescript
  const availableWidth = contentWidth;
  const canUseCache = cache != null
    && dirtyBlockIds != null
    && cache.contentWidth === contentWidth;

  const newCacheBlocks = new Map<string, LayoutBlock>();
  const layoutBlocks: LayoutBlock[] = [];
  let y = 0;

  for (const block of blocks) {
    y += block.style.marginTop;

    let lines: LayoutLine[];

    if (canUseCache && !dirtyBlockIds.has(block.id) && cache.blocks.has(block.id)) {
      // Reuse cached block layout (lines already have heights and alignment)
      lines = cache.blocks.get(block.id)!.lines;
    } else {
      // Recompute this block
      lines = layoutBlock(block, ctx, availableWidth);
      const lineHeightMultiplier = block.style.lineHeight ?? 1.5;

      let blockY = 0;
      for (const line of lines) {
        const maxFontSize = getLineMaxFontSize(line, block);
        const lineHeight = lineHeightMultiplier * maxFontSize;
        line.y = blockY;
        line.height = lineHeight;
        blockY += lineHeight;
      }

      for (const line of lines) {
        applyAlignment(line, availableWidth, block.style.alignment);
      }
    }

    const blockHeight = lines.reduce((sum, l) => sum + l.height, 0);
    const lb: LayoutBlock = {
      block,
      x: 0,
      y,
      width: availableWidth,
      height: blockHeight,
      lines,
    };

    layoutBlocks.push(lb);
    newCacheBlocks.set(block.id, lb);
    y += blockHeight + block.style.marginBottom;
  }

  return {
    layout: { blocks: layoutBlocks, totalHeight: y },
    cache: { blocks: newCacheBlocks, contentWidth },
  };
```

Note: `getLineMaxFontSize` is an existing private function in `layout.ts`. It must remain accessible within the function.

- [x] **Step 4: Run tests**

Run: `pnpm --filter @wafflebase/docs exec vitest --run test/view/incremental-layout.test.ts`

Expected: PASS

- [x] **Step 5: Update editor.ts to use the new signature**

In `editor.ts`, update `recomputeLayout` and add dirty tracking:

```typescript
let layoutCache: LayoutCache | undefined;
let dirtyBlockIds: Set<string> | undefined;

const recomputeLayout = () => {
  const pageSetup = resolvePageSetup(doc.document.pageSetup);
  const dims = getEffectiveDimensions(pageSetup);
  const contentWidth = dims.width - pageSetup.margins.left - pageSetup.margins.right;
  const result = computeLayout(
    doc.document.blocks,
    docCanvas.getContext(),
    contentWidth,
    dirtyBlockIds,
    layoutCache,
  );
  layout = result.layout;
  layoutCache = result.cache;
  dirtyBlockIds = undefined;
  paginatedLayout = paginateLayout(layout, pageSetup);
};
```

Add `import type { LayoutCache } from './layout.js'` at top.

- [x] **Step 6: Add markDirty helper and wire to TextEditor**

In `editor.ts`, add a `markDirty` function and pass it to TextEditor:

```typescript
const markDirty = (blockId: string) => {
  if (dirtyBlockIds === undefined) {
    dirtyBlockIds = new Set();
  }
  dirtyBlockIds.add(blockId);
};
```

Pass `markDirty` as a new parameter to `TextEditor` constructor. In `text-editor.ts`, call `this.markDirty(blockId)` before `requestRender()` in:
- `handleInput()` — after `insertText`, mark current block dirty
- `handleDelete()` — only the non-merge path (single char delete), mark current block dirty
- `toggleStyle()` — after `applyInlineStyle`, mark current block dirty
- `applyHangulResult()` — after Hangul operations, mark current block dirty

For these operations, do NOT call `markDirty` — leave `dirtyBlockIds` as `undefined` so the full recompute path runs:
- `handleEnter()` — splitBlock is structural
- `handleBackspace()` — `deleteBackward` may silently merge blocks, so always full recompute
- `handleDelete()` merge path — explicit `mergeBlocks` call
- Multi-block selection deletes — structural change

In `editor.ts`, also ensure undo/redo reset the cache:
```typescript
const undoFn = () => {
  if (docStore.canUndo()) {
    docStore.undo();
    doc.document = docStore.getDocument();
    layoutCache = undefined; // force full recompute
    // ... rest unchanged ...
  }
};
```
Same for `redoFn`.

- [x] **Step 7: Verify in browser**

Run dev server, open the demo. Verify:
- Normal typing works correctly
- Enter key (split block) works
- Backspace to merge blocks works
- Undo/redo works
- Scrolling renders correctly

- [x] **Step 8: Run full verify and commit**

Run: `pnpm verify:fast`

```bash
git add packages/docs/src/view/layout.ts packages/docs/src/view/editor.ts \
       packages/docs/src/view/text-editor.ts \
       packages/docs/test/view/incremental-layout.test.ts
git commit -m "Add incremental layout with dirty block tracking

Only recompute layout for blocks that changed. Cached blocks
reuse their line/run layout and only get new Y offsets.
Structural operations and undo/redo force full recompute."
```

---

### Task 4: Wire applyStyle and applyBlockStyle to dirty tracking

**Files:**
- Modify: `packages/docs/src/view/editor.ts`

- [x] **Step 1: Add dirty marking to applyStyle**

In the `applyStyle` method of the returned API. For multi-block selections, mark all blocks in the range as dirty (not just endpoints):
```typescript
applyStyle: (style: Partial<InlineStyle>) => {
  if (selection.hasSelection() && selection.range) {
    docStore.snapshot();
    doc.applyInlineStyle(selection.range, style);
    // Mark all blocks in the selection range dirty
    const blocks = doc.document.blocks;
    const startIdx = blocks.findIndex(b => b.id === selection.range!.anchor.blockId);
    const endIdx = blocks.findIndex(b => b.id === selection.range!.focus.blockId);
    const lo = Math.min(startIdx, endIdx);
    const hi = Math.max(startIdx, endIdx);
    for (let i = lo; i <= hi; i++) {
      markDirty(blocks[i].id);
    }
    render();
  }
},
```

- [x] **Step 2: Add dirty marking to applyBlockStyle**

```typescript
applyBlockStyle: (style: Partial<BlockStyle>) => {
  docStore.snapshot();
  doc.applyBlockStyle(cursor.position.blockId, style);
  markDirty(cursor.position.blockId);
  render();
},
```

- [x] **Step 3: Verify in browser and commit**

Open demo, select text, apply bold/italic/alignment. Verify rendering updates correctly.

Run: `pnpm verify:fast`

```bash
git add packages/docs/src/view/editor.ts
git commit -m "Wire style operations to dirty block tracking

applyInlineStyle and applyBlockStyle now mark affected blocks
as dirty instead of forcing full document recompute."
```
