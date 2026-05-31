# Slides Group Selection UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the slides selection overlay visually distinguish a selected group (faint dashed outline per member) and a drilled-in child (faint dashed context box around the enclosing group) from a single object.

**Architecture:** Overlay-only change. A new pure function `groupOverlayFrames` (in `frame-space.ts`) computes the world frames for member outlines + the drill-in context box; `overlay.ts` gains two optional `OverlayOptions` fields and a shared handle-less dashed-rectangle renderer; `editor.ts`'s `repaintOverlay` wires them together. No changes to selection state, hit-test, or the double-click drill-in / `Esc` interaction.

**Tech Stack:** TypeScript, Vitest (`@vitest-environment jsdom` for DOM tests), the slides package's existing world↔local frame helpers (`toWorldFrame`, `applyGroupTransform`, `worldTightFrame`, `findElementPath`).

**Spec:** `docs/design/slides/slides-group-selection-ui.md`

---

## File Structure

- `packages/slides/src/view/editor/frame-space.ts` — **modify**: add the pure `groupOverlayFrames(slide, selectedIds, scope)` function. This is where the world-frame math lives; it already hosts `toWorldFrame` and imports the group helpers.
- `packages/slides/test/view/editor/frame-space.test.ts` — **modify**: unit tests for `groupOverlayFrames`.
- `packages/slides/src/view/editor/overlay.ts` — **modify**: add `memberOutlines?` + `contextBox?` to `OverlayOptions`, an `appendOutline` helper, and the render calls.
- `packages/slides/test/view/editor/overlay.test.ts` — **modify**: DOM tests for the new outlines.
- `packages/slides/src/view/editor/editor.ts` — **modify**: `repaintOverlay` computes and forwards the two new option values.
- `packages/slides/test/view/editor/editor.test.ts` — **modify**: integration test that selecting a group renders member outlines.

---

## Task 1: Pure frame computation (`groupOverlayFrames`)

**Files:**
- Modify: `packages/slides/src/view/editor/frame-space.ts`
- Test: `packages/slides/test/view/editor/frame-space.test.ts`

- [x] **Step 1: Write the failing tests**

Append to `packages/slides/test/view/editor/frame-space.test.ts`. The `shape`, `group`, and `slide` helpers already exist at the top of the file — reuse them. Add `groupOverlayFrames` to the existing import from `frame-space`.

Change the import block at the top of the file to:

```ts
import {
  scopeAncestorTransform,
  toWorldFrame,
  fromWorldFrame,
  groupOverlayFrames,
} from '../../../src/view/editor/frame-space';
```

Append this describe block at the end of the file:

```ts
// ---------------------------------------------------------------------------
// groupOverlayFrames
// ---------------------------------------------------------------------------

describe('groupOverlayFrames', () => {
  it('returns a world-frame outline for each direct child of a selected group', () => {
    const a = shape('a', { x: 10, y: 20, w: 30, h: 40 });
    const b = shape('b', { x: 100, y: 50, w: 25, h: 25 });
    // Group at origin with no refSize → group transform is identity, so
    // child-local frames are already world frames.
    const g = group('g', { x: 0, y: 0, w: 200, h: 200 }, [a, b]);
    const sl = slide([g]);

    const { memberOutlines, contextBox } = groupOverlayFrames(sl, ['g'], []);

    expect(contextBox).toBeUndefined();
    expect(memberOutlines).toHaveLength(2);
    expect(memberOutlines[0]).toMatchObject({ x: 10, y: 20, w: 30, h: 40 });
    expect(memberOutlines[1]).toMatchObject({ x: 100, y: 50, w: 25, h: 25 });
  });

  it('returns no member outlines for a single non-group element', () => {
    const s = shape('s', { x: 5, y: 5, w: 50, h: 50 });
    const sl = slide([s]);

    const { memberOutlines, contextBox } = groupOverlayFrames(sl, ['s'], []);

    expect(memberOutlines).toHaveLength(0);
    expect(contextBox).toBeUndefined();
  });

  it('returns no member outlines for a multi-selection', () => {
    const a = shape('a', { x: 0, y: 0, w: 10, h: 10 });
    const b = shape('b', { x: 50, y: 50, w: 10, h: 10 });
    const sl = slide([a, b]);

    const { memberOutlines } = groupOverlayFrames(sl, ['a', 'b'], []);

    expect(memberOutlines).toHaveLength(0);
  });

  it('returns the enclosing group as a world-frame context box when drilled in', () => {
    // Child exactly fills the group, so worldTightFrame returns the
    // group's own frame — making the expected context box obvious.
    const child = shape('c', { x: 0, y: 0, w: 200, h: 200 });
    const g = group('g', { x: 100, y: 100, w: 200, h: 200 }, [child]);
    const sl = slide([g]);

    // Drilled into g, child c selected.
    const { contextBox, memberOutlines } = groupOverlayFrames(sl, ['c'], ['g']);

    expect(contextBox).toBeDefined();
    expect(contextBox!.x).toBeCloseTo(100, 4);
    expect(contextBox!.y).toBeCloseTo(100, 4);
    expect(contextBox!.w).toBeCloseTo(200, 4);
    expect(contextBox!.h).toBeCloseTo(200, 4);
    // The selected child is a shape, not a group → no member outlines.
    expect(memberOutlines).toHaveLength(0);
  });

  it('returns no context box at the slide root (scope empty)', () => {
    const s = shape('s', { x: 0, y: 0, w: 10, h: 10 });
    const sl = slide([s]);

    const { contextBox } = groupOverlayFrames(sl, ['s'], []);

    expect(contextBox).toBeUndefined();
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `pnpm slides test test/view/editor/frame-space.test.ts`
Expected: FAIL — `groupOverlayFrames is not a function` / import has no such export.

- [x] **Step 3: Implement `groupOverlayFrames`**

In `packages/slides/src/view/editor/frame-space.ts`, extend the `model/group` import to add `applyGroupTransform` and `worldTightFrame`:

```ts
import {
  composeAncestorTransform,
  findElementPath,
  applyInverseMatrix,
  applyGroupTransform,
  worldTightFrame,
  IDENTITY_GROUP_TRANSFORM,
} from '../../model/group';
```

Append this function at the end of the file:

```ts
/**
 * Compute the auxiliary overlay frames that distinguish a group
 * selection from a single object. All frames are returned in world
 * (slide-root) coordinates, ready to be scaled by the host factor in
 * the overlay. Pure: no DOM, no editor state.
 *
 * - `memberOutlines`: world frames of the direct children of a
 *   singly-selected group, so the overlay can outline the group's
 *   members (PowerPoint-style). Empty unless exactly one group is
 *   selected.
 * - `contextBox`: world frame of the innermost group the user has
 *   drilled into, so the overlay can show the enclosing group as
 *   context (Google Slides-style). Undefined unless `scope` is
 *   non-empty and resolves to a group.
 */
export function groupOverlayFrames(
  slide: Slide,
  selectedIds: readonly string[],
  scope: readonly string[],
): { memberOutlines: Frame[]; contextBox: Frame | undefined } {
  let contextBox: Frame | undefined;
  if (scope.length > 0) {
    const innermostId = scope[scope.length - 1];
    const path = findElementPath(slide.elements, innermostId);
    const g = path ? path[path.length - 1] : undefined;
    if (g && g.type === 'group') {
      // worldTightFrame returns a frame in the group's own (parent =
      // scope.slice(0,-1)) space; lift it the rest of the way to world.
      contextBox = toWorldFrame(
        worldTightFrame(g).worldFrame,
        scope.slice(0, -1),
        slide,
      );
    }
  }

  const memberOutlines: Frame[] = [];
  if (selectedIds.length === 1) {
    const path = findElementPath(slide.elements, selectedIds[0]);
    const el = path ? path[path.length - 1] : undefined;
    if (el && el.type === 'group') {
      for (const child of el.data.children) {
        // child.frame is group-local → group's parent (scope) space via
        // applyGroupTransform, then scope space → world via toWorldFrame.
        memberOutlines.push(
          toWorldFrame(applyGroupTransform(child.frame, el), scope, slide),
        );
      }
    }
  }

  return { memberOutlines, contextBox };
}
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `pnpm slides test test/view/editor/frame-space.test.ts`
Expected: PASS — all `groupOverlayFrames` tests green, existing tests still green.

- [x] **Step 5: Commit**

```bash
git add packages/slides/src/view/editor/frame-space.ts packages/slides/test/view/editor/frame-space.test.ts
git commit -m "Add groupOverlayFrames for group selection overlay" -m "Pure helper computing world frames for a selected group's member outlines and the drilled-in group's context box, reusing the existing world/local frame math. No rendering yet." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Overlay rendering (`memberOutlines` + `contextBox`)

**Files:**
- Modify: `packages/slides/src/view/editor/overlay.ts`
- Test: `packages/slides/test/view/editor/overlay.test.ts`

- [x] **Step 1: Write the failing tests**

Append this describe block to `packages/slides/test/view/editor/overlay.test.ts` (the `makeOverlay`, `shape`, `SLIDE_W`, `SLIDE_H`, `HOST_SCALE` helpers already exist at the top):

```ts
describe('renderOverlay — group member outlines + context box', () => {
  it('renders one dashed, handle-less outline per memberOutlines frame', () => {
    const overlay = makeOverlay();
    renderOverlay(overlay, [shape(0, 0, 200, 200)], {
      scale: HOST_SCALE,
      slideWidth: SLIDE_W,
      slideHeight: SLIDE_H,
      memberOutlines: [
        { x: 10, y: 20, w: 30, h: 40, rotation: 0 },
        { x: 100, y: 50, w: 25, h: 25, rotation: 0 },
      ],
    });
    const outlines = overlay.querySelectorAll<HTMLDivElement>(
      '.wfb-slides-member-outline',
    );
    expect(outlines.length).toBe(2);
    for (const o of outlines) {
      expect(o.getAttribute('data-handle')).toBeNull();
      expect(o.style.pointerEvents).toBe('none');
    }
    // First outline geometry, scaled by host factor (1:1 here).
    expect(parseFloat(outlines[0].style.left)).toBe(10);
    expect(parseFloat(outlines[0].style.top)).toBe(20);
    expect(parseFloat(outlines[0].style.width)).toBe(30);
    expect(parseFloat(outlines[0].style.height)).toBe(40);
  });

  it('scales member-outline geometry by the host scale factor', () => {
    const overlay = makeOverlay();
    renderOverlay(overlay, [shape(0, 0, 200, 200)], {
      scale: 0.5,
      slideWidth: SLIDE_W,
      slideHeight: SLIDE_H,
      memberOutlines: [{ x: 10, y: 20, w: 30, h: 40, rotation: 0 }],
    });
    const o = overlay.querySelector<HTMLDivElement>(
      '.wfb-slides-member-outline',
    )!;
    expect(parseFloat(o.style.left)).toBe(5);
    expect(parseFloat(o.style.top)).toBe(10);
  });

  it('rotates a member outline via CSS transform', () => {
    const overlay = makeOverlay();
    renderOverlay(overlay, [shape(0, 0, 200, 200)], {
      scale: HOST_SCALE,
      slideWidth: SLIDE_W,
      slideHeight: SLIDE_H,
      memberOutlines: [{ x: 10, y: 10, w: 20, h: 20, rotation: Math.PI / 4 }],
    });
    const o = overlay.querySelector<HTMLDivElement>(
      '.wfb-slides-member-outline',
    )!;
    expect(o.style.transform).toBe(`rotate(${Math.PI / 4}rad)`);
  });

  it('renders exactly one handle-less context box when provided', () => {
    const overlay = makeOverlay();
    renderOverlay(overlay, [shape(0, 0, 50, 50)], {
      scale: HOST_SCALE,
      slideWidth: SLIDE_W,
      slideHeight: SLIDE_H,
      contextBox: { x: 100, y: 100, w: 200, h: 200, rotation: 0 },
    });
    const ctx = overlay.querySelectorAll<HTMLDivElement>(
      '.wfb-slides-context-box',
    );
    expect(ctx.length).toBe(1);
    expect(ctx[0].getAttribute('data-handle')).toBeNull();
    expect(ctx[0].style.pointerEvents).toBe('none');
    expect(parseFloat(ctx[0].style.left)).toBe(100);
    expect(parseFloat(ctx[0].style.width)).toBe(200);
  });

  it('paints member outlines before the resize handles (handles on top)', () => {
    const overlay = makeOverlay();
    renderOverlay(overlay, [shape(0, 0, 200, 200)], {
      scale: HOST_SCALE,
      slideWidth: SLIDE_W,
      slideHeight: SLIDE_H,
      memberOutlines: [{ x: 10, y: 10, w: 20, h: 20, rotation: 0 }],
    });
    const kids = Array.from(overlay.children);
    const outlineIdx = kids.findIndex((c) =>
      c.classList.contains('wfb-slides-member-outline'),
    );
    const handleIdx = kids.findIndex(
      (c) => c.getAttribute('data-handle') === 'nw',
    );
    expect(outlineIdx).toBeGreaterThanOrEqual(0);
    expect(handleIdx).toBeGreaterThan(outlineIdx);
  });

  it('renders no member outlines or context box by default', () => {
    const overlay = makeOverlay();
    renderOverlay(overlay, [shape(0, 0, 50, 50)], {
      scale: HOST_SCALE,
      slideWidth: SLIDE_W,
      slideHeight: SLIDE_H,
    });
    expect(
      overlay.querySelectorAll('.wfb-slides-member-outline').length,
    ).toBe(0);
    expect(overlay.querySelectorAll('.wfb-slides-context-box').length).toBe(0);
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `pnpm slides test test/view/editor/overlay.test.ts`
Expected: FAIL — no `.wfb-slides-member-outline` / `.wfb-slides-context-box` nodes are rendered (counts are 0 where >0 expected); `OverlayOptions` has no `memberOutlines` / `contextBox` (TypeScript error on the test object literals).

- [x] **Step 3: Add the options, the helper, and the render calls**

In `packages/slides/src/view/editor/overlay.ts`, add two fields to the `OverlayOptions` interface (place them after the existing `allElements?` field, before `connectorAffordance?`):

```ts
  /**
   * World frames of the direct children of a singly-selected group.
   * Rendered as faint dashed, handle-less outlines so the user can see
   * the group's members (PowerPoint-style). Empty / omitted = none.
   */
  memberOutlines?: readonly Frame[];
  /**
   * World frame of the innermost group the user has drilled into.
   * Rendered as a faint dashed, handle-less context box so the user
   * sees the enclosing group (Google Slides-style). Omitted when not
   * drilled in.
   */
  contextBox?: Frame;
```

Add the shared helper and its style constant near the other `make*` helpers (e.g. just above `function makeHandle`):

```ts
const OUTLINE_BORDER = '1px dashed rgba(58, 170, 119, 0.5)';

/**
 * Render a handle-less, non-interactive dashed rectangle at a world
 * frame. Shared by member outlines (group selected) and the drill-in
 * context box. Uses CSS rotate so rotation 0 and rotated frames share
 * one path.
 */
function appendOutline(
  overlay: HTMLDivElement,
  frame: Frame,
  scale: number,
  className: string,
): void {
  const el = document.createElement('div');
  el.className = className;
  el.style.position = 'absolute';
  el.style.left = `${frame.x * scale}px`;
  el.style.top = `${frame.y * scale}px`;
  el.style.width = `${frame.w * scale}px`;
  el.style.height = `${frame.h * scale}px`;
  if (frame.rotation) {
    el.style.transform = `rotate(${frame.rotation}rad)`;
    el.style.transformOrigin = 'center';
  }
  el.style.boxSizing = 'border-box';
  el.style.border = OUTLINE_BORDER;
  el.style.pointerEvents = 'none';
  overlay.appendChild(el);
}
```

In `renderOverlay`, insert the outline rendering immediately after the
`if (selectedElements.length === 0) return;` guard and before the
connector-selection branch:

```ts
  if (selectedElements.length === 0) return;

  // Context box (drill-in) + member outlines (group selected). Painted
  // before the selection handles below so the handles stay on top. The
  // two are mutually exclusive per element (see groupOverlayFrames), so
  // a single faint-dashed style reads correctly in both roles.
  if (options.contextBox) {
    appendOutline(
      overlay,
      options.contextBox,
      options.scale,
      'wfb-slides-context-box',
    );
  }
  if (options.memberOutlines) {
    for (const frame of options.memberOutlines) {
      appendOutline(overlay, frame, options.scale, 'wfb-slides-member-outline');
    }
  }
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `pnpm slides test test/view/editor/overlay.test.ts`
Expected: PASS — new group describe block green, all pre-existing overlay tests still green.

- [x] **Step 5: Commit**

```bash
git add packages/slides/src/view/editor/overlay.ts packages/slides/test/view/editor/overlay.test.ts
git commit -m "Render group member outlines and drill-in context box" -m "renderOverlay gains optional memberOutlines and contextBox frames, drawn as faint dashed handle-less rectangles beneath the selection handles via a shared appendOutline helper." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Wire `repaintOverlay` in the editor

**Files:**
- Modify: `packages/slides/src/view/editor/editor.ts`
- Test: `packages/slides/test/view/editor/editor.test.ts`

- [x] **Step 1: Write the failing test**

Append this describe block to `packages/slides/test/view/editor/editor.test.ts`. It defines its own `addShape` helper so it is self-contained:

```ts
describe('repaintOverlay — group selection visuals', () => {
  let editor: SlidesEditor | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
    if (editor) {
      editor.detach();
      editor = null;
    }
  });

  function addShape(
    store: MemSlidesStore,
    sid: string,
    x: number,
    y: number,
    w: number,
    h: number,
  ): string {
    let id = '';
    store.batch(() => {
      id = store.addElement(sid, {
        type: 'shape',
        frame: { x, y, w, h, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });
    });
    return id;
  }

  it('outlines each member when a group is selected', () => {
    const { canvas, overlay, store } = makeFixture();
    const sid = store.read().slides[0].id;
    const aId = addShape(store, sid, 100, 100, 50, 50);
    const bId = addShape(store, sid, 300, 100, 50, 50);
    let groupId = '';
    store.batch(() => {
      groupId = store.group(sid, [aId, bId]).groupId;
    });
    editor = initialize({
      canvas,
      overlay,
      store,
      hostWidth: 1920,
      hostHeight: 1080,
      dpr: 1,
    });
    editor.setSelection([groupId]);

    expect(
      overlay.querySelectorAll('.wfb-slides-member-outline').length,
    ).toBe(2);
    // The group itself still gets resize handles.
    expect(overlay.querySelector('[data-handle="nw"]')).not.toBeNull();
  });

  it('does not outline members for a single non-group element', () => {
    const { canvas, overlay, store } = makeFixture();
    const sid = store.read().slides[0].id;
    const id = addShape(store, sid, 100, 100, 50, 50);
    editor = initialize({
      canvas,
      overlay,
      store,
      hostWidth: 1920,
      hostHeight: 1080,
      dpr: 1,
    });
    editor.setSelection([id]);

    expect(
      overlay.querySelectorAll('.wfb-slides-member-outline').length,
    ).toBe(0);
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm slides test test/view/editor/editor.test.ts`
Expected: FAIL — `.wfb-slides-member-outline` count is 0 (expected 2) because `repaintOverlay` does not yet pass `memberOutlines`.

- [x] **Step 3: Wire `groupOverlayFrames` into `repaintOverlay`**

In `packages/slides/src/view/editor/editor.ts`, extend the `frame-space` import:

```ts
import { toWorldFrame, fromWorldFrame, groupOverlayFrames } from './frame-space';
```

In `repaintOverlay`, after the `const selected = ...` block and before the
`renderOverlay(this.options.overlay, selected, { ... })` call (the one
that passes `allElements`), compute the overlay frames:

```ts
    const { memberOutlines, contextBox } = groupOverlayFrames(
      slide,
      this.selection.get(),
      scope,
    );
```

Then add the two fields to that same `renderOverlay` options object
(alongside `permanentGuides` / `pendingGuide`):

```ts
      memberOutlines,
      contextBox,
```

- [x] **Step 4: Run the test to verify it passes**

Run: `pnpm slides test test/view/editor/editor.test.ts`
Expected: PASS — both new tests green, all pre-existing editor tests still green.

- [x] **Step 5: Commit**

```bash
git add packages/slides/src/view/editor/editor.ts packages/slides/test/view/editor/editor.test.ts
git commit -m "Feed group overlay frames into repaintOverlay" -m "repaintOverlay computes member outlines and the drill-in context box via groupOverlayFrames and forwards them to renderOverlay, so a selected group and a drilled-in child are now visually distinct from a single object." -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Verify, smoke-test, and capture lessons

**Files:**
- Modify: `docs/tasks/active/20260526-slides-group-selection-ui-lessons.md`

- [x] **Step 1: Run the fast verification gate**

Run: `pnpm verify:fast`
Expected: PASS — lint + typecheck + all unit tests across packages green.

- [x] **Step 2: Manual smoke in the running app**

With `pnpm dev` running, open a presentation, draw two shapes, group them (`Cmd/Ctrl+Alt+G`), and confirm:
- Selecting the group shows the solid box + handles **plus a faint dashed outline on each member**.
- Double-clicking a member drills in: the child gets the solid box + handles **plus a faint dashed context box** around the group.
- `Esc` pops back out to the plain group selection.
- A single ungrouped shape looks exactly as before (no outlines).
- Korean IME still composes correctly when editing a grouped text box (regression guard from slides-group.md).

- [x] **Step 3: Update the visual baseline (optional, requires Docker)**

If the group scenario in the browser suite changed visibly:
Run: `pnpm verify:browser:docker`
Regenerate and review the group-selected + drilled-in baselines in a single commit with a clear note.

- [x] **Step 4: Capture lessons + archive**

Write findings into `docs/tasks/active/20260526-slides-group-selection-ui-lessons.md`, then:

```bash
pnpm tasks:index
git add docs/tasks
git commit -m "Capture lessons for group selection UI task" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

(Run `pnpm tasks:archive && pnpm tasks:index` only after the PR merges, per the project workflow.)

---

## Self-Review

**Spec coverage:**
- "Group selected → member outlines" → Task 1 (`memberOutlines` computation) + Task 2 (rendering) + Task 3 (wiring). ✓
- "Drilled-in child → context box" → Task 1 (`contextBox` computation) + Task 2 (rendering) + Task 3 (wiring). ✓
- "Single shared 1px dashed rgba(58,170,119,0.5), no handles, pointer-events none, drawn under handles" → Task 2 (`appendOutline`, `OUTLINE_BORDER`, paint order test). ✓
- "Member outlines only for an exactly-single selected group" → Task 1 (`selectedIds.length === 1` + `type === 'group'`), tested in Task 1 (multi-select + non-group cases). ✓
- "Rotation handled via CSS rotate" → Task 2 (`appendOutline` transform + rotated test). ✓
- "No interaction / selection-state changes" → no task touches `selection.ts`, hit-test, or interactions. ✓
- "Reuse existing frame math" → Task 1 uses `toWorldFrame`, `applyGroupTransform`, `worldTightFrame`, `findElementPath`. ✓
- Testing strategy (overlay unit, editor unit, visual) → Tasks 1–4. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every command has expected output.

**Type consistency:** `groupOverlayFrames(slide, selectedIds, scope)` returns `{ memberOutlines: Frame[]; contextBox: Frame | undefined }` — same shape consumed in Task 3 and matching the `OverlayOptions` fields (`memberOutlines?: readonly Frame[]`, `contextBox?: Frame`) added in Task 2. Class names `wfb-slides-member-outline` / `wfb-slides-context-box` are identical across Tasks 2 and 3. Helper `appendOutline` signature is consistent between definition and call sites.
