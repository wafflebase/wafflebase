# Slides Connectors PR1 — Foundation + Straight/Arrow

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Design doc:** [slides-connectors.md](../../design/slides/slides-connectors.md)

**Goal:** Replace bbox-based `line` / `arrow` shape kinds with a new
`ConnectorElement` whose geometry is two endpoints (free or attached
to a shape's connection site), wire up default 4-cardinal connection
sites, straight routing, the Line + Arrow toolbar tools with
snap-on-draw UX, and the cascade sweep that converts attached
endpoints to free when their source shape is deleted.

**Architecture:** `ConnectorElement` extends `ElementBase` (so it
participates in selection / z-order / hit-test like any other
element); the `frame` field is a **derived bbox cache** computed by
`computeConnectorFrame(connector, slideElements)` whenever endpoints
change or an attached source shape moves. Endpoints are a
discriminated union `Endpoint = { kind: 'free', x, y } | { kind:
'attached', elementId, siteIndex }`. Connection sites resolve via
`getConnectionSites(element)` which returns the default 4-cardinal
set for PR1; per-shape overrides arrive in PR2. Routing is a pure
function `routeStraight(a, b): SegmentPath` for PR1. Arrowheads are
per-endpoint `{ kind: 'triangle', size: 'md' }` for PR1; expanded in
PR3.

**Tech Stack:** TypeScript, Vitest (unit), Canvas 2D (rendering),
React (DOM overlay in `view/editor/overlay.ts`).

---

## File Structure

**New files:**
- `packages/slides/src/model/connector.ts` — types
  (`Endpoint`, `ConnectorElement`, `ArrowheadStyle`,
  `ConnectorRouting`)
- `packages/slides/src/model/connection-site.ts` — `ConnectionSite`
  type + cardinal direction constants
- `packages/slides/src/view/canvas/routing.ts` — pure routing
  functions
- `packages/slides/src/view/canvas/routing.test.ts`
- `packages/slides/src/view/canvas/connection-sites/index.ts` —
  `getConnectionSites`, `siteWorldPos`
- `packages/slides/src/view/canvas/connection-sites/defaults.ts`
- `packages/slides/src/view/canvas/connection-sites/connection-sites.test.ts`
- `packages/slides/src/view/canvas/connector-renderer.ts`
- `packages/slides/src/view/canvas/connector-renderer.test.ts`
- `packages/slides/src/view/canvas/arrowhead-renderer.ts`
- `packages/slides/src/view/canvas/arrowhead-renderer.test.ts`
- `packages/slides/src/view/canvas/connector-frame.ts` —
  `computeConnectorFrame` (bbox cache)
- `packages/slides/src/view/canvas/connector-frame.test.ts`
- `packages/slides/src/view/editor/interactions/insert-connector.ts`
- `packages/slides/src/view/editor/interactions/connector-endpoint-drag.ts`

**Modified files:**
- `packages/slides/src/model/element.ts` — add `ConnectorElement` to
  `Element` union and `ElementInit`; remove `'line'` / `'arrow'`
  from `ShapeKind`
- `packages/slides/src/store/store.ts` — add connector method
  signatures
- `packages/slides/src/store/memory.ts` — implement connector
  methods + cascade sweep in `removeElement`
- `packages/slides/src/store/memory.test.ts` — connector store tests
- `packages/slides/src/view/canvas/element-renderer.ts` — dispatch
  `'connector'` type
- `packages/slides/src/view/canvas/shape-renderer.ts` — drop
  `line`/`arrow` branches
- `packages/slides/src/view/canvas/shape-special.ts` — drop
  `drawLine` / `drawArrow`
- `packages/slides/src/view/editor/interactions/insert.ts` — drop
  `'line'` / `'arrow'` from `DEFAULT_INSERT_SIZE` and shape-insert
  paths
- `packages/slides/src/view/editor/editor.ts` — register the
  connector interactions; expose `setInsertMode('connector', { ... })`
- `packages/slides/src/view/editor/overlay.ts` — render connection-
  points overlay when in connector insert/endpoint-drag mode

---

## Notes

- Test files are **colocated** next to the source file
  (`foo.ts` ↔ `foo.test.ts`), matching the existing pattern (see
  `view/canvas/shape-renderer.test.ts`, etc.).
- `pnpm verify:fast` must pass after each commit.
- Commit subjects ≤70 chars, English, present tense (`Add
  ConnectorElement model`, not `Added`).
- Each commit is one logical chunk; multiple steps may combine into
  one commit when they form a coherent unit (e.g. type + its tests).

---

### Task 1: ConnectorElement model types (purely additive)

**Files:**
- Create: `packages/slides/src/model/connector.ts`
- Modify: `packages/slides/src/model/element.ts`
- Modify (as needed): any file with an exhaustive switch on
  `el.type` that fails to compile after the union extension

**Scope note (correction from initial plan):** Task 1 is purely
additive — it does **not** remove `'line'` / `'arrow'` from
`ShapeKind`. Those literals are referenced by production code (e.g.
`shape-renderer.ts`, `shape-icon.ts`, `insert.ts`) and several test
files (`shape-renderer.test.ts`, `shape-icon.test.ts`,
`insert.test.ts`). Removing them in Task 1 would break `verify:fast`
immediately. Task 10 owns the `ShapeKind` removal together with all
the call-site and test-file cleanup it triggers.

- [ ] **Step 1.1: Write `connector.ts` with all types**

```ts
// packages/slides/src/model/connector.ts
import type { ElementBase, ShapeStroke } from './element';

export type Endpoint =
  | { kind: 'free'; x: number; y: number }
  | { kind: 'attached'; elementId: string; siteIndex: number };

export type ConnectorRouting = 'straight' | 'elbow' | 'curved';

export type ArrowheadKind =
  | 'triangle' | 'triangle-open'
  | 'diamond'  | 'diamond-open'
  | 'circle'   | 'circle-open'
  | 'square'   | 'square-open';

export type ArrowheadStyle = {
  kind: ArrowheadKind;
  size: 'sm' | 'md' | 'lg';
};

export type ConnectorElement = ElementBase & {
  type: 'connector';
  routing: ConnectorRouting;
  start: Endpoint;
  end: Endpoint;
  arrowheads: { start?: ArrowheadStyle; end?: ArrowheadStyle };
  stroke?: ShapeStroke;
  /** Present only when the user manually dragged the elbow handle. */
  elbowBend?: number;
};
```

- [ ] **Step 1.2: Update `element.ts` to include connector**

Open `packages/slides/src/model/element.ts`. Leave `ShapeKind` as
it is (still contains `'line' | 'arrow'` for now — Task 10 removes
them along with the dependent call-sites and tests).

Around line 138 where `Element` is defined, extend the union and
`ElementInit`:

```ts
import type { ConnectorElement } from './connector';

// ... existing types ...

export type Element =
  | TextElement
  | ImageElement
  | ShapeElement
  | ConnectorElement;

export type ElementInit =
  | Omit<TextElement, 'id'>
  | Omit<ImageElement, 'id'>
  | Omit<ShapeElement, 'id'>
  | Omit<ConnectorElement, 'id'>;
```

- [ ] **Step 1.3: Resolve exhaustive-switch compile errors**

Run: `pnpm --filter @wafflebase/slides exec tsc --noEmit`

Inspect each error. Each one will be a switch / type-narrowing site
that expected `el.type` to be one of the existing 3 values. For
each such site, add a minimal stub branch that throws:

```ts
case 'connector':
  throw new Error('connector rendering not implemented yet (PR1 Task N)');
```

Pick the right Task number per location:
- `element-renderer.ts` → "Task 9"
- `selection.ts` → "Task 12"
- `overlay.ts` → "Task 13"
- anywhere else → "later in PR1"

If a site uses an `if (el.type === '…') / else if` chain rather
than a switch, add an analogous unreachable branch. Goal: `tsc`
passes with **zero errors**. Do NOT add eslint-disable comments;
do NOT implement real behavior; do NOT touch test files.

- [ ] **Step 1.4: Verify `pnpm verify:fast` is green**

Existing tests should all still pass — Task 1 is purely additive,
no behavior changes.

- [ ] **Step 1.5: Commit**

```bash
git add packages/slides/src/model/connector.ts \
        packages/slides/src/model/element.ts \
        packages/slides/src/view/   # only for the unreachable stubs
git commit -m "Add ConnectorElement type to slides element union"
```

---

### Task 2: ConnectionSite type + 4-cardinal defaults

**Files:**
- Create: `packages/slides/src/model/connection-site.ts`
- Create: `packages/slides/src/view/canvas/connection-sites/defaults.ts`
- Create: `packages/slides/src/view/canvas/connection-sites/index.ts`
- Create: `packages/slides/src/view/canvas/connection-sites/connection-sites.test.ts`

- [ ] **Step 2.1: Write `connection-site.ts`**

```ts
// packages/slides/src/model/connection-site.ts
export type ConnectionSite = {
  /** Normalized [0, 1], pre-rotation, in the source element's local bbox. */
  x: number;
  /** Normalized [0, 1], pre-rotation. */
  y: number;
  /** Outward normal angle in radians (canvas convention: 0 = +x). */
  angle: number;
};

/** Outward-normal direction constants (canvas convention). */
export const DIR_E = 0;
export const DIR_S = Math.PI / 2;
export const DIR_W = Math.PI;
export const DIR_N = -Math.PI / 2;
```

- [ ] **Step 2.2: Write `defaults.ts`**

```ts
// packages/slides/src/view/canvas/connection-sites/defaults.ts
import type { ConnectionSite } from '../../../model/connection-site';
import { DIR_E, DIR_N, DIR_S, DIR_W } from '../../../model/connection-site';

/** N / E / S / W mid-edge connection points, in fixed order. */
export const FOUR_CARDINAL: readonly ConnectionSite[] = Object.freeze([
  Object.freeze({ x: 0.5, y: 0,   angle: DIR_N }),  // 0: N
  Object.freeze({ x: 1,   y: 0.5, angle: DIR_E }),  // 1: E
  Object.freeze({ x: 0.5, y: 1,   angle: DIR_S }),  // 2: S
  Object.freeze({ x: 0,   y: 0.5, angle: DIR_W }),  // 3: W
]) as readonly ConnectionSite[];

export function fourCardinal(): readonly ConnectionSite[] {
  return FOUR_CARDINAL;
}
```

- [ ] **Step 2.3: Write `index.ts` (registry + `siteWorldPos`)**

```ts
// packages/slides/src/view/canvas/connection-sites/index.ts
import type { Element, Frame } from '../../../model/element';
import type { ConnectionSite } from '../../../model/connection-site';
import { fourCardinal } from './defaults';

/**
 * Connection sites for an element. PR1 always returns the
 * 4-cardinal default; PR2 introduces per-ShapeKind overrides.
 */
export function getConnectionSites(_el: Element): readonly ConnectionSite[] {
  return fourCardinal();
}

/**
 * World-space position and outward-normal angle of a connection
 * site on `el`. `el.frame` is in slide-logical coordinates.
 */
export function siteWorldPos(
  el: { frame: Frame },
  site: ConnectionSite,
): { x: number; y: number; angle: number } {
  const lx = site.x * el.frame.w;
  const ly = site.y * el.frame.h;
  const cx = el.frame.w / 2;
  const cy = el.frame.h / 2;
  const r = el.frame.rotation;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const rx = cos * (lx - cx) - sin * (ly - cy) + cx;
  const ry = sin * (lx - cx) + cos * (ly - cy) + cy;
  return {
    x: el.frame.x + rx,
    y: el.frame.y + ry,
    angle: site.angle + r,
  };
}
```

- [ ] **Step 2.4: Write failing tests**

```ts
// packages/slides/src/view/canvas/connection-sites/connection-sites.test.ts
import { describe, expect, it } from 'vitest';
import { fourCardinal } from './defaults';
import { siteWorldPos } from './index';

describe('fourCardinal', () => {
  it('returns 4 sites in N, E, S, W order', () => {
    const sites = fourCardinal();
    expect(sites).toHaveLength(4);
    expect(sites[0]).toMatchObject({ x: 0.5, y: 0 });    // N
    expect(sites[1]).toMatchObject({ x: 1,   y: 0.5 });  // E
    expect(sites[2]).toMatchObject({ x: 0.5, y: 1 });    // S
    expect(sites[3]).toMatchObject({ x: 0,   y: 0.5 });  // W
  });
});

describe('siteWorldPos', () => {
  const frame = { x: 100, y: 200, w: 200, h: 100, rotation: 0 };

  it('with rotation=0: returns local-projected world coords', () => {
    const e = siteWorldPos({ frame }, { x: 1, y: 0.5, angle: 0 });
    expect(e.x).toBeCloseTo(300);
    expect(e.y).toBeCloseTo(250);
    expect(e.angle).toBeCloseTo(0);
  });

  it('with 90° rotation: E site rotates to S side', () => {
    const rotated = { ...frame, rotation: Math.PI / 2 };
    // E site local = (200, 50); local center = (100, 50); vector from
    // center = (100, 0). Canvas convention rotates +π/2 mapping
    // (x,y) → (x·cos − y·sin, x·sin + y·cos), so (100, 0) → (0, 100).
    // Add center → local (100, 150) → world (200, 350).
    const e = siteWorldPos({ frame: rotated }, { x: 1, y: 0.5, angle: 0 });
    expect(e.x).toBeCloseTo(200);
    expect(e.y).toBeCloseTo(350);
    expect(e.angle).toBeCloseTo(Math.PI / 2);
  });

  it('with 180° rotation: position mirrors through center', () => {
    const rotated = { ...frame, rotation: Math.PI };
    const e = siteWorldPos({ frame: rotated }, { x: 1, y: 0.5, angle: 0 });
    // E (300, 250) flips through center (200, 250) → (100, 250)
    expect(e.x).toBeCloseTo(100);
    expect(e.y).toBeCloseTo(250);
    expect(e.angle).toBeCloseTo(Math.PI);
  });
});
```

- [ ] **Step 2.5: Run tests, verify pass**

```bash
pnpm --filter @wafflebase/slides test -- connection-sites
```

Expected: all 4 tests pass.

- [ ] **Step 2.6: Commit**

```bash
git add packages/slides/src/model/connection-site.ts \
        packages/slides/src/view/canvas/connection-sites/
git commit -m "Add ConnectionSite type and 4-cardinal default registry"
```

---

### Task 3: routeStraight pure function

**Files:**
- Create: `packages/slides/src/view/canvas/routing.ts`
- Create: `packages/slides/src/view/canvas/routing.test.ts`

- [ ] **Step 3.1: Write failing test**

```ts
// packages/slides/src/view/canvas/routing.test.ts
import { describe, expect, it } from 'vitest';
import { routeStraight } from './routing';

describe('routeStraight', () => {
  it('produces a 2-point segment from a to b', () => {
    const p = routeStraight({ x: 0, y: 0 }, { x: 100, y: 50 });
    expect(p.points).toEqual([{ x: 0, y: 0 }, { x: 100, y: 50 }]);
  });

  it('handles zero-length (coincident endpoints)', () => {
    const p = routeStraight({ x: 5, y: 5 }, { x: 5, y: 5 });
    expect(p.points).toEqual([{ x: 5, y: 5 }, { x: 5, y: 5 }]);
  });
});
```

- [ ] **Step 3.2: Run test, verify it fails**

```bash
pnpm --filter @wafflebase/slides test -- routing
```

Expected: `Cannot find module './routing'`.

- [ ] **Step 3.3: Implement**

```ts
// packages/slides/src/view/canvas/routing.ts
export type Point = { x: number; y: number };
export type SegmentPath = { points: Point[] };

export function routeStraight(a: Point, b: Point): SegmentPath {
  return { points: [{ ...a }, { ...b }] };
}
```

- [ ] **Step 3.4: Run, verify pass**

- [ ] **Step 3.5: Commit**

```bash
git add packages/slides/src/view/canvas/routing.ts \
        packages/slides/src/view/canvas/routing.test.ts
git commit -m "Add routeStraight in slides routing module"
```

---

### Task 4: computeConnectorFrame helper

The connector's `frame` is the bbox of its routed path, expanded by
stroke width. It's a derived cache the store maintains.

**Files:**
- Create: `packages/slides/src/view/canvas/connector-frame.ts`
- Create: `packages/slides/src/view/canvas/connector-frame.test.ts`

- [ ] **Step 4.1: Write failing tests**

```ts
// packages/slides/src/view/canvas/connector-frame.test.ts
import { describe, expect, it } from 'vitest';
import type { ConnectorElement } from '../../model/connector';
import type { Element } from '../../model/element';
import { computeConnectorFrame } from './connector-frame';

const baseConnector = (
  start: ConnectorElement['start'],
  end: ConnectorElement['end'],
): ConnectorElement => ({
  id: 'c1',
  type: 'connector',
  routing: 'straight',
  start, end,
  arrowheads: {},
  frame: { x: 0, y: 0, w: 0, h: 0, rotation: 0 },
  stroke: { color: { kind: 'role', role: 'text' }, width: 2 },
});

describe('computeConnectorFrame', () => {
  it('free-free: bbox of two endpoints + stroke padding', () => {
    const c = baseConnector(
      { kind: 'free', x: 100, y: 50 },
      { kind: 'free', x: 400, y: 200 },
    );
    const f = computeConnectorFrame(c, new Map());
    // bbox is (100, 50)-(400, 200); padding = stroke/2 = 1 each side.
    expect(f.x).toBeCloseTo(99);
    expect(f.y).toBeCloseTo(49);
    expect(f.w).toBeCloseTo(302);
    expect(f.h).toBeCloseTo(152);
    expect(f.rotation).toBe(0);
  });

  it('attached: resolves via lookup map then bboxes', () => {
    const target: Element = {
      id: 't1', type: 'shape',
      frame: { x: 200, y: 100, w: 100, h: 100, rotation: 0 },
      data: { kind: 'rect' },
    };
    const c = baseConnector(
      { kind: 'free', x: 0, y: 0 },
      { kind: 'attached', elementId: 't1', siteIndex: 1 },  // E of target
    );
    const lookup = new Map<string, Element>([['t1', target]]);
    const f = computeConnectorFrame(c, lookup);
    // Endpoints: (0,0) and target-E = (300, 150).
    expect(f.x).toBeCloseTo(-1);
    expect(f.y).toBeCloseTo(-1);
    expect(f.w).toBeCloseTo(302);
    expect(f.h).toBeCloseTo(152);
  });

  it('attached to deleted element: falls back to (0,0)', () => {
    const c = baseConnector(
      { kind: 'attached', elementId: 'gone', siteIndex: 0 },
      { kind: 'free', x: 50, y: 50 },
    );
    const f = computeConnectorFrame(c, new Map());
    expect(f.x).toBeCloseTo(-1);
    expect(f.y).toBeCloseTo(-1);
    expect(f.w).toBeCloseTo(52);
    expect(f.h).toBeCloseTo(52);
  });
});
```

- [ ] **Step 4.2: Run test, verify it fails**

- [ ] **Step 4.3: Implement**

```ts
// packages/slides/src/view/canvas/connector-frame.ts
import type { ConnectorElement, Endpoint } from '../../model/connector';
import type { Element, Frame } from '../../model/element';
import { getConnectionSites, siteWorldPos } from './connection-sites';
import type { Point } from './routing';

export function resolveEndpoint(
  ep: Endpoint,
  elements: ReadonlyMap<string, Element>,
): Point {
  if (ep.kind === 'free') return { x: ep.x, y: ep.y };
  const target = elements.get(ep.elementId);
  if (!target) return { x: 0, y: 0 };
  const sites = getConnectionSites(target);
  const site = sites[ep.siteIndex] ?? sites[0];
  const w = siteWorldPos(target, site);
  return { x: w.x, y: w.y };
}

export function computeConnectorFrame(
  connector: ConnectorElement,
  elements: ReadonlyMap<string, Element>,
): Frame {
  const a = resolveEndpoint(connector.start, elements);
  const b = resolveEndpoint(connector.end, elements);
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxX = Math.max(a.x, b.x);
  const maxY = Math.max(a.y, b.y);
  const pad = (connector.stroke?.width ?? 1) / 2;
  return {
    x: minX - pad,
    y: minY - pad,
    w: (maxX - minX) + pad * 2,
    h: (maxY - minY) + pad * 2,
    rotation: 0,
  };
}
```

- [ ] **Step 4.4: Run, verify pass**

- [ ] **Step 4.5: Commit**

```bash
git add packages/slides/src/view/canvas/connector-frame.ts \
        packages/slides/src/view/canvas/connector-frame.test.ts
git commit -m "Add computeConnectorFrame deriving bbox from endpoints"
```

---

### Task 5: SlidesStore connector interface

**Files:**
- Modify: `packages/slides/src/store/store.ts`

- [ ] **Step 5.1: Edit store.ts**

In `SlidesStore` interface, after the existing `reorderElement`
method, **insert**:

```ts
  // --- connector-level ---

  /** Update an endpoint of an existing connector. */
  updateConnectorEndpoint(
    slideId: string,
    elementId: string,
    side: 'start' | 'end',
    endpoint: import('../model/connector').Endpoint,
  ): void;

  /** Replace a connector's arrowhead styles. Pass `null` per side to clear. */
  updateConnectorArrowheads(
    slideId: string,
    elementId: string,
    heads: {
      start?: import('../model/connector').ArrowheadStyle | null;
      end?:   import('../model/connector').ArrowheadStyle | null;
    },
  ): void;
```

(Connector creation goes through `addElement(slideId, init)` —
`ConnectorElement` is part of `ElementInit` via the union extension
in Task 1.)

- [ ] **Step 5.2: TypeScript should now flag unimplemented store
  methods**

Run: `pnpm --filter @wafflebase/slides exec tsc --noEmit`
Expected: `MemSlidesStore` is missing the new methods. **Note the
file/line** — Task 6 implements them.

- [ ] **Step 5.3: Commit (separately for clean review history)**

```bash
git add packages/slides/src/store/store.ts
git commit -m "Add connector mutation methods to SlidesStore interface"
```

---

### Task 6: MemSlidesStore connector implementation

**Files:**
- Modify: `packages/slides/src/store/memory.ts`
- Modify: `packages/slides/src/store/memory.test.ts`

- [ ] **Step 6.1: Read existing memory.ts to find where
  `updateElementFrame` lives**

```bash
grep -n "updateElementFrame\|removeElement\|recordHistory\|batch" \
  packages/slides/src/store/memory.ts | head -20
```

Patterns to mirror: every mutation pushes an inverse to undo
history (look for the project's existing helper, e.g.
`pushHistory(...)`); operations on missing slides/elements throw or
silently no-op consistently with surrounding code. **Follow the
same conventions used by `updateElementData`**.

- [ ] **Step 6.2: Write failing tests**

```ts
// packages/slides/src/store/memory.test.ts — append to existing file

describe('MemSlidesStore connector methods', () => {
  function setup() {
    const store = new MemSlidesStore(/* existing constructor args */);
    const slideId = store.addSlide('blank');  // adapt to actual layout id
    const targetId = store.addElement(slideId, {
      type: 'shape',
      frame: { x: 100, y: 100, w: 200, h: 100, rotation: 0 },
      data: { kind: 'rect' },
    });
    const connectorId = store.addElement(slideId, {
      type: 'connector',
      routing: 'straight',
      start: { kind: 'free', x: 0, y: 0 },
      end:   { kind: 'attached', elementId: targetId, siteIndex: 0 },
      arrowheads: {},
      frame: { x: 0, y: 0, w: 0, h: 0, rotation: 0 },
    });
    return { store, slideId, targetId, connectorId };
  }

  it('addElement persists a connector with both endpoints', () => {
    const { store, slideId, connectorId } = setup();
    const slide = store.read().slides.find((s) => s.id === slideId)!;
    const c = slide.elements.find((e) => e.id === connectorId);
    expect(c?.type).toBe('connector');
  });

  it('updateConnectorEndpoint replaces one endpoint', () => {
    const { store, slideId, connectorId } = setup();
    store.updateConnectorEndpoint(slideId, connectorId, 'start', {
      kind: 'free', x: 42, y: 7,
    });
    const c = store.read().slides[0].elements.find((e) => e.id === connectorId);
    expect(c).toMatchObject({ start: { kind: 'free', x: 42, y: 7 } });
  });

  it('removeElement of attached target converts endpoint to free '
   + 'at last world position', () => {
    const { store, slideId, targetId, connectorId } = setup();
    // target is at (100,100)-(300,200); N site at (200, 100).
    store.removeElement(slideId, targetId);
    const c = store.read().slides[0].elements.find((e) => e.id === connectorId);
    expect(c).toMatchObject({
      end: { kind: 'free', x: 200, y: 100 },
    });
  });

  it('removeElement undo restores both target and attached endpoint',
     () => {
    const { store, slideId, targetId, connectorId } = setup();
    store.removeElement(slideId, targetId);
    store.undo();
    const c = store.read().slides[0].elements.find((e) => e.id === connectorId);
    expect(c).toMatchObject({
      end: { kind: 'attached', elementId: targetId, siteIndex: 0 },
    });
  });

  it('updateConnectorArrowheads toggles end arrowhead', () => {
    const { store, slideId, connectorId } = setup();
    store.updateConnectorArrowheads(slideId, connectorId, {
      end: { kind: 'triangle', size: 'md' },
    });
    const c = store.read().slides[0].elements.find((e) => e.id === connectorId);
    expect(c).toMatchObject({
      arrowheads: { end: { kind: 'triangle', size: 'md' } },
    });

    store.updateConnectorArrowheads(slideId, connectorId, { end: null });
    const c2 = store.read().slides[0].elements.find((e) => e.id === connectorId);
    expect((c2 as { arrowheads: { end?: unknown } }).arrowheads.end)
      .toBeUndefined();
  });
});
```

Adapt `MemSlidesStore` constructor invocation and the layout id to
the project's existing pattern (open `memory.test.ts` to copy the
working setup).

- [ ] **Step 6.3: Run tests, verify they fail (method not found)**

```bash
pnpm --filter @wafflebase/slides test -- memory
```

- [ ] **Step 6.4: Implement in `memory.ts`**

Open `memory.ts`. Add the two new methods, following the existing
mutation pattern (history push, in-place mutation, render notify):

```ts
import type { Endpoint, ArrowheadStyle } from '../model/connector';
import { computeConnectorFrame } from '../view/canvas/connector-frame';

// Inside MemSlidesStore class:

updateConnectorEndpoint(
  slideId: string,
  elementId: string,
  side: 'start' | 'end',
  endpoint: Endpoint,
): void {
  this.mutate(slideId, elementId, 'connector', (el) => {
    const prev = el[side];
    el[side] = endpoint;
    el.frame = computeConnectorFrame(el, this.elementsLookup(slideId));
    return () => {
      el[side] = prev;
      el.frame = computeConnectorFrame(el, this.elementsLookup(slideId));
    };
  });
}

updateConnectorArrowheads(
  slideId: string,
  elementId: string,
  heads: { start?: ArrowheadStyle | null; end?: ArrowheadStyle | null },
): void {
  this.mutate(slideId, elementId, 'connector', (el) => {
    const prev = { ...el.arrowheads };
    const next = { ...el.arrowheads };
    if (heads.start !== undefined) {
      if (heads.start === null) delete next.start;
      else next.start = heads.start;
    }
    if (heads.end !== undefined) {
      if (heads.end === null) delete next.end;
      else next.end = heads.end;
    }
    el.arrowheads = next;
    return () => { el.arrowheads = prev; };
  });
}
```

If `mutate` doesn't already exist with that signature, adapt to the
existing project pattern — the key invariants are:
1. Push an inverse onto undo history.
2. Type-narrow via `el.type === 'connector'`; throw / no-op
   otherwise.
3. Trigger the same re-render notify the existing
   `updateElementFrame` uses.

Add a helper `elementsLookup(slideId)` that returns a
`Map<id, Element>` for `computeConnectorFrame`. It should be a
trivial loop over the slide's elements (no caching needed for PR1).

- [ ] **Step 6.5: Implement cascade sweep in `removeElement`**

Find `removeElement(slideId, elementId)`. Before the actual removal,
add:

```ts
// Cascade: convert attached endpoints to free at their last-rendered
// world position so connectors survive source deletion (Q4 c1
// policy in slides-connectors design doc).
const slide = this.findSlide(slideId);   // use existing helper
if (slide) {
  const lookup = new Map(slide.elements.map((e) => [e.id, e] as const));
  for (const el of slide.elements) {
    if (el.type !== 'connector') continue;
    for (const side of ['start', 'end'] as const) {
      const ep = el[side];
      if (ep.kind === 'attached' && ep.elementId === elementId) {
        const w = resolveEndpoint(ep, lookup);
        // Push inverse before mutation:
        const prev = ep;
        el[side] = { kind: 'free', x: w.x, y: w.y };
        this.pushHistoryInverse(() => { el[side] = prev; });
      }
    }
    el.frame = computeConnectorFrame(el, lookup);
  }
}
```

Use `resolveEndpoint` from `connector-frame.ts`. Wire the inverse
into whatever batch/history mechanism `removeElement` already uses
so the existing undo behavior still bundles the removal and the
cascade-fix into one transaction.

`removeElements` (plural) iterates and currently calls
`removeElement` per id — the cascade runs each time, which is
correct.

- [ ] **Step 6.6: Run all store tests, verify pass**

```bash
pnpm --filter @wafflebase/slides test -- memory
```

Expected: existing tests still pass, new connector tests pass.

- [ ] **Step 6.7: Commit**

```bash
git add packages/slides/src/store/memory.ts \
        packages/slides/src/store/memory.test.ts
git commit -m "Implement connector mutations and cascade sweep in MemSlidesStore"
```

---

### Task 7: Arrowhead renderer (triangle only)

PR1 ships only the filled triangle (used by the Arrow tool).
Open / diamond / circle / square arrive in PR3.

**Files:**
- Create: `packages/slides/src/view/canvas/arrowhead-renderer.ts`
- Create: `packages/slides/src/view/canvas/arrowhead-renderer.test.ts`

- [ ] **Step 7.1: Write failing test**

```ts
// packages/slides/src/view/canvas/arrowhead-renderer.test.ts
import { describe, expect, it } from 'vitest';
import { CtxSpy } from './ctx-spy';   // existing test helper
import { drawArrowhead } from './arrowhead-renderer';

describe('drawArrowhead', () => {
  it('triangle md: draws a filled triangle pointing along angle=0', () => {
    const ctx = new CtxSpy();
    drawArrowhead(ctx, { x: 100, y: 100, angle: 0 },
      { kind: 'triangle', size: 'md' }, 'red');

    // The triangle tip is at the endpoint; base extends backward.
    const calls = ctx.calls.map((c) => c.method);
    expect(calls).toContain('beginPath');
    expect(calls).toContain('moveTo');
    expect(calls).toContain('lineTo');
    expect(calls).toContain('fill');
  });
});
```

`CtxSpy` already exists at `packages/slides/src/view/canvas/ctx-spy.ts`.
Inspect it before writing the test if the API differs from the
sketch above.

- [ ] **Step 7.2: Implement**

```ts
// packages/slides/src/view/canvas/arrowhead-renderer.ts
import type { ArrowheadKind, ArrowheadStyle } from '../../model/connector';

type Endpoint = { x: number; y: number; angle: number };

const TRIANGLE_LEN: Record<ArrowheadStyle['size'], number> = {
  sm: 8, md: 12, lg: 18,
};
const TRIANGLE_WIDTH: Record<ArrowheadStyle['size'], number> = {
  sm: 6, md: 10, lg: 14,
};

export function drawArrowhead(
  ctx: CanvasRenderingContext2D,
  ep: Endpoint,
  style: ArrowheadStyle,
  fillColor: string,
): void {
  if (style.kind !== 'triangle') return;   // other kinds: PR3
  const len = TRIANGLE_LEN[style.size];
  const halfW = TRIANGLE_WIDTH[style.size] / 2;
  // ep.angle is the path tangent direction pointing OUT of the
  // connector body at this endpoint; tip sits at ep, base extends
  // back along -angle.
  const cos = Math.cos(ep.angle);
  const sin = Math.sin(ep.angle);
  const baseX = ep.x - cos * len;
  const baseY = ep.y - sin * len;
  // Perpendicular offset for the base corners:
  const px = -sin;
  const py = cos;
  ctx.beginPath();
  ctx.moveTo(ep.x, ep.y);
  ctx.lineTo(baseX + px * halfW, baseY + py * halfW);
  ctx.lineTo(baseX - px * halfW, baseY - py * halfW);
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();
}
```

- [ ] **Step 7.3: Run, verify pass**

- [ ] **Step 7.4: Commit**

```bash
git add packages/slides/src/view/canvas/arrowhead-renderer.ts \
        packages/slides/src/view/canvas/arrowhead-renderer.test.ts
git commit -m "Add triangle arrowhead renderer"
```

---

### Task 8: Connector renderer

**Files:**
- Create: `packages/slides/src/view/canvas/connector-renderer.ts`
- Create: `packages/slides/src/view/canvas/connector-renderer.test.ts`

- [ ] **Step 8.1: Inspect existing `shape-renderer.ts` for the
  theme-color resolution pattern**

```bash
grep -n "resolveColor\|theme\|stroke" \
  packages/slides/src/view/canvas/shape-renderer.ts | head -20
```

Use the same color-resolution helper the existing shape renderer
uses for stroke colors.

- [ ] **Step 8.2: Write failing test**

```ts
// packages/slides/src/view/canvas/connector-renderer.test.ts
import { describe, expect, it } from 'vitest';
import { CtxSpy } from './ctx-spy';
import type { ConnectorElement } from '../../model/connector';
import { drawConnector } from './connector-renderer';

describe('drawConnector', () => {
  function fakeConnector(
    overrides: Partial<ConnectorElement> = {},
  ): ConnectorElement {
    return {
      id: 'c1', type: 'connector', routing: 'straight',
      start: { kind: 'free', x: 0,   y: 0 },
      end:   { kind: 'free', x: 100, y: 0 },
      arrowheads: {},
      frame: { x: 0, y: 0, w: 100, h: 0, rotation: 0 },
      stroke: { color: { kind: 'role', role: 'text' }, width: 2 },
      ...overrides,
    };
  }

  it('draws a stroked line between the two endpoints', () => {
    const ctx = new CtxSpy();
    const c = fakeConnector();
    drawConnector(ctx, c, new Map(), /* theme */ {} as any);
    const methods = ctx.calls.map((x) => x.method);
    expect(methods).toContain('moveTo');
    expect(methods).toContain('lineTo');
    expect(methods).toContain('stroke');
  });

  it('with end arrowhead: also calls fill (triangle)', () => {
    const ctx = new CtxSpy();
    const c = fakeConnector({
      arrowheads: { end: { kind: 'triangle', size: 'md' } },
    });
    drawConnector(ctx, c, new Map(), {} as any);
    expect(ctx.calls.map((x) => x.method)).toContain('fill');
  });
});
```

- [ ] **Step 8.3: Implement**

```ts
// packages/slides/src/view/canvas/connector-renderer.ts
import type { ConnectorElement } from '../../model/connector';
import type { Element } from '../../model/element';
import type { Theme } from '../../model/theme';
import { drawArrowhead } from './arrowhead-renderer';
import { getConnectionSites, siteWorldPos } from './connection-sites';
import { routeStraight } from './routing';
import { resolveThemeColor } from './shape-renderer';   // reuse existing helper

function resolveEndpointPos(
  ep: ConnectorElement['start'],
  lookup: ReadonlyMap<string, Element>,
): { x: number; y: number } {
  if (ep.kind === 'free') return { x: ep.x, y: ep.y };
  const target = lookup.get(ep.elementId);
  if (!target) return { x: 0, y: 0 };
  const site = getConnectionSites(target)[ep.siteIndex]
            ?? getConnectionSites(target)[0];
  return siteWorldPos(target, site);
}

export function drawConnector(
  ctx: CanvasRenderingContext2D,
  el: ConnectorElement,
  elements: ReadonlyMap<string, Element>,
  theme: Theme,
): void {
  const a = resolveEndpointPos(el.start, elements);
  const b = resolveEndpointPos(el.end,   elements);

  // PR1: straight routing only.
  const path = routeStraight(a, b);

  const stroke = el.stroke ?? {
    color: { kind: 'role', role: 'text' as const },
    width: 2,
  };
  const strokeColor = resolveThemeColor(stroke.color, theme);

  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = stroke.width;
  ctx.beginPath();
  ctx.moveTo(path.points[0].x, path.points[0].y);
  for (let i = 1; i < path.points.length; i++) {
    ctx.lineTo(path.points[i].x, path.points[i].y);
  }
  ctx.stroke();

  // Arrowheads aligned with the local tangent at each endpoint.
  // Tangent at start points TOWARD start, away from the line body.
  // Tangent at end points away from end.
  const tangentAtEnd = Math.atan2(b.y - a.y, b.x - a.x);
  const tangentAtStart = tangentAtEnd + Math.PI;
  if (el.arrowheads.start) {
    drawArrowhead(
      ctx, { x: a.x, y: a.y, angle: tangentAtStart },
      el.arrowheads.start, strokeColor,
    );
  }
  if (el.arrowheads.end) {
    drawArrowhead(
      ctx, { x: b.x, y: b.y, angle: tangentAtEnd },
      el.arrowheads.end, strokeColor,
    );
  }
}
```

`resolveThemeColor` may be named differently in the codebase. Use
`grep -n "resolveColor\|resolveThemeColor\|colorFromRole"
packages/slides/src/view/canvas/` to find the existing helper, and
import it (or replicate inline if it's only available as a private
function in another file).

- [ ] **Step 8.4: Run, verify pass**

- [ ] **Step 8.5: Commit**

```bash
git add packages/slides/src/view/canvas/connector-renderer.ts \
        packages/slides/src/view/canvas/connector-renderer.test.ts
git commit -m "Add connector renderer drawing straight path and arrowheads"
```

---

### Task 9: element-renderer dispatch

**Files:**
- Modify: `packages/slides/src/view/canvas/element-renderer.ts`

- [ ] **Step 9.1: Read existing `element-renderer.ts`**

Find the dispatcher block that switches on `el.type` (the existing
TODO stub from Task 1.3 lives here).

- [ ] **Step 9.2: Add the connector branch**

Replace the stub for `el.type === 'connector'` with a call to
`drawConnector`. Connector rendering does **not** apply the
`frame.x/y` translate-then-rotate transform other element types use,
because connector coordinates are already world-space — call
`drawConnector` after `ctx.save()` with no transform changes, then
`ctx.restore()`.

The elements lookup map needed by `drawConnector` is the same map
the renderer probably already builds for `placeholderRef` resolution
or selection. Plumb it through to the dispatcher; if it doesn't
exist, build it locally:

```ts
const lookup = new Map<string, Element>(
  slide.elements.map((e) => [e.id, e] as const),
);
```

Pass `lookup` as a parameter, not a closure capture, so unit tests
can inject targeted maps.

- [ ] **Step 9.3: Run all existing canvas tests**

```bash
pnpm --filter @wafflebase/slides test -- canvas
```

Expected: everything still passes; no regressions.

- [ ] **Step 9.4: Commit**

```bash
git add packages/slides/src/view/canvas/element-renderer.ts
git commit -m "Dispatch connector elements to drawConnector"
```

---

### Task 10: Remove line/arrow from ShapeKind + cleanup

This task owns the full removal of `'line'` and `'arrow'` from
`ShapeKind` along with every production and test-file site that
referenced them. It runs after the new connector type and the
connector renderer/insert path are in place (Tasks 1–9 + 11–13),
so the old special-cased shape paths can be deleted safely.

**Files:**
- Modify: `packages/slides/src/model/element.ts` — remove
  `'line' | 'arrow'` from `ShapeKind`
- Modify: `packages/slides/src/view/canvas/shape-renderer.ts` —
  drop `kind === 'line'` / `'arrow'` branches
- Modify: `packages/slides/src/view/canvas/shape-special.ts` —
  delete `drawLine` and `drawArrow`
- Modify: `packages/slides/src/view/canvas/shape-icon.ts` — drop
  the `kind === 'line'` / `'arrow'` icon branches
- Modify: `packages/slides/src/view/editor/interactions/insert.ts` —
  drop the `LINE_H` constant, the `'line'` / `'arrow'` entries from
  `DEFAULT_INSERT_SIZE` and `SPECIAL_FAMILIES`, and any
  `kind === 'arrow'` conditional in `buildInsertElement`
- Modify: `packages/slides/src/view/canvas/shape-renderer.test.ts` —
  remove or rewrite the 6 line/arrow test cases (the rendering is
  now covered by `connector-renderer.test.ts`)
- Modify: `packages/slides/src/view/canvas/shape-icon.test.ts` —
  remove the `'line'` / `'arrow'` icon test entries
- Modify: `packages/slides/src/view/editor/interactions/insert.test.ts` —
  remove the `buildInsertElement('line', …)` /
  `buildInsertElement('arrow', …)` tests (the connector insert flow
  is covered by `insert-connector.test.ts`)

- [ ] **Step 10.1: Delete `drawLine` and `drawArrow` from
  `shape-special.ts`**

Keep `drawActionButton` (still used). Remove the two functions and
their exports.

- [ ] **Step 10.2: Remove `line`/`arrow` branches from
  `shape-renderer.ts`**

Find the dispatcher's special-case block (look for `kind === 'line'`
and `kind === 'arrow'`). Delete those branches and the associated
imports.

- [ ] **Step 10.3: Remove `line`/`arrow` branches from
  `shape-icon.ts`**

Drop the two conditional branches that match `kind === 'line'` and
`kind === 'arrow'` (around lines 47 and 54 at time of writing).

- [ ] **Step 10.4: Clean `interactions/insert.ts`**

Delete:
- The `LINE_H` size constant.
- The two `['line', LINE_H]` / `['arrow', LINE_H]` entries in
  `DEFAULT_INSERT_SIZE`.
- Any entry referring to `'line'` / `'arrow'` in `SPECIAL_FAMILIES`.
- Any `kind === 'arrow'` (or `'line'`) conditional inside
  `buildInsertElement` (it's dead once the kinds are gone).

- [ ] **Step 10.5: Remove `'line' | 'arrow'` from `ShapeKind` in
  `element.ts`**

Delete the `| 'line' | 'arrow'` entries plus the surrounding
`// Lines (special-cased renderers in shape-special.ts)` comment
line.

- [ ] **Step 10.6: Update the existing tests**

In `shape-renderer.test.ts`, remove the 6 test cases that construct
`{ kind: 'line' }` or `{ kind: 'arrow' }` shapes (they're now
exercised by `connector-renderer.test.ts`).

In `shape-icon.test.ts`, remove the 2 entries that pass `'line'`
and `'arrow'` to `renderShapeIcon`.

In `interactions/insert.test.ts`, remove the tests that call
`buildInsertElement('line', …)` / `buildInsertElement('arrow', …)`
and the assertions that narrow on `line.data.kind === 'line'`. The
connector insert flow is now covered by
`insert-connector.test.ts` (Task 11).

- [ ] **Step 10.7: Find any remaining references**

```bash
grep -rn "kind: 'line'\|kind: 'arrow'\|'line' \| 'arrow'\|drawLine\|drawArrow\|LINE_H" \
  packages/slides/src
```

Expected output: empty (or only matches inside comments that
should also be cleaned).

- [ ] **Step 10.8: Verify build + tests still pass**

```bash
pnpm verify:fast
```

Must be green.

- [ ] **Step 10.9: Commit**

```bash
git add packages/slides/src/model/element.ts \
        packages/slides/src/view/canvas/shape-special.ts \
        packages/slides/src/view/canvas/shape-renderer.ts \
        packages/slides/src/view/canvas/shape-renderer.test.ts \
        packages/slides/src/view/canvas/shape-icon.ts \
        packages/slides/src/view/canvas/shape-icon.test.ts \
        packages/slides/src/view/editor/interactions/insert.ts \
        packages/slides/src/view/editor/interactions/insert.test.ts
git commit -m "Drop line and arrow from ShapeKind in favor of connectors"
```

---

### Task 11: Insert-connector interaction

**Files:**
- Create: `packages/slides/src/view/editor/interactions/insert-connector.ts`
- Modify: `packages/slides/src/view/editor/editor.ts`

- [ ] **Step 11.1: Inspect existing `insert.ts` and `select.ts` for
  the interaction pattern**

```bash
sed -n '1,80p' packages/slides/src/view/editor/interactions/insert.ts
sed -n '1,80p' packages/slides/src/view/editor/interactions/select.ts
```

Pattern to match: pointer event handlers, slide-local coordinate
transform, snap helpers, finalize-on-mouseup → store mutation →
revert to select mode.

- [ ] **Step 11.2: Implement `insert-connector.ts`**

```ts
// packages/slides/src/view/editor/interactions/insert-connector.ts
import type { SlidesStore } from '../../../store/store';
import type { ConnectorElement, Endpoint } from '../../../model/connector';
import type { Element } from '../../../model/element';
import {
  getConnectionSites, siteWorldPos,
} from '../../canvas/connection-sites';
import { computeConnectorFrame } from '../../canvas/connector-frame';

export type ConnectorInsertVariant = 'line' | 'arrow';

const SHAPE_HOVER_RADIUS = 24;   // px
const SITE_SNAP_RADIUS   = 12;   // px
const MIN_DRAG_DISTANCE  = 4;    // px

export interface SnapHit {
  elementId: string;
  siteIndex: number;
  worldX: number;
  worldY: number;
}

/** Returns the nearest site within SITE_SNAP_RADIUS, or null. */
export function findSnapTarget(
  cursor: { x: number; y: number },
  elements: readonly Element[],
): SnapHit | null {
  let best: SnapHit | null = null;
  let bestD2 = SITE_SNAP_RADIUS * SITE_SNAP_RADIUS;
  for (const el of elements) {
    if (el.type === 'connector') continue;     // no sites on connectors
    const sites = getConnectionSites(el);
    for (let i = 0; i < sites.length; i++) {
      const s = siteWorldPos(el, sites[i]);
      const dx = s.x - cursor.x;
      const dy = s.y - cursor.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = { elementId: el.id, siteIndex: i, worldX: s.x, worldY: s.y };
      }
    }
  }
  return best;
}

export function snappedEndpoint(
  cursor: { x: number; y: number },
  elements: readonly Element[],
): Endpoint {
  const hit = findSnapTarget(cursor, elements);
  if (hit) return { kind: 'attached', elementId: hit.elementId,
                    siteIndex: hit.siteIndex };
  return { kind: 'free', x: cursor.x, y: cursor.y };
}

/**
 * Called by the editor when the user mouseups after a drag in
 * connector-insert mode. Returns the new element id, or null if
 * the drag was too short to be meaningful.
 */
export function finalizeInsert(
  store: SlidesStore,
  slideId: string,
  variant: ConnectorInsertVariant,
  start: { x: number; y: number },
  end: { x: number; y: number },
  elements: readonly Element[],
): string | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.hypot(dx, dy) < MIN_DRAG_DISTANCE) return null;

  const startEp = snappedEndpoint(start, elements);
  const endEp   = snappedEndpoint(end,   elements);

  const arrowheads: ConnectorElement['arrowheads'] = variant === 'arrow'
    ? { end: { kind: 'triangle', size: 'md' } }
    : {};

  const init: Omit<ConnectorElement, 'id'> = {
    type: 'connector',
    routing: 'straight',
    start: startEp,
    end:   endEp,
    arrowheads,
    frame: { x: 0, y: 0, w: 0, h: 0, rotation: 0 },  // recomputed below
    stroke: { color: { kind: 'role', role: 'text' }, width: 2 },
  };
  // Pre-fill the frame so insertion-time selection bbox is correct.
  init.frame = computeConnectorFrame(
    { id: '_', ...init } as ConnectorElement,
    new Map(elements.map((e) => [e.id, e])),
  );

  return store.addElement(slideId, init);
}

export const __testing__ = { SHAPE_HOVER_RADIUS };
```

- [ ] **Step 11.3: Write a test for `findSnapTarget` and
  `finalizeInsert`**

```ts
// packages/slides/src/view/editor/interactions/insert-connector.test.ts
import { describe, expect, it } from 'vitest';
import type { Element } from '../../../model/element';
import { findSnapTarget, snappedEndpoint } from './insert-connector';

const rect = (id: string, x: number, y: number): Element => ({
  id, type: 'shape',
  frame: { x, y, w: 100, h: 100, rotation: 0 },
  data: { kind: 'rect' },
});

describe('findSnapTarget', () => {
  it('snaps to the nearest site within 12px', () => {
    const els = [rect('r1', 100, 100)];
    // r1 N site is at (150, 100).
    const hit = findSnapTarget({ x: 155, y: 105 }, els);
    expect(hit).toMatchObject({ elementId: 'r1', siteIndex: 0 });
  });

  it('returns null outside the snap radius', () => {
    const els = [rect('r1', 100, 100)];
    const hit = findSnapTarget({ x: 200, y: 300 }, els);
    expect(hit).toBeNull();
  });

  it('skips connector elements (no sites on connectors)', () => {
    // Two rects far away + a "connector" at the cursor. Pretend the
    // connector type doesn't have sites — function should ignore it.
    const fakeConnector = { id: 'c1', type: 'connector' } as unknown as Element;
    const hit = findSnapTarget({ x: 0, y: 0 }, [fakeConnector]);
    expect(hit).toBeNull();
  });
});

describe('snappedEndpoint', () => {
  it('returns free when no snap', () => {
    expect(snappedEndpoint({ x: 500, y: 500 }, []))
      .toEqual({ kind: 'free', x: 500, y: 500 });
  });

  it('returns attached on snap', () => {
    const els = [rect('r1', 100, 100)];
    expect(snappedEndpoint({ x: 150, y: 100 }, els))
      .toEqual({ kind: 'attached', elementId: 'r1', siteIndex: 0 });
  });
});
```

- [ ] **Step 11.4: Wire into `editor.ts`**

Open `editor.ts`. Find where `setInsertMode` (or the existing
shape-insert pointer plumbing) lives. Add a new insert mode key
`'connector:line'` and `'connector:arrow'`. On mousedown, capture
`start`. On mousemove, render a live preview line (reuse the
existing canvas overlay layer used for shape-insert drag preview;
draw it via the same `requestRender` pulse). On mouseup, call
`finalizeInsert(...)` with the elements snapshot from the current
slide, then revert to select mode (existing behavior).

The connection-points overlay (Task 13) is activated by the editor
setting a flag like `editor.isConnectorMode === true`. Wire that
flag here so the overlay can subscribe to it.

- [ ] **Step 11.5: Run tests, verify pass**

```bash
pnpm --filter @wafflebase/slides test -- insert-connector
pnpm --filter @wafflebase/slides exec tsc --noEmit
```

- [ ] **Step 11.6: Commit**

```bash
git add packages/slides/src/view/editor/interactions/insert-connector.ts \
        packages/slides/src/view/editor/interactions/insert-connector.test.ts \
        packages/slides/src/view/editor/editor.ts
git commit -m "Add connector insert interaction with snap-on-draw"
```

---

### Task 12: Connector endpoint drag interaction

**Files:**
- Create: `packages/slides/src/view/editor/interactions/connector-endpoint-drag.ts`
- Modify: `packages/slides/src/view/editor/selection.ts` (or wherever
  selection-handle drag is dispatched)

- [ ] **Step 12.1: Implement endpoint drag**

```ts
// packages/slides/src/view/editor/interactions/connector-endpoint-drag.ts
import type { SlidesStore } from '../../../store/store';
import type { ConnectorElement } from '../../../model/connector';
import type { Element } from '../../../model/element';
import { snappedEndpoint } from './insert-connector';

export function dragEndpoint(
  store: SlidesStore,
  slideId: string,
  connector: ConnectorElement,
  side: 'start' | 'end',
  cursor: { x: number; y: number },
  elements: readonly Element[],
): void {
  // Exclude self from snap candidates: a connector cannot snap to its
  // own endpoints, and we should also avoid snapping back to the same
  // element the *other* endpoint is attached to if that would create
  // a zero-length self-link. For PR1, simple rule: exclude self only.
  const candidates = elements.filter((e) => e.id !== connector.id);
  const endpoint = snappedEndpoint(cursor, candidates);
  store.updateConnectorEndpoint(slideId, connector.id, side, endpoint);
}
```

- [ ] **Step 12.2: Write a thin test (mostly covered by Task 11's
  snap tests; just verify the store call shape)**

```ts
// packages/slides/src/view/editor/interactions/connector-endpoint-drag.test.ts
import { describe, expect, it, vi } from 'vitest';
import type { SlidesStore } from '../../../store/store';
import type { ConnectorElement } from '../../../model/connector';
import { dragEndpoint } from './connector-endpoint-drag';

describe('dragEndpoint', () => {
  it('calls store.updateConnectorEndpoint with snapped endpoint', () => {
    const store = {
      updateConnectorEndpoint: vi.fn(),
    } as unknown as SlidesStore;
    const c: ConnectorElement = {
      id: 'c1', type: 'connector', routing: 'straight',
      start: { kind: 'free', x: 0, y: 0 },
      end:   { kind: 'free', x: 100, y: 0 },
      arrowheads: {},
      frame: { x: 0, y: 0, w: 100, h: 0, rotation: 0 },
    };
    dragEndpoint(store, 's1', c, 'end', { x: 999, y: 999 }, []);
    expect(store.updateConnectorEndpoint).toHaveBeenCalledWith(
      's1', 'c1', 'end', { kind: 'free', x: 999, y: 999 },
    );
  });
});
```

- [ ] **Step 12.3: Wire into selection handle drag**

Open `selection.ts` (or whichever file the package uses for handle
hit-testing — `grep -rn "handle" packages/slides/src/view/editor/`).
When the selected element is a connector and a start/end handle is
dragged, route to `dragEndpoint(...)` instead of the regular
`updateElementFrame`. Other handle types (corner/edge resize,
rotate) do not apply to connectors — hide them via the same
selection.ts code that decides which handles to render.

The connector's `selection handles` for PR1 are exactly two: at the
start and end endpoint world positions.

- [ ] **Step 12.4: Run tests + tsc**

- [ ] **Step 12.5: Commit**

```bash
git add packages/slides/src/view/editor/interactions/connector-endpoint-drag.ts \
        packages/slides/src/view/editor/interactions/connector-endpoint-drag.test.ts \
        packages/slides/src/view/editor/selection.ts
git commit -m "Drag connector endpoints with snap, replace resize handles"
```

---

### Task 13: Connection-points overlay (DOM)

The overlay is a React DOM layer that renders small circles over
each connection site of the nearest shape under the cursor, visible
only when the user is in connector-insert or connector-endpoint-drag
mode.

**Files:**
- Modify: `packages/slides/src/view/editor/overlay.ts`

- [ ] **Step 13.1: Inspect existing overlay**

```bash
sed -n '1,60p' packages/slides/src/view/editor/overlay.ts
```

Identify how the overlay subscribes to editor state and how it
mounts elements onto the DOM layer.

- [ ] **Step 13.2: Add overlay logic**

Inside `overlay.ts`, add a routine that runs each frame while
`editor.isConnectorMode === true`:

```ts
import {
  getConnectionSites, siteWorldPos,
} from '../canvas/connection-sites';

// Constants matching insert-connector.ts:
const SHAPE_HOVER_RADIUS = 24;
const SITE_SNAP_RADIUS = 12;

function renderConnectionPointsOverlay(
  cursor: { x: number; y: number } | null,
  slide: Slide,
  zoom: number,
): OverlayDOM[] {
  if (!cursor) return [];
  // Pick nearest non-connector element within hover radius (slide-local).
  let nearestEl: Element | null = null;
  let bestD2 = SHAPE_HOVER_RADIUS * SHAPE_HOVER_RADIUS / (zoom * zoom);
  for (const el of slide.elements) {
    if (el.type === 'connector') continue;
    const cx = el.frame.x + el.frame.w / 2;
    const cy = el.frame.y + el.frame.h / 2;
    const d2 = (cx - cursor.x) ** 2 + (cy - cursor.y) ** 2;
    if (d2 < bestD2) { bestD2 = d2; nearestEl = el; }
  }
  if (!nearestEl) return [];
  return getConnectionSites(nearestEl).map((site, idx) => {
    const w = siteWorldPos(nearestEl!, site);
    const cursorD = Math.hypot(w.x - cursor.x, w.y - cursor.y);
    const highlighted = cursorD < SITE_SNAP_RADIUS / zoom;
    return makeSiteDom(w, idx, highlighted);
  });
}
```

`SHAPE_HOVER_RADIUS` and `SITE_SNAP_RADIUS` are screen-pixel
distances; divide by zoom to convert to slide-logical for
distance-checking against world coordinates. `makeSiteDom` is a
helper that returns the overlay element (CSS-positioned div with
`width/height: 12px`, blue fill, white stroke) — pattern-match the
existing handle/overlay rendering in `overlay.ts`.

The "nearest-only" filter keeps multiple stacked shapes from
flooding the screen with dots.

- [ ] **Step 13.3: Manual smoke** (no unit test for DOM overlay
  — visual verification suffices)

After implementing, run `pnpm dev` (Task 16) and visually verify
the overlay appears as expected.

- [ ] **Step 13.4: Commit**

```bash
git add packages/slides/src/view/editor/overlay.ts
git commit -m "Render connection points overlay during connector insert"
```

---

### Task 14: Toolbar entries — Line + Arrow

**Files:**
- Modify: the slides toolbar (find via
  `grep -rn "shape picker\|toolbar\|setInsertMode" \
  packages/frontend/src/app/slides packages/slides/src`)

- [ ] **Step 14.1: Locate the toolbar's "insert shape" dropdown**

Historical note: this step originally added Line + Arrow into the
existing ShapePicker dropdown (where `line` and `arrow` previously
lived as `ShapeKind`). Smoke-test feedback was that mixing connector
tools and pure shapes in one menu felt off — the connector tools have
a different click-drag flow with snap affordances, and reusing the
shape picker hid that distinction. PR1 instead introduces a dedicated
`LinePicker` component beside the ShapePicker, owning only the
connector entries. The wire-up on click still calls
`editor.setInsertMode('connector:line')` /
`editor.setInsertMode('connector:arrow')` (the new modes added in
Task 11.4).

- [ ] **Step 14.2: Add an icon for each**

Use the existing icon convention (lucide-react or whatever the
toolbar uses for the shape picker — check sibling entries).

For Line, a 45° stroke; for Arrow, the same with a triangle on the
end.

- [ ] **Step 14.3: Manual smoke**

Open `pnpm dev` and check the toolbar shows Line + Arrow tools, and
clicking either enters insert mode with the connection-points
overlay visible.

- [ ] **Step 14.4: Commit**

```bash
git add packages/frontend/src/app/slides   # adjust to actual paths
git commit -m "Add Line and Arrow tools to slides toolbar"
```

---

### Task 15: Verify + final smoke

- [ ] **Step 15.1: Run `pnpm verify:fast`**

```bash
pnpm verify:fast
```

Expected: Exit 0 (lint + unit tests pass).

- [ ] **Step 15.2: Manual browser smoke** (per project workflow)

```bash
pnpm dev
```

Verify in browser:
- Pick Line tool, click-drag from empty space → free→free line
  appears.
- Pick Arrow tool, drag from empty space → arrow with end triangle.
- Pick Line, drag from near a shape's N edge → start endpoint
  snaps and shows blue dots while approaching; line attaches.
- Move the shape after attaching → the line follows.
- Delete the attached shape → the line remains as free→free with
  endpoint at last-rendered position.
- Cmd+Z restores both the shape and the attachment.
- Select the line → 2 endpoint handles visible; drag end handle
  onto another shape → re-attaches.
- Resize/rotate handles do **not** appear on connectors.

- [ ] **Step 15.3: Update README and design index if needed**

Both already done in the design step (the design doc was added to
`docs/design/README.md`); nothing further here unless the toolbar
docs need a tweak.

- [ ] **Step 15.4: Capture lessons file** (per project workflow)

```bash
$EDITOR docs/tasks/active/20260515-slides-connectors-pr1-lessons.md
```

Record any surprises (e.g. an attached endpoint world-position
calculation gotcha, a snap-radius tuning decision).

- [ ] **Step 15.5: Self-review with code-review skill** (per project
  workflow)

Run the project's code-review skill over the full branch diff
before pushing. Apply blocking findings; note non-blocking as known
limitations.

- [ ] **Step 15.6: Sync, push, open PR**

```bash
git fetch origin && git rebase origin/main
git push -u origin feat/slides-connectors-base
gh pr create --title \
  "Replace line/arrow shapes with endpoint-driven connectors (PR1)" \
  --body "$(cat <<'EOF'
## Summary
- Add `ConnectorElement` type (endpoint-driven, no `kind: 'line'`/`'arrow'` shapes)
- Default 4-cardinal connection sites; per-shape overrides arrive in PR2
- `routeStraight` + connector renderer + triangle arrowhead
- Insert + endpoint-drag interactions with snap-on-draw UX
- Cascade sweep: deleting a source shape converts attached endpoints to free

## Test plan
- [x] `pnpm verify:fast` green
- [ ] Browser smoke: Line, Arrow, attach, follow on move, cascade on delete
- [ ] Reviewer verifies the four cardinal sites render in correct positions
EOF
)"
```

- [ ] **Step 15.7: Archive task after PR merges**

```bash
pnpm tasks:archive && pnpm tasks:index
```

---

## Self-Review Notes

**Spec coverage** (vs. `slides-connectors.md` §9 PR1):

| Spec item | Task |
|---|---|
| `ConnectorElement`, `Endpoint`, `ArrowheadStyle`, `ConnectionSite` types | 1, 2 |
| Default 4-cardinal sites | 2 |
| `routing.ts` with `routeStraight` | 3 |
| `connector-renderer.ts`, `arrowhead-renderer.ts` | 7, 8 |
| `addConnector` via `addElement` (union extension) | 1, 6 |
| `updateConnectorEndpoint` | 5, 6 |
| `updateConnectorArrowheads` | 5, 6 |
| `removeElement` cascade sweep | 6 |
| `insert-connector.ts`, `connector-endpoint-drag.ts` | 11, 12 |
| `connection-points-overlay` | 13 |
| Drop `'line'` / `'arrow'` from `ShapeKind` | 1.2, 10 |

**Out of scope for PR1** (per design doc):
- `routeElbow`, `routeCurved` → PR2
- `elbow-bend-drag.ts`, `updateConnectorElbowBend` → PR2
- Per-`ShapeKind` connection-site overrides → PR2
- Arrowhead kinds beyond triangle → PR3
- Inspector panel for arrowhead selection → PR3

**Known nuances flagged during planning:**
- `ConnectorElement` retains a `frame` (required by `ElementBase`)
  as a **derived bbox cache**, recomputed by `computeConnectorFrame`
  whenever endpoints or routing change. The spec wording "no frame
  field" reflects the *authoritative* geometry source (endpoints),
  not the storage layout — frame is a maintained projection. The
  attached-source-frame-change path: when `updateElementFrame` runs
  on a shape, every connector with an attached endpoint pointing at
  it needs `el.frame` recomputed. Hook this into `MemSlidesStore`'s
  `updateElementFrame` along the same path that runs
  `computeConnectorFrame` in the connector mutation methods.

  **Action item for Task 6.5:** When implementing the cascade
  sweep, also extend `updateElementFrame` to recompute dependent
  connectors' frames. Otherwise: select-then-resize a shape with an
  attached connector will leave the connector's selection bbox
  stale until the next endpoint mutation.

  Concretely, add to `updateElementFrame` (after the existing frame
  update):
  ```ts
  for (const el of slide.elements) {
    if (el.type !== 'connector') continue;
    if (el.start.kind === 'attached' && el.start.elementId === elementId
     || el.end.kind === 'attached'   && el.end.elementId   === elementId) {
      el.frame = computeConnectorFrame(el, lookup);
    }
  }
  ```
