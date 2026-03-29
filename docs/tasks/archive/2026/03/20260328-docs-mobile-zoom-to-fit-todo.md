# Docs Mobile Zoom-to-Fit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Scale the Canvas-based docs editor to fit mobile viewports when the container is narrower than the page width.

**Architecture:** Compute a scale factor from container width vs page width, apply `ctx.scale()` in the Canvas render pass, and invert coordinates in hit-testing. Layout/pagination engines remain unchanged.

**Tech Stack:** TypeScript, Canvas 2D API, Vitest

**Spec:** `docs/design/docs-mobile-zoom-to-fit.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/docs/src/view/scale.ts` | Create | `computeScaleFactor()` pure function + `MOBILE_PADDING` constant |
| `packages/docs/test/view/scale.test.ts` | Create | Unit tests for scale factor calculation |
| `packages/docs/src/view/doc-canvas.ts` | Modify | Accept `scaleFactor` in `render()`, apply `ctx.scale` |
| `packages/docs/src/view/text-editor.ts` | Modify | Accept `getScaleFactor` callback, invert coordinates in hit-test methods |
| `packages/docs/src/view/ruler.ts` | Modify | Add `hide()`/`show()` methods |
| `packages/docs/src/view/editor.ts` | Modify | Compute scale factor, wire it through, scale spacer/scroll, hide ruler |
| `packages/docs/src/index.ts` | Modify | Export `computeScaleFactor` and `MOBILE_PADDING` |

---

### Task 1: Scale Factor Utility

**Files:**
- Create: `packages/docs/src/view/scale.ts`
- Create: `packages/docs/test/view/scale.test.ts`

- [x] **Step 1: Write the failing test**

Create `packages/docs/test/view/scale.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeScaleFactor, MOBILE_PADDING } from '../../src/view/scale.js';

describe('computeScaleFactor', () => {
  const PAGE_WIDTH = 816; // Letter

  it('returns 1 when container is wider than page', () => {
    expect(computeScaleFactor(1200, PAGE_WIDTH)).toBe(1);
  });

  it('returns 1 when container exactly fits page + padding', () => {
    const containerWidth = PAGE_WIDTH + MOBILE_PADDING * 2;
    expect(computeScaleFactor(containerWidth, PAGE_WIDTH)).toBe(1);
  });

  it('scales down for narrow container (iPhone SE, 375px)', () => {
    const factor = computeScaleFactor(375, PAGE_WIDTH);
    // (375 - 32) / 816 ≈ 0.4204
    expect(factor).toBeCloseTo(0.4204, 3);
  });

  it('scales down for medium container (iPhone 14, 390px)', () => {
    const factor = computeScaleFactor(390, PAGE_WIDTH);
    // (390 - 32) / 816 ≈ 0.4387
    expect(factor).toBeCloseTo(0.4387, 3);
  });

  it('handles zero container width', () => {
    expect(computeScaleFactor(0, PAGE_WIDTH)).toBeGreaterThan(0);
  });

  it('handles zero page width', () => {
    expect(computeScaleFactor(375, 0)).toBe(1);
  });

  it('never exceeds 1', () => {
    expect(computeScaleFactor(2000, PAGE_WIDTH)).toBe(1);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd packages/docs && npx vitest --run test/view/scale.test.ts`
Expected: FAIL — module not found

- [x] **Step 3: Write implementation**

Create `packages/docs/src/view/scale.ts`:

```typescript
/**
 * Padding (px) on each side of the page when zoom-to-fit is active.
 */
export const MOBILE_PADDING = 16;

/**
 * Compute the scale factor to fit a page within the container width.
 *
 * Returns a value in (0, 1] — 1 means no scaling needed.
 * When the container is wide enough for the page + padding, returns 1.
 */
export function computeScaleFactor(
  containerWidth: number,
  pageWidth: number,
): number {
  if (pageWidth <= 0) return 1;
  const available = containerWidth - MOBILE_PADDING * 2;
  if (available <= 0) return MOBILE_PADDING * 2 > 0 ? containerWidth / (pageWidth + MOBILE_PADDING * 2) : 1;
  return Math.min(1, available / pageWidth);
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd packages/docs && npx vitest --run test/view/scale.test.ts`
Expected: All 7 tests PASS

- [x] **Step 5: Export from index**

Add to `packages/docs/src/index.ts`:

```typescript
export { computeScaleFactor, MOBILE_PADDING } from './view/scale.js';
```

- [x] **Step 6: Commit**

```bash
git add packages/docs/src/view/scale.ts packages/docs/test/view/scale.test.ts packages/docs/src/index.ts
git commit -m "Add computeScaleFactor utility for docs mobile zoom-to-fit"
```

---

### Task 2: DocCanvas Scale Support

**Files:**
- Modify: `packages/docs/src/view/doc-canvas.ts`

- [x] **Step 1: Add scaleFactor parameter to render()**

In `packages/docs/src/view/doc-canvas.ts`, add `scaleFactor` as the last parameter of the `render()` method (default `1`):

```typescript
render(
  paginatedLayout: PaginatedLayout,
  scrollY: number,
  canvasWidth: number,
  viewportHeight: number,
  cursor?: { x: number; y: number; height: number; visible: boolean },
  selectionRects?: Array<{ x: number; y: number; width: number; height: number }>,
  focused: boolean = true,
  peerCursors?: Array<{
    pixel: { x: number; y: number; height: number };
    color: string;
    username: string;
    labelVisible: boolean;
    stackIndex: number;
  }>,
  peerSelections?: Array<{
    color: string;
    rects: Array<{ x: number; y: number; width: number; height: number }>;
  }>,
  layout?: DocumentLayout,
  searchHighlightRects?: Array<Array<{ x: number; y: number; width: number; height: number }>>,
  activeSearchIndex?: number,
  scaleFactor: number = 1,
): void {
```

- [x] **Step 2: Apply ctx.scale before translate**

Replace the existing `ctx.save(); ctx.translate(0, -scrollY);` block (lines 84-85) with:

```typescript
this.ctx.save();
if (scaleFactor !== 1) {
  this.ctx.scale(scaleFactor, scaleFactor);
}
this.ctx.translate(0, -scrollY);
```

The `canvasWidth` passed in should already be the logical width (`physicalCanvasWidth / scaleFactor`) — the caller (editor.ts) handles this in Task 4.

- [x] **Step 3: Verify existing tests still pass**

Run: `cd packages/docs && npx vitest --run`
Expected: All tests PASS (no existing tests exercise DocCanvas directly, but ensures no import breakage)

- [x] **Step 4: Commit**

```bash
git add packages/docs/src/view/doc-canvas.ts
git commit -m "Add scaleFactor support to DocCanvas render method"
```

---

### Task 3: Ruler Hide/Show

**Files:**
- Modify: `packages/docs/src/view/ruler.ts`

- [x] **Step 1: Add hide() and show() methods**

Add these methods to the `Ruler` class in `packages/docs/src/view/ruler.ts`, before the `dispose()` method:

```typescript
/**
 * Hide all ruler elements (used when zoom-to-fit is active).
 */
hide(): void {
  this.hCanvas.style.display = 'none';
  this.vCanvas.style.display = 'none';
  this.corner.style.display = 'none';
}

/**
 * Show all ruler elements.
 */
show(): void {
  this.hCanvas.style.display = 'block';
  this.vCanvas.style.display = 'block';
  this.corner.style.display = 'block';
}
```

- [x] **Step 2: Verify existing ruler tests pass**

Run: `cd packages/docs && npx vitest --run test/view/ruler.test.ts`
Expected: All PASS

- [x] **Step 3: Commit**

```bash
git add packages/docs/src/view/ruler.ts
git commit -m "Add hide/show methods to Ruler for mobile zoom-to-fit"
```

---

### Task 4: TextEditor Scale-Aware Hit Testing

**Files:**
- Modify: `packages/docs/src/view/text-editor.ts`

- [x] **Step 1: Add getScaleFactor to constructor**

In `packages/docs/src/view/text-editor.ts`, add a new private field and constructor parameter. Insert after `getCanvasWidth`:

Field (add after line 87 `private getCanvasWidth: () => number;`):
```typescript
private getScaleFactor: () => number;
```

Constructor parameter (add after `getCanvasWidth: () => number,` at line 111):
```typescript
getScaleFactor: () => number,
```

Constructor body (add after `this.getCanvasWidth = getCanvasWidth;` at line 128):
```typescript
this.getScaleFactor = getScaleFactor;
```

- [x] **Step 2: Update getPositionFromMouse**

In `getPositionFromMouse` (around line 1752), apply scale inversion:

```typescript
private getPositionFromMouse(e: MouseEvent): (DocPosition & { lineAffinity: 'forward' | 'backward' }) | undefined {
  const rect = this.container.getBoundingClientRect();
  const s = this.getScaleFactor();
  const x = (e.clientX - rect.left + this.container.scrollLeft) / s;
  const y = (e.clientY - rect.top - this.getCanvasOffsetTop()) / s;
  const scrollY = this.container.scrollTop / s;
  return paginatedPixelToPosition(
    this.getPaginatedLayout(), this.getLayout(), x, y + scrollY, this.getCanvasWidth(),
  );
}
```

- [x] **Step 3: Update updateDragSelection**

In `updateDragSelection` (around line 731), apply scale inversion:

```typescript
private updateDragSelection(clientX: number, clientY: number): void {
  const rect = this.container.getBoundingClientRect();
  const s = this.getScaleFactor();
  const x = (clientX - rect.left + this.container.scrollLeft) / s;
  const y = (clientY - rect.top - this.getCanvasOffsetTop()) / s;
  const scrollY = this.container.scrollTop / s;
  const result = paginatedPixelToPosition(
    this.getPaginatedLayout(), this.getLayout(), x, y + scrollY, this.getCanvasWidth(),
  );
  if (result && this.selection.range) {
    const pos: DocPosition = { blockId: result.blockId, offset: result.offset };
    this.cursor.moveTo(pos, result.lineAffinity);
    this.selection.setRange({
      anchor: this.selection.range.anchor,
      focus: pos,
    });
    this.requestRender();
  }
}
```

- [x] **Step 4: Verify tests pass**

Run: `cd packages/docs && npx vitest --run`
Expected: All PASS

- [x] **Step 5: Commit**

```bash
git add packages/docs/src/view/text-editor.ts
git commit -m "Add scale factor inversion to TextEditor hit testing"
```

---

### Task 5: Editor Integration

**Files:**
- Modify: `packages/docs/src/view/editor.ts`

- [x] **Step 1: Import computeScaleFactor**

Add to the imports at the top of `packages/docs/src/view/editor.ts`:

```typescript
import { computeScaleFactor } from './scale.js';
```

- [x] **Step 2: Add scaleFactor state variable**

Add after the `let dragGuideline` declaration (around line 132):

```typescript
let scaleFactor = 1;
```

- [x] **Step 3: Update paint() — compute scale factor and apply to canvas/spacer**

In the `paint()` function, after computing `canvasWidth` and `totalHeight` (around line 183), add scale factor computation and modify the downstream code:

Replace the block from `const canvasHeight = height - RULER_SIZE;` through `spacer.style.marginTop = ...`:

```typescript
// Compute scale factor for mobile zoom-to-fit
const pageWidth = paginatedLayout.pages[0]?.width ?? 0;
scaleFactor = computeScaleFactor(viewportWidth, pageWidth);

// When scaled, hide rulers and use full container height for canvas
const rulerSize = scaleFactor < 1 ? 0 : RULER_SIZE;
if (scaleFactor < 1) {
  ruler.hide();
} else {
  ruler.show();
}

const canvasHeight = height - rulerSize;
docCanvas.resize(canvasWidth, canvasHeight);
spacer.style.height = `${totalHeight * scaleFactor}px`;
spacer.style.marginTop = `${-height - rulerSize}px`;
```

- [x] **Step 4: Update paint() — convert scrollY and pass scale to render**

Replace the `const scrollY = container.scrollTop;` line and update the docCanvas.render call:

```typescript
const scrollY = container.scrollTop / scaleFactor;
```

Update the logical canvas width passed to all coordinate computations. After `scaleFactor` is computed, update `canvasWidth` for the logical coordinate space:

```typescript
// Logical canvas width in unscaled document coordinates
const logicalCanvasWidth = scaleFactor < 1 ? canvasWidth / scaleFactor : canvasWidth;
```

Then replace all uses of `canvasWidth` in the paint() function that compute document-space positions (cursorPixel, selectionRects, peerPixels, searchHighlightRects, docCanvas.render) with `logicalCanvasWidth`. Specifically:

- `cursor.getPixelPosition(...)` — use `logicalCanvasWidth`
- `selectionRects = selection.getSelectionRects(...)` — use `logicalCanvasWidth`
- `resolvePositionPixel(...)` for peer cursors — use `logicalCanvasWidth`
- `computeSelectionRects(...)` for peer selections — use `logicalCanvasWidth`
- `computeSelectionRects(...)` for search highlights — use `logicalCanvasWidth`
- `docCanvas.render(...)` — use `logicalCanvasWidth` and pass `scaleFactor` as last arg

Keep the physical `canvasWidth` for `docCanvas.resize()`.

- [x] **Step 5: Update cursor auto-scroll to account for scale**

In the `needsScrollIntoView` block, convert cursor pixel coordinates to physical space:

```typescript
if (needsScrollIntoView && cursorPixel) {
  needsScrollIntoView = false;
  const viewportTop = container.scrollTop;
  const viewportHeight = canvasHeight;
  const cursorTop = cursorPixel.y * scaleFactor;
  const cursorBottom = (cursorPixel.y + cursorPixel.height) * scaleFactor;
  const scrollMargin = 20;

  if (cursorBottom > viewportTop + viewportHeight - scrollMargin) {
    container.scrollTop = cursorBottom - viewportHeight + scrollMargin;
  } else if (cursorTop < viewportTop + scrollMargin) {
    container.scrollTop = Math.max(0, cursorTop - scrollMargin);
  }
}
```

- [x] **Step 6: Pass getScaleFactor to TextEditor**

Update the `TextEditor` constructor call to include the scale factor callback. Add after the `getCanvasWidth` callback:

```typescript
() => scaleFactor,
```

- [x] **Step 7: Update TextEditor callback for getCanvasWidth to return logical width**

The `getCanvasWidth` callback passed to TextEditor should return the logical (unscaled) canvas width so hit-testing uses document coordinates:

```typescript
() => {
  const vw = (container.parentElement ?? container).getBoundingClientRect().width;
  const pw = paginatedLayout.pages[0]?.width ?? 0;
  const physical = Math.max(vw, pw);
  return scaleFactor < 1 ? physical / scaleFactor : physical;
},
```

- [x] **Step 8: Update ruler rendering to skip when hidden**

In the ruler.render call at the end of paint(), wrap it conditionally:

```typescript
if (scaleFactor >= 1) {
  ruler.render(
    paginatedLayout,
    scrollY,
    logicalCanvasWidth,
    canvasHeight,
    cursorBlock?.style ?? null,
    cursorPageInfo?.pageIndex ?? 0,
  );
}
```

- [x] **Step 9: Update getCursorScreenRect to account for scale**

In the `getCursorScreenRect` method in the returned API, multiply pixel coordinates by scaleFactor:

```typescript
getCursorScreenRect: () => {
  const cursorPixel = cursor.getPixelPosition(paginatedLayout, layout, docCanvas.getContext(),
    Math.max(
      (container.parentElement ?? container).getBoundingClientRect().width,
      paginatedLayout.pages[0]?.width ?? 0,
    ) / (scaleFactor < 1 ? scaleFactor : 1),
  );
  if (!cursorPixel) return undefined;
  const canvasRect = canvas.getBoundingClientRect();
  const scrollY = container.scrollTop / scaleFactor;
  return {
    x: canvasRect.left + cursorPixel.x * scaleFactor,
    y: canvasRect.top + (cursorPixel.y - scrollY) * scaleFactor,
    height: cursorPixel.height * scaleFactor,
  };
},
```

- [x] **Step 10: Update canvas top style when ruler is hidden**

When the ruler is hidden, the canvas should stick to `top: 0` instead of `top: ${RULER_SIZE}px`. In the scale factor block:

```typescript
if (scaleFactor < 1) {
  ruler.hide();
  canvas.style.top = '0';
} else {
  ruler.show();
  canvas.style.top = `${RULER_SIZE}px`;
}
```

- [x] **Step 11: Run all tests**

Run: `cd packages/docs && npx vitest --run`
Expected: All PASS

- [x] **Step 12: Run verify:fast**

Run: `pnpm verify:fast`
Expected: PASS

- [x] **Step 13: Commit**

```bash
git add packages/docs/src/view/editor.ts
git commit -m "Integrate zoom-to-fit scaling in docs editor for mobile viewports"
```

---

### Task 6: Manual Verification & Final Commit

- [x] **Step 1: Start dev server**

Run: `pnpm dev`

- [x] **Step 2: Verify desktop behavior (unchanged)**

Open `http://localhost:5173` in a desktop browser. Open a docs document.
- Page renders at full size with rulers visible
- Clicking, selecting, typing all work normally
- Cursor auto-scroll works

- [x] **Step 3: Verify mobile viewport**

In Chrome DevTools, toggle device toolbar (Cmd+Shift+M). Select iPhone SE (375px).
- Page shrinks to fit with 16px padding on each side
- Rulers are hidden
- Scrolling is smooth
- Click/tap positions map to correct document positions
- No horizontal scrollbar

- [x] **Step 4: Verify tablet viewport**

Switch to iPad (768px).
- Page shrinks slightly (or fits at scale 1 in landscape)
- Behavior transitions correctly between scaled and unscaled

- [x] **Step 5: Verify resize transitions**

Slowly drag the browser width from 1200px down to 375px.
- Scale factor transitions smoothly
- Ruler appears/disappears at the threshold
- No rendering glitches

- [x] **Step 6: Run verify:fast one more time**

Run: `pnpm verify:fast`
Expected: PASS

- [x] **Step 7: Final commit with design doc**

```bash
git add docs/design/docs-mobile-zoom-to-fit.md docs/tasks/active/20260328-docs-mobile-zoom-to-fit-todo.md
git commit -m "Add docs mobile zoom-to-fit design doc and task plan"
```
