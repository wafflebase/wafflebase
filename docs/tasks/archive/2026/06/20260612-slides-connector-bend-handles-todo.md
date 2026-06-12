# Slides Connector Bend Handles — Elbow + Curved

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship yellow-diamond bend handles for selected Elbow (Z-routed) and Curved connectors so users can adjust bend ratio / curvature directly on the canvas, matching PowerPoint behavior and closing the PR2 gap in `slides-connectors.md`.

**Architecture:** Add a single `'bend'` handle kind to the existing handle hit-test surface. Two pure helpers (`bendHandlePosition`, `bendFromCursor`) compute the yellow diamond's world position and convert pointer drags back into bend values per routing topology. Elbow path reuses existing `elbowBend` field + store method; curved path adds a parallel `curveBend` field + `updateConnectorCurveBend` to `SlidesStore` / `MemSlidesStore` / `YorkieSlidesStore`, with `routeCurved` accepting a `bend` factor that scales control-point distance symmetrically (keeping endpoint tangents fixed). Editor wires `onPointerDownHandle('bend')` to a new `startBendDrag` that commits per-routing through the right store method.

**Tech Stack:** TypeScript, Vitest (unit), existing slides editor (Canvas + DOM overlay), Yorkie CRDT for the production store impl.

---

## Scope

In scope (single PR):
- Elbow connector — yellow diamond on the cross-leg of **Z-routed** (parallel-opposite-facing) topology only. Dragging perpendicular to the parallel axis updates `elbowBend` ∈ [0, 1].
- Curved connector — yellow diamond at bezier midpoint (t=0.5). Dragging perpendicular to the chord updates `curveBend` (default 1, clamped [0.1, 3]).
- Hit-test, overlay rendering, drag handler, both store impls, routing math, design-doc status.

Out of scope (deferred):
- Elbow L (1-bend perpendicular), U (3-bend parallel-opposite-non-facing), C (3-bend parallel-same) bend handles — current routing has no parameter to adjust. Follow-up.
- Straight Line adjustment handles — GS and PPT both omit; design doc already excludes.
- Curved per-side asymmetric curvature (separate c1/c2 magnitudes) — single bend factor is enough for v1.
- Tooltip showing live bend value — adjustment shapes have it, connectors can ship without; follow-up.

## File Structure

**Create:**
- `packages/slides/src/view/canvas/connector-bend.ts` — pure helpers: `bendHandlePosition(connector, elements)`, `bendFromCursor(connector, cursor, elements)`. No DOM, no store.
- `packages/slides/src/view/canvas/connector-bend.test.ts` — unit tests.
- `packages/slides/src/view/editor/interactions/bend-drag.ts` — single-shot `commitBend(store, slideId, connector, value)` that routes elbow → `updateConnectorElbowBend`, curved → `updateConnectorCurveBend`.

**Modify:**
- `packages/slides/src/model/connector.ts` — add `curveBend?: number`.
- `packages/slides/src/view/canvas/routing.ts` — `routeCurved(a, aDir, b, bDir, bend?)`.
- `packages/slides/src/view/canvas/routing.test.ts` (if exists; create if not) — covers `bend` factor.
- `packages/slides/src/view/canvas/connector-frame.ts` — pass `connector.curveBend` into `routeCurved`.
- `packages/slides/src/store/store.ts` — declare `updateConnectorCurveBend`; update `updateConnectorRouting` jsdoc.
- `packages/slides/src/store/memory.ts` — impl `updateConnectorCurveBend`; clear `curveBend` in `updateConnectorRouting` when leaving curved.
- `packages/slides/test/store/memory.test.ts` — mirrors existing `elbowBend` test for `curveBend`.
- `packages/frontend/src/app/slides/yorkie-slides-store.ts` — `updateConnectorCurveBend` + parallel cleanup in `updateConnectorRouting`.
- `packages/slides/src/view/editor/hit-test.ts` — add `'bend'` to `HandleKind` and accept it in `isHandleKind`.
- `packages/slides/src/view/editor/overlay.ts` — extend `renderConnectorEndpointHandles` to also paint the bend handle for Z-elbow and curved.
- `packages/slides/src/view/editor/editor.ts` — `'bend'` branch in `onPointerDownHandle`; new `startBendDrag`.
- `docs/design/slides/slides-connectors.md` — flip PR2 status note for elbow, add curved-bend section.

---

## Task 1: Add `curveBend` field to the model

**Files:**
- Modify: `packages/slides/src/model/connector.ts`

- [x] **Step 1: Extend `ConnectorElement` with `curveBend?: number`**

Edit `packages/slides/src/model/connector.ts` so the type ends with:

```ts
export type ConnectorElement = ElementBase & {
  type: 'connector';
  routing: ConnectorRouting;
  start: Endpoint;
  end: Endpoint;
  arrowheads: { start?: ArrowheadStyle; end?: ArrowheadStyle };
  stroke?: ShapeStroke;
  /** Present only when the user manually dragged the elbow handle. */
  elbowBend?: number;
  /**
   * Curve-bend multiplier on `routeCurved`'s control-point distance.
   * Default (when undefined) is 1, matching the auto-routed look.
   * Persists in [0.1, 3] only when the user manually dragged the
   * curved-connector yellow-diamond handle.
   */
  curveBend?: number;
};
```

- [x] **Step 2: Run typecheck to confirm the model is sound**

Run: `pnpm slides build`
Expected: PASS — the dist build typechecks the model.

- [x] **Step 3: Commit**

```bash
git add packages/slides/src/model/connector.ts
git commit -m "Slides connectors: add curveBend field to ConnectorElement

For the curved-routing yellow-diamond handle (PR2 follow-up), the
connector needs a persisted multiplier on the auto control-point
distance. Default (undefined) keeps the existing auto-routed look;
manual handle drag writes a clamped [0.1, 3] value."
```

---

## Task 2: Extend `routeCurved` with `bend` parameter

**Files:**
- Modify: `packages/slides/src/view/canvas/routing.ts`
- Test: `packages/slides/test/view/canvas/routing.test.ts` (create if absent)

- [x] **Step 1: Check for an existing routing test file**

Run: `ls packages/slides/test/view/canvas/routing.test.ts 2>/dev/null || ls packages/slides/src/view/canvas/routing.test.ts 2>/dev/null || echo MISSING`
If MISSING, create at `packages/slides/test/view/canvas/routing.test.ts` with the import line `import { routeCurved, routeElbow, routeStraight } from '../../../src/view/canvas/routing';` and a top-level `describe('routing', () => { … })` wrapper around the test below.

- [x] **Step 2: Write the failing test**

Add inside the routing `describe`:

```ts
describe('routeCurved bend', () => {
  it('defaults bend=1: control points sit at dist/3 along exit normals', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 300, y: 0 };
    const bez = routeCurved(a, 0, b, Math.PI);
    expect(bez.c1.x).toBeCloseTo(100, 5);
    expect(bez.c2.x).toBeCloseTo(200, 5);
  });

  it('bend=2 doubles control-point reach along the exit normals', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 300, y: 0 };
    const bez = routeCurved(a, 0, b, Math.PI, 2);
    expect(bez.c1.x).toBeCloseTo(200, 5);
    expect(bez.c2.x).toBeCloseTo(100, 5);
  });

  it('bend clamps to [0.1, 3] so an extreme value cannot blow up the curve', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 300, y: 0 };
    const big = routeCurved(a, 0, b, Math.PI, 99);
    expect(big.c1.x).toBeCloseTo(300, 5); // 100 * 3
    const tiny = routeCurved(a, 0, b, Math.PI, 0);
    expect(tiny.c1.x).toBeCloseTo(10, 5); // 100 * 0.1
  });
});
```

- [x] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @wafflebase/slides test -- routing`
Expected: FAIL — `routeCurved` ignores the 5th arg.

- [x] **Step 4: Implement `bend` in `routeCurved`**

Replace the `routeCurved` block in `packages/slides/src/view/canvas/routing.ts` with:

```ts
const CURVE_BEND_MIN = 0.1;
const CURVE_BEND_MAX = 3;

function clampCurveBend(bend: number | undefined): number {
  if (bend === undefined || !Number.isFinite(bend)) return 1;
  return Math.min(CURVE_BEND_MAX, Math.max(CURVE_BEND_MIN, bend));
}

/**
 * Cubic bezier connector. Control points sit `(dist/3) * bend` along
 * each exit direction so the curve leaves both endpoints tangent to
 * their outward normals. `bend` defaults to 1 (auto, matching
 * PowerPoint's `curvedConnector*` look) and is clamped to
 * `[CURVE_BEND_MIN, CURVE_BEND_MAX]` so an extreme stored value can't
 * blow the control points into nonsense.
 */
export function routeCurved(
  a: Point,
  aDir: number,
  b: Point,
  bDir: number,
  bend?: number,
): BezierPath {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const k = (Math.hypot(dx, dy) / 3) * clampCurveBend(bend);
  return {
    p0: { ...a },
    c1: { x: a.x + Math.cos(aDir) * k, y: a.y + Math.sin(aDir) * k },
    c2: { x: b.x + Math.cos(bDir) * k, y: b.y + Math.sin(bDir) * k },
    p1: { ...b },
  };
}
```

Also export the clamp constants for the bend math module:

```ts
export const CURVE_BEND_DEFAULT = 1;
export { CURVE_BEND_MIN, CURVE_BEND_MAX };
```

- [x] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @wafflebase/slides test -- routing`
Expected: PASS — three new `routeCurved bend` tests green.

- [x] **Step 6: Commit**

```bash
git add packages/slides/src/view/canvas/routing.ts packages/slides/test/view/canvas/routing.test.ts
git commit -m "Slides routing: routeCurved accepts a bend factor

bend (default 1) scales the symmetric control-point distance so the
curved-routing yellow-diamond handle can adjust how pronounced the
arc is without breaking endpoint tangency. Clamped to [0.1, 3] to
match the chunkiness range a user actually wants and prevent a stored
extreme from degenerating the curve."
```

---

## Task 3: Plumb `curveBend` through `buildConnectorPath`

**Files:**
- Modify: `packages/slides/src/view/canvas/connector-frame.ts`

- [x] **Step 1: Pass `connector.curveBend` into `routeCurved`**

Find the `if (connector.routing === 'curved')` branch (around `connector-frame.ts:85`) and update the call:

```ts
if (connector.routing === 'curved') {
  return routeCurved(
    { x: a.x, y: a.y },
    a.angle,
    { x: b.x, y: b.y },
    b.angle,
    connector.curveBend,
  );
}
```

- [x] **Step 2: Run slides build to typecheck**

Run: `pnpm slides build`
Expected: PASS — type matches the new optional 5th arg from Task 2.

- [x] **Step 3: Commit**

```bash
git add packages/slides/src/view/canvas/connector-frame.ts
git commit -m "Slides connectors: pass curveBend through buildConnectorPath

Renderer / hit-tester / computeConnectorFrame all funnel through
buildConnectorPath; routing the field once here is the only edit
needed for every paint surface to honour a stored curve bend."
```

---

## Task 4: Add `updateConnectorCurveBend` to `SlidesStore` interface

**Files:**
- Modify: `packages/slides/src/store/store.ts`

- [x] **Step 1: Declare the method**

Insert after `updateConnectorElbowBend` (around `store.ts:179`):

```ts
  /**
   * Persist a user-dragged curve bend factor on a curved-routed
   * connector. Pass `undefined` to clear it and fall back to the
   * default 1 (auto-routed control-point distance). Implementations
   * must clamp to `[CURVE_BEND_MIN, CURVE_BEND_MAX]` and round to keep
   * the CRDT payload tidy.
   */
  updateConnectorCurveBend(
    slideId: string,
    elementId: string,
    bend: number | undefined,
  ): void;
```

- [x] **Step 2: Update `updateConnectorRouting` jsdoc**

Replace the jsdoc above `updateConnectorRouting` (around `store.ts:159`):

```ts
  /**
   * Switch the routing topology of an existing connector (straight /
   * elbow / curved). Clears any persisted `elbowBend` on the way out of
   * elbow routing, and any persisted `curveBend` on the way out of
   * curved routing, so a future return to that topology starts from
   * its default cross-leg / control-distance.
   */
```

- [x] **Step 3: Run typecheck**

Run: `pnpm slides build`
Expected: FAIL — `MemSlidesStore` doesn't implement `updateConnectorCurveBend` yet.

- [x] **Step 4: Commit (intermediate; impl follows in next task)**

Skip the commit until Task 5 ships the impl together — keeping the contract + impl in a single commit avoids a wedge state where the interface mismatches.

---

## Task 5: Implement `updateConnectorCurveBend` in `MemSlidesStore`

**Files:**
- Modify: `packages/slides/src/store/memory.ts`
- Test: `packages/slides/test/store/memory.test.ts`

- [x] **Step 1: Write the failing test**

Insert after the existing `elbowBend` test block (around `memory.test.ts:790`):

```ts
  it('updateConnectorRouting clears curveBend when leaving curved routing', () => {
    const store = new MemSlidesStore(makeBasePresentation());
    const slideId = store.read().slides[0].id;
    const id = store.batch(() => insertCurvedConnector(store, slideId));
    store.batch(() => store.updateConnectorCurveBend(slideId, id, 1.5));
    const c1 = store.read().slides[0].elements.find((e) => e.id === id);
    if (c1?.type === 'connector') expect(c1.curveBend).toBe(1.5);

    store.batch(() => store.updateConnectorRouting(slideId, id, 'straight'));
    const c2 = store.read().slides[0].elements.find((e) => e.id === id);
    if (c2?.type === 'connector') expect(c2.curveBend).toBeUndefined();
  });

  it('updateConnectorCurveBend rounds and clears via undefined', () => {
    const store = new MemSlidesStore(makeBasePresentation());
    const slideId = store.read().slides[0].id;
    const id = store.batch(() => insertCurvedConnector(store, slideId));
    store.batch(() => store.updateConnectorCurveBend(slideId, id, 1.234));
    const c1 = store.read().slides[0].elements.find((e) => e.id === id);
    if (c1?.type === 'connector') expect(c1.curveBend).toBe(1.23);

    store.batch(() => store.updateConnectorCurveBend(slideId, id, undefined));
    const c2 = store.read().slides[0].elements.find((e) => e.id === id);
    if (c2?.type === 'connector') expect(c2.curveBend).toBeUndefined();
  });
```

If `insertCurvedConnector` doesn't exist as a helper in `memory.test.ts`, copy the existing `insertElbowConnector` helper (search the same file) and change `routing: 'elbow'` → `routing: 'curved'` in the new copy. If `insertElbowConnector` doesn't exist either, inline the call:

```ts
function insertCurvedConnector(store: MemSlidesStore, slideId: string): string {
  return store.addConnector(slideId, {
    type: 'connector',
    routing: 'curved',
    start: { kind: 'free', x: 0,   y: 0 },
    end:   { kind: 'free', x: 200, y: 100 },
    arrowheads: {},
  });
}
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @wafflebase/slides test -- memory`
Expected: FAIL — `updateConnectorCurveBend` is not implemented.

- [x] **Step 3: Implement `updateConnectorCurveBend` and the routing cleanup**

Edit `packages/slides/src/store/memory.ts`. First, extend `updateConnectorRouting` (around `memory.ts:562`) so the cleanup also fires on leaving curved:

```ts
  updateConnectorRouting(
    slideId: string, elementId: string, routing: ConnectorRouting,
  ): void {
    this.requireBatch();
    const slide = this.requireSlide(slideId);
    const e = this.requireElement(slide, elementId);
    if (e.type !== 'connector') {
      throw new Error(`Element ${elementId} is not a connector`);
    }
    if (e.routing === routing) return;
    e.routing = routing;
    if (routing !== 'elbow') delete e.elbowBend;
    if (routing !== 'curved') delete e.curveBend;
    e.frame = computeConnectorFrame(e, this.elementsLookup(slideId));
  }
```

Then add the new method directly after `updateConnectorElbowBend` (around `memory.ts:595`):

```ts
  updateConnectorCurveBend(
    slideId: string, elementId: string, bend: number | undefined,
  ): void {
    this.requireBatch();
    const slide = this.requireSlide(slideId);
    const e = this.requireElement(slide, elementId);
    if (e.type !== 'connector') {
      throw new Error(`Element ${elementId} is not a connector`);
    }
    if (bend === undefined) {
      delete e.curveBend;
    } else {
      // Round to 0.01 so the CRDT payload stays tidy under drag updates.
      const rounded = Math.round(bend * 100) / 100;
      e.curveBend = Math.min(CURVE_BEND_MAX, Math.max(CURVE_BEND_MIN, rounded));
    }
    e.frame = computeConnectorFrame(e, this.elementsLookup(slideId));
  }
```

Add the import at the top of `memory.ts`:

```ts
import { CURVE_BEND_MAX, CURVE_BEND_MIN } from '../view/canvas/routing';
```

- [x] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @wafflebase/slides test -- memory`
Expected: PASS — both new tests + the existing elbow test green.

- [x] **Step 5: Commit**

```bash
git add packages/slides/src/store/store.ts packages/slides/src/store/memory.ts \
  packages/slides/test/store/memory.test.ts
git commit -m "Slides store: updateConnectorCurveBend + routing cleanup

Symmetric with updateConnectorElbowBend: the field persists only when
the user dragged the curved yellow-diamond handle. Switching routing
out of curved drops the stored bend so a future return starts from
the default control-point distance (matching the elbow cleanup)."
```

---

## Task 6: Yorkie-store parity for `curveBend`

**Files:**
- Modify: `packages/frontend/src/app/slides/yorkie-slides-store.ts`

- [x] **Step 1: Extend `updateConnectorRouting` cleanup**

Find the existing `updateConnectorRouting` in `yorkie-slides-store.ts` (around line 1197). Add the curved-cleanup line so the proxy block reads:

```ts
      if (c.routing === routing) return;
      c.routing = routing;
      if (routing !== 'elbow') delete c.elbowBend;
      if (routing !== 'curved') delete (c as { curveBend?: number }).curveBend;
      const plain = unwrapElement(e) as unknown as ConnectorElement;
      c.frame = computeConnectorFrame(plain, this.slideElementsLookup(s));
```

- [x] **Step 2: Add `updateConnectorCurveBend` method**

Insert directly after `updateConnectorElbowBend` (around `yorkie-slides-store.ts:1250`). Mirror that method's structure:

```ts
  updateConnectorCurveBend(
    slideId: string,
    elementId: string,
    bend: number | undefined,
  ): void {
    this.requireBatch();
    this.doc.update((r) => {
      const s = r.slides.find((s) => s.id === slideId);
      if (!s) throw new Error(`Slide not found: ${slideId}`);
      const path = yorkieFindElementPath(s.elements as unknown as ProxyArray, elementId);
      if (!path) throw new Error(`Element not found: ${elementId}`);
      const e = path[path.length - 1];
      if (e.type !== 'connector') {
        throw new Error(`Element ${elementId} is not a connector`);
      }
      const c = e as unknown as { curveBend?: number; frame: Frame };
      if (bend === undefined) {
        delete c.curveBend;
      } else {
        const rounded = Math.round(bend * 100) / 100;
        c.curveBend = Math.min(CURVE_BEND_MAX, Math.max(CURVE_BEND_MIN, rounded));
      }
      const plain = unwrapElement(e) as unknown as ConnectorElement;
      c.frame = computeConnectorFrame(plain, this.slideElementsLookup(s));
    });
  }
```

Add the imports near the existing routing import at the top of the file:

```ts
import { CURVE_BEND_MAX, CURVE_BEND_MIN } from '@wafflebase/slides';
```

If `@wafflebase/slides`'s public entry doesn't re-export them yet, also extend `packages/slides/src/index.ts` to re-export `CURVE_BEND_MAX` and `CURVE_BEND_MIN` from `./view/canvas/routing`.

- [x] **Step 3: Build the frontend bundle to confirm types resolve**

Run: `pnpm slides build && pnpm --filter @wafflebase/frontend build`
Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add packages/frontend/src/app/slides/yorkie-slides-store.ts packages/slides/src/index.ts
git commit -m "Slides yorkie-store: updateConnectorCurveBend + curved cleanup

Production store parity with MemSlidesStore so curveBend round-trips
through Yorkie when collaboration is on. Same clamp + 0.01 rounding."
```

---

## Task 7: Pure bend math — `bendHandlePosition` + `bendFromCursor`

**Files:**
- Create: `packages/slides/src/view/canvas/connector-bend.ts`
- Create: `packages/slides/src/view/canvas/connector-bend.test.ts`

- [x] **Step 1: Write the failing tests**

Create `packages/slides/test/view/canvas/connector-bend.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  bendFromCursor,
  bendHandlePosition,
} from '../../../src/view/canvas/connector-bend';
import type { ConnectorElement } from '../../../src/model/connector';
import type { Element } from '../../../src/model/element';

const EMPTY = new Map<string, Element>();

function curved(start: { x: number; y: number }, end: { x: number; y: number }, curveBend?: number): ConnectorElement {
  return {
    id: 'c1', z: 0, opacity: 1,
    type: 'connector', routing: 'curved',
    start: { kind: 'free', ...start },
    end:   { kind: 'free', ...end },
    arrowheads: {},
    frame: { x: 0, y: 0, w: 0, h: 0, rotation: 0 },
    curveBend,
  } as unknown as ConnectorElement;
}

function elbowZ(): ConnectorElement {
  // Parallel-opposite-facing horizontal exits → Z. Free endpoints, so
  // exit direction is atan2(other - self) → east for `start`, west for `end`.
  return {
    id: 'c2', z: 0, opacity: 1,
    type: 'connector', routing: 'elbow',
    start: { kind: 'free', x: 0,   y: 0   },
    end:   { kind: 'free', x: 200, y: 100 },
    arrowheads: {},
    frame: { x: 0, y: 0, w: 0, h: 0, rotation: 0 },
  } as unknown as ConnectorElement;
}

describe('bendHandlePosition', () => {
  it('curved: returns the bezier midpoint (t=0.5)', () => {
    const c = curved({ x: 0, y: 0 }, { x: 300, y: 0 });
    const p = bendHandlePosition(c, EMPTY);
    expect(p).not.toBeNull();
    // Curved exits both point at the other endpoint (free endpoints),
    // so the chord lies along x; the bezier at t=0.5 lies on the chord.
    expect(p!.x).toBeCloseTo(150, 3);
    expect(p!.y).toBeCloseTo(0, 3);
  });

  it('elbow Z: returns the midpoint of the cross-leg (mid-segment)', () => {
    const p = bendHandlePosition(elbowZ(), EMPTY);
    expect(p).not.toBeNull();
    // Z is [a, p1, p2, b] with p1, p2 sharing x = aPar + (bPar - aPar) * 0.5 = 100.
    expect(p!.x).toBeCloseTo(100, 3);
    expect(p!.y).toBeCloseTo(50, 3);
  });

  it('straight routing: returns null (no bend handle)', () => {
    const c = { ...curved({ x: 0, y: 0 }, { x: 100, y: 0 }), routing: 'straight' as const };
    expect(bendHandlePosition(c, EMPTY)).toBeNull();
  });
});

describe('bendFromCursor', () => {
  it('elbow Z: cursor closer to start endpoint → smaller ratio', () => {
    const c = elbowZ();
    const r = bendFromCursor(c, { x: 50, y: 50 }, EMPTY);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(0.25, 2); // 50 / 200
  });

  it('elbow Z: cursor closer to end endpoint → larger ratio', () => {
    const c = elbowZ();
    const r = bendFromCursor(c, { x: 150, y: 50 }, EMPTY);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(0.75, 2);
  });

  it('curved: cursor pulled perpendicular from chord → larger bend', () => {
    // Chord lies along x (free→free along x-axis). Pulling cursor along
    // +y away from the chord should produce bend > 1.
    const c = curved({ x: 0, y: 0 }, { x: 300, y: 0 });
    const r = bendFromCursor(c, { x: 150, y: 100 }, EMPTY);
    expect(r).not.toBeNull();
    expect(r!).toBeGreaterThan(1);
  });

  it('curved: cursor on the chord → bend ~0.1 (clamped minimum)', () => {
    const c = curved({ x: 0, y: 0 }, { x: 300, y: 0 });
    const r = bendFromCursor(c, { x: 150, y: 0 }, EMPTY);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(0.1, 5);
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @wafflebase/slides test -- connector-bend`
Expected: FAIL — module missing.

- [x] **Step 3: Implement `connector-bend.ts`**

Create `packages/slides/src/view/canvas/connector-bend.ts`:

```ts
import type { ConnectorElement } from '../../model/connector';
import type { Element } from '../../model/element';
import {
  buildConnectorPath,
  resolveEndpoint,
  resolveEndpointWithDir,
} from './connector-frame';
import {
  CURVE_BEND_MAX,
  CURVE_BEND_MIN,
  type BezierPath,
  type Point,
  isBezierPath,
} from './routing';

/**
 * World-space position of the yellow-diamond bend handle for a
 * selected connector, or `null` when the connector's routing /
 * topology has no adjustable bend.
 *
 * Elbow: only the 2-bend Z topology (parallel-opposite-facing exits)
 * exposes a bend handle in v1 — the cross-leg midpoint between the
 * two interior points. L (1-bend), U (3-bend opposite), and C (3-bend
 * same) currently have no routing parameter to drive, so the handle
 * is suppressed there.
 *
 * Curved: always the bezier midpoint (t=0.5).
 */
export function bendHandlePosition(
  connector: ConnectorElement,
  elements: ReadonlyMap<string, Element>,
): Point | null {
  if (connector.routing === 'straight') return null;
  const path = buildConnectorPath(connector, elements);
  if (isBezierPath(path)) {
    return bezierAt(path, 0.5);
  }
  // SegmentPath. The Z topology is exactly 4 points: [a, p1, p2, b];
  // its cross-leg midpoint is (p1 + p2) / 2.
  if (path.points.length !== 4) return null;
  const [, p1, p2] = path.points;
  return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
}

/**
 * Convert a cursor world position into a bend value for the connector.
 * Returns `null` for routings / topologies without an adjustable bend
 * (mirrors `bendHandlePosition`).
 *
 * Elbow Z: project the cursor onto the parallel-axis between the two
 * endpoints, return the [0, 1] ratio. Clamped to (0.05, 0.95) further
 * downstream by `clampBend` inside `routeElbow`.
 *
 * Curved: solve for the bend factor that places the bezier's
 * midpoint at the cursor's perpendicular distance from the chord.
 * `routeCurved` then clamps to [CURVE_BEND_MIN, CURVE_BEND_MAX].
 */
export function bendFromCursor(
  connector: ConnectorElement,
  cursor: Point,
  elements: ReadonlyMap<string, Element>,
): number | null {
  if (connector.routing === 'straight') return null;

  const aPos = resolveEndpoint(connector.start, elements);
  const bPos = resolveEndpoint(connector.end, elements);

  if (connector.routing === 'elbow') {
    // Determine the parallel axis from the Z topology of the rendered
    // path. Anything other than 4 points is L / U / C / degenerate —
    // no bend to compute.
    const path = buildConnectorPath(connector, elements);
    if (isBezierPath(path) || path.points.length !== 4) return null;
    const [, p1, p2] = path.points;
    // Parallel axis is the one shared between p1 and p2.
    const par: 'x' | 'y' = Math.abs(p1.x - p2.x) < Math.abs(p1.y - p2.y) ? 'x' : 'y';
    const aPar = aPos[par];
    const bPar = bPos[par];
    if (Math.abs(bPar - aPar) < 1e-6) return 0.5;
    const ratio = (cursor[par] - aPar) / (bPar - aPar);
    return Math.min(0.95, Math.max(0.05, ratio));
  }

  // Curved.
  const a = resolveEndpointWithDir(connector.start, elements, bPos);
  const b = resolveEndpointWithDir(connector.end, elements, aPos);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-6) return CURVE_BEND_MIN;
  // Chord-perpendicular unit vector. Signed projection of cursor → midpoint
  // perpendicular displacement. `perpHat = (-dy, dx) / dist`.
  const perpHat = { x: -dy / dist, y: dx / dist };
  const midOfChord = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const cdx = cursor.x - midOfChord.x;
  const cdy = cursor.y - midOfChord.y;
  const cursorPerp = cdx * perpHat.x + cdy * perpHat.y;
  // At t=0.5, B(0.5) = 0.125*p0 + 0.375*c1 + 0.375*c2 + 0.125*p1, so the
  // perpendicular component of B(0.5) relative to the chord equals
  // 0.375 * k * (sin α + sin β), where α, β are the exit angles
  // relative to the chord. Solve for k:
  const chordAngle = Math.atan2(dy, dx);
  const sinSum = Math.sin(a.angle - chordAngle) + Math.sin(b.angle - chordAngle);
  if (Math.abs(sinSum) < 1e-3) {
    // Both exits parallel to (or symmetric against) the chord: there's
    // no analytic perpendicular control; just match the cursor distance
    // with bend = |cursorPerp| * 3 / dist as a graceful fallback.
    return Math.min(CURVE_BEND_MAX, Math.max(CURVE_BEND_MIN, Math.abs(cursorPerp) * 3 / dist));
  }
  // 0.375 * k * sinSum = cursorPerp  ⇒  k = cursorPerp / (0.375 * sinSum)
  // bend = k / (dist / 3) = cursorPerp * 8 / (dist * sinSum)
  const bend = (cursorPerp * 8) / (dist * sinSum);
  return Math.min(CURVE_BEND_MAX, Math.max(CURVE_BEND_MIN, bend));
}

function bezierAt(b: BezierPath, t: number): Point {
  const u = 1 - t;
  const u2 = u * u;
  const t2 = t * t;
  return {
    x: u2 * u * b.p0.x + 3 * u2 * t * b.c1.x + 3 * u * t2 * b.c2.x + t2 * t * b.p1.x,
    y: u2 * u * b.p0.y + 3 * u2 * t * b.c1.y + 3 * u * t2 * b.c2.y + t2 * t * b.p1.y,
  };
}
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @wafflebase/slides test -- connector-bend`
Expected: PASS — all 7 cases green.

- [x] **Step 5: Commit**

```bash
git add packages/slides/src/view/canvas/connector-bend.ts \
  packages/slides/test/view/canvas/connector-bend.test.ts
git commit -m "Slides connectors: pure bend helpers for handle + drag math

bendHandlePosition: where the yellow diamond paints (bezier midpoint
for curved, cross-leg midpoint for Z-routed elbow, null elsewhere).
bendFromCursor: solve the routing-specific bend value that places the
midpoint under the cursor — analytic for both topologies, with
clamping that matches the routing-side defaults so the handle never
drives the connector through a degenerate state."
```

---

## Task 8: Add `'bend'` to `HandleKind` + hit-test

**Files:**
- Modify: `packages/slides/src/view/editor/hit-test.ts`

- [x] **Step 1: Extend `HandleKind` and the accepted-string list**

Edit `packages/slides/src/view/editor/hit-test.ts`:

```ts
export type ConnectorBendHandle = 'bend';
export type ConnectorEndpointHandle = 'start' | 'end';
export type HandleKind =
  | ResizeHandle
  | 'rotate'
  | AdjustmentHandleKind
  | ConnectorEndpointHandle
  | ConnectorBendHandle;
```

And in `isHandleKind` extend the disjunction:

```ts
const CONNECTOR_HANDLES: readonly string[] = ['start', 'end', 'bend'];

function isHandleKind(value: string | undefined): value is HandleKind {
  return (
    value !== undefined &&
    (RESIZE_HANDLES.includes(value) ||
      CONNECTOR_HANDLES.includes(value) ||
      /^adjust-\d+$/.test(value))
  );
}
```

(Remove the now-unused `CONNECTOR_ENDPOINT_HANDLES` const.)

- [x] **Step 2: Run the slides test suite to confirm no regression**

Run: `pnpm --filter @wafflebase/slides test`
Expected: PASS — existing handle hit-tests still pass; new kind is just additive.

- [x] **Step 3: Commit**

```bash
git add packages/slides/src/view/editor/hit-test.ts
git commit -m "Slides editor: HandleKind gains 'bend' for connector bend drag

Single shared kind covers both elbow Z bend handle and curved
midpoint handle — the dispatch routing in editor.ts inspects the
selected connector's routing to pick the commit path."
```

---

## Task 9: Render the bend handle in the selection overlay

**Files:**
- Modify: `packages/slides/src/view/editor/overlay.ts`

- [x] **Step 1: Extend `renderConnectorEndpointHandles` to paint the bend handle**

Edit `packages/slides/src/view/editor/overlay.ts`. Add the import at the top with the existing connector-frame import:

```ts
import { bendHandlePosition } from '../canvas/connector-bend';
```

Update `renderConnectorEndpointHandles` (around `overlay.ts:358`) so it also appends the bend handle:

```ts
function renderConnectorEndpointHandles(
  overlay: HTMLDivElement,
  connector: ConnectorElement,
  options: OverlayOptions,
): void {
  const { scale, allElements } = options;
  const map = buildElementWorldLookup(allElements ?? []);
  const a = resolveEndpoint(connector.start, map);
  const b = resolveEndpoint(connector.end, map);
  overlay.appendChild(
    makeEndpointHandle('start', connector.start, a.x * scale, a.y * scale),
  );
  overlay.appendChild(
    makeEndpointHandle('end', connector.end, b.x * scale, b.y * scale),
  );

  // Yellow-diamond bend handle for routings that expose an adjustable
  // bend. `bendHandlePosition` returns null for straight + elbow
  // topologies without a bend parameter (L / U / C), so the handle
  // simply doesn't paint there.
  const bend = bendHandlePosition(connector, map);
  if (bend) {
    overlay.appendChild(
      makeBendHandle(bend.x * scale, bend.y * scale),
    );
  }
}

function makeBendHandle(cx: number, cy: number): HTMLDivElement {
  const el = document.createElement('div');
  el.dataset.handle = 'bend';
  el.className = 'wfb-slides-handle wfb-slides-bend';
  el.style.position = 'absolute';
  el.style.left = `${cx - ADJUST_HANDLE_SIZE / 2}px`;
  el.style.top  = `${cy - ADJUST_HANDLE_SIZE / 2}px`;
  el.style.width  = `${ADJUST_HANDLE_SIZE}px`;
  el.style.height = `${ADJUST_HANDLE_SIZE}px`;
  el.style.background = '#FFD500';
  el.style.border = '1px solid #000';
  el.style.transform = 'rotate(45deg)';
  el.style.cursor = 'move';
  return el;
}
```

- [x] **Step 2: Manual smoke (deferred to Task 12) — confirm build is clean**

Run: `pnpm slides build`
Expected: PASS.

- [x] **Step 3: Commit**

```bash
git add packages/slides/src/view/editor/overlay.ts
git commit -m "Slides overlay: yellow-diamond bend handle for selected connector

Renders alongside the two endpoint handles when bendHandlePosition
returns a point — curved at the bezier midpoint, elbow Z at the
cross-leg midpoint, suppressed everywhere else. Visual matches the
shape adjustment handle (8px yellow diamond, black 1px border) so
the affordance stays consistent across the editor."
```

---

## Task 10: `commitBend` drag-handler scaffold

**Files:**
- Create: `packages/slides/src/view/editor/interactions/bend-drag.ts`

- [x] **Step 1: Implement the single-call commit helper**

Create `packages/slides/src/view/editor/interactions/bend-drag.ts`:

```ts
import type { ConnectorElement } from '../../../model/connector';
import type { SlidesStore } from '../../../store/store';

/**
 * Commit a bend value to a connector through the store, choosing the
 * right method based on routing. Caller is responsible for wrapping
 * in `store.batch(...)` so undo treats the whole drag as one op.
 *
 * Straight connectors are no-ops — `bendFromCursor` returns `null`
 * before we ever get here, so this path is defensive only.
 */
export function commitBend(
  store: SlidesStore,
  slideId: string,
  connector: ConnectorElement,
  bend: number,
): void {
  if (connector.routing === 'elbow') {
    store.updateConnectorElbowBend(slideId, connector.id, bend);
  } else if (connector.routing === 'curved') {
    store.updateConnectorCurveBend(slideId, connector.id, bend);
  }
}
```

- [x] **Step 2: Run typecheck**

Run: `pnpm slides build`
Expected: PASS.

- [x] **Step 3: Commit**

```bash
git add packages/slides/src/view/editor/interactions/bend-drag.ts
git commit -m "Slides interactions: commitBend per-routing dispatch

Mirrors dragEndpoint's pattern — one entry point for the editor to
call inside its drag's mouseup batch, routing to the right store
method without leaking topology decisions into editor.ts."
```

---

## Task 11: Wire `'bend'` dispatch + `startBendDrag` in the editor

**Files:**
- Modify: `packages/slides/src/view/editor/editor.ts`

- [x] **Step 1: Dispatch `'bend'` in `onPointerDownHandle`**

Edit `packages/slides/src/view/editor/editor.ts`. Find `onPointerDownHandle` (around `editor.ts:4615`) and insert a branch above the `adjust-` block:

```ts
    if (handle === 'bend') {
      this.startBendDrag(clientX, clientY);
      return;
    }
```

- [x] **Step 2: Implement `startBendDrag`**

Add the method directly after `startAdjustmentDrag` (around `editor.ts:4876`). It mirrors the endpoint-drag pattern: live ghost paint each move, single batched commit on up.

```ts
  private startBendDrag(clientX: number, clientY: number): void {
    const startSlide = this.currentSlide();
    if (!startSlide) return;
    const selectedIds = this.selection.get();
    if (selectedIds.length !== 1) return;
    const elementId = selectedIds[0];
    const startEl = startSlide.elements.find((e) => e.id === elementId);
    if (!startEl || startEl.type !== 'connector') return;
    const startConnector = startEl;
    const slideId = startSlide.id;

    const lookup = buildElementWorldLookup(startSlide.elements);
    let liveBend: number | null = null;
    let moved = false;
    const startCursor = this.clientToLogical(clientX, clientY);

    const paintLive = () => {
      if (liveBend === null) return;
      const ghost = startConnector.routing === 'elbow'
        ? { ...startConnector, elbowBend: liveBend }
        : { ...startConnector, curveBend: liveBend };
      this.renderer.forceRender(
        startSlide,
        this.options.store.read(),
        [ghost],
      );
      const selected = startSlide.elements.filter((e) =>
        this.selection.has(e.id),
      );
      renderOverlay(this.options.overlay, selected, {
        scale: this.scale(),
        slideWidth: SLIDE_WIDTH,
        slideHeight: SLIDE_HEIGHT,
        allElements: startSlide.elements,
      });
    };

    const onMove = (ev: MouseEvent) => {
      const cur = this.clientToLogical(ev.clientX, ev.clientY);
      if (!moved) {
        const dx = cur.x - startCursor.x;
        const dy = cur.y - startCursor.y;
        const threshold = CONNECTOR_MIN_DRAG_DISTANCE / this.scale();
        if (dx * dx + dy * dy < threshold * threshold) return;
        moved = true;
      }
      const next = bendFromCursor(startConnector, cur, lookup);
      if (next === null) return;
      liveBend = next;
      paintLive();
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      if (!moved || liveBend === null) return;
      const value = liveBend;
      this.options.store.batch(() => {
        commitBend(this.options.store, slideId, startConnector, value);
      });
      this.renderer.markDirty();
      this.render();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }
```

Add the imports near the top of `editor.ts`:

```ts
import { bendFromCursor } from '../canvas/connector-bend';
import { commitBend } from './interactions/bend-drag';
```

- [x] **Step 3: Confirm build + tests**

Run: `pnpm slides build && pnpm --filter @wafflebase/slides test`
Expected: PASS — no regression in editor tests; new code is reachable only through `'bend'` handle.

- [x] **Step 4: Commit**

```bash
git add packages/slides/src/view/editor/editor.ts
git commit -m "Slides editor: startBendDrag wires the yellow-diamond handle

Live ghost paint on each move (mirrors endpoint-drag), batched store
write on mouseup so undo treats the whole drag as one op. Routes
through bendFromCursor + commitBend so per-topology logic stays in
the pure helpers, not the editor."
```

---

## Task 12: Verify and document

**Files:**
- Modify: `docs/design/slides/slides-connectors.md`

- [x] **Step 1: Update the PR2 status note + curved-bend section**

In `docs/design/slides/slides-connectors.md` find the status note (around line 495) and flip:

```markdown
> Status (2026-06-12): elbow yellow-diamond bend handle shipped for
> the Z (parallel-opposite-facing) topology. L / U / C topologies
> currently expose no routing parameter to drive — bend handle is
> suppressed there. Curved-routing bend handle shipped in parallel
> with a `curveBend` field on `ConnectorElement` that scales the
> control-point distance symmetrically (default 1, clamped [0.1, 3]).
> Tracking: `docs/tasks/active/20260612-slides-connector-bend-handles-todo.md`.
```

In section "5. Editor Interactions" → "Elbow handle", append a new "Curved handle" subsection:

```markdown
**Curved handle**: single yellow-diamond handle at the bezier midpoint
(t=0.5). Dragging perpendicular to the chord updates `curveBend`, a
scalar multiplier on the auto control-point distance. Default 1,
stored only when the user has dragged the handle, clamped to [0.1, 3]
so an extreme value cannot blow the curve into a self-intersecting
loop. Routing change away from `'curved'` clears the field in both
`MemSlidesStore` and `YorkieSlidesStore`, matching the elbow cleanup.
```

In section "1. Element Model", append `curveBend?` to the listed `ConnectorElement` fields with the same one-line comment.

- [x] **Step 2: Run the full pre-commit gate**

Run: `pnpm verify:fast`
Expected: PASS — lint + unit tests across packages.

- [x] **Step 3: Manual smoke**

Run: `pnpm dev`. In a slide:
- Insert a curved connector between two shapes. Confirm a yellow diamond appears at the curve midpoint. Drag it perpendicular to the chord — curve flattens / exaggerates smoothly. Click off, reselect — handle reappears at the new midpoint.
- Insert an elbow connector and arrange the endpoints so it routes as a Z (e.g. start east-facing, end west-facing, overlapping on x). Confirm a yellow diamond appears on the cross-leg; drag along the parallel axis — cross-leg slides. Endpoints stay fixed.
- Insert an elbow connector that routes as an L (perpendicular exits) or U / C — confirm NO bend handle paints; selection still shows the two endpoint handles.
- Switch routing via right-click menu between straight / elbow / curved on a connector with a stored bend — confirm the stored bend clears on each transition out and the connector reverts to the topology default.

- [x] **Step 4: Commit + push + open PR**

```bash
git add docs/design/slides/slides-connectors.md \
  docs/tasks/active/20260612-slides-connector-bend-handles-todo.md
git commit -m "Slides connectors: PR2 status + curved-bend design

Flip the slides-connectors.md status note to reflect the yellow-
diamond bend handle landing for both elbow Z and curved routings,
and document the curveBend field + clamp range alongside the
existing elbowBend reference."
```

Then `git push -u origin <branch>` and open the PR per `CLAUDE.md` workflow.

---

## Risks

| Risk | Mitigation |
|---|---|
| Curved-bend analytic solve degenerates when both exits run parallel to the chord (`sinSum ≈ 0`). | Helper falls back to `bend = \|cursorPerp\| * 3 / dist` so the handle still tracks the cursor — clamped by `routeCurved` itself, never produces NaN. |
| User drags the bend handle past the chord on a curved connector, expecting the curve to flip to the other side. | `routeCurved` keeps exit angles fixed (tangents at endpoints), so the curve cannot mirror across the chord without changing the angles. Cursor crossing the chord clamps `bend` to `CURVE_BEND_MIN`; the curve flattens but does not invert. Acceptable v1 limitation; a future "flip" affordance can be added under a separate task. |
| Yorkie-store change without a matching schema migration breaks attached docs. | `curveBend` is an additive optional field — Yorkie tolerates missing fields on read; existing connector docs simply rehydrate with `curveBend === undefined` and use the auto-routed look. No migration needed. |
| Elbow Z bend handle paints, but on the same connector a routing-change to L silently hides it without feedback. | Acceptable — handle disappears, selection still has the two endpoint handles. Right-click menu remains the canonical way to inspect routing. |

## Self-Review Checklist

- [x] Every task lists exact file paths.
- [x] Every step has either complete code or an exact command + expected output.
- [x] No placeholders (no TBD / TODO / "similar to above").
- [x] Type names referenced in later tasks (`ConnectorElement.curveBend`, `CURVE_BEND_MIN/MAX`, `'bend'` handle kind, `bendHandlePosition`, `bendFromCursor`, `commitBend`) all defined in earlier tasks.
- [x] Spec coverage: elbow Z handle, curved handle, Mem + Yorkie store parity, hit-test, overlay, drag, design-doc update — all have a task.

## Review

Shipped end-to-end in `66e1505f` (#357). Yellow-diamond bend handle
lands for both elbow Z (drives existing `elbowBend`) and curved (new
`curveBend?: number` on `ConnectorElement`, default 1, clamped [0.1,
3]). Layering matches the plan: pure helpers (`connector-bend.ts`)
own the position + cursor-to-bend math, `bend-drag.ts` dispatches per
routing through the store, and `startBendDrag` mirrors the
endpoint-drag pattern (live ghost paint + single batched commit on
mouseup). Routing change away from `'curved'` clears `curveBend` in
both `MemSlidesStore` and `YorkieSlidesStore`, symmetric with the
existing elbow cleanup. Design doc PR2 status note flipped to
shipped; curved-bend section added.
