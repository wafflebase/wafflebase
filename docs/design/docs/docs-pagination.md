---
title: docs-pagination
target-version: 0.3.0
---

# Document Pagination

## Summary

Add word-processor-style pagination to the Canvas-based document editor
(`packages/docs`). The document is divided into discrete pages with configurable
paper size, orientation, and margins. Pages are rendered with Google-Docs-style
visual separation (gray background, shadow, gap between pages). Lines that
overflow a page boundary are pushed to the next page.

This change introduces a **post-processing pagination layer** that sits between
the existing layout engine and the renderer, keeping changes to existing code
minimal.

### Goals

- Add `PageSetup` data model (paper size, orientation, margins) to `Document`.
- Implement `paginateLayout()` that splits a continuous `DocumentLayout` into
  pages at line boundaries.
- Render pages with shadow, gap, and centered alignment on canvas.
- Update coordinate mapping (click → position, position → pixel) for page
  coordinates.
- Preserve existing pageless layout logic; changes to `computeLayout()` are
  limited to accepting `contentWidth` instead of `canvasWidth`.

### Non-Goals

- Page setup UI (modal dialog, side panel) — deferred to frontend integration.
- Headers, footers, and page numbers — future extension.
- Manual page breaks and section breaks — future extension.
- Horizontal scroll for narrow viewports.

## Data Model

### PageSetup

Added to `packages/docs/src/model/types.ts`:

```typescript
interface PageSetup {
  paperSize: PaperSize;
  orientation: 'portrait' | 'landscape';
  margins: PageMargins;
}

interface PageMargins {
  top: number;    // px (96dpi)
  bottom: number;
  left: number;
  right: number;
}

interface PaperSize {
  name: string;
  width: number;  // px at 96dpi
  height: number;
}
```

### Paper Size Presets

All values in CSS pixels (1px = 1/96 inch):

| Name   | Width | Height | Physical        |
|--------|-------|--------|-----------------|
| Letter | 816   | 1056   | 8.5" × 11"     |
| A4     | 794   | 1123   | 210mm × 297mm  |
| Legal  | 816   | 1344   | 8.5" × 14"     |

### Defaults

- Paper size: Letter (816 × 1056 px)
- Orientation: portrait
- Margins: 96px all sides (1 inch)

Matches Google Docs defaults.

### Document Extension

```typescript
interface Document {
  blocks: Block[];
  pageSetup?: PageSetup;  // optional; defaults to DEFAULT_PAGE_SETUP
}
```

When `pageSetup` is undefined, all consumers use `DEFAULT_PAGE_SETUP`. This
avoids a breaking change — existing `Document` construction sites
(`MemDocStore`, `Doc.create()`, tests) continue to work without modification.
A helper `resolvePageSetup(doc: Document): PageSetup` returns
`doc.pageSetup ?? DEFAULT_PAGE_SETUP`.

## Pagination Engine

New file: `packages/docs/src/view/pagination.ts`

### Output Types

```typescript
interface PageLine {
  blockIndex: number;   // index into DocumentLayout.blocks
  lineIndex: number;    // index into LayoutBlock.lines
  line: LayoutLine;     // reference to original line
  x: number;            // margins.left (alignment is already in LayoutRun.x)
  y: number;            // y within page (from margins.top)
}

interface LayoutPage {
  pageIndex: number;
  lines: PageLine[];
  width: number;        // full paper width
  height: number;       // full paper height
}

interface PaginatedLayout {
  pages: LayoutPage[];
  pageSetup: PageSetup;
}
```

### Algorithm: `paginateLayout(layout, pageSetup) → PaginatedLayout`

1. Compute effective dimensions (swap width/height if landscape).
2. Compute content height: `effectiveHeight - margins.top - margins.bottom`.
3. Walk all lines across all blocks sequentially:
   - Apply block `marginTop` before first line of a block (skip if at page top).
   - If `currentY + line.height > contentHeight`, start a new page and reset
     `currentY = 0`.
   - Assign `PageLine.y = margins.top + currentY`.
   - Advance `currentY += line.height`.
   - Apply block `marginBottom` after last line of a block.
4. Push final page. Guarantee at least one page even if document is empty.

### Edge Cases

- **Line taller than content area:** place on its own page.
- **Block marginTop at page top:** skip (standard word processor behavior).
- **Block split across pages:** when a block's lines span two pages, suppress
  `marginBottom` on the first page and suppress `marginTop` continuation on
  the second page. Only the first line group of a block gets `marginTop`; only
  the last line group gets `marginBottom`.
- **Empty document:** single empty page.

## Rendering

### Page Visual Style (Google Docs Style)

- Canvas background: `#f0f0f0` (light gray)
- Page background: `#ffffff`
- Page gap: 40px between pages, 40px at top and bottom
- Page shadow: `offset(0, 4)`, blur 8px, `rgba(0, 0, 0, 0.15)`
- Pages horizontally centered: `pageX = Math.max(0, (canvasWidth - paperWidth) / 2)`

### Render Loop

```
for each page:
  pageY = pageIndex * (pageHeight + pageGap) + pageGap - scrollY

  1. Viewport culling: skip if page is entirely off-screen
  2. Draw drop shadow
  3. Draw white page rectangle
  4. Draw selection highlights (only rects belonging to this page)
  5. Draw text: iterate page.lines → runs → fillText
  6. Draw cursor if on this page
```

### Content Area Clipping

Each page's content area is clipped with `ctx.save()` / `ctx.clip()` /
`ctx.restore()` before drawing text and selection highlights. This prevents
descenders, selection rects, and underlines from bleeding into margin areas.
The clip rectangle is `(pageX + margins.left, pageY + margins.top,
contentWidth, contentHeight)`.

### Total Scroll Height and Canvas Sizing

```
totalHeight = pages.length * pageHeight + (pages.length + 1) * pageGap
```

`DocCanvas.resize()` and `packages/docs/src/view/editor.ts` use this `totalHeight` to size the
canvas element, replacing the previous `layout.totalHeight` calculation.
The container's scroll range is set to `totalHeight` so the browser
scrollbar reflects the full paginated document.

### Theme Changes

Remove: `pagePaddingX`, `pagePaddingTop`

Add:

```typescript
pageGap: 40,
pageShadowColor: 'rgba(0, 0, 0, 0.15)',
pageShadowBlur: 8,
pageShadowOffsetX: 0,
pageShadowOffsetY: 4,
canvasBackground: '#f0f0f0',
```

## Coordinate Mapping

The existing `positionToPixel` and `pixelToPosition` in `packages/docs/src/view/layout.ts` are
replaced by new paginated versions. The original functions are removed (not
wrapped) since all rendering is now page-based.

### New Function Signatures

```typescript
// view/pagination.ts

function paginatedPixelToPosition(
  paginatedLayout: PaginatedLayout,
  px: number,   // absolute canvas x
  py: number,   // absolute canvas y (scrollY already added by caller)
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
): DocPosition;

function paginatedPositionToPixel(
  paginatedLayout: PaginatedLayout,
  blockId: string,
  offset: number,
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
): { x: number; y: number; height: number };
```

Both functions take `canvasWidth` to compute `pageX` (horizontal centering).

### pixelToPosition (click → document position)

1. Determine which page was clicked using cumulative page Y offsets.
2. Compute local coordinates within the page.
3. Handle margin/gap clicks:
   - Top margin → first line of page.
   - Bottom margin → last line of page.
   - Left/right margin → line start/end.
   - Page gap → nearest page boundary.
4. For content area clicks, reuse the line-level binary search logic
   (extracted as a shared helper from the existing `pixelToPosition`).

### positionToPixel (document position → cursor pixel)

1. Find the `PageLine` matching `blockId + offset`.
2. Compute absolute Y: `pageIndex * (pageHeight + pageGap) + pageGap + pageLine.y`.
3. Compute absolute X: `pageX + pageLine.x + (inline offset within line)`.

### Callers to Update

- `TextEditor`: mouse handlers call `paginatedPixelToPosition`; cursor
  rendering calls `paginatedPositionToPixel`.
- `Cursor.getPixelPosition()`: delegates to `paginatedPositionToPixel`.
- `Selection.getSelectionRects()`: computes rects in continuous layout space
  (using existing line geometry), then transforms each rect to absolute page
  coordinates via a `toPageCoords(rect, paginatedLayout, canvasWidth)` helper.
  This keeps the multi-line rect logic untouched.

## computeLayout Integration

### Signature Change

```typescript
// before
computeLayout(blocks, ctx, canvasWidth)
// after
computeLayout(blocks, ctx, contentWidth)
```

The caller computes `contentWidth = effectiveWidth - margins.left - margins.right`
and passes it directly. Internal `pagePaddingX` subtraction is removed.

### Origin Reset

`computeLayout` must produce coordinates starting at `y = 0`, `x = 0`:
- Remove `let y = Theme.pagePaddingTop` → start at `y = 0`.
- Remove `pagePaddingX` from `LayoutBlock.x` → start at `x = 0`.

The pagination layer adds margin offsets (`PageLine.x = margins.left`,
`PageLine.y = margins.top + currentY`), so the layout engine must output
margin-free coordinates to avoid double-offsetting.

### Full Pipeline

```
pageSetup → effective dimensions
         → contentWidth

computeLayout(blocks, ctx, contentWidth)
  → DocumentLayout (continuous line layout, unchanged logic)

paginateLayout(documentLayout, pageSetup)
  → PaginatedLayout (lines distributed across pages)

docCanvas.render(paginatedLayout, scrollY, cursor, selectionRects)
  → Canvas pixels (pages with gaps, shadows, centered)
```

## Store Changes

`DocStore` interface gains:

```typescript
getPageSetup(): PageSetup;
setPageSetup(setup: PageSetup): void;
```

`MemDocStore` implements these by reading/writing `document.pageSetup`.
`setPageSetup` pushes to undo stack like other mutations.

## File Change Summary

| File | Change |
|------|--------|
| `packages/docs/src/model/types.ts` | `PageSetup`, `PageMargins`, `PaperSize`, presets, `Document.pageSetup` |
| `packages/docs/src/view/pagination.ts` | **New** — `paginateLayout()`, `PaginatedLayout`, `LayoutPage`, `PageLine` |
| `packages/docs/src/view/layout.ts` | Signature: `canvasWidth` → `contentWidth`, remove `pagePaddingX` usage |
| `packages/docs/src/view/doc-canvas.ts` | Page-based rendering with shadow, gap, background |
| `packages/docs/src/view/editor.ts` | Wire paginate step, pass `pageSetup` through pipeline |
| `packages/docs/src/view/theme.ts` | Remove `pagePaddingX/Top`, add page gap/shadow constants |
| `packages/docs/src/view/selection.ts` | Convert selection rects to page coordinates |
| `packages/docs/src/view/cursor.ts` | Minimal — `positionToPixel` returns page-aware coordinates |
| `packages/docs/src/store/store.ts` | `getPageSetup()`, `setPageSetup()` |
| `packages/docs/src/store/memory.ts` | Implement pageSetup in `MemDocStore` |

## Risks and Mitigation

| Risk | Mitigation |
|------|-----------|
| Performance on large documents (many pages) | Viewport culling skips off-screen pages; layout is already O(lines) |
| Existing tests break from signature change | Update `computeLayout` call sites in tests to pass `contentWidth` |
| Coordinate mapping bugs at page boundaries | Comprehensive tests for clicks on margins, gaps, and page edges |
| Future header/footer integration | `LayoutPage` structure is extensible; header/footer regions can be added to page model |
