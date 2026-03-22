# Document Ruler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add horizontal and vertical rulers with margin drag and indent handles to the document editor.

**Architecture:** Two separate Canvas elements (horizontal + vertical) positioned sticky around the main doc canvas. A `Ruler` class owns both canvases, renders tick marks/handles, and handles drag interactions. Callbacks notify the editor of margin/indent changes.

**Tech Stack:** Canvas 2D API, TypeScript, Vitest

---

### Task 1: Add `textIndent` and `marginLeft` to BlockStyle

**Files:**
- Modify: `packages/docs/src/model/types.ts:39-44` (BlockStyle interface)
- Modify: `packages/docs/src/model/types.ts:80-85` (DEFAULT_BLOCK_STYLE)
- Modify: `packages/docs/test/model/types.test.ts`

- [x] **Step 1: Write the failing test**

Add to `packages/docs/test/model/types.test.ts`:

```typescript
it('DEFAULT_BLOCK_STYLE includes textIndent and marginLeft at 0', () => {
  expect(DEFAULT_BLOCK_STYLE.textIndent).toBe(0);
  expect(DEFAULT_BLOCK_STYLE.marginLeft).toBe(0);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter docs test -- --run`
Expected: FAIL — `textIndent` property does not exist

- [x] **Step 3: Add fields to BlockStyle and DEFAULT_BLOCK_STYLE**

In `packages/docs/src/model/types.ts`, add to `BlockStyle`:

```typescript
export interface BlockStyle {
  alignment: 'left' | 'center' | 'right';
  lineHeight: number;
  marginTop: number;
  marginBottom: number;
  textIndent: number;
  marginLeft: number;
}
```

Update `DEFAULT_BLOCK_STYLE`:

```typescript
export const DEFAULT_BLOCK_STYLE: BlockStyle = {
  alignment: 'left',
  lineHeight: 1.5,
  marginTop: 0,
  marginBottom: 8,
  textIndent: 0,
  marginLeft: 0,
};
```

- [x] **Step 4: Fix any compilation errors**

`createEmptyBlock()` spreads `DEFAULT_BLOCK_STYLE` so it will include the new fields automatically. Check that no existing code breaks by searching for `BlockStyle` usages.

- [x] **Step 5: Run tests to verify pass**

Run: `pnpm --filter docs test -- --run`
Expected: All tests PASS

- [x] **Step 6: Commit**

```bash
git add packages/docs/src/model/types.ts packages/docs/test/model/types.test.ts
git commit -m "Add textIndent and marginLeft to BlockStyle"
```

---

### Task 2: Apply textIndent and marginLeft in layout

**Files:**
- Modify: `packages/docs/src/view/layout.ts:96-156` (computeLayout) and `packages/docs/src/view/layout.ts:161-261` (layoutBlock)
- Modify: `packages/docs/test/view/incremental-layout.test.ts`

- [x] **Step 1: Write failing tests**

Add to `packages/docs/test/view/incremental-layout.test.ts`:

```typescript
it('applies marginLeft to all lines', () => {
  const block = makeBlock('Hello World');
  block.style.marginLeft = 40;
  const result = computeLayout([block], mockCtx(), 500);
  for (const line of result.layout.blocks[0].lines) {
    for (const run of line.runs) {
      expect(run.x).toBeGreaterThanOrEqual(40);
    }
  }
});

it('applies textIndent only to first line', () => {
  // Use narrow width to force wrap into 2+ lines
  const block = makeBlock('Hello World this is a longer text that should wrap');
  block.style.textIndent = 30;
  const result = computeLayout([block], mockCtx(), 200);
  const lines = result.layout.blocks[0].lines;
  expect(lines.length).toBeGreaterThan(1);
  // First line's first run should start at textIndent
  expect(lines[0].runs[0].x).toBe(30);
  // Second line's first run should start at 0
  expect(lines[1].runs[0].x).toBe(0);
});

it('applies both textIndent and marginLeft together', () => {
  const block = makeBlock('Hello World this is a longer text that should wrap');
  block.style.textIndent = 20;
  block.style.marginLeft = 40;
  const result = computeLayout([block], mockCtx(), 200);
  const lines = result.layout.blocks[0].lines;
  expect(lines.length).toBeGreaterThan(1);
  expect(lines[0].runs[0].x).toBe(60); // marginLeft + textIndent
  expect(lines[1].runs[0].x).toBe(40); // marginLeft only
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter docs test -- --run`
Expected: FAIL — runs start at x=0

- [x] **Step 3: Implement indent/margin in layoutBlock and computeLayout**

In `layoutBlock()`, accept indent params and reduce available width:

```typescript
function layoutBlock(
  block: Block,
  ctx: CanvasRenderingContext2D,
  maxWidth: number,
): LayoutLine[] {
  const { textIndent = 0, marginLeft = 0 } = block.style;
  const baseWidth = maxWidth - marginLeft;
  // ... existing segment measurement ...

  // Use (baseWidth - textIndent) for first line, baseWidth for subsequent
  let isFirstLine = true;
  let effectiveWidth = baseWidth - textIndent;
  let lineStartX = marginLeft + textIndent;

  // In the wrap loop, when starting a new line:
  // effectiveWidth = baseWidth;
  // lineStartX = marginLeft;
  // isFirstLine = false;

  // When creating runs, set run.x = lineStartX + lineWidth (accumulated)
}
```

In `computeLayout()`, after `applyAlignment()`, shift runs by `marginLeft`:
- Alignment should be computed against `baseWidth` (contentWidth - marginLeft)

- [x] **Step 4: Run tests to verify pass**

Run: `pnpm --filter docs test -- --run`
Expected: All tests PASS

- [x] **Step 5: Commit**

```bash
git add packages/docs/src/view/layout.ts packages/docs/test/view/incremental-layout.test.ts
git commit -m "Apply textIndent and marginLeft in layout engine"
```

---

### Task 3: Create ruler unit helpers

**Files:**
- Create: `packages/docs/src/view/ruler.ts`
- Create: `packages/docs/test/view/ruler.test.ts`

- [x] **Step 1: Write failing tests for unit helpers**

Create `packages/docs/test/view/ruler.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { detectUnit, getGridConfig, snapToGrid } from '../../src/view/ruler.js';

describe('ruler units', () => {
  it('detectUnit returns inch for en-US', () => {
    expect(detectUnit('en-US')).toBe('inch');
  });

  it('detectUnit returns cm for ko-KR', () => {
    expect(detectUnit('ko-KR')).toBe('cm');
  });

  it('detectUnit returns cm for fr-FR', () => {
    expect(detectUnit('fr-FR')).toBe('cm');
  });

  it('detectUnit defaults to inch for undefined', () => {
    expect(detectUnit(undefined)).toBe('inch');
  });

  it('getGridConfig returns correct inch config', () => {
    const config = getGridConfig('inch');
    expect(config.majorStepPx).toBe(96);
    expect(config.subdivisions).toBe(8);
    expect(config.minorStepPx).toBe(12);
  });

  it('getGridConfig returns correct cm config', () => {
    const config = getGridConfig('cm');
    expect(config.majorStepPx).toBeCloseTo(37.795, 2);
    expect(config.subdivisions).toBe(10);
  });

  it('snapToGrid snaps to nearest minor step for inch', () => {
    const grid = getGridConfig('inch');
    expect(snapToGrid(13, grid.minorStepPx)).toBe(12);
    expect(snapToGrid(7, grid.minorStepPx)).toBe(12);
    expect(snapToGrid(0, grid.minorStepPx)).toBe(0);
    expect(snapToGrid(96, grid.minorStepPx)).toBe(96);
  });

  it('snapToGrid snaps to nearest minor step for cm', () => {
    const grid = getGridConfig('cm');
    expect(snapToGrid(4, grid.minorStepPx)).toBeCloseTo(grid.minorStepPx, 1);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter docs test -- --run`
Expected: FAIL — module not found

- [x] **Step 3: Implement unit helpers**

Create `packages/docs/src/view/ruler.ts` with the unit detection and grid config:

```typescript
export type RulerUnit = 'inch' | 'cm';

interface GridConfig {
  majorStepPx: number;
  subdivisions: number;
  minorStepPx: number;
}

const INCH_LOCALES = ['en-US', 'en-GB', 'my'];

export function detectUnit(locale: string | undefined): RulerUnit {
  if (!locale) return 'inch';
  if (INCH_LOCALES.some((l) => locale.startsWith(l.split('-')[0]) && locale === l)) {
    return 'inch';
  }
  if (locale.startsWith('en')) return 'inch';
  return 'cm';
}

export function getGridConfig(unit: RulerUnit): GridConfig {
  if (unit === 'inch') {
    return { majorStepPx: 96, subdivisions: 8, minorStepPx: 12 };
  }
  const cmPx = 96 / 2.54;
  return { majorStepPx: cmPx, subdivisions: 10, minorStepPx: cmPx / 10 };
}
```

- [x] **Step 4: Run tests to verify pass**

Run: `pnpm --filter docs test -- --run`
Expected: All tests PASS

- [x] **Step 5: Commit**

```bash
git add packages/docs/src/view/ruler.ts packages/docs/test/view/ruler.test.ts
git commit -m "Add ruler unit detection and grid config helpers"
```

---

### Task 4: Implement horizontal ruler rendering

**Files:**
- Modify: `packages/docs/src/view/ruler.ts`

- [x] **Step 1: Write failing test for Ruler class construction**

Add to `packages/docs/test/view/ruler.test.ts`:

```typescript
import { Ruler } from '../../src/view/ruler.js';

function mockCanvas(): HTMLCanvasElement {
  const canvas = {
    width: 0,
    height: 0,
    style: { width: '', height: '', cursor: '' },
    getContext: () => ({
      scale: () => {},
      fillRect: () => {},
      fillText: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => {},
      clearRect: () => {},
      save: () => {},
      restore: () => {},
      font: '',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      textAlign: 'left',
      textBaseline: 'top',
      setLineDash: () => {},
    }),
    addEventListener: () => {},
    removeEventListener: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 20 }),
  } as unknown as HTMLCanvasElement;
  return canvas;
}

describe('Ruler', () => {
  it('creates horizontal and vertical canvases', () => {
    const container = {
      insertBefore: () => {},
      firstChild: null,
      appendChild: () => {},
      style: {},
    } as unknown as HTMLElement;
    const docCanvas = mockCanvas();
    const ruler = new Ruler(container, docCanvas);
    expect(ruler).toBeDefined();
    ruler.dispose();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter docs test -- --run`
Expected: FAIL — Ruler class not exported

- [x] **Step 3: Implement Ruler class with DOM setup and horizontal rendering**

Add to `packages/docs/src/view/ruler.ts`:

```typescript
import type { PaginatedLayout, LayoutPage } from './pagination.js';
import { getPageXOffset, getPageYOffset } from './pagination.js';
import type { BlockStyle, PageMargins } from '../model/types.js';

const RULER_SIZE = 20; // px height for h-ruler, width for v-ruler
const TICK_MAJOR = 10;
const TICK_HALF = 7;
const TICK_MINOR = 4;
const MARGIN_BG = '#e8e8e8';
const CONTENT_BG = '#ffffff';
const TICK_COLOR = '#666666';
const LABEL_FONT = '9px Arial';
const HIT_ZONE = 4; // px tolerance for drag hit detection

export class Ruler {
  private hCanvas: HTMLCanvasElement;
  private vCanvas: HTMLCanvasElement;
  private corner: HTMLDivElement;
  private hCtx: CanvasRenderingContext2D;
  private vCtx: CanvasRenderingContext2D;
  private unit: RulerUnit;
  private grid: GridConfig;

  // Drag state
  private dragging: 'left-margin' | 'right-margin' | 'top-margin' | 'bottom-margin'
    | 'text-indent' | 'margin-left' | null = null;
  private dragStartPx = 0;
  private dragCurrentPx = 0;

  // Callbacks
  private marginChangeCb?: (margins: PageMargins) => void;
  private indentChangeCb?: (style: Partial<BlockStyle>) => void;

  // Cached layout info for hit testing
  private cachedPageX = 0;
  private cachedMargins: PageMargins = { top: 0, bottom: 0, left: 0, right: 0 };
  private cachedPageWidth = 0;
  private cachedPageHeight = 0;
  private cachedBlockStyle: BlockStyle | null = null;
  private cachedVContentTop = 0;
  private cachedVContentBottom = 0;

  // Event handler references for cleanup
  private boundHandlers: Array<[EventTarget, string, EventListener]> = [];

  constructor(container: HTMLElement, docCanvas: HTMLCanvasElement) {
    // Create corner
    this.corner = document.createElement('div');
    this.corner.style.cssText =
      `position:sticky;top:0;left:0;width:${RULER_SIZE}px;height:${RULER_SIZE}px;`
      + `z-index:3;background:${MARGIN_BG};flex-shrink:0;`;

    // Create h-ruler canvas
    this.hCanvas = document.createElement('canvas');
    this.hCanvas.style.cssText =
      `display:block;position:sticky;top:0;z-index:2;height:${RULER_SIZE}px;`;

    // Create v-ruler canvas
    this.vCanvas = document.createElement('canvas');
    this.vCanvas.style.cssText =
      `display:block;position:sticky;left:0;z-index:1;width:${RULER_SIZE}px;`;

    this.hCtx = this.hCanvas.getContext('2d')!;
    this.vCtx = this.vCanvas.getContext('2d')!;

    // Insert into container before doc canvas
    container.insertBefore(this.corner, docCanvas);
    container.insertBefore(this.hCanvas, docCanvas);
    container.insertBefore(this.vCanvas, docCanvas);

    // Shift doc canvas down to make room for horizontal ruler
    docCanvas.style.top = `${RULER_SIZE}px`;

    // Detect unit
    this.unit = detectUnit(navigator.language);
    this.grid = getGridConfig(this.unit);

    // Wire mouse events
    this.addMouseHandlers();
  }

  // ... rendering and drag methods (see subsequent steps)
}
```

- [x] **Step 4: Implement `renderHorizontal()` method**

Draws margin background, content area, tick marks, labels, and indent handles:

```typescript
private renderHorizontal(
  pageX: number,
  pageWidth: number,
  margins: PageMargins,
  blockStyle: BlockStyle | null,
): void {
  const dpr = window.devicePixelRatio || 1;
  const w = this.hCanvas.width / dpr;

  this.hCtx.save();
  // Margin background
  this.hCtx.fillStyle = MARGIN_BG;
  this.hCtx.fillRect(0, 0, w, RULER_SIZE);

  // Content area background
  const contentLeft = pageX + margins.left;
  const contentRight = pageX + pageWidth - margins.right;
  this.hCtx.fillStyle = CONTENT_BG;
  this.hCtx.fillRect(contentLeft, 0, contentRight - contentLeft, RULER_SIZE);

  // Tick marks — iterate across page width
  this.hCtx.strokeStyle = TICK_COLOR;
  this.hCtx.fillStyle = TICK_COLOR;
  this.hCtx.font = LABEL_FONT;
  this.hCtx.textAlign = 'center';
  this.hCtx.textBaseline = 'top';
  this.hCtx.lineWidth = 1;

  const { majorStepPx, subdivisions, minorStepPx } = this.grid;
  const startPx = pageX;
  const endPx = pageX + pageWidth;

  // Draw from left edge of page across the full page width
  // Numbers count from 0 at left margin
  for (let px = startPx; px <= endPx; px += minorStepPx) {
    const relPx = px - startPx;
    const tickIndex = Math.round(relPx / minorStepPx);
    const isMajor = tickIndex % subdivisions === 0;
    const isHalf = tickIndex % (subdivisions / 2) === 0;
    const tickH = isMajor ? TICK_MAJOR : isHalf ? TICK_HALF : TICK_MINOR;
    const x = Math.round(px) + 0.5; // crisp lines

    this.hCtx.beginPath();
    this.hCtx.moveTo(x, RULER_SIZE);
    this.hCtx.lineTo(x, RULER_SIZE - tickH);
    this.hCtx.stroke();

    if (isMajor && tickIndex > 0) {
      const label = String(tickIndex / subdivisions);
      this.hCtx.fillText(label, x, 2);
    }
  }

  // Indent handles (if blockStyle available)
  if (blockStyle) {
    const indentX = contentLeft + (blockStyle.textIndent ?? 0);
    const marginLeftX = contentLeft + (blockStyle.marginLeft ?? 0);
    this.drawDownTriangle(this.hCtx, indentX, 0, 5);    // ▽ first-line indent
    this.drawUpTriangle(this.hCtx, marginLeftX, RULER_SIZE, 5); // △ left indent
  }

  this.hCtx.restore();
}
```

- [x] **Step 5: Run tests to verify pass**

Run: `pnpm --filter docs test -- --run`
Expected: All tests PASS

- [x] **Step 6: Commit**

```bash
git add packages/docs/src/view/ruler.ts packages/docs/test/view/ruler.test.ts
git commit -m "Implement Ruler class with horizontal rendering"
```

---

### Task 5: Implement vertical ruler rendering

**Files:**
- Modify: `packages/docs/src/view/ruler.ts`

- [x] **Step 1: Implement `renderVertical()` method**

Same pattern as horizontal but rotated. Renders for the focused page:

```typescript
private renderVertical(
  scrollY: number,
  viewportHeight: number,
  paginatedLayout: PaginatedLayout,
): void {
  const dpr = window.devicePixelRatio || 1;
  const h = this.vCanvas.height / dpr;

  this.vCtx.save();
  this.vCtx.fillStyle = MARGIN_BG;
  this.vCtx.fillRect(0, 0, RULER_SIZE, h);

  if (paginatedLayout.pages.length === 0) {
    this.vCtx.restore();
    return;
  }

  // Find focused page (page most visible in viewport)
  const focusedPage = this.findFocusedPage(scrollY, viewportHeight, paginatedLayout);
  const pageY = getPageYOffset(paginatedLayout, focusedPage.pageIndex);
  const margins = paginatedLayout.pageSetup.margins;

  // Map page coordinates to viewport-relative coordinates
  const pageTopInViewport = pageY - scrollY;
  const contentTop = pageTopInViewport + margins.top;
  const contentBottom = pageTopInViewport + focusedPage.height - margins.bottom;

  // Cache for vertical hit testing
  this.cachedVContentTop = contentTop;
  this.cachedVContentBottom = contentBottom;

  // Content area background
  this.vCtx.fillStyle = CONTENT_BG;
  this.vCtx.fillRect(0, contentTop, RULER_SIZE, contentBottom - contentTop);

  // Tick marks along page height
  const { majorStepPx, subdivisions, minorStepPx } = this.grid;
  const startPx = pageTopInViewport;
  const endPx = pageTopInViewport + focusedPage.height;

  this.vCtx.strokeStyle = TICK_COLOR;
  this.vCtx.fillStyle = TICK_COLOR;
  this.vCtx.font = LABEL_FONT;
  this.vCtx.textAlign = 'center';
  this.vCtx.textBaseline = 'middle';
  this.vCtx.lineWidth = 1;

  for (let px = startPx; px <= endPx; px += minorStepPx) {
    const relPx = px - startPx;
    const tickIndex = Math.round(relPx / minorStepPx);
    const isMajor = tickIndex % subdivisions === 0;
    const isHalf = tickIndex % (subdivisions / 2) === 0;
    const tickW = isMajor ? TICK_MAJOR : isHalf ? TICK_HALF : TICK_MINOR;
    const y = Math.round(px) + 0.5;

    this.vCtx.beginPath();
    this.vCtx.moveTo(RULER_SIZE, y);
    this.vCtx.lineTo(RULER_SIZE - tickW, y);
    this.vCtx.stroke();

    if (isMajor && tickIndex > 0) {
      this.vCtx.save();
      this.vCtx.translate(6, y);
      this.vCtx.rotate(-Math.PI / 2);
      this.vCtx.fillText(String(tickIndex / subdivisions), 0, 0);
      this.vCtx.restore();
    }
  }

  this.vCtx.restore();
}
```

- [x] **Step 2: Implement `findFocusedPage()` helper**

```typescript
private findFocusedPage(
  scrollY: number,
  viewportHeight: number,
  paginatedLayout: PaginatedLayout,
): LayoutPage {
  const center = scrollY + viewportHeight / 2;
  let closest = paginatedLayout.pages[0];
  let minDist = Infinity;
  for (const page of paginatedLayout.pages) {
    const pageY = getPageYOffset(paginatedLayout, page.pageIndex);
    const pageMid = pageY + page.height / 2;
    const dist = Math.abs(pageMid - center);
    if (dist < minDist) {
      minDist = dist;
      closest = page;
    }
  }
  return closest;
}
```

- [x] **Step 3: Implement the public `render()` method**

```typescript
render(
  paginatedLayout: PaginatedLayout,
  scrollY: number,
  canvasWidth: number,
  viewportHeight: number,
  cursorBlockStyle: BlockStyle | null,
): void {
  if (paginatedLayout.pages.length === 0) return;

  const page = paginatedLayout.pages[0];
  const pageX = getPageXOffset(paginatedLayout, canvasWidth);
  const margins = paginatedLayout.pageSetup.margins;

  // Cache for hit testing
  this.cachedPageX = pageX;
  this.cachedMargins = margins;
  this.cachedPageWidth = page.width;
  this.cachedPageHeight = page.height;
  this.cachedBlockStyle = cursorBlockStyle;

  // Resize canvases
  this.resizeH(canvasWidth);
  this.resizeV(viewportHeight);

  this.renderHorizontal(pageX, page.width, margins, cursorBlockStyle);
  this.renderVertical(scrollY, viewportHeight, paginatedLayout);
}
```

- [x] **Step 4: Implement resize helpers**

```typescript
private resizeH(width: number): void {
  const dpr = window.devicePixelRatio || 1;
  this.hCanvas.width = width * dpr;
  this.hCanvas.height = RULER_SIZE * dpr;
  this.hCanvas.style.width = `${width}px`;
  this.hCanvas.style.height = `${RULER_SIZE}px`;
  this.hCtx.scale(dpr, dpr);
}

private resizeV(height: number): void {
  const dpr = window.devicePixelRatio || 1;
  this.vCanvas.width = RULER_SIZE * dpr;
  this.vCanvas.height = height * dpr;
  this.vCanvas.style.width = `${RULER_SIZE}px`;
  this.vCanvas.style.height = `${height}px`;
  this.vCtx.scale(dpr, dpr);
}
```

- [x] **Step 5: Run tests to verify pass**

Run: `pnpm --filter docs test -- --run`
Expected: All tests PASS

- [x] **Step 6: Commit**

```bash
git add packages/docs/src/view/ruler.ts
git commit -m "Add vertical ruler rendering and public render method"
```

---

### Task 6: Implement margin drag interaction

**Files:**
- Modify: `packages/docs/src/view/ruler.ts`

- [x] **Step 1: Implement hit detection helpers**

```typescript
private getHitTarget(
  x: number, y: number, source: 'h' | 'v',
): typeof this.dragging {
  if (source === 'h') {
    const leftMarginX = this.cachedPageX + this.cachedMargins.left;
    const rightMarginX = this.cachedPageX + this.cachedPageWidth - this.cachedMargins.right;

    // Check indent handles first (higher priority)
    if (this.cachedBlockStyle) {
      const indentX = leftMarginX + (this.cachedBlockStyle.textIndent ?? 0);
      const marginLeftX = leftMarginX + (this.cachedBlockStyle.marginLeft ?? 0);
      if (Math.abs(x - indentX) < HIT_ZONE && y < RULER_SIZE / 2) return 'text-indent';
      if (Math.abs(x - marginLeftX) < HIT_ZONE && y >= RULER_SIZE / 2) return 'margin-left';
    }

    if (Math.abs(x - leftMarginX) < HIT_ZONE) return 'left-margin';
    if (Math.abs(x - rightMarginX) < HIT_ZONE) return 'right-margin';
  } else {
    const contentTop = this.cachedVContentTop;
    const contentBottom = this.cachedVContentBottom;
    if (Math.abs(y - contentTop) < HIT_ZONE) return 'top-margin';
    if (Math.abs(y - contentBottom) < HIT_ZONE) return 'bottom-margin';
  }
  return null;
}
```

- [x] **Step 2: Implement mouse event handlers**

```typescript
private addMouseHandlers(): void {
  const onHMouseDown = (e: MouseEvent) => {
    const rect = this.hCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const target = this.getHitTarget(x, y, 'h');
    if (target) {
      this.dragging = target;
      this.dragStartPx = x;
      this.dragCurrentPx = x;
      e.preventDefault();
    }
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!this.dragging) {
      // Update cursor on hover
      const rect = this.hCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const target = this.getHitTarget(x, y, 'h');
      this.hCanvas.style.cursor = target
        ? (target.includes('margin') ? 'col-resize' : 'pointer')
        : 'default';
      return;
    }
    if (this.dragging === 'top-margin' || this.dragging === 'bottom-margin') {
      const rect = this.vCanvas.getBoundingClientRect();
      this.dragCurrentPx = e.clientY - rect.top;
    } else {
      const rect = this.hCanvas.getBoundingClientRect();
      this.dragCurrentPx = e.clientX - rect.left;
    }
  };

  const onMouseUp = () => {
    if (!this.dragging) return;
    this.applyDrag();
    this.dragging = null;
  };

  const onVMouseDown = (e: MouseEvent) => {
    const rect = this.vCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const target = this.getHitTarget(x, y, 'v');
    if (target) {
      this.dragging = target;
      this.dragStartPx = y;
      this.dragCurrentPx = y;
      e.preventDefault();
    }
  };

  const onVMouseMove = (e: MouseEvent) => {
    if (this.dragging) return; // handled by document mousemove
    const rect = this.vCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const target = this.getHitTarget(x, y, 'v');
    this.vCanvas.style.cursor = target ? 'row-resize' : 'default';
  };

  this.bindEvent(this.hCanvas, 'mousedown', onHMouseDown as EventListener);
  this.bindEvent(this.vCanvas, 'mousedown', onVMouseDown as EventListener);
  this.bindEvent(this.vCanvas, 'mousemove', onVMouseMove as EventListener);
  this.bindEvent(document, 'mousemove', onMouseMove as EventListener);
  this.bindEvent(document, 'mouseup', onMouseUp as EventListener);
}

private bindEvent(target: EventTarget, event: string, handler: EventListener): void {
  target.addEventListener(event, handler);
  this.boundHandlers.push([target, event, handler]);
}
```

- [x] **Step 3: Implement snap and apply helpers**

```typescript
// In Ruler class, calls the exported helper:
// this.snapToGrid = (px) => snapToGrid(px, this.grid.minorStepPx);
```

Also add exported `snapToGrid` function at module level:

```typescript
export function snapToGrid(px: number, step: number): number {
  return Math.round(px / step) * step;
}

private applyDrag(): void {
  const delta = this.snapToGrid(this.dragCurrentPx - this.dragStartPx);
  if (delta === 0) return;

  if (this.dragging === 'left-margin' || this.dragging === 'right-margin'
      || this.dragging === 'top-margin' || this.dragging === 'bottom-margin') {
    const margins = { ...this.cachedMargins };
    switch (this.dragging) {
      case 'left-margin': margins.left += delta; break;
      case 'right-margin': margins.right -= delta; break;
      case 'top-margin': margins.top += delta; break;
      case 'bottom-margin': margins.bottom -= delta; break;
    }
    // Clamp to reasonable range
    margins.left = Math.max(0, margins.left);
    margins.right = Math.max(0, margins.right);
    margins.top = Math.max(0, margins.top);
    margins.bottom = Math.max(0, margins.bottom);
    this.marginChangeCb?.(margins);
  } else if (this.dragging === 'text-indent') {
    const newIndent = Math.max(0, (this.cachedBlockStyle?.textIndent ?? 0) + delta);
    this.indentChangeCb?.({ textIndent: this.snapToGrid(newIndent) });
  } else if (this.dragging === 'margin-left') {
    const newMarginLeft = Math.max(0, (this.cachedBlockStyle?.marginLeft ?? 0) + delta);
    this.indentChangeCb?.({ marginLeft: this.snapToGrid(newMarginLeft) });
  }
}
```

- [x] **Step 4: Implement callback registration and dispose**

```typescript
onMarginChange(cb: (margins: PageMargins) => void): void {
  this.marginChangeCb = cb;
}

onIndentChange(cb: (style: Partial<BlockStyle>) => void): void {
  this.indentChangeCb = cb;
}

dispose(): void {
  for (const [target, event, handler] of this.boundHandlers) {
    target.removeEventListener(event, handler);
  }
  this.boundHandlers = [];
  this.hCanvas.remove();
  this.vCanvas.remove();
  this.corner.remove();
}
```

- [x] **Step 5: Add drag guideline callback**

The Ruler needs to notify the editor to draw a dashed guideline on the main canvas during drag. Add a callback and call it during mousemove when dragging:

```typescript
private dragGuidelineCb?: (position: { x?: number; y?: number } | null) => void;

onDragGuideline(cb: (position: { x?: number; y?: number } | null) => void): void {
  this.dragGuidelineCb = cb;
}
```

In the `onMouseMove` handler, when `this.dragging` is active:

```typescript
if (this.dragging === 'left-margin' || this.dragging === 'right-margin'
    || this.dragging === 'text-indent' || this.dragging === 'margin-left') {
  this.dragGuidelineCb?.({ x: this.dragCurrentPx });
} else if (this.dragging === 'top-margin' || this.dragging === 'bottom-margin') {
  this.dragGuidelineCb?.({ y: this.dragCurrentPx });
}
```

In `onMouseUp`, clear the guideline:

```typescript
this.dragGuidelineCb?.(null);
```

- [x] **Step 6: Add triangle drawing helpers**

```typescript
private drawDownTriangle(
  ctx: CanvasRenderingContext2D, x: number, y: number, size: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x - size, y);
  ctx.lineTo(x + size, y);
  ctx.lineTo(x, y + size);
  ctx.closePath();
  ctx.fillStyle = '#333';
  ctx.fill();
}

private drawUpTriangle(
  ctx: CanvasRenderingContext2D, x: number, y: number, size: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x - size, y);
  ctx.lineTo(x + size, y);
  ctx.lineTo(x, y - size);
  ctx.closePath();
  ctx.fillStyle = '#333';
  ctx.fill();
}
```

- [x] **Step 6: Run tests to verify pass**

Run: `pnpm --filter docs test -- --run`
Expected: All tests PASS

- [x] **Step 7: Commit**

```bash
git add packages/docs/src/view/ruler.ts
git commit -m "Add margin drag and indent handle interactions"
```

---

### Task 7: Wire Ruler into editor

**Files:**
- Modify: `packages/docs/src/view/editor.ts`
- Modify: `packages/docs/src/index.ts`

- [x] **Step 1: Import Ruler and create instance in `initialize()`**

In `editor.ts`, after creating the doc canvas:

```typescript
import { Ruler } from './ruler.js';

// After: const docCanvas = new DocCanvas(canvas);
const ruler = new Ruler(container, canvas);

ruler.onMarginChange((margins) => {
  docStore.snapshot();
  const setup = resolvePageSetup(doc.document.pageSetup);
  setup.margins = margins;
  docStore.setPageSetup(setup);
  doc.document.pageSetup = setup;
  layoutCache = undefined;
  render();
});

ruler.onIndentChange((style) => {
  docStore.snapshot();
  doc.applyBlockStyle(cursor.position.blockId, style);
  markDirty(cursor.position.blockId);
  render();
});
```

- [x] **Step 2: Wire drag guideline rendering**

Add a guideline state variable and wire the callback:

```typescript
let dragGuideline: { x?: number; y?: number } | null = null;

ruler.onDragGuideline((pos) => {
  dragGuideline = pos;
  renderPaintOnly();
});
```

In `DocCanvas.render()` or in `paint()`, after `docCanvas.render(...)`, draw the guideline if active:

```typescript
if (dragGuideline) {
  const ctx = docCanvas.getContext();
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = '#4285F4';
  ctx.lineWidth = 1;
  if (dragGuideline.x != null) {
    ctx.beginPath();
    ctx.moveTo(dragGuideline.x, 0);
    ctx.lineTo(dragGuideline.x, height);
    ctx.stroke();
  }
  if (dragGuideline.y != null) {
    ctx.beginPath();
    ctx.moveTo(0, dragGuideline.y);
    ctx.lineTo(canvasWidth, dragGuideline.y);
    ctx.stroke();
  }
  ctx.restore();
}
```

- [x] **Step 3: Call `ruler.render()` in `paint()`**

In the `paint()` function, after `docCanvas.render(...)`:

```typescript
const cursorBlock = doc.document.blocks.find(
  b => b.id === cursor.position.blockId
);
ruler.render(
  paginatedLayout,
  scrollY,
  canvasWidth,
  height,
  cursorBlock?.style ?? null,
);
```

- [x] **Step 4: Clean up ruler in dispose**

In the returned `dispose()`:

```typescript
dispose: () => {
  cursor.dispose();
  textEditor.dispose();
  ruler.dispose();
  container.removeEventListener('scroll', handleScroll);
  resizeObserver.disconnect();
  canvas.remove();
},
```

- [x] **Step 5: Export Ruler from index.ts**

Add to `packages/docs/src/index.ts`:

```typescript
export { Ruler } from './view/ruler.js';
```

- [x] **Step 6: Run full test suite**

Run: `pnpm --filter docs test -- --run`
Expected: All tests PASS

- [x] **Step 7: Run verify:fast**

Run: `pnpm verify:fast`
Expected: All checks PASS

- [x] **Step 8: Commit**

```bash
git add packages/docs/src/view/editor.ts packages/docs/src/view/ruler.ts packages/docs/src/index.ts
git commit -m "Wire Ruler into document editor with margin and indent callbacks"
```

---

### Task 8: Manual verification and polish

- [x] **Step 1: Start dev server and verify visually**

Run: `pnpm dev`

Verify:
- Horizontal ruler appears above the page with tick marks
- Vertical ruler appears to the left of the page
- Margin areas are gray, content area is white
- Tick marks align with the page edges
- Numbers are displayed at major ticks

- [x] **Step 2: Test margin drag**

- Hover over margin boundaries — cursor should change to resize
- Drag left margin boundary — page content area should resize
- Drag right margin boundary — same behavior
- Text should re-wrap after margin change

- [x] **Step 3: Test indent handles**

- Place cursor in a paragraph
- Drag first-line indent handle (▽) — first line should indent
- Drag left indent handle (△) — all lines should indent
- Type text to verify wrapping respects indentation

- [x] **Step 4: Test locale detection**

- Open browser DevTools, override `navigator.language` or check that
  the correct unit is displayed for your locale

- [x] **Step 5: Fix any visual issues found**

Address spacing, alignment, or interaction bugs discovered during testing.

- [x] **Step 6: Final commit**

```bash
git add -u
git commit -m "Polish ruler rendering and interactions"
```
