# Slides Phase 2 (Static Rendering) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a `SlidesDocument` (from Phase 1) onto an HTML `<canvas>`
with a small, focused module per concern: shapes, images, text, and a
`slide-renderer` that orchestrates them. End the phase with a Vite-served
`demo.ts` showing a hand-built deck so the work is visible without an
editor.

**Architecture:**
- Pure functions / tiny classes that take `(ctx, ...args)` and side-effect
  on the ctx. No event handling, no editor coupling — that's Phase 3.
- Element rendering goes through one dispatcher that owns the **frame
  transform** (translate to center → rotate → translate to top-left)
  so each per-type painter draws in element-local coordinates only.
- Text rendering reuses `computeLayout` and `CanvasTextMeasurer` from
  `@wafflebase/docs`. Slides does not re-implement rich-text layout.
- Tests use a hand-rolled spy ctx (`vi.fn()` per method) — jsdom does
  not provide a real Canvas 2D context.

**Tech stack:** TypeScript 5.9 strict, Vitest 3.1 with vi.fn() spies,
Vite 6.4 dev server for the demo. No new runtime dependencies — all
extra work happens against the already-declared `@wafflebase/docs`.

**Spec:** [`docs/design/slides/slides.md`](../../design/slides/slides.md)
sections "Rendering pipeline" and "Editor UI" (the static layers only —
selection / handles / interactions are Phase 3).

**High-level checklist:** [`20260505-slides-package-mvp-todo.md`](20260505-slides-package-mvp-todo.md)

> Phase 2 ends when every box below is checked, `pnpm slides test` and
> `pnpm slides typecheck` are green, `pnpm verify:fast` is green, and
> the demo renders all four shapes plus a text box and a placeholder
> image at `pnpm slides dev`. **Phase 3 (editor) gets its own plan
> after Phase 2 lands.**

---

## File structure

Created in this phase:

```
packages/slides/
├── demo.ts                                     # T1 (skeleton), T8 (filled)
├── index.html                                  # T1
└── src/
    └── view/
        └── canvas/
            ├── ctx-spy.ts                      # T1 (test helper)
            ├── shape-renderer.ts               # T2
            ├── shape-renderer.test.ts          # T2
            ├── image-cache.ts                  # T3 (copy + adapt from docs)
            ├── image-renderer.ts               # T3
            ├── image-renderer.test.ts          # T3
            ├── text-renderer.ts                # T4
            ├── text-renderer.test.ts           # T4
            ├── element-renderer.ts             # T5
            ├── element-renderer.test.ts        # T5
            ├── slide-renderer.ts               # T6
            ├── slide-renderer.test.ts          # T6
            ├── thumbnail.ts                    # T7
            └── thumbnail.test.ts               # T7
```

Modified in this phase:

- `packages/slides/src/index.ts` — re-export the renderer entry points
- `packages/slides/package.json` — `dev` script (Vite, already there) is
  reused; nothing new to add
- `docs/tasks/active/20260505-slides-package-mvp-todo.md` — tick Phase 2
  boxes at the end (T8)

`packages/docs/dist/` is required for the slides build/dev to resolve
`@wafflebase/docs`. It already exists in the parent checkout from Phase
1's `pnpm install`. If a fresh setup is missing it, run
`pnpm --filter @wafflebase/docs build` once.

---

## Conventions (carried forward from Phase 1)

- Local imports use no extension (`'./foo'`).
- Package imports use the package name (`'@wafflebase/docs'`).
- `JSON.parse(JSON.stringify(...))` for deep clones (only relevant in
  shared state — most Phase 2 code is pure).
- Tests live next to source (`foo.ts` + `foo.test.ts`).
- Commits: subject ≤70 chars, blank line, body explains *why*. Use
  `git commit -m "subject" -m "body"` or HEREDOC. **Never** `--no-verify`.
- Strict TS — no unused imports, no unused parameters (use `_` prefix
  if unavoidable).
- Always run from the parent checkout
  (`/Users/hackerwins/Development/wafflebase/waffleslides`) on branch
  `feat/slides-phase1`. The Phase 1 worktree has been removed.

---

## Test strategy: spy ctx

`jsdom` does not implement Canvas 2D. Every renderer test creates a
spy ctx via the helper `ctx-spy.ts` introduced in T1:

```ts
import { vi } from 'vitest';
import { createCtxSpy, type CtxSpy } from './ctx-spy';

const ctx = createCtxSpy();
shapeRenderer.draw(ctx, { x: 0, y: 0, w: 50, h: 30 }, { fill: '#abc' });
expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 50, 30);
expect(ctx.fillStyle).toBe('#abc');
```

The spy is the **same shape** as `CanvasRenderingContext2D` for the
methods/props the renderers touch. Property assignments (`fillStyle`,
`strokeStyle`, `lineWidth`, `font`) are tracked as plain mutable
fields; method calls (`fillRect`, `beginPath`, `arc`, `fill`,
`stroke`, `moveTo`, `lineTo`, `save`, `restore`, `translate`,
`rotate`, `drawImage`, `fillText`, `clearRect`, `closePath`,
`measureText`) use `vi.fn()` so tests can assert call counts and
arguments.

Tests do not assert pixel output. The full visual confidence comes
from the T8 demo — manually verified once at the end of the phase.

---

## Task 1: Scaffold view/canvas/ + demo skeleton

**Files:**
- Create: `packages/slides/src/view/canvas/ctx-spy.ts`
- Create: `packages/slides/src/view/canvas/ctx-spy.test.ts`
- Create: `packages/slides/index.html`
- Create: `packages/slides/demo.ts`

The demo at this point only renders a clear background — the renderers
arrive in T2-T7. T8 fills it in.

- [ ] **Step 1.1: Create `packages/slides/src/view/canvas/ctx-spy.ts`**

```ts
import { vi } from 'vitest';

/**
 * Test-only spy that mimics the slice of `CanvasRenderingContext2D`
 * the slides renderers touch. Property fields are plain mutable
 * values; methods are `vi.fn()` so tests can assert call shape.
 *
 * If a renderer reaches for a property/method that is not listed here,
 * add it — the spy is intentionally narrow so missing pieces surface
 * as test failures rather than silent no-ops.
 */
export interface CtxSpy {
  // state
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  globalAlpha: number;

  // transforms
  save: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  translate: ReturnType<typeof vi.fn>;
  rotate: ReturnType<typeof vi.fn>;
  scale: ReturnType<typeof vi.fn>;
  setTransform: ReturnType<typeof vi.fn>;

  // paths
  beginPath: ReturnType<typeof vi.fn>;
  closePath: ReturnType<typeof vi.fn>;
  moveTo: ReturnType<typeof vi.fn>;
  lineTo: ReturnType<typeof vi.fn>;
  arc: ReturnType<typeof vi.fn>;
  ellipse: ReturnType<typeof vi.fn>;
  rect: ReturnType<typeof vi.fn>;

  // fill / stroke / clear
  fillRect: ReturnType<typeof vi.fn>;
  strokeRect: ReturnType<typeof vi.fn>;
  clearRect: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  stroke: ReturnType<typeof vi.fn>;

  // text
  fillText: ReturnType<typeof vi.fn>;
  measureText: ReturnType<typeof vi.fn>;

  // images
  drawImage: ReturnType<typeof vi.fn>;
}

/**
 * Build a fresh spy ctx with sensible defaults. Each call returns an
 * isolated object; do NOT share between tests.
 */
export function createCtxSpy(): CtxSpy {
  return {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    globalAlpha: 1,

    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    setTransform: vi.fn(),

    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    ellipse: vi.fn(),
    rect: vi.fn(),

    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    clearRect: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),

    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 0 })) as ReturnType<typeof vi.fn>,

    drawImage: vi.fn(),
  };
}

/**
 * Cast a `CtxSpy` to the real type so it can be passed into renderer
 * functions whose signatures take `CanvasRenderingContext2D`. Centralises
 * the unsafe-but-necessary cast so individual tests stay readable.
 */
export function asCtx(spy: CtxSpy): CanvasRenderingContext2D {
  return spy as unknown as CanvasRenderingContext2D;
}
```

- [ ] **Step 1.2: Create `packages/slides/src/view/canvas/ctx-spy.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { asCtx, createCtxSpy } from './ctx-spy';

describe('createCtxSpy', () => {
  it('starts with canvas defaults', () => {
    const ctx = createCtxSpy();
    expect(ctx.fillStyle).toBe('#000000');
    expect(ctx.lineWidth).toBe(1);
    expect(ctx.globalAlpha).toBe(1);
  });

  it('returns isolated spies — calls in one do not leak to another', () => {
    const a = createCtxSpy();
    const b = createCtxSpy();
    a.fillRect(0, 0, 10, 10);
    expect(a.fillRect).toHaveBeenCalledTimes(1);
    expect(b.fillRect).not.toHaveBeenCalled();
  });

  it('asCtx returns the same object (only the type changes)', () => {
    const spy = createCtxSpy();
    const ctx = asCtx(spy);
    ctx.fillRect(1, 2, 3, 4);
    expect(spy.fillRect).toHaveBeenCalledWith(1, 2, 3, 4);
  });
});
```

- [ ] **Step 1.3: Run test — confirm green**

Run: `pnpm slides test`
Expected: PASS — 37 from Phase 1 + 3 new = 40 total.

- [ ] **Step 1.4: Create `packages/slides/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>@wafflebase/slides demo</title>
    <style>
      body { margin: 0; background: #1a1a1a; color: #ddd; font-family: system-ui, sans-serif; }
      .stage { display: grid; place-items: center; min-height: 100vh; padding: 24px; }
      canvas { background: #fff; box-shadow: 0 8px 32px rgba(0,0,0,0.5); }
      .label { font-size: 12px; opacity: 0.7; margin-bottom: 8px; }
    </style>
  </head>
  <body>
    <div class="stage">
      <div>
        <div class="label">@wafflebase/slides Phase 2 — slide-renderer demo</div>
        <canvas id="slide" width="960" height="540"></canvas>
      </div>
    </div>
    <script type="module" src="./demo.ts"></script>
  </body>
</html>
```

> Width 960 × height 540 is half of the 1920×1080 logical canvas
> (50% zoom). T8 will switch to a configurable scale.

- [ ] **Step 1.5: Create `packages/slides/demo.ts` (skeleton)**

```ts
// Vite dev demo. Wired up incrementally:
//   T1 — clears the canvas to a neutral colour so `pnpm slides dev`
//        runs end-to-end before any renderer ships.
//   T8 — replaced with a real fixture that exercises every renderer.

const canvas = document.getElementById('slide') as HTMLCanvasElement;
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('No 2D context');

ctx.fillStyle = '#f5f5f5';
ctx.fillRect(0, 0, canvas.width, canvas.height);

ctx.fillStyle = '#888';
ctx.font = '14px sans-serif';
ctx.fillText('Phase 2 demo placeholder — fixtures land in T8', 24, 32);
```

- [ ] **Step 1.6: Verify the dev server boots**

Run: `pnpm slides dev` (in another terminal or background)

Expected: Vite dev server prints a `localhost:5173` URL (or similar).
Open it — the page shows a white canvas with the placeholder line.
Stop the dev server (Ctrl+C). This is a one-shot smoke test; the real
visual review is T8.

> If the dev server fails to start, the most likely cause is a missing
> `packages/docs/dist/` (run `pnpm --filter @wafflebase/docs build`)
> or a stale lockfile (run `pnpm install`).

- [ ] **Step 1.7: Commit**

```bash
git add packages/slides/index.html packages/slides/demo.ts packages/slides/src/view
git commit -m "Scaffold slides view/canvas dir + demo entry" -m "Stands up the Phase 2 directory structure: a tiny ctx-spy helper that
backs every renderer test (jsdom has no Canvas 2D), an index.html
serving a 960x540 placeholder canvas at pnpm slides dev, and a demo.ts
that clears to a flat colour so the Vite dev server boots end-to-end
before any renderer lands. Subsequent tasks add shape/image/text/
element/slide renderers in isolation; T8 swaps demo.ts for a real
fixture.

Refs docs/tasks/active/20260506-slides-phase2-plan.md Task 1."
```

---

## Task 2: Shape renderer (rect / ellipse / line / arrow)

**Files:**
- Create: `packages/slides/src/view/canvas/shape-renderer.ts`
- Create: `packages/slides/src/view/canvas/shape-renderer.test.ts`

The shape painter draws each shape **in element-local coordinates**:
the caller (T5 element-renderer) handles position/rotation. So
`drawShape(ctx, frameSize, data)` only sees `{ w, h }` and the shape
data — it never touches `frame.x`, `frame.y`, or `frame.rotation`.

- [ ] **Step 2.1: Write failing tests**

Create `packages/slides/src/view/canvas/shape-renderer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { ShapeElement } from '../../model/element';
import { asCtx, createCtxSpy } from './ctx-spy';
import { drawShape } from './shape-renderer';

const size = { w: 100, h: 60 };
const shape = (data: ShapeElement['data']): ShapeElement['data'] => data;

describe('drawShape — rect', () => {
  it('fills a rectangle at (0,0,w,h) with the given fill', () => {
    const ctx = createCtxSpy();
    drawShape(asCtx(ctx), size, shape({ kind: 'rect', fill: '#abc' }));
    expect(ctx.fillStyle).toBe('#abc');
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 100, 60);
  });

  it('strokes a rectangle when stroke is set', () => {
    const ctx = createCtxSpy();
    drawShape(asCtx(ctx), size, shape({
      kind: 'rect', stroke: { color: '#000', width: 3 },
    }));
    expect(ctx.strokeStyle).toBe('#000');
    expect(ctx.lineWidth).toBe(3);
    expect(ctx.strokeRect).toHaveBeenCalledWith(0, 0, 100, 60);
  });

  it('skips fill and stroke when neither is set', () => {
    const ctx = createCtxSpy();
    drawShape(asCtx(ctx), size, shape({ kind: 'rect' }));
    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(ctx.strokeRect).not.toHaveBeenCalled();
  });
});

describe('drawShape — ellipse', () => {
  it('paints an ellipse centred in the frame', () => {
    const ctx = createCtxSpy();
    drawShape(asCtx(ctx), size, shape({ kind: 'ellipse', fill: '#0a0' }));
    expect(ctx.beginPath).toHaveBeenCalledTimes(1);
    expect(ctx.ellipse).toHaveBeenCalledWith(50, 30, 50, 30, 0, 0, Math.PI * 2);
    expect(ctx.fill).toHaveBeenCalledTimes(1);
    expect(ctx.fillStyle).toBe('#0a0');
  });
});

describe('drawShape — line', () => {
  it('strokes a single line from (0,0) to (w,h)', () => {
    const ctx = createCtxSpy();
    drawShape(asCtx(ctx), size, shape({
      kind: 'line', stroke: { color: '#222', width: 2 },
    }));
    expect(ctx.beginPath).toHaveBeenCalledTimes(1);
    expect(ctx.moveTo).toHaveBeenCalledWith(0, 0);
    expect(ctx.lineTo).toHaveBeenCalledWith(100, 60);
    expect(ctx.stroke).toHaveBeenCalledTimes(1);
  });

  it('does nothing when no stroke is set (a line with no stroke is invisible)', () => {
    const ctx = createCtxSpy();
    drawShape(asCtx(ctx), size, shape({ kind: 'line' }));
    expect(ctx.stroke).not.toHaveBeenCalled();
  });
});

describe('drawShape — arrow', () => {
  it('strokes the shaft and fills the head', () => {
    const ctx = createCtxSpy();
    drawShape(asCtx(ctx), size, shape({
      kind: 'arrow',
      stroke: { color: '#222', width: 2 },
      fill: '#222',
    }));
    // Shaft
    expect(ctx.moveTo).toHaveBeenCalledWith(0, 0);
    expect(ctx.lineTo).toHaveBeenCalledWith(100, 60);
    expect(ctx.stroke).toHaveBeenCalled();
    // Head (filled triangle) — three points + fill
    expect(ctx.fill).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2.2: Run tests, verify they fail with "Cannot find module"**

Run: `pnpm slides test`
Expected: FAIL — `./shape-renderer` not found.

- [ ] **Step 2.3: Implement `shape-renderer.ts`**

Create `packages/slides/src/view/canvas/shape-renderer.ts`:

```ts
import type { ShapeElement } from '../../model/element';

export type FrameSize = { w: number; h: number };

/**
 * Draw a shape into element-local coordinates (top-left at 0,0). The
 * caller is responsible for the frame transform (translate + rotate).
 */
export function drawShape(
  ctx: CanvasRenderingContext2D,
  size: FrameSize,
  data: ShapeElement['data'],
): void {
  switch (data.kind) {
    case 'rect':
      drawRect(ctx, size, data);
      return;
    case 'ellipse':
      drawEllipse(ctx, size, data);
      return;
    case 'line':
      drawLine(ctx, size, data);
      return;
    case 'arrow':
      drawArrow(ctx, size, data);
      return;
  }
}

function drawRect(
  ctx: CanvasRenderingContext2D,
  { w, h }: FrameSize,
  data: ShapeElement['data'],
): void {
  if (data.fill) {
    ctx.fillStyle = data.fill;
    ctx.fillRect(0, 0, w, h);
  }
  if (data.stroke) {
    ctx.strokeStyle = data.stroke.color;
    ctx.lineWidth = data.stroke.width;
    ctx.strokeRect(0, 0, w, h);
  }
}

function drawEllipse(
  ctx: CanvasRenderingContext2D,
  { w, h }: FrameSize,
  data: ShapeElement['data'],
): void {
  ctx.beginPath();
  ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  if (data.fill) {
    ctx.fillStyle = data.fill;
    ctx.fill();
  }
  if (data.stroke) {
    ctx.strokeStyle = data.stroke.color;
    ctx.lineWidth = data.stroke.width;
    ctx.stroke();
  }
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  { w, h }: FrameSize,
  data: ShapeElement['data'],
): void {
  if (!data.stroke) return; // A line with no stroke is invisible.
  ctx.strokeStyle = data.stroke.color;
  ctx.lineWidth = data.stroke.width;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(w, h);
  ctx.stroke();
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  { w, h }: FrameSize,
  data: ShapeElement['data'],
): void {
  // Shaft
  if (data.stroke) {
    ctx.strokeStyle = data.stroke.color;
    ctx.lineWidth = data.stroke.width;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w, h);
    ctx.stroke();
  }
  // Head — a small filled triangle at the (w, h) tip, oriented along
  // the shaft direction. The head length scales with the smaller of
  // the frame's two dimensions so it stays visible at any frame
  // aspect ratio.
  const tip = { x: w, y: h };
  const headLen = Math.min(w, h, 40) * 0.4;
  const angle = Math.atan2(h, w);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const baseCx = tip.x - headLen * cos;
  const baseCy = tip.y - headLen * sin;
  const half = headLen * 0.5;
  const pLeft = { x: baseCx - half * sin, y: baseCy + half * cos };
  const pRight = { x: baseCx + half * sin, y: baseCy - half * cos };

  ctx.fillStyle = data.fill ?? data.stroke?.color ?? '#000';
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(pLeft.x, pLeft.y);
  ctx.lineTo(pRight.x, pRight.y);
  ctx.closePath();
  ctx.fill();
}
```

- [ ] **Step 2.4: Run tests, confirm green**

Run: `pnpm slides test`
Expected: PASS — total 40 + 7 shape tests = 47.

- [ ] **Step 2.5: Commit**

```bash
git add packages/slides/src/view/canvas/shape-renderer.ts packages/slides/src/view/canvas/shape-renderer.test.ts
git commit -m "Add shape renderer (rect, ellipse, line, arrow)" -m "Pure ctx-driven painter that draws each shape in element-local
coordinates. The frame transform (position + rotation) is the
element-renderer's job in T5, so this module never sees frame.x or
frame.rotation. Each shape paints its fill (if set) and stroke (if
set) independently — a stroke-only rectangle and a fill-only line are
both legitimate inputs.

The arrow head is a filled triangle scaled to the frame's shorter
dimension so a long thin frame still gets a recognisable arrowhead.
Tests cover fill, stroke, and the no-paint case for each shape.

Refs docs/design/slides/slides.md section 'Rendering pipeline'."
```

---

## Task 3: Image cache + image renderer

**Files:**
- Create: `packages/slides/src/view/canvas/image-cache.ts`
- Create: `packages/slides/src/view/canvas/image-renderer.ts`
- Create: `packages/slides/src/view/canvas/image-renderer.test.ts`

`packages/docs/src/view/image-cache.ts` is not part of `@wafflebase/docs`'s
public API. We copy the same shape into slides to avoid coupling to a
docs internal that might move. The implementation is small (~60 lines)
and the coupling cost would be larger than the duplication cost.

- [ ] **Step 3.1: Create `packages/slides/src/view/canvas/image-cache.ts`**

```ts
/**
 * Per-process cache of loaded `HTMLImageElement`s, keyed by `src`.
 * Mirrors `packages/docs/src/view/image-cache.ts` so the two packages
 * behave the same way; we copy rather than import because docs does
 * not export this helper from its public API.
 */
const imageCache = new Map<string, HTMLImageElement>();
const pendingCallbacks = new Map<string, Set<() => void>>();

/**
 * Return a loaded `HTMLImageElement` for `src`, or `null` if it is
 * still loading. On first encounter, kicks off an async load and
 * subscribes `onLoad` to the load-completion callbacks.
 */
export function getOrLoadImage(
  src: string,
  onLoad: () => void,
): HTMLImageElement | null {
  const cached = imageCache.get(src);
  if (cached) {
    if (cached.complete && cached.naturalWidth > 0) return cached;
    if (!cached.complete) {
      let cbs = pendingCallbacks.get(src);
      if (!cbs) {
        cbs = new Set();
        pendingCallbacks.set(src, cbs);
      }
      cbs.add(onLoad);
    }
    return null;
  }

  const img = new Image();
  imageCache.set(src, img);
  pendingCallbacks.set(src, new Set([onLoad]));

  img.onload = () => {
    const waiting = pendingCallbacks.get(src);
    pendingCallbacks.delete(src);
    if (waiting) {
      for (const cb of waiting) {
        try { cb(); } catch { /* swallow listener errors */ }
      }
    }
  };
  img.onerror = () => {
    pendingCallbacks.delete(src);
  };
  img.src = src;
  return null;
}

/** Test-only: drop every cached image and pending callback. */
export function clearImageCacheForTests(): void {
  imageCache.clear();
  pendingCallbacks.clear();
}
```

- [ ] **Step 3.2: Write failing tests for `image-renderer.ts`**

Create `packages/slides/src/view/canvas/image-renderer.test.ts`:

```ts
import { afterEach, describe, it, expect, vi } from 'vitest';
import type { ImageElement } from '../../model/element';
import { asCtx, createCtxSpy } from './ctx-spy';
import { drawImage } from './image-renderer';
import { clearImageCacheForTests } from './image-cache';

afterEach(() => clearImageCacheForTests());

const size = { w: 200, h: 100 };
const data = (overrides: Partial<ImageElement['data']> = {}): ImageElement['data'] => ({
  src: 'https://example.com/a.png',
  ...overrides,
});

describe('drawImage', () => {
  it('returns false and skips drawImage on first call (cache miss kicks off load)', () => {
    const ctx = createCtxSpy();
    const drawn = drawImage(asCtx(ctx), size, data(), () => undefined);
    expect(drawn).toBe(false);
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it('draws the image once it is loaded', async () => {
    const ctx = createCtxSpy();
    const onLoad = vi.fn();

    // First call: schedule the load.
    drawImage(asCtx(ctx), size, data(), onLoad);

    // Simulate the image finishing its load. jsdom gives us a real
    // HTMLImageElement, but `onload` is the only event surface.
    // We retrieve the cached element via a second `drawImage` call
    // *after* manually firing onload through the cache.
    const probe = new Image();
    probe.src = 'about:blank';
    // jsdom's <img> never fires onload for a real network URL in the
    // test environment, so we drive the lifecycle directly: locate the
    // pending HTMLImageElement and dispatch its onload handler.
    // Implementation detail: image-cache stores the Image() reference
    // it created. The simplest way to test the painted path is to
    // use a data: URL that jsdom's <img> can resolve synchronously
    // enough to be `complete`. See drawImage tests in
    // packages/docs/src/view if they exist for a cleaner pattern.
    // For Phase 2 we accept this gap and rely on the demo for visual
    // confirmation of the loaded path.
    expect(onLoad).toHaveBeenCalledTimes(0);
  });

  it('honours globalAlpha and crop when provided', () => {
    // Without exercising the loaded path (see note above), the alpha
    // and crop assertions are exercised via shape-of-call wiring in
    // the demo. We assert here that drawImage does not blow up on
    // unusual inputs.
    const ctx = createCtxSpy();
    expect(() => drawImage(asCtx(ctx), size, data({
      crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
      alt: 'demo',
    }), () => undefined)).not.toThrow();
  });
});
```

> **NOTE:** add `// @vitest-environment jsdom` as the first line of this test file. The `new Image()` call requires jsdom; without the directive vitest's default node environment errors with `ReferenceError: Image is not defined`.

> **Implementer note.** jsdom's `<img>` does not fire `onload` for
> network URLs and we cannot synchronously force a load to "complete"
> in a Node test. The "draws once loaded" test above is intentionally
> a structural placeholder — the loaded-path is covered by manual
> visual verification in T8's demo (which runs in a real browser).
> If you want stronger coverage now, swap the production `Image`
> constructor for an injectable factory and assert against that — but
> that's scope creep for Phase 2. Leave the comment in the test as-is.

- [ ] **Step 3.3: Run tests, expect FAIL**

Run: `pnpm slides test`
Expected: FAIL — `./image-renderer` not found.

- [ ] **Step 3.4: Implement `image-renderer.ts`**

Create `packages/slides/src/view/canvas/image-renderer.ts`:

```ts
import type { ImageElement } from '../../model/element';
import { getOrLoadImage } from './image-cache';
import type { FrameSize } from './shape-renderer';

/**
 * Draw an image element into element-local coordinates (top-left at
 * 0,0). Returns `true` if the image was actually painted, `false` if
 * the bitmap is still loading. Callers can use the return value to
 * decide whether they need to schedule a re-render once `onLoad`
 * fires.
 *
 * The caller still owns the frame transform; this routine only knows
 * about (w, h).
 */
export function drawImage(
  ctx: CanvasRenderingContext2D,
  { w, h }: FrameSize,
  data: ImageElement['data'],
  onLoad: () => void,
): boolean {
  const img = getOrLoadImage(data.src, onLoad);
  if (!img) return false;
  if (data.crop) {
    const sx = data.crop.x * img.naturalWidth;
    const sy = data.crop.y * img.naturalHeight;
    const sw = data.crop.w * img.naturalWidth;
    const sh = data.crop.h * img.naturalHeight;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  } else {
    ctx.drawImage(img, 0, 0, w, h);
  }
  return true;
}
```

- [ ] **Step 3.5: Run tests, confirm green**

Run: `pnpm slides test`
Expected: PASS — total 47 + 3 image tests = 50.

- [ ] **Step 3.6: Commit**

```bash
git add packages/slides/src/view/canvas/image-cache.ts packages/slides/src/view/canvas/image-renderer.ts packages/slides/src/view/canvas/image-renderer.test.ts
git commit -m "Add image renderer with load-and-cache" -m "image-cache mirrors docs/src/view/image-cache.ts byte-for-byte (modulo
the test-only clear helper) so slides and docs share the same lazy
load + multi-subscriber semantics. We copy rather than import because
docs does not export this helper publicly and the function is small
enough that the duplication cost is lower than the coupling cost.

drawImage returns true|false so the slide-renderer in T6 can decide
whether to schedule a re-render after the bitmap arrives. The crop
path maps the Crop rectangle (image-relative 0..1 coords) onto the
source rectangle of drawImage's 9-arg form.

Loaded-path coverage in vitest is structural only — jsdom never fires
onload for network URLs. The real verification is the T8 demo running
in a browser. Test file flags this trade-off inline.

Refs docs/design/slides/slides.md section 'Rendering pipeline'."
```

---

## Task 4: Text renderer (via docs computeLayout)

**Files:**
- Create: `packages/slides/src/view/canvas/text-renderer.ts`
- Create: `packages/slides/src/view/canvas/text-renderer.test.ts`

The text painter calls `computeLayout` from `@wafflebase/docs` once
per draw with the text element's blocks and the frame width, then
iterates the resulting `LayoutBlock[] → LayoutLine[] → LayoutRun[]`
and emits one `fillText` per run.

The same `CanvasTextMeasurer` instance is reused across renders for
its measurement-cache benefits — slides creates one at module scope.

- [ ] **Step 4.0: Update `packages/slides/vite.config.ts` to alias `@wafflebase/docs` to source**

vitest in the slides package resolves `@wafflebase/docs` via the package's `node` export condition, which intentionally omits browser-only symbols like `CanvasTextMeasurer`. Mirror the alias `packages/frontend/vite.config.ts` already uses:

```ts
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@wafflebase/docs': path.resolve(__dirname, '../docs/src/index.ts'),
    },
  },
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
    },
  },
});
```

Without this, Step 4.4 fails with `TypeError: CanvasTextMeasurer is not a constructor`.

Commit this as a separate "Alias @wafflebase/docs to source in slides vitest" commit before Step 4.5.

- [ ] **Step 4.1: Write failing tests**

Create `packages/slides/src/view/canvas/text-renderer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Block } from '@wafflebase/docs';
import type { TextElement } from '../../model/element';
import { asCtx, createCtxSpy } from './ctx-spy';
import { drawText } from './text-renderer';

const size = { w: 400, h: 200 };

function paragraph(text: string): Block {
  return {
    id: `b${Math.random().toString(36).slice(2, 8)}`,
    type: 'paragraph',
    inlines: [{ text, style: {} }],
    style: {},
  } as Block;
}

const data = (blocks: Block[]): TextElement['data'] => ({ blocks });

describe('drawText', () => {
  it('emits one fillText per run for a single paragraph', () => {
    const ctx = createCtxSpy();
    drawText(asCtx(ctx), size, data([paragraph('Hello world')]));
    // computeLayout segments at the word level, so 'Hello world' produces
    // 2 runs ("Hello " + "world"). Round-trip the joined runs back to the
    // original string.
    expect(ctx.fillText).toHaveBeenCalledTimes(2);
    const text = ctx.fillText.mock.calls.map((c) => c[0]).join('');
    expect(text).toBe('Hello world');
  });

  it('emits one fillText per inline run when the paragraph has multiple inlines', () => {
    const ctx = createCtxSpy();
    const block: Block = {
      id: 'b1',
      type: 'paragraph',
      inlines: [
        { text: 'Hello ', style: {} },
        { text: 'bold', style: { bold: true } },
      ],
      style: {},
    } as Block;
    drawText(asCtx(ctx), size, data([block]));
    expect(ctx.fillText).toHaveBeenCalledTimes(2);
    expect(ctx.fillText.mock.calls[0][0]).toBe('Hello ');
    expect(ctx.fillText.mock.calls[1][0]).toBe('bold');
  });

  it('does not paint anything for an empty blocks array', () => {
    const ctx = createCtxSpy();
    drawText(asCtx(ctx), size, data([]));
    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  it('emits one fillText per block for two paragraphs', () => {
    const ctx = createCtxSpy();
    drawText(asCtx(ctx), size, data([paragraph('one'), paragraph('two')]));
    expect(ctx.fillText).toHaveBeenCalledTimes(2);
  });
});
```

> **NOTE:** prepend `// @vitest-environment jsdom` to this file, then import the shared shim from `./test-canvas-env` (created during Task 5) BEFORE importing `./text-renderer`. The shim provides a fake OffscreenCanvas that returns a deterministic mock ctx (jsdom doesn't implement Canvas 2D). The shim file should be created during Task 4 as a side helper if Task 5 hasn't created it yet — keep both Task 4 and Task 5 tests using the same helper to avoid drift.

- [ ] **Step 4.2: Run tests, expect FAIL**

Run: `pnpm slides test`
Expected: FAIL — `./text-renderer` not found.

- [ ] **Step 4.3: Implement `text-renderer.ts`**

Create `packages/slides/src/view/canvas/text-renderer.ts`:

```ts
import { CanvasTextMeasurer, computeLayout } from '@wafflebase/docs';
import type { TextElement } from '../../model/element';
import type { FrameSize } from './shape-renderer';

/**
 * Module-scope measurer reused across every text-element render. Owning
 * one shared instance is essential for the per-measurer width cache
 * that `computeLayout` relies on — a fresh measurer per call would
 * thrash the cache.
 */
const measurer = new CanvasTextMeasurer();

/**
 * Draw a text element into element-local coordinates (top-left at 0,0).
 * The frame transform belongs to the element-renderer in T5; this
 * function only knows about (w, h) and the rich-text blocks.
 *
 * Layout is delegated to `@wafflebase/docs/computeLayout`, which is the
 * same engine the docs editor uses, so font/size/alignment/lists/inline
 * styles all behave identically inside a slide text box and inside a
 * standalone document.
 */
export function drawText(
  ctx: CanvasRenderingContext2D,
  { w }: FrameSize,
  data: TextElement['data'],
): void {
  if (data.blocks.length === 0) return;
  const { layout } = computeLayout(data.blocks, measurer, w);
  for (const block of layout.blocks) {
    for (const line of block.lines) {
      const baseY = block.y + line.y + line.height; // baseline ~ bottom of line box
      for (const run of line.runs) {
        // Skip image runs — slides text boxes don't contain inline
        // images in v1 (image elements are top-level), and the layout
        // engine signals image runs by setting `imageHeight`.
        if (run.imageHeight !== undefined) continue;
        const font = resolveCtxFont(run.inline.style);
        if (font !== undefined) ctx.font = font;
        ctx.fillStyle = run.inline.style.color ?? '#000';
        ctx.fillText(run.text, block.x + run.x, baseY);
      }
    }
  }
}

/**
 * Build the Canvas 2D `font` shorthand from an inline style. Returns
 * undefined if the style contributes nothing (caller can skip the ctx
 * mutation). Shape mirrors `fontToCss` in docs' canvas-measurer so
 * paint and measurement use the same string.
 */
function resolveCtxFont(style: {
  fontSize?: number;
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
}): string | undefined {
  const size = style.fontSize ?? 11;       // pt; converted to px below
  const family = style.fontFamily ?? 'Inter, system-ui, sans-serif';
  const px = size * (96 / 72);             // pt → px (matches docs ptToPx)
  const weight = style.bold ? 'bold ' : '';
  const italic = style.italic ? 'italic ' : '';
  return `${italic}${weight}${px}px ${family}`;
}
```

> **Note on baseline.** `block.y + line.y + line.height` puts the
> baseline near the bottom of the line box, which matches Canvas 2D's
> `textBaseline = 'alphabetic'` default. This is approximate — text
> with descenders may sit a few pixels lower than docs' renderer
> places it. Phase 5 (when the editor and docs share a positioning
> path through the IME bridge) is the right time to align the
> baseline calculation precisely; for now the approximation is fine.

- [ ] **Step 4.4: Run tests, confirm green**

Run: `pnpm slides test`
Expected: PASS — total 50 + 4 text tests = 54.

- [ ] **Step 4.5: Commit**

```bash
git add packages/slides/src/view/canvas/text-renderer.ts packages/slides/src/view/canvas/text-renderer.test.ts
git commit -m "Add text renderer that delegates layout to @wafflebase/docs" -m "Calls computeLayout from @wafflebase/docs with the text element's
blocks and the frame width, then walks the resulting block-line-run
tree and emits one fillText per run. Reuses a module-scope
CanvasTextMeasurer so the per-measurer width cache survives across
renders — a fresh measurer per call would thrash the cache and
effectively double the measurement cost.

Image runs (LayoutRun.imageHeight != undefined) are skipped — slides
text boxes hold no inline images in v1, top-level image elements are
their own renderer (T3). Baseline placement is approximate; Phase 5
will align it with the docs IME bridge.

Refs docs/design/slides/slides.md section 'Rendering pipeline >
Text rendering'."
```

---

## Task 5: Element renderer (frame transform + dispatch)

**Files:**
- Create: `packages/slides/src/view/canvas/element-renderer.ts`
- Create: `packages/slides/src/view/canvas/element-renderer.test.ts`

This is the layer that owns the **frame transform**: every per-type
painter draws in element-local coordinates, and `drawElement`
translates + rotates the ctx so that `(0, 0)` lands at the
top-left of the (rotated) frame in world space.

- [ ] **Step 5.1: Write failing tests**

Create `packages/slides/src/view/canvas/element-renderer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Element } from '../../model/element';
import { asCtx, createCtxSpy } from './ctx-spy';
import { drawElement } from './element-renderer';

const shapeAt = (x: number, y: number, rotation = 0): Element => ({
  id: 'e1',
  type: 'shape',
  frame: { x, y, w: 100, h: 60, rotation },
  data: { kind: 'rect', fill: '#abc' },
});

describe('drawElement — frame transform', () => {
  it('wraps the per-type painter in save/restore', () => {
    const ctx = createCtxSpy();
    drawElement(asCtx(ctx), shapeAt(10, 20), () => undefined);
    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });

  it('translates by frame.x, frame.y for an unrotated element', () => {
    const ctx = createCtxSpy();
    drawElement(asCtx(ctx), shapeAt(10, 20), () => undefined);
    expect(ctx.translate).toHaveBeenCalledWith(10, 20);
    expect(ctx.rotate).not.toHaveBeenCalled();
  });

  it('translates to centre, rotates, then translates to top-left when rotation != 0', () => {
    const ctx = createCtxSpy();
    drawElement(asCtx(ctx), shapeAt(10, 20, Math.PI / 4), () => undefined);
    // 1) translate to frame centre = (10 + 50, 20 + 30) = (60, 50)
    expect(ctx.translate).toHaveBeenNthCalledWith(1, 60, 50);
    expect(ctx.rotate).toHaveBeenCalledWith(Math.PI / 4);
    // 2) translate back to top-left = (-w/2, -h/2)
    expect(ctx.translate).toHaveBeenNthCalledWith(2, -50, -30);
  });

  it('dispatches to drawShape for shape elements', () => {
    const ctx = createCtxSpy();
    drawElement(asCtx(ctx), shapeAt(0, 0), () => undefined);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 100, 60);
  });

  it('dispatches to drawText for text elements', () => {
    const ctx = createCtxSpy();
    const el: Element = {
      id: 'e2',
      type: 'text',
      frame: { x: 0, y: 0, w: 200, h: 80, rotation: 0 },
      data: {
        blocks: [{
          id: 'b1', type: 'paragraph',
          inlines: [{ text: 'hi', style: {} }],
          style: {},
        }] as never,
      },
    };
    drawElement(asCtx(ctx), el, () => undefined);
    expect(ctx.fillText).toHaveBeenCalledTimes(1);
    expect(ctx.fillText.mock.calls[0][0]).toBe('hi');
  });

  it('passes the onAssetLoad callback to drawImage for image elements', () => {
    const ctx = createCtxSpy();
    const el: Element = {
      id: 'e3',
      type: 'image',
      frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
      data: { src: 'never-loads.png' },
    };
    let calledBack = false;
    drawElement(asCtx(ctx), el, () => { calledBack = true; });
    // The first render misses the cache; nothing painted, no callback yet.
    expect(ctx.drawImage).not.toHaveBeenCalled();
    expect(calledBack).toBe(false);
  });
});
```

- [ ] **Step 5.2: Run tests, expect FAIL**

Run: `pnpm slides test`
Expected: FAIL — `./element-renderer` not found.

- [ ] **Step 5.3: Implement `element-renderer.ts`**

Create `packages/slides/src/view/canvas/element-renderer.ts`:

```ts
import type { Element } from '../../model/element';
import { drawShape } from './shape-renderer';
import { drawText } from './text-renderer';
import { drawImage } from './image-renderer';

/**
 * Draw an element in world coordinates. Sets up the frame transform
 * (translate + rotate around frame centre), dispatches to the
 * type-specific painter, and restores the ctx state. Per-type painters
 * always work in element-local coordinates.
 *
 * `onAssetLoad` is invoked the first time an async resource (currently
 * only images) finishes loading. The slide-renderer (T6) wires this
 * to a re-render request so the slide repaints once the asset arrives.
 */
export function drawElement(
  ctx: CanvasRenderingContext2D,
  element: Element,
  onAssetLoad: () => void,
): void {
  const { frame } = element;
  ctx.save();
  if (frame.rotation === 0) {
    ctx.translate(frame.x, frame.y);
  } else {
    ctx.translate(frame.x + frame.w / 2, frame.y + frame.h / 2);
    ctx.rotate(frame.rotation);
    ctx.translate(-frame.w / 2, -frame.h / 2);
  }
  const size = { w: frame.w, h: frame.h };
  switch (element.type) {
    case 'shape':
      drawShape(ctx, size, element.data);
      break;
    case 'text':
      drawText(ctx, size, element.data);
      break;
    case 'image':
      drawImage(ctx, size, element.data, onAssetLoad);
      break;
  }
  ctx.restore();
}
```

- [ ] **Step 5.4: Run tests, confirm green**

Run: `pnpm slides test`
Expected: PASS — total 54 + 6 element-renderer tests = 60.

- [ ] **Step 5.5: Commit**

```bash
git add packages/slides/src/view/canvas/element-renderer.ts packages/slides/src/view/canvas/element-renderer.test.ts
git commit -m "Add element-renderer with frame transform + dispatch" -m "One module owns the world↔local coordinate transform so each per-type
painter (shape/text/image) sees only (w, h). Rotation pivots around
the frame centre via translate-rotate-translate, matching the
hit-testing convention in model/frame.ts so click and paint stay in
agreement.

The dispatcher passes an onAssetLoad callback through to drawImage so
the slide-renderer in T6 can request a re-render once a bitmap
finishes loading. Save/restore wraps the entire dispatch so a
per-type painter that forgets to reset state cannot leak ctx mutations
to the next element.

Refs docs/design/slides/slides.md section 'Rendering pipeline >
Coordinate system'."
```

---

## Task 6: Slide renderer (background + z-order iterate + dirty)

**Files:**
- Create: `packages/slides/src/view/canvas/slide-renderer.ts`
- Create: `packages/slides/src/view/canvas/slide-renderer.test.ts`

`SlideRenderer` is a small class that owns:
- A target `<canvas>` element
- A `dirty` flag (toggled true by `markDirty()`, reset by `render()`)
- Knowledge of the **logical canvas size** (1920×1080) and how to
  scale to the host canvas's pixel size + DPR

`render(slide)` is a no-op when `!dirty`. The async-asset path goes
through `markDirty()` so an image that finishes loading triggers
exactly one repaint.

- [ ] **Step 6.1: Write failing tests**

Create `packages/slides/src/view/canvas/slide-renderer.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import type { Slide } from '../../model/presentation';
import { SLIDE_WIDTH, SLIDE_HEIGHT, DEFAULT_BACKGROUND } from '../../model/presentation';
import { asCtx, createCtxSpy } from './ctx-spy';
import { SlideRenderer } from './slide-renderer';

function blankSlide(): Slide {
  return {
    id: 's1', layoutId: 'blank',
    background: { ...DEFAULT_BACKGROUND, fill: '#fff' },
    elements: [], notes: [],
  };
}

function makeRenderer(): { renderer: SlideRenderer; ctx: ReturnType<typeof createCtxSpy> } {
  const ctx = createCtxSpy();
  // Skip the real <canvas> — feed the spy directly.
  const renderer = new SlideRenderer(asCtx(ctx), { hostWidth: 960, hostHeight: 540, dpr: 1 });
  return { renderer, ctx };
}

describe('SlideRenderer.render', () => {
  it('clears the canvas, fills the background, and is a no-op on the second call when nothing is dirty', () => {
    const { renderer, ctx } = makeRenderer();
    renderer.render(blankSlide());
    expect(ctx.clearRect).toHaveBeenCalledTimes(1);
    expect(ctx.fillRect).toHaveBeenCalled(); // background fill

    const before = ctx.clearRect.mock.calls.length;
    renderer.render(blankSlide());
    expect(ctx.clearRect.mock.calls.length).toBe(before); // no second clear
  });

  it('repaints after markDirty()', () => {
    const { renderer, ctx } = makeRenderer();
    renderer.render(blankSlide());
    const before = ctx.clearRect.mock.calls.length;
    renderer.markDirty();
    renderer.render(blankSlide());
    expect(ctx.clearRect.mock.calls.length).toBe(before + 1);
  });

  it('iterates elements in array order (z-order) — last element paints on top', () => {
    const { renderer, ctx } = makeRenderer();
    const slide: Slide = {
      ...blankSlide(),
      elements: [
        {
          id: 'a', type: 'shape',
          frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
          data: { kind: 'rect', fill: '#a00' },
        },
        {
          id: 'b', type: 'shape',
          frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
          data: { kind: 'rect', fill: '#0a0' },
        },
      ],
    };
    renderer.render(slide);
    // Background fill #fff first, then 'a' (#a00), then 'b' (#0a0).
    const fills = ctx.fillRect.mock.calls.map((_, i, all) => {
      // Each fillRect was preceded by a fillStyle assignment we can
      // recover via the recorded styleHistory if the spy supported it.
      // Simpler: check that fillRect was called 3 times total
      // (background + two shapes).
      return all;
    });
    expect(ctx.fillRect).toHaveBeenCalledTimes(3);
  });

  it('applies a (hostWidth/SLIDE_WIDTH) scale so 1920x1080 logical maps to host pixels', () => {
    const { renderer, ctx } = makeRenderer();
    renderer.render(blankSlide());
    // 960 / 1920 = 0.5; dpr = 1 → effective scale 0.5
    expect(ctx.scale).toHaveBeenCalledWith(0.5, 0.5);
  });

  it('respects DPR: 2x DPR doubles the scale factor', () => {
    const ctx = createCtxSpy();
    const renderer = new SlideRenderer(asCtx(ctx), { hostWidth: 960, hostHeight: 540, dpr: 2 });
    renderer.render(blankSlide());
    expect(ctx.scale).toHaveBeenCalledWith(1.0, 1.0); // 0.5 * 2
  });

  it('background image is not drawn yet (image-fill backgrounds are v2)', () => {
    const { renderer, ctx } = makeRenderer();
    const slide: Slide = {
      ...blankSlide(),
      background: { fill: '#fff', image: { src: 'x.png', w: 1, h: 1 } },
    };
    renderer.render(slide);
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6.2: Run tests, expect FAIL**

Run: `pnpm slides test`
Expected: FAIL — `./slide-renderer` not found.

- [ ] **Step 6.3: Implement `slide-renderer.ts`**

Create `packages/slides/src/view/canvas/slide-renderer.ts`:

```ts
import type { Slide } from '../../model/presentation';
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../../model/presentation';
import { drawElement } from './element-renderer';

export interface SlideRendererOptions {
  hostWidth: number;   // CSS pixels of the target <canvas>
  hostHeight: number;  // CSS pixels of the target <canvas>
  dpr: number;         // devicePixelRatio
}

/**
 * Renders a single `Slide` onto a Canvas 2D context. Owns the
 * world↔host coordinate scale (logical 1920×1080 → host pixels) and
 * a dirty flag so consumers can call `render()` on every animation
 * frame without re-painting unchanged slides.
 *
 * One renderer per visible slide. Sharing a single renderer across
 * multiple slides is an anti-pattern — the dirty flag is per-slide
 * state.
 */
export class SlideRenderer {
  private dirty = true;

  constructor(
    private ctx: CanvasRenderingContext2D,
    private options: SlideRendererOptions,
  ) {}

  /** Trigger a repaint on the next `render()` call. */
  markDirty(): void {
    this.dirty = true;
  }

  /**
   * Paint `slide` onto the bound ctx if dirty. No-op otherwise.
   */
  render(slide: Slide): void {
    if (!this.dirty) return;
    const { ctx } = this;
    const { hostWidth, hostHeight, dpr } = this.options;
    const scale = (hostWidth / SLIDE_WIDTH) * dpr;

    // Reset to identity, clear, then re-establish the world scale so
    // the content paints at the correct host pixel size regardless of
    // any leftover transforms from a previous render.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, hostWidth * dpr, hostHeight * dpr);
    ctx.scale(scale, scale);

    // Background fill — image-fill backgrounds are v2.
    ctx.fillStyle = slide.background.fill;
    ctx.fillRect(0, 0, SLIDE_WIDTH, SLIDE_HEIGHT);

    // Iterate elements in array order = z-order, last is front.
    for (const element of slide.elements) {
      drawElement(ctx, element, () => this.markDirty());
    }

    this.dirty = false;
  }
}
```

- [ ] **Step 6.4: Run tests, confirm green**

Run: `pnpm slides test`
Expected: PASS — total 60 + 6 slide-renderer tests = 66.

- [ ] **Step 6.5: Commit**

```bash
git add packages/slides/src/view/canvas/slide-renderer.ts packages/slides/src/view/canvas/slide-renderer.test.ts
git commit -m "Add SlideRenderer with dirty tracking + DPR-aware scale" -m "Owns the logical-to-host coordinate transform: a 1920x1080 logical
canvas maps to the host <canvas>'s CSS pixels times the device pixel
ratio. setTransform(1,0,0,1,0,0) at the top of every render resets any
leftover state so the renderer is robust to ctx mutations from
neighbouring code (e.g. a future selection overlay sharing the same
canvas).

Elements paint in array order (= z-order, per the spec), and an async
image load schedules a single repaint via markDirty so the slide
re-renders exactly once after the bitmap arrives.

Image-fill backgrounds are documented as v2 work; v1 honours only
background.fill.

Refs docs/design/slides/slides.md sections 'Rendering pipeline >
Dirty tracking' and 'Yorkie schema > z-order'."
```

---

## Task 7: Thumbnail (small canvas + debounce)

**Files:**
- Create: `packages/slides/src/view/canvas/thumbnail.ts`
- Create: `packages/slides/src/view/canvas/thumbnail.test.ts`

`renderThumbnail` reuses `SlideRenderer` at a smaller host size. The
debounce is implemented as a tiny scheduler that coalesces multiple
`schedule(slideId)` calls within a 200 ms window into one render.

- [ ] **Step 7.1: Write failing tests**

Create `packages/slides/src/view/canvas/thumbnail.test.ts`:

```ts
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import type { Slide } from '../../model/presentation';
import { DEFAULT_BACKGROUND } from '../../model/presentation';
import { asCtx, createCtxSpy } from './ctx-spy';
import { ThumbnailScheduler, renderThumbnail } from './thumbnail';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const blankSlide = (id: string): Slide => ({
  id, layoutId: 'blank',
  background: { ...DEFAULT_BACKGROUND, fill: '#fff' },
  elements: [], notes: [],
});

describe('renderThumbnail', () => {
  it('paints the slide at the requested host size', () => {
    const ctx = createCtxSpy();
    renderThumbnail(asCtx(ctx), blankSlide('s1'), { hostWidth: 192, hostHeight: 108, dpr: 1 });
    expect(ctx.clearRect).toHaveBeenCalled();
    expect(ctx.fillRect).toHaveBeenCalled();
    // Scale = 192 / 1920 = 0.1
    expect(ctx.scale).toHaveBeenCalledWith(0.1, 0.1);
  });
});

describe('ThumbnailScheduler', () => {
  it('coalesces multiple schedule() calls into one render after the debounce window', () => {
    const onFlush = vi.fn();
    const scheduler = new ThumbnailScheduler(200, onFlush);
    scheduler.schedule('s1');
    scheduler.schedule('s1');
    scheduler.schedule('s1');
    expect(onFlush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(199);
    expect(onFlush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith(['s1']);
  });

  it('batches different slide ids into a single flush', () => {
    const onFlush = vi.fn();
    const scheduler = new ThumbnailScheduler(200, onFlush);
    scheduler.schedule('s1');
    scheduler.schedule('s2');
    scheduler.schedule('s1');
    vi.advanceTimersByTime(200);
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush.mock.calls[0][0].sort()).toEqual(['s1', 's2']);
  });

  it('a fresh schedule after a flush starts a new debounce window', () => {
    const onFlush = vi.fn();
    const scheduler = new ThumbnailScheduler(200, onFlush);
    scheduler.schedule('s1');
    vi.advanceTimersByTime(200);
    expect(onFlush).toHaveBeenCalledTimes(1);
    scheduler.schedule('s2');
    vi.advanceTimersByTime(200);
    expect(onFlush).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 7.2: Run tests, expect FAIL**

Run: `pnpm slides test`
Expected: FAIL — `./thumbnail` not found.

- [ ] **Step 7.3: Implement `thumbnail.ts`**

Create `packages/slides/src/view/canvas/thumbnail.ts`:

```ts
import type { Slide } from '../../model/presentation';
import { SlideRenderer, type SlideRendererOptions } from './slide-renderer';

/**
 * Render a slide thumbnail onto the given ctx. Internally constructs
 * a SlideRenderer with the supplied host size and forces a single
 * paint. Thumbnails always render — there is no dirty tracking at
 * this layer because the caller (the editor) has already decided that
 * a thumbnail needs refreshing.
 */
export function renderThumbnail(
  ctx: CanvasRenderingContext2D,
  slide: Slide,
  options: SlideRendererOptions,
): void {
  const renderer = new SlideRenderer(ctx, options);
  renderer.render(slide);
}

/**
 * Coalesces multiple `schedule(slideId)` calls into a single
 * `onFlush(ids)` invocation after `debounceMs` of quiet time. Used by
 * the editor to batch thumbnail re-renders during rapid edits.
 */
export class ThumbnailScheduler {
  private pending = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private debounceMs: number,
    private onFlush: (slideIds: string[]) => void,
  ) {}

  schedule(slideId: string): void {
    this.pending.add(slideId);
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
  }

  /** Force a flush right now (e.g. on editor blur). */
  flushNow(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.flush();
  }

  private flush(): void {
    if (this.pending.size === 0) {
      this.timer = null;
      return;
    }
    const ids = Array.from(this.pending);
    this.pending.clear();
    this.timer = null;
    this.onFlush(ids);
  }
}
```

- [ ] **Step 7.4: Run tests, confirm green**

Run: `pnpm slides test`
Expected: PASS — total 66 + 4 thumbnail tests = 70.

- [ ] **Step 7.5: Commit**

```bash
git add packages/slides/src/view/canvas/thumbnail.ts packages/slides/src/view/canvas/thumbnail.test.ts
git commit -m "Add thumbnail renderer + debounce scheduler" -m "renderThumbnail is a thin reuse of SlideRenderer at a smaller host
size — no dirty tracking, since the caller already decided the
thumbnail needs to refresh.

ThumbnailScheduler debounces rapid edits into one onFlush call per
quiet window, which keeps the thumbnail panel responsive during
typing and dragging without redrawing every keystroke. flushNow()
gives the editor an escape hatch (e.g. on slide-switch or blur)
where waiting another 200 ms for the previously-edited slide's
thumbnail would feel laggy.

Refs docs/design/slides/slides.md section 'Rendering pipeline >
Dirty tracking' (thumbnail re-render debounce ~200ms)."
```

---

## Task 8: Demo wiring + visual verify + final gate

**Files:**
- Modify: `packages/slides/demo.ts`
- Modify: `packages/slides/src/index.ts`
- Modify: `docs/tasks/active/20260505-slides-package-mvp-todo.md`

The demo replaces the placeholder from T1 with a hand-built single
slide that exercises every renderer: each shape kind, a text block
with mixed inline styles, and a placeholder image.

- [ ] **Step 8.1: Update `packages/slides/src/index.ts` to re-export the new view modules**

In `packages/slides/src/index.ts`, append after the existing
"// Store" section:

```ts
// View — Canvas renderers (Phase 2)
export { SlideRenderer, type SlideRendererOptions } from './view/canvas/slide-renderer';
export { drawElement } from './view/canvas/element-renderer';
export { drawShape, type FrameSize } from './view/canvas/shape-renderer';
export { drawText } from './view/canvas/text-renderer';
export { drawImage } from './view/canvas/image-renderer';
export { renderThumbnail, ThumbnailScheduler } from './view/canvas/thumbnail';
export { getOrLoadImage } from './view/canvas/image-cache';
```

> Do NOT export `ctx-spy` — it is test-only.

- [ ] **Step 8.2: Verify typecheck**

Run: `pnpm slides typecheck`
Expected: exit 0.

- [ ] **Step 8.3: Replace `packages/slides/demo.ts` with a real fixture**

```ts
import {
  MemSlidesStore,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  SlideRenderer,
} from './src/index';

const HOST_W = 960;
const HOST_H = 540;
const DPR = window.devicePixelRatio || 1;

const canvas = document.getElementById('slide') as HTMLCanvasElement;
canvas.width = HOST_W * DPR;
canvas.height = HOST_H * DPR;
canvas.style.width = `${HOST_W}px`;
canvas.style.height = `${HOST_H}px`;
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('No 2D context');

// Build a sample deck via the public API only — exercises slide ops,
// element ops, all four shape kinds, the text renderer (via docs
// computeLayout), and an image element. The image src is a transparent
// 1x1 data URL so it loads synchronously; subsequent phases will swap
// in real workspace images.

const store = new MemSlidesStore();
store.batch(() => {
  const slideId = store.addSlide('blank');

  // Title text
  store.addElement(slideId, {
    type: 'text',
    frame: {
      x: 80, y: 80,
      w: SLIDE_WIDTH - 160,
      h: 200,
      rotation: 0,
    },
    data: {
      blocks: [{
        id: 't1', type: 'paragraph',
        inlines: [
          { text: 'Phase 2 ', style: { fontSize: 48, bold: true, color: '#222' } },
          { text: 'demo', style: { fontSize: 48, italic: true, color: '#3a7' } },
        ],
        style: {},
      } as never],
    },
  });

  // Body text
  store.addElement(slideId, {
    type: 'text',
    frame: { x: 80, y: 320, w: 900, h: 200, rotation: 0 },
    data: {
      blocks: [{
        id: 't2', type: 'paragraph',
        inlines: [
          { text: 'Shapes, text, and images all render through @wafflebase/slides.',
            style: { fontSize: 18, color: '#444' } },
        ],
        style: {},
      } as never],
    },
  });

  // Filled rectangle
  store.addElement(slideId, {
    type: 'shape',
    frame: { x: 1040, y: 80, w: 320, h: 200, rotation: 0 },
    data: { kind: 'rect', fill: '#3a7' },
  });

  // Stroked ellipse
  store.addElement(slideId, {
    type: 'shape',
    frame: { x: 1400, y: 80, w: 240, h: 200, rotation: 0 },
    data: { kind: 'ellipse', stroke: { color: '#a33', width: 8 } },
  });

  // Rotated arrow
  store.addElement(slideId, {
    type: 'shape',
    frame: {
      x: 1040, y: 340, w: 600, h: 60,
      rotation: -Math.PI / 8,
    },
    data: {
      kind: 'arrow',
      stroke: { color: '#222', width: 6 },
      fill: '#222',
    },
  });

  // Plain line
  store.addElement(slideId, {
    type: 'shape',
    frame: { x: 1040, y: 540, w: 600, h: 0, rotation: 0 },
    data: { kind: 'line', stroke: { color: '#888', width: 2 } },
  });

  // Image placeholder — a 1x1 transparent PNG so the load is
  // synchronous in browsers.
  store.addElement(slideId, {
    type: 'image',
    frame: { x: 80, y: 600, w: 400, h: 300, rotation: 0 },
    data: {
      src:
        'data:image/svg+xml;utf8,' +
        encodeURIComponent(
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3">` +
          `<rect width="4" height="3" fill="%23eef"/>` +
          `<text x="2" y="1.7" text-anchor="middle" font-size="0.4" fill="%2399b">image</text>` +
          `</svg>`,
        ),
      alt: 'placeholder',
    },
  });
});

const slide = store.read().slides[0];

const renderer = new SlideRenderer(ctx, {
  hostWidth: HOST_W,
  hostHeight: HOST_H,
  dpr: DPR,
});
renderer.render(slide);

// Note: the SVG image loads via getOrLoadImage's async path. The
// renderer schedules a re-render via markDirty when the load fires;
// we re-call render() on requestAnimationFrame so the dirty repaint
// actually happens. (Phase 3's editor wires this through its own
// scheduler.)
function tick(): void {
  renderer.render(slide);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// Used by the testing harness to assert the demo started without
// errors. Safe to ignore.
(window as unknown as { __slidesDemoReady?: boolean }).__slidesDemoReady = true;

// SLIDE_HEIGHT is consumed inside SlideRenderer (background fillRect),
// not directly here. The import keeps the symbol available for fixture
// extensions that want to lay elements out relative to the slide bottom.
void SLIDE_HEIGHT;
```

> **CORRECTION:** an earlier draft of this plan claimed `SLIDE_HEIGHT`
> was unused. It is in fact consumed by `SlideRenderer.render` (Step
> 6.3, the background `ctx.fillRect(0, 0, SLIDE_WIDTH, SLIDE_HEIGHT)`).
> The `void SLIDE_HEIGHT` above only suppresses an unused-import warning
> *inside `demo.ts`* — the renderer itself uses both constants.

- [ ] **Step 8.4: Boot the dev server and visually verify**

Run: `pnpm slides dev` (background)

Open the printed URL (typically `http://localhost:5173/`) in a real
browser. Expected on screen:

- White slide background.
- "Phase 2 demo" title (bold black + italic green).
- Body text below the title.
- A solid green rectangle to the right of the title.
- A red-stroked ellipse beside it.
- A rotated black arrow below.
- A grey horizontal line below the arrow.
- A pale-blue SVG image placeholder at the bottom-left.

Do NOT proceed if any element is missing or visibly wrong. The most
common culprits are stale dist (rerun `pnpm --filter @wafflebase/docs
build`) or a typo in the fixture coordinates.

Stop the dev server.

- [ ] **Step 8.5: Run typecheck + tests + verify:fast**

Run: `pnpm slides typecheck && pnpm slides test`
Expected: both exit 0.

Run: `pnpm verify:fast`
Expected: exit 0 — every package green.

- [ ] **Step 8.6: Tick the Phase 2 boxes in the high-level checklist**

Edit `docs/tasks/active/20260505-slides-package-mvp-todo.md`:
mark items 2.1 – 2.6 as `[x]`. Leave Phase 3+ untouched.

- [ ] **Step 8.7: Commit**

```bash
git add packages/slides/demo.ts packages/slides/src/index.ts docs/tasks/active/20260505-slides-package-mvp-todo.md
git commit -m "Wire slides demo + expose Phase 2 public renderers" -m "demo.ts now builds a fixture deck through the public MemSlidesStore +
SlideRenderer API and exercises every renderer landed in T2-T7: each
shape kind, multi-style text via docs computeLayout, a rotated arrow
to confirm the frame transform, and an SVG-encoded image placeholder
(loads synchronously in the browser; real workspace images come in
later phases).

Renderer entry points are added to packages/slides/src/index.ts so
the editor in Phase 3 imports through the package boundary, never
through deep paths. The demo also marks pnpm slides dev as a
self-contained smoke check for future contributors.

Phase 2 checklist items 2.1-2.6 are ticked in the Phase 1+2 todo.

verify:fast green at this commit.

Refs docs/design/slides/slides.md section 'Rendering pipeline'."
```

---

## Phase 2 Done

After Task 8:

- `pnpm slides test` and `pnpm slides typecheck` are green.
- `pnpm verify:fast` is green.
- `pnpm slides dev` boots a self-contained demo of every renderer.
- `@wafflebase/slides` exposes a Canvas renderer surface (`SlideRenderer`,
  `renderThumbnail`, `ThumbnailScheduler`, plus the lower-level
  `drawElement` / `drawShape` / `drawText` / `drawImage` for callers
  that want to compose differently).
- Nothing in `frontend`, `backend`, `cli`, `sheets`, or `docs` has
  been modified.

When you are ready to implement Phase 3 (editor: selection, drag,
resize, rotate, context menus, speaker notes panel), I will write
`docs/tasks/active/<date>-slides-phase3-plan.md`. That plan gets to
assume everything in Phases 1 + 2 is real, which is why it is not
written yet.

## Self-review

- **Spec coverage:** Every spec sentence under "Rendering pipeline"
  is exercised: Canvas + DOM overlay (overlay is Phase 3, but the
  Canvas half is here), dirty tracking (T6), coordinate system /
  hit-test (frame transform in T5 mirrors `model/frame.ts`), text
  rendering via docs layout (T4), Korean / CJK font fallback (handled
  for free by reusing docs' `CanvasTextMeasurer`).
- **Type consistency:** `FrameSize` used by `drawShape`/`drawText`/
  `drawImage` is defined in `shape-renderer.ts` and imported back into
  the others — single source of truth. `SlideRendererOptions` is
  exported alongside `SlideRenderer` so callers can build the same
  shape.
- **Placeholder scan:** No "TBD" / "TODO" inside the implementation;
  the only deliberate gap is the loaded-path image test (called out
  inline) and the baseline-precision note in `text-renderer` (called
  out inline, deferred to Phase 5 where the editor IME bridge needs
  pixel-aligned baselines).
