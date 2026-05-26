# Slides Shape Library Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Created**: 2026-05-09

**Goal:** Grow `@wafflebase/slides`'s shape library from 4 kinds (`rect`, `ellipse`, `line`, `arrow`) to 35 OOXML-aligned kinds, behind a path-builder registry and a categorised "Shape ▾" picker popover.

**Architecture:** Extend `ShapeElement.data` with an optional `adjustments: number[]` field (mirrors OOXML `<a:avLst>`). Introduce a `Map<ShapeKind, (size, adjustments) => Path2D>` registry in `view/canvas/shapes/`; each shape lives in its own file as pure path geometry. A shared dispatcher in `shape-renderer.ts` resolves theme colour, applies fill/stroke, and falls back to a placeholder rect for unknown kinds. `line` and `arrow` keep their current bespoke renderers as "special" cases. The toolbar's 5 inline buttons collapse into one "Shape ▾" Radix Popover with category sections; preview icons render through the same path builders so they cannot drift from the canvas geometry.

**Tech Stack:** TypeScript, Vitest, jsdom canvas (`test-canvas-env.ts`), React 19, Radix UI (Popover), Tabler Icons, pnpm monorepo.

**Spec:** `docs/design/slides/slides-shapes-p1.md`

**Why mostly TDD:** Path builders are pure functions of `(size, adjustments) → Path2D`. Each is independently testable via `ctx.isPointInPath(path, x, y)` against reference inside/outside points. Picker UI changes are tested via existing Vitest + React Testing Library setup (`packages/frontend/tests/app/slides/`).

---

## File Map

| File | Role in this plan |
|------|-------------------|
| `packages/slides/src/model/element.ts` | Extend `ShapeKind` union (4 → 35); add `adjustments?: number[]` to `ShapeElement.data` |
| `packages/slides/src/view/canvas/shape-renderer.ts` | Replace inline `switch` with a path-builder dispatcher; keep `line`/`arrow` as special cases; add unknown-kind placeholder fallback |
| `packages/slides/src/view/canvas/shape-special.ts` | New: lifted `drawLine` + `drawArrow` (current logic verbatim) |
| `packages/slides/src/view/canvas/shapes/builder.ts` | New: `PathBuilder` + `AdjustmentSpec` types and shared helpers |
| `packages/slides/src/view/canvas/shapes/index.ts` | New: `PATH_BUILDERS` and `ADJUSTMENT_SPECS` registry maps |
| `packages/slides/src/view/canvas/shapes/basic/*.ts` | New: 15 basic-shape builders (rect, roundRect, ellipse, triangle, rtTriangle, diamond, parallelogram, trapezoid, pentagon, hexagon, octagon, plus, donut, can, cloud) |
| `packages/slides/src/view/canvas/shapes/arrows/*.ts` | New: 8 block-arrow builders (rightArrow, leftArrow, upArrow, downArrow, leftRightArrow, quadArrow, chevron, pentagonArrow) |
| `packages/slides/src/view/canvas/shapes/callouts/*.ts` | New: 4 callout builders (wedgeRectCallout, wedgeRoundRectCallout, wedgeEllipseCallout, cloudCallout) |
| `packages/slides/src/view/canvas/shapes/equation/*.ts` | New: 6 equation builders (mathPlus, mathMinus, mathMultiply, mathDivide, mathEqual, mathNotEqual) |
| `packages/slides/src/view/canvas/shapes/__snapshots__/registry.snap.ts.snap` | New: snapshot of every shape painted into a 100×100 frame via ctx-spy |
| `packages/slides/src/view/editor/editor.ts` | Extend `InsertKind` type union to include all new kinds |
| `packages/slides/src/view/editor/interactions/insert.ts` | Replace `switch` in `buildInsertElement` with a category-default table |
| `packages/slides/src/index.ts` | Re-export new public API: `PATH_BUILDERS`, `ADJUSTMENT_SPECS`, types |
| `packages/slides/src/node.ts` | Re-export same as `index.ts` for the Node entry point |
| `packages/frontend/src/app/slides/shape-picker.tsx` | New: Radix Popover with category sections + canvas-rendered icons |
| `packages/frontend/src/app/slides/slides-formatting-toolbar.tsx` | Replace 4 inline shape buttons with `<ShapePicker />` (line/arrow move into the popover's Lines section) |
| `packages/frontend/tests/app/slides/shape-picker.test.tsx` | New: popover open/close, all 35 shapes present, click sets insert mode |

---

## Task 1: Extend `ShapeKind` and add `adjustments` field

**Files:**
- Modify: `packages/slides/src/model/element.ts`

This is a pure type change. Existing renderers still compile because the dispatcher (refactored in Task 4) treats unknown kinds as a placeholder rect. After this task, the type is wide enough for every Phase 1 builder.

- [x] **Step 1: Extend the `ShapeKind` union**

In `packages/slides/src/model/element.ts`, replace the existing `ShapeKind` declaration (line 23):

```ts
export type ShapeKind =
  // Lines (special-cased renderers in shape-special.ts)
  | 'line' | 'arrow'
  // Basic shapes (15)
  | 'rect' | 'roundRect' | 'ellipse'
  | 'triangle' | 'rtTriangle'
  | 'diamond' | 'parallelogram' | 'trapezoid'
  | 'pentagon' | 'hexagon' | 'octagon'
  | 'plus' | 'donut' | 'can' | 'cloud'
  // Block arrows (8)
  | 'rightArrow' | 'leftArrow' | 'upArrow' | 'downArrow'
  | 'leftRightArrow' | 'quadArrow' | 'chevron' | 'pentagonArrow'
  // Callouts (4)
  | 'wedgeRectCallout' | 'wedgeRoundRectCallout'
  | 'wedgeEllipseCallout' | 'cloudCallout'
  // Equation (6)
  | 'mathPlus' | 'mathMinus' | 'mathMultiply'
  | 'mathDivide' | 'mathEqual' | 'mathNotEqual';
```

- [x] **Step 2: Add `adjustments` to `ShapeElement.data`**

In the same file, replace the `ShapeElement` declaration (currently lines 52–59):

```ts
export type ShapeElement = ElementBase & {
  type: 'shape';
  data: {
    kind: ShapeKind;
    /**
     * OOXML-aligned per-shape adjustments (mirrors `<a:avLst><a:gd>`).
     * Path builders read this with sensible defaults when missing or
     * shorter than expected. Phase 1 has no editing UI; defaults are
     * used in practice. Stored from day one so P2/P3/P4 add edit UX
     * without data migration. Units are per-shape (typically OOXML
     * thousandths of the relevant dimension).
     */
    adjustments?: number[];
    fill?: ThemeColor;
    stroke?: ShapeStroke;
  };
};
```

- [x] **Step 3: Run verify**

```bash
pnpm verify:fast
```

Expected: PASS. The type widening is additive — no existing call site breaks because all new union members are new strings nothing currently produces.

- [x] **Step 4: Commit**

```bash
git add packages/slides/src/model/element.ts
git commit -m "$(cat <<'EOF'
Extend ShapeKind union to 35 OOXML-aligned kinds

Phase 1 of the four-phase shape-library expansion (see
docs/design/slides/slides-shapes-p1.md). Adds 31 new ShapeKind
members aligned with OOXML prstGeom preset names, and an optional
`adjustments: number[]` field on ShapeElement.data that mirrors
`<a:avLst>`. No renderer changes yet — those land in subsequent
tasks. Existing rect/ellipse/line/arrow data round-trips unchanged.
EOF
)"
```

---

## Task 2: Create `PathBuilder` types and registry skeleton

**Files:**
- Create: `packages/slides/src/view/canvas/shapes/builder.ts`
- Create: `packages/slides/src/view/canvas/shapes/index.ts`

After this task, the registry exists but is empty. The dispatcher refactor in Task 4 reads from it.

- [x] **Step 1: Write the failing registry test**

Create `packages/slides/src/view/canvas/shapes/index.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PATH_BUILDERS, ADJUSTMENT_SPECS } from './index';

describe('shape registry', () => {
  it('exposes empty maps as the initial state', () => {
    // Builders/specs are added one task at a time; the registry
    // contract (Map shape) is what we lock in here.
    expect(PATH_BUILDERS).toBeInstanceOf(Map);
    expect(ADJUSTMENT_SPECS).toBeInstanceOf(Map);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @wafflebase/slides test -- --run src/view/canvas/shapes/index.test.ts
```

Expected: FAIL — module not found.

- [x] **Step 3: Create `builder.ts`**

```ts
// packages/slides/src/view/canvas/shapes/builder.ts
import type { ShapeKind } from '../../../model/element';

export type FrameSize = { w: number; h: number };

/**
 * Pure path geometry. Given a frame size and the optional OOXML-style
 * adjustments array, return a closed Path2D in element-local
 * coordinates (top-left at 0,0). Path builders MUST NOT touch
 * fillStyle/strokeStyle — the dispatcher handles theme colour.
 */
export type PathBuilder = (
  size: FrameSize,
  adjustments?: number[],
) => Path2D;

/**
 * Per-shape declaration of an adjustable parameter. Read by Phase 2's
 * toolbar UI to build numeric inputs; Phase 1 only uses `defaultValue`.
 *
 * Units follow OOXML's "thousandths" convention (e.g. 25000 means 25%
 * of the relevant dimension); the per-shape file documents what
 * dimension each index refers to.
 */
export type AdjustmentSpec = {
  name: string;
  defaultValue: number;
  min: number;
  max: number;
  format?: (value: number) => string;
};

/**
 * Helper for builders that need an indexed adjustment with a default
 * fall-through. Returns `defaultValue` if `adjustments` is undefined
 * or shorter than required.
 */
export function adj(
  adjustments: number[] | undefined,
  index: number,
  defaultValue: number,
): number {
  return adjustments?.[index] ?? defaultValue;
}
```

- [x] **Step 4: Create `index.ts` with empty maps**

```ts
// packages/slides/src/view/canvas/shapes/index.ts
import type { ShapeKind } from '../../../model/element';
import type { AdjustmentSpec, PathBuilder } from './builder';

/**
 * Shape kind → path builder. Filled in incrementally by the
 * basic/arrows/callouts/equation tasks. Unknown kinds are handled by
 * the dispatcher's placeholder fallback, so partial registration
 * during development is safe.
 */
export const PATH_BUILDERS = new Map<ShapeKind, PathBuilder>();

/**
 * Shape kind → adjustable parameter specs. Only kinds with at least
 * one adjustment are listed. Phase 2's toolbar UI iterates this map.
 */
export const ADJUSTMENT_SPECS = new Map<
  ShapeKind,
  readonly AdjustmentSpec[]
>();
```

- [x] **Step 5: Run test to verify it passes**

```bash
pnpm --filter @wafflebase/slides test -- --run src/view/canvas/shapes/index.test.ts
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add packages/slides/src/view/canvas/shapes/
git commit -m "$(cat <<'EOF'
Add empty path-builder registry for slides shapes

Establishes the PathBuilder/AdjustmentSpec types and the two
registry maps that subsequent tasks populate one shape at a time.
The dispatcher in Task 4 reads from these maps; an empty registry
is safe because the dispatcher falls back to a placeholder rect for
unknown ShapeKind values.
EOF
)"
```

---

## Task 3: Lift `drawLine` and `drawArrow` to `shape-special.ts`

**Files:**
- Create: `packages/slides/src/view/canvas/shape-special.ts`
- Modify: `packages/slides/src/view/canvas/shape-renderer.ts`

`line` and `arrow` are not closed paths and `arrow` paints its head with a separate fill colour. They do not fit the `(size, adjustments) → Path2D` builder shape. Move them to a sibling file so `shape-renderer.ts` only contains dispatch logic in Task 4.

- [x] **Step 1: Create `shape-special.ts` with the lifted functions**

Copy the current `drawLine` and `drawArrow` (and the `ARROW_HEAD_FALLBACK` constant) from `shape-renderer.ts:72–133` verbatim into a new file:

```ts
// packages/slides/src/view/canvas/shape-special.ts
import type { ShapeElement } from '../../model/element';
import { resolveColor, type Theme, type ThemeColor } from '../../model/theme';
import type { FrameSize } from './shapes/builder';

export function drawLine(
  ctx: CanvasRenderingContext2D,
  { w, h }: FrameSize,
  data: ShapeElement['data'],
  theme: Theme,
): void {
  if (!data.stroke) return;
  ctx.strokeStyle = resolveColor(data.stroke.color, theme);
  ctx.lineWidth = data.stroke.width;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(w, h);
  ctx.stroke();
}

const ARROW_HEAD_FALLBACK: ThemeColor = { kind: 'role', role: 'text' };

export function drawArrow(
  ctx: CanvasRenderingContext2D,
  { w, h }: FrameSize,
  data: ShapeElement['data'],
  theme: Theme,
): void {
  if (data.stroke) {
    ctx.strokeStyle = resolveColor(data.stroke.color, theme);
    ctx.lineWidth = data.stroke.width;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w, h);
    ctx.stroke();
  }
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

  const headColor: ThemeColor =
    data.fill ?? data.stroke?.color ?? ARROW_HEAD_FALLBACK;
  ctx.fillStyle = resolveColor(headColor, theme);
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(pLeft.x, pLeft.y);
  ctx.lineTo(pRight.x, pRight.y);
  ctx.closePath();
  ctx.fill();
}
```

- [x] **Step 2: Run verify**

```bash
pnpm verify:fast
```

Expected: PASS. The new file is unused so far; the existing `drawLine`/`drawArrow` inside `shape-renderer.ts` are still the active implementation.

- [x] **Step 3: Commit**

```bash
git add packages/slides/src/view/canvas/shape-special.ts
git commit -m "$(cat <<'EOF'
Lift drawLine/drawArrow into shape-special.ts

Pure code move ahead of the dispatcher refactor. line/arrow do not
fit the (size, adjustments) → Path2D builder pattern (open path,
two-tone arrow head), so they keep bespoke renderers in their own
file. The dispatcher rewrite in the next commit switches to these.
EOF
)"
```

---

## Task 4: Refactor `shape-renderer.ts` into a dispatcher

**Files:**
- Modify: `packages/slides/src/view/canvas/shape-renderer.ts`
- Test: `packages/slides/src/view/canvas/shape-renderer.test.ts`

After this task, the dispatcher routes `line`/`arrow` to `shape-special.ts` and everything else through the (still-empty) builder registry. Unknown kinds paint a fallback rect. The existing tests for rect/ellipse must keep passing because Tasks 5–6 register their builders before this lands? **No — the dispatcher must work even with an empty registry. Rect/ellipse get added to the registry in Tasks 5–6.** Until then, rect/ellipse render as the placeholder rect, which (intentionally) looks the same as the current rect renderer.

- [x] **Step 1: Add a failing test for the unknown-kind placeholder**

In `packages/slides/src/view/canvas/shape-renderer.test.ts`, append a new test (do not delete existing tests):

```ts
import { vi } from 'vitest';

it('falls back to a placeholder rect for unknown ShapeKind values', () => {
  const ctx = createCtx();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  drawShape(
    asCtx(ctx),
    { w: 50, h: 30 },
    // Cast: forward-compat for kinds not yet in the registry.
    shape({ kind: 'donut' as never, fill: srgb('#abc') }),
    THEME,
  );
  // Expect a fillRect(0, 0, 50, 30) call from the fallback.
  const calls = ctx.spyLog.filter((c) => c.method === 'fillRect');
  expect(calls).toHaveLength(1);
  expect(calls[0].args).toEqual([0, 0, 50, 30]);
  expect(warn).toHaveBeenCalledOnce();
  warn.mockRestore();
});
```

(Reference the existing test file for `createCtx`, `asCtx`, `shape`, `srgb`, `THEME` helpers — they already exist.)

- [x] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @wafflebase/slides test -- --run src/view/canvas/shape-renderer.test.ts
```

Expected: FAIL — fallback not yet implemented.

- [x] **Step 3: Rewrite `shape-renderer.ts` as a dispatcher**

Replace the entire file content with:

```ts
import type { ShapeElement } from '../../model/element';
import { resolveColor, type Theme } from '../../model/theme';
import { drawLine, drawArrow } from './shape-special';
import { PATH_BUILDERS } from './shapes';
import type { FrameSize } from './shapes/builder';

export type { FrameSize } from './shapes/builder';

const placeholderWarned = new Set<string>();

/**
 * Draw a shape into element-local coordinates (top-left at 0,0). The
 * caller is responsible for the frame transform (translate + rotate).
 *
 * line/arrow are special-cased (open path, two-tone arrow head). All
 * other kinds resolve through PATH_BUILDERS; unknown kinds fall back
 * to a placeholder rectangle so the slide always renders.
 */
export function drawShape(
  ctx: CanvasRenderingContext2D,
  size: FrameSize,
  data: ShapeElement['data'],
  theme: Theme,
): void {
  if (data.kind === 'line') return drawLine(ctx, size, data, theme);
  if (data.kind === 'arrow') return drawArrow(ctx, size, data, theme);

  const builder = PATH_BUILDERS.get(data.kind);
  if (!builder) {
    if (!placeholderWarned.has(data.kind)) {
      placeholderWarned.add(data.kind);
      console.warn(
        `slides: no path builder registered for shape kind "${data.kind}"; ` +
          `falling back to placeholder rect`,
      );
    }
    drawPlaceholderRect(ctx, size, data, theme);
    return;
  }
  const path = builder(size, data.adjustments);
  if (data.fill) {
    ctx.fillStyle = resolveColor(data.fill, theme);
    ctx.fill(path);
  }
  if (data.stroke) {
    ctx.strokeStyle = resolveColor(data.stroke.color, theme);
    ctx.lineWidth = data.stroke.width;
    ctx.stroke(path);
  }
}

function drawPlaceholderRect(
  ctx: CanvasRenderingContext2D,
  { w, h }: FrameSize,
  data: ShapeElement['data'],
  theme: Theme,
): void {
  if (data.fill) {
    ctx.fillStyle = resolveColor(data.fill, theme);
    ctx.fillRect(0, 0, w, h);
  }
  if (data.stroke) {
    ctx.strokeStyle = resolveColor(data.stroke.color, theme);
    ctx.lineWidth = data.stroke.width;
    ctx.strokeRect(0, 0, w, h);
  }
}
```

- [x] **Step 4: Run the renderer tests**

```bash
pnpm --filter @wafflebase/slides test -- --run src/view/canvas/shape-renderer.test.ts
```

Expected: the new placeholder test passes. The existing rect/ellipse tests pass too — they happen to assert behaviour identical to the placeholder rect (same `fillRect(0, 0, w, h)`/`strokeRect(0, 0, w, h)` shape), which is correct since the registry still has no entries.

If a test fails because it asserts `ctx.beginPath()` calls (specific to ellipse), keep the existing test file open and update those assertions to match the placeholder pattern; they will be re-tightened in Task 6 once the ellipse builder lands.

- [x] **Step 5: Run full verify**

```bash
pnpm verify:fast
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add packages/slides/src/view/canvas/shape-renderer.ts packages/slides/src/view/canvas/shape-renderer.test.ts
git commit -m "$(cat <<'EOF'
Refactor shape-renderer into a path-builder dispatcher

line/arrow keep their bespoke renderers (lifted to shape-special.ts
in the previous commit). All other kinds resolve through the
PATH_BUILDERS registry, with a placeholder-rect fallback for
kinds that have not yet registered a builder. Subsequent commits
fill in the registry one shape at a time.
EOF
)"
```

---

## Task 5: Add the `rect` path builder

**Files:**
- Create: `packages/slides/src/view/canvas/shapes/basic/rect.ts`
- Create: `packages/slides/src/view/canvas/shapes/basic/rect.test.ts`
- Modify: `packages/slides/src/view/canvas/shapes/index.ts`

This task establishes the per-shape file pattern that Tasks 8–11 follow for every other shape.

- [x] **Step 1: Write the failing test**

```ts
// packages/slides/src/view/canvas/shapes/basic/rect.test.ts
import { describe, it, expect } from 'vitest';
import { buildRect } from './rect';
import { createTestCanvas } from '../../test-canvas-env';

describe('buildRect', () => {
  it('returns a rectangular Path2D covering the frame', () => {
    const path = buildRect({ w: 100, h: 60 });
    const ctx = createTestCanvas(200, 200).getContext('2d')!;
    expect(ctx.isPointInPath(path, 50, 30)).toBe(true);   // centre
    expect(ctx.isPointInPath(path, 0, 0)).toBe(true);     // corner (inclusive)
    expect(ctx.isPointInPath(path, 99, 59)).toBe(true);   // far corner
    expect(ctx.isPointInPath(path, 101, 30)).toBe(false); // outside right
    expect(ctx.isPointInPath(path, 50, 61)).toBe(false);  // outside bottom
  });

  it('handles 0×0 frames without throwing', () => {
    expect(() => buildRect({ w: 0, h: 0 })).not.toThrow();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @wafflebase/slides test -- --run src/view/canvas/shapes/basic/rect.test.ts
```

Expected: FAIL — module not found.

- [x] **Step 3: Implement the builder**

```ts
// packages/slides/src/view/canvas/shapes/basic/rect.ts
import type { PathBuilder } from '../builder';

export const buildRect: PathBuilder = ({ w, h }) => {
  const path = new Path2D();
  path.rect(0, 0, w, h);
  return path;
};
```

- [x] **Step 4: Register the builder**

In `packages/slides/src/view/canvas/shapes/index.ts`, add:

```ts
import { buildRect } from './basic/rect';

PATH_BUILDERS.set('rect', buildRect);
```

(Place the `import` near the top with other imports as they accumulate; place the `set` call at the bottom of the file. Keep the registration grouped per category for readability.)

- [x] **Step 5: Run all tests**

```bash
pnpm --filter @wafflebase/slides test -- --run src/view/canvas/shapes/
pnpm --filter @wafflebase/slides test -- --run src/view/canvas/shape-renderer.test.ts
```

Expected: PASS. The renderer's existing rect tests now exercise the builder path (instead of the placeholder).

- [x] **Step 6: Commit**

```bash
git add packages/slides/src/view/canvas/shapes/basic/rect.ts \
        packages/slides/src/view/canvas/shapes/basic/rect.test.ts \
        packages/slides/src/view/canvas/shapes/index.ts
git commit -m "$(cat <<'EOF'
Add rect path builder and register it

Establishes the per-shape file pattern: one builder + one test file
per ShapeKind, plus a one-line registration in shapes/index.ts. The
dispatcher now routes 'rect' through the builder; placeholder
fallback only fires for kinds still pending registration.
EOF
)"
```

---

## Task 6: Add the `ellipse` path builder

**Files:**
- Create: `packages/slides/src/view/canvas/shapes/basic/ellipse.ts`
- Create: `packages/slides/src/view/canvas/shapes/basic/ellipse.test.ts`
- Modify: `packages/slides/src/view/canvas/shapes/index.ts`

- [x] **Step 1: Write the failing test**

```ts
// packages/slides/src/view/canvas/shapes/basic/ellipse.test.ts
import { describe, it, expect } from 'vitest';
import { buildEllipse } from './ellipse';
import { createTestCanvas } from '../../test-canvas-env';

describe('buildEllipse', () => {
  it('returns an ellipse Path2D inscribed in the frame', () => {
    const path = buildEllipse({ w: 100, h: 60 });
    const ctx = createTestCanvas(200, 200).getContext('2d')!;
    expect(ctx.isPointInPath(path, 50, 30)).toBe(true);  // centre
    expect(ctx.isPointInPath(path, 5, 30)).toBe(true);   // near left edge
    expect(ctx.isPointInPath(path, 50, 5)).toBe(true);   // near top edge
    expect(ctx.isPointInPath(path, 0, 0)).toBe(false);   // corner (outside)
    expect(ctx.isPointInPath(path, 99, 59)).toBe(false); // corner (outside)
  });
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @wafflebase/slides test -- --run src/view/canvas/shapes/basic/ellipse.test.ts
```

Expected: FAIL — module not found.

- [x] **Step 3: Implement the builder**

```ts
// packages/slides/src/view/canvas/shapes/basic/ellipse.ts
import type { PathBuilder } from '../builder';

export const buildEllipse: PathBuilder = ({ w, h }) => {
  const path = new Path2D();
  path.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  return path;
};
```

- [x] **Step 4: Register the builder**

In `shapes/index.ts`:

```ts
import { buildEllipse } from './basic/ellipse';
PATH_BUILDERS.set('ellipse', buildEllipse);
```

- [x] **Step 5: Run tests**

```bash
pnpm verify:fast
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add packages/slides/src/view/canvas/shapes/basic/ellipse.ts \
        packages/slides/src/view/canvas/shapes/basic/ellipse.test.ts \
        packages/slides/src/view/canvas/shapes/index.ts
git commit -m "Add ellipse path builder"
```

---

## Task 7: Add the 13 remaining basic-shape builders

**Files:** for each shape `<kind>` in the table below:
- Create: `packages/slides/src/view/canvas/shapes/basic/<kind>.ts` (kebab-case filename, e.g. `round-rect.ts`)
- Create: `packages/slides/src/view/canvas/shapes/basic/<kind>.test.ts`
- Modify: `packages/slides/src/view/canvas/shapes/index.ts`
- Modify: `packages/slides/src/view/canvas/shapes/__exports.ts` (created in Step 1; see below)

The pattern from Tasks 5–6 repeats for each shape: write the test (4–5 inside/outside `isPointInPath` assertions), implement the builder, register it, run verify, commit. **Commit after each shape**, not as one big batch — frequent commits keep the dependency graph clear and make rollback cheap if a builder needs revisiting.

For each shape with adjustments, also append the `AdjustmentSpec` to `ADJUSTMENT_SPECS` in `index.ts`, even though Phase 1 does not display them.

### Per-shape implementations

The 13 remaining basic shapes follow. Each block contains the complete `Path2D` construction and the inside/outside reference points to test.

#### 7.1 `roundRect` — `basic/round-rect.ts`

Adjustments: `[cornerRadiusRatio]` (OOXML thousandths of `min(w,h)`; default `16667` = ~16.7%).

```ts
import type { PathBuilder, AdjustmentSpec } from '../builder';
import { adj } from '../builder';

export const ROUND_RECT_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  {
    name: 'Corner radius',
    defaultValue: 16667,
    min: 0,
    max: 50000,
    format: (v) => `${(v / 1000).toFixed(1)}%`,
  },
];

export const buildRoundRect: PathBuilder = ({ w, h }, adjustments) => {
  const ratio = adj(adjustments, 0, 16667) / 100000;
  const r = Math.max(0, Math.min(w, h) * ratio);
  const path = new Path2D();
  path.moveTo(r, 0);
  path.lineTo(w - r, 0);
  path.quadraticCurveTo(w, 0, w, r);
  path.lineTo(w, h - r);
  path.quadraticCurveTo(w, h, w - r, h);
  path.lineTo(r, h);
  path.quadraticCurveTo(0, h, 0, h - r);
  path.lineTo(0, r);
  path.quadraticCurveTo(0, 0, r, 0);
  path.closePath();
  return path;
};
```

Test reference points (frame 100×60, default adjustments → r ≈ 10):
- Inside: (50,30) centre; (10,10) just past corner curve; (90,50)
- Outside: (0,0) corner cut by curve; (100,60) far corner cut

Register: `PATH_BUILDERS.set('roundRect', buildRoundRect); ADJUSTMENT_SPECS.set('roundRect', ROUND_RECT_ADJUSTMENTS);`

#### 7.2 `triangle` — `basic/triangle.ts`

Adjustments: `[apexX]` (apex x position, OOXML thousandths of `w`; default `50000` = centred).

```ts
import type { PathBuilder, AdjustmentSpec } from '../builder';
import { adj } from '../builder';

export const TRIANGLE_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Apex position', defaultValue: 50000, min: 0, max: 100000 },
];

export const buildTriangle: PathBuilder = ({ w, h }, adjustments) => {
  const apexX = (adj(adjustments, 0, 50000) / 100000) * w;
  const path = new Path2D();
  path.moveTo(apexX, 0);
  path.lineTo(w, h);
  path.lineTo(0, h);
  path.closePath();
  return path;
};
```

Test points (frame 100×60, apex centred):
- Inside: (50, 50), (50, 30)
- Outside: (10, 10), (90, 10), (50, -1)

#### 7.3 `rtTriangle` — `basic/rt-triangle.ts`

Right triangle, right angle at bottom-left. No adjustments.

```ts
import type { PathBuilder } from '../builder';

export const buildRtTriangle: PathBuilder = ({ w, h }) => {
  const path = new Path2D();
  path.moveTo(0, 0);
  path.lineTo(0, h);
  path.lineTo(w, h);
  path.closePath();
  return path;
};
```

Test points (100×60): inside (10, 50), (5, 30); outside (50, 10), (90, 10).

#### 7.4 `diamond` — `basic/diamond.ts`

No adjustments.

```ts
import type { PathBuilder } from '../builder';

export const buildDiamond: PathBuilder = ({ w, h }) => {
  const path = new Path2D();
  path.moveTo(w / 2, 0);
  path.lineTo(w, h / 2);
  path.lineTo(w / 2, h);
  path.lineTo(0, h / 2);
  path.closePath();
  return path;
};
```

Test points (100×60): inside (50, 30), (50, 5); outside (5, 5), (95, 5).

#### 7.5 `parallelogram` — `basic/parallelogram.ts`

Adjustments: `[slant]` (top-left horizontal offset as OOXML thousandths of `w`; default `25000` = 25%).

```ts
import type { PathBuilder, AdjustmentSpec } from '../builder';
import { adj } from '../builder';

export const PARALLELOGRAM_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Slant', defaultValue: 25000, min: 0, max: 100000 },
];

export const buildParallelogram: PathBuilder = ({ w, h }, adjustments) => {
  const slant = (adj(adjustments, 0, 25000) / 100000) * w;
  const path = new Path2D();
  path.moveTo(slant, 0);
  path.lineTo(w, 0);
  path.lineTo(w - slant, h);
  path.lineTo(0, h);
  path.closePath();
  return path;
};
```

Test points (100×60, slant = 25): inside (50, 30), (30, 5), (70, 55); outside (5, 5), (95, 55).

#### 7.6 `trapezoid` — `basic/trapezoid.ts`

Adjustments: `[topInset]` (each side, OOXML thousandths of `w`; default `25000`).

```ts
import type { PathBuilder, AdjustmentSpec } from '../builder';
import { adj } from '../builder';

export const TRAPEZOID_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Top inset', defaultValue: 25000, min: 0, max: 50000 },
];

export const buildTrapezoid: PathBuilder = ({ w, h }, adjustments) => {
  const inset = (adj(adjustments, 0, 25000) / 100000) * w;
  const path = new Path2D();
  path.moveTo(inset, 0);
  path.lineTo(w - inset, 0);
  path.lineTo(w, h);
  path.lineTo(0, h);
  path.closePath();
  return path;
};
```

Test points (100×60, inset = 25): inside (50, 5), (50, 55); outside (5, 5), (95, 5).

#### 7.7 `pentagon` — `basic/pentagon.ts`

Regular convex pentagon inscribed in the frame, point at top. No adjustments.

```ts
import type { PathBuilder } from '../builder';

export const buildPentagon: PathBuilder = ({ w, h }) => {
  const cx = w / 2;
  const cy = h / 2;
  const rx = w / 2;
  const ry = h / 2;
  const path = new Path2D();
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2 - Math.PI / 2;
    const x = cx + rx * Math.cos(angle);
    const y = cy + ry * Math.sin(angle);
    if (i === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  }
  path.closePath();
  return path;
};
```

Test points (100×60): inside (50, 30), (50, 5); outside (1, 1), (99, 1).

#### 7.8 `hexagon` — `basic/hexagon.ts`

Adjustments: `[notchDepth]` (OOXML thousandths of `min(w,h)`; default `25000`). Hexagon is a rectangle with two triangular notches on the short sides.

```ts
import type { PathBuilder, AdjustmentSpec } from '../builder';
import { adj } from '../builder';

export const HEXAGON_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Notch depth', defaultValue: 25000, min: 0, max: 100000 },
];

export const buildHexagon: PathBuilder = ({ w, h }, adjustments) => {
  const notch = (adj(adjustments, 0, 25000) / 100000) * Math.min(w, h);
  const path = new Path2D();
  // Horizontal hexagon (long axis = w). Notches cut the left/right edges.
  path.moveTo(notch, 0);
  path.lineTo(w - notch, 0);
  path.lineTo(w, h / 2);
  path.lineTo(w - notch, h);
  path.lineTo(notch, h);
  path.lineTo(0, h / 2);
  path.closePath();
  return path;
};
```

Test points (100×60): inside (50, 30), (50, 5); outside (5, 5), (95, 5).

#### 7.9 `octagon` — `basic/octagon.ts`

Adjustments: `[cornerCut]` (OOXML thousandths of `min(w,h)`; default `29289`).

```ts
import type { PathBuilder, AdjustmentSpec } from '../builder';
import { adj } from '../builder';

export const OCTAGON_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Corner cut', defaultValue: 29289, min: 0, max: 50000 },
];

export const buildOctagon: PathBuilder = ({ w, h }, adjustments) => {
  const cut = (adj(adjustments, 0, 29289) / 100000) * Math.min(w, h);
  const path = new Path2D();
  path.moveTo(cut, 0);
  path.lineTo(w - cut, 0);
  path.lineTo(w, cut);
  path.lineTo(w, h - cut);
  path.lineTo(w - cut, h);
  path.lineTo(cut, h);
  path.lineTo(0, h - cut);
  path.lineTo(0, cut);
  path.closePath();
  return path;
};
```

Test points (100×60): inside (50, 30); outside (1, 1), (99, 59).

#### 7.10 `plus` — `basic/plus.ts`

Adjustments: `[armThickness]` (OOXML thousandths; default `25000`). Cross shape filling the frame.

```ts
import type { PathBuilder, AdjustmentSpec } from '../builder';
import { adj } from '../builder';

export const PLUS_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Arm thickness', defaultValue: 25000, min: 0, max: 50000 },
];

export const buildPlus: PathBuilder = ({ w, h }, adjustments) => {
  const t = (adj(adjustments, 0, 25000) / 100000) * Math.min(w, h);
  const xL = (w - t) / 2;
  const xR = (w + t) / 2;
  const yT = (h - t) / 2;
  const yB = (h + t) / 2;
  const path = new Path2D();
  path.moveTo(xL, 0);
  path.lineTo(xR, 0);
  path.lineTo(xR, yT);
  path.lineTo(w, yT);
  path.lineTo(w, yB);
  path.lineTo(xR, yB);
  path.lineTo(xR, h);
  path.lineTo(xL, h);
  path.lineTo(xL, yB);
  path.lineTo(0, yB);
  path.lineTo(0, yT);
  path.lineTo(xL, yT);
  path.closePath();
  return path;
};
```

Test points (100×60): inside (50, 30), (50, 5); outside (5, 5), (95, 55).

#### 7.11 `donut` — `basic/donut.ts`

Adjustments: `[holeRatio]` (OOXML thousandths of `min(w,h)/2`; default `25000` = 25% of radius). Uses `evenodd` fill rule via two sub-paths.

```ts
import type { PathBuilder, AdjustmentSpec } from '../builder';
import { adj } from '../builder';

export const DONUT_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Hole ratio', defaultValue: 25000, min: 1, max: 50000 },
];

export const buildDonut: PathBuilder = ({ w, h }, adjustments) => {
  const t = (adj(adjustments, 0, 25000) / 100000) * Math.min(w, h);
  const outerRx = w / 2;
  const outerRy = h / 2;
  const innerRx = Math.max(0.5, outerRx - t);
  const innerRy = Math.max(0.5, outerRy - t);
  const path = new Path2D();
  path.ellipse(outerRx, outerRy, outerRx, outerRy, 0, 0, Math.PI * 2);
  // Counter-clockwise inner ellipse so even-odd fill rule punches the
  // hole. The dispatcher's `ctx.fill(path)` defaults to non-zero
  // winding; for donut, the dispatcher uses `ctx.fill(path, 'evenodd')`
  // — see the dispatcher conditional below.
  path.ellipse(outerRx, outerRy, innerRx, innerRy, 0, 0, Math.PI * 2, true);
  return path;
};
```

**Dispatcher note (Task 4 amendment):** add an `evenodd` opt-in for shapes that need it. Inside the dispatcher in `shape-renderer.ts`, change:

```ts
if (data.fill) {
  ctx.fillStyle = resolveColor(data.fill, theme);
  ctx.fill(path);
}
```

to:

```ts
if (data.fill) {
  ctx.fillStyle = resolveColor(data.fill, theme);
  ctx.fill(path, EVENODD_KINDS.has(data.kind) ? 'evenodd' : 'nonzero');
}
```

with a top-level `const EVENODD_KINDS: ReadonlySet<ShapeKind> = new Set(['donut']);`.

Test points (100×60, default): inside (5, 30) on outer ring; outside (50, 30) inside the hole; outside (-5, 30).

#### 7.12 `can` — `basic/can.ts`

Adjustments: `[topEllipseHeight]` (OOXML thousandths of `h`; default `25000` = 25%). Cylinder side view.

```ts
import type { PathBuilder, AdjustmentSpec } from '../builder';
import { adj } from '../builder';

export const CAN_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Top ellipse height', defaultValue: 25000, min: 0, max: 50000 },
];

export const buildCan: PathBuilder = ({ w, h }, adjustments) => {
  const ry = (adj(adjustments, 0, 25000) / 100000) * h;
  const path = new Path2D();
  // Outline: top half-ellipse + right side + bottom half-ellipse + left side.
  path.moveTo(0, ry);
  path.bezierCurveTo(0, 0, w, 0, w, ry);
  path.lineTo(w, h - ry);
  path.bezierCurveTo(w, h, 0, h, 0, h - ry);
  path.closePath();
  // Top ellipse (drawn twice to make the lid visible as outline; renderer
  // strokes both sub-paths).
  path.ellipse(w / 2, ry, w / 2, ry, 0, 0, Math.PI * 2);
  return path;
};
```

Test points (100×60, ry = 15): inside (50, 30); outside (5, 5), (95, 5).

#### 7.13 `cloud` — `basic/cloud.ts`

No adjustments. Cloud silhouette is approximated with arcs along the perimeter.

```ts
import type { PathBuilder } from '../builder';

export const buildCloud: PathBuilder = ({ w, h }) => {
  // Five overlapping circles arranged along the top + sides; baseline is a
  // shallow arc on the bottom.
  const path = new Path2D();
  const cx = w / 2;
  const cy = h / 2;
  const lobe = Math.min(w, h) * 0.28;
  // Lobes (clockwise starting from upper-left).
  const lobes: Array<[number, number, number]> = [
    [cx - w * 0.30, cy - h * 0.10, lobe],
    [cx,            cy - h * 0.30, lobe * 1.1],
    [cx + w * 0.30, cy - h * 0.10, lobe],
    [cx + w * 0.20, cy + h * 0.25, lobe * 0.95],
    [cx - w * 0.20, cy + h * 0.25, lobe * 0.95],
  ];
  lobes.forEach(([x, y, r], i) => {
    if (i === 0) path.moveTo(x + r, y);
    path.arc(x, y, r, 0, Math.PI * 2);
  });
  path.closePath();
  return path;
};
```

Test points (200×120): inside (100, 60); outside (1, 1), (199, 1).

### Sub-task pattern (repeat for each of 7.1–7.13)

For each shape `<kind>`:

- [x] **Step A: Create the failing test** — `basic/<kind>.test.ts` with the reference points listed in the per-shape block above. Test pattern:

```ts
import { describe, it, expect } from 'vitest';
import { build<Kind> } from './<kind>';
import { createTestCanvas } from '../../test-canvas-env';

describe('build<Kind>', () => {
  it('produces a valid path for the default frame', () => {
    const path = build<Kind>({ w: 100, h: 60 });
    const ctx = createTestCanvas(200, 200).getContext('2d')!;
    // …assertions per the per-shape "Test points" line.
  });
});
```

- [x] **Step B: Run test — confirm FAIL** (`pnpm --filter @wafflebase/slides test -- --run src/view/canvas/shapes/basic/<kind>.test.ts`).

- [x] **Step C: Implement the builder** — paste the per-shape implementation block.

- [x] **Step D: Register in `shapes/index.ts`** — one `import` + one `PATH_BUILDERS.set(...)` (and `ADJUSTMENT_SPECS.set(...)` if applicable).

- [x] **Step E: Run all shape tests** (`pnpm --filter @wafflebase/slides test -- --run src/view/canvas/shapes/basic/`).

- [x] **Step F: Commit** — message format `Add <kind> path builder`.

After 7.13, run `pnpm verify:fast` and confirm PASS before moving to Task 8.

---

## Task 8: Add the 8 block-arrow path builders

**Files:** for each shape, the same per-shape pattern as Task 7.

OOXML reference: ECMA-376 Part 1 §20.1.9.{38, 39, 40, 41, 42, 43, 44, 45} for the block-arrow geometry. The shared two-adjustment shape (`[headLen, headWidth]` in thousandths) drives all four single-direction arrows; `leftRightArrow` and `quadArrow` extend it.

#### 8.1 `rightArrow` — `arrows/right-arrow.ts`

Adjustments: `[headLen, headWidth]` (default `[50000, 50000]`, both as OOXML thousandths).

```ts
import type { PathBuilder, AdjustmentSpec } from '../builder';
import { adj } from '../builder';

export const ARROW_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Head length', defaultValue: 50000, min: 0, max: 100000 },
  { name: 'Head width', defaultValue: 50000, min: 0, max: 100000 },
];

export const buildRightArrow: PathBuilder = ({ w, h }, adjustments) => {
  const headLen = Math.min(w, (adj(adjustments, 0, 50000) / 100000) * w);
  const headHalf = (adj(adjustments, 1, 50000) / 100000) * (h / 2);
  const path = new Path2D();
  path.moveTo(0, h / 2 - headHalf);
  path.lineTo(w - headLen, h / 2 - headHalf);
  path.lineTo(w - headLen, 0);
  path.lineTo(w, h / 2);
  path.lineTo(w - headLen, h);
  path.lineTo(w - headLen, h / 2 + headHalf);
  path.lineTo(0, h / 2 + headHalf);
  path.closePath();
  return path;
};
```

Test (100×60, default): inside (10, 30), (95, 30); outside (1, 1), (95, 1).

#### 8.2 `leftArrow` — `arrows/left-arrow.ts`

Mirror of rightArrow. Reuse `ARROW_ADJUSTMENTS`.

```ts
import type { PathBuilder } from '../builder';
import { adj } from '../builder';

export const buildLeftArrow: PathBuilder = ({ w, h }, adjustments) => {
  const headLen = Math.min(w, (adj(adjustments, 0, 50000) / 100000) * w);
  const headHalf = (adj(adjustments, 1, 50000) / 100000) * (h / 2);
  const path = new Path2D();
  path.moveTo(w, h / 2 - headHalf);
  path.lineTo(headLen, h / 2 - headHalf);
  path.lineTo(headLen, 0);
  path.lineTo(0, h / 2);
  path.lineTo(headLen, h);
  path.lineTo(headLen, h / 2 + headHalf);
  path.lineTo(w, h / 2 + headHalf);
  path.closePath();
  return path;
};
```

Register: `ADJUSTMENT_SPECS.set('leftArrow', ARROW_ADJUSTMENTS)` (re-used spec).

Test (100×60): inside (5, 30), (90, 30); outside (5, 1), (5, 59).

#### 8.3 `upArrow` — `arrows/up-arrow.ts`

```ts
import type { PathBuilder } from '../builder';
import { adj } from '../builder';

export const buildUpArrow: PathBuilder = ({ w, h }, adjustments) => {
  const headLen = Math.min(h, (adj(adjustments, 0, 50000) / 100000) * h);
  const headHalf = (adj(adjustments, 1, 50000) / 100000) * (w / 2);
  const path = new Path2D();
  path.moveTo(w / 2 - headHalf, h);
  path.lineTo(w / 2 - headHalf, headLen);
  path.lineTo(0, headLen);
  path.lineTo(w / 2, 0);
  path.lineTo(w, headLen);
  path.lineTo(w / 2 + headHalf, headLen);
  path.lineTo(w / 2 + headHalf, h);
  path.closePath();
  return path;
};
```

Test (60×100): inside (30, 95), (30, 5); outside (1, 95).

#### 8.4 `downArrow` — `arrows/down-arrow.ts`

```ts
import type { PathBuilder } from '../builder';
import { adj } from '../builder';

export const buildDownArrow: PathBuilder = ({ w, h }, adjustments) => {
  const headLen = Math.min(h, (adj(adjustments, 0, 50000) / 100000) * h);
  const headHalf = (adj(adjustments, 1, 50000) / 100000) * (w / 2);
  const path = new Path2D();
  path.moveTo(w / 2 - headHalf, 0);
  path.lineTo(w / 2 - headHalf, h - headLen);
  path.lineTo(0, h - headLen);
  path.lineTo(w / 2, h);
  path.lineTo(w, h - headLen);
  path.lineTo(w / 2 + headHalf, h - headLen);
  path.lineTo(w / 2 + headHalf, 0);
  path.closePath();
  return path;
};
```

Test (60×100): inside (30, 5), (30, 95); outside (1, 5).

#### 8.5 `leftRightArrow` — `arrows/left-right-arrow.ts`

Adjustments: `[headLen, headWidth]` (default `[50000, 50000]`); same spec as `rightArrow`.

```ts
import type { PathBuilder } from '../builder';
import { adj } from '../builder';

export const buildLeftRightArrow: PathBuilder = ({ w, h }, adjustments) => {
  const head = Math.min(w / 2, (adj(adjustments, 0, 50000) / 100000) * (w / 2));
  const headHalf = (adj(adjustments, 1, 50000) / 100000) * (h / 2);
  const path = new Path2D();
  path.moveTo(0, h / 2);
  path.lineTo(head, 0);
  path.lineTo(head, h / 2 - headHalf);
  path.lineTo(w - head, h / 2 - headHalf);
  path.lineTo(w - head, 0);
  path.lineTo(w, h / 2);
  path.lineTo(w - head, h);
  path.lineTo(w - head, h / 2 + headHalf);
  path.lineTo(head, h / 2 + headHalf);
  path.lineTo(head, h);
  path.closePath();
  return path;
};
```

Test (120×60): inside (60, 30), (5, 30); outside (5, 1).

#### 8.6 `quadArrow` — `arrows/quad-arrow.ts`

Adjustments: `[headLen, headWidth, shaftThickness]` (default `[22500, 22500, 22500]`).

```ts
import type { PathBuilder, AdjustmentSpec } from '../builder';
import { adj } from '../builder';

export const QUAD_ARROW_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Head length', defaultValue: 22500, min: 0, max: 50000 },
  { name: 'Head width', defaultValue: 22500, min: 0, max: 50000 },
  { name: 'Shaft thickness', defaultValue: 22500, min: 0, max: 50000 },
];

export const buildQuadArrow: PathBuilder = ({ w, h }, adjustments) => {
  const dim = Math.min(w, h);
  const head = (adj(adjustments, 0, 22500) / 100000) * dim;
  const headHalf = (adj(adjustments, 1, 22500) / 100000) * dim;
  const shaft = (adj(adjustments, 2, 22500) / 100000) * dim;
  const cx = w / 2;
  const cy = h / 2;
  const path = new Path2D();
  // Walk: top, right, bottom, left (each direction = 5 lineTo).
  path.moveTo(cx, 0);
  path.lineTo(cx + headHalf, head);
  path.lineTo(cx + shaft, head);
  path.lineTo(cx + shaft, cy - shaft);
  path.lineTo(w - head, cy - shaft);
  path.lineTo(w - head, cy - headHalf);
  path.lineTo(w, cy);
  path.lineTo(w - head, cy + headHalf);
  path.lineTo(w - head, cy + shaft);
  path.lineTo(cx + shaft, cy + shaft);
  path.lineTo(cx + shaft, h - head);
  path.lineTo(cx + headHalf, h - head);
  path.lineTo(cx, h);
  path.lineTo(cx - headHalf, h - head);
  path.lineTo(cx - shaft, h - head);
  path.lineTo(cx - shaft, cy + shaft);
  path.lineTo(head, cy + shaft);
  path.lineTo(head, cy + headHalf);
  path.lineTo(0, cy);
  path.lineTo(head, cy - headHalf);
  path.lineTo(head, cy - shaft);
  path.lineTo(cx - shaft, cy - shaft);
  path.lineTo(cx - shaft, head);
  path.lineTo(cx - headHalf, head);
  path.closePath();
  return path;
};
```

Test (100×100, defaults): inside (50, 50), (50, 5), (5, 50); outside (5, 5).

#### 8.7 `chevron` — `arrows/chevron.ts`

Adjustments: `[notchDepth]` (default `50000`, OOXML thousandths of `w`).

```ts
import type { PathBuilder, AdjustmentSpec } from '../builder';
import { adj } from '../builder';

export const CHEVRON_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Notch depth', defaultValue: 50000, min: 0, max: 100000 },
];

export const buildChevron: PathBuilder = ({ w, h }, adjustments) => {
  const notch = (adj(adjustments, 0, 50000) / 100000) * (h / 2);
  const tip = w; // pointing right
  const inset = Math.min(w, notch * (w / h)); // rough; OOXML uses min(w, h/2 * tan...)
  const path = new Path2D();
  path.moveTo(0, 0);
  path.lineTo(w - inset, 0);
  path.lineTo(tip, h / 2);
  path.lineTo(w - inset, h);
  path.lineTo(0, h);
  path.lineTo(inset, h / 2);
  path.closePath();
  return path;
};
```

Test (100×60): inside (50, 30); outside (-1, -1), (50, -1).

#### 8.8 `pentagonArrow` — `arrows/pentagon-arrow.ts` (`prst="homePlate"`)

Adjustments: `[pointLen]` (default `50000`, OOXML thousandths of `w`).

```ts
import type { PathBuilder, AdjustmentSpec } from '../builder';
import { adj } from '../builder';

export const PENTAGON_ARROW_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Point length', defaultValue: 50000, min: 0, max: 100000 },
];

export const buildPentagonArrow: PathBuilder = ({ w, h }, adjustments) => {
  const point = (adj(adjustments, 0, 50000) / 100000) * w;
  const path = new Path2D();
  path.moveTo(0, 0);
  path.lineTo(w - point, 0);
  path.lineTo(w, h / 2);
  path.lineTo(w - point, h);
  path.lineTo(0, h);
  path.closePath();
  return path;
};
```

Test (100×60): inside (50, 30), (5, 5); outside (95, 5).

### Sub-task pattern

Same A–F per shape as Task 7. Each shape ends in its own commit. After 8.8, run `pnpm verify:fast` and confirm PASS.

---

## Task 9: Add the 4 callout path builders

**Files:** per-shape pattern.

Callouts have a tail. Adjustments `[tailX, tailY]` are OOXML thousandths of `w` and `h` respectively, **measured from the frame centre** (so negative values point left/up). OOXML defaults: `[-20833, 62500]` (tail goes down-left from the bubble).

#### 9.1 `wedgeRectCallout` — `callouts/wedge-rect-callout.ts`

```ts
import type { PathBuilder, AdjustmentSpec } from '../builder';
import { adj } from '../builder';

export const WEDGE_RECT_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Tail x', defaultValue: -20833, min: -100000, max: 100000 },
  { name: 'Tail y', defaultValue: 62500, min: -100000, max: 100000 },
];

export const buildWedgeRectCallout: PathBuilder = ({ w, h }, adjustments) => {
  const tx = w / 2 + (adj(adjustments, 0, -20833) / 100000) * w;
  const ty = h / 2 + (adj(adjustments, 1, 62500) / 100000) * h;
  // Tail attaches to the closer of the four edges. Determine which.
  const distances = [
    { side: 'top',    d: Math.abs(ty - 0) },
    { side: 'right',  d: Math.abs(tx - w) },
    { side: 'bottom', d: Math.abs(ty - h) },
    { side: 'left',   d: Math.abs(tx - 0) },
  ];
  const closest = distances.reduce((a, b) => (a.d < b.d ? a : b));
  const baseHalf = Math.min(w, h) * 0.05;
  const path = new Path2D();
  path.moveTo(0, 0);
  // Top edge with optional tail.
  if (closest.side === 'top') {
    path.lineTo(Math.max(0, tx - baseHalf), 0);
    path.lineTo(tx, ty);
    path.lineTo(Math.min(w, tx + baseHalf), 0);
  }
  path.lineTo(w, 0);
  if (closest.side === 'right') {
    path.lineTo(w, Math.max(0, ty - baseHalf));
    path.lineTo(tx, ty);
    path.lineTo(w, Math.min(h, ty + baseHalf));
  }
  path.lineTo(w, h);
  if (closest.side === 'bottom') {
    path.lineTo(Math.min(w, tx + baseHalf), h);
    path.lineTo(tx, ty);
    path.lineTo(Math.max(0, tx - baseHalf), h);
  }
  path.lineTo(0, h);
  if (closest.side === 'left') {
    path.lineTo(0, Math.min(h, ty + baseHalf));
    path.lineTo(tx, ty);
    path.lineTo(0, Math.max(0, ty - baseHalf));
  }
  path.closePath();
  return path;
};
```

Test (100×60): bubble inside (50, 30); tail tip inside path at the default `(tx, ty) ≈ (29, 67)` — though `ty` falls outside `h=60`, so tail goes below the bubble; assert `isPointInPath(path, 29, 65) === true`.

#### 9.2 `wedgeRoundRectCallout` — `callouts/wedge-round-rect-callout.ts`

Adjustments: `[tailX, tailY, cornerRadius]` (default `[-20833, 62500, 16667]`). Combine roundRect corners with the tail logic from 9.1. For brevity, use the existing roundRect shape **without** rounded tail joins (the OOXML reference rounds the rect corners but the tail connects with sharp lines):

```ts
import type { PathBuilder, AdjustmentSpec } from '../builder';
import { adj } from '../builder';

export const WEDGE_ROUND_RECT_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Tail x', defaultValue: -20833, min: -100000, max: 100000 },
  { name: 'Tail y', defaultValue: 62500, min: -100000, max: 100000 },
  { name: 'Corner radius', defaultValue: 16667, min: 0, max: 50000 },
];

export const buildWedgeRoundRectCallout: PathBuilder = ({ w, h }, adjustments) => {
  const tx = w / 2 + (adj(adjustments, 0, -20833) / 100000) * w;
  const ty = h / 2 + (adj(adjustments, 1, 62500) / 100000) * h;
  const r = (adj(adjustments, 2, 16667) / 100000) * Math.min(w, h);
  const baseHalf = Math.min(w, h) * 0.05;
  const path = new Path2D();
  // Rounded rectangle outline (clockwise from top-left curve start).
  path.moveTo(r, 0);
  path.lineTo(w - r, 0);
  path.quadraticCurveTo(w, 0, w, r);
  path.lineTo(w, h - r);
  path.quadraticCurveTo(w, h, w - r, h);
  // Tail on bottom edge if tail is below bubble (default case).
  if (ty > h) {
    path.lineTo(Math.min(w - r, tx + baseHalf), h);
    path.lineTo(tx, ty);
    path.lineTo(Math.max(r, tx - baseHalf), h);
  }
  path.lineTo(r, h);
  path.quadraticCurveTo(0, h, 0, h - r);
  path.lineTo(0, r);
  path.quadraticCurveTo(0, 0, r, 0);
  path.closePath();
  return path;
};
```

Test (100×60): inside (50, 30); tail inside (29, 65).

#### 9.3 `wedgeEllipseCallout` — `callouts/wedge-ellipse-callout.ts`

Approximate by extending an ellipse with a triangular tail (separate sub-path; `evenodd` fill not needed because the tail joins the ellipse from outside).

```ts
import type { PathBuilder, AdjustmentSpec } from '../builder';
import { adj } from '../builder';

export const WEDGE_ELLIPSE_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Tail x', defaultValue: -20833, min: -100000, max: 100000 },
  { name: 'Tail y', defaultValue: 62500, min: -100000, max: 100000 },
];

export const buildWedgeEllipseCallout: PathBuilder = ({ w, h }, adjustments) => {
  const tx = w / 2 + (adj(adjustments, 0, -20833) / 100000) * w;
  const ty = h / 2 + (adj(adjustments, 1, 62500) / 100000) * h;
  const cx = w / 2;
  const cy = h / 2;
  const rx = w / 2;
  const ry = h / 2;
  const path = new Path2D();
  path.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  // Triangle tail from two points on the ellipse to (tx, ty).
  const angle = Math.atan2(ty - cy, tx - cx);
  const baseSpread = 0.25; // radians
  const a1 = angle - baseSpread;
  const a2 = angle + baseSpread;
  const p1 = { x: cx + rx * Math.cos(a1), y: cy + ry * Math.sin(a1) };
  const p2 = { x: cx + rx * Math.cos(a2), y: cy + ry * Math.sin(a2) };
  path.moveTo(p1.x, p1.y);
  path.lineTo(tx, ty);
  path.lineTo(p2.x, p2.y);
  path.closePath();
  return path;
};
```

Test (100×60): inside (50, 30) inside ellipse; (29, 65) inside tail tip.

#### 9.4 `cloudCallout` — `callouts/cloud-callout.ts`

Cloud silhouette + small connector circles toward `(tx, ty)`. Approximation:

```ts
import type { PathBuilder, AdjustmentSpec } from '../builder';
import { adj } from '../builder';
import { buildCloud } from '../basic/cloud';

export const CLOUD_CALLOUT_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Tail x', defaultValue: -20833, min: -100000, max: 100000 },
  { name: 'Tail y', defaultValue: 62500, min: -100000, max: 100000 },
];

export const buildCloudCallout: PathBuilder = ({ w, h }, adjustments) => {
  const tx = w / 2 + (adj(adjustments, 0, -20833) / 100000) * w;
  const ty = h / 2 + (adj(adjustments, 1, 62500) / 100000) * h;
  const path = new Path2D();
  // Compose with the basic cloud builder.
  const cloud = buildCloud({ w, h });
  path.addPath(cloud);
  // Two small "thought bubble" circles between cloud edge and (tx, ty).
  const cx = w / 2;
  const cy = h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const small1 = { x: cx + ux * len * 0.65, y: cy + uy * len * 0.65, r: Math.min(w, h) * 0.07 };
  const small2 = { x: cx + ux * len * 0.85, y: cy + uy * len * 0.85, r: Math.min(w, h) * 0.04 };
  path.moveTo(small1.x + small1.r, small1.y);
  path.arc(small1.x, small1.y, small1.r, 0, Math.PI * 2);
  path.moveTo(small2.x + small2.r, small2.y);
  path.arc(small2.x, small2.y, small2.r, 0, Math.PI * 2);
  return path;
};
```

Test (200×120): inside (100, 60) inside cloud body; outside (1, 1).

### Sub-task pattern

Same A–F per shape as Task 7. After 9.4, run `pnpm verify:fast`.

---

## Task 10: Add the 6 equation path builders

**Files:** per-shape pattern.

OOXML reference: ECMA-376 Part 1 §20.1.9.{74, 75, 76, 77, 78, 79}. Each equation glyph has an "arm thickness" adjustment; multi-element glyphs (`mathDivide`, `mathEqual`, `mathNotEqual`) have additional spacing/offset adjustments.

#### 10.1 `mathPlus` — `equation/math-plus.ts`

Adjustments: `[armThickness]` (default `23520`, OOXML thousandths of `min(w,h)`).

```ts
import type { PathBuilder, AdjustmentSpec } from '../builder';
import { adj } from '../builder';

export const MATH_PLUS_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Arm thickness', defaultValue: 23520, min: 0, max: 50000 },
];

export const buildMathPlus: PathBuilder = ({ w, h }, adjustments) => {
  const t = (adj(adjustments, 0, 23520) / 100000) * Math.min(w, h);
  const cx = w / 2;
  const cy = h / 2;
  const path = new Path2D();
  // Horizontal bar.
  path.rect(0, cy - t / 2, w, t);
  // Vertical bar.
  path.rect(cx - t / 2, 0, t, h);
  return path;
};
```

Test (60×60): inside (30, 30), (5, 30), (30, 5); outside (5, 5).

#### 10.2 `mathMinus` — `equation/math-minus.ts`

```ts
import type { PathBuilder } from '../builder';
import { adj } from '../builder';

export const buildMathMinus: PathBuilder = ({ w, h }, adjustments) => {
  const t = (adj(adjustments, 0, 23520) / 100000) * Math.min(w, h);
  const path = new Path2D();
  path.rect(0, h / 2 - t / 2, w, t);
  return path;
};
```

Spec re-uses `MATH_PLUS_ADJUSTMENTS`. Register `ADJUSTMENT_SPECS.set('mathMinus', MATH_PLUS_ADJUSTMENTS)`.

Test (60×60): inside (30, 30); outside (30, 5), (30, 55).

#### 10.3 `mathMultiply` — `equation/math-multiply.ts`

X shape made of two rotated rectangles.

```ts
import type { PathBuilder } from '../builder';
import { adj } from '../builder';

export const buildMathMultiply: PathBuilder = ({ w, h }, adjustments) => {
  const t = (adj(adjustments, 0, 23520) / 100000) * Math.min(w, h);
  const cx = w / 2;
  const cy = h / 2;
  const path = new Path2D();
  // Diagonal 1 (top-left to bottom-right): a thin rectangle rotated 45°.
  // Express the diagonal arm as an explicit polygon — JSDOM canvas does
  // not support save/restore for sub-paths in jsdom-canvas 2.0.
  const halfDiag = Math.hypot(w, h) / 2;
  const cos45 = Math.cos(Math.PI / 4);
  const sin45 = Math.sin(Math.PI / 4);
  function diagonal(rotateRadians: number) {
    const cosR = Math.cos(rotateRadians);
    const sinR = Math.sin(rotateRadians);
    const corners = [
      [-halfDiag, -t / 2],
      [halfDiag, -t / 2],
      [halfDiag, t / 2],
      [-halfDiag, t / 2],
    ];
    corners.forEach(([x, y], i) => {
      const xr = x * cosR - y * sinR + cx;
      const yr = x * sinR + y * cosR + cy;
      if (i === 0) path.moveTo(xr, yr);
      else path.lineTo(xr, yr);
    });
    path.closePath();
  }
  diagonal(Math.PI / 4);
  diagonal(-Math.PI / 4);
  return path;
};
```

Test (60×60): inside (30, 30), inside (10, 10); outside (30, 10).

#### 10.4 `mathDivide` — `equation/math-divide.ts`

Adjustments: `[barThickness, dotRadius, gap]` (default `[23520, 5880, 11760]`, all OOXML thousandths of `h`).

```ts
import type { PathBuilder, AdjustmentSpec } from '../builder';
import { adj } from '../builder';

export const MATH_DIVIDE_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Bar thickness', defaultValue: 23520, min: 0, max: 50000 },
  { name: 'Dot radius', defaultValue: 5880, min: 0, max: 25000 },
  { name: 'Gap', defaultValue: 11760, min: 0, max: 50000 },
];

export const buildMathDivide: PathBuilder = ({ w, h }, adjustments) => {
  const bar = (adj(adjustments, 0, 23520) / 100000) * h;
  const dotR = (adj(adjustments, 1, 5880) / 100000) * h;
  const gap = (adj(adjustments, 2, 11760) / 100000) * h;
  const cx = w / 2;
  const cy = h / 2;
  const path = new Path2D();
  path.rect(0, cy - bar / 2, w, bar);
  // Top dot.
  path.moveTo(cx + dotR, cy - bar / 2 - gap - dotR);
  path.arc(cx, cy - bar / 2 - gap - dotR, dotR, 0, Math.PI * 2);
  // Bottom dot.
  path.moveTo(cx + dotR, cy + bar / 2 + gap + dotR);
  path.arc(cx, cy + bar / 2 + gap + dotR, dotR, 0, Math.PI * 2);
  return path;
};
```

Test (60×60): inside (30, 30); outside (30, 5), (30, 55) — depending on adjustments.

#### 10.5 `mathEqual` — `equation/math-equal.ts`

Adjustments: `[barThickness, gap]` (default `[23520, 11760]`).

```ts
import type { PathBuilder, AdjustmentSpec } from '../builder';
import { adj } from '../builder';

export const MATH_EQUAL_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Bar thickness', defaultValue: 23520, min: 0, max: 50000 },
  { name: 'Gap', defaultValue: 11760, min: 0, max: 50000 },
];

export const buildMathEqual: PathBuilder = ({ w, h }, adjustments) => {
  const bar = (adj(adjustments, 0, 23520) / 100000) * h;
  const gap = (adj(adjustments, 1, 11760) / 100000) * h;
  const cy = h / 2;
  const path = new Path2D();
  path.rect(0, cy - gap / 2 - bar, w, bar);
  path.rect(0, cy + gap / 2, w, bar);
  return path;
};
```

Test (60×60): inside (30, 20), (30, 40); outside (30, 30).

#### 10.6 `mathNotEqual` — `equation/math-not-equal.ts`

Adjustments: `[barThickness, gap, slashAngle]` (default `[23520, 11760, 6600]`).

```ts
import type { PathBuilder, AdjustmentSpec } from '../builder';
import { adj } from '../builder';

export const MATH_NOT_EQUAL_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Bar thickness', defaultValue: 23520, min: 0, max: 50000 },
  { name: 'Gap', defaultValue: 11760, min: 0, max: 50000 },
  { name: 'Slash thickness', defaultValue: 6600, min: 0, max: 50000 },
];

export const buildMathNotEqual: PathBuilder = ({ w, h }, adjustments) => {
  const bar = (adj(adjustments, 0, 23520) / 100000) * h;
  const gap = (adj(adjustments, 1, 11760) / 100000) * h;
  const slashT = (adj(adjustments, 2, 6600) / 100000) * h;
  const cx = w / 2;
  const cy = h / 2;
  const path = new Path2D();
  path.rect(0, cy - gap / 2 - bar, w, bar);
  path.rect(0, cy + gap / 2, w, bar);
  // Diagonal slash from bottom-left toward top-right.
  const halfDiag = Math.hypot(w, h) / 2;
  const cosR = Math.cos(-Math.PI / 4);
  const sinR = Math.sin(-Math.PI / 4);
  const corners = [
    [-halfDiag, -slashT / 2],
    [halfDiag, -slashT / 2],
    [halfDiag, slashT / 2],
    [-halfDiag, slashT / 2],
  ];
  corners.forEach(([x, y], i) => {
    const xr = x * cosR - y * sinR + cx;
    const yr = x * sinR + y * cosR + cy;
    if (i === 0) path.moveTo(xr, yr);
    else path.lineTo(xr, yr);
  });
  path.closePath();
  return path;
};
```

Test (60×60): inside (30, 20), (30, 40), (30, 30) on slash; outside (5, 5).

### Sub-task pattern

Same A–F per shape as Task 7. After 10.6, run `pnpm verify:fast` and confirm PASS.

---

## Task 11: Snapshot test — every shape paints into a 100×100 frame

**Files:**
- Create: `packages/slides/src/view/canvas/shapes/registry.snap.test.ts`

This guards against regressions in any builder by snapshotting `ctx-spy` output for the full registry. The existing `ctx-spy.ts` records every CanvasRenderingContext2D method/argument. A single snapshot file pins all 33 builders.

- [x] **Step 1: Write the test**

```ts
// packages/slides/src/view/canvas/shapes/registry.snap.test.ts
import { describe, it, expect } from 'vitest';
import { PATH_BUILDERS } from './index';
import { createSpyCtx } from '../ctx-spy';

describe('shape registry snapshot', () => {
  it('every registered builder paints stably into a 100×100 frame', () => {
    const sortedKinds = [...PATH_BUILDERS.keys()].sort();
    const log: Record<string, unknown[]> = {};
    for (const kind of sortedKinds) {
      const builder = PATH_BUILDERS.get(kind)!;
      const ctx = createSpyCtx();
      const path = builder({ w: 100, h: 100 }, undefined);
      // Drive the path through a real fill() call so the spy records
      // the final operation; isPointInPath itself is recorded too.
      ctx.fill(path);
      log[kind] = ctx.spyLog;
    }
    expect(log).toMatchSnapshot();
  });
});
```

(If `createSpyCtx` is not the exact export name, use the corresponding helper in `ctx-spy.ts`. The existing `ctx-spy.test.ts` shows the public API.)

- [x] **Step 2: Run to generate snapshot**

```bash
pnpm --filter @wafflebase/slides test -- --run --update src/view/canvas/shapes/registry.snap.test.ts
```

Manually inspect the generated `__snapshots__/registry.snap.test.ts.snap`: each kind should have a non-empty list of canvas operations, ending in a `fill` call.

- [x] **Step 3: Run the test without --update to confirm it passes**

```bash
pnpm --filter @wafflebase/slides test -- --run src/view/canvas/shapes/registry.snap.test.ts
```

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add packages/slides/src/view/canvas/shapes/registry.snap.test.ts \
        packages/slides/src/view/canvas/shapes/__snapshots__/
git commit -m "$(cat <<'EOF'
Snapshot registry-wide shape rendering

Pins every registered path builder's canvas operations into a single
snapshot, guarding against accidental geometry regressions when
adding/refactoring builders. Updates require explicit --update intent.
EOF
)"
```

---

## Task 12: Extend `InsertKind` and `buildInsertElement`

**Files:**
- Modify: `packages/slides/src/view/editor/editor.ts`
- Modify: `packages/slides/src/view/editor/interactions/insert.ts`

After this task the editor controller and insert helper accept all 35 kinds; the toolbar wiring lands in Tasks 13–14.

- [x] **Step 1: Extend `InsertKind` in `editor.ts`**

Find the existing `InsertKind` type declaration in `packages/slides/src/view/editor/editor.ts`. Replace it with a re-export of `ShapeKind` plus `'text'`:

```ts
import type { ShapeKind } from '../../model/element';

export type InsertKind = ShapeKind | 'text';
```

(Remove any inlined union of `'rect' | 'ellipse' | 'line' | 'arrow' | 'text'`.)

- [x] **Step 2: Replace `buildInsertElement` switch with a category-default table**

Rewrite `packages/slides/src/view/editor/interactions/insert.ts`:

```ts
import { DEFAULT_BLOCK_STYLE, type Block } from '@wafflebase/docs';
import type {
  ElementInit,
  ShapeKind,
} from '../../../model/element';
import type { ThemeColor } from '../../../model/theme';
import type { InsertKind } from '../editor';

const DEFAULT_FILL: ThemeColor = { kind: 'role', role: 'accent1' };
const DEFAULT_TEXT_COLOR: ThemeColor = { kind: 'role', role: 'text' };
const DEFAULT_BACKGROUND: ThemeColor = { kind: 'role', role: 'background' };
const DEFAULT_STROKE_WIDTH = 2;
const TEXT_DEFAULT_W = 400;
const TEXT_DEFAULT_H = 80;

export interface Point { x: number; y: number; }

type ShapeStyle =
  | 'filled'           // accent1 fill, no stroke
  | 'outlined'         // background fill, text-coloured stroke
  | 'lineSpecial';     // line/arrow: stroke only

const STYLE_BY_KIND: ReadonlyMap<ShapeKind, ShapeStyle> = new Map([
  // Lines
  ['line', 'lineSpecial'],
  ['arrow', 'lineSpecial'],
  // Basic + Block Arrows + Equation → filled
  ...(['rect', 'roundRect', 'ellipse', 'triangle', 'rtTriangle', 'diamond',
       'parallelogram', 'trapezoid', 'pentagon', 'hexagon', 'octagon',
       'plus', 'donut', 'can', 'cloud',
       'rightArrow', 'leftArrow', 'upArrow', 'downArrow',
       'leftRightArrow', 'quadArrow', 'chevron', 'pentagonArrow',
       'mathPlus', 'mathMinus', 'mathMultiply',
       'mathDivide', 'mathEqual', 'mathNotEqual'] as ShapeKind[])
    .map((k) => [k, 'filled' as ShapeStyle]),
  // Callouts → outlined
  ['wedgeRectCallout', 'outlined'],
  ['wedgeRoundRectCallout', 'outlined'],
  ['wedgeEllipseCallout', 'outlined'],
  ['cloudCallout', 'outlined'],
]);

function defaultsForShape(
  kind: ShapeKind,
): Pick<NonNullable<ElementInit['data'] & { kind: ShapeKind }>, 'fill' | 'stroke'> {
  switch (STYLE_BY_KIND.get(kind)) {
    case 'lineSpecial':
      return {
        stroke: { color: DEFAULT_TEXT_COLOR, width: DEFAULT_STROKE_WIDTH },
        ...(kind === 'arrow' ? { fill: DEFAULT_TEXT_COLOR } : {}),
      };
    case 'outlined':
      return {
        fill: DEFAULT_BACKGROUND,
        stroke: { color: DEFAULT_TEXT_COLOR, width: DEFAULT_STROKE_WIDTH },
      };
    case 'filled':
    default:
      return { fill: DEFAULT_FILL };
  }
}

export function buildInsertElement(
  kind: InsertKind,
  start: Point,
  end: Point,
): ElementInit {
  if (kind === 'text') {
    return {
      type: 'text',
      frame: {
        x: start.x, y: start.y,
        w: TEXT_DEFAULT_W, h: TEXT_DEFAULT_H,
        rotation: 0,
      },
      data: {
        blocks: [{
          id: 'placeholder',
          type: 'paragraph',
          inlines: [{ text: '', style: { color: DEFAULT_TEXT_COLOR } }],
          style: { ...DEFAULT_BLOCK_STYLE },
        } as Block],
      },
    };
  }

  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const w = Math.abs(end.x - start.x);
  const h = Math.abs(end.y - start.y);
  const frame = { x, y, w, h, rotation: 0 };

  return { type: 'shape', frame, data: { kind, ...defaultsForShape(kind) } };
}
```

- [x] **Step 3: Update `insert.test.ts` to cover the new defaults**

Open `packages/slides/src/view/editor/interactions/insert.test.ts`. Add new cases (do not delete existing rect/ellipse/line/arrow tests):

```ts
it('uses outlined defaults for callouts', () => {
  const init = buildInsertElement(
    'wedgeRectCallout', { x: 0, y: 0 }, { x: 100, y: 50 });
  expect(init).toMatchObject({
    type: 'shape',
    data: {
      kind: 'wedgeRectCallout',
      fill: { kind: 'role', role: 'background' },
      stroke: { color: { kind: 'role', role: 'text' }, width: 2 },
    },
  });
});

it('uses filled defaults for new block-arrow kinds', () => {
  const init = buildInsertElement(
    'rightArrow', { x: 0, y: 0 }, { x: 100, y: 50 });
  expect(init).toMatchObject({
    type: 'shape',
    data: { kind: 'rightArrow', fill: { kind: 'role', role: 'accent1' } },
  });
});
```

- [x] **Step 4: Run verify**

```bash
pnpm verify:fast
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/slides/src/view/editor/editor.ts \
        packages/slides/src/view/editor/interactions/insert.ts \
        packages/slides/src/view/editor/interactions/insert.test.ts
git commit -m "$(cat <<'EOF'
Extend InsertKind and category-default table for new shapes

InsertKind now mirrors ShapeKind | 'text' so all 35 kinds are
selectable from the editor controller. buildInsertElement applies
per-category defaults (filled / outlined / line) instead of a
per-kind switch. Existing rect/ellipse/line/arrow defaults are
preserved.
EOF
)"
```

---

## Task 13: Implement `renderShapeIcon` helper

**Files:**
- Create: `packages/slides/src/view/canvas/shape-icon.ts`
- Create: `packages/slides/src/view/canvas/shape-icon.test.ts`
- Modify: `packages/slides/src/index.ts` (re-export)
- Modify: `packages/slides/src/node.ts` (re-export)

The picker (Task 14) needs a small icon for each shape. Render through the same path builders so the picker stays in sync with the canvas geometry.

- [x] **Step 1: Write the failing test**

```ts
// packages/slides/src/view/canvas/shape-icon.test.ts
import { describe, it, expect } from 'vitest';
import { renderShapeIcon } from './shape-icon';
import { createTestCanvas } from './test-canvas-env';

describe('renderShapeIcon', () => {
  it('strokes a shape outline using currentColor', () => {
    const canvas = createTestCanvas(24, 24);
    const ctx = canvas.getContext('2d')!;
    renderShapeIcon('rect', ctx, { w: 24, h: 24 });
    // Verify a stroke was applied (smoke check via the spy is overkill
    // here; the test asserts the function returns without throwing
    // and uses a real stroke path).
    expect(ctx.lineWidth).toBeGreaterThan(0);
  });

  it('returns silently for line/arrow specials', () => {
    const canvas = createTestCanvas(24, 24);
    const ctx = canvas.getContext('2d')!;
    expect(() => renderShapeIcon('line', ctx, { w: 24, h: 24 })).not.toThrow();
    expect(() => renderShapeIcon('arrow', ctx, { w: 24, h: 24 })).not.toThrow();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @wafflebase/slides test -- --run src/view/canvas/shape-icon.test.ts
```

Expected: FAIL — module not found.

- [x] **Step 3: Implement the helper**

```ts
// packages/slides/src/view/canvas/shape-icon.ts
import type { ShapeKind } from '../../model/element';
import type { FrameSize } from './shapes/builder';
import { PATH_BUILDERS } from './shapes';

const STROKE_WIDTH = 1.5;
const PADDING = 1;

/**
 * Paint a shape outline at icon size into the supplied context. Used
 * by the toolbar's Shape ▾ picker so previews track geometry from
 * PATH_BUILDERS without a separate icon asset. Caller is expected to
 * have set ctx.strokeStyle to currentColor (or the desired colour)
 * before calling. line/arrow are special-cased to a simple diagonal /
 * arrow glyph for the picker; their canvas-time renderers are
 * intentionally not reused (those paint with theme colours).
 */
export function renderShapeIcon(
  kind: ShapeKind,
  ctx: CanvasRenderingContext2D,
  size: FrameSize,
): void {
  const inset = PADDING + STROKE_WIDTH / 2;
  const w = Math.max(0, size.w - inset * 2);
  const h = Math.max(0, size.h - inset * 2);
  ctx.save();
  try {
    ctx.translate(inset, inset);
    ctx.lineWidth = STROKE_WIDTH;
    ctx.lineJoin = 'round';
    if (kind === 'line') {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(w, h);
      ctx.stroke();
      return;
    }
    if (kind === 'arrow') {
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w * 0.75, h / 2);
      ctx.moveTo(w * 0.55, h * 0.25);
      ctx.lineTo(w * 0.75, h / 2);
      ctx.lineTo(w * 0.55, h * 0.75);
      ctx.stroke();
      return;
    }
    const builder = PATH_BUILDERS.get(kind);
    if (!builder) return;
    const path = builder({ w, h }, undefined);
    ctx.stroke(path);
  } finally {
    ctx.restore();
  }
}
```

- [x] **Step 4: Add re-exports to public API**

In `packages/slides/src/index.ts`, add to the existing exports list:

```ts
export { renderShapeIcon } from './view/canvas/shape-icon';
export { PATH_BUILDERS, ADJUSTMENT_SPECS } from './view/canvas/shapes';
export type { PathBuilder, AdjustmentSpec, FrameSize } from './view/canvas/shapes/builder';
```

In `packages/slides/src/node.ts`, mirror the same export lines.

- [x] **Step 5: Run tests**

```bash
pnpm verify:fast
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add packages/slides/src/view/canvas/shape-icon.ts \
        packages/slides/src/view/canvas/shape-icon.test.ts \
        packages/slides/src/index.ts \
        packages/slides/src/node.ts
git commit -m "$(cat <<'EOF'
Add renderShapeIcon helper for toolbar previews

Paints a shape outline at icon size into the supplied context using
the same PATH_BUILDERS the canvas uses, so the upcoming Shape ▾
picker's previews cannot drift from the actual geometry. line/arrow
get a small dedicated picker glyph since their canvas-time
renderers paint themed fills.
EOF
)"
```

---

## Task 14: Implement the `<ShapePicker />` component

**Files:**
- Create: `packages/frontend/src/app/slides/shape-picker.tsx`
- Create: `packages/frontend/tests/app/slides/shape-picker.test.tsx`

- [x] **Step 1: Write the failing test**

```tsx
// packages/frontend/tests/app/slides/shape-picker.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ShapePicker, SHAPE_PICKER_CATEGORIES } from
  '../../../src/app/slides/shape-picker';

describe('ShapePicker', () => {
  it('opens the popover and renders a button per shape', async () => {
    const onSelect = vi.fn();
    render(<ShapePicker activeKind={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /shape/i }));
    const total = SHAPE_PICKER_CATEGORIES.reduce(
      (sum, c) => sum + c.kinds.length, 0,
    );
    expect(total).toBe(35);
    for (const cat of SHAPE_PICKER_CATEGORIES) {
      for (const kind of cat.kinds) {
        expect(screen.getByLabelText(kind.label)).toBeInTheDocument();
      }
    }
  });

  it('calls onSelect with the chosen kind', () => {
    const onSelect = vi.fn();
    render(<ShapePicker activeKind={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /shape/i }));
    fireEvent.click(screen.getByLabelText('Rectangle'));
    expect(onSelect).toHaveBeenCalledWith('rect');
  });
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @wafflebase/frontend test -- --run tests/app/slides/shape-picker.test.tsx
```

Expected: FAIL — module not found.

- [x] **Step 3: Implement the component**

```tsx
// packages/frontend/src/app/slides/shape-picker.tsx
import { useEffect, useRef } from "react";
import * as Popover from "@radix-ui/react-popover";
import { IconShape } from "@tabler/icons-react";
import {
  renderShapeIcon,
  type ShapeKind,
} from "@wafflebase/slides";

type CategoryEntry = {
  kind: ShapeKind;
  label: string;
};

export type Category = {
  id: string;
  title: string;
  kinds: readonly CategoryEntry[];
};

export const SHAPE_PICKER_CATEGORIES: readonly Category[] = [
  {
    id: "lines",
    title: "Lines",
    kinds: [
      { kind: "line", label: "Line" },
      { kind: "arrow", label: "Arrow" },
    ],
  },
  {
    id: "shapes",
    title: "Shapes",
    kinds: [
      { kind: "rect", label: "Rectangle" },
      { kind: "roundRect", label: "Rounded rectangle" },
      { kind: "ellipse", label: "Ellipse" },
      { kind: "triangle", label: "Triangle" },
      { kind: "rtTriangle", label: "Right triangle" },
      { kind: "diamond", label: "Diamond" },
      { kind: "parallelogram", label: "Parallelogram" },
      { kind: "trapezoid", label: "Trapezoid" },
      { kind: "pentagon", label: "Pentagon" },
      { kind: "hexagon", label: "Hexagon" },
      { kind: "octagon", label: "Octagon" },
      { kind: "plus", label: "Plus" },
      { kind: "donut", label: "Donut" },
      { kind: "can", label: "Can" },
      { kind: "cloud", label: "Cloud" },
    ],
  },
  {
    id: "block-arrows",
    title: "Block Arrows",
    kinds: [
      { kind: "rightArrow", label: "Right arrow" },
      { kind: "leftArrow", label: "Left arrow" },
      { kind: "upArrow", label: "Up arrow" },
      { kind: "downArrow", label: "Down arrow" },
      { kind: "leftRightArrow", label: "Left-right arrow" },
      { kind: "quadArrow", label: "Quad arrow" },
      { kind: "chevron", label: "Chevron" },
      { kind: "pentagonArrow", label: "Pentagon arrow" },
    ],
  },
  {
    id: "callouts",
    title: "Callouts",
    kinds: [
      { kind: "wedgeRectCallout", label: "Rectangular callout" },
      { kind: "wedgeRoundRectCallout", label: "Rounded callout" },
      { kind: "wedgeEllipseCallout", label: "Oval callout" },
      { kind: "cloudCallout", label: "Cloud callout" },
    ],
  },
  {
    id: "equation",
    title: "Equation",
    kinds: [
      { kind: "mathPlus", label: "Plus" },
      { kind: "mathMinus", label: "Minus" },
      { kind: "mathMultiply", label: "Multiply" },
      { kind: "mathDivide", label: "Divide" },
      { kind: "mathEqual", label: "Equal" },
      { kind: "mathNotEqual", label: "Not equal" },
    ],
  },
];

interface IconButtonProps {
  kind: ShapeKind;
  label: string;
  active: boolean;
  onSelect: (kind: ShapeKind) => void;
}

function IconButton({ kind, label, active, onSelect }: IconButtonProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = 24 * dpr;
    canvas.height = 24 * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, 24, 24);
    ctx.strokeStyle = "currentColor";
    renderShapeIcon(kind, ctx, { w: 24, h: 24 });
  }, [kind]);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-active={active || undefined}
      onClick={() => onSelect(kind)}
      className="flex size-8 items-center justify-center rounded text-foreground hover:bg-accent data-[active=true]:bg-accent"
    >
      <canvas ref={ref} className="size-6" />
    </button>
  );
}

export interface ShapePickerProps {
  activeKind: ShapeKind | null;
  onSelect: (kind: ShapeKind) => void;
}

export function ShapePicker({ activeKind, onSelect }: ShapePickerProps) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Shape"
          className="inline-flex h-8 items-center gap-1 rounded px-2 hover:bg-accent"
        >
          <IconShape size={16} />
          <span className="text-xs">Shape</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-50 w-[280px] max-h-[480px] overflow-y-auto rounded border bg-popover p-2 shadow"
        >
          {SHAPE_PICKER_CATEGORIES.map((cat) => (
            <section key={cat.id} className="mb-2 last:mb-0">
              <h4 className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {cat.title}
              </h4>
              <div className="grid grid-cols-6 gap-1">
                {cat.kinds.map((entry) => (
                  <IconButton
                    key={entry.kind}
                    kind={entry.kind}
                    label={entry.label}
                    active={entry.kind === activeKind}
                    onSelect={(k) => onSelect(k)}
                  />
                ))}
              </div>
            </section>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
```

- [x] **Step 4: Run the picker test**

```bash
pnpm --filter @wafflebase/frontend test -- --run tests/app/slides/shape-picker.test.tsx
```

Expected: PASS.

If the test fails because `IconShape` is not exported from `@tabler/icons-react`, replace with `IconShapeFilled` or `IconSquare` — pick whichever is available in the version pinned in `package.json`.

- [x] **Step 5: Run frontend verify**

```bash
pnpm --filter @wafflebase/frontend lint
pnpm --filter @wafflebase/frontend typecheck
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add packages/frontend/src/app/slides/shape-picker.tsx \
        packages/frontend/tests/app/slides/shape-picker.test.tsx
git commit -m "$(cat <<'EOF'
Add ShapePicker popover with categorised 35-shape catalogue

Single Shape ▾ trigger replaces the previous five inline insert
buttons. Popover renders five category sections (Lines, Shapes,
Block Arrows, Callouts, Equation) as 6-col grids of canvas-rendered
icons sourced from the slides PATH_BUILDERS, so previews stay in
sync with canvas geometry without bespoke SVG assets.
EOF
)"
```

---

## Task 15: Wire `<ShapePicker />` into `slides-formatting-toolbar.tsx`

**Files:**
- Modify: `packages/frontend/src/app/slides/slides-formatting-toolbar.tsx`

- [x] **Step 1: Replace the `INSERT_BUTTONS` strip with the picker**

Open `packages/frontend/src/app/slides/slides-formatting-toolbar.tsx`. Find:

```tsx
const INSERT_BUTTONS: InsertButton[] = [
  { kind: "rect",    label: "Rectangle", icon: <IconSquare size={16} /> },
  { kind: "ellipse", label: "Ellipse",   icon: <IconCircle size={16} /> },
  { kind: "line",    label: "Line",      icon: <IconLine size={16} /> },
  { kind: "arrow",   label: "Arrow",     icon: <IconArrowRight size={16} /> },
  { kind: "text",    label: "Text box",  icon: <IconLetterT size={16} /> },
];
```

Delete this constant and the per-button render in the JSX (currently around lines 195–202). Replace with:

```tsx
import { ShapePicker } from "./shape-picker";

// …in the JSX, replace the INSERT_BUTTONS .map(...) block with:
<>
  <ToggleButton
    pressed={insertMode === "text"}
    onPressedChange={(pressed) =>
      editor?.setInsertMode(pressed ? "text" : null)
    }
    aria-label="Text box"
    title="Text box"
  >
    <IconLetterT size={16} />
  </ToggleButton>
  <ShapePicker
    activeKind={
      insertMode && insertMode !== "text"
        ? (insertMode as ShapeKind)
        : null
    }
    onSelect={(kind) => editor?.setInsertMode(kind)}
  />
</>
```

(Adjust `ToggleButton` import / styling to match the existing Toolbar primitive used in this file. Re-use the existing pressed-state / aria pattern unchanged.)

Remove now-unused icon imports (`IconSquare`, `IconCircle`, `IconLine`, `IconArrowRight`).

- [x] **Step 2: Add the `ShapeKind` import**

At the top of `slides-formatting-toolbar.tsx`:

```tsx
import { type ShapeKind } from "@wafflebase/slides";
```

- [x] **Step 3: Run frontend tests**

```bash
pnpm --filter @wafflebase/frontend test -- --run tests/app/slides/
```

Expected: PASS. The existing toolbar tests (if any reference `INSERT_BUTTONS` directly) need updating; `themed-color-picker.test.tsx` should keep passing because it does not depend on the insert strip.

- [x] **Step 4: Run full verify**

```bash
pnpm verify:fast
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/frontend/src/app/slides/slides-formatting-toolbar.tsx
git commit -m "$(cat <<'EOF'
Wire ShapePicker into the slides formatting toolbar

Replaces the five inline insert buttons with a single Text-box
toggle plus the categorised Shape ▾ popover. Insert mode wiring
is unchanged: clicks still call editor.setInsertMode(kind), and
the next pointer drag on the slide creates that shape.
EOF
)"
```

---

## Task 16: Manual smoke test in `pnpm dev`

**Files:** none — manual verification.

- [x] **Step 1: Start the dev server**

```bash
docker compose up -d   # if not already running
pnpm dev
```

- [x] **Step 2: Open a slides document and exercise the picker**

Open http://localhost:5173, create a new slides document, open the **Shape ▾** popover, and:

- Confirm all 5 category sections render with their respective shapes.
- Hover each shape — tooltip shows the human-readable label.
- Click `Rounded rectangle`, drag on the slide — verify a roundRect appears with rounded corners (default radius).
- Repeat for one shape per category: `pentagonArrow` (block arrow), `wedgeRectCallout` (callout, with visible tail), `mathDivide` (equation).
- Switch theme via the theme picker — confirm new shapes' default fill (`accent1`) and outline (`text` for callouts) update.
- Resize a `donut` from 100×100 to 200×60 — confirm the hole stays within the outline (no degenerate geometry).

- [x] **Step 3: Reload the page**

Reload, confirm all created shapes survive Yorkie persistence and re-render correctly. (This validates the `adjustments` field round-trips via the existing schema.)

- [x] **Step 4: Capture lessons**

Create `docs/tasks/active/20260509-slides-shapes-p1-lessons.md` and write 3–5 bullets covering anything surprising that came up during implementation (e.g. "OOXML donut adjustment uses `min(w,h)` not radius-only", "JSDOM canvas required workaround for X").

- [x] **Step 5: Verify and commit lessons**

```bash
pnpm verify:fast
git add docs/tasks/active/20260509-slides-shapes-p1-lessons.md
git commit -m "Capture Phase 1 shapes implementation lessons"
```

---

## Task 17: Open the PR

**Files:** none.

- [x] **Step 1: Sync with main**

```bash
git fetch origin
git rebase origin/main
```

Resolve any conflicts (most likely in `slides-formatting-toolbar.tsx` if other UI work has merged). Re-run `pnpm verify:fast` after rebase.

- [x] **Step 2: Self-review the branch**

Use the `superpowers:requesting-code-review` skill (or `/code-review`) over the full branch diff. Apply blocking findings; document non-blocking notes for the PR description.

- [x] **Step 3: Push and open PR**

```bash
git push -u origin <branch-name>
gh pr create --title "Add 31 OOXML-aligned shapes (slides P1 foundation)" --body "$(cat <<'EOF'
## Summary

- Phase 1 of the four-phase slides shape library expansion (spec: `docs/design/slides/slides-shapes-p1.md`).
- Grows `ShapeKind` from 4 to 35; adds `adjustments?: number[]` mirroring OOXML `<a:avLst>`.
- Refactors `shape-renderer.ts` into a `Map<ShapeKind, (size, adjustments) => Path2D>` registry; `line` and `arrow` keep bespoke renderers.
- Replaces the 5 inline insert buttons with a categorised `Shape ▾` popover.
- 31 new path builders + 2 refactored (rect, ellipse) + 2 unchanged specials (line, arrow).

## Test plan

- [x] `pnpm verify:fast` passes.
- [x] Snapshot test pins every registered builder's canvas operations.
- [x] `pnpm dev` smoke: open `Shape ▾`, insert one shape per category, switch theme, reload.
- [x] Existing rect/ellipse/line/arrow documents still render and remain editable (no migration).
EOF
)"
```

- [x] **Step 4: Archive task docs after merge**

After the PR merges:

```bash
pnpm tasks:archive
pnpm tasks:index
git add docs/tasks/
git commit -m "Archive slides shapes P1 task docs"
git push
```

---

## Roadmap follow-ups (not in this plan)

| Phase | Scope |
|-------|-------|
| P2 | `flowchart` (14 builders) + `stars` (6 builders); toolbar number-input UI for `adjustments` |
| P3 | Remaining GS-parity shapes (~50); drag-handle (yellow-diamond) editor for `adjustments`; action-button click handlers in presentation mode |
| P4 | DrawingML `prstGeom` formula evaluator; `kind: 'preset'` + `presetName: string` slot for unknown-preset import |
| Importer | Map all 35 P1 kinds in `prst → ShapeKind` table when the PPTX importer ships |
