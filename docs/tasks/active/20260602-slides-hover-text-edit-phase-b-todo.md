# Slides Hover & Text-Edit Entry — Phase B (P1.4 empty-placeholder 1-click)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user clicks an empty layout placeholder (e.g. the Title placeholder on a fresh "Title + Body" slide), the first click both selects AND enters text-edit, so a fresh deck becomes typeable in one click per region. Non-placeholder text boxes and non-empty placeholders keep today's select-only behavior.

**Architecture:** One pure predicate `isEmptyPlaceholder(element)` in `interactions/select.ts`, wired into the fresh-selection branch of `SlidesEditor.onPointerDown` between `selection.click(...)` and `startDrag(...)`. When the predicate fires the editor calls `enterEditMode(slide.id, id)` instead of `startDrag(...)`. No model/store/Yorkie schema changes; no overlay or rendering changes. All existing pointer paths (drag, lasso, shift-multi-select, drill-in, dblclick, keyboard Enter / F2) are unchanged.

**Tech Stack:** TypeScript, Vitest (unit + jsdom integration), `pnpm verify:fast` for CI gating. No new Playwright scenario (the slides interaction harness is still pending — same deferral as Phase A's Task A6; verification rests on unit/integration + manual smoke).

**Spec:** [`docs/design/slides/slides-hover-and-text-edit-entry.md`](../../design/slides/slides-hover-and-text-edit-entry.md) § P1.4.

**Predecessor:** PR #331 (Phase A, merged) — `docs/tasks/active/20260601-slides-hover-text-edit-entry-todo.md` has the umbrella roadmap; this file replaces the one-line Phase B stub at line 771 of that doc.

**Branch:** `slides-hover-text-edit-phase-b` (feature branch off `main`).

---

## File map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `packages/slides/src/view/editor/interactions/select.ts` | Export pure `isEmptyPlaceholder(element)` predicate. No change to `selectAt`. |
| Modify | `packages/slides/src/view/editor/editor.ts` | In `onPointerDown` fresh-selection branch (around line 2009), after `selection.click(...)` and before the `startDrag(...)` gate, route empty-placeholder fresh selections to `enterEditMode(...)` instead of arming a drag. |
| Modify | `packages/slides/test/view/editor/interactions/select.test.ts` | Add a `describe('isEmptyPlaceholder')` block covering the predicate's truth table. |
| Create | `packages/slides/test/view/editor/empty-placeholder-entry.test.ts` | jsdom integration tests for the `onPointerDown` wiring, modeled on `hover-highlight.test.ts`. |
| Modify | `docs/design/slides/slides.md` | Append a row to the Interactions table: "Click empty placeholder (fresh selection) → select + enter edit". Cross-link the hover-entry spec. |
| Modify | `docs/tasks/active/20260601-slides-hover-text-edit-entry-todo.md` | Replace the one-line Phase B stub with "Detailed plan: see [20260602-slides-hover-text-edit-phase-b-todo.md](20260602-slides-hover-text-edit-phase-b-todo.md)". |

---

## Task B1: Pure `isEmptyPlaceholder` predicate + truth-table tests

**Files:**
- Modify: `packages/slides/src/view/editor/interactions/select.ts`
- Modify: `packages/slides/test/view/editor/interactions/select.test.ts`

- [ ] **Step 1: Cut feature branch**

```bash
git fetch origin
git checkout -b slides-hover-text-edit-phase-b origin/main
```

- [ ] **Step 2: Write failing tests**

Append to `packages/slides/test/view/editor/interactions/select.test.ts` (after the existing `describe('selectAt')` block):

```ts
import {
  isEmptyPlaceholder,
} from '../../../../src/view/editor/interactions/select';
import type { Block } from '@wafflebase/docs';

// A blank paragraph block with a single empty inline — the exact shape
// `seedPlaceholderBlocks` produces for a freshly-laid-out placeholder.
const blankBlock: Block = {
  id: 'b1',
  type: 'paragraph',
  inlines: [{ text: '', style: {} }],
  style: {},
} as Block;

// A paragraph block whose first inline has real text.
const filledBlock: Block = {
  id: 'b1',
  type: 'paragraph',
  inlines: [{ text: 'Hello', style: {} }],
  style: {},
} as Block;

const placeholderRef = { type: 'title' as const, index: 0 };
const frame = { x: 0, y: 0, w: 100, h: 100, rotation: 0 };

describe('isEmptyPlaceholder', () => {
  it('returns true for a text element with placeholderRef and zero blocks', () => {
    const el: Element = {
      id: 'e', type: 'text', frame, placeholderRef,
      data: { blocks: [] },
    };
    expect(isEmptyPlaceholder(el)).toBe(true);
  });

  it('returns true for a text element with placeholderRef and a single empty paragraph', () => {
    const el: Element = {
      id: 'e', type: 'text', frame, placeholderRef,
      data: { blocks: [blankBlock] },
    };
    expect(isEmptyPlaceholder(el)).toBe(true);
  });

  it('returns false when the placeholder text element carries real content', () => {
    const el: Element = {
      id: 'e', type: 'text', frame, placeholderRef,
      data: { blocks: [filledBlock] },
    };
    expect(isEmptyPlaceholder(el)).toBe(false);
  });

  it('returns false for a text element WITHOUT placeholderRef even when empty', () => {
    const el: Element = {
      id: 'e', type: 'text', frame,
      data: { blocks: [blankBlock] },
    };
    expect(isEmptyPlaceholder(el)).toBe(false);
  });

  it('returns false for a placeholder text element with multiple blocks', () => {
    const el: Element = {
      id: 'e', type: 'text', frame, placeholderRef,
      data: { blocks: [blankBlock, blankBlock] },
    };
    expect(isEmptyPlaceholder(el)).toBe(false);
  });

  it('returns false for a non-text element even if placeholderRef is set', () => {
    // Defensive: today only text elements carry placeholderRef, but
    // the predicate must stay narrow.
    const el: Element = {
      id: 'e', type: 'shape', frame, placeholderRef,
      data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
    };
    expect(isEmptyPlaceholder(el)).toBe(false);
  });

  it('returns false for null / undefined defensively', () => {
    expect(isEmptyPlaceholder(null)).toBe(false);
    expect(isEmptyPlaceholder(undefined)).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
pnpm --filter @wafflebase/slides test -- interactions/select
```

Expected: each new `isEmptyPlaceholder` case fails with `isEmptyPlaceholder is not a function` or similar.

- [ ] **Step 4: Implement the predicate**

Append to `packages/slides/src/view/editor/interactions/select.ts`:

```ts
import type { Element } from '../../../model/element';

/**
 * A "text element acting as an empty layout placeholder" — currently
 * rendered with a ghost hint from `placeholderHintFor(ref.type)`. This
 * predicate is the trigger for Phase B's 1-click text-edit entry:
 *
 *   - element kind is `text`
 *   - element carries a `placeholderRef` (a slot-bearing placeholder,
 *     NOT a user-authored text box)
 *   - the text body is functionally empty: zero blocks OR exactly one
 *     paragraph block whose inlines are absent or carry an empty
 *     string. This matches the seed produced by
 *     `seedPlaceholderBlocks` (one paragraph, one empty inline).
 *
 * Shapes-with-text (even with `placeholderRef` set, which today the
 * model disallows) deliberately fall through — the spec scopes 1-click
 * entry to text-element placeholders only.
 */
export function isEmptyPlaceholder(
  element: Element | null | undefined,
): boolean {
  if (!element) return false;
  if (element.type !== 'text') return false;
  if (element.placeholderRef == null) return false;
  const blocks = element.data.blocks;
  if (blocks.length === 0) return true;
  if (blocks.length !== 1) return false;
  const only = blocks[0];
  if (only.type !== 'paragraph') return false;
  if (only.inlines.length === 0) return true;
  if (only.inlines.length === 1 && only.inlines[0].text === '') return true;
  return false;
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
pnpm --filter @wafflebase/slides test -- interactions/select
```

Expected: all 7 new cases green plus the existing `selectAt` suite still passing.

- [ ] **Step 6: Commit**

```bash
git add packages/slides/src/view/editor/interactions/select.ts \
        packages/slides/test/view/editor/interactions/select.test.ts
git commit -m "Slides: pure isEmptyPlaceholder predicate"
```

---

## Task B2: Wire `isEmptyPlaceholder` into `onPointerDown`

**Files:**
- Modify: `packages/slides/src/view/editor/editor.ts` (around lines 2005-2014, fresh-selection branch of `onPointerDown`)
- Create: `packages/slides/test/view/editor/empty-placeholder-entry.test.ts`

- [ ] **Step 1: Write failing integration test**

Create `packages/slides/test/view/editor/empty-placeholder-entry.test.ts`. The setup mirrors `hover-highlight.test.ts`: jsdom canvas + overlay, `MemSlidesStore`, mock text-box mount injected via `editor.options` (the editor accepts a `mountTextBox` override the same way `hover-highlight.test.ts` does). Reuse the `makeMockMount` and `emptyBlock` helpers — duplicate them locally (only ~30 lines and keeps each spec self-contained).

```ts
// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import type { Block } from '@wafflebase/docs';
import { MemSlidesStore } from '../../../src/store/memory';
import { initialize, type SlidesEditor } from '../../../src/view/editor/editor';
import type {
  MountSlidesTextBoxOptions,
  SlidesTextBoxEditor,
} from '../../../src/view/editor/text-box-editor';

function makeMockMount() {
  return function mount(opts: MountSlidesTextBoxOptions): SlidesTextBoxEditor {
    const container = document.createElement('div');
    container.className = 'wfb-slides-text-box-editor';
    container.style.position = 'absolute';
    opts.overlay.appendChild(container);
    let mounted = true;
    return {
      isEditing: () => mounted,
      focus: () => undefined,
      commit: () => opts.onCommit(opts.blocks),
      detach: () => { mounted = false; container.remove(); },
      container,
      getSelectionStyle: () => ({}),
      getRangeStyleSummary: () => ({}),
      applyStyle: () => {},
      clearInlineFormatting: () => {},
      applyBlockStyle: () => {},
      getBlockType: () => ({ type: 'paragraph' as const }),
      getBlockStyle: () => ({}),
      setBlockType: () => {},
      toggleList: () => {},
      indent: () => {},
      outdent: () => {},
      insertLink: () => {},
      removeLink: () => {},
      getLinkAtCursor: () => undefined,
      requestLink: () => {},
      undo: () => {},
      redo: () => {},
      onCursorMove: () => {},
    };
  };
}

function setup() {
  document.body.innerHTML = '';
  const canvas = document.createElement('canvas');
  canvas.width = 1920;
  canvas.height = 1080;
  const overlay = document.createElement('div');
  overlay.style.position = 'absolute';
  document.body.appendChild(canvas);
  document.body.appendChild(overlay);
  const store = new MemSlidesStore();
  return { canvas, overlay, store };
}

function emptyBlock(): Block {
  return {
    id: 'b1', type: 'paragraph',
    inlines: [{ text: '', style: {} }],
    style: {},
  } as Block;
}

// Fire a click at logical-slide (x, y). The hover-highlight tests use
// `pointermove` then `pointerdown` then `pointerup`; an equivalent
// sequence here ensures `onPointerDown` runs with realistic event
// state (no buttons pressed during the move). client = logical for the
// 1:1 canvas configured in setup().
function click(canvas: HTMLCanvasElement, x: number, y: number) {
  canvas.dispatchEvent(new PointerEvent('pointerdown', {
    clientX: x, clientY: y, pointerType: 'mouse', button: 0, bubbles: true,
  }));
  canvas.dispatchEvent(new PointerEvent('pointerup', {
    clientX: x, clientY: y, pointerType: 'mouse', button: 0, bubbles: true,
  }));
}

describe('empty-placeholder 1-click entry', () => {
  let editor: SlidesEditor | null = null;

  beforeEach(() => {
    if (editor) { editor.detach(); editor = null; }
  });

  it('enters edit mode on first click into an empty Title placeholder', () => {
    const { canvas, overlay, store } = setup();
    let sid = '';
    store.batch(() => { sid = store.addSlide('title-body'); });
    const slide = store.read().slides.find((s) => s.id === sid)!;
    const title = slide.elements.find(
      (e) => e.placeholderRef?.type === 'title',
    )!;

    editor = initialize({
      canvas, overlay, store,
      hostWidth: 1920, hostHeight: 1080, dpr: 1,
      mountTextBox: makeMockMount(),
    });

    // Aim at the title centroid (in logical slide coords).
    const cx = title.frame.x + title.frame.w / 2;
    const cy = title.frame.y + title.frame.h / 2;
    click(canvas, cx, cy);

    expect(editor.getEditingElementId()).toBe(title.id);
  });

  it('does NOT enter edit on a fresh click into a NON-empty placeholder', () => {
    const { canvas, overlay, store } = setup();
    let sid = '';
    let titleId = '';
    store.batch(() => {
      sid = store.addSlide('title-body');
      const slide = store.read().slides.find((s) => s.id === sid)!;
      const title = slide.elements.find(
        (e) => e.placeholderRef?.type === 'title',
      )!;
      titleId = title.id;
      // Replace the title's body with non-empty content.
      store.updateElementData(sid, titleId, {
        blocks: [{ ...emptyBlock(), inlines: [{ text: 'Hi', style: {} }] }],
      });
    });
    const slide = store.read().slides.find((s) => s.id === sid)!;
    const title = slide.elements.find((e) => e.id === titleId)!;

    editor = initialize({
      canvas, overlay, store,
      hostWidth: 1920, hostHeight: 1080, dpr: 1,
      mountTextBox: makeMockMount(),
    });

    const cx = title.frame.x + title.frame.w / 2;
    const cy = title.frame.y + title.frame.h / 2;
    click(canvas, cx, cy);

    expect(editor.getEditingElementId()).toBeNull();
    expect(editor.getSelection()).toEqual([titleId]);
  });

  it('does NOT enter edit on an empty NON-placeholder text box (no placeholderRef)', () => {
    const { canvas, overlay, store } = setup();
    let sid = '';
    let elId = '';
    store.batch(() => {
      sid = store.addSlide('blank');
      elId = store.addElement(sid, {
        type: 'text',
        frame: { x: 0, y: 0, w: 200, h: 100, rotation: 0 },
        data: { blocks: [emptyBlock()] },
      });
    });

    editor = initialize({
      canvas, overlay, store,
      hostWidth: 1920, hostHeight: 1080, dpr: 1,
      mountTextBox: makeMockMount(),
    });

    click(canvas, 50, 50);

    expect(editor.getEditingElementId()).toBeNull();
    expect(editor.getSelection()).toEqual([elId]);
  });

  it('shift-click into an empty placeholder does NOT auto-enter edit', () => {
    const { canvas, overlay, store } = setup();
    let sid = '';
    store.batch(() => { sid = store.addSlide('title-body'); });
    const slide = store.read().slides.find((s) => s.id === sid)!;
    const title = slide.elements.find(
      (e) => e.placeholderRef?.type === 'title',
    )!;

    editor = initialize({
      canvas, overlay, store,
      hostWidth: 1920, hostHeight: 1080, dpr: 1,
      mountTextBox: makeMockMount(),
    });

    const cx = title.frame.x + title.frame.w / 2;
    const cy = title.frame.y + title.frame.h / 2;
    canvas.dispatchEvent(new PointerEvent('pointerdown', {
      clientX: cx, clientY: cy, pointerType: 'mouse',
      button: 0, shiftKey: true, bubbles: true,
    }));
    canvas.dispatchEvent(new PointerEvent('pointerup', {
      clientX: cx, clientY: cy, pointerType: 'mouse',
      button: 0, shiftKey: true, bubbles: true,
    }));

    expect(editor.getEditingElementId()).toBeNull();
    expect(editor.getSelection()).toEqual([title.id]);
  });

  it('does NOT re-enter edit on a second click of the already-selected empty placeholder', () => {
    const { canvas, overlay, store } = setup();
    let sid = '';
    store.batch(() => { sid = store.addSlide('title-body'); });
    const slide = store.read().slides.find((s) => s.id === sid)!;
    const title = slide.elements.find(
      (e) => e.placeholderRef?.type === 'title',
    )!;

    editor = initialize({
      canvas, overlay, store,
      hostWidth: 1920, hostHeight: 1080, dpr: 1,
      mountTextBox: makeMockMount(),
    });

    const cx = title.frame.x + title.frame.w / 2;
    const cy = title.frame.y + title.frame.h / 2;

    // Pre-select without going through the pointer path (so this case
    // exercises "already selected" without first triggering the
    // auto-enter on the very click that selected it).
    editor.setSelection([title.id]);

    click(canvas, cx, cy);

    // The already-selected branch in `onPointerDown` short-circuits to
    // `startDrag` — no auto-enter, the user must drag/dblclick/F2 to
    // open the editor.
    expect(editor.getEditingElementId()).toBeNull();
    expect(editor.getSelection()).toEqual([title.id]);
  });
});
```

> **Note on test getters/setters:** verified during plan-writing — `SlidesEditor` already exposes `getEditingElementId()` (editor.ts:276), `getSelection()` (editor.ts:250), and `setSelection(ids)` (editor.ts:251). The test code above uses `getEditingElementId` and `getSelection`. **The previous draft of this test used `getSelectedIds()` — that does NOT exist. Replace any such call with `getSelection()` before running.**

- [ ] **Step 2: Run the new test to confirm it fails**

```bash
pnpm --filter @wafflebase/slides test -- empty-placeholder-entry
```

Expected: 5 failing cases — `getEditingElementId()` returns null for the title click because the wiring doesn't exist yet.

- [ ] **Step 3: Wire the predicate into `onPointerDown`**

In `packages/slides/src/view/editor/editor.ts`, around the fresh-selection branch (~lines 2005-2014, between `this.refitPoppedScope(...)` and the `if (this.selection.get().length > 0) { this.startDrag(...) }` block), add the 1-click entry route:

```ts
      const beforeScope = this.selection.getScope();
      this.selection.click(hitResult, mods);
      const afterScope = this.selection.getScope();
      this.refitPoppedScope(beforeScope, afterScope, slide.id);

      // P1.4: empty-placeholder 1-click entry. A fresh non-shift click
      // on a `text` element that is acting as an empty layout placeholder
      // (ghost-hint visible) selects AND enters text-edit in the same
      // gesture, so a brand-new "Title + Body" slide becomes typeable in
      // one click per region. Non-placeholders and non-empty placeholders
      // fall through to the regular `startDrag` arming below.
      // See docs/design/slides/slides-hover-and-text-edit-entry.md § P1.4.
      if (!mods.shift && this.selection.get().length === 1) {
        const selectedId = this.selection.get()[0];
        const el = findElement(slide.elements, selectedId);
        if (isEmptyPlaceholder(el ?? null)) {
          this.enterEditMode(slide.id, selectedId);
          return;
        }
      }

      // Begin drag on the (possibly newly-)selected elements unless the
      // element was just removed by shift-toggle.
      if (this.selection.get().length > 0) {
        this.startDrag(e.clientX, e.clientY);
      }
      return;
```

Also add the import at the top of `editor.ts` (next to the existing `selectAt` / `SelectAtOptions` import from `interactions/select`):

```ts
import {
  selectAt,
  type SelectAtOptions,
  isEmptyPlaceholder,
} from './interactions/select';
```

(If the existing import line differs — e.g. only `SelectAtOptions` is imported — extend it to include `isEmptyPlaceholder`. Do not add a second import line for the same module.)

- [ ] **Step 4: Run the new test to confirm it passes**

```bash
pnpm --filter @wafflebase/slides test -- empty-placeholder-entry
```

Expected: 5 passing cases.

- [ ] **Step 5: Run the full slides suite to check for regressions**

```bash
pnpm --filter @wafflebase/slides test
```

Expected: all tests pass. Pay particular attention to existing `select`, `drag`, `editor`, and `selection-drillin` suites — any failures there mean the new branch interferes with a path it shouldn't.

- [ ] **Step 6: Commit**

```bash
git add packages/slides/src/view/editor/editor.ts \
        packages/slides/test/view/editor/empty-placeholder-entry.test.ts
git commit -m "Slides: empty-placeholder 1-click enters text edit"
```

---

## Task B3: Doc cross-link + Interactions table update

**Files:**
- Modify: `docs/design/slides/slides.md` (Interactions table)
- Modify: `docs/tasks/active/20260601-slides-hover-text-edit-entry-todo.md` (replace Phase B stub with pointer)

- [ ] **Step 1: Append row to `slides.md` Interactions table**

Locate the Interactions table (search for "Cursor over selected text region" — added in Phase A — and append after it):

```
| Click empty layout placeholder | first click on a `text` element with `placeholderRef` and empty body | selects AND `enterEditMode(...)`; see [slides-hover-and-text-edit-entry.md § P1.4](slides-hover-and-text-edit-entry.md) |
```

- [ ] **Step 2: Point the umbrella todo at this plan**

In `docs/tasks/active/20260601-slides-hover-text-edit-entry-todo.md`, replace the Phase B stub (the paragraph beginning "**Tasks (to be expanded):**" under "## Phase B — P1.4") with:

```
**Detailed plan:** [`20260602-slides-hover-text-edit-phase-b-todo.md`](./20260602-slides-hover-text-edit-phase-b-todo.md).
```

Leave the **Scope** and **Key files** lines as-is so the umbrella keeps its at-a-glance phase summary.

- [ ] **Step 3: Verify**

```bash
pnpm verify:fast
```

Expected: green (lint + unit). If a markdown linter complains about the new table row, match the column count of neighboring rows exactly.

- [ ] **Step 4: Commit**

```bash
git add docs/design/slides/slides.md \
        docs/tasks/active/20260601-slides-hover-text-edit-entry-todo.md
git commit -m "Docs: link Phase B plan, document 1-click placeholder entry"
```

---

## Task B4: Phase B wrap-up — verify, smoke, review, PR

- [ ] **Step 1: Rebase on latest `main`**

```bash
git fetch origin
git rebase origin/main
```

Expected: clean rebase. If `editor.ts` has moved (the line numbers in this plan are pinned to PR #331's tip), re-locate the fresh-selection branch by searching for `this.refitPoppedScope(beforeScope, afterScope, slide.id);` — the insertion point is the next statement after that call.

- [ ] **Step 2: Final verify**

```bash
pnpm verify:fast
```

Expected: green.

- [ ] **Step 3: Manual smoke in `pnpm dev`**

```bash
pnpm dev
```

Open `/slides/<doc>` and confirm, in this order:

1. Create a new slide with the "Title and body" layout. Click the empty Title region once → caret blinks inside; type "Hello" → text appears.
2. Press Esc to commit + exit. Click the Title again (now non-empty) → it selects but does NOT re-enter edit. Selection handles appear.
3. Double-click the same Title → enters edit as before. Esc out.
4. Insert an empty user-authored text box from the toolbar; click it once → it selects but does NOT auto-enter edit. (This is the deliberate scope: placeholders only.)
5. With the Title still selected, click the Body placeholder (empty) → switches selection AND enters edit on Body. (Tests the "fresh selection" branch when there's prior selection.)
6. Shift-click an empty placeholder while another element is selected → multi-select extends; no auto-enter.
7. Drag from the empty Title without releasing — quick pointermove right after pointerdown — the click does enter edit. (This is acceptable: Phase B fires on `pointerdown`, the spec doesn't reserve a drag-from-empty-placeholder gesture; cross-check that the user can still escape and drag after one Esc.)

> **If smoke step 7 feels wrong during dogfooding** — the fix is to defer the `enterEditMode` call to the no-drag `pointerup` path (the same path Phase C will hook for slow double-click). That widens the change in `editor.ts` (pointer-up classifier) but does not affect the predicate. Note in `*-lessons.md` if observed.

- [ ] **Step 4: Self code-review**

```bash
# Either:
/code-review
# or:
```

Invoke the `superpowers:requesting-code-review` skill over the branch diff (`git diff origin/main...HEAD`). Address blocking findings; note non-blocking ones in lessons.

- [ ] **Step 5: Capture lessons**

Create `docs/tasks/active/20260602-slides-hover-text-edit-phase-b-lessons.md` with one section per surprise (predicate shape choices, test-getter additions, smoke step 7 outcome).

- [ ] **Step 6: Open PR**

```bash
git push -u origin slides-hover-text-edit-phase-b
gh pr create --title "Slides: empty-placeholder 1-click text-edit entry (P1.4)" \
  --body "$(cat <<'EOF'
## Summary

Phase B (P1.4) of the [hover and text-edit entry parity spec](docs/design/slides/slides-hover-and-text-edit-entry.md). First click on an empty layout placeholder now both selects AND enters text-edit, so a fresh "Title + Body" slide becomes typeable in one click per region.

- Pure `isEmptyPlaceholder(element)` predicate in `interactions/select.ts`.
- Wired into `SlidesEditor.onPointerDown` fresh-selection branch — routes to `enterEditMode(...)` instead of `startDrag(...)` when the predicate fires.
- Scoped to text elements with `placeholderRef` and a functionally-empty body. User-authored empty text boxes keep select-only behavior (deliberate divergence from Google Slides; revisit after dogfooding per spec § Risks).

## Out of scope (follow-up PRs per spec)

- Phase C (P1.5 slow double-click), Phase D (P2.6 first-char forwarding), Phase E (P2.7 edge-zone resize cursor) — see umbrella todo.
- Browser harness scenario — still deferred for the slides interaction harness (same blocker as Phase A's A6).

## Test plan

- [x] `pnpm verify:fast` green
- [x] `interactions/select` predicate truth-table (7 cases)
- [x] `empty-placeholder-entry.test.ts` integration (5 cases)
- [x] Manual smoke in `pnpm dev` — see todo § Task B4 Step 3

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 7: After CI green + review approval**

Merge via the GitHub UI (squash-merge per project convention). Then in a fresh session:

```bash
pnpm tasks:archive
pnpm tasks:index
```

---

## Risks and mitigation

| Risk | Mitigation |
|---|---|
| User wanted to drag the empty placeholder away from its layout slot, not type into it | Smoke step 7 explicitly probes this. If problematic, defer entry to no-drag `pointerup` path. Constants/threshold are not needed because the trigger is "fresh selection", not a timing window. |
| Predicate matches a placeholder that *looks* non-empty due to non-paragraph block kinds (e.g. list-item with content) | The predicate stays in lockstep with the renderer's `isTextBodyEmpty` gate — "empty" means every inline across every block is the empty string, regardless of block kind/count. If the user can see text on screen, the predicate returns `false`. If the renderer paints a ghost hint, the predicate returns `true`. No drift possible. |
| Drilled-in group contains an empty placeholder | Single-click at root scope hits the group, not the child. A second click at root drills into the group only via `dblclick` (which goes through `onDoubleClick`, not `onPointerDown`). So the 1-click-entry branch never fires on a grouped child — same behavior as today. No change needed. |
| Layout-bumped existing slide loses 1-click entry once user types and commits | This is correct: after the first type+commit, the placeholder is no longer "empty" by our predicate, so subsequent clicks behave like any selected text box. Re-entering requires F2 / Enter / dblclick. |
| `enterEditMode` no-op (e.g. element lookup races) leaves user with selected-but-not-editing state | `enterEditMode` already guards against missing element / unsupported type and returns silently. The fresh-selection click still left selection set, so the user can press F2 / Enter to recover. No additional fallback needed. |
| Phase C (slow double-click) overlaps with Phase B | Phase C fires on a **second** click of an **already-selected** element. Phase B fires on a **fresh selection**. The two branches don't overlap — `onPointerDown` already separates them via `this.selection.has(scopeId)`. |

---

## Self-review checklist

- [ ] Every spec § P1.4 sentence has a corresponding task:
  - "carries `placeholderRef` AND text body is empty" → Task B1 predicate
  - "click is a fresh selection (was not already selected)" → Task B2 wiring (only fires after `selection.click`, skipped when scope id already in selection)
  - "selection.replace([id]) then enterEditMode() in the same pointer-up handler" → Task B2 (the actual editor calls `selection.click` + `enterEditMode` in `onPointerDown`; the spec's phrasing is approximate — captured in Risks)
  - "non-empty placeholders and regular text boxes, behavior is unchanged" → Task B2 Step 5 regression sweep + Task B4 smoke steps 2, 4
  - "scope to placeholders to avoid surprising users who created an empty text box deliberately" → Task B1 predicate (`placeholderRef == null` returns false) + Task B4 smoke step 4
- [ ] No placeholders / TODOs in any step.
- [ ] Type names: `isEmptyPlaceholder`, `Element`, `Block` — all imported from existing modules, no new types invented.
- [ ] Test naming consistent: `empty-placeholder-entry.test.ts` referenced in B2 Steps 1, 2, 5 and B4 Step 6 PR body.
- [ ] Predicate name `isEmptyPlaceholder` consistent in B1 (definition), B2 (import + use), self-review.
- [ ] Manual smoke checks (B4 Step 3) tied to user-visible behavior, not editor internals.
- [ ] Branch name `slides-hover-text-edit-phase-b` consistent in B1 Step 1 (cut) and B4 Step 6 (push).
