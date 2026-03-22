---
title: docs-rendering-optimization
target-version: 0.3.0
---

# Docs Rendering Optimization

## Summary

Optimize the Canvas-based document editor (`packages/docs`) rendering pipeline
for large documents (65+ pages). The current implementation recomputes full
layout on every scroll, cursor blink, and keystroke. This design introduces four
optimizations: scroll-only repaint, cursor blink repaint, measureText caching,
and incremental (dirty-block) layout.

### Goals

- Eliminate unnecessary full-layout recomputation on scroll and cursor blink.
- Cache `measureText` results to avoid redundant Canvas API calls.
- Implement dirty-block tracking so that typing recomputes only the changed
  block instead of the entire document.
- Fix canvas sizing for large documents (viewport-sized canvas + spacer div).

### Non-Goals

- Line-level virtualization (rendering only visible lines).
- Lazy pagination (deferring layout for off-screen pages).
- These are deferred to a future phase if needed beyond ~1000 pages.

## Problem

With a 65-page document (812 blocks, ~140K characters), four operations trigger
unnecessary full-layout recomputation:

| Trigger | Frequency | Current cost | Needed |
|---------|-----------|-------------|--------|
| Scroll | ~60 fps while scrolling | Full layout + paint | Paint only |
| Cursor blink | Every 530ms | Full layout + paint | Paint only |
| Keystroke | Every character | Full layout (all 812 blocks) | 1 block |
| measureText | Every word on every layout | Canvas API call | Cached value |

Additionally, the canvas was sized to the full document height (141K+ px),
exceeding browser canvas size limits and causing rendering failure.

## Design

### 1. Viewport-Sized Canvas (already implemented)

The canvas element stays at the viewport height. A spacer `<div>` provides the
scroll height. The render pass translates all drawing by `-scrollY`.

```
container (overflow: auto)
├── canvas (position: sticky, top: 0, height = viewport)
└── spacer (height = totalDocumentHeight, margin-top = -viewportHeight)
```

`doc-canvas.ts` wraps the paint loop in `ctx.translate(0, -scrollY)` so all
page coordinates remain absolute while only the visible portion is drawn.

### 2. Scroll-Only Repaint

Split the render path into two functions in `editor.ts`:

```typescript
// Full render: layout + pagination + paint (input, resize, undo/redo)
const render = () => {
  recomputeLayout();
  paint();
};

// Paint-only render: reuse cached layout (scroll, cursor blink)
// Reuses cached layout/paginatedLayout but recalculates:
//   - scrollY from container.scrollTop
//   - cursor pixel position (via cached paginatedLayout)
//   - selection rects (via cached paginatedLayout)
const renderPaintOnly = () => {
  paint();
};
```

`handleScroll` calls `renderPaintOnly()` instead of `render()`.

### 3. Cursor Blink Optimization

`cursor.startBlink()` receives `renderPaintOnly` instead of `render`. The
cursor's `visible` flag toggles, and only a repaint is needed — no layout
recomputation.

### 4. measureText Cache

Add a module-level cache in `layout.ts`:

```typescript
const measureCache = new Map<string, number>();

function cachedMeasureText(
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
```

The cache key is `font\ttext`. Font strings include size, family, weight, and
style — so identical visual text always hits the cache. The cache is never
invalidated because `measureText` results are deterministic for a given
font+text combination.

`measureSegments()` calls `cachedMeasureText()` instead of `ctx.measureText()`
directly.

### 5. Incremental Layout (Dirty Block Tracking)

#### Data structures

```typescript
interface LayoutCache {
  /** Cached layout result per block ID. */
  blocks: Map<string, LayoutBlock>;
  /** Content width used for the cached layout. */
  contentWidth: number;
}
```

#### Flow

```
keystroke → mark blockId as dirty
         → computeLayout(blocks, ctx, contentWidth, dirtyBlockIds, cache)
           1. For each block:
              if block is NOT dirty AND cache has entry → reuse cached LayoutBlock
              if block IS dirty OR not in cache       → measure + layout block
           2. Recompute Y offsets for all blocks (cumulative sum)
           3. Update cache entries for recomputed blocks
         → paginateLayout(layout, pageSetup)
         → paint
```

#### Dirty tracking in editor.ts

```typescript
let layoutCache: LayoutCache | undefined;
let dirtyBlockIds: Set<string> | undefined; // undefined = full recompute

const recomputeLayout = () => {
  // ... existing pageSetup / contentWidth calculation ...
  const result = computeLayout(
    doc.document.blocks, ctx, contentWidth, dirtyBlockIds, layoutCache,
  );
  layout = result.layout;
  layoutCache = result.cache;
  dirtyBlockIds = undefined; // reset after layout
  paginatedLayout = paginateLayout(layout, pageSetup);
};
```

Text input operations (`insertText`, `deleteText`, `deleteBackward`) and style
operations (`applyInlineStyle`, `applyBlockStyle`) set
`dirtyBlockIds = new Set([affectedBlockId])`.

Structural operations (`splitBlock`, `mergeBlocks`) and undo/redo set
`dirtyBlockIds = undefined` to force full recompute — these change block
ordering, so the cache is not reliable.

Note: `paginateLayout()` is always called on the full `DocumentLayout` even
in incremental mode. This is acceptable because pagination is a lightweight
O(lines) walk with no measurement calls.

#### computeLayout signature change

```typescript
function computeLayout(
  blocks: Block[],
  ctx: CanvasRenderingContext2D,
  contentWidth: number,
  dirtyBlockIds?: Set<string>,
  cache?: LayoutCache,
): { layout: DocumentLayout; cache: LayoutCache };
```

When `dirtyBlockIds` is undefined or `cache` is undefined, all blocks are
recomputed (backward-compatible behavior).

## File Change Summary

| File | Change |
|------|--------|
| editor.ts | Split render/renderPaintOnly, dirty tracking, layout cache, invalidateLayout |
| doc-canvas.ts | (already done) viewport canvas + scrollY translation |
| layout.ts | measureText cache, incremental layout with cache parameter |
| text-editor.ts | markDirty for text/style ops, invalidateLayout for structural ops |
| cursor.ts | No change (receives renderPaintOnly callback) |

## Risks and Mitigation

| Risk | Mitigation |
|------|-----------|
| Stale layout cache after structural edits | invalidateLayout() clears cache on splitBlock/mergeBlocks/multi-block delete; undo/redo also clears cache |
| measureText cache unbounded growth | For typical documents, cache stays small (unique word+font combos). Monitor and add LRU eviction if needed. |
| Y-offset drift after incremental layout | Always recompute all Y offsets cumulatively — only block-internal layout is cached |
| Race between dirty tracking and render | dirtyBlockIds is reset synchronously inside recomputeLayout |
| Remote edits (future YorkieDocStore) bypass dirty tracking | When Yorkie integration is added, external mutations must clear layoutCache or mark affected blocks dirty |
| DPI change / monitor switch invalidates measureText cache | Clear measureCache on `window.devicePixelRatio` change if needed (deferred — rare edge case) |
