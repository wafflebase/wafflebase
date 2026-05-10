# Slides Shape Library Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 14 flowchart + 6 star OOXML-aligned shape kinds to the slides shape library (cumulative 35 → 55), including a shared `regularPolygonPath` helper, two new picker categories (Flowchart, Stars), and refreshed visual baselines. No adjustments-editing UI in this PR (deferred to P3 with drag handles).

**Architecture:** Reuses the P1 path-builder registry pattern from `slides-shapes-p1.md`. Each new shape ships as a pure `(size, adjustments?) => Path2D` builder file under `packages/slides/src/view/canvas/shapes/{stars,flowchart}/`, with a sibling `*.test.ts` exercising `isPointInPath` reference points. Stars share a new `regularPolygonPath` helper in `shapes/builder.ts`. Document-style flowchart shapes (Document, Multidocument, PunchedTape) share a small sine-wave subpath helper. Picker categories add to `SHAPE_PICKER_CATEGORIES` in `shape-picker-helpers.ts`. The dispatcher in `shape-renderer.ts` is unchanged — every new kind goes through the existing path-builder branch.

**Tech Stack:** TypeScript, Vitest (slides) / node:test (frontend), Path2D, Radix DropdownMenu (picker, P1 pattern), Docker-based visual harness for baselines.

**Spec:** `docs/design/slides/slides-shapes-p2.md`

---

## Pre-flight

- [x] **Step P-1: Inspect working tree on `main`**

```bash
git status
git pull --ff-only origin main
```

Expected: branch is `main`, no merge conflicts. The brainstorming session left **3 uncommitted files** that this branch carries into its first commit (do not stash, do not discard):

```text
docs/design/slides/slides-shapes-p2.md          (new — P2 spec)
docs/design/slides/slides-shapes-p1.md          (modified — roadmap row)
docs/design/README.md                           (modified — slides index)
docs/tasks/active/20260509-slides-shapes-p2-todo.md     (new — this plan)
docs/tasks/active/20260509-slides-shapes-p2-lessons.md  (new — lessons stub)
```

If `git status` reports anything else uncommitted, stop and investigate before continuing.

- [x] **Step P-2: Create feature branch**

```bash
git checkout -b slides-shapes-p2
```

Expected: switched to new branch.

- [x] **Step P-3: Verify P1 baseline is green locally**

```bash
pnpm install
pnpm sheets build
pnpm --filter @wafflebase/docs build
pnpm slides build
pnpm verify:fast
```

Expected: all green. (Per P1 lessons: a fresh checkout requires the workspace builds before `verify:fast` can resolve directory imports.)

---

## Task 1: Extend `ShapeKind` union with 20 new kinds

**Files:**
- Modify: `packages/slides/src/model/element.ts:23-40`

This task extends the type union only. The dispatcher fallback (`drawPlaceholderRect`) will paint the new kinds until their builders register in T4–T6, keeping the codebase compilable and rendering-safe at every commit. The frontend `YorkieShapeElement.data.kind` imports `ShapeKind` from `@wafflebase/slides`, so it auto-extends — no parallel edit needed.

- [x] **Step 1.1: Replace the `ShapeKind` union to include 20 new kinds**

Replace `packages/slides/src/model/element.ts:23-40` with:

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
  | 'mathDivide' | 'mathEqual' | 'mathNotEqual'
  // Stars (6, P2)
  | 'star4' | 'star5' | 'star6' | 'star7' | 'star8' | 'star10'
  // Flowchart (14, P2)
  | 'flowChartTerminator' | 'flowChartPredefinedProcess'
  | 'flowChartInternalStorage' | 'flowChartDocument'
  | 'flowChartMultidocument' | 'flowChartManualInput'
  | 'flowChartManualOperation' | 'flowChartOffpageConnector'
  | 'flowChartPunchedCard' | 'flowChartPunchedTape'
  | 'flowChartSummingJunction' | 'flowChartOr'
  | 'flowChartDelay' | 'flowChartDisplay';
```

- [x] **Step 1.2: Verify build and tests still green**

```bash
pnpm slides build
pnpm --filter @wafflebase/slides test
pnpm verify:fast
```

Expected: all green. The 20 new kinds are typed but unregistered; dispatcher's `drawPlaceholderRect` covers them. Existing `shape-renderer.test.ts` still exercises the unknown-kind path via the synthetic `'__test_unknown__'` cast.

- [x] **Step 1.3: Commit (bundles the design docs + plan + lessons stub)**

```bash
git add packages/slides/src/model/element.ts \
        docs/design/slides/slides-shapes-p2.md \
        docs/design/slides/slides-shapes-p1.md \
        docs/design/README.md \
        docs/tasks/active/20260509-slides-shapes-p2-todo.md \
        docs/tasks/active/20260509-slides-shapes-p2-lessons.md
git commit -m "Add 20 P2 ShapeKind values + P2 design doc and plan

Extends the ShapeKind union ahead of the P2 builder registrations.
Until each builder lands in T4–T6, the dispatcher paints the new
kinds via the placeholder fallback. The frontend Yorkie schema
imports ShapeKind from @wafflebase/slides, so YorkieShapeElement
auto-extends without a parallel edit.

Includes the P2 design doc, the implementation plan, and the
lessons stub (filled in T9). P1's roadmap table updated to move
the toolbar adjustments UI from P2 to P3 — see slides-shapes-p2.md
for rationale."
```

The project workflow expects task docs and `tasks/README.md` to be committed together; T1 is the first commit on the branch, so they land here.

---

## Task 2: Add `regularPolygonPath` helper

**Files:**
- Modify: `packages/slides/src/view/canvas/shapes/builder.ts`
- Test: `packages/slides/src/view/canvas/shapes/builder.test.ts` (new file)

Stars + the existing `pentagon` builder share inscribed-polygon vertex math. Centralise it before T3 refactors `pentagon` to call it and T4 builds stars on top.

- [x] **Step 2.1: Write the failing test**

Create `packages/slides/src/view/canvas/shapes/builder.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { regularPolygonPath } from './builder';

describe('regularPolygonPath', () => {
  it('places the first vertex apex-up at default rotation', () => {
    const verts = regularPolygonPath(50, 50, 50, 50, 5);
    expect(verts).toHaveLength(5);
    expect(verts[0].x).toBeCloseTo(50, 5);
    expect(verts[0].y).toBeCloseTo(0, 5); // top of inscribing circle
  });

  it('returns equally spaced vertices on the inscribed ellipse', () => {
    const verts = regularPolygonPath(0, 0, 1, 1, 4);
    // square at default rotation: top, right, bottom, left
    expect(verts[0].x).toBeCloseTo(0, 5);
    expect(verts[0].y).toBeCloseTo(-1, 5);
    expect(verts[1].x).toBeCloseTo(1, 5);
    expect(verts[1].y).toBeCloseTo(0, 5);
    expect(verts[2].x).toBeCloseTo(0, 5);
    expect(verts[2].y).toBeCloseTo(1, 5);
    expect(verts[3].x).toBeCloseTo(-1, 5);
    expect(verts[3].y).toBeCloseTo(0, 5);
  });

  it('honours an explicit rotation override', () => {
    // 4-gon rotated +45° from default -π/2 is a "diamond" with vertices on the axes shifted
    const verts = regularPolygonPath(0, 0, 1, 1, 4, -Math.PI / 4);
    expect(verts[0].x).toBeCloseTo(Math.SQRT1_2, 5);
    expect(verts[0].y).toBeCloseTo(-Math.SQRT1_2, 5);
  });

  it('supports an elliptical inscribed shape (rx ≠ ry)', () => {
    const verts = regularPolygonPath(0, 0, 4, 2, 4);
    // top-of-ellipse vertex at (0, -2), right at (4, 0)
    expect(verts[0].x).toBeCloseTo(0, 5);
    expect(verts[0].y).toBeCloseTo(-2, 5);
    expect(verts[1].x).toBeCloseTo(4, 5);
    expect(verts[1].y).toBeCloseTo(0, 5);
  });
});
```

- [x] **Step 2.2: Run test, verify it fails**

```bash
pnpm --filter @wafflebase/slides test -- builder.test.ts
```

Expected: FAIL — `regularPolygonPath` is not exported.

- [x] **Step 2.3: Implement the helper**

Append to `packages/slides/src/view/canvas/shapes/builder.ts`:

```ts
/**
 * Vertices of a regular N-gon inscribed in an ellipse. Used by the
 * pentagon builder and star builders. Returned in polygon-walk
 * order (no Path2D), so callers can interleave with a second ring
 * (stars) or close into a Path2D directly (pentagon).
 *
 * @param cx, cy   ellipse centre
 * @param rx, ry   ellipse radii (frame-local, may be unequal)
 * @param points   vertex count (>= 3)
 * @param rotation starting angle in radians; default `-Math.PI / 2`
 *                 (first vertex straight up)
 */
export function regularPolygonPath(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  points: number,
  rotation: number = -Math.PI / 2,
): { x: number; y: number }[] {
  const verts: { x: number; y: number }[] = [];
  for (let i = 0; i < points; i++) {
    const angle = rotation + (i / points) * Math.PI * 2;
    verts.push({
      x: cx + rx * Math.cos(angle),
      y: cy + ry * Math.sin(angle),
    });
  }
  return verts;
}
```

- [x] **Step 2.4: Run test, verify it passes**

```bash
pnpm --filter @wafflebase/slides test -- builder.test.ts
```

Expected: 4 tests pass.

- [x] **Step 2.5: Commit**

```bash
git add packages/slides/src/view/canvas/shapes/builder.ts \
        packages/slides/src/view/canvas/shapes/builder.test.ts
git commit -m "Add regularPolygonPath helper to shapes/builder

Computes inscribed-polygon vertices for an arbitrary axis-aligned
ellipse. Will be used by the existing pentagon builder (refactor
in next commit) and the new star builders."
```

---

## Task 3: Refactor `pentagon` to use `regularPolygonPath`

**Files:**
- Modify: `packages/slides/src/view/canvas/shapes/basic/pentagon.ts`

Smoke-tests the helper on a known shape. Output must be coordinate-equivalent (modulo floating-point) to the pre-refactor builder.

- [x] **Step 3.1: Replace the pentagon builder body**

Replace `packages/slides/src/view/canvas/shapes/basic/pentagon.ts` entirely with:

```ts
import type { PathBuilder } from '../builder';
import { regularPolygonPath } from '../builder';

/**
 * `pentagon` — regular convex pentagon inscribed in the element frame
 * with the apex at the top edge midpoint. No adjustments.
 */
export const buildPentagon: PathBuilder = ({ w, h }) => {
  const cx = w / 2;
  const cy = h / 2;
  const verts = regularPolygonPath(cx, cy, w / 2, h / 2, 5);
  const path = new Path2D();
  path.moveTo(verts[0].x, verts[0].y);
  for (let i = 1; i < verts.length; i++) {
    path.lineTo(verts[i].x, verts[i].y);
  }
  path.closePath();
  return path;
};
```

- [x] **Step 3.2: Run pentagon test, verify still green**

```bash
pnpm --filter @wafflebase/slides test -- pentagon
```

Expected: PASS. The pre-existing pentagon test asserts `isPointInPath` at frame-relative reference points, which depend only on output geometry — identical pre/post refactor.

- [x] **Step 3.3: Run the full slides test + visual snapshot to confirm no regression**

```bash
pnpm --filter @wafflebase/slides test
```

Expected: PASS. The registry snapshot (`registry.snap.test.ts`) re-renders pentagon and asserts unchanged ctx-spy output.

- [x] **Step 3.4: Commit**

```bash
git add packages/slides/src/view/canvas/shapes/basic/pentagon.ts
git commit -m "Refactor pentagon to use regularPolygonPath helper

Pure refactor — output is coordinate-equivalent to the previous
hand-rolled trigonometry. Smoke-tests the helper on a known shape
ahead of the star builders."
```

---

## Task 4: Stars (6 builders + tests + registry)

**Files:**
- Create: `packages/slides/src/view/canvas/shapes/stars/star4.ts` (and 5, 6, 7, 8, 10)
- Create: matching `*.test.ts` files
- Modify: `packages/slides/src/view/canvas/shapes/index.ts` (register 6 + adjustment specs)

### 4a. Build template for stars

All 6 stars share an identical builder pattern parameterised by point count and OOXML default. The implementer creates each file using this template:

```ts
// packages/slides/src/view/canvas/shapes/stars/star{N}.ts
import type { PathBuilder, AdjustmentSpec } from '../builder';
import { adj, regularPolygonPath } from '../builder';

export const STAR_{N}_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  {
    name: 'Inner radius',
    defaultValue: {DEFAULT},
    min: 0,
    max: 50000,
    format: (v) => `${(v / 1000).toFixed(1)}%`,
  },
];

/**
 * `star{N}` — {N}-pointed regular star inscribed in the element frame,
 * apex up. Inner ring radius is `(adj[0] / 100000) × outer`.
 */
export const buildStar{N}: PathBuilder = ({ w, h }, adjustments) => {
  const ratio = adj(adjustments, 0, {DEFAULT}) / 100000;
  const cx = w / 2;
  const cy = h / 2;
  const rx = w / 2;
  const ry = h / 2;
  const points = {N};
  const baseRotation = -Math.PI / 2;
  const innerRotation = baseRotation + Math.PI / points;
  const outer = regularPolygonPath(cx, cy, rx, ry, points, baseRotation);
  const inner = regularPolygonPath(
    cx,
    cy,
    rx * ratio,
    ry * ratio,
    points,
    innerRotation,
  );
  const path = new Path2D();
  path.moveTo(outer[0].x, outer[0].y);
  for (let i = 0; i < points; i++) {
    path.lineTo(inner[i].x, inner[i].y);
    const next = (i + 1) % points;
    path.lineTo(outer[next].x, outer[next].y);
  }
  path.closePath();
  return path;
};
```

OOXML defaults (verify against ECMA-376 Part 1 §20.1.9 during implementation; if PowerPoint visual reference disagrees, correct here):

| File | `{N}` | `{DEFAULT}` |
|---|---|---|
| `star4.ts`  | 4  | `12500` |
| `star5.ts`  | 5  | `19098` |
| `star6.ts`  | 6  | `28868` |
| `star7.ts`  | 7  | `34601` |
| `star8.ts`  | 8  | `37500` |
| `star10.ts` | 10 | `42533` |

### 4b. Test template for stars

```ts
// packages/slides/src/view/canvas/shapes/stars/star{N}.test.ts
import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import { createTestCanvas } from '../../test-canvas-env';
import { buildStar{N} } from './star{N}';

describe('buildStar{N}', () => {
  it('contains the centre and excludes corners', () => {
    const path = buildStar{N}({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);  // centre
    expect(ctx.isPointInPath(path, 1, 1)).toBe(false);   // corner
    expect(ctx.isPointInPath(path, 99, 99)).toBe(false); // corner
  });

  it('apex-up vertex sits on the top edge', () => {
    const path = buildStar{N}({ w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // apex tip is at (50, 0); 1px in is inside
    expect(ctx.isPointInPath(path, 50, 1)).toBe(true);
  });

  it('honours custom inner-radius adjustment', () => {
    // inner radius 5% (very thin star) — points are sliver-thin,
    // so the centre is still inside but a generous off-axis point
    // (say (10, 50)) is outside
    const path = buildStar{N}({ w: 100, h: 100 }, [5000]);
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 10, 50)).toBe(false);
  });
});
```

### 4c. Steps

- [x] **Step 4.1: Create all 6 star builder files using the template above**

Six files: `star4.ts`, `star5.ts`, `star6.ts`, `star7.ts`, `star8.ts`, `star10.ts`. Replace `{N}` and `{DEFAULT}` per the table.

- [x] **Step 4.2: Create all 6 sibling test files using the test template**

- [x] **Step 4.3: Register the 6 builders in `shapes/index.ts`**

Add imports (alphabetical after the equation group):

```ts
import { buildStar4, STAR_4_ADJUSTMENTS } from './stars/star4';
import { buildStar5, STAR_5_ADJUSTMENTS } from './stars/star5';
import { buildStar6, STAR_6_ADJUSTMENTS } from './stars/star6';
import { buildStar7, STAR_7_ADJUSTMENTS } from './stars/star7';
import { buildStar8, STAR_8_ADJUSTMENTS } from './stars/star8';
import { buildStar10, STAR_10_ADJUSTMENTS } from './stars/star10';
```

Add registry calls (after the existing `mathNotEqual` set):

```ts
PATH_BUILDERS.set('star4', buildStar4);
PATH_BUILDERS.set('star5', buildStar5);
PATH_BUILDERS.set('star6', buildStar6);
PATH_BUILDERS.set('star7', buildStar7);
PATH_BUILDERS.set('star8', buildStar8);
PATH_BUILDERS.set('star10', buildStar10);
```

Add adjustment-spec calls (after existing math entries):

```ts
ADJUSTMENT_SPECS.set('star4', STAR_4_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('star5', STAR_5_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('star6', STAR_6_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('star7', STAR_7_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('star8', STAR_8_ADJUSTMENTS);
ADJUSTMENT_SPECS.set('star10', STAR_10_ADJUSTMENTS);
```

- [x] **Step 4.4: Run tests, accept registry snapshot growth**

```bash
pnpm --filter @wafflebase/slides test
```

Expected: 18 new tests pass (3 × 6 stars). The registry snapshot test (`registry.snap.test.ts`) fails because the catalog grew. Update the snapshot:

```bash
pnpm --filter @wafflebase/slides test -- -u
```

Expected: snapshot regenerates with 6 new entries; all tests green.

- [x] **Step 4.5: Visual sanity check**

```bash
pnpm dev
```

Open the slides editor, manually create one of each star via `pnpm dev` browser session (or write a 1-off scenario in `slides-scenarios.tsx` and view via `pnpm verify:browser:docker` — see T8). Confirm the stars render in PowerPoint-equivalent geometry (apex up, no degenerate sliver, inner ring ratio matches reference).

If a default looks visually wrong (e.g. star10 inner ring too small to show distinct points), correct the `{DEFAULT}` value, re-run tests, regenerate snapshot.

- [x] **Step 4.6: Commit**

```bash
git add packages/slides/src/view/canvas/shapes/stars/ \
        packages/slides/src/view/canvas/shapes/index.ts \
        packages/slides/src/view/canvas/shapes/__snapshots__/
git commit -m "Add 6 star shapes (star4–star10)

Each star is N-pointed and inscribed in the element frame,
apex up, with an OOXML-default inner-radius ratio. Builders
share regularPolygonPath for vertex math."
```

---

## Task 5: Flowchart simple (7 builders + tests + registry)

**Files:**
- Create: `packages/slides/src/view/canvas/shapes/flowchart/{terminator,predefined-process,internal-storage,manual-input,manual-operation,offpage-connector,punched-card}.ts`
- Create: matching `*.test.ts`
- Modify: `packages/slides/src/view/canvas/shapes/index.ts`

These 7 are non-parametric and use only `lineTo` / `quadraticCurveTo` (well-supported by the test-canvas shim). None register an `AdjustmentSpec` in P2.

### 5a. Geometry per shape

Each builder has signature `({ w, h }) => Path2D`.

- [x] **Step 5.1: `flowChartTerminator` — pill (rounded rect with `r = min(w,h)/2`)**

`packages/slides/src/view/canvas/shapes/flowchart/terminator.ts`:

```ts
import type { PathBuilder } from '../builder';

/**
 * `flowChartTerminator` — pill shape (rounded rectangle with corner
 * radius = `min(w, h) / 2`, i.e. fully rounded ends). Identical to
 * `roundRect` at maximum corner radius; kept as a distinct kind so
 * the OOXML preset round-trips.
 */
export const buildFlowChartTerminator: PathBuilder = ({ w, h }) => {
  const r = Math.min(w, h) / 2;
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

- [x] **Step 5.2: `flowChartPredefinedProcess` — rect with two vertical bars at `x = w/8` and `x = 7w/8`**

`packages/slides/src/view/canvas/shapes/flowchart/predefined-process.ts`:

```ts
import type { PathBuilder } from '../builder';

/**
 * `flowChartPredefinedProcess` — rectangle with two thin vertical
 * bars at `x = w/8` and `x = 7w/8`. Bars render as separate
 * sub-paths so stroke draws them; fill paints the outer rect only
 * via nonzero rule (bars are zero-area lines).
 */
export const buildFlowChartPredefinedProcess: PathBuilder = ({ w, h }) => {
  const path = new Path2D();
  path.rect(0, 0, w, h);
  path.moveTo(w / 8, 0);
  path.lineTo(w / 8, h);
  path.moveTo((7 * w) / 8, 0);
  path.lineTo((7 * w) / 8, h);
  return path;
};
```

- [x] **Step 5.3: `flowChartInternalStorage` — rect with horizontal bar at `y = h/8` and vertical bar at `x = w/8`**

`packages/slides/src/view/canvas/shapes/flowchart/internal-storage.ts`:

```ts
import type { PathBuilder } from '../builder';

/**
 * `flowChartInternalStorage` — rectangle with one horizontal bar
 * at `y = h/8` (top "header") and one vertical bar at `x = w/8`
 * (left "stub"), evoking a register / memory cell.
 */
export const buildFlowChartInternalStorage: PathBuilder = ({ w, h }) => {
  const path = new Path2D();
  path.rect(0, 0, w, h);
  path.moveTo(0, h / 8);
  path.lineTo(w, h / 8);
  path.moveTo(w / 8, 0);
  path.lineTo(w / 8, h);
  return path;
};
```

- [x] **Step 5.4: `flowChartManualInput` — quadrilateral, top edge slants from `(0, h/4)` to `(w, 0)`**

`packages/slides/src/view/canvas/shapes/flowchart/manual-input.ts`:

```ts
import type { PathBuilder } from '../builder';

/**
 * `flowChartManualInput` — quadrilateral with the top-left vertex
 * pulled down to `y = h/4`, giving a slanted top edge. Bottom is
 * a flat line.
 */
export const buildFlowChartManualInput: PathBuilder = ({ w, h }) => {
  const path = new Path2D();
  path.moveTo(0, h / 4);
  path.lineTo(w, 0);
  path.lineTo(w, h);
  path.lineTo(0, h);
  path.closePath();
  return path;
};
```

- [x] **Step 5.5: `flowChartManualOperation` — inverted trapezoid, bottom inset 12.5% per side**

`packages/slides/src/view/canvas/shapes/flowchart/manual-operation.ts`:

```ts
import type { PathBuilder } from '../builder';

/**
 * `flowChartManualOperation` — inverted trapezoid (top wider than
 * bottom). Bottom inset = `w * 0.125` per side, matching the
 * common OOXML preset proportion.
 */
export const buildFlowChartManualOperation: PathBuilder = ({ w, h }) => {
  const inset = w * 0.125;
  const path = new Path2D();
  path.moveTo(0, 0);
  path.lineTo(w, 0);
  path.lineTo(w - inset, h);
  path.lineTo(inset, h);
  path.closePath();
  return path;
};
```

- [x] **Step 5.6: `flowChartOffpageConnector` — rect with V-cut bottom (cut depth 20% of `h`)**

`packages/slides/src/view/canvas/shapes/flowchart/offpage-connector.ts`:

```ts
import type { PathBuilder } from '../builder';

/**
 * `flowChartOffpageConnector` — rect with the bottom edge replaced
 * by a downward V meeting at the bottom-centre. Cut depth = 20% of
 * frame height, matching the preset look-alike.
 */
export const buildFlowChartOffpageConnector: PathBuilder = ({ w, h }) => {
  const flatBottom = h * 0.8;
  const path = new Path2D();
  path.moveTo(0, 0);
  path.lineTo(w, 0);
  path.lineTo(w, flatBottom);
  path.lineTo(w / 2, h);
  path.lineTo(0, flatBottom);
  path.closePath();
  return path;
};
```

- [x] **Step 5.7: `flowChartPunchedCard` — rect with the top-left corner cut diagonally**

`packages/slides/src/view/canvas/shapes/flowchart/punched-card.ts`:

```ts
import type { PathBuilder } from '../builder';

/**
 * `flowChartPunchedCard` — rectangle with the top-left corner cut
 * along a diagonal of length `min(w, h) * 0.25`.
 */
export const buildFlowChartPunchedCard: PathBuilder = ({ w, h }) => {
  const cut = Math.min(w, h) * 0.25;
  const path = new Path2D();
  path.moveTo(cut, 0);
  path.lineTo(w, 0);
  path.lineTo(w, h);
  path.lineTo(0, h);
  path.lineTo(0, cut);
  path.closePath();
  return path;
};
```

### 5b. Test template for the simple 7

For each builder, add a `*.test.ts` with 3-5 `isPointInPath` assertions. Example for `terminator`:

```ts
// packages/slides/src/view/canvas/shapes/flowchart/terminator.test.ts
import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import { createTestCanvas } from '../../test-canvas-env';
import { buildFlowChartTerminator } from './terminator';

describe('buildFlowChartTerminator', () => {
  it('produces a pill that contains the centre and excludes outside the curve', () => {
    const path = buildFlowChartTerminator({ w: 100, h: 40 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 20)).toBe(true);
    expect(ctx.isPointInPath(path, 5, 20)).toBe(true);  // inside left rounded end
    expect(ctx.isPointInPath(path, 95, 20)).toBe(true);
    expect(ctx.isPointInPath(path, 1, 1)).toBe(false);  // outside left curve
    expect(ctx.isPointInPath(path, 99, 39)).toBe(false);
  });
});
```

Other builders' reference points (≥1 px clear of edges per P1 lessons):

| Shape | inside | outside |
|---|---|---|
| `predefinedProcess` | `(w/2, h/2)`, `(w/2, h*0.1)` | `(-1, h/2)`, `(w+1, h/2)` |
| `internalStorage`   | `(w/2, h/2)`, `(w*0.5, h*0.5)` | `(-1, -1)`, `(w+1, h+1)` |
| `manualInput`       | `(w/2, h/2)`, `(w*0.9, h*0.1)` | `(1, 1)` (top-left wedge — excluded) |
| `manualOperation`   | `(w/2, h/2)` | `(w*0.05, h-1)` (cut bottom-left), `(w*0.95, h-1)` |
| `offpageConnector`  | `(w/2, h/2)`, `(w/2, h*0.85)` | `(1, h-1)`, `(w-1, h-1)` (clipped V corners) |
| `punchedCard`       | `(w/2, h/2)`, `(w*0.9, 1)` | `(1, 1)` (cut corner) |

Each test file follows the terminator example structure: import shim + builder, call `createTestCanvas`, run 3-5 `isPointInPath` assertions.

- [x] **Step 5.8: Create all 7 builder files using §5a**

- [x] **Step 5.9: Create all 7 test files using §5b**

- [x] **Step 5.10: Register the 7 builders in `shapes/index.ts`**

Add imports:

```ts
import { buildFlowChartTerminator } from './flowchart/terminator';
import { buildFlowChartPredefinedProcess } from './flowchart/predefined-process';
import { buildFlowChartInternalStorage } from './flowchart/internal-storage';
import { buildFlowChartManualInput } from './flowchart/manual-input';
import { buildFlowChartManualOperation } from './flowchart/manual-operation';
import { buildFlowChartOffpageConnector } from './flowchart/offpage-connector';
import { buildFlowChartPunchedCard } from './flowchart/punched-card';
```

Add registry calls:

```ts
PATH_BUILDERS.set('flowChartTerminator', buildFlowChartTerminator);
PATH_BUILDERS.set('flowChartPredefinedProcess', buildFlowChartPredefinedProcess);
PATH_BUILDERS.set('flowChartInternalStorage', buildFlowChartInternalStorage);
PATH_BUILDERS.set('flowChartManualInput', buildFlowChartManualInput);
PATH_BUILDERS.set('flowChartManualOperation', buildFlowChartManualOperation);
PATH_BUILDERS.set('flowChartOffpageConnector', buildFlowChartOffpageConnector);
PATH_BUILDERS.set('flowChartPunchedCard', buildFlowChartPunchedCard);
```

(No `ADJUSTMENT_SPECS` entries — these 7 are non-parametric in P2.)

- [x] **Step 5.11: Run tests, regenerate registry snapshot**

```bash
pnpm --filter @wafflebase/slides test
pnpm --filter @wafflebase/slides test -- -u
```

Expected: ~21 new tests pass; snapshot regenerates with 7 new entries.

- [x] **Step 5.12: Commit**

```bash
git add packages/slides/src/view/canvas/shapes/flowchart/ \
        packages/slides/src/view/canvas/shapes/index.ts \
        packages/slides/src/view/canvas/shapes/__snapshots__/
git commit -m "Add 7 flowchart shapes (simple set)

Adds terminator, predefinedProcess, internalStorage, manualInput,
manualOperation, offpageConnector, punchedCard. All non-parametric
in P2; geometry follows OOXML look-alikes."
```

---

## Task 6: Flowchart complex (7 builders + tests + wave helper + registry)

**Files:**
- Create: `packages/slides/src/view/canvas/shapes/flowchart/wave.ts` (sine-wave subpath helper)
- Create: `packages/slides/src/view/canvas/shapes/flowchart/{document,multidocument,punched-tape,summing-junction,or,delay,display}.ts`
- Create: matching `*.test.ts`
- Modify: `packages/slides/src/view/canvas/shapes/index.ts`

These 7 use curves and shared sine-wave geometry (Document, Multidocument, PunchedTape).

### 6a. Steps

- [x] **Step 6.1: Create `flowchart/wave.ts` with `appendSineWave`**

`packages/slides/src/view/canvas/shapes/flowchart/wave.ts`:

```ts
/**
 * Append a one-period sine-wave polyline to `path`, traveling from
 * (startX, baseY) to (endX, baseY). The starting point is NOT
 * emitted (`moveTo` / `lineTo` is the caller's responsibility);
 * subsequent points are added via `lineTo`.
 *
 * The wave passes through baseY at both endpoints and at the
 * midpoint, peaks `+amplitude` at the quarter point, and dips
 * `-amplitude` at the three-quarter point. Pass a negative
 * `amplitude` to invert the wave direction.
 *
 * @param path         target Path2D (must already contain the start point)
 * @param startX, endX horizontal span; can be reversed (endX < startX) to draw right-to-left
 * @param baseY        wave centreline
 * @param amplitude    peak displacement (positive = first peak below baseY)
 * @param segments     polyline subdivision count (default 32 — sufficient for visual smoothness)
 */
export function appendSineWave(
  path: Path2D,
  startX: number,
  endX: number,
  baseY: number,
  amplitude: number,
  segments: number = 32,
): void {
  const span = endX - startX;
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const x = startX + span * t;
    const y = baseY + amplitude * Math.sin(2 * Math.PI * t);
    path.lineTo(x, y);
  }
}
```

This file must exist before the document / multidocument / punched-tape builders below — they import `appendSineWave`.

- [x] **Step 6.2: `flowChartDocument` — rect with sine-wavy bottom edge**

`packages/slides/src/view/canvas/shapes/flowchart/document.ts`:

```ts
import type { PathBuilder } from '../builder';
import { appendSineWave } from './wave';

/**
 * `flowChartDocument` — rectangle whose bottom edge is replaced by a
 * one-period sine wave. Wave centreline is at `y = h - amp`,
 * amplitude `amp = min(h/8, w/16)` to stay visually proportionate
 * at extreme aspect ratios. Re-used by `flowChartMultidocument`
 * via the exported `appendDocumentSubpath`.
 */
export function appendDocumentSubpath(
  path: Path2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const amp = Math.min(h / 8, w / 16);
  const baseY = y + h - amp;
  path.moveTo(x, y);
  path.lineTo(x + w, y);
  path.lineTo(x + w, baseY);
  appendSineWave(path, x + w, x, baseY, amp);
  path.lineTo(x, y);
  path.closePath();
}

export const buildFlowChartDocument: PathBuilder = ({ w, h }) => {
  const path = new Path2D();
  appendDocumentSubpath(path, 0, 0, w, h);
  return path;
};
```

- [x] **Step 6.3: `flowChartMultidocument` — three stacked documents**

`packages/slides/src/view/canvas/shapes/flowchart/multidocument.ts`:

```ts
import type { PathBuilder } from '../builder';
import { appendDocumentSubpath } from './document';

/**
 * `flowChartMultidocument` — three overlapping document silhouettes,
 * offset by `(w/16, h/16)` per layer, drawn back-to-front so the
 * stroke renders the top-right "shoulders" of the back layers and
 * the full silhouette of the front layer. Default fill rule
 * (nonzero) renders the union.
 */
export const buildFlowChartMultidocument: PathBuilder = ({ w, h }) => {
  const offX = w / 16;
  const offY = h / 16;
  const docW = w - 2 * offX;
  const docH = h - 2 * offY;
  const path = new Path2D();
  appendDocumentSubpath(path, 2 * offX, 0, docW, docH);
  appendDocumentSubpath(path, offX, offY, docW, docH);
  appendDocumentSubpath(path, 0, 2 * offY, docW, docH);
  return path;
};
```

- [x] **Step 6.4: `flowChartPunchedTape` — rect with sine-wavy top + bottom**

`packages/slides/src/view/canvas/shapes/flowchart/punched-tape.ts`:

```ts
import type { PathBuilder } from '../builder';
import { appendSineWave } from './wave';

/**
 * `flowChartPunchedTape` — rectangle with both top and bottom
 * edges replaced by one-period sine waves. Top wave centred at
 * `y = amp`, bottom at `y = h - amp`, amplitude `min(h/8, w/16)`.
 * Top travels left-to-right with `+amp`; bottom travels
 * right-to-left with `-amp` (so the visible curl matches GS).
 */
export const buildFlowChartPunchedTape: PathBuilder = ({ w, h }) => {
  const amp = Math.min(h / 8, w / 16);
  const topY = amp;
  const botY = h - amp;
  const path = new Path2D();
  path.moveTo(0, topY);
  appendSineWave(path, 0, w, topY, amp);
  path.lineTo(w, botY);
  appendSineWave(path, w, 0, botY, -amp);
  path.lineTo(0, topY);
  path.closePath();
  return path;
};
```

- [x] **Step 6.5: `flowChartSummingJunction` — full ellipse + diagonal X**

`packages/slides/src/view/canvas/shapes/flowchart/summing-junction.ts`:

```ts
import type { PathBuilder } from '../builder';

/**
 * `flowChartSummingJunction` — ellipse inscribed in the frame plus
 * a diagonal X spanning the inscribed-square diagonal endpoints.
 */
export const buildFlowChartSummingJunction: PathBuilder = ({ w, h }) => {
  const cx = w / 2;
  const cy = h / 2;
  const rx = w / 2;
  const ry = h / 2;
  const path = new Path2D();
  // Outer ellipse via parametric polyline (avoids Path2D.ellipse for
  // shim compatibility — see P1 lessons §"Test infrastructure")
  const segments = 64;
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const x = cx + rx * Math.cos(angle);
    const y = cy + ry * Math.sin(angle);
    if (i === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  }
  path.closePath();
  // X — endpoints at 45° around the ellipse
  const dx = rx * Math.SQRT1_2;
  const dy = ry * Math.SQRT1_2;
  path.moveTo(cx - dx, cy - dy);
  path.lineTo(cx + dx, cy + dy);
  path.moveTo(cx - dx, cy + dy);
  path.lineTo(cx + dx, cy - dy);
  return path;
};
```

- [x] **Step 6.6: `flowChartOr` — full ellipse + horizontal/vertical cross**

`packages/slides/src/view/canvas/shapes/flowchart/or.ts`:

```ts
import type { PathBuilder } from '../builder';

/**
 * `flowChartOr` — ellipse inscribed in the frame plus a horizontal
 * and vertical bar through the centre.
 */
export const buildFlowChartOr: PathBuilder = ({ w, h }) => {
  const cx = w / 2;
  const cy = h / 2;
  const rx = w / 2;
  const ry = h / 2;
  const path = new Path2D();
  const segments = 64;
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const x = cx + rx * Math.cos(angle);
    const y = cy + ry * Math.sin(angle);
    if (i === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  }
  path.closePath();
  path.moveTo(0, cy);
  path.lineTo(w, cy);
  path.moveTo(cx, 0);
  path.lineTo(cx, h);
  return path;
};
```

- [x] **Step 6.7: `flowChartDelay` — left rectangle joined to right semi-ellipse (D-shape)**

`packages/slides/src/view/canvas/shapes/flowchart/delay.ts`:

```ts
import type { PathBuilder } from '../builder';

/**
 * `flowChartDelay` — rectangle on the left joined to a right-side
 * semi-ellipse forming a "D". Semi-ellipse radius
 * `rx = min(h/2, w)`, vertical radius `h/2`. When the frame is
 * narrower than its height, the curve consumes the full width
 * gracefully.
 */
export const buildFlowChartDelay: PathBuilder = ({ w, h }) => {
  const rx = Math.min(h / 2, w);
  const ry = h / 2;
  const flatX = w - rx;
  const cy = h / 2;
  const path = new Path2D();
  path.moveTo(0, 0);
  path.lineTo(flatX, 0);
  // right semi-ellipse via parametric polyline (top to bottom)
  const segments = 32;
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const angle = -Math.PI / 2 + t * Math.PI; // -π/2 → +π/2
    const x = flatX + rx * Math.cos(angle);
    const y = cy + ry * Math.sin(angle);
    path.lineTo(x, y);
  }
  path.lineTo(0, h);
  path.closePath();
  return path;
};
```

- [x] **Step 6.8: `flowChartDisplay` — left wedge + flat top/bottom + right rounded edge**

`packages/slides/src/view/canvas/shapes/flowchart/display.ts`:

```ts
import type { PathBuilder } from '../builder';

/**
 * `flowChartDisplay` — flat top and bottom edges with a small
 * leftward-pointing wedge on the left and a right-side rounded
 * cap. Approximates the OOXML `flowChartDisplay` preset; the
 * Phase 4 formula evaluator is expected to override this builder.
 *
 * Geometry:
 *   - Left wedge tip at `(0, h/2)`
 *   - Flat top from `(w/6, 0)` to `(5w/6, 0)`
 *   - Right cap: semi-ellipse from `(5w/6, 0)` to `(5w/6, h)`
 *     with radii `(w/6, h/2)`
 *   - Flat bottom mirrors the top
 */
export const buildFlowChartDisplay: PathBuilder = ({ w, h }) => {
  const leftX = w / 6;
  const rightX = (5 * w) / 6;
  const capRx = w - rightX; // = w/6
  const capRy = h / 2;
  const cy = h / 2;
  const path = new Path2D();
  path.moveTo(0, cy);
  path.lineTo(leftX, 0);
  path.lineTo(rightX, 0);
  // right cap polyline (top to bottom)
  const segments = 32;
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const angle = -Math.PI / 2 + t * Math.PI;
    const x = rightX + capRx * Math.cos(angle);
    const y = cy + capRy * Math.sin(angle);
    path.lineTo(x, y);
  }
  path.lineTo(leftX, h);
  path.closePath();
  return path;
};
```

### 6c. Test reference points for the complex 7

Each test follows the simple-7 template (3-5 `isPointInPath` assertions).

| Shape | inside | outside |
|---|---|---|
| `document`         | `(w/2, h/2)`, `(w*0.9, h*0.1)` | `(-1, -1)`, `(1, h-1)` (likely outside wave low-point) |
| `multidocument`    | `(w/2, h/2)`, `(w*0.5, h*0.5)` | `(-1, -1)`, `(w+1, h+1)` |
| `punchedTape`      | `(w/2, h/2)`, `(w*0.5, h*0.5)` | `(1, 1)` (top wave dips up here), `(w-1, h-1)` |
| `summingJunction`  | `(w/2, h/2)` | `(1, 1)`, `(w-1, h-1)` (outside ellipse) |
| `or`               | `(w/2, h/2)`, `(w*0.5, h*0.4)` | `(1, 1)`, `(w-1, h-1)` |
| `delay`            | `(w/2, h/2)`, `(w*0.1, h*0.5)` | `(w-1, 1)` (cut by D curve), `(w-1, h-1)` |
| `display`          | `(w/2, h/2)` | `(0, 1)` (left wedge tip — outside above), `(w-1, 1)` (right cap) |

For each, write a Vitest `describe` / `it` block following the `terminator.test.ts` template.

- [x] **Step 6.9: Create all 7 sibling test files using §6c**

- [x] **Step 6.10: Register the 7 builders in `shapes/index.ts`**

Add imports:

```ts
import { buildFlowChartDocument } from './flowchart/document';
import { buildFlowChartMultidocument } from './flowchart/multidocument';
import { buildFlowChartPunchedTape } from './flowchart/punched-tape';
import { buildFlowChartSummingJunction } from './flowchart/summing-junction';
import { buildFlowChartOr } from './flowchart/or';
import { buildFlowChartDelay } from './flowchart/delay';
import { buildFlowChartDisplay } from './flowchart/display';
```

Add registry calls:

```ts
PATH_BUILDERS.set('flowChartDocument', buildFlowChartDocument);
PATH_BUILDERS.set('flowChartMultidocument', buildFlowChartMultidocument);
PATH_BUILDERS.set('flowChartPunchedTape', buildFlowChartPunchedTape);
PATH_BUILDERS.set('flowChartSummingJunction', buildFlowChartSummingJunction);
PATH_BUILDERS.set('flowChartOr', buildFlowChartOr);
PATH_BUILDERS.set('flowChartDelay', buildFlowChartDelay);
PATH_BUILDERS.set('flowChartDisplay', buildFlowChartDisplay);
```

- [x] **Step 6.11: Run tests, regenerate registry snapshot**

```bash
pnpm --filter @wafflebase/slides test
pnpm --filter @wafflebase/slides test -- -u
```

Expected: ~21 new tests pass; snapshot regenerates with 7 new entries (P2 catalog now complete: 55 kinds total, 35 P1 + 20 P2).

- [x] **Step 6.12: Sanity-check shim compatibility for parametric polyline curves**

The `summingJunction` / `or` / `delay` / `display` builders use 32-/64-segment polylines instead of `Path2D.ellipse` (per P1 lessons §"Test infrastructure" — the shim's curve approximations differ in edge semantics from real browsers, and polylines avoid that risk). Confirm tests pass without `-u` re-runs after the regen step.

- [x] **Step 6.13: Commit**

```bash
git add packages/slides/src/view/canvas/shapes/flowchart/ \
        packages/slides/src/view/canvas/shapes/index.ts \
        packages/slides/src/view/canvas/shapes/__snapshots__/
git commit -m "Add 7 flowchart shapes (complex set)

Adds document, multidocument, punchedTape (sine waves),
summingJunction, or (full ellipses), delay (D-shape),
display. Sine-wave helper extracted to flowchart/wave.ts;
document subpath helper exported for multidocument reuse."
```

---

## Task 7: Picker categories — Flowchart + Stars

**Files:**
- Modify: `packages/frontend/src/app/slides/shape-picker-helpers.ts`

The picker auto-renders any kind in `SHAPE_PICKER_CATEGORIES` that has a registered `PATH_BUILDERS` entry — no per-shape SVG asset needed.

- [x] **Step 7.1: Insert the Flowchart category between `arrows` and `callouts`**

In `packages/frontend/src/app/slides/shape-picker-helpers.ts`, find the existing `SHAPE_PICKER_CATEGORIES` constant. Between the `arrows` entry and the `callouts` entry, insert:

```ts
{
  id: 'flowchart',
  title: 'Flowchart',
  kinds: [
    { kind: 'flowChartTerminator',          label: 'Terminator' },
    { kind: 'flowChartPredefinedProcess',   label: 'Predefined process' },
    { kind: 'flowChartInternalStorage',     label: 'Internal storage' },
    { kind: 'flowChartDocument',            label: 'Document' },
    { kind: 'flowChartMultidocument',       label: 'Multi-document' },
    { kind: 'flowChartManualInput',         label: 'Manual input' },
    { kind: 'flowChartManualOperation',     label: 'Manual operation' },
    { kind: 'flowChartOffpageConnector',    label: 'Off-page connector' },
    { kind: 'flowChartPunchedCard',         label: 'Card' },
    { kind: 'flowChartPunchedTape',         label: 'Punched tape' },
    { kind: 'flowChartSummingJunction',     label: 'Summing junction' },
    { kind: 'flowChartOr',                  label: 'Or' },
    { kind: 'flowChartDelay',               label: 'Delay' },
    { kind: 'flowChartDisplay',             label: 'Display' },
  ],
},
```

- [x] **Step 7.2: Append the Stars category at the end (after `equation`)**

```ts
{
  id: 'stars',
  title: 'Stars',
  kinds: [
    { kind: 'star4',  label: '4-point star' },
    { kind: 'star5',  label: '5-point star' },
    { kind: 'star6',  label: '6-point star' },
    { kind: 'star7',  label: '7-point star' },
    { kind: 'star8',  label: '8-point star' },
    { kind: 'star10', label: '10-point star' },
  ],
},
```

- [x] **Step 7.3: Add `STYLE_BY_KIND` entries for the 20 new shapes**

`packages/slides/src/view/editor/interactions/insert.ts:28-52` declares `STYLE_BY_KIND: ReadonlyMap<ShapeKind, ShapeStyle>`. The dispatcher uses three styles: `'filled'` (accent1 fill, no stroke), `'outlined'` (background fill + text stroke, width 2), `'lineSpecial'` (used only by line/arrow). Per `slides-shapes-p2.md` §1, P2 categories map as:

| Category | Style |
|---|---|
| Stars (6) | `'filled'` (accent1 fill) |
| Flowchart (14) | `'outlined'` (background fill + text-coloured stroke) |

Extend the existing `'filled'` array to include the 6 stars:

```ts
  // Basic + Block Arrows + Equation + Stars → filled
  ...((
    [
      'rect', 'roundRect', 'ellipse', 'triangle', 'rtTriangle', 'diamond',
      'parallelogram', 'trapezoid', 'pentagon', 'hexagon', 'octagon',
      'plus', 'donut', 'can', 'cloud',
      'rightArrow', 'leftArrow', 'upArrow', 'downArrow',
      'leftRightArrow', 'quadArrow', 'chevron', 'pentagonArrow',
      'mathPlus', 'mathMinus', 'mathMultiply',
      'mathDivide', 'mathEqual', 'mathNotEqual',
      'star4', 'star5', 'star6', 'star7', 'star8', 'star10',
    ] as ShapeKind[]
  ).map((k) => [k, 'filled' as ShapeStyle] as const)),
```

After the existing four `'outlined'` callout entries, add the 14 flowchart entries:

```ts
  // Callouts → outlined
  ['wedgeRectCallout', 'outlined'],
  ['wedgeRoundRectCallout', 'outlined'],
  ['wedgeEllipseCallout', 'outlined'],
  ['cloudCallout', 'outlined'],
  // Flowchart → outlined
  ['flowChartTerminator', 'outlined'],
  ['flowChartPredefinedProcess', 'outlined'],
  ['flowChartInternalStorage', 'outlined'],
  ['flowChartDocument', 'outlined'],
  ['flowChartMultidocument', 'outlined'],
  ['flowChartManualInput', 'outlined'],
  ['flowChartManualOperation', 'outlined'],
  ['flowChartOffpageConnector', 'outlined'],
  ['flowChartPunchedCard', 'outlined'],
  ['flowChartPunchedTape', 'outlined'],
  ['flowChartSummingJunction', 'outlined'],
  ['flowChartOr', 'outlined'],
  ['flowChartDelay', 'outlined'],
  ['flowChartDisplay', 'outlined'],
```

Update `insert.test.ts` if it exhaustively asserts the count of `STYLE_BY_KIND` entries — the existing `'buildInsertElement — category defaults'` block adds new sub-cases per category.

- [x] **Step 7.4: Run picker invariant + frontend tests**

```bash
pnpm slides build
pnpm --filter @wafflebase/frontend test -- shape-picker
pnpm --filter @wafflebase/slides test
```

Expected: picker invariant test (`shape-picker.test.ts`) confirms every kind in `SHAPE_PICKER_CATEGORIES` has a registered `PATH_BUILDERS` builder + a non-empty label. 7 categories total.

- [x] **Step 7.5: Commit**

```bash
git add packages/frontend/src/app/slides/shape-picker-helpers.ts \
        packages/slides/src/view/editor/interactions/insert.ts
git commit -m "Expose Flowchart and Stars categories in shape picker

Picker order matches Google Slides: Lines · Shapes · Block Arrows ·
Flowchart · Callouts · Equation · Stars. Each new entry already has
a registered path-builder, so canvas-rendered icons appear without
per-shape asset work."
```

---

## Task 8: Visual harness — refresh catalog scenario + regenerate baselines

**Files:**
- Modify: `packages/frontend/src/app/harness/visual/slides-scenarios.tsx` — `makeCatalogDoc` builds the 35-shape grid in P1; expand it to 55.
- Update PNGs in `packages/frontend/tests/visual/baselines/` — regenerated by `pnpm verify:browser:docker:update`.

- [x] **Step 8.1: Inspect `makeCatalogDoc` and its scenario IDs**

```bash
grep -n "makeCatalogDoc\|catalog\|shape-catalog" packages/frontend/src/app/harness/visual/slides-scenarios.tsx
```

Note the scenario ID(s) that consume `makeCatalogDoc` (one ID per theme, per P1 lessons). The P2 grid expansion does not need to rename those IDs.

- [x] **Step 8.2: Expand the grid to 55 shapes**

Add the 20 new kinds (6 stars + 14 flowchart) to the catalog source array used by `makeCatalogDoc`. Keep the grid layout coherent — e.g. expand from 5×7 to 6×10 (60 cells with 5 blank), or 5×11 (55 cells, no blanks). Choose whichever keeps the scenario PNG visually compact.

If the scenario renders categories in their picker order, also update its iteration to match Lines · Shapes · Block Arrows · Flowchart · Callouts · Equation · Stars.

- [x] **Step 8.3: Regenerate baseline PNGs**

```bash
pnpm verify:browser:docker:update
```

Expected: existing baselines for the catalog scenario(s) under `packages/frontend/tests/visual/baselines/` are replaced; new baseline PNGs cover all 55 shapes.

- [x] **Step 8.4: Verify baselines match expectations visually**

Open the regenerated PNGs in `packages/frontend/tests/visual/baselines/` — typically one per (catalog scenario × theme).

Sanity-check:
- All 55 shapes visible, no placeholder rect (would indicate an unregistered builder)
- Stars apex-up
- Flowchart shapes recognisable (terminator pill, document with wavy bottom, etc.)

If the resulting PNG is excessively large or the diff threshold fails, **split into two scenarios** per `slides-shapes-p2.md` §5: `slides-shape-catalog-basics` (35 P1 kinds) and `slides-shape-catalog-p2` (20 P2 kinds). Re-run `pnpm verify:browser:docker:update`.

- [x] **Step 8.5: Verify the gate passes against the regenerated baseline**

```bash
pnpm verify:browser:docker
```

Expected: PASS — visual diff is zero for the regenerated baselines.

- [x] **Step 8.6: Commit**

```bash
git add packages/frontend/src/app/harness/visual/slides-scenarios.tsx \
        packages/frontend/tests/visual/baselines/
git commit -m "Refresh visual baselines for 55-shape catalog

Expands the slides shape-catalog scenario from 35 to 55 entries
(P1 + P2). Renders in the picker's category order so the baseline
diff stays meaningful when categories grow."
```

---

## Task 9: Pre-PR verify + tasks index + lessons capture

**Files:**
- Modify: `docs/tasks/active/README.md`
- Modify: `docs/tasks/active/20260509-slides-shapes-p2-lessons.md` (created in step 9.3)

- [x] **Step 9.1: Run the full local verify lane**

```bash
pnpm sheets build
pnpm --filter @wafflebase/docs build
pnpm slides build
pnpm verify:fast
pnpm verify:self
```

Expected: all green. Per P1 lessons, `verify:fast` requires the workspace builds first in a fresh shell.

- [x] **Step 9.2: Update the active-tasks index (if it lists individual tasks)**

```bash
grep -n "shapes-p1\|shapes" docs/tasks/active/README.md
```

If the README enumerates per-task entries, add a sibling row pointing to `20260509-slides-shapes-p2-todo.md` and `-lessons.md`. If it's just a directory description, leave as-is.

- [x] **Step 9.3: Populate the lessons file**

Replace the placeholder content in `docs/tasks/active/20260509-slides-shapes-p2-lessons.md` (created by step 9.4 below) with at least:
- Build / workflow surprises encountered
- Any star inner-radius default that needed correction during T4 visual sanity check
- Any flowchart geometry that needed approximation tweaks (e.g. `flowChartDisplay`)
- Whether the catalog scenario stayed as one PNG or split into two
- Anything to watch for in P3 (drag-handle UX / +50 GS-parity shapes)

If no surprises, write a short "no surprises; pattern from P1 carried forward unchanged" entry — completed lessons file is the workflow expectation.

- [x] **Step 9.4: Commit lessons + any tasks-index update**

```bash
git add docs/tasks/active/20260509-slides-shapes-p2-lessons.md \
        docs/tasks/active/README.md  # if modified
git commit -m "Capture P2 lessons and update active task index

Records workflow notes (build prerequisite for verify:fast,
shim quirks if any encountered, default-value corrections) and
queues hand-off context for P3."
```

---

## Task 10: Open the PR

- [x] **Step 10.1: Sync with `main`**

```bash
git fetch origin
git rebase origin/main
```

Resolve any conflicts (none expected — P2 is additive against main).

- [x] **Step 10.2: Push the branch**

```bash
git push -u origin slides-shapes-p2
```

- [x] **Step 10.3: Open the PR**

```bash
gh pr create --title "Add 20 P2 shapes: 14 flowchart + 6 stars (slides Phase 2)" \
  --body "$(cat <<'EOF'
## Summary
- Adds 20 new OOXML-aligned shape builders (6 stars + 14 flowchart), bringing the slides catalog to 55 kinds.
- Adds `regularPolygonPath` helper to `shapes/builder.ts`; refactors the existing `pentagon` builder onto it.
- Adds Flowchart and Stars categories to the shape picker in Google-Slides order.
- No adjustments-editing UI in P2 — deferred to P3 alongside drag handles per `docs/design/slides/slides-shapes-p2.md`.

## Test plan
- [x] `pnpm verify:fast` green
- [x] `pnpm verify:self` green
- [x] Regenerated visual baselines for the 55-shape catalog scenario (`pnpm verify:browser:docker` green)
- [x] Manual smoke: `pnpm dev`, open the slides editor, click `Shape ▾`, confirm 7 categories appear in order Lines · Shapes · Block Arrows · Flowchart · Callouts · Equation · Stars; insert one shape from each new category and verify it renders
- [x] Spec doc cross-check: `docs/design/slides/slides-shapes-p2.md` describes everything in this PR; P1 doc's roadmap table is updated to reflect the deferred adjustments UI

## Spec
- New: `docs/design/slides/slides-shapes-p2.md`
- Updated: `docs/design/slides/slides-shapes-p1.md` (roadmap row)
- Updated: `docs/design/README.md` (slides index)
EOF
)"
```

- [x] **Step 10.4: Self-review the PR**

Dispatch `superpowers:requesting-code-review` over the full branch diff. Apply blocking findings; note non-blocking items in the PR thread.

---

## Sibling lessons file — initialise as a stub

The lessons file is required by the task workflow (`pnpm tasks:archive` expects `<slug>-lessons.md` to exist). Create it now as an empty stub; T9 fills it in.

- [x] **Step Final: Create stub lessons file (one-off, before T1)**

Create `docs/tasks/active/20260509-slides-shapes-p2-lessons.md`:

```markdown
# Slides Shape Library Phase 2 — Lessons

**Created**: 2026-05-09

(To be filled in during T9; placeholder so the task workflow
expects both files from the start of the branch.)
```

Commit alongside T1 (or as the very first commit on the branch — order doesn't matter for the file workflow).

---

## Spec coverage check (run after writing all tasks)

| Spec section | Implementing task |
|---|---|
| §1 Catalog — stars 6 | T4 |
| §1 Catalog — flowchart 14 | T5 (simple 7), T6 (complex 7) |
| §1 Default fill / stroke | T7 step 7.3 |
| §2 Renderer — `regularPolygonPath` | T2 |
| §2 Renderer — pentagon refactor | T3 |
| §2 Renderer — directory layout | T4–T6 (as files are created) |
| §2 Renderer — wave drawing | T6 step 6.1 (`flowchart/wave.ts`) |
| §3 Picker — section ordering | T7 |
| §3 Picker — implementation | T7 |
| §3 Picker — `InsertKind` defaults | T7 step 7.3 |
| §4 Yorkie schema | T1 (auto-extends; no parallel edit) |
| §5 Test strategy — builder unit tests | T2 step 2.1, T4–T6 |
| §5 Test strategy — `regularPolygonPath` test | T2 |
| §5 Test strategy — registry snapshot | T4 step 4.4 / T5 step 5.11 / T6 step 6.12 |
| §5 Test strategy — picker UI test | T7 step 7.4 |
| §5 Test strategy — visual harness baselines | T8 |
| §6 Migration — no Yorkie migration | T1 commit message documents this |
| Risks — star icon legibility | T4 step 4.5, T8 step 8.4 |
| Risks — punchedTape extreme aspect | T6 step 6.3 (amplitude clamp) |
| Risks — pentagon refactor regression | T3 step 3.2 (existing test still green) |
| Risks — visual catalog PNG size | T8 step 8.4 (split fallback) |
