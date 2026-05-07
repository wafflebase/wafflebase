# Slides Phase 3b (Editor UX Completion) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Round out the Phase 3a editor with the day-one keyboard /
clipboard / context-menu / thumbnail / speaker-notes affordances a
Google Slides user expects. Phase 3b finishes the v1 editor surface;
Phase 4 starts wrapping it in React + Yorkie.

**Architecture:**
- Restore `keymap.ts` (deleted at the end of 3a) now that an actual
  consumer (the editor's keydown handler) lands in T1. knip is
  satisfied.
- Editor gains a `currentSlideId` state so the demo can render and
  switch between multiple slides.
- Right-click context menus use a small vanilla-DOM module
  (`view/editor/context-menu.ts`) — slides package has no React
  dependency. Phase 4's React wrapper can replace it with Radix
  later.
- Speaker notes panel is a plain `<textarea>` bound to `slide.notes`
  via `withNotes`; the docs IME bridge lands in Phase 5.

**Tech stack:** No new deps. Browser Clipboard API for copy/paste.

**Spec:** [`docs/design/slides/slides.md`](../../design/slides/slides.md)
sections "Editor UI", "Interactions", and "Context menus".

**High-level checklist:** [`20260505-slides-package-mvp-todo.md`](20260505-slides-package-mvp-todo.md)
items 3.7–3.15.

> Phase 3b ends when items 3.7–3.15 are checked, `pnpm verify:fast`
> is green, and the dev demo lets a user keyboard-nudge / undo / copy
> / paste / duplicate / reorder z / switch slides via the thumbnail
> strip / right-click for context menus / type into speaker notes.

---

## File structure

Created in this phase:

```
packages/slides/src/view/editor/
├── keymap.ts                                   # T1 (restored)
├── context-menu.ts                             # T4
├── context-menu.test.ts                        # T4
├── thumbnail-panel.ts                          # T3
├── thumbnail-panel.test.ts                     # T3
├── notes-panel.ts                              # T5
├── notes-panel.test.ts                         # T5
└── interactions/
    ├── keyboard.ts                             # T1 (rules array + handler)
    ├── keyboard.test.ts                        # T1
    ├── clipboard.ts                            # T2 (pure serialization)
    └── clipboard.test.ts                       # T2

packages/slides/spike/                          # T6
├── docs-richtext-audit.md                      # T6 (research output)
```

Modified in this phase:

- `packages/slides/src/view/editor/editor.ts` — currentSlideId state,
  attach keydown + contextmenu, expose more API surface
- `packages/slides/src/index.ts` — re-export new entry points
- `packages/slides/demo.ts` + `index.html` — multi-slide fixture +
  thumbnail strip + notes panel
- `docs/tasks/active/20260505-slides-package-mvp-todo.md` — tick 3.7–3.15

---

## Conventions

Same as Phase 1+2+3a. Tests next to source, jsdom env where needed,
no `--no-verify`, all on `feat/slides-phase1`.

---

## Task 1: Keyboard infrastructure + nudge + undo/redo

**Files:**
- Create: `packages/slides/src/view/editor/keymap.ts` (re-add — was deleted post-Phase 3a)
- Create: `packages/slides/src/view/editor/interactions/keyboard.ts`
- Create: `packages/slides/src/view/editor/interactions/keyboard.test.ts`

`keymap.ts` is a verbatim copy of `packages/sheets/src/view/keymap.ts`
with the doc-comment from the original Phase 3a plan T1.

`keyboard.ts` builds a `KeyRule[]` for the editor and exposes a single
`buildKeyRules(editor): KeyRule[]` factory. The editor wires `keydown`
on `document` to walk the rules. Phase 3b T1 lands these rules:

- Arrow / Shift+Arrow → nudge selected elements by ±1 / ±10 logical px
- Cmd/Ctrl+Z → undo
- Cmd/Ctrl+Shift+Z → redo

Cmd+D, Cmd+C/X/V, z-order shortcuts arrive in T2. Each task adds rules
to the same factory.

- [ ] **Step 1.1: Restore `keymap.ts` verbatim from the original 3a plan**

The doc-comment + body matches what landed at commit `a0b93131` and was
deleted at `a6ff2ac0`. Re-add with the same content (use
`git show a0b93131 -- packages/slides/src/view/editor/keymap.ts` to
recover the exact text, then write it).

- [ ] **Step 1.2: Write failing tests for `keyboard.ts`**

Create `packages/slides/src/view/editor/interactions/keyboard.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import '../../canvas/test-canvas-env';
import { MemSlidesStore } from '../../../store/memory';
import { initialize, type SlidesEditor } from '../editor';

function makeFixture() {
  document.body.innerHTML = '';
  const canvas = document.createElement('canvas');
  canvas.width = 960; canvas.height = 540;
  const overlay = document.createElement('div');
  document.body.appendChild(canvas);
  document.body.appendChild(overlay);
  const store = new MemSlidesStore();
  let elementId = '';
  store.batch(() => {
    const sid = store.addSlide('blank');
    elementId = store.addElement(sid, {
      type: 'shape',
      frame: { x: 100, y: 100, w: 200, h: 100, rotation: 0 },
      data: { kind: 'rect', fill: '#abc' },
    });
  });
  const editor = initialize({ canvas, overlay, store, hostWidth: 960, hostHeight: 540, dpr: 1 });
  return { canvas, overlay, store, editor, elementId };
}

describe('keyboard — nudge', () => {
  let editor: SlidesEditor | null = null;
  beforeEach(() => { if (editor) { editor.detach(); editor = null; } });

  it('Arrow keys nudge the selected element by 1 px', () => {
    const { editor: e, store, elementId } = makeFixture();
    editor = e;
    editor.setSelection([elementId]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown',  bubbles: true }));
    const frame = store.read().slides[0].elements[0].frame;
    expect(frame.x).toBe(101);
    expect(frame.y).toBe(101);
  });

  it('Shift+Arrow nudges by 10 px', () => {
    const { editor: e, store, elementId } = makeFixture();
    editor = e;
    editor.setSelection([elementId]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
    expect(store.read().slides[0].elements[0].frame.x).toBe(110);
  });

  it('arrow keys with no selection are a no-op', () => {
    const { editor: e, store } = makeFixture();
    editor = e;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(store.read().slides[0].elements[0].frame.x).toBe(100);
  });

  it('each arrow keystroke is its own undo entry', () => {
    const { editor: e, store, elementId } = makeFixture();
    editor = e;
    editor.setSelection([elementId]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(store.read().slides[0].elements[0].frame.x).toBe(102);
    store.undo();
    expect(store.read().slides[0].elements[0].frame.x).toBe(101);
    store.undo();
    expect(store.read().slides[0].elements[0].frame.x).toBe(100);
  });
});

describe('keyboard — undo/redo', () => {
  let editor: SlidesEditor | null = null;
  beforeEach(() => { if (editor) { editor.detach(); editor = null; } });

  it('Cmd+Z undoes the last batch', () => {
    const { editor: e, store, elementId } = makeFixture();
    editor = e;
    editor.setSelection([elementId]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));
    expect(store.read().slides[0].elements[0].frame.x).toBe(100);
  });

  it('Cmd+Shift+Z redoes', () => {
    const { editor: e, store, elementId } = makeFixture();
    editor = e;
    editor.setSelection([elementId]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, shiftKey: true, bubbles: true }));
    expect(store.read().slides[0].elements[0].frame.x).toBe(101);
  });

  it('Ctrl+Z works on Windows/Linux too', () => {
    const { editor: e, store, elementId } = makeFixture();
    editor = e;
    editor.setSelection([elementId]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    expect(store.read().slides[0].elements[0].frame.x).toBe(100);
  });
});
```

> Test fixture references `editor.setSelection(ids)` which doesn't
> exist yet on the public API. Add it in step 1.4.

- [ ] **Step 1.3: Verify FAIL**

Run: `pnpm slides test`
Expected: FAIL — `setSelection` not on `SlidesEditor` interface (or
the keyboard rules aren't wired yet).

- [ ] **Step 1.4: Implement `keyboard.ts` + wire into editor**

Create `packages/slides/src/view/editor/interactions/keyboard.ts`:

```ts
import type { SlidesStore } from '../../../store/store';
import type { Selection } from '../selection';
import { isModPressed, type KeyRule } from '../keymap';

export interface KeyboardContext {
  store: SlidesStore;
  selection: Selection;
  currentSlideId(): string | undefined;
  requestRender(): void;
}

const NUDGE = 1;
const NUDGE_SHIFT = 10;

/**
 * Build the keyboard rules for the editor. T1 covers nudge + undo/redo;
 * T2 will append more rules (Cmd+C/X/V, Cmd+D, z-order shortcuts) by
 * extending this same array.
 */
export function buildKeyRules(ctx: KeyboardContext): KeyRule[] {
  return [
    // Undo / Redo (mod-Z and mod-shift-Z) — listed before the arrow
    // rules so a stray Z key doesn't fall through.
    {
      match: (e) =>
        keyEquals(e.key, 'z') && isModPressed(e) && !e.shiftKey,
      run: (e) => { e.preventDefault(); ctx.store.undo(); ctx.requestRender(); },
    },
    {
      match: (e) =>
        keyEquals(e.key, 'z') && isModPressed(e) && e.shiftKey,
      run: (e) => { e.preventDefault(); ctx.store.redo(); ctx.requestRender(); },
    },

    // Arrow nudge — only when something is selected and no modifier.
    ...(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'] as const).map(
      (key): KeyRule => ({
        match: (e) =>
          e.key === key && !isModPressed(e),
        run: (e) => {
          if (ctx.selection.get().length === 0) return;
          e.preventDefault();
          const step = e.shiftKey ? NUDGE_SHIFT : NUDGE;
          const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
          const dy = key === 'ArrowUp'   ? -step : key === 'ArrowDown'  ? step : 0;
          const slideId = ctx.currentSlideId();
          if (!slideId) return;
          ctx.store.batch(() => {
            for (const id of ctx.selection.get()) {
              const slide = ctx.store.read().slides.find((s) => s.id === slideId);
              if (!slide) continue;
              const el = slide.elements.find((x) => x.id === id);
              if (!el) continue;
              ctx.store.updateElementFrame(slideId, id, {
                x: el.frame.x + dx,
                y: el.frame.y + dy,
              });
            }
          });
          ctx.requestRender();
        },
      }),
    ),
  ];
}

function keyEquals(eventKey: string, target: string): boolean {
  return eventKey.toLowerCase() === target.toLowerCase();
}
```

Then wire into `editor.ts`:

(a) Add `setSelection(ids)` to the public `SlidesEditor` interface +
implementation. Just calls `this.selection.set(ids)`.

(b) Add `currentSlideId(): string | undefined` to the interface +
implementation. Returns `this.options.store.read().slides[0]?.id` for
now (multi-slide currentSlide tracking lands in T3).

(c) In `attachInteractions`, append a keydown listener:

```ts
this.on(document, 'keydown', (e) => {
  void this.handleKeyDown(e as KeyboardEvent);
});
```

Add `handleKeyDown` private method:

```ts
private async handleKeyDown(e: KeyboardEvent): Promise<void> {
  await runKeyRules(e, this.keyRules);
}

private keyRules: KeyRule[] = buildKeyRules({
  store: this.options.store,
  selection: this.selection,
  currentSlideId: () => this.currentSlideId(),
  requestRender: () => { this.renderer.markDirty(); this.render(); this.repaintOverlay(); },
});
```

> Note: `keyRules` initialiser uses `this`, which TypeScript flags
> in property initialiser. Move the assignment to the constructor:
> declare `private keyRules!: KeyRule[];` and assign at the end of
> the constructor body.

(d) Imports:

```ts
import { buildKeyRules } from './interactions/keyboard';
import { runKeyRules, type KeyRule } from './keymap';
```

- [ ] **Step 1.5: Run tests, confirm green**

Run: `pnpm slides test`
Expected: PASS — all keyboard tests + previously passing tests.

- [ ] **Step 1.6: Commit**

```bash
git add packages/slides/src/view/editor/keymap.ts packages/slides/src/view/editor/interactions/keyboard.ts packages/slides/src/view/editor/interactions/keyboard.test.ts packages/slides/src/view/editor/editor.ts
git commit -m "Add keyboard handler with nudge + undo/redo" -m "Restores keymap.ts (deleted at end of Phase 3a) now that an actual
consumer lands. Editor attaches a document keydown listener that
walks a buildKeyRules(ctx) array; T1 covers Arrow / Shift+Arrow
nudge (1 / 10 logical px) and Cmd-Z / Cmd-Shift-Z undo/redo. Each
arrow keystroke is its own batch — every press is its own undo
entry, matching how the spec calls out 'one user-intent action = one
batch'.

Cmd+C/X/V, Cmd+D, and z-order shortcuts append to the same rules
array in T2.

Refs docs/design/slides/slides.md 'Interactions' table rows Nudge
and Undo / Redo."
```

---

## Task 2: Element clipboard + duplicate + z-order shortcuts

**Files:**
- Create: `packages/slides/src/view/editor/interactions/clipboard.ts`
- Create: `packages/slides/src/view/editor/interactions/clipboard.test.ts`
- Modify: `packages/slides/src/view/editor/interactions/keyboard.ts`
- Modify: `packages/slides/src/view/editor/interactions/keyboard.test.ts`

`clipboard.ts` exposes pure serialization helpers:
- `serializeElements(elements): string` — JSON-encodes for the custom MIME
- `deserializeElements(json): ElementInit[]` — parses back, re-stripping ids

The keyboard handlers add three groups of rules:
- Cmd+C / Cmd+X / Cmd+V — uses `navigator.clipboard.write`/`read` with
  `application/x-wafflebase-slides+json`
- Cmd+D — duplicates the selected elements (or the current slide if
  nothing is element-selected)
- Cmd+↑ / Cmd+↓ / Cmd+Shift+↑ / Cmd+Shift+↓ — z-order shortcuts

- [ ] **Step 2.1: Write failing tests for `clipboard.ts` (pure serialization)**

```ts
import { describe, it, expect } from 'vitest';
import type { Element } from '../../../model/element';
import { serializeElements, deserializeElements, MIME_TYPE } from './clipboard';

const rect = (id: string, x = 0): Element => ({
  id, type: 'shape',
  frame: { x, y: 0, w: 100, h: 50, rotation: 0 },
  data: { kind: 'rect', fill: '#abc' },
});

describe('clipboard serialization', () => {
  it('round-trips two shapes through JSON', () => {
    const json = serializeElements([rect('a', 10), rect('b', 20)]);
    const parsed = deserializeElements(json);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].frame.x).toBe(10);
    expect(parsed[1].frame.x).toBe(20);
    // Ids are stripped — paste assigns fresh ones.
    expect((parsed[0] as { id?: string }).id).toBeUndefined();
  });

  it('rejects non-slides JSON', () => {
    expect(() => deserializeElements('{"foo": "bar"}')).toThrow(/wafflebase\/slides/i);
  });

  it('exports a stable MIME type', () => {
    expect(MIME_TYPE).toBe('application/x-wafflebase-slides+json');
  });
});
```

- [ ] **Step 2.2: Verify FAIL**

- [ ] **Step 2.3: Implement `clipboard.ts`**

```ts
import type { Element, ElementInit } from '../../../model/element';

export const MIME_TYPE = 'application/x-wafflebase-slides+json';
const MAGIC = 'wafflebase/slides@v1';

interface Payload {
  magic: string;
  elements: ElementInit[];
}

export function serializeElements(elements: readonly Element[]): string {
  const stripped: ElementInit[] = elements.map((e) => {
    const { id: _drop, ...rest } = e;
    return rest as ElementInit;
  });
  const payload: Payload = { magic: MAGIC, elements: stripped };
  return JSON.stringify(payload);
}

export function deserializeElements(json: string): ElementInit[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('clipboard payload is not JSON');
  }
  if (!isPayload(parsed)) {
    throw new Error(`clipboard payload missing wafflebase/slides magic`);
  }
  return parsed.elements;
}

function isPayload(v: unknown): v is Payload {
  return (
    typeof v === 'object' && v !== null &&
    (v as { magic?: unknown }).magic === MAGIC &&
    Array.isArray((v as { elements?: unknown }).elements)
  );
}
```

- [ ] **Step 2.4: Add keyboard rules for clipboard / duplicate / z-order**

Append to `keyboard.ts` (in `buildKeyRules`):

```ts
// Cmd+C — copy selected elements
{
  match: (e) => keyEquals(e.key, 'c') && isModPressed(e) && !e.shiftKey,
  run: async (e) => {
    const ids = ctx.selection.get();
    if (ids.length === 0) return;
    const slide = currentSlide(ctx);
    if (!slide) return;
    const selected = slide.elements.filter((el) => ids.includes(el.id));
    if (selected.length === 0) return;
    e.preventDefault();
    await writeClipboard(selected);
  },
},

// Cmd+X — cut
{
  match: (e) => keyEquals(e.key, 'x') && isModPressed(e) && !e.shiftKey,
  run: async (e) => {
    const ids = ctx.selection.get();
    if (ids.length === 0) return;
    const slide = currentSlide(ctx);
    if (!slide) return;
    const selected = slide.elements.filter((el) => ids.includes(el.id));
    if (selected.length === 0) return;
    e.preventDefault();
    await writeClipboard(selected);
    ctx.store.batch(() => ctx.store.removeElements(slide.id, ids));
    ctx.selection.clear();
    ctx.requestRender();
  },
},

// Cmd+V — paste
{
  match: (e) => keyEquals(e.key, 'v') && isModPressed(e),
  run: async (e) => {
    const slide = currentSlide(ctx);
    if (!slide) return;
    const inits = await readClipboard();
    if (inits === null) return;
    e.preventDefault();
    const newIds: string[] = [];
    ctx.store.batch(() => {
      for (const init of inits) {
        // Offset paste by (10, 10) so it doesn't overlap exactly.
        const offsetInit = {
          ...init,
          frame: { ...init.frame, x: init.frame.x + 10, y: init.frame.y + 10 },
        };
        newIds.push(ctx.store.addElement(slide.id, offsetInit));
      }
    });
    ctx.selection.set(newIds);
    ctx.requestRender();
  },
},

// Cmd+D — duplicate selected elements (no element selected → duplicate slide)
{
  match: (e) => keyEquals(e.key, 'd') && isModPressed(e) && !e.shiftKey,
  run: (e) => {
    e.preventDefault();
    const slide = currentSlide(ctx);
    if (!slide) return;
    const ids = ctx.selection.get();
    if (ids.length === 0) {
      // Duplicate current slide.
      ctx.store.batch(() => ctx.store.duplicateSlide(slide.id));
    } else {
      const selected = slide.elements.filter((el) => ids.includes(el.id));
      const newIds: string[] = [];
      ctx.store.batch(() => {
        for (const el of selected) {
          const { id: _drop, ...rest } = el;
          const offsetInit = {
            ...rest,
            frame: { ...rest.frame, x: rest.frame.x + 10, y: rest.frame.y + 10 },
          };
          newIds.push(ctx.store.addElement(slide.id, offsetInit as ElementInit));
        }
      });
      ctx.selection.set(newIds);
    }
    ctx.requestRender();
  },
},

// z-order: Cmd+↑ bring forward, Cmd+↓ send backward,
//         Cmd+Shift+↑ bring to front, Cmd+Shift+↓ send to back
{
  match: (e) => (e.key === 'ArrowUp' || e.key === 'ArrowDown') && isModPressed(e),
  run: (e) => {
    const ids = ctx.selection.get();
    if (ids.length === 0) return;
    const slide = currentSlide(ctx);
    if (!slide) return;
    e.preventDefault();
    const direction: 'forward' | 'backward' = e.key === 'ArrowUp' ? 'forward' : 'backward';
    const toEnd = e.shiftKey;
    ctx.store.batch(() => {
      for (const id of ids) {
        const idx = ctx.store.read().slides
          .find((s) => s.id === slide.id)!.elements
          .findIndex((el) => el.id === id);
        if (idx === -1) continue;
        const length = ctx.store.read().slides
          .find((s) => s.id === slide.id)!.elements.length;
        let target: number;
        if (direction === 'forward') target = toEnd ? length - 1 : Math.min(idx + 1, length - 1);
        else                          target = toEnd ? 0          : Math.max(idx - 1, 0);
        ctx.store.reorderElement(slide.id, id, target);
      }
    });
    ctx.requestRender();
  },
},
```

Add helpers:

```ts
import type { ElementInit } from '../../../model/element';
import {
  MIME_TYPE,
  serializeElements,
  deserializeElements,
} from './clipboard';

function currentSlide(ctx: KeyboardContext) {
  const id = ctx.currentSlideId();
  if (!id) return undefined;
  return ctx.store.read().slides.find((s) => s.id === id);
}

async function writeClipboard(elements: readonly Element[]): Promise<void> {
  const json = serializeElements(elements);
  const item = new ClipboardItem({
    [MIME_TYPE]: new Blob([json], { type: MIME_TYPE }),
  });
  await navigator.clipboard.write([item]);
}

async function readClipboard(): Promise<ElementInit[] | null> {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      if (item.types.includes(MIME_TYPE)) {
        const blob = await item.getType(MIME_TYPE);
        const json = await blob.text();
        return deserializeElements(json);
      }
    }
    return null;
  } catch {
    return null;  // permission denied or no slides payload
  }
}
```

Add `import type { Element } from '../../../model/element';` at the
top of `keyboard.ts`.

- [ ] **Step 2.5: Append keyboard tests for the new rules**

Append to `keyboard.test.ts`:

```ts
describe('keyboard — Cmd+D duplicate element', () => {
  it('duplicates selected elements and selects the copies', () => {
    const { editor: e, store, elementId } = makeFixture();
    editor = e;
    editor.setSelection([elementId]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', metaKey: true, bubbles: true }));
    const elements = store.read().slides[0].elements;
    expect(elements).toHaveLength(2);
    // Copy is offset by (10, 10).
    expect(elements[1].frame).toEqual({ x: 110, y: 110, w: 200, h: 100, rotation: 0 });
    expect(editor.getSelection()).toEqual([elements[1].id]);
  });

  it('with no element selected, duplicates the current slide', () => {
    const { editor: e, store } = makeFixture();
    editor = e;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', metaKey: true, bubbles: true }));
    expect(store.read().slides).toHaveLength(2);
  });
});

describe('keyboard — z-order shortcuts', () => {
  it('Cmd+ArrowUp brings forward', () => {
    const { editor: e, store } = makeFixture();
    editor = e;
    let bId = '';
    store.batch(() => {
      bId = store.addElement(store.read().slides[0].id, {
        type: 'shape',
        frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
        data: { kind: 'rect', fill: '#0a0' },
      });
    });
    // Now elements: [a (the original), b]. Selection = a.
    editor.setSelection([store.read().slides[0].elements[0].id]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', metaKey: true, bubbles: true }));
    // a should now be at index 1 (forward).
    expect(store.read().slides[0].elements[1].id).toBe(editor.getSelection()[0]);
    void bId;
  });
});
```

> Clipboard tests need a real `navigator.clipboard` mock — jsdom
> doesn't ship one. Mock at the top of the file:
>
> ```ts
> beforeEach(() => {
>   const writeArgs: unknown[][] = [];
>   const readQueue: unknown[][] = [];
>   Object.defineProperty(navigator, 'clipboard', {
>     value: {
>       write: vi.fn(async (items: unknown[]) => { writeArgs.push(items); }),
>       read: vi.fn(async () => readQueue.shift() ?? []),
>     },
>     configurable: true,
>   });
> });
> ```
>
> Then write tests for Cmd+C (asserts navigator.clipboard.write was
> called with a ClipboardItem of MIME_TYPE) and Cmd+V (queues a fake
> ClipboardItem, dispatches keydown, asserts new element). Skip if
> implementing both is too verbose — pure serialization tests in
> `clipboard.test.ts` cover the serialization path; the wiring is
> exercised by manual testing in T6.

- [ ] **Step 2.6: Run tests, confirm green**

- [ ] **Step 2.7: Commit**

```bash
git add packages/slides/src/view/editor/interactions/clipboard.ts packages/slides/src/view/editor/interactions/clipboard.test.ts packages/slides/src/view/editor/interactions/keyboard.ts packages/slides/src/view/editor/interactions/keyboard.test.ts
git commit -m "Add element clipboard, duplicate, and z-order shortcuts" -m "Cmd+C/X/V (custom MIME application/x-wafflebase-slides+json) cover
copy / cut / paste of selected elements through navigator.clipboard;
the same MIME type is what Phase 4's React wrapper will use, so a
copy from the slides demo can paste into the eventual frontend
editor and vice versa.

Cmd+D duplicates selected elements with a +10/+10 offset; with no
element selected it duplicates the current slide instead — Google
Slides' overload that gives Cmd+D a sensible default action no
matter what the user has focused.

z-order shortcuts (Cmd+↑/↓/⇧↑/⇧↓) call store.reorderElement;
Cmd+Shift goes all the way to front/back, Cmd alone steps by one.

Refs docs/design/slides/slides.md 'Interactions' table rows
Copy/Cut/Paste, Duplicate slide, and z-order shortcuts."
```

---

## Task 3: Multi-slide support + thumbnail panel

**Files:**
- Create: `packages/slides/src/view/editor/thumbnail-panel.ts`
- Create: `packages/slides/src/view/editor/thumbnail-panel.test.ts`
- Modify: `packages/slides/src/view/editor/editor.ts`

The editor gains `currentSlideId` state; the host can switch via
`editor.setCurrentSlide(id)`. When the current slide changes, the
canvas re-renders the new slide. Thumbnail panel is a separate DOM
component the demo mounts in a sibling div.

`thumbnail-panel.ts` exports `mountThumbnailPanel(container, store, editor)`
that:
- Renders one mini-canvas per slide via `renderThumbnail`
- Highlights the current slide
- Click → `editor.setCurrentSlide(id)`
- Shift-click → multi-select slides via the `slideSelection` callback
  pattern (separate from element selection)
- Drag thumbnail → `store.moveSlide(id, newIndex)` on drop
- "+" button → `store.addSlide('blank')`

For Phase 3b, slide multi-selection is tracked locally in the panel
(not on the editor) since v1 doesn't yet need slide-multi-select to
drive any other operation besides bulk delete from the context menu
(T4). The panel exposes `getSelectedSlideIds()` for T4.

- [ ] **Step 3.1: Add `currentSlideId` state to editor**

In `editor.ts`:

```ts
export interface SlidesEditor {
  // ... existing
  getCurrentSlideId(): string | undefined;
  setCurrentSlide(id: string): void;
  setSelection(ids: readonly string[]): void;  // already added in T1
}
```

Implementation: a private `currentSlideId: string | undefined`,
initialised to the first slide's id at construction. `setCurrentSlide`
clears element selection (selection is per-slide), updates state, and
re-renders.

`currentSlide()` private helper now returns the current slide, not
slides[0].

`onPointerDown`'s reference to `slides[0]` updates to use
`currentSlide()`.

- [ ] **Step 3.2: Tests for setCurrentSlide**

Append to `editor.test.ts`:

```ts
it('setCurrentSlide switches the rendered slide and clears element selection', () => {
  const { canvas, overlay, store } = makeFixture();
  let secondId = '';
  store.batch(() => { secondId = store.addSlide('blank'); });
  editor = initialize({ canvas, overlay, store, hostWidth: 960, hostHeight: 540, dpr: 1 });
  // Select an element on the first slide.
  const firstId = store.read().slides[0].id;
  let elementId = '';
  store.batch(() => {
    elementId = store.addElement(firstId, {
      type: 'shape',
      frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
      data: { kind: 'rect', fill: '#abc' },
    });
  });
  editor.setSelection([elementId]);
  editor.setCurrentSlide(secondId);
  expect(editor.getCurrentSlideId()).toBe(secondId);
  expect(editor.getSelection()).toEqual([]);
});
```

- [ ] **Step 3.3: Implement thumbnail-panel.ts (test-first)**

Tests in `thumbnail-panel.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import '../canvas/test-canvas-env';
import { MemSlidesStore } from '../../store/memory';
import { initialize } from './editor';
import { mountThumbnailPanel } from './thumbnail-panel';

beforeEach(() => { document.body.innerHTML = ''; });

function makeFixture() {
  const canvas = document.createElement('canvas');
  canvas.width = 960; canvas.height = 540;
  const overlay = document.createElement('div');
  const panel = document.createElement('div');
  document.body.appendChild(canvas);
  document.body.appendChild(overlay);
  document.body.appendChild(panel);
  const store = new MemSlidesStore();
  store.batch(() => { store.addSlide('blank'); store.addSlide('title'); });
  const editor = initialize({ canvas, overlay, store, hostWidth: 960, hostHeight: 540, dpr: 1 });
  return { canvas, overlay, panel, store, editor };
}

describe('mountThumbnailPanel', () => {
  it('renders one thumbnail per slide', () => {
    const { panel, store, editor } = makeFixture();
    mountThumbnailPanel(panel, store, editor);
    expect(panel.querySelectorAll('[data-slide-id]')).toHaveLength(2);
  });

  it('clicking a thumbnail switches the current slide', () => {
    const { panel, store, editor } = makeFixture();
    mountThumbnailPanel(panel, store, editor);
    const slideIds = store.read().slides.map((s) => s.id);
    const second = panel.querySelector<HTMLDivElement>(`[data-slide-id="${slideIds[1]}"]`)!;
    second.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(editor.getCurrentSlideId()).toBe(slideIds[1]);
  });

  it('highlights the current slide', () => {
    const { panel, store, editor } = makeFixture();
    mountThumbnailPanel(panel, store, editor);
    const firstId = store.read().slides[0].id;
    const first = panel.querySelector<HTMLDivElement>(`[data-slide-id="${firstId}"]`)!;
    expect(first.classList.contains('current')).toBe(true);
  });

  it('updates when a new slide is added (subscribes to store)', () => {
    const { panel, store, editor } = makeFixture();
    const handle = mountThumbnailPanel(panel, store, editor);
    store.batch(() => store.addSlide('blank'));
    handle.refresh();   // T3 keeps refresh manual; auto-subscribe is v2 polish
    expect(panel.querySelectorAll('[data-slide-id]')).toHaveLength(3);
  });
});
```

> Drag-reorder tests are skipped at the unit level — the
> implementation uses HTML5 drag-and-drop which jsdom only partially
> implements. Visual verification in T6.

Implementation `thumbnail-panel.ts`:

```ts
import type { SlidesStore } from '../../store/store';
import type { SlidesEditor } from './editor';
import { renderThumbnail } from '../canvas/thumbnail';

const THUMB_W = 192;
const THUMB_H = 108;

export interface ThumbnailPanelHandle {
  refresh(): void;
  dispose(): void;
  getSelectedSlideIds(): readonly string[];
}

export function mountThumbnailPanel(
  container: HTMLElement,
  store: SlidesStore,
  editor: SlidesEditor,
): ThumbnailPanelHandle {
  let selectedSlideIds: string[] = [];

  const render = () => {
    container.innerHTML = '';
    const doc = store.read();
    const currentId = editor.getCurrentSlideId();
    for (const slide of doc.slides) {
      const item = document.createElement('div');
      item.dataset.slideId = slide.id;
      item.className = 'wfb-slides-thumb' + (slide.id === currentId ? ' current' : '');
      item.style.width = `${THUMB_W}px`;
      item.style.height = `${THUMB_H}px`;
      item.style.cursor = 'pointer';
      item.style.outline = slide.id === currentId ? '2px solid #3a7' : '1px solid #444';
      item.style.marginBottom = '8px';
      item.draggable = true;

      const canvas = document.createElement('canvas');
      canvas.width = THUMB_W; canvas.height = THUMB_H;
      canvas.style.width = `${THUMB_W}px`;
      canvas.style.height = `${THUMB_H}px`;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        renderThumbnail(ctx, slide, { hostWidth: THUMB_W, hostHeight: THUMB_H, dpr: 1 });
      }
      item.appendChild(canvas);

      item.addEventListener('mousedown', (e) => {
        if (e.shiftKey) {
          // Toggle slide multi-selection.
          const idx = selectedSlideIds.indexOf(slide.id);
          if (idx === -1) selectedSlideIds.push(slide.id);
          else            selectedSlideIds.splice(idx, 1);
        } else {
          selectedSlideIds = [slide.id];
          editor.setCurrentSlide(slide.id);
        }
      });

      // HTML5 drag-and-drop reorder.
      item.addEventListener('dragstart', (e) => {
        if (e.dataTransfer) {
          e.dataTransfer.setData('text/plain', slide.id);
          e.dataTransfer.effectAllowed = 'move';
        }
      });
      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      });
      item.addEventListener('drop', (e) => {
        e.preventDefault();
        const sourceId = e.dataTransfer?.getData('text/plain');
        if (!sourceId || sourceId === slide.id) return;
        const targetIndex = doc.slides.findIndex((s) => s.id === slide.id);
        store.batch(() => store.moveSlide(sourceId, targetIndex));
        render();
      });

      container.appendChild(item);
    }

    // "+" Add-slide button at the bottom.
    const addBtn = document.createElement('button');
    addBtn.textContent = '+ Add slide';
    addBtn.style.width = `${THUMB_W}px`;
    addBtn.addEventListener('click', () => {
      store.batch(() => store.addSlide('blank'));
      render();
    });
    container.appendChild(addBtn);
  };

  // Re-render when the editor's currentSlideId changes (selection change
  // is a proxy for many editor mutations; cheap re-render is fine).
  const off = editor.onSelectionChange(() => render());

  render();

  return {
    refresh: render,
    dispose: () => off(),
    getSelectedSlideIds: () => [...selectedSlideIds],
  };
}
```

> The `refresh()` handle exists so the host can re-render after store
> changes the panel doesn't already know about (e.g. T2's Cmd+D adding
> a slide). Auto-subscribing to every store change is a v2 enhancement.

- [ ] **Step 3.4: Run tests, confirm green**

- [ ] **Step 3.5: Commit**

```bash
git add packages/slides/src/view/editor/thumbnail-panel.ts packages/slides/src/view/editor/thumbnail-panel.test.ts packages/slides/src/view/editor/editor.ts packages/slides/src/view/editor/editor.test.ts
git commit -m "Add multi-slide support + thumbnail panel" -m "Editor gains currentSlideId state with setCurrentSlide / getCurrentSlideId.
Switching slides clears element selection (which is a per-slide
concept) and re-renders.

mountThumbnailPanel is a separate DOM module the demo (and Phase 4's
React wrapper) attaches to a sibling container. Each slide gets a
mini-canvas thumbnail via renderThumbnail; click switches the current
slide; HTML5 drag-and-drop reorders via store.moveSlide; a + button
appends a new slide. Slide multi-selection (shift-click) is held in
the panel and exposed via getSelectedSlideIds for T4's context menu
to consume.

Refs docs/design/slides/slides.md 'Interactions' rows
Multi-select slides / Reorder slides / Add slide."
```

---

## Task 4: Right-click context menus

**Files:**
- Create: `packages/slides/src/view/editor/context-menu.ts`
- Create: `packages/slides/src/view/editor/context-menu.test.ts`
- Modify: `packages/slides/src/view/editor/editor.ts`

`context-menu.ts` exports `showContextMenu(container, items, anchorX, anchorY)`
which mounts a `<ul>` of menu items at the anchor point. Click an
item → its `run()` fires. Click outside / press Escape → menu
dismisses.

The editor wires `contextmenu` events on canvas + overlay. Hit-test
decides the menu kind:
- Right-click on an element: Copy, Cut, Paste, Duplicate, Delete,
  Bring forward, Send backward, Bring to front, Send to back
- Right-click on empty canvas: Paste, Insert ▸ (rect, ellipse, line,
  arrow, text), Slide background ▸
- Right-click on a thumbnail (T3 panel registers its own contextmenu
  listener): Duplicate, Delete, Insert above/below, Move up/down

- [x] **Step 4.1: Tests for showContextMenu**

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { showContextMenu } from './context-menu';

beforeEach(() => { document.body.innerHTML = ''; });

describe('showContextMenu', () => {
  it('mounts a list of items at the anchor point', () => {
    const items = [
      { label: 'Copy', run: vi.fn() },
      { label: 'Delete', run: vi.fn() },
    ];
    showContextMenu(document.body, items, 100, 50);
    const menu = document.body.querySelector<HTMLUListElement>('.wfb-slides-context-menu')!;
    expect(menu).toBeTruthy();
    expect(menu.children).toHaveLength(2);
    expect(menu.style.left).toBe('100px');
    expect(menu.style.top).toBe('50px');
  });

  it('clicking an item runs its handler and dismisses the menu', () => {
    const run = vi.fn();
    showContextMenu(document.body, [{ label: 'X', run }], 0, 0);
    const item = document.body.querySelector<HTMLLIElement>('.wfb-slides-context-menu li')!;
    item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('.wfb-slides-context-menu')).toBeNull();
  });

  it('clicking outside dismisses the menu', () => {
    showContextMenu(document.body, [{ label: 'X', run: vi.fn() }], 0, 0);
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(document.body.querySelector('.wfb-slides-context-menu')).toBeNull();
  });

  it('Escape dismisses', () => {
    showContextMenu(document.body, [{ label: 'X', run: vi.fn() }], 0, 0);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.body.querySelector('.wfb-slides-context-menu')).toBeNull();
  });

  it('only one menu can be open at a time', () => {
    showContextMenu(document.body, [{ label: 'A', run: vi.fn() }], 0, 0);
    showContextMenu(document.body, [{ label: 'B', run: vi.fn() }], 0, 0);
    expect(document.body.querySelectorAll('.wfb-slides-context-menu')).toHaveLength(1);
    expect(document.body.querySelector('.wfb-slides-context-menu li')!.textContent).toBe('B');
  });
});
```

- [x] **Step 4.2: Implement context-menu.ts**

```ts
export interface ContextMenuItem {
  label: string;
  run: () => void;
  disabled?: boolean;
  /** Use a horizontal divider when label is the literal string '---'. */
}

let activeMenu: HTMLUListElement | null = null;
let activeCleanup: (() => void) | null = null;

export function showContextMenu(
  host: HTMLElement,
  items: readonly ContextMenuItem[],
  anchorX: number,
  anchorY: number,
): void {
  dismiss();   // close any existing menu

  const menu = document.createElement('ul');
  menu.className = 'wfb-slides-context-menu';
  menu.style.position = 'fixed';
  menu.style.left = `${anchorX}px`;
  menu.style.top = `${anchorY}px`;
  menu.style.background = '#2a2a2a';
  menu.style.border = '1px solid #444';
  menu.style.borderRadius = '4px';
  menu.style.padding = '4px 0';
  menu.style.margin = '0';
  menu.style.listStyle = 'none';
  menu.style.zIndex = '9999';
  menu.style.minWidth = '180px';
  menu.style.fontFamily = 'system-ui, sans-serif';
  menu.style.fontSize = '13px';
  menu.style.color = '#ddd';
  menu.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.5)';

  for (const item of items) {
    if (item.label === '---') {
      const sep = document.createElement('li');
      sep.style.borderTop = '1px solid #444';
      sep.style.margin = '4px 0';
      menu.appendChild(sep);
      continue;
    }
    const li = document.createElement('li');
    li.textContent = item.label;
    li.style.padding = '6px 16px';
    li.style.cursor = item.disabled ? 'default' : 'pointer';
    if (item.disabled) li.style.opacity = '0.5';
    if (!item.disabled) {
      li.addEventListener('mouseenter', () => { li.style.background = '#3a7'; li.style.color = '#fff'; });
      li.addEventListener('mouseleave', () => { li.style.background = 'transparent'; li.style.color = '#ddd'; });
      li.addEventListener('click', (e) => {
        e.stopPropagation();
        const handler = item.run;
        dismiss();
        handler();
      });
    }
    menu.appendChild(li);
  }

  host.appendChild(menu);

  // Dismiss on outside click or Escape.
  const onOutside = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) dismiss();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') dismiss();
  };
  // Run AFTER current event loop so the showing right-click doesn't immediately
  // dismiss its own menu via the same event.
  setTimeout(() => {
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onKey);
  }, 0);

  activeMenu = menu;
  activeCleanup = () => {
    document.removeEventListener('mousedown', onOutside);
    document.removeEventListener('keydown', onKey);
  };
}

export function dismiss(): void {
  if (activeMenu) {
    activeMenu.remove();
    activeMenu = null;
  }
  if (activeCleanup) {
    activeCleanup();
    activeCleanup = null;
  }
}
```

- [x] **Step 4.3: Wire contextmenu events into editor**

In `editor.ts`:

```ts
private attachInteractions(): void {
  // ... existing mousedown listeners
  this.on(this.options.canvas, 'contextmenu', (e) => this.onContextMenu(e as MouseEvent));
  this.on(this.options.overlay, 'contextmenu', (e) => this.onContextMenu(e as MouseEvent));
}

private onContextMenu(e: MouseEvent): void {
  e.preventDefault();
  const { x, y } = this.clientToLogical(e.clientX, e.clientY);
  const slide = this.currentSlide();
  if (!slide) return;

  const hit = topmostUnderPoint(slide, x, y);
  const items = hit !== null
    ? this.elementContextItems(slide.id, hit)
    : this.canvasContextItems(slide.id, x, y);
  showContextMenu(document.body, items, e.clientX, e.clientY);
}

private elementContextItems(slideId: string, elementId: string): ContextMenuItem[] {
  // Ensure the right-clicked element is selected.
  if (!this.selection.has(elementId)) this.selection.set([elementId]);

  return [
    { label: 'Copy',  run: () => this.dispatchKey('c', { meta: true }) },
    { label: 'Cut',   run: () => this.dispatchKey('x', { meta: true }) },
    { label: 'Paste', run: () => this.dispatchKey('v', { meta: true }) },
    { label: '---', run: () => undefined },
    { label: 'Duplicate', run: () => this.dispatchKey('d', { meta: true }) },
    { label: 'Delete',    run: () => {
      this.options.store.batch(() => this.options.store.removeElements(slideId, this.selection.get()));
      this.selection.clear();
      this.requestRender();
    }},
    { label: '---', run: () => undefined },
    { label: 'Bring forward',  run: () => this.dispatchKey('ArrowUp',   { meta: true }) },
    { label: 'Send backward',  run: () => this.dispatchKey('ArrowDown', { meta: true }) },
    { label: 'Bring to front', run: () => this.dispatchKey('ArrowUp',   { meta: true, shift: true }) },
    { label: 'Send to back',   run: () => this.dispatchKey('ArrowDown', { meta: true, shift: true }) },
  ];
}

private canvasContextItems(slideId: string, x: number, y: number): ContextMenuItem[] {
  return [
    { label: 'Paste', run: () => this.dispatchKey('v', { meta: true }) },
    { label: '---',   run: () => undefined },
    { label: 'Insert rectangle', run: () => this.insertAt('rect', x, y) },
    { label: 'Insert ellipse',   run: () => this.insertAt('ellipse', x, y) },
    { label: 'Insert text',      run: () => this.insertAt('text', x, y) },
    void slideId,
  ].filter((i): i is ContextMenuItem => typeof i === 'object' && i !== null);
}

private insertAt(kind: InsertKind, x: number, y: number): void {
  // Default-size insert at the click point.
  const slide = this.currentSlide();
  if (!slide) return;
  const init = buildInsertElement(kind, { x, y }, { x: x + 200, y: y + 100 });
  this.options.store.batch(() => {
    const id = this.options.store.addElement(slide.id, init);
    this.selection.set([id]);
  });
  this.requestRender();
}

private dispatchKey(key: string, mods: { meta?: boolean; shift?: boolean }): void {
  document.dispatchEvent(new KeyboardEvent('keydown', {
    key, metaKey: mods.meta, shiftKey: mods.shift, bubbles: true,
  }));
}

private requestRender(): void {
  this.renderer.markDirty();
  this.render();
  this.repaintOverlay();
}
```

(Replace inline `requestRender` paths in keyboard.ts callbacks too —
factor into the editor's `requestRender`.)

Imports:

```ts
import { showContextMenu, type ContextMenuItem } from './context-menu';
```

- [x] **Step 4.4: Run tests, confirm green**

- [x] **Step 4.5: Commit**

```bash
git commit -m "Add right-click context menus" -m "Vanilla-DOM <ul> menu mounted at the click point. Outside-click and
Escape dismiss; one menu open at a time. The slides package has no
React dependency, so this is the in-package solution; Phase 4's
frontend wrapper can swap in Radix ContextMenu by intercepting the
contextmenu event before it reaches the editor.

Element menu offers Copy/Cut/Paste/Duplicate/Delete and the four
z-order items; canvas menu offers Paste + Insert ▸. Most items
delegate to the existing keyboard handlers via dispatchKey, so any
behaviour change to the keyboard rules automatically flows through
to the menu — single source of truth.

Refs docs/design/slides/slides.md sections 'Editor UI > Context menus'
and the matching 'Interactions' table row."
```

---

## Task 5: Speaker notes panel

**Files:**
- Create: `packages/slides/src/view/editor/notes-panel.ts`
- Create: `packages/slides/src/view/editor/notes-panel.test.ts`

`notes-panel.ts` mounts a `<textarea>` into a host container, bound
to the current slide's `notes` via `withNotes`. v1 uses plain text
serialization (one paragraph per line); Phase 5 swaps to a docs IME
bridge backed by `Yorkie.Tree`.

- [x] **Step 5.1: Tests for notes-panel**

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import '../canvas/test-canvas-env';
import { MemSlidesStore } from '../../store/memory';
import { initialize } from './editor';
import { mountNotesPanel } from './notes-panel';

beforeEach(() => { document.body.innerHTML = ''; });

function makeFixture() {
  const canvas = document.createElement('canvas');
  canvas.width = 960; canvas.height = 540;
  const overlay = document.createElement('div');
  const notes = document.createElement('div');
  document.body.appendChild(canvas);
  document.body.appendChild(overlay);
  document.body.appendChild(notes);
  const store = new MemSlidesStore();
  store.batch(() => store.addSlide('blank'));
  const editor = initialize({ canvas, overlay, store, hostWidth: 960, hostHeight: 540, dpr: 1 });
  return { canvas, overlay, notes, store, editor };
}

describe('mountNotesPanel', () => {
  it('renders a textarea', () => {
    const { notes, store, editor } = makeFixture();
    mountNotesPanel(notes, store, editor);
    expect(notes.querySelector('textarea')).toBeTruthy();
  });

  it('typing into the textarea writes to the slide notes', () => {
    const { notes, store, editor } = makeFixture();
    mountNotesPanel(notes, store, editor);
    const ta = notes.querySelector<HTMLTextAreaElement>('textarea')!;
    ta.value = 'remember to smile';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    // Notes are stored as Block[]; one block per line, plain inlines.
    const text = (store.read().slides[0].notes[0]?.inlines?.[0] as { text: string } | undefined)?.text;
    expect(text).toBe('remember to smile');
    void editor;
  });

  it('switching slides re-binds to the new slide notes', () => {
    const { notes, store, editor } = makeFixture();
    let secondId = '';
    store.batch(() => { secondId = store.addSlide('blank'); });
    mountNotesPanel(notes, store, editor);
    const ta = notes.querySelector<HTMLTextAreaElement>('textarea')!;
    ta.value = 'first slide notes';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    editor.setCurrentSlide(secondId);
    expect(ta.value).toBe('');
    ta.value = 'second slide notes';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    expect((store.read().slides[1].notes[0]?.inlines?.[0] as { text: string }).text).toBe('second slide notes');
    expect((store.read().slides[0].notes[0]?.inlines?.[0] as { text: string }).text).toBe('first slide notes');
  });
});
```

- [x] **Step 5.2: Implement notes-panel.ts**

```ts
import type { Block } from '@wafflebase/docs';
import type { SlidesStore } from '../../store/store';
import type { SlidesEditor } from './editor';

export function mountNotesPanel(
  container: HTMLElement,
  store: SlidesStore,
  editor: SlidesEditor,
): { dispose(): void } {
  container.innerHTML = '';
  const ta = document.createElement('textarea');
  ta.placeholder = 'Speaker notes…';
  ta.style.width = '100%';
  ta.style.minHeight = '80px';
  ta.style.background = '#2a2a2a';
  ta.style.color = '#ddd';
  ta.style.border = '1px solid #444';
  ta.style.padding = '8px';
  ta.style.fontFamily = 'system-ui, sans-serif';
  ta.style.fontSize = '14px';
  ta.style.resize = 'vertical';
  container.appendChild(ta);

  const sync = () => {
    const id = editor.getCurrentSlideId();
    if (!id) { ta.value = ''; return; }
    const slide = store.read().slides.find((s) => s.id === id);
    if (!slide) { ta.value = ''; return; }
    ta.value = blocksToText(slide.notes);
  };

  ta.addEventListener('input', () => {
    const id = editor.getCurrentSlideId();
    if (!id) return;
    store.batch(() => {
      store.withNotes(id, () => textToBlocks(ta.value));
    });
  });

  // Re-bind when current slide changes (the editor's onSelectionChange
  // fires for many edits including setCurrentSlide; cheap to re-read).
  const off = editor.onSelectionChange(() => sync());
  sync();

  return { dispose: () => off() };
}

function blocksToText(blocks: readonly Block[]): string {
  return blocks
    .map((b) => (b.inlines || []).map((i) => i.text).join(''))
    .join('\n');
}

function textToBlocks(text: string): Block[] {
  const lines = text === '' ? [''] : text.split('\n');
  return lines.map((line, i) => ({
    id: `notes-${i}`,
    type: 'paragraph',
    inlines: [{ text: line, style: {} }],
    style: {},
  } as Block));
}
```

> Phase 5 will replace the textarea with a docs-IME-backed
> contenteditable so notes get the same rich-text capabilities as
> body text. The Block[] storage is forward-compatible.

- [x] **Step 5.3: Run tests, confirm green**

- [x] **Step 5.4: Commit**

```bash
git commit -m "Add speaker notes panel (textarea, plain text)" -m "v1 panel is a plain <textarea> bound to slide.notes via withNotes,
serialised as one Block[] paragraph per line. Switches between slides
on editor.setCurrentSlide (via the onSelectionChange subscription —
which also fires for current-slide changes today). Phase 5 will
replace the textarea with a contenteditable backed by the docs IME
bridge so notes get the same rich-text affordances as body text;
Block[] storage is forward-compatible.

Refs docs/design/slides/slides.md 'Editor UI > Speaker notes panel'."
```

---

## Task 6: Spike + demo update + final gate

**Files:**
- Create: `packages/slides/spike/docs-richtext-audit.md`
- Modify: `packages/slides/index.html`, `packages/slides/demo.ts`
- Modify: `packages/slides/src/index.ts`
- Modify: `docs/tasks/active/20260505-slides-package-mvp-todo.md`

The spike investigates `@wafflebase/docs`'s page-flow assumptions and
documents what slides will need from docs to wire `withTextElement`
through a real IME bridge in Phase 5. No code lands — only the
research output.

- [ ] **Step 6.1: Spike — read packages/docs and write the audit**

Investigate:
- Does `computeLayout(blocks, measurer, width)` already work for a
  single text-box width, or are there page-related assumptions it
  carries that bleed in?
- The docs editor's IME bridge — where does it live? Can it be
  parameterised on the host container so slides supplies its own
  textbox-shaped contenteditable?
- The docs `Selection` model — does it know about pages, or is it
  block-relative? (Hopefully the latter.)
- Cursor / caret rendering — same question.
- What surface is currently exported from `@wafflebase/docs` vs only
  used internally? List the gaps slides will need filled.

Write to `packages/slides/spike/docs-richtext-audit.md`:

```markdown
# docs RichText Audit for Slides Phase 5

Status: investigation, no code.

## Summary

[2-3 sentences: top-line finding — is reuse straightforward, or do we
need to refactor docs? What's the rough cost?]

## Findings

### computeLayout reusability
[file:line references; what assumptions, if any, are page-shaped]

### IME bridge
[where it lives; can it be hosted inside a slides text-box overlay?]

### Selection / cursor
[block-relative or page-relative?]

### Required exports
[list any internal-only surfaces slides will need, with file paths]

## Recommendation

Phase 5 plan: [bullet list of work items + rough order]
```

- [ ] **Step 6.2: Update src/index.ts with Phase 3b exports**

Append to `packages/slides/src/index.ts`:

```ts
// View — Editor (Phase 3b additions)
export { mountThumbnailPanel, type ThumbnailPanelHandle } from './view/editor/thumbnail-panel';
export { mountNotesPanel } from './view/editor/notes-panel';
export { showContextMenu, dismiss as dismissContextMenu, type ContextMenuItem } from './view/editor/context-menu';
export { MIME_TYPE as SLIDES_CLIPBOARD_MIME, serializeElements, deserializeElements } from './view/editor/interactions/clipboard';
```

> Internal `keymap.ts`, `keyboard.ts`, `context-menu` internals stay
> private.

- [ ] **Step 6.3: Update index.html with thumbnail strip + notes panel**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>@wafflebase/slides demo</title>
    <style>
      body { margin: 0; background: #1a1a1a; color: #ddd; font-family: system-ui, sans-serif; }
      .stage { display: grid; grid-template-columns: 220px 1fr; min-height: 100vh; gap: 12px; padding: 24px; box-sizing: border-box; }
      .left { display: flex; flex-direction: column; gap: 8px; overflow-y: auto; max-height: calc(100vh - 48px); }
      .right { display: flex; flex-direction: column; gap: 12px; }
      .toolbar { display: flex; gap: 8px; flex-wrap: wrap; }
      .toolbar button {
        background: #2a2a2a; color: #ddd; border: 1px solid #444;
        padding: 6px 12px; cursor: pointer; border-radius: 4px;
        font-size: 13px;
      }
      .toolbar button:hover { background: #333; }
      .toolbar button.active { background: #3a7; border-color: #3a7; color: #fff; }
      .canvas-wrap { position: relative; align-self: flex-start; }
      canvas { background: #fff; box-shadow: 0 8px 32px rgba(0,0,0,0.5); display: block; }
      .overlay { position: absolute; left: 0; top: 0; width: 960px; height: 540px; pointer-events: none; }
      .overlay [data-handle] { pointer-events: auto; }
      .notes-host { background: #1f1f1f; padding: 8px; border-radius: 4px; }
      .notes-host h4 { margin: 0 0 8px 0; font-size: 12px; opacity: 0.7; }
    </style>
  </head>
  <body>
    <div class="stage">
      <div class="left">
        <div id="thumbnails"></div>
      </div>
      <div class="right">
        <div class="toolbar" id="toolbar">
          <button data-insert="rect">+ Rect</button>
          <button data-insert="ellipse">+ Ellipse</button>
          <button data-insert="line">+ Line</button>
          <button data-insert="arrow">+ Arrow</button>
          <button data-insert="text">+ Text</button>
        </div>
        <div class="canvas-wrap">
          <canvas id="slide" width="960" height="540"></canvas>
          <div id="overlay" class="overlay"></div>
        </div>
        <div class="notes-host">
          <h4>Speaker notes</h4>
          <div id="notes"></div>
        </div>
      </div>
    </div>
    <script type="module" src="./demo.ts"></script>
  </body>
</html>
```

- [ ] **Step 6.4: Update demo.ts with thumbnail panel + notes panel + multi-slide fixture**

```ts
import {
  MemSlidesStore,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  initializeEditor,
  mountThumbnailPanel,
  mountNotesPanel,
  type InsertKind,
} from './src/index';

const HOST_W = 960;
const HOST_H = 540;
const DPR = window.devicePixelRatio || 1;

const canvas = document.getElementById('slide') as HTMLCanvasElement;
canvas.width = HOST_W * DPR;
canvas.height = HOST_H * DPR;
canvas.style.width = `${HOST_W}px`;
canvas.style.height = `${HOST_H}px`;

const overlay = document.getElementById('overlay') as HTMLDivElement;

const store = new MemSlidesStore();
store.batch(() => {
  // Slide 1: shapes
  const a = store.addSlide('blank');
  store.addElement(a, {
    type: 'shape',
    frame: { x: 200, y: 200, w: 400, h: 200, rotation: 0 },
    data: { kind: 'rect', fill: '#3a7' },
  });
  // Slide 2: title layout
  store.addSlide('title');
  // Slide 3: blank
  store.addSlide('blank');
});

const editor = initializeEditor({
  canvas, overlay, store,
  hostWidth: HOST_W, hostHeight: HOST_H, dpr: DPR,
});

const thumbHandle = mountThumbnailPanel(
  document.getElementById('thumbnails') as HTMLDivElement,
  store, editor,
);

mountNotesPanel(
  document.getElementById('notes') as HTMLDivElement,
  store, editor,
);

const toolbar = document.getElementById('toolbar') as HTMLDivElement;
toolbar.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const insert = target.dataset.insert as InsertKind | undefined;
  if (!insert) return;
  const wasActive = target.classList.contains('active');
  toolbar.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
  if (wasActive) {
    editor.setInsertMode(null);
  } else {
    target.classList.add('active');
    editor.setInsertMode(insert);
  }
});

// Refresh thumbnails when the store changes (Cmd+D, paste, insert).
// Cheap: re-render every frame piggybacking on requestAnimationFrame.
let lastSlideCount = store.read().slides.length;
function tick(): void {
  editor.render();
  const count = store.read().slides.length;
  if (count !== lastSlideCount) {
    lastSlideCount = count;
    thumbHandle.refresh();
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

void SLIDE_HEIGHT; void SLIDE_WIDTH;
```

- [ ] **Step 6.5: typecheck + test + verify:fast**

Run: `pnpm slides typecheck && pnpm slides test`
Expected: green.

Run: `pnpm verify:fast`
Expected: green.

- [ ] **Step 6.6: Boot dev server, verify HTTP 200, stop**

`pnpm slides dev` background → curl `/` and `/demo.ts` → expect 200
both → stop server.

- [ ] **Step 6.7: Tick Phase 3b items in the high-level todo**

In `docs/tasks/active/20260505-slides-package-mvp-todo.md`, mark
items 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13, 3.14, 3.15 as `[x]`.

- [ ] **Step 6.8: Commit**

```bash
git add packages/slides/spike packages/slides/index.html packages/slides/demo.ts packages/slides/src/index.ts docs/tasks/active/20260505-slides-package-mvp-todo.md
git commit -m "Wire Phase 3b demo + spike + tick checklist" -m "demo.ts now mounts the thumbnail strip on the left, the canvas +
overlay + toolbar in the centre, and the speaker notes panel below
the canvas. The fixture seeds three slides so the thumbnail panel
shows real interactions on first load.

spike/docs-richtext-audit.md captures the docs / RichText
investigation that gates Phase 5's text-bridge work — reuse
feasibility, IME bridge hosting question, and the surface gaps slides
will need exported from @wafflebase/docs.

Phase 3b checklist items 3.7-3.15 ticked.

verify:fast green at this commit."
```

---

## Phase 3b Done

After Task 6:

- `pnpm slides test` and `pnpm slides typecheck` are green.
- `pnpm verify:fast` is green.
- The dev demo lets a user nudge / undo / copy / paste / duplicate
  via keyboard, switch slides via the thumbnail strip, drag-reorder
  thumbnails, right-click for context menus, and type into speaker
  notes.
- Phase 3b checklist (3.7-3.15) ticked. Phase 3 is complete.
- `@wafflebase/slides` exposes the full v1 editor surface; Phase 4's
  React wrapper imports through the package boundary.

When you are ready for **Phase 4** (Yorkie + multi-user), the plan
will assume everything in Phases 1, 2, 3a, and 3b is real.
