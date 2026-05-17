# Slides Group / Ungroup — nested element tree

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google-Slides-style group / ungroup to the slides editor with a recursive `GroupElement`, drill-in selection, recursive renderer / hit-test / PDF export, and PPTX `<p:grpSp>` preservation.

**Design doc:** [slides-group.md](../../design/slides/slides-group.md)

**Architecture:** A new `GroupElement` variant joins the slides `Element` union. The group owns its own `frame` (x, y, w, h, rotation, flipH/V); its `data.children` is a recursive `Element[]` in **group-local coordinates** (origin at the group's top-left, extent `frame.w × frame.h`). All read/write paths that previously assumed a flat `slide.elements` array gain one layer of DFS recursion: renderer, hit-test, snap, drag/resize, PDF export, Yorkie adapter, PPTX import. Selection follows Google Slides drill-in: outermost group first, double-click descends, `Esc` pops.

**Tech stack:** TypeScript, Vitest, `pdf-lib`, Yorkie SDK, existing `@wafflebase/slides` model + view + import + export modules.

**Phasing strategy:** P1–P3 (model, renderer, drill-in UX) are pure `@wafflebase/slides` work. P4 (Yorkie multi-user) and P5 (PPTX + PDF) cross package boundaries. Ship after each phase if reviewers want smaller PRs; otherwise stack into one PR.

---

## Task 1 — `GroupElement` type and `model/group.ts` helpers

**Files:**

- Modify: `packages/slides/src/model/element.ts`
- Create: `packages/slides/src/model/group.ts`
- Create: `packages/slides/test/model/group.test.ts`
- Modify: `packages/slides/src/index.ts` (export new types / helpers)

Foundation for everything downstream. The helpers compose with the existing PPTX import transform math (`packages/slides/src/import/pptx/group.ts`) — reuse the quadratic-solver branch by building a `GroupTransform` from a `GroupElement.frame`.

**Public shape:**

```ts
// packages/slides/src/model/element.ts — add to the union
export type GroupElement = ElementBase & {
  type: 'group';
  data: {
    children: Element[]; // frames are in group-local coords (0..w × 0..h)
  };
};

export type Element =
  | TextElement
  | ImageElement
  | ShapeElement
  | ConnectorElement
  | GroupElement;
```

```ts
// packages/slides/src/model/group.ts
import type { Element, Frame, GroupElement } from './element';
import { applyGroupTransform as applyMatrix } from '../import/pptx/group';
import type { GroupTransform } from '../import/pptx/group';

export function groupToTransform(group: GroupElement): GroupTransform {
  // children live in (0..w × 0..h), so scale is identity.
  // The group transform is: translate(group.frame.x, group.frame.y)
  // then rotate by group.frame.rotation around the group center.
  const { x, y, w, h, rotation } = group.frame;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const cx = x + w / 2;
  const cy = y + h / 2;
  // Rotation around (cx, cy) followed by no scale and translation
  // built into the matrix's tx/ty:
  return {
    a: cos, b: sin,
    c: -sin, d: cos,
    tx: x + (cx - x) * (1 - cos) + (cy - y) * sin,
    ty: y + (cy - y) * (1 - cos) - (cx - x) * sin,
    rotation,
  };
}

/** Compose: child's group-local frame → world frame in the group's parent space. */
export function applyGroupTransform(child: Frame, group: GroupElement): Frame {
  return applyMatrix(child, groupToTransform(group));
}

/** Inverse: child's world frame → group-local frame. Used by group() and PPTX import. */
export function normalizeToGroupLocal(world: Frame, group: GroupElement): Frame {
  // Build the inverse matrix and apply.
  const t = groupToTransform(group);
  // For a pure rotation+translation matrix, inverse is transpose of
  // the 2x2 rotation block plus the negated, rotated translation.
  const det = t.a * t.d - t.b * t.c; // = 1 for pure rotation
  const inv: GroupTransform = {
    a: t.d / det, b: -t.b / det,
    c: -t.c / det, d: t.a / det,
    tx: -(t.d * t.tx - t.c * t.ty) / det,
    ty: -(-t.b * t.tx + t.a * t.ty) / det,
    rotation: -t.rotation,
  };
  return applyMatrix(world, inv);
}

/** Walk slide.elements DFS; return the chain from slide-root → element (leaf last). */
export function findElementPath(
  elements: Element[],
  elementId: string,
): Element[] | null {
  for (const el of elements) {
    if (el.id === elementId) return [el];
    if (el.type === 'group') {
      const sub = findElementPath(el.data.children, elementId);
      if (sub) return [el, ...sub];
    }
  }
  return null;
}

/** Returns true if `candidateAncestor.id` is `target` or an ancestor of `target`. */
export function isDescendantOf(
  candidateAncestor: GroupElement,
  target: Element,
): boolean {
  if (candidateAncestor.id === target.id) return true;
  for (const child of candidateAncestor.data.children) {
    if (child.type === 'group' && isDescendantOf(child, target)) return true;
  }
  return false;
}
```

- [ ] **1.1** Add `GroupElement` to `packages/slides/src/model/element.ts` and extend the `Element` union. Keep `ElementInit` synced (`Omit<GroupElement, 'id'>` variant). Re-export from `packages/slides/src/index.ts`.

- [ ] **1.2** Create `packages/slides/src/model/group.ts` with the exact helpers above. Re-export from `packages/slides/src/index.ts`.

- [ ] **1.3** Write failing tests in `packages/slides/test/model/group.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  applyGroupTransform,
  normalizeToGroupLocal,
  findElementPath,
  isDescendantOf,
} from '../../src/model/group';
import type { GroupElement, ShapeElement } from '../../src/model/element';

function shape(id: string, frame: { x: number; y: number; w: number; h: number; rotation?: number }): ShapeElement {
  return {
    id,
    type: 'shape',
    frame: { rotation: 0, ...frame },
    data: { kind: 'rect' },
  };
}

function group(id: string, frame: { x: number; y: number; w: number; h: number; rotation?: number }, children: Array<ShapeElement | GroupElement>): GroupElement {
  return {
    id,
    type: 'group',
    frame: { rotation: 0, ...frame },
    data: { children },
  };
}

describe('applyGroupTransform / normalizeToGroupLocal', () => {
  it('round-trips a child frame through an axis-aligned group', () => {
    const g = group('g', { x: 100, y: 200, w: 300, h: 400 }, []);
    const childLocal = { x: 10, y: 20, w: 50, h: 60, rotation: 0 };
    const world = applyGroupTransform(childLocal, g);
    const back = normalizeToGroupLocal(world, g);
    expect(back.x).toBeCloseTo(childLocal.x, 6);
    expect(back.y).toBeCloseTo(childLocal.y, 6);
    expect(back.w).toBeCloseTo(childLocal.w, 6);
    expect(back.h).toBeCloseTo(childLocal.h, 6);
  });

  it('round-trips through a rotated group', () => {
    const g = group('g', { x: 50, y: 50, w: 200, h: 100, rotation: Math.PI / 6 }, []);
    const childLocal = { x: 30, y: 10, w: 40, h: 20, rotation: 0 };
    const world = applyGroupTransform(childLocal, g);
    const back = normalizeToGroupLocal(world, g);
    expect(back.x).toBeCloseTo(childLocal.x, 4);
    expect(back.y).toBeCloseTo(childLocal.y, 4);
    expect(back.w).toBeCloseTo(childLocal.w, 4);
    expect(back.h).toBeCloseTo(childLocal.h, 4);
  });
});

describe('findElementPath', () => {
  it('returns [el] for a slide-root element', () => {
    const a = shape('a', { x: 0, y: 0, w: 10, h: 10 });
    expect(findElementPath([a], 'a')?.map(e => e.id)).toEqual(['a']);
  });

  it('returns ancestor chain for a deeply nested element', () => {
    const inner = shape('inner', { x: 0, y: 0, w: 10, h: 10 });
    const mid = group('mid', { x: 0, y: 0, w: 100, h: 100 }, [inner]);
    const outer = group('outer', { x: 0, y: 0, w: 200, h: 200 }, [mid]);
    expect(findElementPath([outer], 'inner')?.map(e => e.id)).toEqual(['outer', 'mid', 'inner']);
  });

  it('returns null for missing id', () => {
    expect(findElementPath([], 'missing')).toBeNull();
  });
});

describe('isDescendantOf', () => {
  it('detects self', () => {
    const g = group('g', { x: 0, y: 0, w: 10, h: 10 }, []);
    expect(isDescendantOf(g, g)).toBe(true);
  });

  it('detects descendant across nesting', () => {
    const leaf = shape('leaf', { x: 0, y: 0, w: 10, h: 10 });
    const inner = group('inner', { x: 0, y: 0, w: 50, h: 50 }, [leaf]);
    const outer = group('outer', { x: 0, y: 0, w: 100, h: 100 }, [inner]);
    expect(isDescendantOf(outer, leaf)).toBe(true);
  });
});
```

- [ ] **1.4** Run: `pnpm --filter @wafflebase/slides test test/model/group.test.ts`. Expect: all PASS.

- [ ] **1.5** Add a fast-check property test (depth 1–2 random groups, random child rotation) to lock the round-trip invariant. Append to the same test file:

```ts
import fc from 'fast-check';

describe('round-trip property', () => {
  it('applyGroupTransform ∘ normalizeToGroupLocal ≈ identity', () => {
    fc.assert(
      fc.property(
        fc.record({
          gx: fc.float({ min: -1000, max: 1000, noNaN: true }),
          gy: fc.float({ min: -1000, max: 1000, noNaN: true }),
          gw: fc.float({ min: 10, max: 2000, noNaN: true }),
          gh: fc.float({ min: 10, max: 2000, noNaN: true }),
          gr: fc.float({ min: -Math.PI, max: Math.PI, noNaN: true }),
          cx: fc.float({ min: -100, max: 100, noNaN: true }),
          cy: fc.float({ min: -100, max: 100, noNaN: true }),
          cw: fc.float({ min: 1, max: 500, noNaN: true }),
          ch: fc.float({ min: 1, max: 500, noNaN: true }),
          cr: fc.float({ min: -Math.PI, max: Math.PI, noNaN: true }),
        }),
        ({ gx, gy, gw, gh, gr, cx, cy, cw, ch, cr }) => {
          const g = group('g', { x: gx, y: gy, w: gw, h: gh, rotation: gr }, []);
          const local = { x: cx, y: cy, w: cw, h: ch, rotation: cr };
          const world = applyGroupTransform(local, g);
          const back = normalizeToGroupLocal(world, g);
          expect(back.x).toBeCloseTo(local.x, 3);
          expect(back.y).toBeCloseTo(local.y, 3);
          expect(back.w).toBeCloseTo(local.w, 3);
          expect(back.h).toBeCloseTo(local.h, 3);
        },
      ),
      { numRuns: 200 },
    );
  });
});
```

- [ ] **1.6** Run the property test; expect PASS within 1–2s. If `fast-check` is not yet a dep, add `fast-check@^3` to `packages/slides/devDependencies` (already used in `model/frame.ts` tests; check `package.json`).

- [ ] **1.7** Run `pnpm verify:fast`. Expect PASS (no other code touched yet).

- [ ] **1.8** Commit:

```bash
git add packages/slides/src/model/element.ts \
        packages/slides/src/model/group.ts \
        packages/slides/src/index.ts \
        packages/slides/test/model/group.test.ts
git commit -m "$(cat <<'EOF'
Add GroupElement type and transform helpers

Introduces the recursive Element variant required for slides
grouping along with applyGroupTransform / normalizeToGroupLocal
wrappers built on the existing PPTX import quadratic-solver. No
behavior change yet — store mutations, renderer, hit-test and
import paths still treat groups as inert.
EOF
)"
```

---

## Task 2 — `MemSlidesStore.group()`

**Files:**

- Modify: `packages/slides/src/store/store.ts` (add interface methods)
- Modify: `packages/slides/src/store/memory.ts`
- Modify: `packages/slides/test/store/memory.test.ts` (or create a focused new file)

**Contract:**

```ts
interface SlidesStore {
  // … existing methods …
  group(
    slideId: string,
    elementIds: string[],
  ): { groupId: string; excludedConnectorIds: string[] };
  ungroup(slideId: string, groupId: string): string[];
}
```

Task 2 returns `excludedConnectorIds: []` from the start; Task 11 fills it in once connector partitioning is implemented. This avoids a breaking return-type change between tasks.

`group()` invariants:

1. `elementIds.length >= 2`.
2. All ids resolve to existing elements on `slideId`.
3. All resolved elements share the **same parent** (slide root or the same group). Throws if mixed.
4. No candidate carries a `placeholderRef` (placeholders are layout slots — slide-direct only). Throws with `placeholderRef cannot be grouped`.
5. No id may be a `GroupElement` that is an ancestor of itself in the candidate set (cycle prevention; impossible here because all candidates share a parent).
6. Inserts a new group at the position of the **front-most** selected child in the parent array. Children move into the group in their original z-order.

Frame math:

- The new group's `frame` is the **world-AABB** of the candidate children's world frames (rotation-aware union), with `rotation = 0`, `flipH = false`, `flipV = false`.
- Children's new local frames are computed by `normalizeToGroupLocal(childWorldFrame, newGroup)`.

- [ ] **2.1** Extend `SlidesStore` interface (`packages/slides/src/store/store.ts`) with `group` and `ungroup` signatures.

- [ ] **2.2** Write failing tests in `packages/slides/test/store/group-mutations.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MemSlidesStore } from '../../src/store/memory';
import type { ShapeElement } from '../../src/model/element';

function newStoreWithShapes(shapes: ShapeElement[]): MemSlidesStore {
  const store = new MemSlidesStore();
  const slideId = store.addSlide('blank', 0);
  for (const s of shapes) {
    store.addElement(slideId, {
      type: 'shape',
      frame: s.frame,
      data: s.data,
    });
  }
  return store;
}

describe('group()', () => {
  it('requires at least two elements', () => {
    const store = new MemSlidesStore();
    const sid = store.addSlide('blank', 0);
    const a = store.addElement(sid, { type: 'shape', frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 }, data: { kind: 'rect' } });
    expect(() => store.group(sid, [a])).toThrow();
  });

  it('groups two slide-root shapes and replaces them with one GroupElement', () => {
    const store = new MemSlidesStore();
    const sid = store.addSlide('blank', 0);
    const a = store.addElement(sid, { type: 'shape', frame: { x: 10, y: 10, w: 20, h: 20, rotation: 0 }, data: { kind: 'rect' } });
    const b = store.addElement(sid, { type: 'shape', frame: { x: 40, y: 50, w: 30, h: 10, rotation: 0 }, data: { kind: 'rect' } });

    const { groupId } = store.group(sid, [a, b]);

    const slide = store.read().slides[0];
    expect(slide.elements).toHaveLength(1);
    expect(slide.elements[0].type).toBe('group');
    expect(slide.elements[0].id).toBe(groupId);
    const g = slide.elements[0] as import('../../src/model/element').GroupElement;
    expect(g.data.children.map(c => c.id)).toEqual([a, b]);
    // World AABB of (10,10,20,20) and (40,50,30,10) is (10,10,60,50).
    expect(g.frame).toMatchObject({ x: 10, y: 10, w: 60, h: 50, rotation: 0 });
    // Children become group-local: a→(0,0,20,20), b→(30,40,30,10).
    expect(g.data.children[0].frame).toMatchObject({ x: 0, y: 0, w: 20, h: 20 });
    expect(g.data.children[1].frame).toMatchObject({ x: 30, y: 40, w: 30, h: 10 });
  });

  it('rejects mixed parents', () => {
    const store = new MemSlidesStore();
    const sid = store.addSlide('blank', 0);
    const a = store.addElement(sid, { type: 'shape', frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 }, data: { kind: 'rect' } });
    const b = store.addElement(sid, { type: 'shape', frame: { x: 20, y: 0, w: 10, h: 10, rotation: 0 }, data: { kind: 'rect' } });
    store.group(sid, [a, b]);
    const c = store.addElement(sid, { type: 'shape', frame: { x: 100, y: 0, w: 10, h: 10, rotation: 0 }, data: { kind: 'rect' } });
    // `a` is now inside the group, `c` is at slide-root → mixed parents.
    expect(() => store.group(sid, [a, c])).toThrow(/same parent/i);
  });

  it('inserts the group at the front-most selected element position', () => {
    const store = new MemSlidesStore();
    const sid = store.addSlide('blank', 0);
    const a = store.addElement(sid, { type: 'shape', frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 }, data: { kind: 'rect' } });
    const b = store.addElement(sid, { type: 'shape', frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 }, data: { kind: 'rect' } });
    const c = store.addElement(sid, { type: 'shape', frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 }, data: { kind: 'rect' } });
    store.group(sid, [a, c]); // skip b
    const slide = store.read().slides[0];
    // a and c become children; the group takes c's position (front-most).
    expect(slide.elements.map(e => e.type)).toEqual(['shape', 'group']);
    expect(slide.elements[0].id).toBe(b);
  });
});
```

- [ ] **2.3** Run: `pnpm --filter @wafflebase/slides test test/store/group-mutations.test.ts`. Expect: all FAIL with "store.group is not a function".

- [ ] **2.4** Implement `group()` in `MemSlidesStore`. Sketch:

```ts
group(slideId: string, elementIds: string[]): string {
  if (elementIds.length < 2) {
    throw new Error('group() requires at least 2 elements');
  }
  return this.batch(() => {
    const slide = this.requireSlide(slideId);
    // 1. Resolve paths; verify same parent.
    const paths = elementIds.map(id => {
      const p = findElementPath(slide.elements, id);
      if (!p) throw new Error(`element ${id} not found on slide ${slideId}`);
      return p;
    });
    const parentSig = (p: Element[]) =>
      p.length === 1 ? '@slide' : p[p.length - 2].id;
    const parents = new Set(paths.map(parentSig));
    if (parents.size !== 1) {
      throw new Error('group() requires elements to share the same parent');
    }
    const parentArr = paths[0].length === 1
      ? slide.elements
      : (paths[0][paths[0].length - 2] as GroupElement).data.children;

    const targets = paths.map(p => p[p.length - 1]);
    // 2. Compute world-AABB across the candidates' world frames.
    const ancestorMatrix = this.composeAncestorMatrix(paths[0]);
    const worldFrames = targets.map((t, i) =>
      applyAncestorMatrix(t.frame, this.composeAncestorMatrix(paths[i])),
    );
    const aabb = computeAabb(worldFrames);
    // 3. Build the new group element.
    const groupId = generateId();
    const newGroup: GroupElement = {
      id: groupId,
      type: 'group',
      frame: { ...aabb, rotation: 0 },
      data: { children: [] },
    };
    // 4. Re-frame each target into group-local, in z-order.
    const inOrder = targets
      .map((t, i) => ({ el: t, idx: parentArr.indexOf(t) }))
      .sort((a, b) => a.idx - b.idx);
    newGroup.data.children = inOrder.map(({ el }) =>
      withFrame(el, normalizeToGroupLocal(applyAncestorMatrix(el.frame, this.composeAncestorMatrix(findElementPath(slide.elements, el.id)!)), newGroup)),
    );
    // 5. Remove the targets from parentArr; insert the group at the
    //    front-most (highest-index) original position.
    const frontMostIdx = inOrder[inOrder.length - 1].idx;
    for (let i = parentArr.length - 1; i >= 0; i--) {
      if (targets.some(t => t.id === parentArr[i].id)) parentArr.splice(i, 1);
    }
    parentArr.splice(frontMostIdx - (inOrder.length - 1), 0, newGroup);
    this.markDirty(slideId);
    return groupId;
  });
}
```

Helpers `composeAncestorMatrix`, `applyAncestorMatrix`, `computeAabb`, and `withFrame` live next to the mutation in `memory.ts` (or in `model/group.ts` if reused later). `computeAabb` produces a rotation-aware bbox by collecting the 4 corners of each world frame and taking min/max — `frame.ts` already has `rotatedCorners`; reuse it.

- [ ] **2.5** Run the group tests again. Expect PASS.

- [ ] **2.6** Add a test for grouping inside an already-existing group (i.e., shared parent is a group, not slide root). Expect children to be re-grouped into a nested group whose `frame` is in the parent group's local coordinate space.

- [ ] **2.7** Run `pnpm --filter @wafflebase/slides test`. Expect: all existing tests still PASS.

- [ ] **2.8** Commit:

```bash
git add packages/slides/src/store/store.ts \
        packages/slides/src/store/memory.ts \
        packages/slides/test/store/group-mutations.test.ts
git commit -m "Add MemSlidesStore.group() with shared-parent validation"
```

---

## Task 3 — `MemSlidesStore.ungroup()`

**Files:**

- Modify: `packages/slides/src/store/memory.ts`
- Modify: `packages/slides/test/store/group-mutations.test.ts`

**Contract:**

`ungroup(slideId, groupId): ID[]`

1. Look up the group. Throw if not found or if the element is not `type: 'group'`.
2. For each child, compute its **world-frame relative to the group's parent** (not the slide root). This means bake the group's transform but stop there — if the group is itself nested inside another group, the children land back in that enclosing group's local space.
3. Replace the group in the parent array with its children, **in order**, at the same z-position.
4. Return the list of child ids for selection restoration.

Edge case: a group with only one child after some prior mutation is already in an inconsistent state per the spec — `ungroup` handles it identically.

- [ ] **3.1** Write failing tests:

```ts
describe('ungroup()', () => {
  it('flattens a group back into the parent at the same z-position', () => {
    const store = new MemSlidesStore();
    const sid = store.addSlide('blank', 0);
    const a = store.addElement(sid, { type: 'shape', frame: { x: 10, y: 10, w: 20, h: 20, rotation: 0 }, data: { kind: 'rect' } });
    const b = store.addElement(sid, { type: 'shape', frame: { x: 40, y: 50, w: 30, h: 10, rotation: 0 }, data: { kind: 'rect' } });
    const { groupId } = store.group(sid, [a, b]);
    const childIds = store.ungroup(sid, groupId);
    expect(childIds).toEqual([a, b]);
    const slide = store.read().slides[0];
    expect(slide.elements.map(e => e.id)).toEqual([a, b]);
    expect(slide.elements[0].frame).toMatchObject({ x: 10, y: 10, w: 20, h: 20 });
    expect(slide.elements[1].frame).toMatchObject({ x: 40, y: 50, w: 30, h: 10 });
  });

  it('preserves rotation across group-ungroup round-trip', () => {
    const store = new MemSlidesStore();
    const sid = store.addSlide('blank', 0);
    const a = store.addElement(sid, { type: 'shape', frame: { x: 100, y: 100, w: 40, h: 20, rotation: Math.PI / 6 }, data: { kind: 'rect' } });
    const b = store.addElement(sid, { type: 'shape', frame: { x: 200, y: 100, w: 40, h: 20, rotation: 0 }, data: { kind: 'rect' } });
    const { groupId } = store.group(sid, [a, b]);
    // Rotate the group.
    store.updateElementFrame(sid, groupId, { rotation: Math.PI / 4 });
    store.ungroup(sid, groupId);
    const slide = store.read().slides[0];
    // Each child should have absorbed the group's rotation in addition
    // to its own; expressed as a single composed rotation.
    expect(slide.elements[0].frame.rotation).toBeCloseTo(Math.PI / 6 + Math.PI / 4, 5);
    expect(slide.elements[1].frame.rotation).toBeCloseTo(Math.PI / 4, 5);
  });

  it('throws on missing group id', () => {
    const store = new MemSlidesStore();
    const sid = store.addSlide('blank', 0);
    expect(() => store.ungroup(sid, 'no-such-id')).toThrow();
  });
});
```

- [ ] **3.2** Run; expect FAIL.

- [ ] **3.3** Implement `ungroup()`:

```ts
ungroup(slideId: string, groupId: string): string[] {
  return this.batch(() => {
    const slide = this.requireSlide(slideId);
    const path = findElementPath(slide.elements, groupId);
    if (!path) throw new Error(`group ${groupId} not found`);
    const leaf = path[path.length - 1];
    if (leaf.type !== 'group') {
      throw new Error(`element ${groupId} is not a group`);
    }
    const parentArr = path.length === 1
      ? slide.elements
      : (path[path.length - 2] as GroupElement).data.children;
    const idx = parentArr.indexOf(leaf);
    // Bake each child through the group's own transform back into the
    // parent's space (NOT the slide root). The composed-ancestor-matrix
    // helper handles deeper nesting at the caller site (the renderer);
    // here we only collapse one level.
    const baked = leaf.data.children.map(c =>
      withFrame(c, applyGroupTransform(c.frame, leaf)),
    );
    parentArr.splice(idx, 1, ...baked);
    this.markDirty(slideId);
    return baked.map(c => c.id);
  });
}
```

- [ ] **3.4** Run; expect PASS.

- [ ] **3.5** Add a round-trip property test: group N random shapes, ungroup, assert each shape's world-frame approximates the original within 1e-3.

- [ ] **3.6** Run `pnpm --filter @wafflebase/slides test`. Expect: all PASS.

- [ ] **3.7** Commit:

```bash
git add packages/slides/src/store/memory.ts \
        packages/slides/test/store/group-mutations.test.ts
git commit -m "Add MemSlidesStore.ungroup() with one-level frame bake"
```

---

## Task 4 — Element mutations walk paths

**Files:**

- Modify: `packages/slides/src/store/memory.ts`
- Modify: `packages/slides/src/store/store.ts` (add optional `parentGroupId` to `addElement`)
- Modify: `packages/slides/test/store/memory.test.ts`

Existing mutations (`addElement`, `removeElement`, `removeElements`, `updateElementFrame`, `updateElementData`, `reorderElement`, `withTextElement`) currently scan `slide.elements` linearly. They must use `findElementPath` to locate the element regardless of group depth, and mutate the correct parent `Array`.

`addElement` gains an optional `parentGroupId` parameter; when provided, the element is appended to that group's children instead of the slide root.

- [ ] **4.1** Write a failing test for each modified method, e.g.:

```ts
it('updateElementFrame mutates the child inside a group', () => {
  const store = new MemSlidesStore();
  const sid = store.addSlide('blank', 0);
  const a = store.addElement(sid, { type: 'shape', frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 }, data: { kind: 'rect' } });
  const b = store.addElement(sid, { type: 'shape', frame: { x: 50, y: 0, w: 10, h: 10, rotation: 0 }, data: { kind: 'rect' } });
  store.group(sid, [a, b]);
  store.updateElementFrame(sid, a, { x: 5 });
  const g = store.read().slides[0].elements[0] as import('../../src/model/element').GroupElement;
  expect(g.data.children[0].frame.x).toBe(5);
});

it('addElement(parentGroupId) appends to a group', () => {
  const store = new MemSlidesStore();
  const sid = store.addSlide('blank', 0);
  const a = store.addElement(sid, { type: 'shape', frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 }, data: { kind: 'rect' } });
  const b = store.addElement(sid, { type: 'shape', frame: { x: 50, y: 0, w: 10, h: 10, rotation: 0 }, data: { kind: 'rect' } });
  const { groupId } = store.group(sid, [a, b]);
  const c = store.addElement(sid, { type: 'shape', frame: { x: 5, y: 5, w: 10, h: 10, rotation: 0 }, data: { kind: 'rect' } }, groupId);
  const g = store.read().slides[0].elements[0] as import('../../src/model/element').GroupElement;
  expect(g.data.children.map(x => x.id)).toEqual([a, b, c]);
});
```

- [ ] **4.2** Run; expect FAIL.

- [ ] **4.3** Refactor each mutation to use `findElementPath` + the appropriate parent array. Add a `walkAllElements(slide, fn)` helper if any consumer needs a flat traversal (e.g., `read()` consumers shouldn't change behavior).

- [ ] **4.4** **Empty-group auto-removal.** After any `removeElement` / `removeElements` call, if the immediate parent group now has zero children, remove that group element from its parent (recursing upward as needed). Add a test:

```ts
it('removeElement on the last group child removes the parent group', () => {
  const store = new MemSlidesStore();
  const sid = store.addSlide('blank', 0);
  const a = store.addElement(sid, { type: 'shape', frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 }, data: { kind: 'rect' } });
  const b = store.addElement(sid, { type: 'shape', frame: { x: 20, y: 0, w: 10, h: 10, rotation: 0 }, data: { kind: 'rect' } });
  const { groupId } = store.group(sid, [a, b]);
  store.removeElement(sid, a);
  store.removeElement(sid, b);
  const slide = store.read().slides[0];
  expect(slide.elements.find(e => e.id === groupId)).toBeUndefined();
});
```

- [ ] **4.5** Run all slides tests. Expect: PASS.

- [ ] **4.6** Commit:

```bash
git add packages/slides/src/store/store.ts packages/slides/src/store/memory.ts packages/slides/test/store/memory.test.ts
git commit -m "Route element mutations through findElementPath for groups"
```

---

## Task 5 — Recursive `slide-renderer.ts`

**Files:**

- Modify: `packages/slides/src/view/canvas/slide-renderer.ts`
- Modify: `packages/slides/test/view/canvas/slide-renderer.test.ts` (or create one)

**Approach:**

`paintSlide(ctx, slide)` currently iterates `slide.elements` and calls `paintElement(ctx, el)` for each. Refactor so each element is wrapped in its own `save/setTransform/restore`, and a group recurses into its children using the composed matrix.

Existing per-type painters in `element-renderer.ts`, `shape-renderer.ts`, `text-renderer.ts`, `image-renderer.ts`, `connector-renderer.ts` already assume an identity transform at entry (they translate / rotate themselves). After refactor, they instead enter with the parent transform already applied and translate / rotate relative to it — verify by inspection; if they assume identity, push that responsibility up.

```ts
function paintElement(
  ctx: CanvasRenderingContext2D,
  el: Element,
  parent: DOMMatrix,
): void {
  const self = matrixForFrame(el.frame);
  const local = parent.multiply(self);
  ctx.save();
  ctx.setTransform(local);
  try {
    if (el.type === 'group') {
      for (const child of el.data.children) {
        paintElement(ctx, child, local);
      }
    } else {
      paintLeafElement(ctx, el);
    }
  } finally {
    ctx.restore();
  }
}
```

`paintLeafElement` is the current per-type switch with the rotation / translation steps **removed** (the caller already applied them).

- [ ] **5.1** Write a failing test using a mock `CanvasRenderingContext2D` (`view/canvas/ctx-spy.ts` already exists) that paints a slide containing one group with one shape and asserts the call sequence: outer `save`, group `setTransform`, inner `save`, shape `setTransform`, shape draw, inner `restore`, outer `restore`.

- [ ] **5.2** Run; expect FAIL.

- [ ] **5.3** Refactor `slide-renderer.ts` and any leaf renderers that double-apply `frame` transforms.

- [ ] **5.4** Run the slide-renderer tests + the existing visual baselines. Expect: PASS (any baseline diffs require manual approval — note in commit body).

- [ ] **5.5** Commit:

```bash
git add packages/slides/src/view/canvas/slide-renderer.ts \
        packages/slides/src/view/canvas/element-renderer.ts \
        packages/slides/test/view/canvas/slide-renderer.test.ts
git commit -m "Recurse into GroupElement when painting a slide"
```

---

## Task 6 — Recursive `hit-test.ts` with `ancestorPath`

**Files:**

- Modify: `packages/slides/src/view/editor/hit-test.ts`
- Modify: `packages/slides/test/view/editor/hit-test.test.ts`

**Public shape:**

```ts
export interface HitResult {
  elementId: string;
  /** outer → leaf, inclusive of the hit element. */
  ancestorPath: string[];
}

export function hitTestSlide(
  point: { x: number; y: number },
  elements: Element[],
): HitResult | null;
```

Recursion: front-to-back; for each element compute the local point via inverse rotation around its center; if it is a group, recurse with the same world point (the recursion will keep transforming as it descends); else test `pointInElement(local, el)`.

- [ ] **6.1** Write failing tests:

```ts
it('hits a slide-root shape', () => {
  const a = shape('a', { x: 10, y: 10, w: 20, h: 20 });
  const r = hitTestSlide({ x: 15, y: 15 }, [a]);
  expect(r?.elementId).toBe('a');
  expect(r?.ancestorPath).toEqual(['a']);
});

it('hits a shape inside a nested rotated group', () => {
  const leaf = shape('leaf', { x: 10, y: 10, w: 20, h: 20 });
  const inner = group('inner', { x: 50, y: 50, w: 100, h: 100, rotation: Math.PI / 6 }, [leaf]);
  const outer = group('outer', { x: 100, y: 100, w: 200, h: 200 }, [inner]);
  // Compute world point of leaf center analytically; assert the hit.
  const world = applyGroupTransform(
    applyGroupTransform(leaf.frame, inner),
    outer,
  );
  const center = { x: world.x + world.w / 2, y: world.y + world.h / 2 };
  const r = hitTestSlide(center, [outer]);
  expect(r?.ancestorPath).toEqual(['outer', 'inner', 'leaf']);
});

it('returns null on empty hit', () => {
  expect(hitTestSlide({ x: 0, y: 0 }, [])).toBeNull();
});
```

- [ ] **6.2** Run; expect FAIL.

- [ ] **6.3** Implement the recursive hit-test. Use `localizePoint` from `model/frame.ts` per descent step.

- [ ] **6.4** Run. Expect PASS.

- [ ] **6.5** Property test: random nested group/shape trees and random world points; assert the returned `ancestorPath` resolves back to the same leaf via `findElementPath`.

- [ ] **6.6** Commit:

```bash
git add packages/slides/src/view/editor/hit-test.ts packages/slides/test/view/editor/hit-test.test.ts
git commit -m "Recurse hit-test through groups and return ancestor path"
```

---

## Task 7 — Snap engine sees groups as one bbox at root scope

**Files:**

- Modify: `packages/slides/src/view/editor/snap.ts`
- Modify: `packages/slides/test/view/editor/snap.test.ts`

Snap engine consumes "candidate bboxes". For a group at slide root, the bbox is the group's world AABB (compute via `rotatedCorners` of the group's own frame). Children inside a group are **not** snap candidates at slide root scope — they're only candidates when the selection is drilled in.

- [ ] **7.1** Write failing tests confirming a group's bbox is the snap candidate (not its children's world bboxes) at root scope.

- [ ] **7.2** Run; expect FAIL.

- [ ] **7.3** Adjust the candidate enumerator to short-circuit at `type === 'group'` for the root-scope variant; expose a second `collectCandidates(elements, scope)` overload for drill-in.

- [ ] **7.4** Run. Expect PASS.

- [ ] **7.5** Commit:

```bash
git add packages/slides/src/view/editor/snap.ts packages/slides/test/view/editor/snap.test.ts
git commit -m "Treat groups as opaque snap candidates at slide-root scope"
```

---

## Task 8 — Selection state machine with `scope` (drill-in)

**Files:**

- Modify: `packages/slides/src/view/editor/selection.ts`
- Modify: `packages/slides/test/view/editor/selection.test.ts`

**Shape:**

```ts
export interface SlideSelection {
  scope: string[]; // ancestor group ids, outer → inner; [] = slide root
  ids: string[];   // selected element ids at the scope level
}

export class SelectionController {
  state: SlideSelection;
  click(hit: HitResult | null, modifiers: { shift?: boolean }): void;
  doubleClick(hit: HitResult | null): void;
  escape(): void;
  selectAllAtScope(slide: Slide): void;
}
```

Behavior matches the spec's selection table (see `slides-group.md § 4`). All transitions are pure; consumers re-render based on `state`.

- [ ] **8.1** Write failing unit tests for every row in the spec table, e.g.:

```ts
it('click on slide-root element selects it', () => {
  const c = new SelectionController();
  c.click({ elementId: 'a', ancestorPath: ['a'] }, {});
  expect(c.state).toEqual({ scope: [], ids: ['a'] });
});

it('click on child of slide-root group selects the group', () => {
  const c = new SelectionController();
  c.click({ elementId: 'leaf', ancestorPath: ['g', 'leaf'] }, {});
  expect(c.state).toEqual({ scope: [], ids: ['g'] });
});

it('double-click descends one level into a group', () => {
  const c = new SelectionController();
  c.doubleClick({ elementId: 'leaf', ancestorPath: ['g', 'leaf'] });
  expect(c.state).toEqual({ scope: ['g'], ids: ['leaf'] });
});

it('double-click on a deeper descendant descends ONE level only', () => {
  const c = new SelectionController();
  c.doubleClick({ elementId: 'leaf', ancestorPath: ['outer', 'inner', 'leaf'] });
  expect(c.state).toEqual({ scope: ['outer'], ids: ['inner'] });
});

it('esc pops the scope', () => {
  const c = new SelectionController();
  c.state = { scope: ['outer', 'inner'], ids: ['leaf'] };
  c.escape();
  expect(c.state).toEqual({ scope: ['outer'], ids: [] });
});
```

- [ ] **8.2** Run; expect FAIL.

- [ ] **8.3** Implement the controller. Key rule: clicks under the current `scope` pick the descendant at `scope.length`-th ancestor; clicks outside the scope (`scope` not a prefix of `ancestorPath`) reset `scope = []` and re-evaluate the click.

- [ ] **8.4** Run. Expect PASS.

- [ ] **8.5** Commit:

```bash
git add packages/slides/src/view/editor/selection.ts packages/slides/test/view/editor/selection.test.ts
git commit -m "Add drill-in scope to SelectionController"
```

---

## Task 9 — Drag / resize / rotate honors `scope`

**Files:**

- Modify: `packages/slides/src/view/editor/interactions/*.ts`
- Modify: `packages/slides/src/view/editor/editor.ts`
- Modify: test files in `packages/slides/test/view/editor/`

For each interaction (`drag-move`, `resize`, `rotate`, `nudge`):

- The element being mutated is at `slide.elements[…]` under the current `scope` path; resolve via `findElementPath`.
- Snap candidates are siblings within the current scope (not the whole slide).
- Drag a selected group → updates the group's `frame.x/y` only.
- Resize a selected group → updates the group's `frame.w/h` only; children unaffected (visual scaling is rendering-time).
- Rotate a selected group → updates the group's `frame.rotation` only.

- [ ] **9.1** Write failing tests for each interaction inside a drill-in scope (one leaf shape inside one group).

- [ ] **9.2** Run; expect FAIL.

- [ ] **9.3** Pass the current `scope` into each interaction's frame-commit path; rewrite snap-candidate enumeration accordingly.

- [ ] **9.4** Run. Expect PASS.

- [ ] **9.5** Commit:

```bash
git add packages/slides/src/view/editor/interactions packages/slides/src/view/editor/editor.ts packages/slides/test/view/editor
git commit -m "Route drag/resize/rotate through the active selection scope"
```

---

## Task 10 — Keyboard shortcuts + context menu + toolbar entries

**Files:**

- Modify: `packages/slides/src/view/editor/shortcuts-catalog.ts`
- Modify: `packages/slides/src/view/editor/keymap.ts`
- Modify: `packages/slides/src/view/editor/context-menu.ts`
- Modify: `packages/frontend/src/app/slides/contextual-toolbar.tsx` (Arrange dropdown)
- Modify: respective test files

Add three entries to the catalog (single source per `slides-keyboard-shortcuts.md`):

| id | accelerators | action |
| --- | --- | --- |
| `slides.group` | `Mod+Alt+G` | `editor.group()` (delegates to store.group with current selection) |
| `slides.ungroup` | `Mod+Shift+Alt+G` | `editor.ungroup()` |
| `slides.scope-pop` | `Escape` (when scope ≠ []) | `editor.popScope()` |

Context menu (`view/editor/context-menu.ts`):

- On ≥2 elements at one scope selected (and no `type: 'group'` among the ids if those would be the only candidate): add **Group**.
- On a single `type: 'group'` selected: add **Ungroup**.

Toolbar (`contextual-toolbar.tsx`): Arrange dropdown gains Group / Ungroup entries above Align / Distribute / Order.

- [ ] **10.1** Add catalog entries with descriptions and matching accelerators. Tests run automatically via the catalog's uniqueness check.

- [ ] **10.2** Wire `editor.group()` / `editor.ungroup()` / `editor.popScope()` to the controller + store.

- [ ] **10.3** Write integration tests in `packages/slides/test/view/editor/keymap.test.ts` that simulate `Cmd+Alt+G` on a selection and assert a group is created.

- [ ] **10.4** Run all slides tests. Expect: PASS.

- [ ] **10.5** Commit:

```bash
git add packages/slides/src/view/editor/shortcuts-catalog.ts \
        packages/slides/src/view/editor/keymap.ts \
        packages/slides/src/view/editor/context-menu.ts \
        packages/frontend/src/app/slides/contextual-toolbar.tsx \
        packages/slides/test/view/editor
git commit -m "Wire group/ungroup shortcuts, context menu, and toolbar"
```

---

## Task 11 — Connector grouping rules

**Files:**

- Modify: `packages/slides/src/store/memory.ts` (within `group()`)
- Modify: `packages/slides/src/view/editor/editor.ts` (toast surface)
- Modify: `packages/slides/test/store/group-mutations.test.ts`

`group()` receives `elementIds` and may include connectors. Rules from spec § 7:

1. Connector with both endpoints inside the selection → joins the group; endpoint ids unchanged; free endpoints (if any) normalized to group-local.
2. Connector with one endpoint outside the selection → excluded; remains at the original parent. The store returns a `{ groupId, excludedConnectorIds: string[] }` shape so the editor can surface a toast.

Update the signature:

```ts
interface SlidesStore {
  group(slideId, elementIds): { groupId: string; excludedConnectorIds: string[] };
}
```

(Breaking the prior return type; update Task 2's callers.)

- [ ] **11.1** Write failing tests for both cases.

- [ ] **11.2** Run; expect FAIL.

- [ ] **11.3** Implement the partition step in `group()`. Update callers (`editor.ts`) to read `excludedConnectorIds` and call `editor.toast()` when non-empty.

- [ ] **11.4** Run all slides tests. Expect: PASS.

- [ ] **11.5** Commit:

```bash
git add packages/slides/src/store/memory.ts \
        packages/slides/src/store/store.ts \
        packages/slides/src/view/editor/editor.ts \
        packages/slides/test/store/group-mutations.test.ts
git commit -m "Exclude cross-group connectors from group() with a toast"
```

---

## Task 12 — `YorkieSlidesStore.group` / `ungroup`

**Files:**

- Modify: `packages/frontend/src/app/slides/yorkie-slides-store.ts`
- Modify: `packages/frontend/tests/app/slides/yorkie-slides-store.test.ts`

Adapter layer. Use `Yorkie.Array` for `children` in `GroupElement.data`. Group / ungroup operations wrap the existing batch primitive. Element-path traversal mirrors the new `findElementPath`.

- [ ] **12.1** Write failing tests asserting `YorkieSlidesStore` produces the same `read()` output as `MemSlidesStore` for the group/ungroup sequence from Task 2.

- [ ] **12.2** Run; expect FAIL.

- [ ] **12.3** Implement `group()` / `ungroup()` against the Yorkie root. For group, mutate the parent `children` Yorkie.Array: remove targets, insert a new Yorkie.Object whose `data.children` is a fresh Yorkie.Array seeded with the converted children.

- [ ] **12.4** Run. Expect PASS.

- [ ] **12.5** Commit:

```bash
git add packages/frontend/src/app/slides/yorkie-slides-store.ts \
        packages/frontend/tests/app/slides/yorkie-slides-store.test.ts
git commit -m "Implement YorkieSlidesStore.group/ungroup over nested Yorkie.Array"
```

---

## Task 13 — Multi-user convergence tests

**Files:**

- Modify: `packages/frontend/tests/app/slides/two-user-slides-yorkie.ts`
- Modify: `packages/frontend/tests/app/slides/*.test.ts` (use the helper)

Concurrent scenarios:

1. User A groups `[a, b]`; User B groups `[b, c]` at the same time. After sync, only one group survives (Yorkie.Array CRDT); the other selection should "lose" cleanly without throwing.
2. User A ungroups while User B drags a child of the same group. After sync, the child's frame is preserved in world space (group's transform was baked before the user-B move arrived).
3. User A inserts a new shape inside a group while User B reorders children. Both operations land; z-order is the Yorkie.Array's deterministic resolution.

- [ ] **13.1** Write failing tests for each scenario in a new file `packages/frontend/tests/app/slides/group-concurrency.test.ts`.

- [ ] **13.2** Run; expect FAIL or behavior mismatch.

- [ ] **13.3** Fix any divergence in `YorkieSlidesStore` so reads converge to the same final state in both peers.

- [ ] **13.4** Run `pnpm verify:integration`. Expect PASS.

- [ ] **13.5** Commit:

```bash
git add packages/frontend/tests/app/slides
git commit -m "Cover group/ungroup CRDT convergence across two peers"
```

---

## Task 14 — PPTX import preserves groups

**Files:**

- Modify: `packages/slides/src/import/pptx/group.ts`
- Modify: `packages/slides/src/import/pptx/shape.ts` (and any other call site that emits flat elements from a `<p:grpSp>`)
- Modify: `packages/slides/test/import/pptx/group-preserving.test.ts` (new)
- Modify: existing PPTX fixture snapshots

The importer's recursion currently composes `parent` with the group's matrix and walks into the group's children, emitting world-frame elements. Switch to:

1. On entering `<p:grpSp>`: compute the group's own `frame` in the parent space.
2. Recurse into the children **with `parent = IDENTITY_TRANSFORM`** (children frames are stored relative to the new group's local space; the group element itself holds the parent-space frame).
3. Convert each emitted child world frame back to group-local via `normalizeToGroupLocal(childFrame, newGroup)`.
4. Build a `GroupElement` with `data.children = recursiveResults`.

Bbox-equality invariant:

```ts
// Per leaf in the imported tree, computing world frames by walking
// the new (group-preserving) representation must equal the world
// frame that the old (flattening) code would have produced.
```

- [ ] **14.1** Add a property test: take any of the existing PPTX fixtures under `packages/slides/test/fixtures/pptx`; import once with the old flatten path (keep it under a debug flag, or temporarily duplicate the function), once with the new path. For each leaf in the new tree, walk up applying `applyGroupTransform` to land in slide-root world space and compare against the old result. Tolerance: 0.5 px.

- [ ] **14.2** Run; expect FAIL.

- [ ] **14.3** Refactor `group.ts` to emit `GroupElement` instead of flattening. Keep the matrix functions (`composeGroupTransform`, `applyGroupTransform`) for use by `normalizeToGroupLocal`.

- [ ] **14.4** Update existing fixture snapshots that asserted flat element trees. Regenerate per the snapshot tool.

- [ ] **14.5** Run all slides + frontend tests. Expect: PASS.

- [ ] **14.6** Commit:

```bash
git add packages/slides/src/import/pptx \
        packages/slides/test/import/pptx \
        packages/slides/test/fixtures
git commit -m "Preserve PPTX <p:grpSp> as GroupElement during import"
```

---

## Task 15 — Recursive PDF export

**Files:**

- Modify: `packages/slides/src/export/pdf.ts`
- Modify: `packages/slides/test/export/pdf.test.ts`

The PDF emitter walks `slide.elements` flat. Refactor to mirror `slide-renderer.paintElement`:

```ts
function emitElement(page, el, parentMatrix) {
  const local = parentMatrix.multiply(matrixForFrame(el.frame));
  page.pushGraphicsState();
  page.setTransform(local);
  if (el.type === 'group') {
    for (const child of el.data.children) emitElement(page, child, local);
  } else {
    emitLeafElement(page, el);
  }
  page.popGraphicsState();
}
```

- [ ] **15.1** Write a failing test: a slide with one rotated group containing one shape produces a PDF whose drawn bbox matches the canvas paint output. Compare via PDF parsing (the existing `pdf.test.ts` uses pdf-lib's parser) or via a `ctx-spy` cross-check.

- [ ] **15.2** Run; expect FAIL.

- [ ] **15.3** Refactor `pdf.ts` to recurse. Reuse the same transform-composition helpers.

- [ ] **15.4** Run all slides tests + `verify:browser:docker` for at least the new "group in PDF" scenario.

- [ ] **15.5** Commit:

```bash
git add packages/slides/src/export/pdf.ts packages/slides/test/export/pdf.test.ts
git commit -m "Recurse PDF export through GroupElement"
```

---

## Task 16 — Update `slides.md` and archive task

**Files:**

- Modify: `docs/design/slides/slides.md`
- Modify: `docs/tasks/active/20260517-slides-group-todo.md` (this file — final review)
- Create: `docs/tasks/active/20260517-slides-group-lessons.md`

- [ ] **16.1** In `slides.md`, move the "Group / ungroup elements (Cmd+⌥+G)" entry out of "Tracked for v2" and into a new "Shipped" section (or strike-through with a link to `slides-group.md`). Update the Non-Goals entry similarly so the doc reflects the new state.

- [ ] **16.2** Add a `lessons.md` capturing anything surprising encountered during implementation — at minimum, sub-pixel snap differences caused by recursion vs flatten paths, and any PPTX fixture that needed a new fixture-set entry.

- [ ] **16.3** Run `pnpm tasks:archive && pnpm tasks:index` to move the active task into `archive/` and refresh `docs/tasks/README.md`.

- [ ] **16.4** Commit:

```bash
git add docs/design/slides/slides.md \
        docs/tasks/active/20260517-slides-group-lessons.md \
        docs/tasks/archive/20260517-slides-group-todo.md \
        docs/tasks/archive/20260517-slides-group-lessons.md \
        docs/tasks/README.md
git commit -m "Mark slides group / ungroup shipped; archive task"
```

---

## Verification gates

- End of **Task 4** (model + store): `pnpm verify:fast` PASS.
- End of **Task 10** (drill-in UX + shortcuts): `pnpm verify:fast` PASS + manual smoke against `pnpm dev` (group two shapes, rotate the group, ungroup, redo).
- End of **Task 13** (Yorkie multi-user): `pnpm verify:integration` PASS.
- End of **Task 15** (PPTX + PDF): `pnpm verify:browser:docker` PASS for the new group scenario; visual diffs reviewed.

## Out of scope (do **not** add tasks for these)

- Group-level stroke / fill / drop shadow (v1.1).
- Cross-group connectors (v1.1; today's behavior: exclude with a toast).
- PPTX export (no PPTX export pipeline exists yet; tracked separately).
- Migration of historical flattened imports (impossible without source PPTX).
- Group-level hyperlinks (v1.1).
- Named / locked groups (out of scope).
