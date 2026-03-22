---
title: docs-ruler
target-version: 0.3.0
---

# Document Ruler

## Summary

Add horizontal (top) and vertical (left) rulers to the document editor.
Rulers show page dimensions, margins, and indent handles for the focused page.
Margins are adjustable by dragging ruler boundaries; indent handles control
per-block `textIndent` and `marginLeft`.

## Goals / Non-Goals

**Goals:**

- Horizontal ruler above the page, vertical ruler to the left
- Inch/cm unit display based on browser locale (default: inch)
- Margin drag handles on both rulers (left/right on horizontal, top/bottom on vertical)
- First-line indent (▽) and left indent (△) handles on horizontal ruler
- Snap to ruler grid (1/8 inch or 1mm)
- Visual feedback: cursor changes, drag guideline on main canvas

**Non-Goals:**

- Tab stops
- Right indent handle
- Ruler hide/show toggle (future)
- Print-specific ruler behavior

## Proposal Details

### DOM Structure

```
<container style="overflow: auto">
  <ruler-corner  style="position:sticky; top:0; left:0; z-index:3; 20×20px">
  <h-ruler-canvas style="position:sticky; top:0; z-index:2; height:20px">
  <v-ruler-canvas style="position:sticky; left:0; z-index:1; width:20px">
  <doc-canvas    style="position:sticky; top:20px">
  <spacer>
</container>
```

The corner element fills the intersection of the two rulers. Both ruler
canvases use `position: sticky` so they remain visible while the document
scrolls. The doc-canvas top offset shifts down by 20px to make room for the
horizontal ruler.

### Unit System

```typescript
type RulerUnit = 'inch' | 'cm';
```

| Unit | Major step (px @96dpi) | Subdivisions | Minor step (px) |
|------|----------------------|--------------|----------------|
| inch | 96                   | 8            | 12             |
| cm   | ~37.8                | 10           | ~3.78          |

Locale detection: if `navigator.language` starts with a locale that uses
metric (everything except `en-US`, `en-GB`, `my`), use `cm`. Default: `inch`.

### Horizontal Ruler Rendering

1. Fill entire ruler with margin background color (`#e8e8e8`).
2. Fill the content region (between left/right margins) with white.
3. Draw tick marks with heights:
   - Major tick (1 unit): 10px + number label
   - Half tick (1/2 unit): 7px
   - Minor tick (1/8 inch or 1mm): 4px
4. Numbers are rendered at major ticks, counting from 0 at the left margin.
5. Page offset (`getPageXOffset`) is applied so ticks align with the page.

### Vertical Ruler Rendering

Same tick style as horizontal, rotated. Numbers count from 0 at the top
margin of the focused page. The ruler re-renders when the focused page
changes (determined by scroll position).

### Margin Drag

- Hit zone: 4px around each margin boundary.
- Hover cursor: `col-resize` (horizontal) / `row-resize` (vertical).
- During drag: render a dashed guideline on the main canvas at the
  current position.
- On drop: update `PageSetup.margins` via `store.setPageSetup()`, then
  re-render.
- Snap: to nearest grid unit (12px for inch, ~3.78px for cm).

### Indent Handles

Two triangular handles on the horizontal ruler, inside the content area:

- **First-line indent (▽)**: top-pointing triangle at current
  `blockStyle.textIndent` offset from left margin. Drag changes
  `textIndent` of the cursor's block.
- **Left indent (△)**: bottom-pointing triangle at current
  `blockStyle.marginLeft` offset from left margin. Drag changes
  `marginLeft` of the cursor's block.

Both snap to the same grid as margins.

### Model Changes

`BlockStyle` gains two optional fields:

```typescript
export interface BlockStyle {
  alignment: 'left' | 'center' | 'right';
  lineHeight: number;
  marginTop: number;
  marginBottom: number;
  textIndent: number;   // NEW — first-line indent in px (default 0)
  marginLeft: number;   // NEW — left indent in px (default 0)
}
```

`DEFAULT_BLOCK_STYLE` sets both to `0`.

### Layout Changes

`computeLayout` applies `textIndent` and `marginLeft`:

- First run of the first line in a block: `run.x += textIndent + marginLeft`
- Subsequent lines: `run.x += marginLeft`
- Available width for wrapping: `contentWidth - marginLeft`
- First line available width: `contentWidth - marginLeft - textIndent`

### File Structure

**New file:** `packages/docs/src/view/ruler.ts`

```typescript
class Ruler {
  constructor(container: HTMLElement, docCanvas: HTMLCanvasElement)

  render(
    paginatedLayout: PaginatedLayout,
    scrollY: number,
    canvasWidth: number,
    viewportHeight: number,
    cursorBlockStyle: BlockStyle,
  ): void

  onMarginChange(cb: (margins: PageMargins) => void): void
  onIndentChange(cb: (style: Partial<BlockStyle>) => void): void

  dispose(): void
}
```

**Modified files:**

- `editor.ts` — create Ruler, wire callbacks, call `ruler.render()` in paint
- `model/types.ts` — add `textIndent`, `marginLeft` to BlockStyle
- `view/layout.ts` — apply indent/marginLeft to line wrapping
- `index.ts` — export Ruler

### Render Integration

The `paint()` function in `editor.ts` calls `ruler.render()` after
`docCanvas.render()`, passing the current paginated layout, scroll offset,
and the cursor block's style (for indent handle positions).

## Risks and Mitigation

| Risk | Mitigation |
|------|-----------|
| Drag interactions conflict with text editor mouse events | Ruler canvases are separate DOM elements; events don't propagate to doc canvas |
| Performance on scroll (vertical ruler re-render) | Only repaint vertical ruler when focused page changes |
| Fractional px from cm grid | Round tick positions to nearest pixel for crisp lines |
