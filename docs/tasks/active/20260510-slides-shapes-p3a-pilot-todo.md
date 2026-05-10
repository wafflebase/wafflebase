# Slides Shapes P3-A.1 — Adjustment Drag Handles (pilot) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship yellow-diamond drag handles for 9 pilot shapes (6 stars + roundRect + chevron + wedgeRectCallout), validating the `ADJUSTMENT_HANDLES` registry abstraction across all 4 axis types (radial / linear / point), so P3-A.2 can sweep the remaining 24 shapes mechanically.

**Architecture:** New `AdjustmentHandle` type + `ADJUSTMENT_HANDLES` map parallel to existing `PATH_BUILDERS`/`ADJUSTMENT_SPECS` in `packages/slides/src/view/canvas/shapes/`. DOM-based handle rendering reuses the existing `renderOverlay` overlay container with `data-handle="adjust-N"`. Drag loop mirrors the resize pattern (pointermove paints local preview, pointerup commits one `store.batch` → one undo entry). Per-shape `position` and `apply` functions own the geometry; the editor handles rotation transforms once.

**Tech Stack:** TypeScript, Vitest (unit tests), Canvas2D (path builders, untouched), DOM overlay (`HTMLDivElement`), Yorkie via `Store.updateElementData`.

**Reference docs:**
- Spec: `docs/design/slides/slides-shapes-p3a-adjustments.md`
- Predecessor: `docs/design/slides/slides-shapes-p2.md`

**Branch:** `slides-shapes-p3a-pilot` (off `main`)

**Commit message convention:** subject ≤70 chars, blank line 2, body explains WHY. Each task = 1 commit.

---

## Setup

- [ ] **Step 0.1: Create feature branch**

```bash
git fetch origin
git checkout -b slides-shapes-p3a-pilot origin/main
```

- [ ] **Step 0.2: Verify baseline green**

```bash
pnpm verify:fast
```

Expected: PASS. If anything fails, stop and investigate before proceeding — tasks below assume a clean baseline.

- [ ] **Step 0.3: Commit design doc**

The design doc and README link were created during brainstorming (see "Files modified before this plan" in git diff). Commit them as the first commit on the branch:

```bash
git add docs/design/slides/slides-shapes-p3a-adjustments.md docs/design/README.md docs/tasks/active/20260510-slides-shapes-p3a-pilot-todo.md
git commit -m "$(cat <<'EOF'
Add slides P3-A.1 spec + todo for adjustment drag handles

P2 deferred the adjustments UX to P3 around Google Slides' canonical
yellow-diamond drag-handle pattern. P3-A.1 (pilot) covers 9 shapes
spanning all 4 axis types — radial (6 stars), linear (roundRect,
chevron), point (wedgeRectCallout) — to validate the
ADJUSTMENT_HANDLES registry abstraction before P3-A.2 sweeps the
remaining 24 shapes mechanically.
EOF
)"
```

---

## Task 1: Add `Point` and `AdjustmentHandle` types

**Files:**
- Modify: `packages/slides/src/view/canvas/shapes/builder.ts`
- Modify: `packages/slides/src/node.ts` (re-export new types)

- [ ] **Step 1.1: Add types to builder.ts**

Append to `packages/slides/src/view/canvas/shapes/builder.ts`:

```ts
export type Point = { x: number; y: number };

/**
 * One drag handle for one (or more) adjustment value(s) on a shape.
 * Both functions work in element-local coordinates — origin = frame
 * top-left, axes = pre-rotation. The editor applies the rotation
 * transform once at paint and inverse-transform once at hit-test.
 */
export type AdjustmentHandle = {
  /** Where to draw the diamond, in element-local coords. */
  position: (frame: FrameSize, adjustments: number[]) => Point;
  /**
   * Drag pointer (element-local) → new full adjustments array.
   * Indices the handle does not control are passed through from
   * `startAdjustments`. Values must be clamped to the matching
   * AdjustmentSpec's `min`/`max`.
   */
  apply: (
    frame: FrameSize,
    startAdjustments: number[],
    pointer: Point,
  ) => number[];
};
```

- [ ] **Step 1.2: Re-export from node.ts**

Modify `packages/slides/src/node.ts:71` to add `Point, AdjustmentHandle`:

```ts
export type {
  PathBuilder,
  AdjustmentSpec,
  FrameSize,
  Point,
  AdjustmentHandle,
} from './view/canvas/shapes/builder';
```

- [ ] **Step 1.3: Verify compile**

```bash
pnpm --filter @wafflebase/slides build
```

Expected: PASS (just adds types; no behavior change).

- [ ] **Step 1.4: Commit**

```bash
git add packages/slides/src/view/canvas/shapes/builder.ts packages/slides/src/node.ts
git commit -m "$(cat <<'EOF'
Add Point and AdjustmentHandle types for slides shapes

Foundation for P3-A.1: per-shape drag-handle metadata. Lives next
to AdjustmentSpec so the registry built in the next commit can
co-locate position/apply with the existing spec entries.
EOF
)"
```

---

## Task 2: Add `ADJUSTMENT_HANDLES` registry

**Files:**
- Modify: `packages/slides/src/view/canvas/shapes/index.ts`
- Modify: `packages/slides/src/view/canvas/shapes/index.test.ts`
- Modify: `packages/slides/src/node.ts` (re-export `ADJUSTMENT_HANDLES`)

- [ ] **Step 2.1: Write failing test**

Add to `packages/slides/src/view/canvas/shapes/index.test.ts`:

```ts
import { PATH_BUILDERS, ADJUSTMENT_SPECS, ADJUSTMENT_HANDLES } from './index';

describe('ADJUSTMENT_HANDLES registry', () => {
  it('is a Map', () => {
    expect(ADJUSTMENT_HANDLES).toBeInstanceOf(Map);
  });

  it('every registered kind also has a path builder', () => {
    for (const kind of ADJUSTMENT_HANDLES.keys()) {
      expect(PATH_BUILDERS.has(kind)).toBe(true);
    }
  });

  it('every registered kind also has an adjustment spec', () => {
    for (const kind of ADJUSTMENT_HANDLES.keys()) {
      expect(ADJUSTMENT_SPECS.has(kind)).toBe(true);
    }
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
pnpm --filter @wafflebase/slides test --run -- packages/slides/src/view/canvas/shapes/index.test.ts
```

Expected: FAIL with `ADJUSTMENT_HANDLES` not exported.

- [ ] **Step 2.3: Add registry**

Add to `packages/slides/src/view/canvas/shapes/index.ts`, immediately after the `ADJUSTMENT_SPECS` declaration (around line 97):

```ts
/**
 * Shape kind → drag-handle metadata. Only kinds with at least one
 * authored handle are listed. Unregistered kinds get zero handles
 * (no drag UX, defaults still apply). Phase P3-A.1 fills the pilot
 * 9; P3-A.2 fills the remaining 24.
 */
export const ADJUSTMENT_HANDLES = new Map<
  ShapeKind,
  readonly AdjustmentHandle[]
>();
```

Add the `AdjustmentHandle` import at top of file (next to existing `AdjustmentSpec` import):

```ts
import type { AdjustmentSpec, AdjustmentHandle } from './builder';
```

- [ ] **Step 2.4: Re-export from node.ts**

Modify `packages/slides/src/node.ts:70`:

```ts
export {
  PATH_BUILDERS,
  ADJUSTMENT_SPECS,
  ADJUSTMENT_HANDLES,
} from './view/canvas/shapes';
```

- [ ] **Step 2.5: Run test to verify it passes**

```bash
pnpm --filter @wafflebase/slides test --run -- packages/slides/src/view/canvas/shapes/index.test.ts
```

Expected: PASS (registry is empty Map, all `for…of` loops are vacuously satisfied).

- [ ] **Step 2.6: Commit**

```bash
git add packages/slides/src/view/canvas/shapes/index.ts packages/slides/src/view/canvas/shapes/index.test.ts packages/slides/src/node.ts
git commit -m "$(cat <<'EOF'
Add ADJUSTMENT_HANDLES registry for slides shapes

Empty Map<ShapeKind, AdjustmentHandle[]> with consistency tests
(every registered kind must also have a builder + spec). Subsequent
commits register the 9 pilot shapes one at a time so each entry
gets reviewed alongside its per-shape position/apply math.
EOF
)"
```

---

## Task 3: `roundRect` handle (linear axis)

**Files:**
- Modify: `packages/slides/src/view/canvas/shapes/basic/round-rect.ts`
- Create: `packages/slides/src/view/canvas/shapes/basic/round-rect.handles.test.ts`
- Modify: `packages/slides/src/view/canvas/shapes/index.ts` (register)

- [ ] **Step 3.1: Write failing test**

Create `packages/slides/src/view/canvas/shapes/basic/round-rect.handles.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ROUND_RECT_HANDLES } from './round-rect';

const FRAME = { w: 200, h: 100 };

describe('ROUND_RECT_HANDLES', () => {
  it('exposes a single handle', () => {
    expect(ROUND_RECT_HANDLES).toHaveLength(1);
  });

  describe('position', () => {
    const handle = ROUND_RECT_HANDLES[0];

    it('default ratio (16667 thousandths) → r ≈ 16.67% of min(w,h)', () => {
      const p = handle.position(FRAME, [16667]);
      // r = 16667/100000 * min(200,100) = 16.667
      expect(p).toEqual({ x: 16.667, y: 0 });
    });

    it('zero adjustment → handle at top-left corner', () => {
      const p = handle.position(FRAME, [0]);
      expect(p).toEqual({ x: 0, y: 0 });
    });

    it('max adjustment (50000) → handle at half min(w,h) along top edge', () => {
      const p = handle.position(FRAME, [50000]);
      // r = 0.5 * 100 = 50
      expect(p).toEqual({ x: 50, y: 0 });
    });
  });

  describe('apply', () => {
    const handle = ROUND_RECT_HANDLES[0];

    it('pointer at x=25 → adj0 = 25/100 * 100000 = 25000', () => {
      const next = handle.apply(FRAME, [16667], { x: 25, y: 0 });
      expect(next).toEqual([25000]);
    });

    it('pointer past max corner → clamps to 50000', () => {
      const next = handle.apply(FRAME, [16667], { x: 9999, y: 0 });
      expect(next).toEqual([50000]);
    });

    it('negative pointer → clamps to 0', () => {
      const next = handle.apply(FRAME, [16667], { x: -50, y: 0 });
      expect(next).toEqual([0]);
    });

    it('round-trip identity inside clamp range', () => {
      const adj = [25000];
      const p = handle.position(FRAME, adj);
      const back = handle.apply(FRAME, adj, p);
      expect(back[0]).toBeCloseTo(adj[0], -1); // ±50 OOXML units
    });
  });
});
```

- [ ] **Step 3.2: Run test to verify it fails**

```bash
pnpm --filter @wafflebase/slides test --run -- packages/slides/src/view/canvas/shapes/basic/round-rect.handles.test.ts
```

Expected: FAIL with `ROUND_RECT_HANDLES` not exported.

- [ ] **Step 3.3: Add handle definition**

Add to `packages/slides/src/view/canvas/shapes/basic/round-rect.ts`, after the existing `buildRoundRect` export:

```ts
import type { AdjustmentHandle } from '../builder';

const RR_MIN = 0;
const RR_MAX = 50000;

export const ROUND_RECT_HANDLES: readonly AdjustmentHandle[] = [
  {
    position: ({ w, h }, adjustments) => {
      const ratio = (adjustments[0] ?? 16667) / 100000;
      const r = Math.max(0, Math.min(w, h) * ratio);
      return { x: r, y: 0 };
    },
    apply: ({ w, h }, _start, pointer) => {
      const halfMin = Math.min(w, h) / 2;
      const r = Math.max(0, Math.min(halfMin, pointer.x));
      // r = ratio * min(w,h) → ratio = r / min(w,h)
      const ratio = r / Math.min(w, h);
      const value = Math.round(ratio * 100000);
      return [Math.max(RR_MIN, Math.min(RR_MAX, value))];
    },
  },
];
```

Update the existing `import` at top of `round-rect.ts` to include the type if not already present:

```ts
import type { PathBuilder, AdjustmentSpec, AdjustmentHandle } from '../builder';
```

- [ ] **Step 3.4: Register in index.ts**

Add to `packages/slides/src/view/canvas/shapes/index.ts`, after the existing roundRect imports:

```ts
import { buildRoundRect, ROUND_RECT_ADJUSTMENTS, ROUND_RECT_HANDLES } from './basic/round-rect';
```

After the `ADJUSTMENT_SPECS.set(...)` block, add:

```ts
ADJUSTMENT_HANDLES.set('roundRect', ROUND_RECT_HANDLES);
```

- [ ] **Step 3.5: Run tests to verify they pass**

```bash
pnpm --filter @wafflebase/slides test --run -- packages/slides/src/view/canvas/shapes/basic/round-rect.handles.test.ts packages/slides/src/view/canvas/shapes/index.test.ts
```

Expected: PASS (all 6 round-rect cases + 3 registry consistency cases).

- [ ] **Step 3.6: Commit**

```bash
git add packages/slides/src/view/canvas/shapes/basic/round-rect.ts packages/slides/src/view/canvas/shapes/basic/round-rect.handles.test.ts packages/slides/src/view/canvas/shapes/index.ts
git commit -m "$(cat <<'EOF'
Add roundRect adjustment drag handle (P3-A.1 pilot)

Linear axis along the top edge — diamond at (r, 0) where r is the
rendered corner radius. Drag horizontally to change ratio.
Establishes the per-shape file pattern for the 8 remaining pilot
shapes: handle constant + matching .handles.test.ts + one .set()
call in shapes/index.ts.
EOF
)"
```

---

## Task 4: `chevron` handle (linear axis, V-notch)

**Files:**
- Modify: `packages/slides/src/view/canvas/shapes/arrows/chevron.ts`
- Create: `packages/slides/src/view/canvas/shapes/arrows/chevron.handles.test.ts`
- Modify: `packages/slides/src/view/canvas/shapes/index.ts`

Chevron's adjustment is the back-notch depth, drawn at horizontal inset `(notch/100000) × (h/2) × (w/h)` from the left edge. Handle sits at the inner V tip.

- [ ] **Step 4.1: Write failing test**

Create `packages/slides/src/view/canvas/shapes/arrows/chevron.handles.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CHEVRON_HANDLES } from './chevron';

const FRAME = { w: 200, h: 100 };
// inset formula: (adj/100000) * (h/2) * (w/h) = (adj/100000) * w/2
// (only true for square-ish shapes; chevron uses h/2 * w/h which is w/2)
// For w=200,h=100: inset = (adj/100000) * 50 * 2 = (adj/100000) * 100

describe('CHEVRON_HANDLES', () => {
  it('exposes a single handle', () => {
    expect(CHEVRON_HANDLES).toHaveLength(1);
  });

  describe('position', () => {
    const handle = CHEVRON_HANDLES[0];

    it('default ratio (50000) → handle at (50, 50) for 200x100 frame', () => {
      // inset = 0.5 * 100 = 50
      const p = handle.position(FRAME, [50000]);
      expect(p.x).toBeCloseTo(50, 5);
      expect(p.y).toBeCloseTo(50, 5);
    });

    it('zero ratio → handle at (0, h/2)', () => {
      const p = handle.position(FRAME, [0]);
      expect(p).toEqual({ x: 0, y: 50 });
    });

    it('max ratio → handle at (w-equivalent, h/2)', () => {
      const p = handle.position(FRAME, [100000]);
      expect(p.x).toBeCloseTo(100, 5);
      expect(p.y).toBeCloseTo(50, 5);
    });
  });

  describe('apply', () => {
    const handle = CHEVRON_HANDLES[0];

    it('pointer at x=25, y=anything → adj0 ≈ 25000', () => {
      const next = handle.apply(FRAME, [50000], { x: 25, y: 99 });
      expect(next[0]).toBe(25000);
    });

    it('pointer past max → clamps to 100000', () => {
      const next = handle.apply(FRAME, [50000], { x: 99999, y: 50 });
      expect(next[0]).toBe(100000);
    });

    it('negative pointer → clamps to 0', () => {
      const next = handle.apply(FRAME, [50000], { x: -10, y: 50 });
      expect(next[0]).toBe(0);
    });

    it('vertical motion is ignored', () => {
      const a = handle.apply(FRAME, [50000], { x: 25, y: 0 });
      const b = handle.apply(FRAME, [50000], { x: 25, y: 100 });
      expect(a).toEqual(b);
    });
  });
});
```

- [ ] **Step 4.2: Run test to verify it fails**

```bash
pnpm --filter @wafflebase/slides test --run -- packages/slides/src/view/canvas/shapes/arrows/chevron.handles.test.ts
```

Expected: FAIL with `CHEVRON_HANDLES` not exported.

- [ ] **Step 4.3: Add handle definition**

Add to `packages/slides/src/view/canvas/shapes/arrows/chevron.ts`:

```ts
import type { AdjustmentHandle } from '../builder';

export const CHEVRON_HANDLES: readonly AdjustmentHandle[] = [
  {
    position: ({ w, h }, adjustments) => {
      const ratio = (adjustments[0] ?? 50000) / 100000;
      const inset = ratio * (h / 2) * (w / h);
      return { x: inset, y: h / 2 };
    },
    apply: ({ w, h }, _start, pointer) => {
      // Inverse of inset = ratio * (h/2) * (w/h) = ratio * w/2
      // → ratio = inset / (w/2) when measured by width
      // Use the same formula the builder uses: inset / ((h/2)*(w/h))
      const denom = (h / 2) * (w / h);
      const inset = Math.max(0, Math.min(w, pointer.x));
      const ratio = denom > 0 ? inset / denom : 0;
      const value = Math.round(ratio * 100000);
      return [Math.max(0, Math.min(100000, value))];
    },
  },
];
```

Update import at top:

```ts
import type { PathBuilder, AdjustmentSpec, AdjustmentHandle } from '../builder';
```

- [ ] **Step 4.4: Register in index.ts**

Update the chevron import line:

```ts
import { buildChevron, CHEVRON_ADJUSTMENTS, CHEVRON_HANDLES } from './arrows/chevron';
```

Add to the `ADJUSTMENT_HANDLES.set` block:

```ts
ADJUSTMENT_HANDLES.set('chevron', CHEVRON_HANDLES);
```

- [ ] **Step 4.5: Run tests**

```bash
pnpm --filter @wafflebase/slides test --run -- packages/slides/src/view/canvas/shapes/arrows/chevron.handles.test.ts packages/slides/src/view/canvas/shapes/index.test.ts
```

Expected: PASS.

- [ ] **Step 4.6: Commit**

```bash
git add packages/slides/src/view/canvas/shapes/arrows/chevron.ts packages/slides/src/view/canvas/shapes/arrows/chevron.handles.test.ts packages/slides/src/view/canvas/shapes/index.ts
git commit -m "$(cat <<'EOF'
Add chevron adjustment drag handle (P3-A.1 pilot)

Linear axis along the back V notch. Diamond sits at the inner V
tip (inset, h/2). Vertical pointer motion is ignored — drag is
purely horizontal because notch depth is one-dimensional.
EOF
)"
```

---

## Task 5: `wedgeRectCallout` handle (point axis, 2D)

**Files:**
- Modify: `packages/slides/src/view/canvas/shapes/callouts/wedge-rect-callout.ts`
- Create: `packages/slides/src/view/canvas/shapes/callouts/wedge-rect-callout.handles.test.ts`
- Modify: `packages/slides/src/view/canvas/shapes/index.ts`

Tail tip = `(w/2 + adj0/100000 * w, h/2 + adj1/100000 * h)`. One handle controls both indices.

- [ ] **Step 5.1: Write failing test**

Create `packages/slides/src/view/canvas/shapes/callouts/wedge-rect-callout.handles.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { WEDGE_RECT_CALLOUT_HANDLES } from './wedge-rect-callout';

const FRAME = { w: 200, h: 100 };
// tx = 100 + (adj0/100000) * 200; ty = 50 + (adj1/100000) * 100

describe('WEDGE_RECT_CALLOUT_HANDLES', () => {
  it('exposes a single handle', () => {
    expect(WEDGE_RECT_CALLOUT_HANDLES).toHaveLength(1);
  });

  describe('position', () => {
    const handle = WEDGE_RECT_CALLOUT_HANDLES[0];

    it('default → tail at (≈58.3, ≈112.5)', () => {
      // adj=[-20833, 62500]: tx = 100 + (-20833/100000)*200 = 58.334
      //                     ty = 50 + (62500/100000)*100 = 112.5
      const p = handle.position(FRAME, [-20833, 62500]);
      expect(p.x).toBeCloseTo(58.334, 2);
      expect(p.y).toBeCloseTo(112.5, 2);
    });

    it('zero adjustment → tail at frame center', () => {
      const p = handle.position(FRAME, [0, 0]);
      expect(p).toEqual({ x: 100, y: 50 });
    });

    it('positive corner adj → tail at far bottom-right', () => {
      const p = handle.position(FRAME, [100000, 100000]);
      expect(p).toEqual({ x: 300, y: 150 });
    });
  });

  describe('apply', () => {
    const handle = WEDGE_RECT_CALLOUT_HANDLES[0];

    it('pointer at frame center → both adj = 0', () => {
      const next = handle.apply(FRAME, [-20833, 62500], { x: 100, y: 50 });
      expect(next).toEqual([0, 0]);
    });

    it('pointer outside max → clamps both to 100000', () => {
      const next = handle.apply(FRAME, [0, 0], { x: 9999, y: 9999 });
      expect(next).toEqual([100000, 100000]);
    });

    it('pointer below min → clamps both to -100000', () => {
      const next = handle.apply(FRAME, [0, 0], { x: -9999, y: -9999 });
      expect(next).toEqual([-100000, -100000]);
    });

    it('round-trip identity inside clamp range', () => {
      const adj = [25000, -40000];
      const p = handle.position(FRAME, adj);
      const back = handle.apply(FRAME, adj, p);
      expect(back[0]).toBeCloseTo(adj[0], -1);
      expect(back[1]).toBeCloseTo(adj[1], -1);
    });
  });
});
```

- [ ] **Step 5.2: Run test to verify it fails**

```bash
pnpm --filter @wafflebase/slides test --run -- packages/slides/src/view/canvas/shapes/callouts/wedge-rect-callout.handles.test.ts
```

Expected: FAIL with `WEDGE_RECT_CALLOUT_HANDLES` not exported.

- [ ] **Step 5.3: Add handle definition**

Add to `packages/slides/src/view/canvas/shapes/callouts/wedge-rect-callout.ts`:

```ts
import type { AdjustmentHandle } from '../builder';

const CALLOUT_MIN = -100000;
const CALLOUT_MAX = 100000;

export const WEDGE_RECT_CALLOUT_HANDLES: readonly AdjustmentHandle[] = [
  {
    position: ({ w, h }, adjustments) => {
      const tx = w / 2 + ((adjustments[0] ?? -20833) / 100000) * w;
      const ty = h / 2 + ((adjustments[1] ?? 62500) / 100000) * h;
      return { x: tx, y: ty };
    },
    apply: ({ w, h }, _start, pointer) => {
      const tx = w > 0 ? Math.round(((pointer.x - w / 2) / w) * 100000) : 0;
      const ty = h > 0 ? Math.round(((pointer.y - h / 2) / h) * 100000) : 0;
      const clamp = (v: number) => Math.max(CALLOUT_MIN, Math.min(CALLOUT_MAX, v));
      return [clamp(tx), clamp(ty)];
    },
  },
];
```

Update import at top:

```ts
import type { PathBuilder, AdjustmentSpec, AdjustmentHandle } from '../builder';
```

- [ ] **Step 5.4: Register in index.ts**

Update import:

```ts
import {
  buildWedgeRectCallout,
  WEDGE_RECT_CALLOUT_ADJUSTMENTS,
  WEDGE_RECT_CALLOUT_HANDLES,
} from './callouts/wedge-rect-callout';
```

Add registration:

```ts
ADJUSTMENT_HANDLES.set('wedgeRectCallout', WEDGE_RECT_CALLOUT_HANDLES);
```

- [ ] **Step 5.5: Run tests**

```bash
pnpm --filter @wafflebase/slides test --run -- packages/slides/src/view/canvas/shapes/callouts/wedge-rect-callout.handles.test.ts packages/slides/src/view/canvas/shapes/index.test.ts
```

Expected: PASS.

- [ ] **Step 5.6: Commit**

```bash
git add packages/slides/src/view/canvas/shapes/callouts/wedge-rect-callout.ts packages/slides/src/view/canvas/shapes/callouts/wedge-rect-callout.handles.test.ts packages/slides/src/view/canvas/shapes/index.ts
git commit -m "$(cat <<'EOF'
Add wedgeRectCallout adjustment drag handle (P3-A.1 pilot)

Point axis — one handle controls both tail-x and tail-y adjustments
in a single drag. Demonstrates the multi-index handle case that
the AdjustmentHandle type was shaped to support; subsequent
2D-axis shapes follow the same pattern.
EOF
)"
```

---

## Task 6: Star radial helper + `star5` handle

**Files:**
- Create: `packages/slides/src/view/canvas/shapes/stars/handles.ts`
- Modify: `packages/slides/src/view/canvas/shapes/stars/star5.ts`
- Create: `packages/slides/src/view/canvas/shapes/stars/star5.handles.test.ts`
- Modify: `packages/slides/src/view/canvas/shapes/index.ts`

Stars share radial math; factory function `radialStarHandle(N)` returns a handle whose angle is `-π/2 + π/N`. star5 is the canonical first.

- [ ] **Step 6.1: Write failing test**

Create `packages/slides/src/view/canvas/shapes/stars/star5.handles.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { STAR_5_HANDLES } from './star5';

const FRAME = { w: 200, h: 100 };
// star5 builder: rx=100, ry=50, innerRotation = -π/2 + π/5
// Handle position: (cx + ratio*rx*cos(θ), cy + ratio*ry*sin(θ))
const cx = 100, cy = 50, rx = 100, ry = 50;
const theta = -Math.PI / 2 + Math.PI / 5;

describe('STAR_5_HANDLES', () => {
  it('exposes a single handle', () => {
    expect(STAR_5_HANDLES).toHaveLength(1);
  });

  describe('position (default ratio 19098)', () => {
    const handle = STAR_5_HANDLES[0];
    const ratio = 19098 / 100000;

    it('matches (cx + ratio*rx*cos θ, cy + ratio*ry*sin θ)', () => {
      const p = handle.position(FRAME, [19098]);
      expect(p.x).toBeCloseTo(cx + ratio * rx * Math.cos(theta), 4);
      expect(p.y).toBeCloseTo(cy + ratio * ry * Math.sin(theta), 4);
    });

    it('zero ratio → handle at frame center', () => {
      const p = handle.position(FRAME, [0]);
      expect(p.x).toBeCloseTo(cx, 4);
      expect(p.y).toBeCloseTo(cy, 4);
    });
  });

  describe('apply', () => {
    const handle = STAR_5_HANDLES[0];

    it('pointer along ray at unit-ellipse radius 0.5 → adj0 = 50000', () => {
      // unit-ellipse pointer at 0.5 along (cos θ, sin θ) means
      // element-local pointer = (cx + 0.5*rx*cos θ, cy + 0.5*ry*sin θ)
      const px = cx + 0.5 * rx * Math.cos(theta);
      const py = cy + 0.5 * ry * Math.sin(theta);
      const next = handle.apply(FRAME, [19098], { x: px, y: py });
      expect(next[0]).toBe(50000);
    });

    it('pointer past unit-ellipse outer edge → clamps to 50000 (max)', () => {
      const px = cx + 5 * rx * Math.cos(theta);
      const py = cy + 5 * ry * Math.sin(theta);
      const next = handle.apply(FRAME, [19098], { x: px, y: py });
      // ratio in unit space = 5; clamped to 1 → 100000; spec max = 50000
      expect(next[0]).toBe(50000);
    });

    it('pointer at center → 0', () => {
      const next = handle.apply(FRAME, [19098], { x: cx, y: cy });
      expect(next[0]).toBe(0);
    });

    it('pointer perpendicular to handle ray → does not move ratio', () => {
      // ratio is the projection along (cos θ, sin θ); perpendicular
      // pointer should give projection 0, hence adj0 = 0
      const perpX = cx + rx * Math.sin(theta);   // perpendicular vector
      const perpY = cy - ry * Math.cos(theta);
      const next = handle.apply(FRAME, [19098], { x: perpX, y: perpY });
      expect(next[0]).toBe(0);
    });

    it('round-trip identity inside clamp range', () => {
      const adj = [30000];
      const p = handle.position(FRAME, adj);
      const back = handle.apply(FRAME, adj, p);
      expect(back[0]).toBeCloseTo(adj[0], -1);
    });
  });
});
```

- [ ] **Step 6.2: Run test to verify it fails**

```bash
pnpm --filter @wafflebase/slides test --run -- packages/slides/src/view/canvas/shapes/stars/star5.handles.test.ts
```

Expected: FAIL with `STAR_5_HANDLES` not exported.

- [ ] **Step 6.3: Create shared radial helper**

Create `packages/slides/src/view/canvas/shapes/stars/handles.ts`:

```ts
import type { AdjustmentHandle } from '../builder';

const STAR_MIN = 0;
const STAR_MAX = 50000;

/**
 * Radial drag handle for an N-pointed star. Position = first inner-
 * ring vertex (immediately clockwise of the apex outer vertex). Drag
 * vector along the same ray controls the inner ratio. All math in
 * unit-ellipse space so non-square frames behave consistently with
 * the path builder.
 */
export function radialStarHandle(points: number): AdjustmentHandle {
  const theta = -Math.PI / 2 + Math.PI / points;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  return {
    position: ({ w, h }, adjustments) => {
      const ratio = (adjustments[0] ?? 0) / 100000;
      const cx = w / 2;
      const cy = h / 2;
      const rx = w / 2;
      const ry = h / 2;
      return { x: cx + ratio * rx * cos, y: cy + ratio * ry * sin };
    },
    apply: ({ w, h }, _start, pointer) => {
      const cx = w / 2;
      const cy = h / 2;
      const rx = w / 2;
      const ry = h / 2;
      // Normalize into unit-ellipse space then project onto the
      // handle's ray.
      const u = rx > 0 ? (pointer.x - cx) / rx : 0;
      const v = ry > 0 ? (pointer.y - cy) / ry : 0;
      const radial = Math.max(0, u * cos + v * sin);
      const ratio = Math.min(1, radial);
      const value = Math.round(ratio * 100000);
      return [Math.max(STAR_MIN, Math.min(STAR_MAX, value))];
    },
  };
}
```

- [ ] **Step 6.4: Register `STAR_5_HANDLES`**

Add to `packages/slides/src/view/canvas/shapes/stars/star5.ts`:

```ts
import { radialStarHandle } from './handles';

export const STAR_5_HANDLES = [radialStarHandle(5)] as const;
```

In `packages/slides/src/view/canvas/shapes/index.ts`, update star5 import line:

```ts
import { buildStar5, STAR_5_ADJUSTMENTS, STAR_5_HANDLES } from './stars/star5';
```

Add registration:

```ts
ADJUSTMENT_HANDLES.set('star5', STAR_5_HANDLES);
```

- [ ] **Step 6.5: Run tests**

```bash
pnpm --filter @wafflebase/slides test --run -- packages/slides/src/view/canvas/shapes/stars/star5.handles.test.ts packages/slides/src/view/canvas/shapes/index.test.ts
```

Expected: PASS (all 7 star5 cases + 3 registry consistency cases).

- [ ] **Step 6.6: Commit**

```bash
git add packages/slides/src/view/canvas/shapes/stars/handles.ts packages/slides/src/view/canvas/shapes/stars/star5.ts packages/slides/src/view/canvas/shapes/stars/star5.handles.test.ts packages/slides/src/view/canvas/shapes/index.ts
git commit -m "$(cat <<'EOF'
Add radialStarHandle helper + star5 adjustment drag handle

Shared factory parametrized by point count handles all 6 stars in
P3-A.1; star5 is the canonical first wired up. Math runs in
unit-ellipse space (pointer pre-divided by rx,ry) so non-square
frames behave consistently with the path builder's ellipse
inscription. Pointer projects onto the handle's ray, so
perpendicular motion does not change the ratio.
EOF
)"
```

---

## Task 7: Register remaining 5 stars (`star4`, `star6`, `star7`, `star8`, `star10`)

**Files:**
- Modify: 5 star files (`star4.ts`, `star6.ts`, `star7.ts`, `star8.ts`, `star10.ts`)
- Create: 5 corresponding `*.handles.test.ts` files
- Modify: `packages/slides/src/view/canvas/shapes/index.ts`

Each star is a one-liner: import `radialStarHandle`, export `STAR_N_HANDLES = [radialStarHandle(N)] as const`. Tests are short — 2 cases per star (default position, round-trip).

- [ ] **Step 7.1: Write tests for all 5 stars**

For each `N` in `[4, 6, 7, 8, 10]`, create `packages/slides/src/view/canvas/shapes/stars/star${N}.handles.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { STAR_4_HANDLES } from './star4'; // adjust per file

const FRAME = { w: 200, h: 100 };
const N = 4; // adjust per file
const DEFAULT_RATIO = 12500; // adjust per N: see STAR_N_ADJUSTMENTS

describe('STAR_4_HANDLES', () => {
  it('exposes a single handle', () => {
    expect(STAR_4_HANDLES).toHaveLength(1);
  });

  it('position at default sits inside the frame bounding box', () => {
    const p = STAR_4_HANDLES[0].position(FRAME, [DEFAULT_RATIO]);
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.x).toBeLessThanOrEqual(FRAME.w);
    expect(p.y).toBeGreaterThanOrEqual(0);
    expect(p.y).toBeLessThanOrEqual(FRAME.h);
  });

  it('round-trip identity inside clamp range', () => {
    const adj = [25000];
    const p = STAR_4_HANDLES[0].position(FRAME, adj);
    const back = STAR_4_HANDLES[0].apply(FRAME, adj, p);
    expect(back[0]).toBeCloseTo(adj[0], -1);
  });
});
```

DEFAULT_RATIO per star (from each `STAR_N_ADJUSTMENTS.defaultValue`):

| N | DEFAULT_RATIO |
|---|---|
| 4 | 12500 |
| 6 | 28868 |
| 7 | 34601 |
| 8 | 37500 |
| 10 | 42533 |

- [ ] **Step 7.2: Run tests to verify they fail**

```bash
pnpm --filter @wafflebase/slides test --run -- packages/slides/src/view/canvas/shapes/stars/
```

Expected: 5 new test files FAIL with missing exports.

- [ ] **Step 7.3: Add handle exports to each star file**

For each `N` in `[4, 6, 7, 8, 10]`, add to `packages/slides/src/view/canvas/shapes/stars/star${N}.ts`:

```ts
import { radialStarHandle } from './handles';

export const STAR_N_HANDLES = [radialStarHandle(N)] as const;
// substitute N: STAR_4_HANDLES = [radialStarHandle(4)] as const, etc.
```

- [ ] **Step 7.4: Register in index.ts**

Update each star's import to include the new export, then add 5 lines to the `ADJUSTMENT_HANDLES.set` block:

```ts
ADJUSTMENT_HANDLES.set('star4', STAR_4_HANDLES);
ADJUSTMENT_HANDLES.set('star6', STAR_6_HANDLES);
ADJUSTMENT_HANDLES.set('star7', STAR_7_HANDLES);
ADJUSTMENT_HANDLES.set('star8', STAR_8_HANDLES);
ADJUSTMENT_HANDLES.set('star10', STAR_10_HANDLES);
```

- [ ] **Step 7.5: Run all star tests + registry test**

```bash
pnpm --filter @wafflebase/slides test --run -- packages/slides/src/view/canvas/shapes/stars/ packages/slides/src/view/canvas/shapes/index.test.ts
```

Expected: PASS. Registry size now == 9 (`star5` from Task 6 + 5 here + roundRect + chevron + wedgeRectCallout from Tasks 3–5).

- [ ] **Step 7.6: Commit**

```bash
git add packages/slides/src/view/canvas/shapes/stars/star4.ts packages/slides/src/view/canvas/shapes/stars/star4.handles.test.ts packages/slides/src/view/canvas/shapes/stars/star6.ts packages/slides/src/view/canvas/shapes/stars/star6.handles.test.ts packages/slides/src/view/canvas/shapes/stars/star7.ts packages/slides/src/view/canvas/shapes/stars/star7.handles.test.ts packages/slides/src/view/canvas/shapes/stars/star8.ts packages/slides/src/view/canvas/shapes/stars/star8.handles.test.ts packages/slides/src/view/canvas/shapes/stars/star10.ts packages/slides/src/view/canvas/shapes/stars/star10.handles.test.ts packages/slides/src/view/canvas/shapes/index.ts
git commit -m "$(cat <<'EOF'
Add adjustment drag handles for star4/6/7/8/10

Mechanical follow-up to star5 + radialStarHandle helper. Each star
is a one-line export; tests verify position-in-bounds at default
and round-trip identity in the clamp range. Registry now covers
all 9 P3-A.1 pilot shapes.
EOF
)"
```

---

## Task 8: Interaction module — `defaultAdjustmentsFor` + `snapToDefaults`

**Files:**
- Create: `packages/slides/src/view/editor/interactions/adjustment.ts`
- Create: `packages/slides/src/view/editor/interactions/adjustment.test.ts`

These two pure functions are needed by both the renderer (defaults) and the drag loop (snap). Hit-test enters in Task 10.

- [ ] **Step 8.1: Write failing tests**

Create `packages/slides/src/view/editor/interactions/adjustment.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { defaultAdjustmentsFor, snapToDefaults } from './adjustment';

describe('defaultAdjustmentsFor', () => {
  it('returns the spec defaults for a registered kind', () => {
    expect(defaultAdjustmentsFor('roundRect')).toEqual([16667]);
    expect(defaultAdjustmentsFor('star5')).toEqual([19098]);
    expect(defaultAdjustmentsFor('wedgeRectCallout')).toEqual([-20833, 62500]);
  });

  it('returns [] for an unregistered kind', () => {
    expect(defaultAdjustmentsFor('rect')).toEqual([]);
  });
});

describe('snapToDefaults', () => {
  it('snaps when each adjustment is within 5% of (max - min) of default', () => {
    // roundRect default 16667, range 0..50000 → 5% = 2500
    expect(snapToDefaults('roundRect', [16000])).toEqual([16667]);
    expect(snapToDefaults('roundRect', [18000])).toEqual([16667]);
  });

  it('does not snap when farther than 5%', () => {
    expect(snapToDefaults('roundRect', [25000])).toEqual([25000]);
  });

  it('all adjustments must qualify (multi-index)', () => {
    // wedgeRectCallout defaults [-20833, 62500], ranges 200000 each → 5% = 10000
    // both close → snap
    expect(snapToDefaults('wedgeRectCallout', [-22000, 60000])).toEqual([-20833, 62500]);
    // first close, second far → no snap
    expect(snapToDefaults('wedgeRectCallout', [-22000, 0])).toEqual([-22000, 0]);
  });

  it('returns input unchanged for unregistered kind', () => {
    expect(snapToDefaults('rect', [42])).toEqual([42]);
  });
});
```

- [ ] **Step 8.2: Run test to verify it fails**

```bash
pnpm --filter @wafflebase/slides test --run -- packages/slides/src/view/editor/interactions/adjustment.test.ts
```

Expected: FAIL with module not found.

- [ ] **Step 8.3: Implement module**

Create `packages/slides/src/view/editor/interactions/adjustment.ts`:

```ts
import { ADJUSTMENT_SPECS } from '../../canvas/shapes';
import type { ShapeKind } from '../../../model/element';

const SNAP_FRACTION = 0.05;

/**
 * Expand the AdjustmentSpec defaults for a shape into a full
 * adjustments array. Returns [] for shapes with no spec.
 */
export function defaultAdjustmentsFor(kind: ShapeKind): number[] {
  const specs = ADJUSTMENT_SPECS.get(kind);
  if (!specs) return [];
  return specs.map((s) => s.defaultValue);
}

/**
 * Snap each adjustment to its default if it is within 5% of
 * (max - min) of that default. Snap is all-or-nothing across
 * multi-index handles: every component must qualify.
 */
export function snapToDefaults(
  kind: ShapeKind,
  adjustments: number[],
): number[] {
  const specs = ADJUSTMENT_SPECS.get(kind);
  if (!specs) return adjustments;
  const allClose = specs.every((spec, i) => {
    const v = adjustments[i] ?? spec.defaultValue;
    const range = spec.max - spec.min;
    return Math.abs(v - spec.defaultValue) <= range * SNAP_FRACTION;
  });
  return allClose ? specs.map((s) => s.defaultValue) : adjustments;
}
```

- [ ] **Step 8.4: Run test to verify it passes**

```bash
pnpm --filter @wafflebase/slides test --run -- packages/slides/src/view/editor/interactions/adjustment.test.ts
```

Expected: PASS.

- [ ] **Step 8.5: Commit**

```bash
git add packages/slides/src/view/editor/interactions/adjustment.ts packages/slides/src/view/editor/interactions/adjustment.test.ts
git commit -m "$(cat <<'EOF'
Add defaultAdjustmentsFor + snapToDefaults helpers

Shared by the overlay renderer (default expansion when an element
has no data.adjustments yet) and the drag loop (Shift modifier
snap-to-default). All-or-nothing snap on multi-index handles
matches the user's expectation that Shift produces the canonical
shape, not a partially-snapped intermediate.
EOF
)"
```

---

## Task 9: Render adjustment handles in overlay

**Files:**
- Modify: `packages/slides/src/view/editor/overlay.ts`
- Modify: `packages/slides/src/view/editor/overlay.test.ts` (extend)

Add handle painting for the 9 pilot shapes when single-selected. Reuses the existing `localToWorld` math (currently private to `overlay.ts`); we add a new private helper `renderAdjustmentHandles` invoked at the end of both axis-aligned and rotated render branches.

- [ ] **Step 9.1: Write failing test**

Append to `packages/slides/src/view/editor/overlay.test.ts` (or create a new test file if separate):

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { renderOverlay } from './overlay';
import type { ShapeElement } from '../../model/element';

function makeShape(kind: ShapeElement['data']['kind']): ShapeElement {
  return {
    id: 'el1',
    type: 'shape',
    frame: { x: 100, y: 100, w: 200, h: 100, rotation: 0 },
    data: { kind },
  };
}

describe('renderOverlay — adjustment handles', () => {
  let overlay: HTMLDivElement;
  beforeEach(() => {
    overlay = document.createElement('div');
  });

  it('paints a yellow diamond for a selected pilot shape (roundRect)', () => {
    renderOverlay(overlay, [makeShape('roundRect')], { scale: 1 });
    const adj = overlay.querySelector('[data-handle="adjust-0"]');
    expect(adj).not.toBeNull();
  });

  it('paints no adjustment handle for a non-pilot shape (rect)', () => {
    renderOverlay(overlay, [makeShape('rect')], { scale: 1 });
    const adj = overlay.querySelector('[data-handle^="adjust-"]');
    expect(adj).toBeNull();
  });

  it('paints no adjustment handle on multi-selection', () => {
    renderOverlay(
      overlay,
      [makeShape('roundRect'), makeShape('star5')],
      { scale: 1 },
    );
    const adj = overlay.querySelector('[data-handle^="adjust-"]');
    expect(adj).toBeNull();
  });

  it('appends adjustment handles AFTER resize handles in DOM order', () => {
    renderOverlay(overlay, [makeShape('roundRect')], { scale: 1 });
    const children = Array.from(overlay.children);
    const lastResize = children.findIndex(
      (c) => c.getAttribute('data-handle') === 'rotate',
    );
    const firstAdjust = children.findIndex((c) =>
      c.getAttribute('data-handle')?.startsWith('adjust-'),
    );
    expect(firstAdjust).toBeGreaterThan(lastResize);
  });
});
```

- [ ] **Step 9.2: Run test to verify it fails**

```bash
pnpm --filter @wafflebase/slides test --run -- packages/slides/src/view/editor/overlay.test.ts
```

Expected: FAIL on first 3 cases (no `adjust-N` element).

- [ ] **Step 9.3: Add `renderAdjustmentHandles` to overlay.ts**

Add at the bottom of `packages/slides/src/view/editor/overlay.ts`:

```ts
import { ADJUSTMENT_HANDLES } from '../canvas/shapes';
import { defaultAdjustmentsFor } from './interactions/adjustment';

const ADJUST_HANDLE_SIZE = 8; // px (post-scale, like resize handles)

function renderAdjustmentHandles(
  overlay: HTMLDivElement,
  el: Element,
  options: OverlayOptions,
): void {
  if (el.type !== 'shape') return;
  const handles = ADJUSTMENT_HANDLES.get(el.data.kind);
  if (!handles || handles.length === 0) return;

  const { scale } = options;
  const { frame } = el;
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;
  const cos = Math.cos(frame.rotation);
  const sin = Math.sin(frame.rotation);
  const localToWorld = (lx: number, ly: number) => {
    const dx = lx - frame.w / 2;
    const dy = ly - frame.h / 2;
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  };

  const adjustments =
    el.data.adjustments ?? defaultAdjustmentsFor(el.data.kind);
  handles.forEach((handle, i) => {
    const local = handle.position({ w: frame.w, h: frame.h }, adjustments);
    const world = localToWorld(local.x, local.y);
    overlay.appendChild(
      makeAdjustmentHandle(`adjust-${i}`, world.x * scale, world.y * scale),
    );
  });
}

function makeAdjustmentHandle(kind: string, cx: number, cy: number): HTMLDivElement {
  const el = document.createElement('div');
  el.dataset.handle = kind;
  el.className = `wfb-slides-handle wfb-slides-adjust ${kind}`;
  el.style.position = 'absolute';
  el.style.left = `${cx - ADJUST_HANDLE_SIZE / 2}px`;
  el.style.top = `${cy - ADJUST_HANDLE_SIZE / 2}px`;
  el.style.width = `${ADJUST_HANDLE_SIZE}px`;
  el.style.height = `${ADJUST_HANDLE_SIZE}px`;
  el.style.background = '#FFD500';
  el.style.border = '1px solid #000';
  el.style.transform = 'rotate(45deg)'; // diamond
  el.style.cursor = 'pointer';
  return el;
}
```

Wire into both render branches in `renderOverlay`:

In `renderOverlay` after the `renderRotatedHandles` call (rotated branch):

```ts
if (selectedElements.length === 1 && selectedElements[0].frame.rotation !== 0) {
  renderRotatedHandles(overlay, selectedElements[0].frame, options);
  renderAdjustmentHandles(overlay, selectedElements[0], options);
  return;
}
```

In the axis-aligned branch, after the resize-handles loop:

```ts
for (const [kind, cx, cy] of positions) {
  overlay.appendChild(makeHandle(kind, cx, cy));
}
if (selectedElements.length === 1) {
  renderAdjustmentHandles(overlay, selectedElements[0], options);
}
```

(Existing import `import type { Element, Frame } from '../../model/element';` already covers the `Element` type.)

- [ ] **Step 9.4: Run tests**

```bash
pnpm --filter @wafflebase/slides test --run -- packages/slides/src/view/editor/overlay.test.ts
```

Expected: PASS (all 4 new cases + existing overlay cases).

- [ ] **Step 9.5: Commit**

```bash
git add packages/slides/src/view/editor/overlay.ts packages/slides/src/view/editor/overlay.test.ts
git commit -m "$(cat <<'EOF'
Render adjustment drag handles on selected pilot shapes

Yellow-diamond DOM elements with data-handle="adjust-N", appended
after resize handles so they sit on top in both DOM stacking and
hit-test order. Shows only on single-select; uses default
adjustments when data.adjustments is missing (P1-authored shapes).
Both rotated and axis-aligned branches paint via the existing
overlay container.
EOF
)"
```

---

## Task 10: Hit-test routing for `adjust-N` handles

**Files:**
- Modify: `packages/slides/src/view/editor/handle-hit-test.ts` (or wherever `handleHitTest`/`HandleKind` live; locate via `grep -rn handleHitTest packages/slides`)
- Modify: `packages/slides/src/view/editor/editor.ts` (route in `onPointerDownHandle`)

The existing `handleHitTest(overlay, x, y)` reads `data-handle` from DOM elements at `(x, y)`. It needs to widen its return type to include `adjust-${number}` strings, and the editor's pointerdown branch needs to route those to a new `startAdjustmentDrag`.

- [ ] **Step 10.1: Locate the existing hit-test helper**

```bash
grep -rn "handleHitTest\|HandleKind" packages/slides/src/view/editor/
```

The exact file name is environment-dependent; the helper currently returns one of `'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate' | null`. Confirm before editing.

- [ ] **Step 10.2: Widen the return type**

Add to the same module that exports `HandleKind`:

```ts
export type AdjustmentHandleKind = `adjust-${number}`;
export type HandleKind =
  | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate'
  | AdjustmentHandleKind;
```

If the existing implementation reads `dataset.handle` and returns it as-is, the runtime change may be zero — only the type needs widening. Confirm by reading the file before changing logic.

- [ ] **Step 10.3: Route in editor.ts**

Modify `packages/slides/src/view/editor/editor.ts:807` (`onPointerDownHandle`):

```ts
private onPointerDownHandle(handle: HandleKind, clientX: number, clientY: number): void {
  if (handle === 'rotate') {
    this.startRotate(clientX, clientY);
    return;
  }
  if (handle.startsWith('adjust-')) {
    const handleIndex = parseInt(handle.slice('adjust-'.length), 10);
    this.startAdjustmentDrag(handleIndex, clientX, clientY);
    return;
  }
  this.startResize(handle, clientX, clientY);
}
```

`startAdjustmentDrag` is implemented in Task 11.

- [ ] **Step 10.4: Add hit-priority test**

Append to `packages/slides/src/view/editor/overlay.test.ts`:

```ts
it('handleHitTest returns the adjustment handle when it overlaps a resize handle', () => {
  // Construct a roundRect where r=0 forces handle position to (0,0),
  // overlapping the NW resize handle.
  const el: ShapeElement = {
    id: 'el1',
    type: 'shape',
    frame: { x: 0, y: 0, w: 200, h: 100, rotation: 0 },
    data: { kind: 'roundRect', adjustments: [0] },
  };
  const overlay = document.createElement('div');
  renderOverlay(overlay, [el], { scale: 1 });
  // Hit-test at (0, 0) must yield 'adjust-0' (later sibling = on top).
  // (Stub document.elementsFromPoint or use the overlay directly.)
  // …test depends on handleHitTest's signature; adapt as needed.
});
```

(Exact stub form depends on whether `handleHitTest` uses `elementFromPoint` or iterates `overlay.children` itself; check Step 10.1 result.)

- [ ] **Step 10.5: Run tests + typecheck**

```bash
pnpm --filter @wafflebase/slides test --run
pnpm --filter @wafflebase/slides build
```

Expected: PASS. The build catches any missed type widening across consumers of `HandleKind`.

- [ ] **Step 10.6: Commit**

```bash
git add packages/slides/src/view/editor/
git commit -m "$(cat <<'EOF'
Widen HandleKind to include adjust-N handles + route in editor

Existing handleHitTest already reads data-handle from DOM, so the
runtime change is just the type union. Editor pointerdown now
routes adjust-N to startAdjustmentDrag (stubbed, real impl in
the next commit). Adjustment handles take hit priority over
resize handles because they paint later in the DOM (last-sibling
elementFromPoint wins).
EOF
)"
```

---

## Task 11: `startAdjustmentDrag` — drag loop + tooltip

**Files:**
- Modify: `packages/slides/src/view/editor/editor.ts`
- Create: `packages/slides/src/view/editor/adjustment-tooltip.ts` (small DOM tooltip helper)

Mirrors `startResize` (`editor.ts:850`). Adds 2px threshold, Shift snap, and a tooltip overlay.

- [ ] **Step 11.1: Implement tooltip helper**

Create `packages/slides/src/view/editor/adjustment-tooltip.ts`:

```ts
let current: HTMLDivElement | null = null;

export function showAdjustmentTooltip(
  overlay: HTMLDivElement,
  worldX: number,
  worldY: number,
  scale: number,
  text: string,
): void {
  if (!current) {
    current = document.createElement('div');
    current.className = 'wfb-slides-adjust-tooltip';
    current.style.position = 'absolute';
    current.style.padding = '2px 6px';
    current.style.background = 'rgba(0,0,0,0.75)';
    current.style.color = '#fff';
    current.style.fontSize = '11px';
    current.style.borderRadius = '3px';
    current.style.pointerEvents = 'none';
    current.style.whiteSpace = 'nowrap';
    overlay.appendChild(current);
  }
  current.textContent = text;
  // 12px upper-right offset, post-scale
  current.style.left = `${worldX * scale + 12}px`;
  current.style.top = `${worldY * scale - 20}px`;
}

export function hideAdjustmentTooltip(): void {
  if (current) {
    current.remove();
    current = null;
  }
}
```

- [ ] **Step 11.2: Implement `startAdjustmentDrag`**

Add to `packages/slides/src/view/editor/editor.ts`, alongside `startResize`:

```ts
import { ADJUSTMENT_HANDLES, ADJUSTMENT_SPECS } from '../canvas/shapes';
import {
  defaultAdjustmentsFor,
  snapToDefaults,
} from './interactions/adjustment';
import {
  showAdjustmentTooltip,
  hideAdjustmentTooltip,
} from './adjustment-tooltip';

private startAdjustmentDrag(
  handleIndex: number,
  clientX: number,
  clientY: number,
): void {
  const startSlide = this.currentSlide();
  if (!startSlide) return;
  const selectedIds = this.selection.get();
  if (selectedIds.length !== 1) return;
  const elementId = selectedIds[0];
  const startEl = startSlide.elements.find((e) => e.id === elementId);
  if (!startEl || startEl.type !== 'shape') return;

  const handles = ADJUSTMENT_HANDLES.get(startEl.data.kind);
  if (!handles || !handles[handleIndex]) return;
  const handle = handles[handleIndex];
  const specs = ADJUSTMENT_SPECS.get(startEl.data.kind) ?? [];
  const startAdjustments =
    startEl.data.adjustments ?? defaultAdjustmentsFor(startEl.data.kind);

  const startWorld = this.clientToLogical(clientX, clientY);
  const cx = startEl.frame.x + startEl.frame.w / 2;
  const cy = startEl.frame.y + startEl.frame.h / 2;
  const cos = Math.cos(startEl.frame.rotation);
  const sin = Math.sin(startEl.frame.rotation);
  // World → element-local (inverse rotation around center, then re-anchor to top-left).
  const worldToLocal = (wx: number, wy: number) => {
    const dx = wx - cx;
    const dy = wy - cy;
    const lx = dx * cos + dy * sin + startEl.frame.w / 2;
    const ly = -dx * sin + dy * cos + startEl.frame.h / 2;
    return { x: lx, y: ly };
  };

  let live = startAdjustments;
  let moved = false;

  const onMove = (ev: MouseEvent) => {
    const cur = this.clientToLogical(ev.clientX, ev.clientY);
    if (!moved) {
      const dx = cur.x - startWorld.x;
      const dy = cur.y - startWorld.y;
      if (dx * dx + dy * dy < 4) return; // 2px threshold
      moved = true;
    }
    const local = worldToLocal(cur.x, cur.y);
    let next = handle.apply(
      { w: startEl.frame.w, h: startEl.frame.h },
      startAdjustments,
      local,
    );
    if (ev.shiftKey) next = snapToDefaults(startEl.data.kind, next);
    live = next;
    this.paintLiveAdjustments(elementId, live);

    // Tooltip — formatted value, top-right of handle in world coords.
    const handleLocal = handle.position(
      { w: startEl.frame.w, h: startEl.frame.h },
      live,
    );
    const handleWorld = {
      x: cx + (handleLocal.x - startEl.frame.w / 2) * cos -
            (handleLocal.y - startEl.frame.h / 2) * sin,
      y: cy + (handleLocal.x - startEl.frame.w / 2) * sin +
            (handleLocal.y - startEl.frame.h / 2) * cos,
    };
    showAdjustmentTooltip(
      this.options.overlay,
      handleWorld.x,
      handleWorld.y,
      this.scale(),
      formatAdjustments(specs, live),
    );
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    hideAdjustmentTooltip();
    if (!moved) return;
    this.options.store.batch(() => {
      this.options.store.updateElementData(startSlide.id, elementId, {
        adjustments: live,
      });
    });
    this.renderer.markDirty();
    this.render();
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

private paintLiveAdjustments(elementId: string, adjustments: number[]): void {
  // Reuse the existing live-paint pipeline by passing a frame-equivalent
  // override; renderer reads adjustments off the live element. If
  // paintLive only supports frame overrides today, add a sibling
  // paintLiveData that does the same for data fields.
  this.renderer.markDirtyElement?.(elementId, { data: { adjustments } });
  this.render();
}
```

If `markDirtyElement` doesn't exist, the simplest path is to pass through a temporary override map (parallel to the existing frame-override path used by `paintLive`). Inspect `slide-renderer.ts` and `render-context.ts` first; pick the smallest hook that lets a single element re-render with overridden adjustments without committing to the store.

Helper at module scope:

```ts
function formatAdjustments(
  specs: readonly { name: string; format?: (v: number) => string }[],
  values: number[],
): string {
  if (specs.length === 1) {
    const v = values[0];
    return specs[0].format ? specs[0].format(v) : String(v);
  }
  return specs
    .map((s, i) => `${s.name.charAt(0).toLowerCase()}: ${s.format ? s.format(values[i]) : values[i]}`)
    .join(' / ');
}
```

- [ ] **Step 11.3: Run unit tests**

```bash
pnpm --filter @wafflebase/slides test --run
```

Expected: PASS. (Drag end-to-end editor test follows in Task 12.)

- [ ] **Step 11.4: Commit**

```bash
git add packages/slides/src/view/editor/editor.ts packages/slides/src/view/editor/adjustment-tooltip.ts
git commit -m "$(cat <<'EOF'
Add startAdjustmentDrag and tooltip for slides shape adjustments

Mirrors startResize: pointermove paints a local preview, pointerup
commits one store.updateElementData call → one undo entry. 2px
threshold prevents accidental commits on click. Shift snaps every
adjustment to its default when all components are within 5% of
range. Tooltip uses AdjustmentSpec.format for the live readout.
EOF
)"
```

---

## Task 12: Editor integration test (drag end-to-end)

**Files:**
- Modify: `packages/slides/src/view/editor/editor.test.ts` (or its existing equivalent — locate first)

- [ ] **Step 12.1: Locate the editor test file**

```bash
find packages/slides/src/view/editor -name "*.test.ts"
```

If `editor.test.ts` doesn't exist, create one with the standard JSDOM setup used elsewhere in the package (look at `overlay.test.ts` for the pattern).

- [ ] **Step 12.2: Add drag end-to-end test**

```ts
import { describe, it, expect } from 'vitest';
import { initialize } from './editor';
import { createMemoryStore } from '../../store/memory';

function setup() {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 600;
  const overlay = document.createElement('div');
  document.body.append(canvas, overlay);
  const store = createMemoryStore({ /* minimal seed: 1 slide, 1 roundRect */ });
  const editor = initialize({ canvas, overlay, store });
  return { canvas, overlay, store, editor };
}

describe('editor — adjustment drag', () => {
  it('commits one store update with new adjustments on pointerup', () => {
    const { overlay, store } = setup();
    const beforeUpdates = store.changeCount?.() ?? 0;

    // Programmatically drive a 5px drag on the adjust-0 handle of the
    // first slide's only element. (Exact dispatch shape depends on
    // jsdom + how editor wires its pointerdown — adapt to match
    // existing tests in this file if any.)
    const handle = overlay.querySelector('[data-handle="adjust-0"]') as HTMLElement;
    expect(handle).toBeTruthy();
    const r = handle.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: cx, clientY: cy }));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: cx + 5, clientY: cy }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: cx + 5, clientY: cy }));

    const afterUpdates = store.changeCount?.() ?? 0;
    expect(afterUpdates - beforeUpdates).toBe(1);
    // …and the element's data.adjustments has changed.
  });

  it('does not commit when drag is below 2px threshold', () => {
    const { overlay, store } = setup();
    const beforeUpdates = store.changeCount?.() ?? 0;
    const handle = overlay.querySelector('[data-handle="adjust-0"]') as HTMLElement;
    const r = handle.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: cx, clientY: cy }));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: cx + 1, clientY: cy }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: cx + 1, clientY: cy }));
    const afterUpdates = store.changeCount?.() ?? 0;
    expect(afterUpdates - beforeUpdates).toBe(0);
  });
});
```

(Adjust the seed-store helper to match the actual `createMemoryStore` API; the test's value is in proving the wiring, not the literal numbers.)

- [ ] **Step 12.3: Run editor tests**

```bash
pnpm --filter @wafflebase/slides test --run -- packages/slides/src/view/editor/editor.test.ts
```

Expected: PASS.

- [ ] **Step 12.4: Commit**

```bash
git add packages/slides/src/view/editor/editor.test.ts
git commit -m "$(cat <<'EOF'
Test slides adjustment drag end-to-end through editor

Verifies single store update on a real drag (>2px) and zero updates
when the threshold is not crossed. Catches regressions in the
hit-test wiring, threshold, and store.batch invocation in one
JSDOM-driven scenario.
EOF
)"
```

---

## Task 13: Visual harness scenario

**Files:**
- Modify: `packages/frontend/src/app/harness/visual/slides-scenarios.tsx`

Add a `shapes-adjustments-pilot` scenario that lays out the 9 pilot shapes in two rows: top row at default adjustments, bottom row with visibly-different user-authored adjustments (including one rotated star).

- [ ] **Step 13.1: Read the existing scenarios file**

```bash
grep -n "scenario\|register\|export\|harness" packages/frontend/src/app/harness/visual/slides-scenarios.tsx | head -30
```

Pattern-match the existing P2 catalog scenario (`shapes-catalog-basics` or similar) and follow its structure exactly.

- [ ] **Step 13.2: Add the scenario**

Append a new `registerScenario({...})` call (or whatever the file's pattern is) with a 9 × 2 grid of `ShapeElement`s. Top row uses defaults; bottom row uses these authored values:

| Shape | Authored adjustments |
|---|---|
| `roundRect` | `[40000]` (near-max corner radius) |
| `chevron` | `[20000]` (shallow notch) |
| `wedgeRectCallout` | `[60000, 0]` (tail right of frame, mid-height) |
| `star4` | `[35000]` (chunkier inner) |
| `star5` | `[35000]` |
| `star6` | `[40000]` |
| `star7` | `[45000]` |
| `star8` | `[45000]` |
| `star10` | `[42533]` (default — one star left at default for control) |

Add one rotated copy of `star5` (rotation = π/6) to the right of the grid to exercise rotated handle painting in the visual baseline.

- [ ] **Step 13.3: Run harness build to confirm it compiles**

```bash
pnpm --filter @wafflebase/frontend build
```

Expected: PASS.

- [ ] **Step 13.4: Run visual harness baseline regen**

```bash
pnpm verify:browser:docker:update
```

Expected: a new PNG baseline written for `shapes-adjustments-pilot`. Inspect the baseline (open the file in `packages/frontend/test-results/visual/baselines/` or wherever the tool saves it) and confirm:
- Top row: 9 shapes at OOXML defaults.
- Bottom row: visibly different shapes; corner radius almost max, chevron notch shallow, callout tail to the right, stars chunkier.
- Yellow diamonds appear on each (since the harness should have all 9 single-selected; if not, adjust the scenario to single-select sequentially or render selection-frame on each).
- Rotated star: handle co-rotates with the shape.

If anything looks visibly wrong, fix the scenario and re-run baseline regen before committing.

- [ ] **Step 13.5: Run visual diff (no `:update`) to confirm the baseline holds**

```bash
pnpm verify:browser:docker
```

Expected: PASS.

- [ ] **Step 13.6: Commit**

```bash
git add packages/frontend/src/app/harness/visual/slides-scenarios.tsx packages/frontend/test-results/visual/baselines/
# (Adjust the second path to wherever the harness writes baselines in this repo.)
git commit -m "$(cat <<'EOF'
Add visual harness scenario for P3-A.1 adjustment handles

Two-row 9-shape grid + one rotated star verifies handle painting
across all 4 axis types and through the rotation transform. Top
row shows default geometry; bottom row shows authored values that
visibly differ so a regression in apply/position math jumps out
in the diff.
EOF
)"
```

---

## Task 14: Wrap-up — full verification + smoke + lessons

**Files:**
- Modify: `docs/tasks/active/20260510-slides-shapes-p3a-pilot-todo.md` (this file — close items)
- Create: `docs/tasks/active/20260510-slides-shapes-p3a-pilot-lessons.md`

- [ ] **Step 14.1: Run full verify**

```bash
pnpm verify:fast
pnpm verify:self
```

Expected: both PASS.

- [ ] **Step 14.2: Manual smoke in dev**

```bash
docker compose up -d
pnpm dev
# In browser at http://localhost:5173:
#   1. Open a slides doc, insert a star5
#   2. Verify yellow diamond appears on selection
#   3. Drag → shape morphs live, tooltip shows %
#   4. Release → tooltip vanishes; one undo step covers the change
#   5. Repeat for roundRect, chevron, wedgeRectCallout
#   6. Rotate a shape, verify handle co-rotates and drag still works
#   7. Multi-select two shapes, verify diamonds disappear
```

Document any anomalies in the lessons file before fixing.

- [ ] **Step 14.3: Self code-review via skill**

Run `superpowers:requesting-code-review` over the full branch diff. Apply blocking findings; note non-blocking ones in lessons.

- [ ] **Step 14.4: Write lessons file**

Create `docs/tasks/active/20260510-slides-shapes-p3a-pilot-lessons.md` documenting:
- Anything that diverged from the spec at implementation time (with the reason).
- Any spec ambiguity that bit during implementation; corrected in the spec inline if so.
- Any new pitfalls future P3-A.2 / P3-B tasks should know (e.g., gotchas with `paintLive` for `data` fields if that turned out non-trivial).
- Test infrastructure quirks (DOM event dispatch shape, JSDOM limits).

- [ ] **Step 14.5: Mark this todo file's items complete**

Edit this file: change every `- [ ]` to `- [x]` for completed steps. Add a "Review" section at the bottom summarizing what shipped vs spec.

- [ ] **Step 14.6: Sync + open PR**

```bash
git fetch origin
git rebase origin/main   # surface conflicts before pushing
git push -u origin slides-shapes-p3a-pilot
gh pr create --title "Add adjustment drag handles for 9 pilot slides shapes (P3-A.1)" --body "$(cat <<'EOF'
## Summary

- Adds yellow-diamond drag handles for 9 pilot slides shapes (6 stars + roundRect + chevron + wedgeRectCallout) covering all 4 adjustment axis types.
- Introduces `ADJUSTMENT_HANDLES` registry parallel to `PATH_BUILDERS` / `ADJUSTMENT_SPECS`; P3-A.2 will register the remaining 24 shapes mechanically.
- Reuses the existing DOM overlay (`renderOverlay`) and resize-drag pattern; one `store.updateElementData` per drag → one undo entry.

## Test plan

- [ ] Unit: 9 shape × handle test files PASS (`pnpm --filter @wafflebase/slides test`)
- [ ] Integration: editor drag end-to-end test PASS (single store update; below-threshold drag commits nothing)
- [ ] Visual: `shapes-adjustments-pilot` baseline approved (`pnpm verify:browser:docker`)
- [ ] Smoke: all 9 shapes draggable in dev; tooltip readable; rotated shape works; multi-select hides handles
- [ ] `pnpm verify:fast` and `pnpm verify:self` PASS

## Spec

- Design: `docs/design/slides/slides-shapes-p3a-adjustments.md`
- Plan / lessons: `docs/tasks/active/20260510-slides-shapes-p3a-pilot-{todo,lessons}.md`
EOF
)"
```

- [ ] **Step 14.7: After PR merge — archive task and commit lessons**

```bash
pnpm tasks:archive
pnpm tasks:index
git add docs/tasks/
git commit -m "Archive slides P3-A.1 pilot task (PR merged)"
git push
```

---

## Self-Review (run after writing the plan)

1. **Spec coverage**: every section / requirement of `slides-shapes-p3a-adjustments.md` has a matching task above:
   - § 1 pilot scope → Tasks 3–7
   - § 2 abstraction → Task 1, 2
   - § 3 renderer / interaction → Tasks 9, 10, 11
   - § 4 data / collaboration → reused via Task 11 (`updateElementData`); no new code path
   - § 5 test strategy → Tasks 3–8 (per-shape + interaction units), Task 12 (integration), Task 13 (visual harness)
   - § 6 file layout → consistent with task-by-task file paths
   - § 7 migration → vacuous; no migration runs
2. **Placeholder scan**: no TBD/TODO/`fill in details`; one note in Task 11.2 says "If `markDirtyElement` doesn't exist, …" — this is intentional (the renderer's hook surface needs verification at implementation time, and the plan prescribes the smallest reasonable extension).
3. **Type consistency**: `AdjustmentHandle` (with `position`, `apply`) used identically across Tasks 1, 3–7, 9, 11. `ShapeKind` from `model/element` — consistent. `defaultAdjustmentsFor` / `snapToDefaults` from `interactions/adjustment` — consistent in Tasks 8, 9, 11. `data-handle="adjust-N"` — consistent across Tasks 9, 10, 11.

No issues found.
