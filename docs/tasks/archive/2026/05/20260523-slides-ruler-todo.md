# Slides Ruler — implementation plan

> **Status:** ✅ Shipped to `main` in PR #285 (`eb79963e`). Checkboxes
> below marked complete retroactively during archival (2026-05-24);
> the merged PR is the source of truth.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Design doc:** [`docs/design/slides/slides-ruler.md`](../../design/slides/slides-ruler.md)

**Goal:** Bring horizontal and vertical rulers to the slides editor
with corner origin + inch/cm display, and add presentation-wide
draggable guides that participate in the existing snap engine.

**Architecture:** Extract a low-level `tick-renderer` + `unit` module
from `packages/docs/src/view/ruler.ts` so docs and slides share the
same tick/label math. Add a new `SlidesRuler` controller in
`packages/slides/src/view/editor/ruler/` that draws H/V canvases on
top of the slide stage and emits drag-out events for guides. Store
guides on `SlidesDocument.guides` (presentation-wide); the Yorkie
adapter lazy-initializes the new field. Guides become a third snap
candidate kind (`'guide'`) ranking between `slide-center` and `edge`.

**Tech Stack:** TypeScript, Vitest + jsdom, Canvas 2D, Yorkie 0.6,
existing `MemSlidesStore` / `YorkieSlidesStore`.

**Phasing:** Six commits / PRs, each independently demoable. Earlier
phases land mechanical refactors and structural scaffolding; later
phases add interactions and polish.

| Phase | Scope | PR |
| --- | --- | --- |
| P1 | Extract shared tick/unit core (docs only; no behavior change) | 1 |
| P2 | Slides ruler display (no guide code) | 2 |
| P3 | Guide data model + Yorkie schema + passive render | 3 |
| P4 | Guide interactions (drag-out, move, delete) | 4 |
| P5 | Snap integration | 5 |
| P6 | Read-only mounts + presentation/PDF exclusion | 6 |

---

## Chunk 1: Phase 1 — extract shared tick / unit core

Move the tick rendering and locale-aware unit helpers into a
sub-directory so they can be imported from `@wafflebase/slides`
without leaking docs-specific concepts (pages, margins, indent).
**No docs behavior change.** Existing imports `from '../view/ruler'`
keep working because the new `ruler/index.ts` re-exports the public
surface.

### Task 1.1: Restructure docs ruler files

**Files:**
- Create: `packages/docs/src/view/ruler/index.ts` (formerly `ruler.ts`)
- Create: `packages/docs/src/view/ruler/unit.ts`
- Create: `packages/docs/src/view/ruler/tick-renderer.ts`
- Delete: `packages/docs/src/view/ruler.ts` (after Git history-preserving move)

- [x] **Step 1: Move `ruler.ts` to `ruler/index.ts`**

```bash
git mv packages/docs/src/view/ruler.ts packages/docs/src/view/ruler/index.ts
```

Run `pnpm verify:fast` to confirm imports still resolve.

- [x] **Step 2: Extract `unit.ts`**

Cut the unit type, locale detection, and grid config from `index.ts`
into a sibling module. Keep `getGridConfig` exporting the same shape
but accept an optional `pxPerInch` override (default 96) so slides
can pass 144:

```ts
// packages/docs/src/view/ruler/unit.ts
export type RulerUnit = 'inch' | 'cm';

export interface GridConfig {
  majorStepPx: number;
  subdivisions: number;
  minorStepPx: number;
}

const INCH_LOCALES = ['en-US', 'en-GB', 'my'];

export function detectUnit(locale: string | undefined): RulerUnit {
  if (!locale) return 'inch';
  if (INCH_LOCALES.includes(locale)) return 'inch';
  if (locale.startsWith('en')) return 'inch';
  return 'cm';
}

export function getGridConfig(unit: RulerUnit, pxPerInch = 96): GridConfig {
  if (unit === 'inch') {
    return { majorStepPx: pxPerInch, subdivisions: 8, minorStepPx: pxPerInch / 8 };
  }
  const cmPx = pxPerInch / 2.54;
  return { majorStepPx: cmPx, subdivisions: 10, minorStepPx: cmPx / 10 };
}

export function snapToGrid(px: number, step: number): number {
  return Math.round(px / step) * step;
}
```

In `index.ts`, replace inline definitions with:

```ts
import { detectUnit, getGridConfig, snapToGrid, type RulerUnit, type GridConfig } from './unit';
export { detectUnit, getGridConfig, snapToGrid };
export type { RulerUnit, GridConfig };
```

- [x] **Step 3: Extract `tick-renderer.ts`**

Move the tick-drawing helper(s) used by `renderHorizontal` /
`renderVertical` in the Ruler class into a standalone function that
takes the canvas context, current viewport, and `GridConfig`. The
function should not reference pages or margins — those stay in
`index.ts`. Public API:

```ts
// packages/docs/src/view/ruler/tick-renderer.ts
import type { GridConfig, RulerUnit } from './unit';

export interface TickRenderOpts {
  ctx: CanvasRenderingContext2D;
  axis: 'h' | 'v';
  /** Visible length in CSS pixels (canvas client size on the active axis). */
  length: number;
  /** Pixel offset of slide/page origin within the canvas. */
  origin: number;
  /** Multiplier from "one unit" to CSS pixels (= pxPerUnit × zoom). */
  scale: number;
  grid: GridConfig;
  unit: RulerUnit;
  /** Optional density override; defaults to full density. */
  density?: 'full' | 'half-only' | 'major' | 'major-thinned';
  /** Optional color overrides; default to theme. */
  marginBg?: string;
  contentBg?: string;
  tickColor?: string;
  labelFont?: string;
}

export function drawTicks(opts: TickRenderOpts): void { /* ... */ }
```

The `density` parameter is set by slides (Phase 2) based on zoom; docs
calls without it (defaults to `'full'`).

- [x] **Step 4: Update docs `Ruler` class to use `drawTicks`**

In `packages/docs/src/view/ruler/index.ts`, replace the inline tick
drawing in `renderHorizontal` / `renderVertical` with a `drawTicks`
call. Pass the existing 96-dpi grid (no behavior change for docs).

- [x] **Step 5: Run docs ruler unit tests**

```bash
pnpm --filter @wafflebase/docs test ruler
```

Expected: all existing tests pass. If any fail, the extraction broke
something — fix before continuing.

- [x] **Step 6: Visual smoke (manual)**

```bash
pnpm dev
```

Open any docs document, confirm the ruler looks identical to `main`
(tick positions, labels, indent handles, margin drag).

- [x] **Step 7: Commit**

```bash
git add packages/docs/src/view/ruler/
git commit -m "$(cat <<'EOF'
Extract docs ruler tick + unit helpers into a shared module

Move tick rendering and locale-aware unit math out of the monolithic
Ruler class so the slides package can reuse them. Public docs API
(imports from `../view/ruler`) is unchanged — the directory now
exports the same surface via `index.ts`.

Preparation for the slides ruler (see
docs/design/slides/slides-ruler.md). No behavior change for docs.
EOF
)"
```

---

## Chunk 2: Phase 2 — Slides ruler display

Add the H/V ruler canvases and the corner element to the slides
editor. Wire them to the editor's viewport (scroll + zoom). No
interactions yet — pure display.

### Task 2.1: SlidesRuler controller

**Files:**
- Create: `packages/slides/src/view/editor/ruler/ruler.ts`
- Create: `packages/slides/src/view/editor/ruler/index.ts` (barrel)
- Create: `packages/slides/test/view/editor/ruler/ruler.test.ts`
- Modify: `packages/slides/src/index.ts` (export `SlidesRuler`)

**Constants and imports:**

Before writing the controller, expose the ruler primitives from the
docs package barrel:

```ts
// packages/docs/src/index.ts (append)
export {
  detectUnit,
  getGridConfig,
  drawTicks,
  snapToGrid,
  type RulerUnit,
  type GridConfig,
} from './view/ruler';
```

Then import from the package root in the slides controller:

```ts
// packages/slides/src/view/editor/ruler/ruler.ts
import {
  detectUnit,
  getGridConfig,
  drawTicks,
  type RulerUnit,
  type GridConfig,
} from '@wafflebase/docs';

export const RULER_SIZE = 20;          // px
export const SLIDES_PX_PER_INCH = 144; // 1920 / 13.333
```

Verify the new exports resolve with `pnpm verify:fast` before
proceeding.

- [x] **Step 1: Write failing unit test**

```ts
// packages/slides/test/view/editor/ruler/ruler.test.ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { SlidesRuler, RULER_SIZE } from '../../../../src/view/editor/ruler/ruler';

describe('SlidesRuler', () => {
  let container: HTMLElement;
  let hCanvas: HTMLCanvasElement;
  let vCanvas: HTMLCanvasElement;
  let corner: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    hCanvas = document.createElement('canvas');
    vCanvas = document.createElement('canvas');
    corner = document.createElement('div');
    container.append(corner, hCanvas, vCanvas);
    document.body.appendChild(container);
  });

  it('renders without throwing at zoom 1', () => {
    const ruler = new SlidesRuler({ container, hCanvas, vCanvas, corner });
    expect(() =>
      ruler.render({ scrollX: 0, scrollY: 0, zoom: 1, slideW: 1920, slideH: 1080 }),
    ).not.toThrow();
  });

  it('exposes RULER_SIZE = 20', () => {
    expect(RULER_SIZE).toBe(20);
  });
});
```

Run: `pnpm --filter @wafflebase/slides test ruler`
Expected: FAIL ("Cannot find module './ruler'").

- [x] **Step 2: Implement `SlidesRuler` skeleton**

```ts
// packages/slides/src/view/editor/ruler/ruler.ts
import {
  detectUnit,
  getGridConfig,
  drawTicks,
  type RulerUnit,
  type GridConfig,
} from '@wafflebase/docs';

export const RULER_SIZE = 20;
export const SLIDES_PX_PER_INCH = 144;

export interface SlidesRulerViewport {
  scrollX: number;
  scrollY: number;
  zoom: number;
  slideW: number;
  slideH: number;
}

type Density = 'full' | 'half-only' | 'major' | 'major-thinned';

export class SlidesRuler {
  private hCtx: CanvasRenderingContext2D | null;
  private vCtx: CanvasRenderingContext2D | null;
  private unit: RulerUnit;
  private grid: GridConfig;
  private guideDragCb: ((axis: 'x' | 'y') => void) | null = null;

  constructor(private opts: {
    container: HTMLElement;
    hCanvas: HTMLCanvasElement;
    vCanvas: HTMLCanvasElement;
    corner: HTMLElement;
  }) {
    this.hCtx = opts.hCanvas.getContext('2d');
    this.vCtx = opts.vCanvas.getContext('2d');
    this.unit = detectUnit(navigator?.language);
    this.grid = getGridConfig(this.unit, SLIDES_PX_PER_INCH);
  }

  setUnit(unit: RulerUnit) {
    this.unit = unit;
    this.grid = getGridConfig(unit, SLIDES_PX_PER_INCH);
  }

  onGuideDragStart(cb: (axis: 'x' | 'y') => void) {
    this.guideDragCb = cb;
  }

  render(viewport: SlidesRulerViewport) {
    this.resizeCanvases();
    const density = this.densityFor(viewport.zoom);
    this.paintAxis('h', viewport, density);
    this.paintAxis('v', viewport, density);
  }

  private densityFor(zoom: number): Density {
    const pxPerUnit = this.grid.majorStepPx * zoom;
    if (pxPerUnit >= 60) return 'full';
    if (pxPerUnit >= 30) return 'half-only';
    if (pxPerUnit >= 15) return 'major';
    return 'major-thinned';
  }

  private resizeCanvases() {
    // Sync backing stores to container size × devicePixelRatio.
    // For h: width = container.clientWidth - RULER_SIZE, height = RULER_SIZE.
    // For v: width = RULER_SIZE, height = container.clientHeight - RULER_SIZE.
    // Apply ctx.scale(dpr, dpr) after resize.
  }

  private paintAxis(axis: 'h' | 'v', v: SlidesRulerViewport, density: Density) {
    const ctx = axis === 'h' ? this.hCtx : this.vCtx;
    if (!ctx) return;
    const length = axis === 'h'
      ? this.opts.hCanvas.clientWidth
      : this.opts.vCanvas.clientHeight;
    const origin = axis === 'h' ? -v.scrollX * v.zoom : -v.scrollY * v.zoom;
    drawTicks({
      ctx, axis, length, origin,
      scale: v.zoom,
      grid: this.grid,
      unit: this.unit,
      density,
    });
  }

  dispose() {
    // No listeners attached in Phase 2; Phase 4 adds mousedown handlers
    // and a matching teardown.
  }
}
```

The paint methods compute density from `v.zoom`:

```ts
const pxPerUnitOnScreen =
  (this.unit === 'inch' ? SLIDES_PX_PER_INCH : SLIDES_PX_PER_INCH / 2.54) * v.zoom;

const density: 'full' | 'half-only' | 'major' | 'major-thinned' =
  pxPerUnitOnScreen >= 60 ? 'full'
  : pxPerUnitOnScreen >= 30 ? 'half-only'
  : pxPerUnitOnScreen >= 15 ? 'major'
  : 'major-thinned';
```

- [x] **Step 3: Run test, verify it passes**

```bash
pnpm --filter @wafflebase/slides test ruler
```

- [x] **Step 4: Add density coverage tests**

For each of the four density bands, render at the corresponding zoom
and assert against a spied canvas context (use the existing
`createCtxSpy` harness in `packages/slides/src/view/canvas/ctx-spy.ts`)
that the right number of `fillText` calls fire.

```ts
import { asCtx, createCtxSpy } from '../../../../src/view/canvas/ctx-spy';

it('uses major-only labels at zoom 0.1', () => {
  const spy = createCtxSpy();
  hCanvas.getContext = () => asCtx(spy);
  vCanvas.getContext = () => asCtx(spy);
  const ruler = new SlidesRuler({ container, hCanvas, vCanvas, corner });
  ruler.render({ scrollX: 0, scrollY: 0, zoom: 0.1, slideW: 1920, slideH: 1080 });
  expect(spy.fillTextCalls.length).toBeGreaterThan(0);
  expect(spy.fillTextCalls.length).toBeLessThan(5); // major-thinned
});
```

### Task 2.2: Mount the ruler in the editor shell

**Files:**
- Modify: `packages/frontend/src/app/slides/slides-view.tsx` (or wherever the slide stage is composed)
- Modify: `packages/slides/src/view/editor/editor.ts` (expose `setRulerViewport()` / call ruler from paint)

- [x] **Step 1: Find the slide stage DOM**

Search for the element that hosts `<canvas>` and the selection overlay:

```bash
grep -rn "slide-canvas\|slide-stage\|overlay" packages/frontend/src/app/slides/ | head
```

This is where the ruler canvases must be inserted as siblings of the
existing canvas/overlay, positioned absolutely.

- [x] **Step 2: Adjust DOM structure**

In the React shell, render three new sibling elements ahead of the
canvas pane:

```tsx
<div className="slide-stage" style={{ position: 'relative' }}>
  <div ref={cornerRef}    className="ruler-corner" />
  <canvas ref={hRulerRef} className="ruler-h"      />
  <canvas ref={vRulerRef} className="ruler-v"      />
  <div    ref={paneRef}   className="canvas-pane">
    <canvas ref={slideRef} />
    <div ref={overlayRef} className="overlay" />
  </div>
</div>
```

CSS (Tailwind or matching the existing styling layer):

```css
.ruler-corner { position: absolute; top: 0; left: 0; width: 20px; height: 20px; z-index: 3; }
.ruler-h      { position: absolute; top: 0; left: 20px; right: 0; height: 20px; z-index: 2; }
.ruler-v      { position: absolute; top: 20px; left: 0; bottom: 0; width: 20px; z-index: 1; }
.canvas-pane  { position: absolute; top: 20px; left: 20px; right: 0; bottom: 0; }
```

- [x] **Step 3: Wire ruler to editor paint cycle**

In `editor.ts`, instantiate a `SlidesRuler` after the canvas is
mounted, and call `ruler.render({ ... })` at the end of each paint:

```ts
this.ruler = new SlidesRuler({
  container: stageEl,
  hCanvas: hRulerCanvas,
  vCanvas: vRulerCanvas,
  corner: cornerEl,
});

// inside render():
this.ruler.render({
  scrollX: this.viewport.scrollX,
  scrollY: this.viewport.scrollY,
  zoom: this.viewport.zoom,
  slideW: 1920,
  slideH: 1080,
});
```

`editor.dispose()` must call `ruler.dispose()`.

- [x] **Step 4: Manual smoke**

```bash
pnpm dev
```

Open a slides document. Confirm:
- H/V rulers appear at top and left, 20 px each
- Slide canvas is offset 20 px down and 20 px right
- Labels at zoom 1: 0", 1", 2", … (or 0 cm, 1 cm, … on metric locales)
- Labels thin out as you zoom out; full minor ticks appear when zoomed in past 60 px per unit

- [x] **Step 5: Commit**

```bash
git add packages/slides packages/frontend/src/app/slides packages/docs/src
git commit -m "$(cat <<'EOF'
Add horizontal and vertical rulers to the slides editor

H/V rulers attach to the slide stage as absolutely positioned canvases
(20 px each), drawn through the shared docs tick renderer with a
slides-specific 144 dpi constant (1920 px / 13.333"). Tick density
adapts to editor zoom so the ruler stays legible from 0.25× to 3×.

Display-only in this PR — guide drag-out, snap, and interactions land
in follow-ups.

See docs/design/slides/slides-ruler.md.
EOF
)"
```

---

## Chunk 3: Phase 3 — Guide data model + Yorkie schema + passive render

Add the `Guide` type, store API, in-memory implementation, Yorkie
adapter, and a passive render pass. Users still cannot create guides
through the UI; this PR makes them creatable via the store and
visible if they exist.

### Task 3.1: Model + store API

**Files:**
- Modify: `packages/slides/src/model/presentation.ts` (add `Guide`, extend `SlidesDocument`)
- Modify: `packages/slides/src/store/store.ts` (interface additions)
- Modify: `packages/slides/src/store/memory.ts` (implementation)
- Test: `packages/slides/test/store/memory.test.ts`

- [x] **Step 1: Add type to model**

```ts
// packages/slides/src/model/presentation.ts
export type GuideAxis = 'x' | 'y';

export interface Guide {
  id: string;
  axis: GuideAxis;
  position: number;
}

export interface SlidesDocument {
  meta: { title: string };
  slides: Slide[];
  layouts: Layout[];
  guides: Guide[];                  // NEW
  // ...other existing fields (themes, etc.)
}
```

Add `guides: []` to all factory functions / fixtures that construct a
`SlidesDocument` (search `meta:.*title` in the codebase to find them).

- [x] **Step 2: Add interface methods**

```ts
// in SlidesStore
addGuide(axis: GuideAxis, position: number): string;
moveGuide(id: string, position: number): void;
removeGuide(id: string): void;
```

Document in JSDoc that position is clamped by callers; the store does
not enforce bounds (it is geometry-agnostic).

- [x] **Step 3: Write failing tests**

```ts
// packages/slides/test/store/memory.test.ts (append)
describe('guides', () => {
  it('adds a guide and returns a stable id', () => {
    const store = new MemSlidesStore(fixture());
    const id = store.addGuide('x', 200);
    expect(store.read().guides).toEqual([{ id, axis: 'x', position: 200 }]);
  });

  it('moves a guide', () => {
    const store = new MemSlidesStore(fixture());
    const id = store.addGuide('y', 100);
    store.moveGuide(id, 250);
    expect(store.read().guides[0].position).toBe(250);
  });

  it('removes a guide', () => {
    const store = new MemSlidesStore(fixture());
    const id = store.addGuide('x', 200);
    store.removeGuide(id);
    expect(store.read().guides).toEqual([]);
  });

  it('groups add+move+remove into one undo step when wrapped in batch', () => {
    const store = new MemSlidesStore(fixture());
    store.batch(() => {
      const id = store.addGuide('x', 100);
      store.moveGuide(id, 200);
    });
    store.undo();
    expect(store.read().guides).toEqual([]);
  });
});
```

Run: `pnpm --filter @wafflebase/slides test memory`
Expected: FAIL ("addGuide is not a function").

- [x] **Step 4: Implement in `MemSlidesStore`**

```ts
addGuide(axis: GuideAxis, position: number): string {
  const id = nanoid();
  this.commit('addGuide', (doc) => {
    doc.guides.push({ id, axis, position });
  });
  return id;
}

moveGuide(id: string, position: number): void {
  this.commit('moveGuide', (doc) => {
    const g = doc.guides.find((g) => g.id === id);
    if (g) g.position = position;
  });
}

removeGuide(id: string): void {
  this.commit('removeGuide', (doc) => {
    doc.guides = doc.guides.filter((g) => g.id !== id);
  });
}
```

`commit` (or whatever the existing pattern is — match the surrounding
code) handles batching and undo entry creation. Verify by reading a
neighbouring mutator like `addElement` and copying its shape.

- [x] **Step 5: Run tests, verify they pass**

```bash
pnpm --filter @wafflebase/slides test memory
```

### Task 3.2: Yorkie adapter

**Files:**
- Modify: `packages/frontend/src/app/slides/yorkie-slides-store.ts`
- Modify: `packages/backend/src/yorkie/yorkie.types.ts` (add `guides` to the slides root shape)
- Test: `packages/frontend/tests/app/slides/yorkie-slides-store.test.ts`

- [x] **Step 1: Extend backend Yorkie type**

```ts
// packages/backend/src/yorkie/yorkie.types.ts
export interface SlidesDocumentYorkie {
  // existing
  guides?: Array<{ id: string; axis: 'x' | 'y'; position: number }>;
}
```

`guides` is optional in the type so old documents (without it) still
parse.

- [x] **Step 2: Lazy init on attach**

In `yorkie-slides-store.ts`, find the `update(root => …)` block that
runs after attach. Add:

```ts
doc.update((root) => {
  if (!root.guides) {
    root.guides = [];
  }
});
```

This is idempotent — once the first session writes the empty array,
subsequent attaches no-op.

- [x] **Step 3: Implement the three guide methods**

Mirror the pattern of `addElement` / `removeElement` (use
`Yorkie.Array.push` / `splice` / index-based update inside a
`doc.update` callback):

```ts
addGuide(axis: GuideAxis, position: number): string {
  const id = nanoid();
  this.doc.update((root) => {
    root.guides.push({ id, axis, position });
  });
  return id;
}

moveGuide(id: string, position: number): void {
  this.doc.update((root) => {
    const idx = root.guides.findIndex((g: Guide) => g.id === id);
    if (idx >= 0) root.guides[idx].position = position;
  });
}

removeGuide(id: string): void {
  this.doc.update((root) => {
    const idx = root.guides.findIndex((g: Guide) => g.id === id);
    if (idx >= 0) root.guides.deleteByIndex(idx);
  });
}
```

(Adjust API calls to match the actual Yorkie.Array surface used elsewhere in the file.)

- [x] **Step 4: Equivalence test (Mem vs Yorkie)**

In `yorkie-slides-store.test.ts`, add a section that runs the same
operation sequence against both `MemSlidesStore` and a Yorkie-attached
`YorkieSlidesStore` and asserts `read()` returns the same `guides`
array.

- [x] **Step 5: Concurrent convergence test**

Extend `packages/frontend/tests/app/slides/two-user-slides-yorkie.ts`
(or the equivalent two-user helper) with a scenario where user A and
user B concurrently `addGuide` and `removeGuide`, then sync. Assert
both clients converge to the same `guides` array. Gate with
`RUN_YORKIE_INTEGRATION_TESTS`.

### Task 3.3: Passive render

**Files:**
- Create: `packages/slides/src/view/editor/ruler/guides-layer.ts`
- Modify: `packages/slides/src/view/editor/overlay.ts` (mount the guides layer)

- [x] **Step 1: Implement `paintGuides`**

```ts
// packages/slides/src/view/editor/ruler/guides-layer.ts
import type { Guide } from '../../../model/presentation';

export function paintGuides(
  ctx: CanvasRenderingContext2D,
  guides: ReadonlyArray<Guide>,
  view: { zoom: number; scrollX: number; scrollY: number; slideW: number; slideH: number },
): void {
  ctx.save();
  ctx.strokeStyle = '#ff2d92';  // magenta
  ctx.lineWidth = 1;
  for (const g of guides) {
    ctx.beginPath();
    if (g.axis === 'x') {
      const x = (g.position - view.scrollX) * view.zoom + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, view.slideH * view.zoom);
    } else {
      const y = (g.position - view.scrollY) * view.zoom + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(view.slideW * view.zoom, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}
```

- [x] **Step 2: Mount in overlay paint**

In `overlay.ts`, find the existing overlay paint sequence (selection
handles, snap guides). Append a `paintGuides(ctx, doc.guides, view)`
call after element overlays but before selection handles.

- [x] **Step 3: Manual smoke**

Open browser devtools, attach the editor, run:

```js
editor.store.addGuide('x', 400);
editor.store.addGuide('y', 300);
editor.render();
```

Confirm two magenta lines appear on the slide canvas (crossing).

- [x] **Step 4: Commit**

```bash
git add packages/slides packages/frontend packages/backend
git commit -m "$(cat <<'EOF'
Add presentation-wide guides to the slides data model

Introduce a Guide type stored on SlidesDocument.guides, with addGuide
/ moveGuide / removeGuide on the SlidesStore interface. Implement on
MemSlidesStore and YorkieSlidesStore; the Yorkie adapter lazy-inits
the new array on attach so existing decks load without migration.

Guides render passively as magenta solid lines through the overlay
layer. User interactions land in the next PR.

See docs/design/slides/slides-ruler.md.
EOF
)"
```

---

## Chunk 4: Phase 4 — Guide interactions

User-facing creation, repositioning, and deletion of guides via
ruler drag-out, guide drag, and context menu. Presence-driven
previews keep CRDT operations bounded to one per gesture.

### Task 4.1: Drag-out from the rulers

**Files:**
- Create: `packages/slides/src/view/editor/ruler/interactions.ts`
- Modify: `packages/slides/src/view/editor/ruler/ruler.ts` (wire `mousedown`)
- Modify: `packages/slides/src/view/editor/editor.ts` (own the interaction state)
- Modify: `packages/slides/src/view/editor/selection.ts` (presence field — `draggingGuide`)

- [x] **Step 1: Add presence field**

Find the existing `SlidesPresence` type (search `selectedElementIds`).
Add:

```ts
draggingGuide?: {
  id?: string;
  axis: 'x' | 'y';
  position: number;
};
```

- [x] **Step 2: Hook ruler mousedown**

In `ruler.ts` constructor, attach listeners (when not read-only):

```ts
opts.hCanvas.addEventListener('mousedown', (e) => this.onRulerMousedown(e, 'x'));
opts.vCanvas.addEventListener('mousedown', (e) => this.onRulerMousedown(e, 'y'));
```

`onRulerMousedown` fires the `guideDragCb` (set via `onGuideDragStart`),
which the editor uses to start a guide-drag interaction:

```ts
private onRulerMousedown(e: MouseEvent, axis: 'x' | 'y') {
  if (!this.guideDragCb) return;
  e.preventDefault();
  this.guideDragCb(axis);  // hand off to editor
}
```

Track listener references in a private array for `dispose()`.

- [x] **Step 3: Implement guide drag in editor**

```ts
// packages/slides/src/view/editor/ruler/interactions.ts
export function startGuideDrag(
  editor: SlidesEditor,
  axis: 'x' | 'y',
  initialEvent: MouseEvent,
): void {
  const slideToScreen = editor.viewport.zoom;
  const startScreen = axis === 'x' ? initialEvent.clientX : initialEvent.clientY;
  // ... attach window mousemove/mouseup
}
```

On `mousemove`:
- Convert screen Y/X back to slide-logical coords.
- Update presence: `draggingGuide: { axis, position }`.
- Paint preview through the overlay path on the next animation frame.

On `mouseup`:
- If pointer inside slide bounds: `store.batch(() => store.addGuide(axis, position))`.
- Otherwise: discard (no store call).
- Clear presence.

- [x] **Step 4: Tests**

Use the existing editor test harness (`packages/slides/test/view/editor/editor.test.ts`).
Simulate a mousedown on the ruler canvas + mousemove + mouseup, assert:

```ts
it('creates a guide via ruler drag-out', () => {
  // arrange editor + dispatch mousedown on hCanvas, mousemove, mouseup over slide
  expect(store.read().guides).toEqual([
    expect.objectContaining({ axis: 'x', position: 400 }),
  ]);
});
```

### Task 4.2: Drag existing guide

**Files:**
- Modify: `packages/slides/src/view/editor/hit-test.ts` (add guide hit-test within 4 px)
- Modify: `packages/slides/src/view/editor/ruler/interactions.ts`

- [x] **Step 1: Guide hit-test**

Add a helper:

```ts
export function hitTestGuide(
  guides: ReadonlyArray<Guide>,
  point: { x: number; y: number },
  thresholdPx: number,
  zoom: number,
): Guide | null {
  const t = thresholdPx / zoom;
  return guides.find((g) =>
    g.axis === 'x' ? Math.abs(point.x - g.position) <= t
                   : Math.abs(point.y - g.position) <= t,
  ) ?? null;
}
```

- [x] **Step 2: Cursor + start-drag on slide canvas**

In the slide canvas `mousemove` handler (which already runs for
element hit-testing), if no element is under the pointer but a guide
is within 4 px, set the cursor to `col-resize` (vertical guide) or
`row-resize` (horizontal guide).

On `mousedown` with a guide hit, start a `moveGuide` drag: presence
preview, `moveGuide(id, position)` on mouseup.

- [x] **Step 3: Tests**

```ts
it('moves a guide on drag', () => {
  store.addGuide('x', 200);
  // dispatch mousedown at slide-x=200, mousemove to slide-x=350, mouseup
  expect(store.read().guides[0].position).toBe(350);
});
```

### Task 4.3: Delete by dragging guide onto a ruler

**Files:**
- Modify: `packages/slides/src/view/editor/ruler/interactions.ts`

- [x] **Step 1: Detect ruler-region mouseup**

While dragging an existing guide, on every `mousemove` check whether
the cursor is over a ruler canvas (use `elementFromPoint` or compare
against ruler bounds). If over the matching ruler, set the cursor to
a delete affordance (use `not-allowed` for v1; an icon overlay can
come later).

On `mouseup` over the ruler: `store.removeGuide(id)`.

- [x] **Step 2: Test**

```ts
it('deletes a guide when dragged onto the ruler', () => {
  const id = store.addGuide('x', 200);
  // dispatch mousedown at guide, mousemove into ruler region, mouseup
  expect(store.read().guides).toEqual([]);
});
```

### Task 4.4: Right-click menu + ruler markers

**Files:**
- Modify: `packages/slides/src/view/editor/context-menu.ts`
- Modify: `packages/slides/src/view/editor/ruler/ruler.ts` (paint magenta markers)

- [x] **Step 1: Context menu entries**

Extend the existing slides context menu (used elsewhere in the editor)
with three new actions, gated on a guide being under the pointer:

- "Delete guide" → `store.removeGuide(id)`
- "Delete all on this axis" → `store.batch(() => guides.filter(...).forEach(removeGuide))`
- "Delete all guides" → batch + removeAll

- [x] **Step 2: Ruler markers**

In `SlidesRuler.paintHorizontal` / `paintVertical`, after `drawTicks`,
paint a small magenta triangle for each guide whose axis matches the
ruler:

```ts
ctx.fillStyle = '#ff2d92';
ctx.beginPath();
ctx.moveTo(screenX - 4, 0);
ctx.lineTo(screenX + 4, 0);
ctx.lineTo(screenX,    RULER_SIZE - 2);
ctx.closePath();
ctx.fill();
```

Wire this by extending `render()` to accept the current guide list:

```ts
render(viewport: SlidesRulerViewport, guides: ReadonlyArray<Guide>): void
```

Update the editor's paint call accordingly.

- [x] **Step 3: Two-user presence test**

In `two-user-slides-yorkie.ts`, simulate user A dragging a guide
and assert user B receives `draggingGuide` presence updates without
any CRDT operation firing during the drag.

- [x] **Step 4: Commit**

```bash
git add packages/slides packages/frontend
git commit -m "$(cat <<'EOF'
Make slides guides draggable from the rulers

Mousedown on a ruler starts a drag-out gesture; mouseup inside the
slide commits via store.addGuide. Existing guides drag to reposition
and can be deleted by dragging back onto a ruler or via the right-
click menu. Intermediate frames travel through presence so the CRDT
sees one operation per gesture.

Each ruler paints small magenta markers showing the positions of
guides on its axis.

See docs/design/slides/slides-ruler.md.
EOF
)"
```

---

## Chunk 5: Phase 5 — Snap integration

Guides become a snap-candidate kind alongside slide-center and
element edges, with explicit priority resolution.

### Task 5.1: Extend SnapGuide and snap engine

**Files:**
- Modify: `packages/slides/src/view/editor/snap.ts`
- Modify: `packages/slides/src/view/editor/snap-candidates.ts`
- Test: `packages/slides/test/view/editor/snap.test.ts`

- [x] **Step 1: Extend type**

```ts
// snap.ts
export type SnapGuide = {
  kind: 'slide-center' | 'edge' | 'guide';
  axis: 'x' | 'y';
  position: number;
  guideId?: string;
};
```

- [x] **Step 2: Add guides to candidate list**

In `snap-candidates.ts` (the function that builds the candidate set
before each `snapDelta` call), append a candidate for each guide:

```ts
for (const g of doc.guides) {
  candidates.push({ kind: 'guide', axis: g.axis, position: g.position, guideId: g.id });
}
```

- [x] **Step 3: Priority resolution in snapDelta**

When multiple candidates fall within the threshold:

```ts
const order = { 'slide-center': 0, 'guide': 1, 'edge': 2 };
hits.sort((a, b) => order[a.kind] - order[b.kind] || Math.abs(a.delta) - Math.abs(b.delta));
return hits[0];
```

- [x] **Step 4: Tests**

```ts
it('prefers slide-center over a guide within the same threshold', () => {
  const doc = makeDoc({ guides: [{ id: 'g1', axis: 'x', position: 962 }] });
  // slide-center at 960; both within 4 px of dragged frame at 961
  const snap = snapDelta(doc, dragged, threshold);
  expect(snap?.kind).toBe('slide-center');
});

it('prefers a guide over an element edge', () => {
  const doc = makeDoc({
    guides: [{ id: 'g1', axis: 'x', position: 100 }],
    slides: [{ elements: [{ frame: { x: 102, ...} }] }],
  });
  const snap = snapDelta(doc, draggedNear(100), threshold);
  expect(snap?.kind).toBe('guide');
});

it('does not trigger snap during arrow-key nudge', () => {
  // verify nudge path bypasses snap entirely
});
```

### Task 5.2: Visual emphasis on snapped guide

**Files:**
- Modify: `packages/slides/src/view/editor/ruler/guides-layer.ts`

- [x] **Step 1: Receive snap target**

Extend `paintGuides` to take an optional `snappedGuideId: string | null`
and thicken / deepen color when it matches:

```ts
const isSnapped = g.id === snappedGuideId;
ctx.lineWidth = isSnapped ? 1.5 : 1;
ctx.strokeStyle = isSnapped ? '#ff007a' : '#ff2d92';
```

- [x] **Step 2: Wire from overlay paint**

```ts
paintGuides(ctx, doc.guides, view, editor.currentSnap?.guideId ?? null);
```

- [x] **Step 3: Manual smoke**

`pnpm dev`, drag an element near a guide, confirm the guide turns
thicker / darker the moment the element snaps.

- [x] **Step 4: Commit**

```bash
git add packages/slides
git commit -m "$(cat <<'EOF'
Make slides guides participate in the snap engine

Add 'guide' as a third SnapGuide kind, ranked between slide-center
and element edges. When an element drag snaps to a guide, the guide
itself thickens and deepens color so the snap target is unambiguous.

Keyboard nudge intentionally bypasses snap; tests pin the behavior.

See docs/design/slides/slides-ruler.md.
EOF
)"
```

---

## Chunk 6: Phase 6 — Read-only mounts + presentation/PDF exclusion + browser smoke

Polish: read-only viewers see rulers/guides but cannot edit; the
presenter and PDF exporter ignore them; a browser-driven scenario
verifies persistence end-to-end.

### Task 6.1: Read-only branch

**Files:**
- Modify: `packages/slides/src/view/editor/editor.ts` (`initializeEditor` options)
- Modify: `packages/slides/src/view/editor/ruler/ruler.ts` (accept `readOnly` flag)
- Modify: `packages/slides/src/view/editor/ruler/interactions.ts` (no-op when read-only)

- [x] **Step 1: Plumb `readOnly` to the ruler**

Update the `SlidesRuler` constructor to accept `readOnly?: boolean`.
When true, skip the `mousedown` listener binding in Task 4.1 Step 2.

- [x] **Step 2: Skip interactions in read-only mode**

In `editor.ts`, where `attachInteractions()` is gated by `readOnly`,
also skip:
- guide hover hit-test (cursor change on `mousemove`)
- right-click context menu entries for guides

- [x] **Step 3: Tests**

```ts
it('does not allow guide creation in read-only mode', () => {
  const editor = initializeEditor({ ..., readOnly: true });
  // dispatch mousedown on ruler + mouseup
  expect(store.read().guides).toEqual([]);
});
```

### Task 6.2: Presentation and PDF exclusion

**Files:**
- Verify: `packages/slides/src/view/present/presenter.ts` does not import the ruler / guides layer
- Modify: `packages/slides/src/export/pdf.ts` (assert guides are ignored)
- Test: `packages/slides/test/export/pdf.test.ts`

- [x] **Step 1: PDF test**

```ts
it('does not render guides into PDF output', async () => {
  const doc = makeDoc({ guides: [{ id: 'g1', axis: 'x', position: 400 }] });
  const a = await exportPdf(doc);
  const b = await exportPdf({ ...doc, guides: [] });
  expect(a.length).toBe(b.length); // bytes identical
});
```

Adjust assertion to whatever signal matches the existing PDF test
infrastructure (e.g. paint-call counts).

- [x] **Step 2: Presenter check**

Grep the presenter module:

```bash
grep -n "guide\|ruler" packages/slides/src/view/present/
```

Confirm no references. If any slipped in, remove them.

### Task 6.3: Browser smoke (verify:browser:docker)

**Files:**
- Modify or add: `packages/frontend/tests/browser/slides-ruler.spec.ts`

- [x] **Step 1: Scenario**

```ts
test('guide created in one session persists after reload', async ({ page }) => {
  await page.goto('/slides/<fixture-id>');
  await dragFrom(page, '.ruler-h', { x: 400, y: 10 }, { x: 400, y: 200 });
  await expect(page.locator('.guides-layer-canvas-marker')).toBeVisible();
  await page.reload();
  await expect(page.locator('.guides-layer-canvas-marker')).toBeVisible();
});
```

Use the existing browser-test harness conventions; the locator names
above are placeholders to be replaced with the actual selectors used
by the project's browser tests.

- [x] **Step 2: Run**

```bash
pnpm verify:browser:docker
```

- [x] **Step 3: Final commit**

```bash
git add packages/slides packages/frontend
git commit -m "$(cat <<'EOF'
Finish slides ruler — read-only handling and browser smoke

Read-only mounts render the ruler and existing guides but suppress
every mutating interaction (drag-out, guide drag, context menu).
Presentation mode and PDF export ignore guides — covered by a PDF
byte-equality test.

Browser smoke verifies a ruler drag-out persists across reload via
Yorkie sync.

Closes the implementation tracked in
docs/tasks/active/20260523-slides-ruler-todo.md.
EOF
)"
```

---

## Verification gates

| Phase | Gate | Command |
| --- | --- | --- |
| P1, P2, P5 | unit + lint | `pnpm verify:fast` |
| P3 | unit + integration (Yorkie convergence) | `pnpm verify:integration` |
| P4 | unit + integration (presence) | `pnpm verify:integration` |
| P6 | full + browser | `pnpm verify:browser:docker` |

Each commit must pass `pnpm verify:fast`. The integration / browser
gates only block the PRs that touch their respective subsystems.

---

## Out of scope (tracked for follow-ups)

- `View > Show ruler` and `View > Show guides` toggles (await a
  Slides View menu and a persisted-preferences surface).
- Text-box-local ruler mode with indent / tab handles. Plan picks
  this up after the docs RichText extraction lands (see
  `docs/design/slides/slides-text-engine-audit.md`).
- Numeric guide position input (e.g. "place at exactly 4.0\"").
- Per-slide guides; for v1 they are strictly presentation-wide.
- Center-origin coordinates (PowerPoint convention).
