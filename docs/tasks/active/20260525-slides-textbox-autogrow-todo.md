# Slides Text Box — Insert-to-Edit + Drag Sizing + Auto-Grow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make slides text boxes behave like Google Slides — inserting one
drops the caret straight into edit mode, the box can be drawn by dragging,
and its height fits the content (grow + shrink) live while typing.

**Architecture:** The docs text engine gains a height-change callback
(`onContentHeightChange`) plus a `setContentHeight()` setter. The slides
text-box wrapper resizes its editing container/canvas live on each height
change and reports the logical height back to the slides editor, which
persists the final height into the element frame **at commit time** (in the
same `batch` as the text write — one undo entry, no per-keystroke CRDT
churn). The slides editor enters edit mode immediately after a text insert,
and text insert uses the same click-vs-drag rect logic as shapes.

**Tech Stack:** TypeScript, Vitest (jsdom), `@wafflebase/docs` canvas text
engine, slides Canvas editor. The slides package consumes the **built**
docs `dist/`, so docs changes must be rebuilt before the slides tasks.

**Design doc:** `docs/design/slides/slides-textbox-autogrow.md`

---

### Task 1: docs text engine — `onContentHeightChange` + `setContentHeight`

**Files:**
- Modify: `packages/docs/src/view/text-box-editor.ts`
- Test: `packages/docs/test/view/text-box-editor.test.ts`

Context: `computeLayout` already returns `layout.totalHeight`; today it is
used only internally. `renderNow` early-returns when there is no canvas 2D
context (the docs jsdom test env), so the live firing is verified in the
slides package (Task 2, which runs under `test-canvas-env`). Here we only
add the API surface and verify it constructs/sets without throwing.

- [ ] **Step 1: Write the failing tests**

Add to the `describe('initializeTextBox', ...)` block in
`packages/docs/test/view/text-box-editor.test.ts`:

```ts
  it('accepts an onContentHeightChange option without throwing', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 200;
    container.appendChild(canvas);
    const onContentHeightChange = vi.fn();
    const api = initializeTextBox({
      container,
      canvas,
      blocks: [],
      contentWidth: 400,
      contentHeight: 200,
      onContentHeightChange,
    });
    // jsdom has no 2D context, so renderNow early-returns and the
    // callback never fires here — firing is covered in the slides
    // package under test-canvas-env. We only assert construction.
    expect(typeof api.setContentHeight).toBe('function');
    api.detach();
  });

  it('setContentHeight exists and does not throw', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 200;
    container.appendChild(canvas);
    const api = initializeTextBox({
      container,
      canvas,
      blocks: [],
      contentWidth: 400,
      contentHeight: 200,
    });
    expect(() => api.setContentHeight(120)).not.toThrow();
    api.detach();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @wafflebase/docs test -- text-box-editor`
Expected: FAIL — `api.setContentHeight is not a function` /
`onContentHeightChange` not a known option (TS).

- [ ] **Step 3: Add the option to `TextBoxEditorOptions`**

In `packages/docs/src/view/text-box-editor.ts`, inside the
`TextBoxEditorOptions` interface (after the `onLinkRequest?` field, ~line
115):

```ts
  /**
   * Fired after layout when the laid-out content height changes (logical
   * px). The host uses this to grow/shrink the editing surface and to
   * persist the fitted height. De-duped: only fires when the height
   * actually changes. Never fires while there is no canvas 2D context
   * (renderNow early-returns).
   */
  onContentHeightChange?: (contentHeight: number) => void;
```

- [ ] **Step 4: Add `setContentHeight` to `TextBoxEditorAPI`**

In the `TextBoxEditorAPI` interface (after `detach(): void;`, ~line 129):

```ts
  /**
   * Resize the editing surface's logical content height and repaint.
   * Layout is width-driven, so this does not re-wrap text — it only
   * changes the shim page height + canvas the editor paints into.
   */
  setContentHeight(contentHeight: number): void;
```

- [ ] **Step 5: Make `contentHeight` mutable + add the de-dupe field**

Change the destructure at the top of `initializeTextBox` (~line 253):

```ts
  const { container, canvas, contentWidth } = opts;
  let contentHeight = opts.contentHeight;
  const dpr = opts.dpr ?? 1;
  const scale = opts.scale ?? 1;
```

Add near `let renderRAF: number | null = null;` (~line 305):

```ts
  // Last content height reported via onContentHeightChange. Starts at -1
  // so the first real layout always fires once.
  let lastReportedHeight = -1;
```

- [ ] **Step 6: Fire the callback from `renderNow` after recompute**

In `renderNow`, immediately after the `recomputeLayout();` call (~line
316), insert:

```ts
    // Report height changes so the host can grow/shrink the box. Fires
    // only when the laid-out height actually changed. Lives here (post
    // recompute) so `layout.totalHeight` is fresh; renderNow already
    // early-returned above when there is no ctx, so this never fires in
    // a context-less env.
    if (layout.totalHeight !== lastReportedHeight) {
      lastReportedHeight = layout.totalHeight;
      opts.onContentHeightChange?.(layout.totalHeight);
    }
```

- [ ] **Step 7: Implement `setContentHeight` in the returned api**

In the `const api: TextBoxEditorAPI = { ... }` object, after `detach()`
(~line 552), add:

```ts
    setContentHeight(next: number): void {
      contentHeight = next;
      paginatedLayout = buildShimPaginatedLayout(layout, contentWidth, contentHeight);
      requestRender();
    },
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm --filter @wafflebase/docs test -- text-box-editor`
Expected: PASS (all existing + 2 new).

- [ ] **Step 9: Typecheck + rebuild docs dist (slides consumes dist)**

Run: `pnpm --filter @wafflebase/docs typecheck && pnpm --filter @wafflebase/docs build`
Expected: no type errors; `dist/` rebuilt so the slides package sees the
new `setContentHeight` / `onContentHeightChange`.

- [ ] **Step 10: Commit**

```bash
git add packages/docs/src/view/text-box-editor.ts packages/docs/test/view/text-box-editor.test.ts
git commit -m "Add content-height callback + setter to docs text-box editor"
```

---

### Task 2: slides wrapper — live resize + forward height

**Files:**
- Modify: `packages/slides/src/view/editor/text-box-editor.ts`
- Test: `packages/slides/test/view/editor/text-box-autogrow.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/slides/test/view/editor/text-box-autogrow.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import type { Block } from '@wafflebase/docs';
import { mountSlidesTextBox } from '../../../src/view/editor/text-box-editor';

// Drain the docs editor's rAF-scheduled renderNow (jsdom polyfills rAF
// via setTimeout; 16ms is enough to flush a frame + cursor-blink restart).
function flushRaf(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 16));
}

function para(id: string, text: string): Block {
  return { id, type: 'paragraph', inlines: [{ text, style: {} }], style: {} } as Block;
}

describe('mountSlidesTextBox auto-grow', () => {
  let overlay: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    overlay = document.createElement('div');
    overlay.style.position = 'absolute';
    document.body.appendChild(overlay);
  });

  it('reports content height and resizes the container on mount', async () => {
    const heights: number[] = [];
    const tb = mountSlidesTextBox({
      overlay,
      frame: { x: 0, y: 0, w: 400, h: 300, rotation: 0 },
      scale: 1,
      blocks: [para('p1', 'one line')],
      onCommit: () => {},
      onCancel: () => {},
      onContentHeightChange: (h) => heights.push(h),
    });
    await flushRaf();
    await flushRaf();
    expect(heights.length).toBeGreaterThan(0);
    const reported = heights[heights.length - 1];
    expect(reported).toBeGreaterThan(0);
    // Container is resized to the reported height (scale = 1).
    expect(tb.container.style.height).toBe(`${Math.max(1, Math.round(reported))}px`);
    tb.detach();
  });

  it('reports a larger height for more paragraphs', async () => {
    const oneH: number[] = [];
    const tb1 = mountSlidesTextBox({
      overlay,
      frame: { x: 0, y: 0, w: 400, h: 300, rotation: 0 },
      scale: 1,
      blocks: [para('p1', 'a')],
      onCommit: () => {},
      onCancel: () => {},
      onContentHeightChange: (h) => oneH.push(h),
    });
    await flushRaf();
    await flushRaf();
    tb1.detach();

    const fourH: number[] = [];
    const tb4 = mountSlidesTextBox({
      overlay,
      frame: { x: 0, y: 0, w: 400, h: 300, rotation: 0 },
      scale: 1,
      blocks: [para('p1', 'a'), para('p2', 'b'), para('p3', 'c'), para('p4', 'd')],
      onCommit: () => {},
      onCancel: () => {},
      onContentHeightChange: (h) => fourH.push(h),
    });
    await flushRaf();
    await flushRaf();
    expect(fourH[fourH.length - 1]).toBeGreaterThan(oneH[oneH.length - 1]);
    tb4.detach();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @wafflebase/slides test -- text-box-autogrow`
Expected: FAIL — `onContentHeightChange` not wired (heights empty) / TS
error on the option.

- [ ] **Step 3: Add the option to `MountSlidesTextBoxOptions`**

In `packages/slides/src/view/editor/text-box-editor.ts`, inside
`MountSlidesTextBoxOptions` (after `onLinkRequest?`, ~line 53):

```ts
  /**
   * Fired (logical px) when the docs editor's content height changes.
   * The wrapper has already resized its container/canvas and called
   * `setContentHeight` by the time this fires; the slides editor uses it
   * to persist the fitted frame height at commit time.
   */
  onContentHeightChange?: (contentHeight: number) => void;
```

- [ ] **Step 4: Wire the live-resize handler into `initializeTextBox`**

In `mountSlidesTextBox`, add `onContentHeightChange` to the destructure
(~line 102):

```ts
  const { overlay, frame, scale, blocks, onCommit, onCancel, onLinkRequest, onContentHeightChange } = opts;
```

Then, in the `initializeTextBox({ ... })` options object (after
`onLinkRequest,` ~line 183), add:

```ts
    onContentHeightChange: (h: number): void => {
      // Grow/shrink the editing surface to fit content. Width is fixed;
      // only height tracks. cssH is host pixels (logical * slide scale);
      // the canvas bitmap also multiplies by the browser dpr captured at
      // mount. Setting canvas.height resets the bitmap — setContentHeight
      // then schedules a repaint at the new size.
      const targetH = Math.max(1, h);
      const cssH = Math.max(1, Math.round(targetH * scale));
      container.style.height = `${cssH}px`;
      canvas.style.height = `${cssH}px`;
      canvas.height = Math.max(1, Math.round(cssH * dpr));
      api.setContentHeight(targetH);
      onContentHeightChange?.(targetH);
    },
```

(`api` is referenced lazily — this callback only fires from the docs
editor's rAF render, after `const api = initializeTextBox(...)` has been
assigned, so there is no temporal-dead-zone hazard.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @wafflebase/slides test -- text-box-autogrow`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @wafflebase/slides typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/slides/src/view/editor/text-box-editor.ts packages/slides/test/view/editor/text-box-autogrow.test.ts
git commit -m "Resize slides text-box editing surface to fit content live"
```

---

### Task 3: insert.ts — text drag sizing

**Files:**
- Modify: `packages/slides/src/view/editor/interactions/insert.ts:297-321`
- Test: `packages/slides/test/view/editor/interactions/insert.test.ts`

Behavior: text insert participates in click-vs-drag like shapes — drag
sets width + top-left, a sub-threshold drag uses `TEXT_DEFAULT_W`. Height
stays `TEXT_DEFAULT_H` at insert time (the editor's first
`onContentHeightChange` snaps it to content on commit), so the drawn
height is intentionally not retained.

- [ ] **Step 1: Write the failing tests**

Replace the `describe('buildInsertElement — text', ...)` block in
`packages/slides/test/view/editor/interactions/insert.test.ts` with:

```ts
describe('buildInsertElement — text', () => {
  it('click (no drag) → default width, height TEXT_DEFAULT_H, anchored at start', () => {
    const text = buildInsertElement('text', { x: 50, y: 50 }, { x: 50, y: 50 });
    expect(text.type).toBe('text');
    expect(text.frame).toEqual({ x: 50, y: 50, w: 400, h: 80, rotation: 0 });
  });

  it('drag → width from the drag rect, height stays TEXT_DEFAULT_H', () => {
    const text = buildInsertElement('text', { x: 10, y: 20 }, { x: 210, y: 220 });
    // Width follows the drag (200); height is NOT retained (stays 80).
    expect(text.frame).toEqual({ x: 10, y: 20, w: 200, h: 80, rotation: 0 });
  });

  it('backwards drag → top-left normalised', () => {
    const text = buildInsertElement('text', { x: 300, y: 300 }, { x: 100, y: 50 });
    expect(text.frame).toEqual({ x: 100, y: 50, w: 200, h: 80, rotation: 0 });
  });

  it('sub-threshold drag (< 4px) → treated as click → default width', () => {
    const text = buildInsertElement('text', { x: 10, y: 10 }, { x: 12, y: 12 });
    expect(text.frame).toEqual({ x: 10, y: 10, w: 400, h: 80, rotation: 0 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @wafflebase/slides test -- interactions/insert`
Expected: FAIL — drag case returns `w: 400` (current code ignores the
drag for text).

- [ ] **Step 3: Rewrite the text branch of `buildInsertElement`**

In `packages/slides/src/view/editor/interactions/insert.ts`, replace the
`if (kind === 'text') { ... }` block (lines 297-321) with:

```ts
  if (kind === 'text') {
    // Text participates in the same click-vs-drag rect logic as shapes:
    // a real drag sets the width + top-left; a sub-threshold drag uses
    // the default width. Height is NOT taken from the drag — the editor
    // fits it to content (one line) on the first layout / commit — so we
    // always seed TEXT_DEFAULT_H here.
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const isClick = dx * dx + dy * dy < CLICK_THRESHOLD_PX_SQ;
    const w = isClick ? TEXT_DEFAULT_W : Math.abs(dx);
    const x = isClick ? start.x : Math.min(start.x, end.x);
    const y = isClick ? start.y : Math.min(start.y, end.y);
    return {
      type: 'text',
      frame: { x, y, w, h: TEXT_DEFAULT_H, rotation: 0 },
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
```

(`CLICK_THRESHOLD_PX_SQ`, `TEXT_DEFAULT_W`, `TEXT_DEFAULT_H`,
`DEFAULT_TEXT_COLOR`, `DEFAULT_BLOCK_STYLE`, and `Block` are all already
imported/declared in this file.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @wafflebase/slides test -- interactions/insert`
Expected: PASS (new text cases + all existing shape cases).

- [ ] **Step 5: Commit**

```bash
git add packages/slides/src/view/editor/interactions/insert.ts packages/slides/test/view/editor/interactions/insert.test.ts
git commit -m "Support drag-to-size for slides text-box insertion"
```

---

### Task 4: editor.ts — insert-to-edit + commit-time height persist

**Files:**
- Modify: `packages/slides/src/view/editor/editor.ts`
  (text branch of `startInsert` ~1805; `enterEditMode` ~1569;
  `finishEditMode` ~1661; add a `MIN_TEXT_BOX_H` const + a
  `lastEditingContentHeight` field)
- Test: `packages/slides/test/view/editor/text-box-editor.test.ts`

- [ ] **Step 1: Write the failing tests**

First extend the mock in
`packages/slides/test/view/editor/text-box-editor.test.ts`. Add a
`fireContentHeight` method to the `MockTextBox` interface (after
`fireCancel(): void;`):

```ts
  /** Fire onContentHeightChange with a logical height. */
  fireContentHeight(h: number): void;
```

And in `makeMockMount`'s `tb` object (after `fireCancel`):

```ts
      fireContentHeight(h: number): void {
        opts.onContentHeightChange?.(h);
      },
```

Then add a new `describe` block at the end of the file:

```ts
describe('slides text-box insert-to-edit + auto-grow', () => {
  let editor: SlidesEditor | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
    if (editor) { editor.detach(); editor = null; }
  });

  it('inserting a text box enters edit mode and adds the element', () => {
    const { canvas, overlay, store } = makeFixture();
    const { mount } = makeMockMount();
    editor = initialize({
      canvas, overlay, store,
      hostWidth: 1920, hostHeight: 1080, dpr: 1,
      mountTextBox: mount,
    });
    editor.setInsertMode('text');
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 300, clientY: 200, bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 300, clientY: 200, bubbles: true }));

    const els = store.read().slides[0].elements;
    expect(els.length).toBe(1);
    expect(els[0].type).toBe('text');
    expect(editor.getEditingElementId()).toBe(els[0].id);
    // Insert mode disarms after placing.
    expect(editor.getInsertMode()).toBeNull();
  });

  it('commits the fitted content height into the element frame (one undo entry)', () => {
    const { canvas, overlay, store } = makeFixture();
    const slideId = store.read().slides[0].id;
    let elementId = '';
    store.batch(() => {
      elementId = store.addElement(slideId, {
        type: 'text',
        frame: { x: 100, y: 100, w: 400, h: 80, rotation: 0 },
        data: { blocks: [{ id: 'b1', type: 'paragraph', inlines: [{ text: 'hi', style: {} }], style: {} } as Block] },
      });
    });
    const { mount, current } = makeMockMount();
    editor = initialize({
      canvas, overlay, store,
      hostWidth: 1920, hostHeight: 1080, dpr: 1,
      mountTextBox: mount,
    });
    editor.enterTextEditing(elementId);
    // Simulate the docs editor reporting a grown content height.
    current()!.fireContentHeight(150);
    current()!.fireCommit([{ id: 'b1', type: 'paragraph', inlines: [{ text: 'hi there', style: {} }], style: {} } as Block]);

    const el = store.read().slides[0].elements.find((e) => e.id === elementId)!;
    expect(el.frame.h).toBe(150);
    // Text + height landed in one batch → one undo restores both.
    store.undo();
    const reverted = store.read().slides[0].elements.find((e) => e.id === elementId)!;
    expect(reverted.frame.h).toBe(80);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @wafflebase/slides test -- view/editor/text-box-editor`
Expected: FAIL — insert does not enter edit mode (current text branch
single-click inserts without `enterEditMode`); height is not persisted.

- [ ] **Step 3: Add the module constant + instance field**

In `packages/slides/src/view/editor/editor.ts`, add near the top-level
constants (after the `import` block, before the class):

```ts
/**
 * Floor for an auto-grown text box's frame height (logical px). Content
 * height normally exceeds this; the floor only guards against a
 * degenerate near-zero height.
 */
const MIN_TEXT_BOX_H = 24;
```

In the class field declarations (near `private editingElementId`):

```ts
  /**
   * Latest content height (logical px) reported by the active text-box
   * editor via onContentHeightChange. Null when not editing or when the
   * editor has not reported yet. Read at commit to fit the frame height.
   */
  private lastEditingContentHeight: number | null = null;
```

- [ ] **Step 4: Rewrite the text branch of `startInsert`**

Replace the `if (kind === 'text') { ... return; }` block in `startInsert`
(lines 1805-1816) with a drag flow that mirrors the shape branch but with
no ghost (an empty text box renders nothing) and enters edit mode on
release:

```ts
    if (kind === 'text') {
      // Drag-to-size like shapes, but without a ghost preview (an empty
      // text box paints nothing). On release, place the box and drop the
      // caret straight inside it — matching Google Slides.
      this.insertDragging = true;
      this.hoverPreview = null;
      let endPoint = start;
      let cancelled = false;
      const onMove = (ev: MouseEvent): void => {
        endPoint = this.clientToLogical(ev.clientX, ev.clientY);
      };
      const cleanup = (): void => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('keydown', onKey, true);
        this.insertDragging = false;
      };
      const onUp = (): void => {
        cleanup();
        if (cancelled) return;
        const init = buildInsertElement('text', start, endPoint);
        let id = '';
        this.options.store.batch(() => {
          id = this.options.store.addElement(slide.id, init);
          this.selection.set([id]);
        });
        this.setInsertMode(null);
        // enterEditMode mounts the docs text-box, repaints, and focuses.
        this.enterEditMode(slide.id, id);
      };
      const onKey = (ev: KeyboardEvent): void => {
        if (ev.key !== 'Escape') return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        cancelled = true;
        cleanup();
        this.setInsertMode(null);
        this.renderer.markDirty();
        this.render();
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('keydown', onKey, true);
      return;
    }
```

- [ ] **Step 5: Track + persist content height in `enterEditMode`**

In `enterEditMode`, capture the entry height and reset the tracker right
after the `element` null-check (~line 1578):

```ts
    const enterFrameH = element.frame.h;
    this.lastEditingContentHeight = null;
```

Add `onContentHeightChange` to the `this.mountTextBox({ ... })` options
(after `onLinkRequest: this.options.onLinkRequest,` ~line 1604):

```ts
      onContentHeightChange: (h: number): void => {
        this.lastEditingContentHeight = h;
      },
```

Extend the `onCommit` body so the fitted height lands in the same batch as
the text write. Replace the existing `store.batch(...)` call inside
`onCommit` (~line 1612-1614) with:

```ts
            this.options.store.batch(() => {
              this.options.store.withTextElement(slideId, elementId, () => next);
              const h = this.lastEditingContentHeight;
              if (h !== null) {
                const targetH = Math.max(MIN_TEXT_BOX_H, h);
                if (targetH !== enterFrameH) {
                  this.options.store.updateElementFrame(slideId, elementId, { h: targetH });
                }
              }
            });
```

- [ ] **Step 6: Reset the tracker in `finishEditMode`**

In `finishEditMode` (~line 1661), after `this.editingElementId = null;`:

```ts
    this.lastEditingContentHeight = null;
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @wafflebase/slides test -- view/editor/text-box-editor`
Expected: PASS (new insert-to-edit + auto-grow tests + all existing
wiring tests).

- [ ] **Step 8: Typecheck**

Run: `pnpm --filter @wafflebase/slides typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add packages/slides/src/view/editor/editor.ts packages/slides/test/view/editor/text-box-editor.test.ts
git commit -m "Enter edit mode on text insert; fit frame height at commit"
```

---

### Task 5: Verification + smoke

- [ ] **Step 1: Full fast gate**

Run: `pnpm verify:fast`
Expected: lint + unit tests pass across packages.

- [ ] **Step 2: Self gate (includes builds + entropy)**

Run: `pnpm verify:self`
Expected: builds pass; entropy (knip/doc-staleness) clean.

- [ ] **Step 3: Manual smoke (UI changed) in `pnpm dev`**

- Insert a text box via the toolbar, click once → caret appears inside,
  box is one line tall, typing flows immediately.
- Insert via drag → box width follows the drag, height fits content.
- Type multiple lines → box grows; delete lines → box shrinks.
- Click away → committed; reopen → height preserved.
- Insert a shape → still selected only (no auto edit-mode); double-click
  still edits text boxes.

- [ ] **Step 4: Capture lessons + archive**

Update `docs/tasks/active/20260525-slides-textbox-autogrow-lessons.md`,
then `pnpm tasks:archive && pnpm tasks:index`, commit task docs.

---

## Review

(filled in after implementation)
