# Board Canvas Skeleton (SP1) Implementation Plan

> **STATUS: IMPLEMENTED — in review as PR #606** (branch `design/board-infinite-canvas`). All 13 tasks landed; `verify:self` green. The per-step `- [ ]` boxes below are preserved as the original plan of record; see **Results / Review** at the bottom for the completion summary + deferred follow-ups. Task stays in `active/` until the PR merges, then archives.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a new `"board"` document type + `@wafflebase/board` package that renders a collaborative, infinite pan/zoom canvas by reusing the slides scene engine through an injected viewport transform.

**Architecture:** A board is "one unbounded slide viewed through a pan/zoom viewport." The slides scene engine already operates in transform-agnostic world coordinates; the only screen↔world coupling is a uniform *fit-scale* at three chokepoints (`drawSlide`, `editor.scale()/clientToLogical()`, `overlay`). We add an optional `Viewport {panX,panY,zoom}` to the renderer/editor options — absent = today's fit-scale (slides unchanged), present = board pan/zoom. Board supplies a `YorkieBoardStore` that satisfies the wide `SlidesStore` interface with a single synthetic slide (`slideId === "board"`), so the editor is reused unmodified.

**Tech Stack:** TypeScript, Vite lib build (dual ESM/CJS + `vite-plugin-dts`), Vitest, Yorkie CRDT (`@yorkie-js/react` `DocumentProvider`), Canvas 2D + DOM overlay, React (frontend), NestJS (backend), pnpm workspaces.

Design spec: `docs/design/board/board.md`.

## Global Constraints

- **Slides regression gate is absolute.** The viewport change MUST be behavior-preserving: with no viewport supplied, slides renders/edits byte-identically. Every Stage-1 task ends by running the full slides suite (`pnpm --filter @wafflebase/slides test`) green.
- **No new engine extraction to `@wafflebase/core` in SP1.** Board imports the scene engine from `@wafflebase/slides`. Only the `Viewport` type/helpers are new shared surface; keep them in slides for now.
- **Two scale conventions are real and must be preserved:** the canvas bitmap uses `zoom * dpr`; the DOM overlay + `editor.scale()` use `zoom` (no dpr). Do not unify them.
- **SP1 element scope is shapes / text boxes / connectors only.** No sticky/image/table/chart/freehand; no Miro import; no minimap; no PPTX/PDF/presentation.
- **docKey convention:** `board-<id>`. **Workspace package name:** `@wafflebase/board`, `"private": true`, version `0.6.1` (lockstep with siblings). **Route:** `/b/:id`.
- **Commit format:** subject ≤70 chars, blank line 2, body explains why. End commit messages with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Pre-commit gate:** `pnpm verify:fast` green before each commit.
- **Branch:** work on `design/board-infinite-canvas` (already created); land via PR, never push `main`.

---

## File Structure

**New — `packages/board/`** (mirrors `packages/slides/` build tooling):
- `package.json` — `@wafflebase/board`, deps on `@wafflebase/slides`, `@wafflebase/docs`, `@wafflebase/core`.
- `tsconfig.json`, `vite.build.ts` — copied from slides, single `.` entry (no `./node` in SP1).
- `src/index.ts` — package barrel (re-exports viewport + board-editor).
- `src/model/board.ts` — `BoardDocument`, `SYNTHETIC_SLIDE_ID`, and `boardToSlidesDocument(root)` synthesizer.
- `src/view/viewport.ts` — `Viewport`, `worldToScreen`, `screenToWorld`, `zoomAt`, `screenWorldRect`, `isFrameVisible`.
- `src/view/board-editor.ts` — thin factory wrapping slides `initialize()` with a viewport + pan/zoom pointer handlers.
- `src/view/viewport.test.ts`, `src/model/board.test.ts` — Vitest units.

**Modified — `packages/slides/`** (the viewport seam only):
- `src/view/canvas/viewport.ts` — **new**: `Viewport` type + `worldToScreen`/`screenToWorld` (canonical home; board re-exports).
- `src/view/canvas/slide-renderer.ts` — `SlideRendererOptions.viewport?`; transform + bg gating + culling.
- `src/view/editor/editor.ts` — `scale()`/`clientToLogical()` viewport-aware; pass overlay pan.
- `src/view/editor/overlay.ts` — `OverlayOptions.panX?/panY?`; apply in handle/guide placement.
- `src/index.ts` — export `Viewport`, `worldToScreen`, `screenToWorld`.
- Test files colocated (`*.test.ts`) next to each.

**Modified — `packages/frontend/`:**
- `src/types/documents.ts` — `DocumentType` union += `"board"`.
- `src/types/board-document.ts` — **new**: `YorkieBoardRoot`, `initialBoardRoot()`, `BoardPresence`, `boardUserColor()`.
- `src/app/board/yorkie-board-store.ts` — **new**: `YorkieBoardStore implements SlidesStore`.
- `src/app/board/board-detail.tsx` — **new**: `DocumentProvider` mount (mirror `notes-detail.tsx`).
- `src/app/board/board-view.tsx` — **new**: canvas/overlay host + `createBoardEditor` mount + presence (mirror `slides/slides-view.tsx`).
- `src/App.tsx` — lazy `BoardDetail` + `<Route path="/b/:id">`.
- `src/app/documents/document-list-utils.ts` — `getDocumentPath()` `case "board"`.
- `src/app/documents/document-list.tsx` — `TYPE_META.board` + "New Board" in both New menus.
- `src/app/shared/shared-document.tsx` — docKey builder arm + render switch arm (SP1: read-only board view is acceptable; wire the same `board-view`).
- `src/api/share-links.ts` — `ResolvedShareLink.type` union += `"board"`.

**Modified — `packages/backend/`:**
- `src/yorkie/yorkie-doc-key.ts` — `DocumentTypeLike`, `YORKIE_DOC_KEY_PREFIXES`, switch += board.
- `src/document/document.dto.ts` — `DOCUMENT_TYPES` += `'board'`.
- `src/api/v1/documents.controller.ts:54` — create allow-list += `'board'`.

---

# Stage 1 — Viewport seam in slides (behavior-preserving)

## Task 1: `Viewport` type + world↔screen helpers (slides)

**Files:**
- Create: `packages/slides/src/view/canvas/viewport.ts`
- Test: `packages/slides/src/view/canvas/viewport.test.ts`
- Modify: `packages/slides/src/index.ts` (add exports)

**Interfaces:**
- Produces:
  - `interface Viewport { panX: number; panY: number; zoom: number }`
  - `function worldToScreen(v: Viewport, p: { x: number; y: number }): { x: number; y: number }`
  - `function screenToWorld(v: Viewport, p: { x: number; y: number }): { x: number; y: number }`

- [x] **Step 1: Write the failing test**

```ts
// packages/slides/src/view/canvas/viewport.test.ts
import { describe, it, expect } from 'vitest';
import { worldToScreen, screenToWorld, type Viewport } from './viewport';

const v: Viewport = { panX: 100, panY: 40, zoom: 2 };

describe('viewport transforms', () => {
  it('worldToScreen applies zoom then pan', () => {
    expect(worldToScreen(v, { x: 10, y: 5 })).toEqual({ x: 120, y: 50 });
  });
  it('screenToWorld is the inverse of worldToScreen', () => {
    const world = { x: -37.5, y: 12.25 };
    const round = screenToWorld(v, worldToScreen(v, world));
    expect(round.x).toBeCloseTo(world.x, 10);
    expect(round.y).toBeCloseTo(world.y, 10);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/slides test viewport`
Expected: FAIL — cannot resolve `./viewport`.

- [x] **Step 3: Write minimal implementation**

```ts
// packages/slides/src/view/canvas/viewport.ts

/** A pan/zoom transform mapping world (logical px) → screen (CSS px). */
export interface Viewport {
  /** Screen-px x offset applied after zoom. */
  panX: number;
  /** Screen-px y offset applied after zoom. */
  panY: number;
  /** World px → screen px scale. */
  zoom: number;
}

/** world → screen: s = w * zoom + pan */
export function worldToScreen(
  v: Viewport,
  p: { x: number; y: number },
): { x: number; y: number } {
  return { x: p.x * v.zoom + v.panX, y: p.y * v.zoom + v.panY };
}

/** screen → world: w = (s - pan) / zoom */
export function screenToWorld(
  v: Viewport,
  p: { x: number; y: number },
): { x: number; y: number } {
  return { x: (p.x - v.panX) / v.zoom, y: (p.y - v.panY) / v.zoom };
}
```

- [x] **Step 4: Export from the package barrel**

In `packages/slides/src/index.ts`, add:

```ts
export { worldToScreen, screenToWorld, type Viewport } from './view/canvas/viewport';
```

- [x] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/slides test viewport`
Expected: PASS (2 tests).

- [x] **Step 6: Commit**

```bash
git add packages/slides/src/view/canvas/viewport.ts packages/slides/src/view/canvas/viewport.test.ts packages/slides/src/index.ts
git commit -m "Add Viewport type + world/screen helpers to slides" \
  -m "First seam for the board infinite canvas: a pan/zoom transform the
renderer/editor/overlay will route through in place of the fixed
fit-scale. Pure functions, no behavior change yet." \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `drawSlide` honors an optional viewport (+ culling, bg gating)

**Files:**
- Modify: `packages/slides/src/view/canvas/slide-renderer.ts` (`SlideRendererOptions` ~20-49; transform block 171-238; element loop after ~254)
- Test: `packages/slides/src/view/canvas/slide-renderer.viewport.test.ts`

**Interfaces:**
- Consumes: `Viewport`, `worldToScreen`/`screenToWorld` (Task 1).
- Produces: `SlideRendererOptions.viewport?: Viewport` and `SlideRendererOptions.cull?: boolean`. When `viewport` is set, `drawSlide` uses `setTransform(zoom*dpr, 0, 0, zoom*dpr, panX*dpr, panY*dpr)`, paints no slide background rect, and (if `cull`) skips elements whose rotated AABB is off-screen.

- [x] **Step 1: Write the failing test**

Verifies (a) with a viewport, the canvas transform matrix equals `zoom*dpr`/`pan*dpr`; (b) no slide background fill is painted; (c) culling skips an off-screen element. Use a spy canvas context.

```ts
// packages/slides/src/view/canvas/slide-renderer.viewport.test.ts
import { describe, it, expect, vi } from 'vitest';
import { drawSlide } from './slide-renderer';
import { SLIDE_WIDTH } from '../../model/presentation';
// Helper builders — reuse the deck/slide factory the other renderer tests use.
import { makeTestDoc, makeShape } from '../../model/__testkit__'; // if absent, inline a minimal deck (see note)

function spyCtx() {
  const calls: any[] = [];
  const ctx: any = new Proxy(
    { canvas: { width: 800, height: 600 } },
    {
      get(t: any, k) {
        if (k in t) return t[k];
        return (...args: any[]) => { calls.push([k, args]); };
      },
    },
  );
  return { ctx, calls };
}

describe('drawSlide with viewport', () => {
  it('uses zoom*dpr transform and paints no slide background', () => {
    const { ctx, calls } = spyCtx();
    const doc = makeTestDoc([makeShape({ x: 0, y: 0, w: 100, h: 100 })]);
    drawSlide(ctx, doc.slides[0], doc, {
      hostWidth: 800, hostHeight: 600, dpr: 2,
      viewport: { panX: 50, panY: 20, zoom: 1.5 },
    });
    const setT = calls.filter(([k]) => k === 'setTransform').pop();
    expect(setT[1]).toEqual([3, 0, 0, 3, 100, 40]); // zoom*dpr=3, pan*dpr=100/40
    const bgFill = calls.filter(([k]) => k === 'fillRect')
      .some(([, a]) => a[2] >= SLIDE_WIDTH); // slide-sized bg rect
    expect(bgFill).toBe(false);
  });

  it('culls an element fully outside the screen world-rect', () => {
    const { ctx, calls } = spyCtx();
    const offscreen = makeShape({ x: 100000, y: 100000, w: 10, h: 10 });
    const doc = makeTestDoc([offscreen]);
    drawSlide(ctx, doc.slides[0], doc, {
      hostWidth: 800, hostHeight: 600, dpr: 1, cull: true,
      viewport: { panX: 0, panY: 0, zoom: 1 },
    });
    // A culled element issues no path/fill for its geometry.
    expect(calls.some(([k]) => k === 'beginPath')).toBe(false);
  });
});
```

> Note: if `model/__testkit__` does not exist, inline a minimal deck literal that satisfies `SlidesDocument`/`Slide` (one slide, default meta/theme/layout/master, `elements: [shape]`). Grep an existing `slide-renderer` test for the deck factory it imports and reuse that exact helper.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/slides test slide-renderer.viewport`
Expected: FAIL — `viewport`/`cull` ignored; transform is the fit-scale, bg is painted.

- [x] **Step 3: Implement — extend `SlideRendererOptions`**

In `slide-renderer.ts`, add to the interface (after `slideOffsetLogicalY?`):

```ts
  /** When set, overrides the fit-scale with an explicit pan/zoom (board mode). */
  viewport?: Viewport;
  /** Skip elements whose rotated AABB is off-screen (board mode). */
  cull?: boolean;
```

Add the import at top: `import { type Viewport } from './viewport';`

- [x] **Step 4: Implement — branch the transform block**

Replace the fit-scale derivation + transform (lines ~180-227) so that when `options.viewport` is present it takes precedence. Keep the existing fit-scale path untouched for the no-viewport case:

```ts
const { hostWidth, hostHeight, dpr } = options;
ctx.setTransform(1, 0, 0, 1, 0, 0);
const bitmapW = ctx.canvas?.width ?? hostWidth * dpr;
const bitmapH = ctx.canvas?.height ?? hostHeight * dpr;

if (options.viewport) {
  // Board mode: explicit pan/zoom, no slide-rect background.
  ctx.clearRect(0, 0, bitmapW, bitmapH);
  const { panX, panY, zoom } = options.viewport;
  ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, panX * dpr, panY * dpr);
} else {
  // ...existing fit-scale + pasteboard block, verbatim...
}
```

- [x] **Step 5: Implement — cull the element loop**

Where `drawSlide` iterates `slide.elements`, gate each element when culling is on. Compute the visible world-rect once from the viewport and host size, and reuse the existing rotated-AABB helper (grep `snap-candidates.ts` for the exported AABB-of-rotated-frame function; if it is not exported, compute the AABB inline from `frame` + `rotation`).

```ts
const visible = options.viewport && options.cull
  ? {
      x0: screenToWorld(options.viewport, { x: 0, y: 0 }).x,
      y0: screenToWorld(options.viewport, { x: 0, y: 0 }).y,
      x1: screenToWorld(options.viewport, { x: hostWidth, y: hostHeight }).x,
      y1: screenToWorld(options.viewport, { x: hostWidth, y: hostHeight }).y,
    }
  : null;

for (const element of slide.elements) {
  if (visible && !frameIntersectsRect(element.frame, visible)) continue;
  drawElement(ctx, element, /* ...existing args... */);
}
```

Add a local helper `frameIntersectsRect(frame, r)` that expands `frame` to its rotated AABB and tests overlap with `r` (`x0/y0/x1/y1`). Import `screenToWorld` from `./viewport`.

- [x] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @wafflebase/slides test slide-renderer`
Expected: PASS (new viewport tests + all existing slide-renderer tests unchanged).

- [x] **Step 7: Run the full slides suite (regression gate)**

Run: `pnpm --filter @wafflebase/slides test`
Expected: PASS — no existing slides test changes behavior (no-viewport path is byte-identical).

- [x] **Step 8: Commit**

```bash
git add packages/slides/src/view/canvas/slide-renderer.ts packages/slides/src/view/canvas/slide-renderer.viewport.test.ts
git commit -m "Let drawSlide honor an optional viewport + culling" \
  -m "Board mode overrides the fixed fit-scale with an explicit pan/zoom
matrix, paints no slide-rect background, and culls off-screen elements.
The no-viewport path is unchanged so slides renders identically." \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Editor + overlay honor the viewport (pointer + handle placement)

**Files:**
- Modify: `packages/slides/src/view/editor/editor.ts` (`scale()` 1219-1221; `clientToLogical()` 5271-5284; the overlay-render call sites ~992-993, 1122-1123; `SlidesEditorOptions` extends `SlideRendererOptions` so it already carries `viewport?`)
- Modify: `packages/slides/src/view/editor/overlay.ts` (`OverlayOptions` 35-41; `renderAxisAlignedHandles` 506-510; guide positioning 226-232)
- Test: `packages/slides/src/view/editor/overlay.viewport.test.ts`

**Interfaces:**
- Consumes: `SlideRendererOptions.viewport?` (Task 2), so `SlidesEditorOptions.viewport?` is inherited.
- Produces: `OverlayOptions.panX?: number` / `panY?: number` (default 0). Handles/guides render at `world * scale + pan`. `editor.scale()` returns `viewport.zoom ?? hostWidth/SLIDE_WIDTH`; `clientToLogical` inverts the viewport when present.

- [x] **Step 1: Write the failing test (overlay pan)**

```ts
// packages/slides/src/view/editor/overlay.viewport.test.ts
import { describe, it, expect } from 'vitest';
import { renderOverlay } from './overlay';
import type { ShapeElement } from '../../model/element';

function hostDiv(): HTMLDivElement { return document.createElement('div'); }

describe('overlay honors pan offset', () => {
  it('positions a selection handle at world*scale + pan', () => {
    const overlay = hostDiv();
    const el = {
      id: 'a', type: 'shape', frame: { x: 10, y: 10, w: 20, h: 20, rotation: 0 },
      // ...minimal valid ShapeElement fields (grep an existing overlay test's factory)...
    } as unknown as ShapeElement;
    renderOverlay(overlay, [el], {
      scale: 2, slideWidth: 1920, slideHeight: 1080, panX: 100, panY: 50,
    } as any);
    const handleHost = overlay.querySelector('[data-role="bbox"]') as HTMLElement | null;
    // bbox left = x*scale + panX = 10*2 + 100 = 120
    expect(handleHost?.style.left).toBe('120px');
  });
});
```

> Grep `overlay.ts` for the actual `data-*`/class the bbox host uses and a valid `ShapeElement` factory in an existing overlay test; adjust the selector/fixture to match.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/slides test overlay.viewport`
Expected: FAIL — `panX`/`panY` unknown; handle left is `20px` (no pan).

- [x] **Step 3: Implement — `OverlayOptions` pan**

In `overlay.ts` `OverlayOptions`, add:

```ts
  /** Screen-px pan offset (board mode); default 0. */
  panX?: number;
  panY?: number;
```

In `renderAxisAlignedHandles` (506-510) and every other place that maps world→CSS via `* scale`, add the pan:

```ts
const { scale } = options;
const px = options.panX ?? 0;
const py = options.panY ?? 0;
const left = bbox.x * scale + px;
const top = bbox.y * scale + py;
const width = bbox.w * scale;   // sizes are pan-invariant
const height = bbox.h * scale;
```

And the guide line (226-232): `const pos = g.position * options.scale + (g.axis === 'v' ? px : py);`

- [x] **Step 4: Implement — editor `scale()` + `clientToLogical()`**

In `editor.ts`:

```ts
private scale(): number {
  return this.options.viewport?.zoom ?? this.options.hostWidth / SLIDE_WIDTH;
}

private clientToLogical(clientX: number, clientY: number): { x: number; y: number } {
  const rect = this.options.canvas.getBoundingClientRect();
  const vp = this.options.viewport;
  if (vp) {
    return {
      x: (clientX - rect.left - vp.panX) / vp.zoom,
      y: (clientY - rect.top - vp.panY) / vp.zoom,
    };
  }
  const scale = this.scale();
  const offsetX = this.options.slideOffsetLogicalX ?? 0;
  const offsetY = this.options.slideOffsetLogicalY ?? 0;
  return {
    x: (clientX - rect.left) / scale - offsetX,
    y: (clientY - rect.top) / scale - offsetY,
  };
}
```

- [x] **Step 5: Implement — pass pan to the overlay call sites**

At the `renderOverlay(...)` call sites (~992-993, 1122-1123) pass the pan when a viewport is present:

```ts
renderOverlay(this.options.overlay, selected, {
  scale: this.scale(),
  slideWidth: SLIDE_WIDTH,
  slideHeight: deckSlideHeight(this.store.readMeta()),
  panX: this.options.viewport?.panX ?? 0,
  panY: this.options.viewport?.panY ?? 0,
  // ...existing options...
});
```

- [x] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @wafflebase/slides test overlay`
Expected: PASS (new overlay-pan test + existing overlay tests unchanged).

- [x] **Step 7: Run the full slides suite (regression gate) + typecheck**

Run: `pnpm --filter @wafflebase/slides test && pnpm --filter @wafflebase/slides typecheck`
Expected: PASS. No-viewport path unchanged.

- [x] **Step 8: Commit**

```bash
git add packages/slides/src/view/editor/editor.ts packages/slides/src/view/editor/overlay.ts packages/slides/src/view/editor/overlay.viewport.test.ts
git commit -m "Make slides editor + overlay viewport-aware" \
  -m "clientToLogical inverts the viewport for pointer→world; overlay
handles/guides render at world*scale+pan. Absent a viewport the
fit-scale path is unchanged, so slides editing is identical." \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

# Stage 2 — `@wafflebase/board` package scaffold + model

## Task 4: Scaffold the `@wafflebase/board` package

**Files:**
- Create: `packages/board/package.json`, `packages/board/tsconfig.json`, `packages/board/vite.build.ts`, `packages/board/src/index.ts`
- Modify: none (pnpm workspace globs `packages/*`)

**Interfaces:**
- Produces: workspace package `@wafflebase/board` that builds and typechecks empty.

- [x] **Step 1: Write `package.json`**

```json
{
  "name": "@wafflebase/board",
  "private": true,
  "version": "0.6.1",
  "license": "Apache-2.0",
  "description": "Infinite canvas engine for Wafflebase",
  "type": "module",
  "main": "dist/wafflebase-board.cjs",
  "module": "dist/wafflebase-board.es.js",
  "types": "dist/wafflebase-board.es.d.ts",
  "exports": {
    ".": {
      "types": "./dist/wafflebase-board.es.d.ts",
      "import": "./dist/wafflebase-board.es.js",
      "require": "./dist/wafflebase-board.cjs",
      "default": "./dist/wafflebase-board.es.js"
    }
  },
  "scripts": {
    "dev": "vite",
    "test": "vitest --run --passWithNoTests",
    "test:watch": "vitest --watch --passWithNoTests",
    "build": "vite --config vite.build.ts build",
    "typecheck": "tsc --noEmit",
    "format": "prettier --write ."
  },
  "dependencies": {
    "@wafflebase/core": "workspace:*",
    "@wafflebase/docs": "workspace:*",
    "@wafflebase/slides": "workspace:*"
  },
  "devDependencies": {
    "jsdom": "^28.0.0",
    "prettier": "^3.3.2",
    "typescript": "^5.9.3",
    "vite": "^6.4.2",
    "vite-plugin-dts": "^4.5.3",
    "vitest": "^4.1.8"
  }
}
```

- [x] **Step 2: Copy `tsconfig.json` from slides verbatim**

Copy `packages/slides/tsconfig.json` → `packages/board/tsconfig.json` unchanged.

- [x] **Step 3: Write `vite.build.ts` (single entry)**

```ts
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  build: {
    lib: {
      entry: { 'wafflebase-board.es': 'src/index.ts' },
      formats: ['es', 'cjs'],
      fileName: (format) =>
        format === 'cjs' ? 'wafflebase-board.cjs' : 'wafflebase-board.es.js',
    },
  },
  plugins: [dts({ rollupTypes: true })],
});
```

- [x] **Step 4: Write a placeholder barrel**

```ts
// packages/board/src/index.ts
export {}; // populated by later tasks
```

- [x] **Step 5: Install + typecheck + build**

Run: `pnpm install && pnpm --filter @wafflebase/board typecheck && pnpm --filter @wafflebase/board build`
Expected: install links the workspace; typecheck passes; build emits `dist/`.

- [x] **Step 6: Commit**

```bash
git add packages/board pnpm-lock.yaml
git commit -m "Scaffold @wafflebase/board package" \
  -m "Empty workspace package mirroring the slides Vite lib build; home
for the infinite-canvas viewport, board model, and editor wrapper." \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Board viewport view-module (pan/zoom/culling math)

**Files:**
- Create: `packages/board/src/view/viewport.ts`
- Test: `packages/board/src/view/viewport.test.ts`
- Modify: `packages/board/src/index.ts`

**Interfaces:**
- Consumes: `Viewport`, `worldToScreen`, `screenToWorld` from `@wafflebase/slides`.
- Produces:
  - re-export `type Viewport`, `worldToScreen`, `screenToWorld`
  - `function zoomAt(v: Viewport, screenPt: {x:number;y:number}, factor: number, min?: number, max?: number): Viewport` — zoom about a screen anchor, keeping the world point under the cursor fixed.
  - `function panBy(v: Viewport, dxScreen: number, dyScreen: number): Viewport`
  - `const DEFAULT_VIEWPORT: Viewport` = `{ panX: 0, panY: 0, zoom: 1 }`

- [x] **Step 1: Write the failing test**

```ts
// packages/board/src/view/viewport.test.ts
import { describe, it, expect } from 'vitest';
import { zoomAt, panBy, DEFAULT_VIEWPORT, screenToWorld } from './viewport';

describe('board viewport ops', () => {
  it('zoomAt keeps the anchored world point stationary', () => {
    const v = DEFAULT_VIEWPORT;
    const anchor = { x: 300, y: 200 };
    const before = screenToWorld(v, anchor);
    const z = zoomAt(v, anchor, 2);
    const after = screenToWorld(z, anchor);
    expect(z.zoom).toBe(2);
    expect(after.x).toBeCloseTo(before.x, 10);
    expect(after.y).toBeCloseTo(before.y, 10);
  });
  it('zoomAt clamps to [min,max]', () => {
    expect(zoomAt(DEFAULT_VIEWPORT, { x: 0, y: 0 }, 100, 0.1, 8).zoom).toBe(8);
    expect(zoomAt({ panX: 0, panY: 0, zoom: 1 }, { x: 0, y: 0 }, 0.001, 0.1, 8).zoom).toBe(0.1);
  });
  it('panBy shifts pan by screen delta', () => {
    expect(panBy(DEFAULT_VIEWPORT, 15, -5)).toEqual({ panX: 15, panY: -5, zoom: 1 });
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/board test viewport`
Expected: FAIL — module missing.

- [x] **Step 3: Write implementation**

```ts
// packages/board/src/view/viewport.ts
import {
  type Viewport,
  worldToScreen,
  screenToWorld,
} from '@wafflebase/slides';

export { type Viewport, worldToScreen, screenToWorld };

export const DEFAULT_VIEWPORT: Viewport = { panX: 0, panY: 0, zoom: 1 };

/** Zoom about a screen anchor so the world point under it stays fixed. */
export function zoomAt(
  v: Viewport,
  screenPt: { x: number; y: number },
  factor: number,
  min = 0.1,
  max = 8,
): Viewport {
  const zoom = Math.min(max, Math.max(min, v.zoom * factor));
  // Keep worldPt fixed: screenPt = worldPt*zoom + pan  →  pan = screenPt - worldPt*zoom
  const worldPt = screenToWorld(v, screenPt);
  return {
    zoom,
    panX: screenPt.x - worldPt.x * zoom,
    panY: screenPt.y - worldPt.y * zoom,
  };
}

export function panBy(v: Viewport, dxScreen: number, dyScreen: number): Viewport {
  return { ...v, panX: v.panX + dxScreen, panY: v.panY + dyScreen };
}
```

> Note: `zoomAt` takes an absolute `factor` (e.g. `1.1` to zoom in); `screenToWorld` is computed from the pre-zoom viewport.

- [x] **Step 4: Export from barrel**

```ts
// packages/board/src/index.ts
export * from './view/viewport';
```

- [x] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/board test viewport`
Expected: PASS (3 tests).

- [x] **Step 6: Commit**

```bash
git add packages/board/src/view/viewport.ts packages/board/src/view/viewport.test.ts packages/board/src/index.ts
git commit -m "Add board viewport pan/zoom ops" \
  -m "zoomAt anchors the cursor's world point during zoom; panBy shifts by
screen delta. Re-exports the slides Viewport transform for the board." \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Board model + single-slide `SlidesDocument` synthesizer

**Files:**
- Create: `packages/board/src/model/board.ts`
- Test: `packages/board/src/model/board.test.ts`
- Modify: `packages/board/src/index.ts`

**Interfaces:**
- Consumes: `SlidesDocument`, `Slide`, `Element`, default theme/layout/master builders from `@wafflebase/slides` (grep the slides barrel for the exported default-theme registry and `BUILT_IN_LAYOUTS`; if not exported, add named exports to `packages/slides/src/index.ts` for the default theme + a blank layout + default master).
- Produces:
  - `const SYNTHETIC_SLIDE_ID = 'board'`
  - `interface BoardModel { meta: { title: string; unit?: 'in' | 'cm'; recentColors?: string[] }; elements: Element[] }`
  - `function boardToSlidesDocument(model: BoardModel): SlidesDocument` — a valid one-slide deck the scene engine can render/edit.

- [x] **Step 1: Write the failing test**

```ts
// packages/board/src/model/board.test.ts
import { describe, it, expect } from 'vitest';
import { boardToSlidesDocument, SYNTHETIC_SLIDE_ID } from './board';

describe('boardToSlidesDocument', () => {
  it('produces a one-slide deck carrying the board elements', () => {
    const doc = boardToSlidesDocument({ meta: { title: 'B' }, elements: [] });
    expect(doc.slides).toHaveLength(1);
    expect(doc.slides[0].id).toBe(SYNTHETIC_SLIDE_ID);
    expect(doc.slides[0].elements).toEqual([]);
  });
  it('carries a valid theme/layout/master so getActiveTheme resolves', async () => {
    const { getActiveTheme, deckSlideHeight } = await import('@wafflebase/slides');
    const doc = boardToSlidesDocument({ meta: { title: 'B' }, elements: [] });
    expect(() => getActiveTheme(doc)).not.toThrow();
    expect(deckSlideHeight(doc.meta)).toBeGreaterThan(0);
  });
});
```

> Confirm `getActiveTheme` / `deckSlideHeight` are exported from the slides barrel; if not, add them (behavior-preserving export-only change to `packages/slides/src/index.ts`).

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/board test board`
Expected: FAIL — module missing.

- [x] **Step 3: Write implementation**

```ts
// packages/board/src/model/board.ts
import {
  type SlidesDocument,
  type Slide,
  type Element,
  defaultThemeRegistry, // grep slides barrel; adjust name to actual export
  blankLayout,          // grep slides barrel; adjust name
  defaultMaster,        // grep slides barrel; adjust name
} from '@wafflebase/slides';

export const SYNTHETIC_SLIDE_ID = 'board';

export interface BoardModel {
  meta: { title: string; unit?: 'in' | 'cm'; recentColors?: string[] };
  elements: Element[];
}

/** Present the board as a single-slide deck for the reused scene engine. */
export function boardToSlidesDocument(model: BoardModel): SlidesDocument {
  const theme = defaultThemeRegistry()[0];
  const layout = blankLayout(theme.id);
  const master = defaultMaster(theme.id);
  const slide: Slide = {
    id: SYNTHETIC_SLIDE_ID,
    layoutId: layout.id,
    background: { kind: 'none' }, // board paints no slide bg (viewport gates it)
    elements: model.elements,
    notes: [],
  };
  return {
    meta: { title: model.meta.title, themeId: theme.id, masterId: master.id,
            unit: model.meta.unit, recentColors: model.meta.recentColors },
    slides: [slide],
    layouts: [layout],
    masters: [master],
    themes: [theme],
  } as SlidesDocument;
}
```

> The exact default-theme / blank-layout / default-master constructors and the `background`/`Slide` field names must be taken from the slides model — grep `packages/slides/src/themes/` and `model/presentation.ts`/`model/layout.ts`/`model/master.ts` and match the real shapes. The test in Step 1 is the correctness gate.

- [x] **Step 4: Export from barrel**

```ts
// packages/board/src/index.ts
export * from './view/viewport';
export * from './model/board';
```

- [x] **Step 5: Run test + typecheck**

Run: `pnpm --filter @wafflebase/board test board && pnpm --filter @wafflebase/board typecheck`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add packages/board/src/model/board.ts packages/board/src/model/board.test.ts packages/board/src/index.ts packages/slides/src/index.ts
git commit -m "Add board model + single-slide deck synthesizer" \
  -m "boardToSlidesDocument wraps the board's element array in a valid
one-slide deck (default theme/layout/master) so the slides renderer and
editor operate on a board unchanged." \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

# Stage 3 — Board Yorkie store (single-slide `SlidesStore` adapter)

## Task 7: `board-document` types + `initialBoardRoot` + presence

**Files:**
- Create: `packages/frontend/src/types/board-document.ts`
- Modify: `packages/frontend/src/types/documents.ts` (line 1 union)
- Test: `packages/frontend/src/types/board-document.test.ts`

**Interfaces:**
- Consumes: `YorkieElement` from `packages/frontend/src/types/slides-document.ts`.
- Produces:
  - `interface YorkieBoardRoot { meta: { title: string; unit?: 'in'|'cm'; recentColors?: string[] }; elements: YorkieElement[] }`
  - `function initialBoardRoot(): Partial<YorkieBoardRoot>`
  - `type BoardPresence` (shaped like `SlidesPresence` from `types/users.ts`)
  - `function boardUserColor(username: string): string`

- [x] **Step 1: Write the failing test**

```ts
// packages/frontend/src/types/board-document.test.ts
import { describe, it, expect } from 'vitest';
import { initialBoardRoot, boardUserColor } from './board-document';

describe('board-document', () => {
  it('initialBoardRoot seeds an empty elements array + title', () => {
    const r = initialBoardRoot();
    expect(r.elements).toEqual([]);
    expect(typeof r.meta?.title).toBe('string');
  });
  it('boardUserColor is deterministic per username', () => {
    expect(boardUserColor('kim')).toBe(boardUserColor('kim'));
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/frontend test board-document`
Expected: FAIL — module missing.

- [x] **Step 3: Implement `board-document.ts`**

```ts
// packages/frontend/src/types/board-document.ts
import type { YorkieElement } from './slides-document';

export interface YorkieBoardRoot {
  meta: { title: string; unit?: 'in' | 'cm'; recentColors?: string[] };
  elements: YorkieElement[];
}

export function initialBoardRoot(): Partial<YorkieBoardRoot> {
  return { meta: { title: 'Untitled board' }, elements: [] };
}

export type BoardPresence = {
  username: string;
  email: string;
  photo: string;
  selectedElementIds?: string[];
  cursor?: { x: number; y: number } | null; // world coords
};

const PALETTE = ['#F94144', '#F3722C', '#F8961E', '#43AA8B', '#577590', '#277DA1'];
export function boardUserColor(username: string): string {
  let h = 0;
  for (let i = 0; i < username.length; i++) h = (h * 31 + username.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}
```

- [x] **Step 4: Add `"board"` to `DocumentType`**

`packages/frontend/src/types/documents.ts:1`:

```ts
export type DocumentType = "sheet" | "doc" | "slides" | "pdf" | "note" | "image" | "board";
```

- [x] **Step 5: Run test + typecheck**

Run: `pnpm --filter @wafflebase/frontend test board-document`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add packages/frontend/src/types/board-document.ts packages/frontend/src/types/documents.ts packages/frontend/src/types/board-document.test.ts
git commit -m "Add board-document types + DocumentType board" \
  -m "YorkieBoardRoot (single elements plane), initialBoardRoot seed, and
BoardPresence for peer cursors, mirroring the slides document types." \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: `YorkieBoardStore implements SlidesStore`

**Files:**
- Create: `packages/frontend/src/app/board/yorkie-board-store.ts`
- Test: `packages/frontend/src/app/board/yorkie-board-store.test.ts`

**Interfaces:**
- Consumes: `SlidesStore`, `SlidesDocument`, `ElementInit`, `Frame` from `@wafflebase/slides`; `boardToSlidesDocument`, `SYNTHETIC_SLIDE_ID` from `@wafflebase/board`; `YorkieBoardRoot` from `types/board-document`; the Yorkie `batch/withUpdate` pattern from `yorkie-slides-store.ts`.
- Produces: `class YorkieBoardStore implements SlidesStore` with a real implementation of the element/connector/text/guide/batch/undo subset the editor calls on a board, and a `notSupported(name)` throw for slide/theme/master/layout/animation/table methods.

- [x] **Step 1: Enumerate the live method subset (concrete investigation step)**

Run: `rg -n "this\.options\.store\.|store\.(add|remove|update|reorder|group|ungroup|refit|bake|withText|withShape|withTable|insertTable|deleteTable|merge|unmerge|addGuide|moveGuide|removeGuide|batch|undo|redo|canUndo|canRedo|read|readMeta)" packages/slides/src/view/editor`
Record the exact set of `SlidesStore` methods the editor invokes. Those are implemented for real; everything else in the interface gets a `notSupported` stub. (Expected live set for SP1 shapes/text/connectors: `read`, `readMeta`, `addElement`, `removeElement(s)`, `updateElementFrame`, `updateElementData`, `reorderElement`, `group`, `ungroup`, `refitGroup`, `bakeGroupResize`, all `updateConnector*`, `withShapeText`, `withTextElement`, `addGuide`/`moveGuide`/`removeGuide`, `batch`, `onChange`, `undo`/`redo`/`canUndo`/`canRedo`, `pushRecentColor`, `setUnit`.)

- [x] **Step 2: Write the failing test**

Drive the store through the `SlidesStore` surface against an in-memory Yorkie doc (reuse the test harness `yorkie-slides-store.test.ts` uses — grep it for how it builds a `YorkieDocument<...>` fixture).

```ts
// packages/frontend/src/app/board/yorkie-board-store.test.ts
import { describe, it, expect } from 'vitest';
import { YorkieBoardStore } from './yorkie-board-store';
import { SYNTHETIC_SLIDE_ID } from '@wafflebase/board';
import { makeYorkieBoardDoc } from './__testkit__'; // mirror slides store test's doc factory

describe('YorkieBoardStore', () => {
  it('read() exposes one synthetic slide holding the elements', () => {
    const store = new YorkieBoardStore(makeYorkieBoardDoc());
    const doc = store.read();
    expect(doc.slides[0].id).toBe(SYNTHETIC_SLIDE_ID);
  });
  it('addElement then updateElementFrame mutates the elements plane (slideId ignored)', () => {
    const store = new YorkieBoardStore(makeYorkieBoardDoc());
    let id = '';
    store.batch(() => {
      id = store.addElement(SYNTHETIC_SLIDE_ID, /* minimal ShapeElement init */ makeShapeInit());
      store.updateElementFrame(SYNTHETIC_SLIDE_ID, id, { x: 40 });
    });
    expect(store.read().slides[0].elements.find((e) => e.id === id)?.frame.x).toBe(40);
  });
  it('throws notSupported on a slide-level method', () => {
    const store = new YorkieBoardStore(makeYorkieBoardDoc());
    expect(() => store.addSlide('layout')).toThrow(/not supported/i);
  });
  it('batch collapses N edits into one undo unit', () => {
    const store = new YorkieBoardStore(makeYorkieBoardDoc());
    store.batch(() => { store.addElement(SYNTHETIC_SLIDE_ID, makeShapeInit()); store.addElement(SYNTHETIC_SLIDE_ID, makeShapeInit()); });
    store.undo();
    expect(store.read().slides[0].elements).toHaveLength(0);
  });
});
```

> `makeShapeInit()` / `makeYorkieBoardDoc()` mirror the slides store test fixtures; grep `yorkie-slides-store.test.ts` and copy its element-init + doc-factory helpers, swapping `slides:[...]` for `elements:[...]`.

- [x] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/frontend test yorkie-board-store`
Expected: FAIL — class missing.

- [x] **Step 4: Implement the store**

Copy the `batch`/`withUpdate`/`notifyChange`/`onChange`/undo-floor scaffolding from `yorkie-slides-store.ts` verbatim (constructor subscribes to `remote-change`). Implement `read()` via `boardToSlidesDocument({ meta, elements })` from the live root; implement the element/connector/text/guide subset by mutating `root.elements` (ignore the `slideId` arg); add a `notSupported`:

```ts
// packages/frontend/src/app/board/yorkie-board-store.ts (skeleton — fill the live subset from Step 1)
import type { SlidesStore, SlidesDocument, ElementInit, Frame /* ... */ } from '@wafflebase/slides';
import { boardToSlidesDocument, SYNTHETIC_SLIDE_ID } from '@wafflebase/board';
import type { YorkieBoardRoot } from '../../types/board-document';
import type { Document as YorkieDocument } from '@yorkie-js/sdk'; // match slides store's import

function notSupported(name: string): never {
  throw new Error(`YorkieBoardStore: "${name}" is not supported on a board`);
}

export class YorkieBoardStore implements SlidesStore {
  private doc: YorkieDocument<YorkieBoardRoot>;
  private activeRoot: YorkieBoardRoot | null = null;
  private batchDepth = 0;
  private undoFloor: number;
  private changeListeners = new Set<() => void>();
  private onRemoteChange?: () => void;
  private unsubscribeDoc: () => void;

  constructor(doc: YorkieDocument<YorkieBoardRoot>) {
    this.doc = doc;
    this.undoFloor = this.doc.getUndoStackForTest().length;
    this.unsubscribeDoc = doc.subscribe((e) => {
      if (e.type === 'remote-change') { this.onRemoteChange?.(); this.notifyChange(); }
    });
  }

  private withUpdate(fn: (r: YorkieBoardRoot) => void): void {
    if (this.activeRoot) fn(this.activeRoot);
    else this.doc.update((r) => fn(r));
  }
  private notifyChange(): void { for (const cb of this.changeListeners) cb(); }

  read(): SlidesDocument {
    const r = this.doc.getRoot();
    return boardToSlidesDocument({ meta: r.meta, elements: r.elements as any });
  }
  readMeta() { return this.read().meta; }

  addElement(_slideId: string, init: ElementInit /*, parentGroupId? */): string {
    let id = '';
    this.withUpdate((r) => { /* push {id, ...init} onto r.elements using the same
      Yorkie array + generateId pattern as yorkie-slides-store.addElement */ });
    this.notifyChange();
    return id;
  }
  updateElementFrame(_slideId: string, elementId: string, frame: Partial<Frame>): void {
    this.withUpdate((r) => { /* find r.elements[i].id === elementId; assign frame keys */ });
    this.notifyChange();
  }
  // ...implement the remaining LIVE subset from Step 1 by adapting the
  //    body of the same-named method in yorkie-slides-store.ts, dropping the
  //    slideId lookup (there is exactly one plane: r.elements)...

  batch(fn: () => void): void {
    if (this.batchDepth > 0) { this.batchDepth++; try { fn(); } finally { this.batchDepth--; } return; }
    this.batchDepth++;
    try {
      this.doc.update((r) => {
        this.activeRoot = r;
        try { fn(); } finally { this.activeRoot = null; }
      });
    } finally { this.batchDepth--; this.notifyChange(); }
  }
  onChange(cb: () => void): () => void { this.changeListeners.add(cb); return () => this.changeListeners.delete(cb); }
  undo(): void { this.doc.history.undo(); this.notifyChange(); }   // match slides store's exact undo call
  redo(): void { this.doc.history.redo(); this.notifyChange(); }
  canUndo(): boolean { return this.doc.getUndoStackForTest().length > this.undoFloor; }
  canRedo(): boolean { return this.doc.getRedoStackForTest().length > 0; }

  // --- unsupported (slide/theme/master/layout/animation/table) ---
  addSlide(): string { return notSupported('addSlide'); }
  duplicateSlide(): string { return notSupported('duplicateSlide'); }
  // ...every non-live SlidesStore method → notSupported('<name>')...
}
```

> Fidelity rule: for each LIVE method, open `yorkie-slides-store.ts`, read the same-named method, and port its body dropping the `slides.find(s => s.id === slideId)` step (board has one `r.elements`). For undo/redo/canUndo/canRedo, copy the slides store's exact history calls (the skeleton above guesses `doc.history.*`/`getUndoStackForTest` — match reality).

- [x] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @wafflebase/frontend test yorkie-board-store && pnpm --filter @wafflebase/frontend typecheck`
Expected: PASS. Typecheck confirms every `SlidesStore` method is implemented (real or `notSupported`).

- [x] **Step 6: Commit**

```bash
git add packages/frontend/src/app/board/yorkie-board-store.ts packages/frontend/src/app/board/yorkie-board-store.test.ts packages/frontend/src/app/board/__testkit__.ts
git commit -m "Add YorkieBoardStore (single-slide SlidesStore adapter)" \
  -m "Satisfies the slides scene-store interface with one synthetic slide so
the editor is reused unmodified: element/connector/text/guide/batch/undo
are real against root.elements; slide/theme/master/layout/anim/table
methods throw notSupported (never reached in board UI)." \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

# Stage 4 — Board view + editor mount + document-type wiring

## Task 9: `board-view` — canvas/overlay host + editor mount + pan/zoom + presence

**Files:**
- Create: `packages/frontend/src/app/board/board-view.tsx`
- Reference (read first, mirror): `packages/frontend/src/app/slides/slides-view.tsx`

**Interfaces:**
- Consumes: `initialize` (slides editor factory) — `import { initialize } from '@wafflebase/slides'`; `YorkieBoardStore` (Task 8); `DEFAULT_VIEWPORT`, `zoomAt`, `panBy` (Task 5); `SYNTHETIC_SLIDE_ID` (Task 6); the Yorkie doc via `useDocument()` from `@yorkie-js/react` (match how `slides-view.tsx` obtains the doc).
- Produces: `export function BoardView({ documentId }: { documentId: string }): JSX.Element` mounting a full-window infinite canvas.

- [x] **Step 1: Read the template**

Read `packages/frontend/src/app/slides/slides-view.tsx` end-to-end. Note exactly how it: obtains the Yorkie doc, constructs the store, creates the `<canvas>` + overlay `<div>` refs, calls `initialize({ canvas, overlay, store, hostWidth, hostHeight, dpr, ... })`, wires a `ResizeObserver` → `editor.setHostSize(...)`, pushes peers via `editor.setPeers(...)`, and tears down on unmount. Mirror this structure.

- [x] **Step 2: Implement `board-view.tsx`**

Mirror `slides-view.tsx`, with these board-specific differences:
- Construct `new YorkieBoardStore(doc)` instead of `YorkieSlidesStore`.
- Hold viewport in a ref: `const vp = useRef<Viewport>(DEFAULT_VIEWPORT)`.
- Pass `viewport: vp.current` and `cull: true` into `initialize({ ... })` options; on every viewport change call `editor.markDirty()` + `editor.render()` (and re-pass the new viewport — since `initialize` snapshots `options`, expose a setter: add `setViewport(v: Viewport)` to the editor OR mutate `this.options.viewport` via a small editor method; the simplest is to add `setViewport` next to `setHostSize` in Task 3's editor edits — if not added there, add it now as a one-line editor method and re-run the slides suite).
- Wheel handler: `ctrl/⌘ + wheel` → `vp.current = zoomAt(vp.current, {x: e.offsetX, y: e.offsetY}, e.deltaY < 0 ? 1.1 : 1/1.1)`; plain wheel → `panBy(vp.current, -e.deltaX, -e.deltaY)`. `preventDefault()` and repaint.
- Space-drag / middle-drag → `panBy`.
- Presence: read peers from the Yorkie doc presence (mirror slides-view's peer plumbing) and `editor.setPeers(peers)`; publish this client's `cursor` (world coords via `screenToWorld`) into presence on pointer move.

- [x] **Step 3: Add the editor `setViewport` method (if not already present)**

In `editor.ts`, next to `setHostSize`:

```ts
setViewport(viewport: Viewport): void {
  this.options.viewport = viewport;
  this.markDirty();
  this.render();
}
```

Add `setViewport(viewport: Viewport): void;` to the `SlidesEditor` interface. Import `Viewport`. Re-run: `pnpm --filter @wafflebase/slides test` (regression gate — no existing test exercises `setViewport`, so all stay green).

- [x] **Step 4: Typecheck + build the frontend**

Run: `pnpm --filter @wafflebase/frontend typecheck`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/frontend/src/app/board/board-view.tsx packages/slides/src/view/editor/editor.ts
git commit -m "Add board-view: infinite canvas mount + pan/zoom + presence" \
  -m "Mounts the reused slides editor with a board viewport + culling,
wires wheel/space pan and ctrl-wheel cursor-anchored zoom, and publishes
peer cursors via Yorkie presence. Adds editor.setViewport." \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: `board-detail` mount + route + document paths

**Files:**
- Create: `packages/frontend/src/app/board/board-detail.tsx`
- Modify: `packages/frontend/src/App.tsx` (lazy import + route), `packages/frontend/src/app/documents/document-list-utils.ts` (`getDocumentPath`)
- Reference: `packages/frontend/src/app/notes/notes-detail.tsx`

**Interfaces:**
- Consumes: `DocumentProvider` from `@yorkie-js/react`; `initialBoardRoot`, `boardUserColor` (Task 7); `BoardView` (Task 9).
- Produces: `export function BoardDetail(): JSX.Element` and route `/b/:id`.

- [x] **Step 1: Implement `board-detail.tsx`** (mirror `notes-detail.tsx` verbatim, swapping the docKey/root/presence/inner view)

```tsx
// packages/frontend/src/app/board/board-detail.tsx
import { useParams, Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { DocumentProvider } from '@yorkie-js/react';
import { fetchMe } from '../../api/auth'; // match notes-detail's exact import
import { Loader } from '../../components/loader'; // match notes-detail's exact import
import { initialBoardRoot, boardUserColor } from '../../types/board-document';
import { BoardView } from './board-view';

export function BoardDetail() {
  const { id } = useParams();
  const { data: currentUser, isLoading, isError } = useQuery({
    queryKey: ['me'], queryFn: fetchMe, retry: false, staleTime: 5 * 60 * 1000,
  });
  if (isLoading) return <Loader />;
  if (isError || !currentUser) return <Navigate to="/login" replace />;
  if (!currentUser.username || !currentUser.email) return <Loader />;
  return (
    <DocumentProvider
      docKey={`board-${id}`}
      initialRoot={initialBoardRoot()}
      initialPresence={{
        username: currentUser.username,
        email: currentUser.email,
        photo: currentUser.photo || '',
        selectedElementIds: [],
        cursor: null,
      }}
      enableDevtools={import.meta.env.DEV}
    >
      <BoardView documentId={id!} />
    </DocumentProvider>
  );
}
```

> Match the exact import paths/names from `notes-detail.tsx` (`fetchMe`, `Loader`, provider props) — they are the source of truth.

- [x] **Step 2: Add the route in `App.tsx`**

Near the other lazy detail imports (~line 28): `const BoardDetail = lazy(() => import('./app/board/board-detail').then(m => ({ default: m.BoardDetail })));` (match the file's exact lazy pattern.) Near the routes (~line 104): `<Route path="/b/:id" element={<BoardDetail />} />`.

- [x] **Step 3: Add `getDocumentPath` arm**

`document-list-utils.ts` (~85-99), in the type switch: `case "board": return `/b/${doc.id}`;`

- [x] **Step 4: Typecheck**

Run: `pnpm --filter @wafflebase/frontend typecheck`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/frontend/src/app/board/board-detail.tsx packages/frontend/src/App.tsx packages/frontend/src/app/documents/document-list-utils.ts
git commit -m "Wire board route /b/:id + Yorkie mount" \
  -m "BoardDetail mounts the board-<id> Yorkie doc via DocumentProvider and
renders BoardView; documents list routes board rows to /b/:id." \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Backend document-type acceptance (dto + docKey + v1)

**Files:**
- Modify: `packages/backend/src/document/document.dto.ts:13`, `packages/backend/src/yorkie/yorkie-doc-key.ts:12-41`, `packages/backend/src/api/v1/documents.controller.ts:54`
- Test: `packages/backend/src/yorkie/yorkie-doc-key.spec.ts` (add a board case)

**Interfaces:**
- Produces: backend accepts `type: "board"` on create and derives docKey prefix `board-`.

- [x] **Step 1: Write the failing test**

```ts
// add to packages/backend/src/yorkie/yorkie-doc-key.spec.ts
it('maps board → board- and round-trips', () => {
  expect(yorkieDocKeyPrefix('board')).toBe('board-');
  expect(parseYorkieDocKey('board-abc').type).toBe('board');
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/backend test yorkie-doc-key`
Expected: FAIL — `Unknown document type: board`.

- [x] **Step 3: Implement the three edits**

`document.dto.ts:13`:
```ts
const DOCUMENT_TYPES = ['sheet', 'doc', 'slides', 'pdf', 'note', 'image', 'board'] as const;
```
`yorkie-doc-key.ts`: add `| 'board'` to `DocumentTypeLike`; `board: 'board-'` to `YORKIE_DOC_KEY_PREFIXES`; `case 'board': return YORKIE_DOC_KEY_PREFIXES.board;` to the switch.
`api/v1/documents.controller.ts:54`: add `'board'` to the create allow-list ternary so v1 create preserves it.

- [x] **Step 4: Run test + backend unit suite**

Run: `pnpm --filter @wafflebase/backend test yorkie-doc-key`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/backend/src/document/document.dto.ts packages/backend/src/yorkie/yorkie-doc-key.ts packages/backend/src/api/v1/documents.controller.ts packages/backend/src/yorkie/yorkie-doc-key.spec.ts
git commit -m "Accept board document type in backend" \
  -m "DOCUMENT_TYPES, docKey prefix map/switch, and v1 create allow-list
learn board-<id>; auth/event webhooks parse it via the shared map." \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Documents-list creation + icon/label + shared-view + share-link union

**Files:**
- Modify: `packages/frontend/src/app/documents/document-list.tsx` (`TYPE_META` ~136-143; New menus ~935-956 and ~1156-1177), `packages/frontend/src/app/shared/shared-document.tsx` (docKey builder ~700-707; render switch ~716-758; lazy import ~64-79), `packages/frontend/src/api/share-links.ts:18`

**Interfaces:**
- Produces: "New Board" creates a `type:"board"` doc and opens `/b/:id`; the list renders a board icon/label; a shared board link resolves and renders.

- [x] **Step 1: `TYPE_META.board` entry**

In `document-list.tsx` `TYPE_META` (~136), add (pick a canvas-ish lucide icon already imported or import one, e.g. `LayoutDashboard`/`Frame`):

```ts
board: { label: 'Boards', Icon: Frame, color: 'text-fuchsia-600' },
```

- [x] **Step 2: "New Board" in both New dropdowns**

In both dropdowns (~935-956 and ~1156-1177), add a `DropdownMenuItem` mirroring the "New Slides" item, calling `createDocumentMutation.mutate({ title: 'Untitled board', type: 'board' })`.

- [x] **Step 3: shared-document.tsx arms**

- docKey builder (~700-707): add `resolved.type === 'board' ? `board-${resolved.id}`` arm.
- render switch (~716-758): add a `resolved.type === 'board'` branch mounting `BoardView` inside the shared layout (SP1: read-only acceptable; reuse `BoardView` with the shared doc). Add the lazy import near ~64-79 mirroring the slides one.

- [x] **Step 4: share-links.ts union**

`share-links.ts:18`: add `"board"` (and, incidentally, the already-missing `"image"`) to `ResolvedShareLink.type`.

- [x] **Step 5: Typecheck + build**

Run: `pnpm --filter @wafflebase/frontend typecheck && pnpm --filter @wafflebase/frontend build`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add packages/frontend/src/app/documents/document-list.tsx packages/frontend/src/app/shared/shared-document.tsx packages/frontend/src/api/share-links.ts
git commit -m "Add board to New menu, list icon, and shared view" \
  -m "New Board creates a board-<id> doc and opens /b/:id; the documents
list renders a board icon/label; shared board links resolve and render." \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Full verification + manual smoke

- [x] **Step 1: Run the full fast gate**

Run: `pnpm verify:fast`
Expected: lint + unit tests PASS across all packages.

- [x] **Step 2: Run the self gate (all builds)**

Run: `pnpm verify:self`
Expected: PASS — slides/board/frontend/backend all build; slides suite green (regression gate).

- [x] **Step 3: Manual smoke in `pnpm dev`**

```
docker compose up -d
pnpm dev
```
In the browser: create a **New Board** → lands on `/b/:id`. Verify: insert a shape, a text box, a connector; move/resize/rotate them; pan (space-drag / wheel) and zoom (⌘-wheel, cursor-anchored); open the same board in a second tab and confirm real-time sync + peer cursor. Confirm selection handles track under pan/zoom (overlay pan correctness).

- [x] **Step 4: Capture lessons + archive**

Fill `docs/tasks/active/20260723-board-canvas-skeleton-lessons.md`, then:
```bash
pnpm tasks:index
```
(Archive with `pnpm tasks:archive` only after the PR merges.)

- [x] **Step 5: Self-review the branch diff, then open the PR**

Dispatch `/code-review` (or `superpowers:requesting-code-review`) over the full branch diff; apply blocking findings. Then `git fetch && git rebase origin/main`, push, and open a PR titled `Add board infinite-canvas document type (SP1 canvas skeleton)` with Summary + Test plan.

---

## Self-Review (plan vs. spec)

- **Spec coverage:** new `"board"` type end-to-end (Tasks 7,10,11,12) ✓; `@wafflebase/board` package (Task 4) ✓; infinite pan/zoom + culling (Tasks 2,5,9) ✓; scene-engine reuse via viewport seam without forking editor (Tasks 1–3,8) ✓; Yorkie collab + presence cursors (Tasks 8,9) ✓; slides regression gate (Tasks 2,3,9 Step-7/gate) ✓; docKey `board-<id>` (Task 11) ✓. Non-goals (sticky/image/Miro/minimap/PPTX) are absent by construction ✓.
- **Type consistency:** `Viewport{panX,panY,zoom}` and `worldToScreen/screenToWorld` are defined once (Task 1) and reused (Tasks 2,3,5,9); `SYNTHETIC_SLIDE_ID='board'` defined in Task 6, used in Tasks 8,9; `YorkieBoardRoot` defined Task 7, used Task 8; `boardToSlidesDocument` defined Task 6, used Task 8.
- **Known investigation seams (not placeholders — concrete grep/read steps):** exact default-theme/layout/master constructors (Task 6 Step 3), the live `SlidesStore` subset (Task 8 Step 1), the slides-view mount structure (Task 9 Step 1), and exact undo/redo history calls (Task 8 Step 4). Each is a bounded, verifiable step against a named source file, guarded by a test.
- **Scope:** single implementation plan; SP2 (sticky/image) and SP3 (Miro import) are out of scope by the spec's decomposition.

---

## Results / Review (completed 2026-07-25)

All 13 tasks implemented via subagent-driven development (fresh implementer +
spec/quality review per task), plus a whole-branch review and fix wave.

**Outcome:** `"board"` document type + `@wafflebase/board` package shipped. A
board is an infinite pan/zoom canvas reusing the slides scene engine via an
injected `Viewport`; created from the documents list, routed to `/b/:id`,
collaboratively editable (shapes / text boxes / connectors: add/move/resize/
rotate/snap), and shareable. `verify:self` green across all 11 lanes.

**Test counts:** slides 2626 (incl. new viewport/overlay/suppressSlideChrome/
keymap tests), frontend 874, backend 345, sheets 1414, docs 1120, notes 27,
cli 231; board own: viewport 3 / deck 2 / wheel 5 / store 4.

**Whole-branch review caught a Critical the per-task reviews missed:** the reused
editor's context menu + keymap invoke slide-scoped store methods (`applyLayout`,
`duplicateSlide`, `addSlide`) that throw `notSupported` on a board → crash on
right-click / Cmd+D / Cmd+Shift+D / Cmd+M. Fixed with a `suppressSlideChrome`
editor option (omits slide-scoped menu items + gates the keymap shortcuts) and a
paste filter that strips `'table'` elements. Also closed the shared-viewer
authorization gap by forwarding `readOnly` to the editor. Re-review confirmed
findings closed with no regressions.

**Deferred to SP2** (tracked, non-blocking for the skeleton): guides round-trip;
group/ungroup direct tests; peer-cursor dot rendering; `read()` O(n) → spatial
index; paste-group-containing-table drop precision; Cmd+C table-filter symmetry.

**Chunk gate:** `maxChunkCount` bumped 135 → 140 in `harness.config.json` for the
board lazy chunks (documented reason appended per repo convention).
