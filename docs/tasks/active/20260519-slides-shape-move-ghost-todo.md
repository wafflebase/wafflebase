# Slides shape move — ghost preview + move cursor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Design doc:** [`docs/design/slides/slides-shape-move.md`](../../design/slides/slides-shape-move.md)

**Goal:** When a shape is selected, hover shows a `move` cursor. Drag
moves a translucent ghost of the shape (at `GHOST_ALPHA`) while the
original shape and selection handles stay anchored to their starting
frame. On `pointerup`, the shape commits to the ghost's position.

**Architecture:** Extend the existing ghost-rendering path in
`slide-renderer.ts` (already used by the shape-insert hover preview)
from a single `ghost?: Element` to a `ghosts?: ReadonlyArray<Element>`.
In the editor, add a `paintMoveGhost()` method that calls
`forceRender(originalSlide, doc, ghosts)` and routes `snapGuides`
through `renderOverlay` against the **original** frames (so handles
don't move with the ghost). `startDrag()` switches from the current
synthesized-slide `paintLive` path to `paintMoveGhost`. `paintLive` is
left untouched because it is still used by resize/rotate/adjustment
flows where seeing the live frame is the correct affordance. Hover
cursor is set inside the existing `pointermove` listener on the canvas,
gated on `pointerType === 'mouse'` and cached to avoid layout thrash.

**Tech Stack:** TypeScript, Vitest + jsdom, Canvas 2D, existing
`createCtxSpy` test harness.

**Out of scope for this PR (tracked as follow-ups):**

- Connector live re-routing during ghost drag (connectors stay attached
  to their original endpoints during the preview)
- ESC mid-drag cancel
- Alt-drag clone
- Keyboard-nudge ghosting

---

## Chunk 1: Renderer accepts a ghost array

### Task 1: Extend `drawSlide` / `forceRender` to take `ghosts?: ReadonlyArray<Element>`

**Files:**
- Modify: `packages/slides/src/view/canvas/slide-renderer.ts:79-83` (`forceRender` signature)
- Modify: `packages/slides/src/view/canvas/slide-renderer.ts:92-162` (`drawSlide` signature + ghost loop)
- Test: `packages/slides/test/view/canvas/slide-renderer.test.ts` (new file)

The existing API takes a single optional `ghost?: Element`. Generalize
to `ghosts?: ReadonlyArray<Element>` so the drag-move path can hand
multiple ghosts in one pass while the existing hover-preview path passes
a single-element array.

- [ ] **Step 1: Write the failing test**

Create `packages/slides/test/view/canvas/slide-renderer.test.ts`. We
use `MemSlidesStore` to build a real `SlidesDocument` (mirroring
`editor.test.ts`) so the test won't break if `drawSlide`'s internal
theme / background lookup gains new doc requirements.

```typescript
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import { asCtx, createCtxSpy } from '../../../src/view/canvas/ctx-spy';
import { drawSlide } from '../../../src/view/canvas/slide-renderer';
import { MemSlidesStore } from '../../../src/store/memory';
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../../../src/model/presentation';
import type { Element } from '../../../src/model/element';

function buildDoc() {
  const store = new MemSlidesStore();
  let elementId = '';
  store.batch(() => {
    const sid = store.addSlide('blank');
    elementId = store.addElement(sid, {
      type: 'shape',
      frame: { x: 100, y: 100, w: 200, h: 100, rotation: 0 },
      data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
    });
  });
  const doc = store.read();
  const slide = doc.slides[0];
  return { doc, slide, elementId };
}

function makeGhost(id: string, x: number): Element {
  return {
    id,
    type: 'shape',
    frame: { x, y: 100, w: 100, h: 100, rotation: 0 },
    data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
  } as Element;
}

describe('drawSlide ghosts', () => {
  it('each ghost adds one matched save/restore pair on top of the baseline', () => {
    const { doc, slide } = buildDoc();
    const opts = { hostWidth: SLIDE_WIDTH, hostHeight: SLIDE_HEIGHT, dpr: 1 };

    const baseline = createCtxSpy();
    drawSlide(asCtx(baseline), slide, doc, opts);

    const twoGhosts = createCtxSpy();
    drawSlide(
      asCtx(twoGhosts),
      slide,
      doc,
      opts,
      () => undefined,
      [makeGhost('g1', 300), makeGhost('g2', 600)],
    );

    expect(twoGhosts.save.mock.calls.length).toBe(
      baseline.save.mock.calls.length + 2,
    );
    expect(twoGhosts.restore.mock.calls.length).toBe(
      baseline.restore.mock.calls.length + 2,
    );
  });

  it('omitting ghosts equals an empty array', () => {
    const { doc, slide } = buildDoc();
    const opts = { hostWidth: SLIDE_WIDTH, hostHeight: SLIDE_HEIGHT, dpr: 1 };

    const omitted = createCtxSpy();
    const empty = createCtxSpy();
    drawSlide(asCtx(omitted), slide, doc, opts);
    drawSlide(asCtx(empty), slide, doc, opts, () => undefined, []);

    expect(omitted.save.mock.calls.length).toBe(empty.save.mock.calls.length);
    expect(omitted.restore.mock.calls.length).toBe(empty.restore.mock.calls.length);
  });
});
```

- [ ] **Step 2: Run the test — confirm it fails**

Run: `pnpm --filter @wafflebase/slides test slide-renderer`
Expected: TypeScript error or runtime failure because `drawSlide` still
takes `ghost?: Element` (single), not an array.

- [ ] **Step 3: Update `slide-renderer.ts` to accept an array**

In `packages/slides/src/view/canvas/slide-renderer.ts`, change the
`forceRender` signature and the `drawSlide` signature + ghost loop.

Replace lines 69–84 (`forceRender` doc block + method):

```typescript
  /**
   * Paint unconditionally (bypass the dirty check). Used by interaction
   * live-paint paths in the editor that need to draw an in-memory
   * frame override on every mousemove without committing to the store.
   *
   * `ghosts` — optional elements drawn on top of the committed slide at
   * `GHOST_ALPHA`. Used by the shape-insert hover preview (single
   * element) and the shape-move drag preview (one per selected element).
   * Kept out of `slide` so the ghost never participates in selection,
   * hit-test, or z-order.
   */
  forceRender(
    slide: Slide,
    doc: SlidesDocument,
    ghosts?: ReadonlyArray<Element>,
  ): void {
    this.dirty = true;
    drawSlide(this.ctx, slide, doc, this.options, () => this.markDirty(), ghosts);
    this.dirty = false;
  }
```

Replace lines 92–99 (`drawSlide` signature):

```typescript
export function drawSlide(
  ctx: CanvasRenderingContext2D,
  slide: Slide,
  doc: SlidesDocument,
  options: SlideRendererOptions,
  onAssetLoad: () => void = () => undefined,
  ghosts?: ReadonlyArray<Element>,
): void {
```

Replace lines 151–161 (single-ghost block):

```typescript
  if (ghosts !== undefined && ghosts.length > 0) {
    // Paint hover/drag-preview ghosts on top of the committed slide so
    // their semi-transparency reveals the underlying content. One
    // save/restore band per ghost keeps `globalAlpha` writes scoped
    // and isolates any future per-ghost style overrides.
    for (const ghost of ghosts) {
      ctx.save();
      ctx.globalAlpha = GHOST_ALPHA;
      drawElement(ctx, ghost, doc, theme, onAssetLoad, elementsLookup);
      ctx.restore();
    }
  }
```

- [ ] **Step 4: Update the existing `paintWithHoverGhost` caller**

In `packages/slides/src/view/editor/editor.ts:1219`, change the
single-element call to pass an array:

```typescript
    this.renderer.forceRender(slide, this.options.store.read(), [ghost]);
```

- [ ] **Step 5: Run the test — confirm it passes**

Run: `pnpm --filter @wafflebase/slides test slide-renderer`
Expected: PASS (both new tests).

- [ ] **Step 6: Run the full slides suite for regressions**

Run: `pnpm --filter @wafflebase/slides test`
Expected: PASS (existing `editor.test.ts` hover-preview tests should
still pass — the array-of-one path renders identically).

- [ ] **Step 7: Commit**

```bash
git add packages/slides/src/view/canvas/slide-renderer.ts \
        packages/slides/src/view/editor/editor.ts \
        packages/slides/test/view/canvas/slide-renderer.test.ts
git commit -m "Slides: accept ghost array in drawSlide/forceRender"
```

---

## Chunk 2: Editor uses ghost rendering for drag-move

### Task 2: Add `paintMoveGhost` helper alongside `paintLive`

**Files:**
- Modify: `packages/slides/src/view/editor/editor.ts` (insert new method after `paintLive`, around line 1510)

`paintLive` synthesizes a slide with overridden frames — that's correct
for resize/rotate/adjustment where the live frame is what the user
needs to see. For drag-move we want the original slide unchanged plus
ghost overlays. Adding a sibling method keeps each call site
single-purpose.

- [ ] **Step 1: Add `paintMoveGhost` method to `SlidesEditor`**

In `packages/slides/src/view/editor/editor.ts`, insert this method
right after the existing `paintLive` (after line 1510, before
`currentSlide`):

```typescript
  /**
   * Drag-move preview: paint the slide unchanged + a translucent ghost
   * of each selected element at its dragged position. Overlay handles
   * render against the **original** frames so they stay anchored to the
   * starting position (the user reads the ghost as "where it will land"
   * and the handles as "where it started").
   *
   * Connectors are excluded from `ghosts` for v1; they keep rendering
   * at their original endpoints during the drag preview. On commit, the
   * connector's normal endpoint-lookup path re-routes them.
   */
  private paintMoveGhost(
    ghosts: ReadonlyArray<Element>,
    selectedOriginals: ReadonlyArray<Element>,
    guides: readonly SnapGuide[] = [],
  ): void {
    const slide = this.currentSlide();
    if (!slide) return;
    this.renderer.forceRender(slide, this.options.store.read(), ghosts);
    renderOverlay(this.options.overlay, selectedOriginals, {
      scale: this.scale(),
      slideWidth: SLIDE_WIDTH,
      slideHeight: SLIDE_HEIGHT,
      guides,
      allElements: slide.elements,
      connectorAffordance: this.connectorAffordance(),
    });
  }
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @wafflebase/slides exec tsc --noEmit`
Expected: PASS — `paintMoveGhost` is private and unused; TS allows
unused privates.

- [ ] **Step 3: Commit (small, reviewable)**

```bash
git add packages/slides/src/view/editor/editor.ts
git commit -m "Slides: add paintMoveGhost helper for drag-move preview"
```

---

### Task 3: Switch `startDrag` to use `paintMoveGhost`

**Files:**
- Modify: `packages/slides/src/view/editor/editor.ts:1432-1485` (`startDrag` body)
- Test: `packages/slides/test/view/editor/editor.test.ts` (add ghost-during-drag assertion)

Replace the synthesized-slide `paintLive` call with `paintMoveGhost`.
Build `ghosts` by cloning each selected element with offset frame.
Exclude connectors. Keep snap calculation untouched.

- [ ] **Step 1: Add a failing test for ghost-during-drag**

Insert this test in `packages/slides/test/view/editor/editor.test.ts`
after the existing "drag moves the selected element..." test (after
line 143). It verifies the store is **not** mutated mid-drag — only on
`pointerup` — which is the user-visible contract that ghost rendering
must preserve.

```typescript
  it('drag does not mutate the store until pointerup (ghost-only preview)', () => {
    const { canvas, overlay, store } = makeFixture();
    store.batch(() => {
      const sid = store.read().slides[0].id;
      store.addElement(sid, {
        type: 'shape',
        frame: { x: 100, y: 100, w: 200, h: 100, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    dispatchMouseDown(canvas, 200, 150);
    // Mid-drag mousemove — frame in the store must still be the original.
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 300, clientY: 220, bubbles: true }));
    const midFrame = store.read().slides[0].elements[0].frame;
    expect(midFrame.x).toBe(100);
    expect(midFrame.y).toBe(100);
    // Release commits.
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 300, clientY: 220, bubbles: true }));
    const finalFrame = store.read().slides[0].elements[0].frame;
    expect(finalFrame.x).not.toBe(100);
  });
```

- [ ] **Step 2: Run the test — confirm it passes against current code**

Run: `pnpm --filter @wafflebase/slides test editor`
Expected: PASS. (Current code already commits only at `pointerup` via
`store.batch` — the test pins the contract so the rewrite cannot
regress it.)

- [ ] **Step 3: Replace `startDrag`'s `paintLive` call with `paintMoveGhost`**

In `packages/slides/src/view/editor/editor.ts`, replace lines 1432–1485
(the entire `startDrag` body) with:

```typescript
  private startDrag(clientX: number, clientY: number): void {
    const startSlide = this.currentSlide();
    if (!startSlide) return;
    const selectedIds = new Set(this.selection.get());
    const originals = startSlide.elements.filter((el) => selectedIds.has(el.id));
    if (originals.length === 0) return;

    // Connectors are excluded from the ghost preview in v1. They keep
    // rendering at their original endpoints during the drag and re-route
    // on commit via the normal endpoint-lookup path.
    const ghostSources = originals.filter((el) => el.type !== 'connector');

    const start = this.clientToLogical(clientX, clientY);
    const otherFrames = startSlide.elements
      .filter((e) => !selectedIds.has(e.id))
      .map((e) => e.frame);
    const originalFrames = originals.map((el) => el.frame);

    // Final commit values; updated each mousemove so onUp can apply
    // them in a single batch without re-running the snap math.
    const committed = new Map<string, Frame>(
      originals.map((el) => [el.id, { ...el.frame }]),
    );

    const onMove = (ev: MouseEvent) => {
      const cur = this.clientToLogical(ev.clientX, ev.clientY);
      const rawDx = cur.x - start.x;
      const rawDy = cur.y - start.y;
      const bbox = combinedBoundingBox(originalFrames)!;
      const { dx, dy, guides } = snapDelta(
        bbox,
        rawDx,
        rawDy,
        otherFrames,
        { w: SLIDE_WIDTH, h: SLIDE_HEIGHT },
      );

      const ghosts: Element[] = ghostSources.map((el) => ({
        ...el,
        frame: { ...el.frame, x: el.frame.x + dx, y: el.frame.y + dy },
      } as Element));

      for (const el of originals) {
        committed.set(el.id, { ...el.frame, x: el.frame.x + dx, y: el.frame.y + dy });
      }

      // Original slide untouched; ghosts drawn on top at GHOST_ALPHA;
      // handles anchor to the originals.
      this.paintMoveGhost(ghosts, originals, guides);
    };
    const onUp = (_ev: MouseEvent) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      const slideId = startSlide.id;
      this.options.store.batch(() => {
        for (const [id, frame] of committed) {
          this.options.store.updateElementFrame(slideId, id, frame);
        }
      });
      this.renderer.markDirty();
      this.render();
      // Clear lingering snap-guide nodes from the last `paintMoveGhost`.
      this.repaintOverlay();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }
```

- [ ] **Step 4: Run the slides test suite**

Run: `pnpm --filter @wafflebase/slides test`
Expected: PASS — both existing drag tests (single + multi-select drag,
editor.test.ts lines 117 and 145) plus the new "no mid-drag mutation"
test.

- [ ] **Step 5: Add a ghost-array assertion test**

This test spies on the renderer to confirm `forceRender` receives a
ghost array of the right length during the drag. Add after the test
inserted in Step 1:

```typescript
  it('drag paints one ghost per selected non-connector element', () => {
    const { canvas, overlay, store } = makeFixture();
    let aId = '';
    let bId = '';
    store.batch(() => {
      const sid = store.read().slides[0].id;
      aId = store.addElement(sid, {
        type: 'shape',
        frame: { x: 100, y: 100, w: 100, h: 100, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });
      bId = store.addElement(sid, {
        type: 'shape',
        frame: { x: 400, y: 400, w: 100, h: 100, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#0a0' } },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setSelection([aId, bId]);

    // Spy on canvas 2D fillRect to count paints per mousemove. Element
    // fills each call beginPath/fill — but a much cleaner signal is the
    // overlay's selected-handles count, which equals selection size for
    // multi-select (axis-aligned bbox handles).
    dispatchMouseDown(canvas, 150, 150);
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 200, clientY: 180, bubbles: true }));
    // Selection handles still anchor to original frames — they should
    // NOT have moved with the ghost.
    const handles = overlay.querySelectorAll('[data-handle]');
    expect(handles.length).toBeGreaterThan(0);
    // Bounding-bbox top-left handle ('nw') in axis-aligned multi-select
    // sits at min(x) of selected originals: x=100, y=100.
    const nw = overlay.querySelector<HTMLDivElement>('[data-handle="nw"]')!;
    expect(parseFloat(nw.style.left)).toBeCloseTo(100 - 4, 0); // handle is centred on the corner; size 8 → offset -4
    expect(parseFloat(nw.style.top)).toBeCloseTo(100 - 4, 0);

    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 200, clientY: 180, bubbles: true }));
  });
```

- [ ] **Step 6: Run the new test**

Run: `pnpm --filter @wafflebase/slides test editor`
Expected: PASS.

If the handle-offset assertion fails because of an unrelated centring
convention, inspect the actual `style.left` value in the failure
output and adjust the `-4` offset to match — the meaningful assertion
is that the handle's left/top is anchored near `(100, 100)` (the
original position) rather than near `(150, 130)` (the dragged
position).

- [ ] **Step 7: Commit**

```bash
git add packages/slides/src/view/editor/editor.ts \
        packages/slides/test/view/editor/editor.test.ts
git commit -m "Slides: ghost preview for shape drag-move"
```

---

## Chunk 3: Move cursor on selected-shape hover

### Task 4: Show `move` cursor when hovering a selected element's bbox

**Files:**
- Modify: `packages/slides/src/view/editor/editor.ts` (extend the existing canvas `pointermove` handler at line 845)
- Test: `packages/slides/test/view/editor/editor.test.ts`

Today the `pointermove` handler only drives the insert hover preview.
Extend it: when not in insert mode and the pointer is inside a selected
element's bounding box, set `canvas.style.cursor = 'move'`. Cache the
last value so we don't write to the DOM every `mousemove`.

- [ ] **Step 1: Write a failing test**

Add to `packages/slides/test/view/editor/editor.test.ts` (near the
other cursor tests, after the `setInsertMode toggles a crosshair cursor`
test around line 91):

```typescript
  it('hover over a selected shape sets cursor to move', () => {
    const { canvas, overlay, store } = makeFixture();
    let elementId = '';
    store.batch(() => {
      const sid = store.read().slides[0].id;
      elementId = store.addElement(sid, {
        type: 'shape',
        frame: { x: 100, y: 100, w: 200, h: 100, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setSelection([elementId]);
    // Hover inside the selected shape's bbox.
    canvas.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 150, clientY: 150, pointerType: 'mouse', bubbles: true,
    }));
    expect(canvas.style.cursor).toBe('move');
    // Hover empty space — cursor returns to default.
    canvas.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 800, clientY: 500, pointerType: 'mouse', bubbles: true,
    }));
    expect(canvas.style.cursor).toBe('');
  });

  it('hover over a non-selected shape does not set move cursor', () => {
    const { canvas, overlay, store } = makeFixture();
    store.batch(() => {
      const sid = store.read().slides[0].id;
      store.addElement(sid, {
        type: 'shape',
        frame: { x: 100, y: 100, w: 200, h: 100, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    // No selection.
    canvas.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 150, clientY: 150, pointerType: 'mouse', bubbles: true,
    }));
    expect(canvas.style.cursor).toBe('');
  });

  it('move cursor logic is skipped for non-mouse pointers (touch)', () => {
    const { canvas, overlay, store } = makeFixture();
    let elementId = '';
    store.batch(() => {
      const sid = store.read().slides[0].id;
      elementId = store.addElement(sid, {
        type: 'shape',
        frame: { x: 100, y: 100, w: 200, h: 100, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setSelection([elementId]);
    canvas.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 150, clientY: 150, pointerType: 'touch', bubbles: true,
    }));
    expect(canvas.style.cursor).toBe('');
  });

  it('hover does not override the crosshair cursor in insert mode', () => {
    const { canvas, overlay, store } = makeFixture();
    let elementId = '';
    store.batch(() => {
      const sid = store.read().slides[0].id;
      elementId = store.addElement(sid, {
        type: 'shape',
        frame: { x: 100, y: 100, w: 200, h: 100, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setSelection([elementId]);
    editor.setInsertMode('rect');
    canvas.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 150, clientY: 150, pointerType: 'mouse', bubbles: true,
    }));
    expect(canvas.style.cursor).toBe('crosshair');
  });
```

- [ ] **Step 2: Run the test — confirm it fails**

Run: `pnpm --filter @wafflebase/slides test editor`
Expected: FAIL — the four new tests expect `'move'` / `''` / unchanged
`'crosshair'`, but the current handler never writes the cursor outside
insert mode.

- [ ] **Step 3: Implement hover-cursor logic**

In `packages/slides/src/view/editor/editor.ts`, find the
`onInsertHoverMove` method (starts around line 1160). Add a new
method right after it:

```typescript
  /**
   * Drag-affordance cursor. On `pointermove` over the canvas, if the
   * pointer is a mouse and we're idle (no insert mode, no text edit, no
   * handle hit), set `cursor: move` whenever the pointer is inside the
   * bbox of any selected element. Otherwise restore the default.
   *
   * Cached against `lastHoverCursor` so we only touch the DOM when the
   * value actually changes — `pointermove` fires at frame rate and
   * writing identical strings to `style.cursor` is wasted work.
   */
  private onSelectionHoverMove(e: MouseEvent): void {
    if (e.pointerType !== undefined && e.pointerType !== 'mouse') return;
    if (this.insertKind !== null) return;
    if (this.editingElementId !== null) return;
    if (this.handleAtClient(e.clientX, e.clientY) !== null) return;

    const desired = this.isPointerOverSelected(e.clientX, e.clientY) ? 'move' : '';
    if (this.lastHoverCursor === desired) return;
    this.lastHoverCursor = desired;
    this.options.canvas.style.cursor = desired;
  }

  private isPointerOverSelected(clientX: number, clientY: number): boolean {
    const slide = this.currentSlide();
    if (!slide) return false;
    const selectedIds = new Set(this.selection.get());
    if (selectedIds.size === 0) return false;
    const { x, y } = this.clientToLogical(clientX, clientY);
    for (const el of slide.elements) {
      if (!selectedIds.has(el.id)) continue;
      const f = el.frame;
      if (x >= f.x && x <= f.x + f.w && y >= f.y && y <= f.y + f.h) return true;
    }
    return false;
  }
```

Then add the `lastHoverCursor` field near the other private cursor
state (look for `private insertKind` around line 281; insert the new
field nearby):

```typescript
  private lastHoverCursor: string = '';
```

Now wire the new handler into the existing `pointermove` listener.
Find `attachInteractions` (line 822). Replace the line:

```typescript
    const onMove = (e: Event) => this.onInsertHoverMove(e as MouseEvent);
```

with:

```typescript
    const onMove = (e: Event) => {
      this.onInsertHoverMove(e as MouseEvent);
      this.onSelectionHoverMove(e as MouseEvent);
    };
```

Reset the cached cursor on `pointerleave` so a leave→re-enter cycle
always writes the new value. In the same method, find `onLeave`:

```typescript
    const onLeave = () => this.onInsertHoverLeave();
```

Replace with:

```typescript
    const onLeave = () => {
      this.onInsertHoverLeave();
      if (this.lastHoverCursor !== '' && this.insertKind === null) {
        this.options.canvas.style.cursor = '';
        this.lastHoverCursor = '';
      }
    };
```

Insert mode also needs to reset the cache. Find `setInsertMode` (line
696) and update it so that when leaving insert mode the cache is
cleared too — the existing code at line 707 already writes
`canvas.style.cursor = ''` when `kind === null`. Add one line right
after the existing `this.options.overlay.style.cursor = cursor;`:

```typescript
    if (kind === null) this.lastHoverCursor = '';
```

- [ ] **Step 4: Run the cursor tests — confirm they pass**

Run: `pnpm --filter @wafflebase/slides test editor`
Expected: PASS for the four new cursor tests AND all existing tests.

- [ ] **Step 5: Verify no flicker via assertion**

Add one more test that calls `pointermove` twice in the selected bbox
and asserts the cursor was only written once (i.e., the cache works):

```typescript
  it('repeated pointermove inside a selected shape does not re-write cursor', () => {
    const { canvas, overlay, store } = makeFixture();
    let elementId = '';
    store.batch(() => {
      const sid = store.read().slides[0].id;
      elementId = store.addElement(sid, {
        type: 'shape',
        frame: { x: 100, y: 100, w: 200, h: 100, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setSelection([elementId]);

    let writes = 0;
    const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'style')!;
    // jsdom uses CSSStyleDeclaration; intercept the cursor setter on
    // this instance only.
    const original = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(canvas.style),
      'cursor',
    );
    Object.defineProperty(canvas.style, 'cursor', {
      configurable: true,
      get() {
        return (this as unknown as { _cursor?: string })._cursor ?? '';
      },
      set(v: string) {
        (this as unknown as { _cursor?: string })._cursor = v;
        writes++;
      },
    });

    canvas.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 150, clientY: 150, pointerType: 'mouse', bubbles: true,
    }));
    canvas.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 160, clientY: 160, pointerType: 'mouse', bubbles: true,
    }));
    canvas.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 170, clientY: 160, pointerType: 'mouse', bubbles: true,
    }));

    expect(writes).toBe(1);

    // Restore (avoid bleed into other tests).
    if (original) Object.defineProperty(canvas.style, 'cursor', original);
    void desc;
  });
```

- [ ] **Step 6: Run the flicker test**

Run: `pnpm --filter @wafflebase/slides test editor`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/slides/src/view/editor/editor.ts \
        packages/slides/test/view/editor/editor.test.ts
git commit -m "Slides: move cursor on hover over selected shape"
```

---

## Chunk 4: Verification + smoke + PR

### Task 5: Pre-commit verify and manual smoke

- [ ] **Step 1: Lint + unit-test gate**

Run: `pnpm verify:fast`
Expected: PASS.

- [ ] **Step 2: Slides-specific test pass**

Run: `pnpm --filter @wafflebase/slides test`
Expected: PASS.

- [ ] **Step 3: Manual smoke in dev server**

Run: `pnpm dev` (frontend at :5173, backend at :3000).

Open a Slides document and verify:

- Single shape: select it, hover inside → cursor is `move`. Click-drag
  → original shape stays put; a translucent ghost follows the cursor;
  selection handles stay on the original. Release → shape jumps to the
  ghost's position.
- Hover outside the selected shape (empty area or unselected shape) →
  cursor returns to default.
- Multi-select (Shift-click 2 shapes): drag from inside one → both show
  ghosts at the same offset; union handles stay anchored to originals.
- Snap: drag a shape near another's edge → magenta snap guides appear
  at the ghost's snapped position.
- Text box: select, drag → ghost shows the text-box outline + text at
  reduced opacity.
- Image: select, drag → ghost shows the image at reduced opacity.
- Connector + shape: select both, drag → ghost shows for shape only;
  connector stays at original endpoints during the drag; on release,
  the connector re-routes to the shape's new position.
- Insert mode: arm `rect` → cursor `crosshair` regardless of hover over
  selected shapes (insert preview still works).

- [ ] **Step 4: If anything looks off, fix and re-test before commit**

Common gotchas:
- Selection handles drift with the ghost → `paintMoveGhost` is passing
  the wrong frames to `renderOverlay`. It must pass `originals` (the
  pre-drag elements), not ghosts or live frames.
- Ghost flicker on every frame → `forceRender` may not be receiving the
  array; double-check `ghosts` is an array, not a single element.
- Cursor flickers from `move` to default and back → cache isn't being
  consulted; check `lastHoverCursor` is on the instance not module
  scope.

---

### Task 6: Open PR

- [ ] **Step 1: Rebase on `origin/main`**

Run:
```bash
git fetch origin
git rebase origin/main
```

- [ ] **Step 2: Self code review**

Dispatch `/code-review` over the branch diff. Address blocking findings.

- [ ] **Step 3: Push branch and open PR**

Title (≤70 chars): `Slides: ghost preview + move cursor for shape drag`

Body:
```markdown
## Summary

- Drag-move on slides shapes now paints a translucent ghost (at
  `GHOST_ALPHA`) following the cursor while the original shape and
  selection handles stay anchored. Commit happens on release.
- Hover over a selected shape sets `cursor: move`.
- Extends the existing ghost path in `slide-renderer.ts` from a single
  optional element to an array; same path that already drives the
  shape-insert hover preview.

Design doc: `docs/design/slides/slides-shape-move.md`.

Connector live re-routing during the preview, ESC mid-drag cancel,
alt-drag clone, and keyboard-nudge ghosting are intentionally deferred.

## Test plan

- [x] `pnpm verify:fast`
- [x] `pnpm --filter @wafflebase/slides test`
- [x] Manual: single-shape drag → ghost shows, handles stay anchored,
      release commits.
- [x] Manual: multi-select drag → both ghosts at same offset.
- [x] Manual: snap guides appear against ghost position.
- [x] Manual: connector attached to a moved shape re-routes on commit.
- [x] Manual: insert mode's crosshair cursor is not overridden by hover.
```

---

### Task 7: Post-merge cleanup

- [ ] **Step 1: Write lessons file**

Create `docs/tasks/active/20260519-slides-shape-move-ghost-lessons.md`
with anything surprising learned during implementation (e.g., a snap
edge case, a jsdom quirk in the cursor test). One short note per
lesson; skip if nothing notable.

- [ ] **Step 2: Archive**

```bash
pnpm tasks:archive
pnpm tasks:index
```

- [ ] **Step 3: Commit + push the archive move**

```bash
git add docs/tasks/
git commit -m "Archive 20260519-slides-shape-move-ghost task"
git push
```
