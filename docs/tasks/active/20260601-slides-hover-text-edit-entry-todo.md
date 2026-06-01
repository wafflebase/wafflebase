# Slides Hover & Text-Edit Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Slides editor's idle-state hover feedback and remaining text-edit entry affordances closer to Google Slides — phased rollout across one P0 PR (this plan) and four P1/P2 follow-up PRs (roadmap at end).

**Architecture:** Hover work is purely view-state in `SlidesEditor` (no model changes): a new `hoverHighlightId` field driven by `onSelectionHoverMove`, painted as a DOM outline in `overlay.ts` alongside existing selection handles. Cursor work extends the same handler with a region predicate (text-region I-beam vs body `move`). Phases B–E touch `interactions/select.ts`, `interactions/drag.ts`, `text-box-editor.ts`, and `interactions/keyboard.ts` respectively, but share no state with Phase A.

**Tech Stack:** TypeScript, Vitest (unit), Playwright via `pnpm verify:browser:docker` (browser harness). DOM overlay (no Canvas changes).

**Spec:** [`docs/design/slides/slides-hover-and-text-edit-entry.md`](../../design/slides/slides-hover-and-text-edit-entry.md)

**Already shipped (verified during plan-writing):**
- P0.3 Enter / F2 keyboard entry — `keyboard.ts:481-500`
- P2.6 (partial) Printable-char enters edit — `keyboard.ts:514-532`; v1 caveat (first char not inserted) addressed in Phase D below

---

## Phase A — P0: Idle hover outline + text-region I-beam (this PR)

### File map for Phase A

| Action | Path | Responsibility |
|---|---|---|
| Modify | `packages/slides/src/view/editor/editor.ts` | Add `hoverHighlightId`, extend `onSelectionHoverMove`, suppress during drag/insert/edit, expose getter for overlay |
| Modify | `packages/slides/src/view/editor/overlay.ts` | New `renderHoverHighlight` helper; insert into existing overlay paint between drilled-in member outlines and snap guides |
| Modify | `packages/slides/src/view/editor/text-box-editor.ts` | Export pure helper `getTextRegionRect(element, frame)` reused by hover region predicate |
| Create | `packages/slides/test/view/editor/hover-highlight.test.ts` | Unit tests for `hoverHighlightId` state transitions and cursor region |
| Create | `packages/slides/test/view/editor/text-region-rect.test.ts` | Unit tests for `getTextRegionRect` |
| Modify | `packages/slides/test/view/editor/interactions/select.test.ts` *(if extant; else create)* | Hover-during-drag suppression check |
| Modify | `docs/design/slides/slides.md` | Append rows to Interactions table: hover, text-region cursor |
| Modify | `docs/design/slides/slides-group.md` | Cross-link hover-during-drill-in interaction |

### Task A1: `getTextRegionRect` helper + tests

**Files:**
- Modify: `packages/slides/src/view/editor/text-box-editor.ts` (add export)
- Create: `packages/slides/test/view/editor/text-region-rect.test.ts`

- [ ] **Step 1: Note baseline** — verified during plan-writing: `text-box-editor.ts` mounts the contenteditable at the **full element frame** with no padding constants. There is nothing to reuse. This task therefore introduces a **new** hover-region inset constant (`HOVER_TEXT_REGION_INSET_PX = 6`, logical px). The inset is purely a cursor affordance — it does NOT change where the text-box mounts or where text paints.

- [ ] **Step 2: Write failing test**

```ts
// packages/slides/test/view/editor/text-region-rect.test.ts
import { describe, expect, it } from 'vitest';
import { getTextRegionRect } from '../../../src/view/editor/text-box-editor';

describe('getTextRegionRect', () => {
  it('insets a text-element frame by HOVER_TEXT_REGION_INSET_PX on every side', () => {
    const frame = { x: 100, y: 200, width: 300, height: 80, rotation: 0 };
    const rect = getTextRegionRect({ type: 'text' } as never, frame);
    expect(rect).toEqual({ x: 106, y: 206, width: 288, height: 68 });
  });

  it('returns null for elements without a text body', () => {
    const frame = { x: 0, y: 0, width: 100, height: 100, rotation: 0 };
    const rect = getTextRegionRect(
      { type: 'image' } as never,
      frame,
    );
    expect(rect).toBeNull();
  });

  it('returns a region for shapes with a non-empty textBody', () => {
    const frame = { x: 0, y: 0, width: 100, height: 100, rotation: 0 };
    const rect = getTextRegionRect(
      { type: 'shape', data: { textBody: [{ type: 'paragraph', content: [] }] } } as never,
      frame,
    );
    expect(rect).not.toBeNull();
  });

  it('returns null for shapes without a textBody', () => {
    const frame = { x: 0, y: 0, width: 100, height: 100, rotation: 0 };
    const rect = getTextRegionRect(
      { type: 'shape', data: {} } as never,
      frame,
    );
    expect(rect).toBeNull();
  });
});
```

- [ ] **Step 3: Run test, expect import failure**

```bash
pnpm --filter @wafflebase/slides exec vitest run test/view/editor/text-region-rect.test.ts
```

Expected: FAIL — `getTextRegionRect` not exported.

- [ ] **Step 4: Implement and export**

Add to `packages/slides/src/view/editor/text-box-editor.ts` (export from module top-level):

```ts
import type { Element } from '../../model/element';
import type { Frame } from '../../model/frame';

/**
 * Logical-px inset applied to a text-capable element's frame when
 * computing the cursor "text region" for hover feedback. Purely a
 * cursor affordance — does NOT influence where the contenteditable
 * mounts (the box still uses the full frame).
 */
export const HOVER_TEXT_REGION_INSET_PX = 6;

export function getTextRegionRect(
  element: Pick<Element, 'type' | 'data'>,
  frame: Frame,
): { x: number; y: number; width: number; height: number } | null {
  const hasTextBody =
    element.type === 'text' ||
    (element.type === 'shape' &&
      Array.isArray((element.data as { textBody?: unknown[] }).textBody) &&
      ((element.data as { textBody: unknown[] }).textBody.length > 0));
  if (!hasTextBody) return null;
  const w = Math.max(0, frame.width - 2 * HOVER_TEXT_REGION_INSET_PX);
  const h = Math.max(0, frame.height - 2 * HOVER_TEXT_REGION_INSET_PX);
  if (w === 0 || h === 0) return null;
  return {
    x: frame.x + HOVER_TEXT_REGION_INSET_PX,
    y: frame.y + HOVER_TEXT_REGION_INSET_PX,
    width: w,
    height: h,
  };
}
```

Adjust the `Frame` import if the field name in this codebase is `w` / `h` rather than `width` / `height` (verified during plan-writing: `text-box-editor.ts` uses `frame.w` / `frame.h`). Either rename the helper's expected shape or adapt the field reads accordingly — pick whichever matches the `Frame` model type.

- [ ] **Step 5: Re-run test, expect pass**

```bash
pnpm --filter @wafflebase/slides exec vitest run test/view/editor/text-region-rect.test.ts
```

Expected: PASS — 4 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/slides/src/view/editor/text-box-editor.ts \
  packages/slides/test/view/editor/text-region-rect.test.ts
git commit -m "Slides: extract getTextRegionRect for hover-cursor reuse"
```

---

### Task A2: `hoverHighlightId` + `hoverCursorRegion` state

**Files:**
- Modify: `packages/slides/src/view/editor/editor.ts:470-495` (add field block alongside existing `hoverPreview`)
- Modify: `packages/slides/src/view/editor/editor.ts:2231-2250` (`onSelectionHoverMove`)

- [ ] **Step 1: Write failing test (state transitions only)**

```ts
// packages/slides/test/view/editor/hover-highlight.test.ts
import { describe, expect, it } from 'vitest';
import { makeEditorForTest } from './_helpers'; // see Step 2 if absent

describe('hover highlight state', () => {
  it('sets hoverHighlightId when pointer is over an unselected element', () => {
    const editor = makeEditorForTest({
      elements: [
        { id: 'a', type: 'shape', frame: { x: 0, y: 0, width: 100, height: 100, rotation: 0 } },
      ],
    });
    editor.dispatchPointerMoveAt(50, 50);
    expect(editor.getHoverHighlightId()).toBe('a');
  });

  it('clears hoverHighlightId when pointer leaves all elements', () => {
    const editor = makeEditorForTest({
      elements: [
        { id: 'a', type: 'shape', frame: { x: 0, y: 0, width: 100, height: 100, rotation: 0 } },
      ],
    });
    editor.dispatchPointerMoveAt(50, 50);
    editor.dispatchPointerMoveAt(500, 500);
    expect(editor.getHoverHighlightId()).toBeNull();
  });

  it('does NOT set hoverHighlightId for an already-selected element', () => {
    const editor = makeEditorForTest({
      elements: [
        { id: 'a', type: 'shape', frame: { x: 0, y: 0, width: 100, height: 100, rotation: 0 } },
      ],
      selection: ['a'],
    });
    editor.dispatchPointerMoveAt(50, 50);
    expect(editor.getHoverHighlightId()).toBeNull();
  });

  it('clears hoverHighlightId when entering edit mode', () => {
    const editor = makeEditorForTest({
      elements: [
        { id: 'a', type: 'text', frame: { x: 0, y: 0, width: 100, height: 100, rotation: 0 } },
      ],
    });
    editor.dispatchPointerMoveAt(50, 50);
    editor.enterEditMode('a');
    expect(editor.getHoverHighlightId()).toBeNull();
  });
});
```

- [ ] **Step 2: Check for `makeEditorForTest` helper** — if it doesn't exist, scan `packages/slides/test/view/editor/**` for the existing harness used by similar interaction tests (e.g. `selection.test.ts` or `interactions/*.test.ts`). Use the same construction; do NOT introduce a parallel helper. If the existing harness exposes a different API, adjust the test calls (e.g. `editor.pointerMove({x, y})`) to match.

- [ ] **Step 3: Run test, expect fail**

```bash
pnpm --filter @wafflebase/slides exec vitest run test/view/editor/hover-highlight.test.ts
```

Expected: FAIL — `getHoverHighlightId` does not exist.

- [ ] **Step 4: Add field + getter to `SlidesEditor`**

In `packages/slides/src/view/editor/editor.ts`, near line 479 (next to the existing `hoverPreview` field), add:

```ts
/**
 * Id of the element currently painted with an idle hover outline.
 * Distinct from `hoverPreview` (insert-mode shape ghost). Null when
 * no element is hovered, when the hover target is part of the active
 * selection, or when any drag/insert/edit interaction is live.
 */
private hoverHighlightId: string | null = null;

/** Test/overlay accessor for the hover-highlight id. */
public getHoverHighlightId(): string | null {
  return this.hoverHighlightId;
}
```

- [ ] **Step 5: Extend `onSelectionHoverMove` (line 2231)**

Replace the body of `onSelectionHoverMove` with (preserving the existing early-returns):

```ts
private onSelectionHoverMove(e: PointerEvent): void {
  if (e.pointerType !== undefined && e.pointerType !== 'mouse') return;
  if (this.insertKind !== null) {
    this.clearHoverHighlight();
    return;
  }
  if (this.editingElementId !== null) {
    this.clearHoverHighlight();
    return;
  }
  if (this.handleAtClient(e.clientX, e.clientY) !== null) {
    this.clearHoverHighlight();
    return;
  }

  const slide = this.currentSlide();
  let desired = '';
  let nextHighlightId: string | null = null;

  if (this.isPointerOverSelected(e.clientX, e.clientY)) {
    desired = this.computeSelectedHoverCursor(e.clientX, e.clientY);
  } else {
    const { x, y } = this.clientToLogical(e.clientX, e.clientY);
    const guide = hitTestGuide(this.options.store.read().guides, { x, y });
    if (guide !== null) {
      desired = guide.axis === 'x' ? 'col-resize' : 'row-resize';
    } else if (slide) {
      // Idle hover: highlight the topmost unselected hit element in the
      // current selection scope.
      const hit = hitTestSlide(slide, x, y, {
        scope: this.selection.getScope(),
      });
      if (hit && !this.selection.get().includes(hit.elementId)) {
        nextHighlightId = hit.elementId;
      }
    }
  }

  this.setHoverHighlight(nextHighlightId);
  if (this.lastHoverCursor === desired) return;
  this.lastHoverCursor = desired;
  this.options.canvas.style.cursor = desired;
}

private setHoverHighlight(next: string | null): void {
  if (this.hoverHighlightId === next) return;
  this.hoverHighlightId = next;
  this.repaintOverlay();
}

private clearHoverHighlight(): void {
  this.setHoverHighlight(null);
}

private computeSelectedHoverCursor(clientX: number, clientY: number): string {
  // Default for body of any selected element.
  return 'move';
  // Task A3 will replace this with text-region-aware logic.
}
```

- [ ] **Step 6: Wire pointer leave**

In `onInsertHoverLeave` (line 2272) and any other place that drops cursor state on canvas exit, also call `this.clearHoverHighlight()`. Search for `lastHoverCursor` and `canvas.style.cursor = ''` to find peer cleanup sites.

- [ ] **Step 7: Run test, expect pass**

```bash
pnpm --filter @wafflebase/slides exec vitest run test/view/editor/hover-highlight.test.ts
```

Expected: PASS — 4 tests.

- [ ] **Step 8: Commit**

```bash
git add packages/slides/src/view/editor/editor.ts \
  packages/slides/test/view/editor/hover-highlight.test.ts
git commit -m "Slides: track hoverHighlightId for idle-state hover feedback"
```

---

### Task A3: Text-region I-beam cursor

**Files:**
- Modify: `packages/slides/src/view/editor/editor.ts` (`computeSelectedHoverCursor`)

- [ ] **Step 1: Add failing test**

Append to `packages/slides/test/view/editor/hover-highlight.test.ts`:

```ts
describe('hover cursor over selected text-capable element', () => {
  it("uses 'text' when pointer is inside the text region", () => {
    const editor = makeEditorForTest({
      elements: [
        { id: 'a', type: 'text', frame: { x: 0, y: 0, width: 200, height: 100, rotation: 0 } },
      ],
      selection: ['a'],
    });
    editor.dispatchPointerMoveAt(100, 50); // well inside, away from border
    expect(editor.getLastHoverCursor()).toBe('text');
  });

  it("uses 'move' when pointer is on the selected element's border padding", () => {
    const editor = makeEditorForTest({
      elements: [
        { id: 'a', type: 'text', frame: { x: 0, y: 0, width: 200, height: 100, rotation: 0 } },
      ],
      selection: ['a'],
    });
    editor.dispatchPointerMoveAt(2, 2); // within text padding band
    expect(editor.getLastHoverCursor()).toBe('move');
  });

  it("stays 'move' for shapes without a textBody", () => {
    const editor = makeEditorForTest({
      elements: [
        { id: 'a', type: 'shape', data: {}, frame: { x: 0, y: 0, width: 200, height: 100, rotation: 0 } },
      ],
      selection: ['a'],
    });
    editor.dispatchPointerMoveAt(100, 50);
    expect(editor.getLastHoverCursor()).toBe('move');
  });
});
```

- [ ] **Step 2: Expose `getLastHoverCursor()` if not yet public**

In `editor.ts`, add a getter alongside `getHoverHighlightId`:

```ts
public getLastHoverCursor(): string {
  return this.lastHoverCursor;
}
```

- [ ] **Step 3: Run test, expect 2 failures (text-region cases)**

```bash
pnpm --filter @wafflebase/slides exec vitest run test/view/editor/hover-highlight.test.ts
```

Expected: 1 of 3 new tests PASS (shape-without-textBody returns `move` already), 2 FAIL (still always `move`).

- [ ] **Step 4: Implement region-aware cursor**

Replace the `computeSelectedHoverCursor` stub in `editor.ts` with:

```ts
private computeSelectedHoverCursor(clientX: number, clientY: number): string {
  const slide = this.currentSlide();
  if (!slide) return 'move';
  const selectedIds = this.selection.get();
  // Region-aware cursor only applies to a single selection. Multi-select
  // stays 'move' because there is no unambiguous element to enter.
  if (selectedIds.length !== 1) return 'move';
  const scope = this.selection.getScope();
  const el = findElement(slide.elements, selectedIds[0]);
  if (!el) return 'move';
  const worldFrame = toWorldFrame(el.frame, scope, slide);
  const region = getTextRegionRect(el, worldFrame);
  if (!region) return 'move';
  const { x, y } = this.clientToLogical(clientX, clientY);
  const inRegion =
    x >= region.x &&
    x <= region.x + region.width &&
    y >= region.y &&
    y <= region.y + region.height;
  return inRegion ? 'text' : 'move';
}
```

Import `getTextRegionRect` from `./text-box-editor`.

- [ ] **Step 5: Re-run test, expect PASS**

```bash
pnpm --filter @wafflebase/slides exec vitest run test/view/editor/hover-highlight.test.ts
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/slides/src/view/editor/editor.ts \
  packages/slides/test/view/editor/hover-highlight.test.ts
git commit -m "Slides: show I-beam cursor over selected text region"
```

---

### Task A4: Overlay paints the hover outline

**Files:**
- Modify: `packages/slides/src/view/editor/overlay.ts`

- [ ] **Step 1: Find the overlay paint entry point** — grep `overlay.ts` for the function that walks the current frame and lays out child nodes (selection box + handles + member outlines + guides). Look for a function named `renderOverlay` or similar around the line ranges flagged in the exploration report (`overlay.ts:188-204` for member outlines).

- [ ] **Step 2: Determine the insertion site** — the hover outline must paint **above** member outlines (`overlay.ts:200-204`) and **above** snap/smart guides, but **below** selection handles and connection-site dots. Identify the existing function call ordering and pick the matching insertion point.

- [ ] **Step 3: Add the helper**

In `overlay.ts`, near the other `makeXxx` / `renderXxx` helpers:

```ts
function makeHoverHighlight(
  element: Element,
  worldFrame: Frame,
  zoom: number,
  origin: { x: number; y: number },
): HTMLElement {
  const div = document.createElement('div');
  div.style.position = 'absolute';
  div.style.left = `${origin.x + worldFrame.x * zoom}px`;
  div.style.top = `${origin.y + worldFrame.y * zoom}px`;
  div.style.width = `${worldFrame.width * zoom}px`;
  div.style.height = `${worldFrame.height * zoom}px`;
  div.style.border = '1px solid rgba(26, 115, 232, 0.5)';
  div.style.boxSizing = 'border-box';
  div.style.pointerEvents = 'none';
  // Honour the element's rotation so the outline tracks rotated bboxes.
  if (worldFrame.rotation !== 0) {
    div.style.transformOrigin = '50% 50%';
    div.style.transform = `rotate(${worldFrame.rotation}deg)`;
  }
  // Tag for the browser-test harness assertion.
  div.dataset.slidesHoverHighlight = element.id;
  return div;
}
```

- [ ] **Step 4: Wire it into the overlay paint**

In the overlay render function, after member outlines / context box and before selection handles + connection-site dots, add:

```ts
const hoverId = editor.getHoverHighlightId();
if (hoverId !== null) {
  const slide = editor.currentSlide();
  if (slide) {
    const el = findElement(slide.elements, hoverId);
    if (el) {
      const worldFrame = toWorldFrame(
        el.frame,
        editor.selection.getScope(),
        slide,
      );
      overlay.appendChild(
        makeHoverHighlight(el, worldFrame, zoom, origin),
      );
    }
  }
}
```

(Replace `editor.currentSlide()` etc. with whatever the existing overlay function uses to read state.)

- [ ] **Step 5: Drilled-in-group special case**

Inside the same block, before appending the highlight, check: if the editor's selection scope is non-empty (i.e. drilled into a group), only paint the highlight when the hover target's parent matches the scope. Implement as:

```ts
// Suppress hover outside the drilled-in scope; clicking outside exits.
const scope = editor.selection.getScope();
if (scope.length > 0) {
  const groupId = scope[scope.length - 1];
  if (!isDescendantOf(slide.elements, hoverId, groupId)) {
    return;
  }
}
```

Add a small pure helper `isDescendantOf(elements, id, ancestorId): boolean` in the same file if not present, or import from where the existing drill-in helpers live (`selection.ts`).

- [ ] **Step 6: Visual smoke run**

```bash
pnpm dev
```

Open a slides document, hover over an unselected shape. Expected: faint blue outline appears tracking the shape's bbox. Click empty canvas; outline disappears. Click the shape; outline disappears, selection handles appear. Hover a sibling; that sibling outlines.

- [ ] **Step 7: Commit**

```bash
git add packages/slides/src/view/editor/overlay.ts
git commit -m "Slides: paint idle hover outline on the overlay"
```

---

### Task A5: Suppress hover during drag / resize / connector draw

**Files:**
- Modify: `packages/slides/src/view/editor/editor.ts`

- [ ] **Step 1: Add failing test**

```ts
it('clears hoverHighlightId at the start of a drag', () => {
  const editor = makeEditorForTest({
    elements: [
      { id: 'a', type: 'shape', frame: { x: 0, y: 0, width: 100, height: 100, rotation: 0 } },
    ],
  });
  editor.dispatchPointerMoveAt(50, 50);
  expect(editor.getHoverHighlightId()).toBe('a');
  editor.dispatchPointerDownAt(50, 50);
  expect(editor.getHoverHighlightId()).toBeNull();
});

it('does not set hoverHighlightId while an insert mode is armed', () => {
  const editor = makeEditorForTest({
    elements: [
      { id: 'a', type: 'shape', frame: { x: 0, y: 0, width: 100, height: 100, rotation: 0 } },
    ],
  });
  editor.setInsertMode('shape', 'rectangle');
  editor.dispatchPointerMoveAt(50, 50);
  expect(editor.getHoverHighlightId()).toBeNull();
});
```

- [ ] **Step 2: Run test, expect drag-case to fail**

```bash
pnpm --filter @wafflebase/slides exec vitest run test/view/editor/hover-highlight.test.ts
```

The insert-mode case already passes because the early-return in Task A2 covered it. The drag-start case fails.

- [ ] **Step 3: Implement** — find `onPointerDown` (around `editor.ts:1844`); at the top, after pointerType guard and before hit-test, add:

```ts
this.clearHoverHighlight();
```

Also ensure `onConnectorDraw*` / endpoint-drag entry points call `clearHoverHighlight()`. Search for `this.insertDragging = true` and `this.endpointDragging = true` as anchor sites.

- [ ] **Step 4: Re-run test, expect PASS**

```bash
pnpm --filter @wafflebase/slides exec vitest run test/view/editor/hover-highlight.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/slides/src/view/editor/editor.ts \
  packages/slides/test/view/editor/hover-highlight.test.ts
git commit -m "Slides: suppress hover outline during drag/resize/connector"
```

---

### Task A6: Browser harness scenario

**Files:**
- Find: existing slides browser tests via `find packages -path '*harness*' -name '*.spec.ts' | grep -i slide`. The exploration report did not surface a directory dedicated to slides browser tests — if none exists, place this under `packages/frontend/src/app/harness/slides/` matching the location of any other slides harness fixtures. Confirm with `pnpm verify:browser:docker --list` (or equivalent) before writing.

- [ ] **Step 1: Add scenario**

```ts
// packages/frontend/src/app/harness/slides/hover-highlight.spec.ts
import { expect, test } from '@playwright/test';
import { openSlidesHarness } from './_helpers';

test('hover over unselected shape paints blue outline', async ({ page }) => {
  await openSlidesHarness(page, { fixture: 'two-shapes' });
  const a = page.locator('[data-slides-canvas]');
  const box = await a.boundingBox();
  if (!box) throw new Error('canvas missing');
  await page.mouse.move(box.x + 80, box.y + 80);
  await expect(page.locator('[data-slides-hover-highlight]'))
    .toHaveCount(1);
  await page.mouse.move(box.x + 800, box.y + 800);
  await expect(page.locator('[data-slides-hover-highlight]'))
    .toHaveCount(0);
});

test('hover over selected text element uses text cursor', async ({ page }) => {
  await openSlidesHarness(page, { fixture: 'title-body' });
  // Select the title placeholder.
  await page.locator('[data-slides-canvas]').click({ position: { x: 100, y: 60 } });
  // Hover well inside the title (away from border padding).
  await page.locator('[data-slides-canvas]').hover({ position: { x: 200, y: 80 } });
  const cursor = await page.locator('[data-slides-canvas]').evaluate(
    (el) => getComputedStyle(el).cursor,
  );
  expect(cursor).toBe('text');
});
```

(If `openSlidesHarness` / `two-shapes` / `title-body` fixtures don't exist, reuse the closest existing helper and fixture from the same harness directory. Do not invent a new fixture infrastructure.)

- [ ] **Step 2: Run the suite**

```bash
pnpm verify:browser:docker -- hover-highlight
```

Expected: 2 passing scenarios.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/app/harness/slides/hover-highlight.spec.ts
git commit -m "Slides: browser test for hover outline + I-beam cursor"
```

---

### Task A7: Doc cross-links + Interactions table update

**Files:**
- Modify: `docs/design/slides/slides.md` (Interactions table, line 456 onwards)
- Modify: `docs/design/slides/slides-group.md` (mention hover behavior inside drilled-in scope)
- Modify: `docs/design/slides/slides-keyboard-shortcuts.md` (no behavioral change; cross-link Phase A's spec for completeness — Enter/F2 row already documents the existing keymap)

- [ ] **Step 1: `slides.md` table**

Append after line 467 (`Enter text edit` row):

```
| Hover (idle) | pointer over unselected element | overlay paints `1px rgba(26,115,232,0.5)` outline; see [slides-hover-and-text-edit-entry.md](slides-hover-and-text-edit-entry.md) |
| Cursor over selected text region | pointer inside `getTextRegionRect(element)` | cursor `text`; outside region but inside bbox stays `move` |
```

- [ ] **Step 2: `slides-group.md`**

In the section describing drilled-in selection, append a paragraph:

```
While drilled into a group, the idle hover outline paints only on
elements inside that scope. Hovering outside the drilled-in subtree
shows no outline so it does not compete with the dashed context box;
clicking outside still exits the scope as before.
```

- [ ] **Step 3: Verify**

```bash
pnpm verify:fast
```

- [ ] **Step 4: Commit**

```bash
git add docs/design/slides/slides.md docs/design/slides/slides-group.md
git commit -m "Docs: cross-link hover + text-region cursor in slides design docs"
```

---

### Task A8: Phase A wrap-up

- [ ] **Step 1: Final verify**

```bash
pnpm verify:fast
```

- [ ] **Step 2: Manual smoke**

In `pnpm dev`, open `/slides/<doc>` and confirm:
- Hover any unselected shape → faint blue outline
- Hover own shape after selecting → no highlight (it's selected)
- Hover text region of a selected text placeholder → I-beam
- Hover near the border of the same selection → `move`
- Drag the shape → outline disappears on pointerdown
- Insert mode armed → no outline anywhere

- [ ] **Step 3: Capture lessons**

Create `docs/tasks/active/20260601-slides-hover-text-edit-entry-lessons.md` and note any surprises (e.g. text-padding constants that needed promotion, harness helper locations).

- [ ] **Step 4: Self-review via skill**

Invoke `/code-review` over the branch diff. Address blocking findings.

- [ ] **Step 5: Open PR**

```bash
gh pr create --title "Slides: idle hover outline + text-region cursor (P0)" \
  --body "$(cat <<'EOF'
## Summary

- Idle hover paints a 1 px blue outline on the topmost unselected element under the cursor (matches Google Slides feel).
- Hovering the text region of a single-selected text element shows the I-beam cursor; the border padding stays `move`.
- All new state lives in `SlidesEditor`; no model/store changes.

Spec: `docs/design/slides/slides-hover-and-text-edit-entry.md`.

## Test plan

- [x] `pnpm verify:fast`
- [x] Browser harness `hover-highlight.spec.ts` (2 new scenarios)
- [x] Manual smoke per the task plan

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Phase B — P1.4: Empty-placeholder 1-click entry (next PR, planned in detail before starting)

**Scope:** When the user clicks an empty placeholder text element (carries `placeholderRef`, has no real content), the first click both selects AND enters text-edit. Non-placeholder text boxes keep select-only behavior.

**Key files:** `packages/slides/src/view/editor/interactions/select.ts`, `editor.ts:onPointerDown` (around 1844), test extension in `test/view/editor/interactions/select.test.ts`.

**Tasks (to be expanded):** isEmptyPlaceholder predicate → wire into pointer-up branch → unit test → browser harness scenario → manual smoke → PR.

---

## Phase C — P1.5: Slow double-click (next PR)

**Scope:** Pointer-down + pointer-up on an already-selected single text-capable element, where `dist(down,up) < 3 px` and `up-down < 350 ms`, enters edit. Coexists with `dblclick`.

**Key files:** `packages/slides/src/view/editor/interactions/drag.ts` pointer-up classifier, `editor.ts:onDoubleClick` shared funnel into `enterEditMode`. Tune constants at top of `drag.ts`.

---

## Phase D — P2.6 follow-up: forward first character into freshly mounted text-box

**Scope:** Close the v1 caveat at `keyboard.ts:506-513`. Extend `mountSlidesTextBox` with `initialText?: string`, plumb through `enterEditMode(slideId, elementId, options?)`, and pass `{ initialText: e.key }` from the printable-key rule.

**Key files:** `packages/slides/src/view/editor/text-box-editor.ts`, `editor.ts:enterEditMode` (around 2022), `interactions/keyboard.ts:514-532`.

**Test:** unit on `initialText`-bearing mount path; browser scenario: select shape, type "H", expect "H" in the text-box.

---

## Phase E — P2.7: Edge-zone resize cursor

**Scope:** Within 4 logical px of the selected element's edge (inside or outside the bbox), show the matching resize cursor (`ns-resize`, `ew-resize`, `nwse-resize`, `nesw-resize`). Skip when element rotation > 5°.

**Key files:** `packages/slides/src/view/editor/editor.ts:computeSelectedHoverCursor` (added in Task A3), plus the existing handle hit region in `overlay.ts` for the 8-direction lookup table.

---

## Self-review checklist (Phase A only)

- ✅ Every spec section under P0.1 / P0.2 has a corresponding task (Tasks A1–A7).
- ✅ Z-order requirement in spec § "Visual layering" mapped to Task A4 Step 2 ("above member outlines, below selection handles + connection-site dots").
- ✅ Group drill-in case mapped to Task A4 Step 5.
- ✅ Risks "hover paint cost", "region cursor jitter", "hover flickers during drag" mapped to Tasks A2 Step 4 (rAF / cached cursor), A1 (`getTextRegionRect` is pure, computed once per move), A5 (suppression on pointerdown).
- ✅ No placeholders. Every step shows the actual code or names the file:line range to modify.
- ✅ Field naming: `hoverHighlightId` used consistently throughout Phase A tasks (does not collide with existing `hoverPreview`).
- ✅ Test naming: `hover-highlight.test.ts` and `text-region-rect.test.ts` used consistently.
- ✅ Helper naming: `getTextRegionRect` (Task A1) imported and called identically in Task A3.
- ✅ Manual smoke checks tied to user-visible behavior, not implementation details.
