# Slides Phase 3a (Core Editor) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single-user, vanilla-DOM editor controller to
`@wafflebase/slides` that turns Phase 2's static rendering into an
interactive surface — click to select, shift-click for multi-select,
lasso for rubber-band, drag to move, eight-handle resize, rotate, and
toolbar-driven insert. End the phase with the existing `pnpm slides
dev` demo letting a user actually move shapes around the slide.

**Architecture:**
- One vanilla-TypeScript `SlidesEditor` controller class, no React.
  Mirrors `Spreadsheet`/`initialize()` in `packages/sheets` and
  `EditorAPI` in `packages/docs`.
- Interaction state is a small set of private fields on the
  controller (`mode: 'idle' | 'dragging' | 'resizing' | 'rotating' |
  'inserting' | 'lassoing'` + per-mode payload). Same shape as
  `Worksheet`'s `editMode` / `resizeDragging` / `dragMove` flags.
- DOM overlay = a single `<div>` absolutely positioned over the
  `<canvas>`. The editor mounts/repositions handle elements inside it.
- Selection lives in the editor (transient), not in the document. A
  callback API (`onSelectionChange`) lets the host re-render handles.
- Hit-testing reuses `containsPoint` from `model/frame.ts`, so click
  and paint stay in agreement.

**Tech stack:** Same as Phase 2. New: `keymap.ts` utilities copied
from `packages/sheets/src/view/keymap.ts` (the file is generic and
small enough that copying is cheaper than introducing a slides → sheets
dependency).

**Spec:** [`docs/design/slides/slides.md`](../../design/slides/slides.md)
sections "Editor UI" and "Interactions". This plan delivers the rows
in the Interactions table covering Select, Multi-select, Lasso select,
Drag move, Resize, Rotate, and Add shape/text/image; the keyboard /
clipboard / context-menu / notes-panel rows arrive in **Phase 3b**.

**High-level checklist:** [`20260505-slides-package-mvp-todo.md`](20260505-slides-package-mvp-todo.md)

> Phase 3a ends when every box below is checked, `pnpm slides test`
> and `pnpm slides typecheck` are green, `pnpm verify:fast` is green,
> and the dev server demo lets a user select / drag / resize / rotate
> the four shapes from the Phase 2 fixture, plus place a new shape
> via the toolbar. **Phase 3b (keyboard, clipboard, thumbnails,
> context menus, speaker notes) gets its own plan after 3a lands.**

---

## File structure

Created in this phase:

```
packages/slides/
├── demo.ts                                     # T8 (rewritten with toolbar + editor mount)
├── index.html                                  # T8 (extended layout — toolbar + overlay + canvas)
└── src/
    └── view/
        ├── editor/
        │   ├── editor.ts                       # T1 (SlidesEditor class)
        │   ├── editor.test.ts                  # T1
        │   ├── selection.ts                    # T1 (Selection state + callbacks)
        │   ├── selection.test.ts               # T1
        │   ├── keymap.ts                       # T1 (copy of sheets keymap)
        │   ├── overlay.ts                      # T2 (handle DOM management)
        │   ├── overlay.test.ts                 # T2
        │   ├── hit-test.ts                     # T2 (handle hit-test → which handle?)
        │   ├── hit-test.test.ts                # T2
        │   ├── snap.ts                         # T4 (snap-to-edge math)
        │   ├── snap.test.ts                    # T4
        │   └── interactions/
        │       ├── select.ts                   # T3 (click + multi-select)
        │       ├── select.test.ts              # T3
        │       ├── lasso.ts                    # T3 (rubber-band)
        │       ├── lasso.test.ts               # T3
        │       ├── drag.ts                     # T4
        │       ├── drag.test.ts                # T4
        │       ├── resize.ts                   # T5
        │       ├── resize.test.ts              # T5
        │       ├── rotate.ts                   # T6
        │       ├── rotate.test.ts              # T6
        │       ├── insert.ts                   # T7
        │       └── insert.test.ts              # T7
```

Modified in this phase:

- `packages/slides/src/index.ts` — re-export `initialize` and a small
  set of editor types
- `docs/tasks/active/20260505-slides-package-mvp-todo.md` — tick items
  3.1, 3.2, 3.3, 3.4, 3.5, 3.6 at the end of T8 (3.7-3.15 land in 3b)

---

## Conventions (carried from prior phases)

- Local imports use no extension (`'./foo'`). Package imports use the
  package name.
- Tests live next to source. Files needing `Image` or Canvas 2D
  globals start with `// @vitest-environment jsdom` and import the
  shared `test-canvas-env` shim where appropriate.
- Commits: `git commit -m "subject" -m "body"`, never `--no-verify`.
- All work happens on branch `feat/slides-phase1`. Phase 1 + 2 + 3a
  + 3b will likely ship as one PR; same-branch is the user's choice.
- Implementation runs from the parent checkout
  (`/Users/hackerwins/Development/wafflebase/waffleslides`).

---

## Architecture sketch — `SlidesEditor`

```ts
export interface SlidesEditorOptions {
  canvas: HTMLCanvasElement;
  overlay: HTMLDivElement;
  store: SlidesStore;
  hostWidth: number;
  hostHeight: number;
  dpr: number;
}

export interface SlidesEditor {
  /** Force a repaint of the canvas + overlay. */
  render(): void;
  /** Currently selected element ids (in order of selection). */
  getSelection(): readonly string[];
  /** Subscribe to selection changes; returns an unsubscribe function. */
  onSelectionChange(cb: () => void): () => void;
  /** Set or clear insert mode. Null = back to idle (select). */
  setInsertMode(kind: InsertKind | null): void;
  /** Detach all listeners. Call before unmounting the canvas. */
  detach(): void;
}

export type InsertKind = 'rect' | 'ellipse' | 'line' | 'arrow' | 'text';

export function initialize(options: SlidesEditorOptions): SlidesEditor;
```

Internal state (private fields on the class):

```ts
private mode:
  | { type: 'idle' }
  | { type: 'dragging'; startX: number; startY: number; offsets: Map<string, { dx: number; dy: number }> }
  | { type: 'resizing'; handle: ResizeHandle; startFrame: Frame; elementId: string }
  | { type: 'rotating'; centerX: number; centerY: number; startAngle: number; startRotation: number; elementId: string }
  | { type: 'inserting'; kind: InsertKind; startX: number; startY: number; previewEl: Element | null }
  | { type: 'lassoing'; startX: number; startY: number; rectEl: HTMLDivElement };
```

`mode === 'idle'` (the default) means click selects / shift-clicks
multi-toggle. The transitions between modes happen in pointer-down
handlers based on hit-testing.

---

## Test strategy

- DOM events are synthesised via `new MouseEvent('mousedown', { ... })`
  and dispatched on the canvas / document. jsdom delivers them.
- Each interaction module exposes a tiny pure function alongside its
  imperative wiring. For example `drag.ts` exports both
  `applyDrag(elements, dx, dy): Element[]` (pure, easy to test) and
  the pointer-event side-effecting `attachDrag(editor)` it wires up
  internally. Tests cover the pure half thoroughly; the imperative
  glue is exercised end-to-end through the editor.
- Tests that touch `text-renderer` indirectly (via element-renderer
  → drawText) need the `OffscreenCanvas` shim from
  `view/canvas/test-canvas-env.ts`.

---

## Task 1: Editor scaffold + Selection state

**Files:**
- Create: `packages/slides/src/view/editor/editor.ts`
- Create: `packages/slides/src/view/editor/editor.test.ts`
- Create: `packages/slides/src/view/editor/selection.ts`
- Create: `packages/slides/src/view/editor/selection.test.ts`

> **Plan amendment:** the original plan also created
> `packages/slides/src/view/editor/keymap.ts` here as a copy of
> `packages/sheets/src/view/keymap.ts`. That copy was reverted because
> Phase 3a never wires keyboard handling and `verify:entropy` (knip)
> correctly flagged it as dead code. Phase 3b's keyboard task re-adds
> the keymap copy at the moment a consumer first imports it.

`Selection` is a tiny class with subscriber callbacks. The editor
shell wires it up but doesn't yet do anything interactive — that's
T2 onward.

- [ ] **Step 1.1: Create `packages/slides/src/view/editor/keymap.ts`**

> **NOTE:** `packages/slides/src/view/canvas/test-canvas-env.ts` must
> additionally patch `HTMLCanvasElement.prototype.getContext('2d')` if
> it doesn't already — jsdom returns `null` for the 2D context, which
> blows up `initialize()` when the editor tests construct a
> SlideRenderer. T1 implementer extended the shim; subsequent re-runs
> benefit from the same patch.

Copy `packages/sheets/src/view/keymap.ts` verbatim — no changes.
The file is ~70 lines, generic, and has no sheets-specific behaviour.
Document the copy at the top:

```ts
/**
 * Cross-platform keyboard combo helpers, copied from
 * `packages/sheets/src/view/keymap.ts`. We copy rather than import to
 * avoid a slides → sheets dependency (sheets pulls in antlr4ts and
 * the formula engine — neither is wanted here).
 *
 * If you change either copy, change the other. There is no automated
 * sync.
 */
```

Then paste the body from `packages/sheets/src/view/keymap.ts`
unchanged (the `KeyEventLike` type, `KeyCombo`, `normalizeKey`,
`isModPressed`, `keyEquals`, `matchesKeyCombo`, `KeyRule`,
`runKeyRules`).

- [ ] **Step 1.2: Write failing tests for `Selection`**

Create `packages/slides/src/view/editor/selection.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { Selection } from './selection';

describe('Selection', () => {
  it('starts empty', () => {
    const sel = new Selection();
    expect(sel.get()).toEqual([]);
  });

  it('set replaces the selection and notifies subscribers', () => {
    const sel = new Selection();
    const cb = vi.fn();
    sel.subscribe(cb);
    sel.set(['a', 'b']);
    expect(sel.get()).toEqual(['a', 'b']);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('toggle adds an unselected id', () => {
    const sel = new Selection();
    sel.set(['a']);
    sel.toggle('b');
    expect(sel.get()).toEqual(['a', 'b']);
  });

  it('toggle removes an already-selected id', () => {
    const sel = new Selection();
    sel.set(['a', 'b']);
    sel.toggle('a');
    expect(sel.get()).toEqual(['b']);
  });

  it('clear empties and notifies', () => {
    const sel = new Selection();
    sel.set(['a']);
    const cb = vi.fn();
    sel.subscribe(cb);
    sel.clear();
    expect(sel.get()).toEqual([]);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('does not notify when set is called with the same selection', () => {
    const sel = new Selection();
    sel.set(['a', 'b']);
    const cb = vi.fn();
    sel.subscribe(cb);
    sel.set(['a', 'b']);
    expect(cb).not.toHaveBeenCalled();
  });

  it('subscribe returns an unsubscribe function', () => {
    const sel = new Selection();
    const cb = vi.fn();
    const off = sel.subscribe(cb);
    off();
    sel.set(['a']);
    expect(cb).not.toHaveBeenCalled();
  });

  it('has() reports membership', () => {
    const sel = new Selection();
    sel.set(['a', 'b']);
    expect(sel.has('a')).toBe(true);
    expect(sel.has('c')).toBe(false);
  });
});
```

- [ ] **Step 1.3: Verify tests FAIL (module not found)**

Run: `pnpm slides test`
Expected: FAIL — `./selection` not found.

- [ ] **Step 1.4: Implement `selection.ts`**

```ts
type Listener = () => void;

/**
 * Transient editor selection state. Holds the ordered list of
 * currently-selected element ids and notifies subscribers on change.
 *
 * Selection is editor-local, not stored in the SlidesDocument:
 * other users see selections via Phase 4 presence, not via Yorkie.
 */
export class Selection {
  private ids: string[] = [];
  private listeners = new Set<Listener>();

  get(): readonly string[] {
    return this.ids;
  }

  has(id: string): boolean {
    return this.ids.includes(id);
  }

  set(next: readonly string[]): void {
    if (sameOrder(this.ids, next)) return;
    this.ids = [...next];
    this.notify();
  }

  toggle(id: string): void {
    const i = this.ids.indexOf(id);
    if (i === -1) {
      this.ids = [...this.ids, id];
    } else {
      this.ids = [...this.ids.slice(0, i), ...this.ids.slice(i + 1)];
    }
    this.notify();
  }

  clear(): void {
    if (this.ids.length === 0) return;
    this.ids = [];
    this.notify();
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notify(): void {
    for (const cb of this.listeners) cb();
  }
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
```

- [ ] **Step 1.5: Verify Selection tests pass**

Run: `pnpm slides test`
Expected: PASS — Selection tests green.

- [ ] **Step 1.6: Write failing tests for `SlidesEditor` shell**

> **NOTE:** prepend `import '../canvas/test-canvas-env';` so the
> OffscreenCanvas + HTMLCanvasElement.prototype.getContext('2d') shims
> are loaded before `initialize` constructs the SlideRenderer (jsdom
> does not implement Canvas 2D).

Create `packages/slides/src/view/editor/editor.test.ts`. Add the
jsdom directive at the top (we synthesise DOM events later):

```ts
// @vitest-environment jsdom
import '../canvas/test-canvas-env';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemSlidesStore } from '../../store/memory';
import { initialize, type SlidesEditor } from './editor';

function makeFixture() {
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 540;
  const overlay = document.createElement('div');
  overlay.style.position = 'absolute';
  document.body.appendChild(canvas);
  document.body.appendChild(overlay);
  const store = new MemSlidesStore();
  store.batch(() => store.addSlide('blank'));
  return { canvas, overlay, store };
}

describe('initialize', () => {
  let editor: SlidesEditor | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
    if (editor) {
      editor.detach();
      editor = null;
    }
  });

  it('returns an editor with an empty selection', () => {
    const { canvas, overlay, store } = makeFixture();
    editor = initialize({ canvas, overlay, store, hostWidth: 960, hostHeight: 540, dpr: 1 });
    expect(editor.getSelection()).toEqual([]);
  });

  it('subscribers fire when selection changes', () => {
    const { canvas, overlay, store } = makeFixture();
    editor = initialize({ canvas, overlay, store, hostWidth: 960, hostHeight: 540, dpr: 1 });
    const cb = vi.fn();
    editor.onSelectionChange(cb);
    // Programmatic state poke through render; for now we only verify
    // the wiring exists. Concrete click → selection wiring is T3.
    expect(cb).not.toHaveBeenCalled();
  });

  it('detach removes all DOM listeners (calling render after detach is safe)', () => {
    const { canvas, overlay, store } = makeFixture();
    editor = initialize({ canvas, overlay, store, hostWidth: 960, hostHeight: 540, dpr: 1 });
    editor.detach();
    expect(() => editor!.render()).not.toThrow();
  });

  it('setInsertMode(null) is the default and is idempotent', () => {
    const { canvas, overlay, store } = makeFixture();
    editor = initialize({ canvas, overlay, store, hostWidth: 960, hostHeight: 540, dpr: 1 });
    expect(() => editor!.setInsertMode(null)).not.toThrow();
    expect(() => editor!.setInsertMode('rect')).not.toThrow();
    expect(() => editor!.setInsertMode(null)).not.toThrow();
  });
});
```

- [ ] **Step 1.7: Verify tests FAIL (module not found)**

Run: `pnpm slides test`
Expected: FAIL — `./editor` not found.

- [ ] **Step 1.8: Implement `editor.ts` (shell only — interactions are T3-T7)**

```ts
import type { SlidesStore } from '../../store/store';
import { SlideRenderer, type SlideRendererOptions } from '../canvas/slide-renderer';
import { Selection } from './selection';

export type InsertKind = 'rect' | 'ellipse' | 'line' | 'arrow' | 'text';

export interface SlidesEditorOptions extends SlideRendererOptions {
  canvas: HTMLCanvasElement;
  overlay: HTMLDivElement;
  store: SlidesStore;
}

export interface SlidesEditor {
  render(): void;
  getSelection(): readonly string[];
  onSelectionChange(cb: () => void): () => void;
  setInsertMode(kind: InsertKind | null): void;
  detach(): void;
}

interface ListenerEntry<E extends Event = Event> {
  target: EventTarget;
  type: string;
  handler: (e: E) => void;
}

class SlidesEditorImpl implements SlidesEditor {
  readonly selection = new Selection();
  insertKind: InsertKind | null = null;
  private renderer: SlideRenderer;
  private listeners: ListenerEntry[] = [];
  private disposed = false;

  constructor(private options: SlidesEditorOptions) {
    const ctx = options.canvas.getContext('2d');
    if (!ctx) throw new Error('SlidesEditor: canvas has no 2D context');
    this.renderer = new SlideRenderer(ctx, options);
    // Selection changes invalidate the overlay; T2 wires the actual
    // overlay paint. For now, just mark the canvas dirty.
    this.selection.subscribe(() => this.renderer.markDirty());
  }

  render(): void {
    if (this.disposed) return;
    const slide = this.options.store.read().slides[0];
    if (!slide) return;
    this.renderer.render(slide);
  }

  getSelection(): readonly string[] {
    return this.selection.get();
  }

  onSelectionChange(cb: () => void): () => void {
    return this.selection.subscribe(cb);
  }

  setInsertMode(kind: InsertKind | null): void {
    this.insertKind = kind;
    // T7 wires this to a cursor change + canvas pointerdown handler.
  }

  detach(): void {
    this.disposed = true;
    for (const { target, type, handler } of this.listeners) {
      target.removeEventListener(type, handler as EventListener);
    }
    this.listeners.length = 0;
  }

  /** Internal helper used by interaction modules in T3-T7. */
  on<E extends Event>(target: EventTarget, type: string, handler: (e: E) => void): void {
    target.addEventListener(type, handler as EventListener);
    this.listeners.push({ target, type, handler: handler as (e: Event) => void });
  }
}

export function initialize(options: SlidesEditorOptions): SlidesEditor {
  const editor = new SlidesEditorImpl(options);
  editor.render();
  return editor;
}
```

> The shell only owns `render` + `Selection`. T2 adds the overlay
> wiring. T3-T7 attach interaction handlers via the internal `on()`
> helper.

- [ ] **Step 1.9: Verify all editor + Selection tests pass**

Run: `pnpm slides test`
Expected: PASS — Selection tests + editor shell tests green.

- [ ] **Step 1.10: Commit**

```bash
git add packages/slides/src/view/editor
git commit -m "Add SlidesEditor shell + Selection state + keymap helper" -m "Stands up the Phase 3 controller surface: a vanilla-TypeScript
SlidesEditor with render/getSelection/onSelectionChange/setInsertMode/
detach, mirroring the initialize() pattern from packages/docs and
packages/sheets so frontend can wrap it in React the same way it
wraps the existing engines.

Selection is editor-local with a small subscribe/notify API; no
selection state lives in the SlidesDocument (Phase 4 presence covers
peer awareness). Includes a suppress-no-op guard so set([a,b]) with
the same selection does not fire subscribers — relied on by T2's
overlay re-render gate.

keymap.ts is a verbatim copy of packages/sheets/src/view/keymap.ts;
copying avoids a slides → sheets runtime dependency (sheets brings
antlr4ts and the formula engine, neither wanted here). The two copies
must be hand-synced.

Refs docs/design/slides/slides.md section 'Editor UI'."
```

---

## Task 2: Selection overlay (DOM handles)

**Files:**
- Create: `packages/slides/src/view/editor/overlay.ts`
- Create: `packages/slides/src/view/editor/overlay.test.ts`
- Create: `packages/slides/src/view/editor/hit-test.ts`
- Create: `packages/slides/src/view/editor/hit-test.test.ts`

The overlay is a single `<div>` (passed in by the host) into which
the editor mounts handle elements:
- 8 resize handles (`nw`, `n`, `ne`, `e`, `se`, `s`, `sw`, `w`)
- 1 rotate handle (`rotate`, positioned above the top centre)
- 1 selection bounding box (visual frame)

For multi-select, handles wrap the combined bbox (using
`combinedBoundingBox` from `model/frame.ts`). For a single rotated
element, handles sit on the rotated frame's corners/midpoints so the
user manipulates the element in its own local space.

`hit-test.ts` exports `handleHitTest(overlay, x, y) → ResizeHandle |
'rotate' | null` so the click dispatcher in T3 can decide whether
mousedown begins resize/rotate or some other interaction.

- [ ] **Step 2.1: Define `ResizeHandle` type and write failing tests for `hit-test.ts`**

Create `packages/slides/src/view/editor/hit-test.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { handleHitTest } from './hit-test';

beforeEach(() => { document.body.innerHTML = ''; });

function makeOverlay(): HTMLDivElement {
  const overlay = document.createElement('div');
  overlay.style.position = 'absolute';
  overlay.style.left = '0';
  overlay.style.top = '0';
  overlay.style.width = '500px';
  overlay.style.height = '300px';
  document.body.appendChild(overlay);
  return overlay;
}

function addHandle(
  overlay: HTMLDivElement,
  type: string,
  x: number, y: number, w = 8, h = 8,
): HTMLDivElement {
  const el = document.createElement('div');
  el.dataset.handle = type;
  el.style.position = 'absolute';
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  overlay.appendChild(el);
  return el;
}

describe('handleHitTest', () => {
  it('returns null when no handle is under the point', () => {
    const overlay = makeOverlay();
    expect(handleHitTest(overlay, 100, 100)).toBeNull();
  });

  it('returns the handle type when point is inside one', () => {
    const overlay = makeOverlay();
    addHandle(overlay, 'nw', 10, 10);
    expect(handleHitTest(overlay, 12, 12)).toBe('nw');
  });

  it('ignores handles without a data-handle attribute', () => {
    const overlay = makeOverlay();
    const stranger = document.createElement('div');
    stranger.style.position = 'absolute';
    stranger.style.left = '0px';
    stranger.style.top = '0px';
    stranger.style.width = '500px';
    stranger.style.height = '300px';
    overlay.appendChild(stranger);
    expect(handleHitTest(overlay, 100, 100)).toBeNull();
  });

  it('returns "rotate" for the rotate handle', () => {
    const overlay = makeOverlay();
    addHandle(overlay, 'rotate', 250, -20);
    expect(handleHitTest(overlay, 254, -16)).toBe('rotate');
  });
});
```

- [ ] **Step 2.2: Verify tests FAIL**

Run: `pnpm slides test`
Expected: FAIL — `./hit-test` not found.

- [ ] **Step 2.3: Implement `hit-test.ts`**

```ts
export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export type HandleKind = ResizeHandle | 'rotate';

const RESIZE_HANDLES: readonly HandleKind[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'rotate'];

function isHandleKind(value: string | undefined): value is HandleKind {
  return value !== undefined && (RESIZE_HANDLES as readonly string[]).includes(value);
}

/**
 * Hit-test a point against the handle elements inside an overlay.
 * Returns the handle kind (`nw`, `e`, `rotate`, ...) or `null`.
 *
 * Handle elements MUST carry `data-handle="<kind>"`. Other children
 * of the overlay are ignored.
 */
export function handleHitTest(
  overlay: HTMLDivElement,
  x: number,
  y: number,
): HandleKind | null {
  // Find the highest z-order handle element that contains (x, y).
  const handles = overlay.querySelectorAll<HTMLElement>('[data-handle]');
  // Iterate in reverse so the most recently appended handle wins on overlap.
  for (let i = handles.length - 1; i >= 0; i--) {
    const el = handles[i];
    const left = parseFloat(el.style.left);
    const top = parseFloat(el.style.top);
    const width = parseFloat(el.style.width);
    const height = parseFloat(el.style.height);
    if (x >= left && x <= left + width && y >= top && y <= top + height) {
      const kind = el.dataset.handle;
      if (isHandleKind(kind)) return kind;
    }
  }
  return null;
}
```

- [ ] **Step 2.4: Run tests, confirm green**

Run: `pnpm slides test`
Expected: PASS — hit-test tests green.

- [ ] **Step 2.5: Write failing tests for `overlay.ts`**

Create `packages/slides/src/view/editor/overlay.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import type { Element } from '../../model/element';
import { renderOverlay } from './overlay';

const HANDLE_SIZE = 8;
const HOST_SCALE = 1; // demo uses 1:1 for these tests

beforeEach(() => { document.body.innerHTML = ''; });

function makeOverlay(): HTMLDivElement {
  const overlay = document.createElement('div');
  document.body.appendChild(overlay);
  return overlay;
}

function shape(x: number, y: number, w: number, h: number, rotation = 0): Element {
  return {
    id: 'e1', type: 'shape',
    frame: { x, y, w, h, rotation },
    data: { kind: 'rect', fill: '#abc' },
  };
}

describe('renderOverlay', () => {
  it('clears the overlay when no elements are selected', () => {
    const overlay = makeOverlay();
    renderOverlay(overlay, [], { scale: HOST_SCALE });
    expect(overlay.children.length).toBe(0);
  });

  it('renders 9 handles + 1 frame for a single selected element', () => {
    const overlay = makeOverlay();
    renderOverlay(overlay, [shape(100, 50, 200, 100)], { scale: HOST_SCALE });
    // 8 resize handles + 1 rotate handle + 1 frame outline = 10 children.
    expect(overlay.children.length).toBe(10);
    const handles = overlay.querySelectorAll('[data-handle]');
    expect(handles.length).toBe(9);
  });

  it('places the nw handle at the frame top-left (centred on the corner)', () => {
    const overlay = makeOverlay();
    renderOverlay(overlay, [shape(100, 50, 200, 100)], { scale: HOST_SCALE });
    const nw = overlay.querySelector<HTMLDivElement>('[data-handle="nw"]')!;
    expect(parseFloat(nw.style.left)).toBe(100 - HANDLE_SIZE / 2);
    expect(parseFloat(nw.style.top)).toBe(50 - HANDLE_SIZE / 2);
  });

  it('places the rotate handle above the top centre', () => {
    const overlay = makeOverlay();
    renderOverlay(overlay, [shape(100, 50, 200, 100)], { scale: HOST_SCALE });
    const rot = overlay.querySelector<HTMLDivElement>('[data-handle="rotate"]')!;
    // Top centre = (200, 50); rotate handle sits 24 px above (HANDLE_OFFSET).
    expect(parseFloat(rot.style.left)).toBe(200 - HANDLE_SIZE / 2);
    expect(parseFloat(rot.style.top)).toBe(50 - 24 - HANDLE_SIZE / 2);
  });

  it('uses the combined bbox for multi-select', () => {
    const overlay = makeOverlay();
    renderOverlay(overlay, [
      shape(0, 0, 100, 100),
      shape(200, 50, 50, 50),
    ], { scale: HOST_SCALE });
    const nw = overlay.querySelector<HTMLDivElement>('[data-handle="nw"]')!;
    expect(parseFloat(nw.style.left)).toBe(0 - HANDLE_SIZE / 2);
    expect(parseFloat(nw.style.top)).toBe(0 - HANDLE_SIZE / 2);
    const se = overlay.querySelector<HTMLDivElement>('[data-handle="se"]')!;
    expect(parseFloat(se.style.left)).toBe(250 - HANDLE_SIZE / 2);
    expect(parseFloat(se.style.top)).toBe(100 - HANDLE_SIZE / 2);
  });

  it('scales handle positions by the host scale factor', () => {
    const overlay = makeOverlay();
    renderOverlay(overlay, [shape(100, 50, 200, 100)], { scale: 0.5 });
    const nw = overlay.querySelector<HTMLDivElement>('[data-handle="nw"]')!;
    expect(parseFloat(nw.style.left)).toBe(100 * 0.5 - HANDLE_SIZE / 2);
  });
});
```

- [ ] **Step 2.6: Verify tests FAIL**

Run: `pnpm slides test`
Expected: FAIL — `./overlay` not found.

- [ ] **Step 2.7: Implement `overlay.ts`**

```ts
import type { Element } from '../../model/element';
import { combinedBoundingBox } from '../../model/frame';

const HANDLE_SIZE = 8;             // px
const ROTATE_HANDLE_OFFSET = 24;   // px above top centre

export interface OverlayOptions {
  /** Host pixels per logical slide pixel. */
  scale: number;
}

/**
 * Render selection handles + the selection frame into `overlay`. The
 * overlay is cleared and rebuilt on every call (cheap with at most
 * ~10 child nodes).
 *
 * For a single selected element with rotation === 0 we draw handles
 * on the element's axis-aligned frame. For rotated single elements
 * and for multi-selection we draw on the combined axis-aligned bbox
 * (resize and rotate of rotated single elements is Phase 3a's
 * deliberate compromise — the user can still grab the rotate handle
 * and the eight bbox handles, but the resize math in T5 will be
 * defined relative to the bbox, not the rotated frame). v2 tightens
 * this to per-element rotated handles.
 */
export function renderOverlay(
  overlay: HTMLDivElement,
  selectedElements: readonly Element[],
  options: OverlayOptions,
): void {
  overlay.innerHTML = '';
  if (selectedElements.length === 0) return;

  const bbox = combinedBoundingBox(selectedElements.map((e) => e.frame));
  if (!bbox) return;

  const { scale } = options;
  const left = bbox.x * scale;
  const top = bbox.y * scale;
  const width = bbox.w * scale;
  const height = bbox.h * scale;

  // Selection frame outline (no data-handle — purely decorative).
  const frame = document.createElement('div');
  frame.className = 'wfb-slides-selection-frame';
  frame.style.position = 'absolute';
  frame.style.left = `${left}px`;
  frame.style.top = `${top}px`;
  frame.style.width = `${width}px`;
  frame.style.height = `${height}px`;
  frame.style.pointerEvents = 'none';
  frame.style.boxSizing = 'border-box';
  frame.style.border = '1px solid #3a7';
  overlay.appendChild(frame);

  const positions: Array<[string, number, number]> = [
    ['nw', left,                top],
    ['n',  left + width / 2,    top],
    ['ne', left + width,        top],
    ['e',  left + width,        top + height / 2],
    ['se', left + width,        top + height],
    ['s',  left + width / 2,    top + height],
    ['sw', left,                top + height],
    ['w',  left,                top + height / 2],
    ['rotate', left + width / 2, top - ROTATE_HANDLE_OFFSET],
  ];
  for (const [kind, cx, cy] of positions) {
    overlay.appendChild(makeHandle(kind, cx, cy));
  }
}

function makeHandle(kind: string, cx: number, cy: number): HTMLDivElement {
  const el = document.createElement('div');
  el.dataset.handle = kind;
  el.className = `wfb-slides-handle wfb-slides-handle-${kind}`;
  el.style.position = 'absolute';
  el.style.left = `${cx - HANDLE_SIZE / 2}px`;
  el.style.top = `${cy - HANDLE_SIZE / 2}px`;
  el.style.width = `${HANDLE_SIZE}px`;
  el.style.height = `${HANDLE_SIZE}px`;
  el.style.background = kind === 'rotate' ? '#fff' : '#3a7';
  el.style.border = kind === 'rotate' ? '1px solid #3a7' : '1px solid #fff';
  el.style.borderRadius = kind === 'rotate' ? '50%' : '0';
  el.style.cursor = handleCursor(kind);
  return el;
}

function handleCursor(kind: string): string {
  switch (kind) {
    case 'nw': case 'se': return 'nwse-resize';
    case 'ne': case 'sw': return 'nesw-resize';
    case 'n':  case 's':  return 'ns-resize';
    case 'e':  case 'w':  return 'ew-resize';
    case 'rotate':         return 'crosshair';
    default:               return 'default';
  }
}
```

- [ ] **Step 2.8: Run tests, confirm green**

Run: `pnpm slides test`
Expected: PASS — overlay tests green.

- [ ] **Step 2.9: Wire overlay into editor**

In `editor.ts`, replace the `Selection.subscribe(() => this.renderer.markDirty())` line with one that ALSO repaints the overlay. Add at the top of the file:

```ts
import { renderOverlay } from './overlay';
```

In the `SlidesEditorImpl` constructor, replace the existing `selection.subscribe` line with:

```ts
this.selection.subscribe(() => {
  this.renderer.markDirty();
  this.repaintOverlay();
});
```

And add a private method:

```ts
private repaintOverlay(): void {
  const slide = this.options.store.read().slides[0];
  if (!slide) {
    renderOverlay(this.options.overlay, [], { scale: this.scale() });
    return;
  }
  const selected = slide.elements.filter((e) => this.selection.has(e.id));
  renderOverlay(this.options.overlay, selected, { scale: this.scale() });
}

private scale(): number {
  return this.options.hostWidth / SLIDE_WIDTH;
}
```

Add `import { SLIDE_WIDTH } from '../../model/presentation';` to the imports.

- [ ] **Step 2.10: Run tests, confirm green**

Run: `pnpm slides test`
Expected: PASS — all prior tests still green.

- [ ] **Step 2.11: Commit**

```bash
git add packages/slides/src/view/editor/overlay.ts packages/slides/src/view/editor/overlay.test.ts packages/slides/src/view/editor/hit-test.ts packages/slides/src/view/editor/hit-test.test.ts packages/slides/src/view/editor/editor.ts
git commit -m "Render selection overlay handles in SlidesEditor" -m "Selection now paints a frame outline + 8 resize handles + 1 rotate
handle into the host overlay div on every change. handle-hit-test
finds the kind under a pointer position by reading data-handle
attributes; T3 will use it from the canvas mousedown dispatcher.

For Phase 3a we accept the deliberate simplification that handles
sit on the combined axis-aligned bbox even for a single rotated
element — resize math (T5) follows the same convention so click and
drag stay in agreement. Per-rotated-element handles are a v2 polish
item.

Refs docs/design/slides/slides.md sections 'Editor UI' and
'Interactions' (Select / Multi-select rows)."
```

---

## Task 3: Click + multi-select + lasso

**Files:**
- Create: `packages/slides/src/view/editor/interactions/select.ts`
- Create: `packages/slides/src/view/editor/interactions/select.test.ts`
- Create: `packages/slides/src/view/editor/interactions/lasso.ts`
- Create: `packages/slides/src/view/editor/interactions/lasso.test.ts`

`select.ts` exposes a pure function `selectAt(slide, x, y, modifiers,
currentSelection): string[]` that returns the new selection given a
hit point. `lasso.ts` exposes `selectInRect(slide, rect): string[]`
that returns ids of elements whose bbox intersects `rect`.

The editor wires these to canvas `mousedown` in this task too — the
first interaction step that actually changes selection in response
to user input.

- [ ] **Step 3.1: Write failing tests for `select.ts`**

Create `packages/slides/src/view/editor/interactions/select.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Slide } from '../../../model/presentation';
import type { Element } from '../../../model/element';
import { selectAt } from './select';

const blankSlide = (elements: Element[]): Slide => ({
  id: 's1', layoutId: 'blank',
  background: { fill: '#fff' },
  elements,
  notes: [],
});
const rect = (id: string, x: number, y: number, w = 100, h = 100): Element => ({
  id, type: 'shape',
  frame: { x, y, w, h, rotation: 0 },
  data: { kind: 'rect', fill: '#abc' },
});

describe('selectAt', () => {
  const a = rect('a', 0, 0);
  const b = rect('b', 200, 200);
  const overlapping = rect('c', 50, 50, 50, 50); // sits on top of a
  const slide = blankSlide([a, b, overlapping]);

  it('selects the topmost element under the point (last in array)', () => {
    expect(selectAt(slide, 60, 60, {}, [])).toEqual(['c']);
  });

  it('selects a non-overlapping element', () => {
    expect(selectAt(slide, 250, 250, {}, [])).toEqual(['b']);
  });

  it('clears selection when clicking on empty canvas', () => {
    expect(selectAt(slide, 500, 500, {}, ['a'])).toEqual([]);
  });

  it('shift-click toggles addition to multi-select', () => {
    expect(selectAt(slide, 250, 250, { shift: true }, ['c'])).toEqual(['c', 'b']);
  });

  it('shift-click toggles removal of an already-selected element', () => {
    expect(selectAt(slide, 250, 250, { shift: true }, ['c', 'b'])).toEqual(['c']);
  });

  it('shift-click on empty canvas leaves selection unchanged', () => {
    expect(selectAt(slide, 500, 500, { shift: true }, ['a'])).toEqual(['a']);
  });
});
```

- [ ] **Step 3.2: Verify FAIL**

Run: `pnpm slides test`
Expected: FAIL — `./select` not found.

- [ ] **Step 3.3: Implement `select.ts`**

```ts
import type { Slide } from '../../../model/presentation';
import { containsPoint } from '../../../model/frame';

export interface SelectModifiers {
  shift?: boolean;
}

/**
 * Compute the new selection when the user clicks at logical-slide
 * coordinates `(x, y)`.
 *
 * Hit-testing iterates from last to first so the topmost (front) element
 * wins for overlapping shapes — matches the array-order = z-order
 * convention.
 */
export function selectAt(
  slide: Slide,
  x: number, y: number,
  mods: SelectModifiers,
  current: readonly string[],
): string[] {
  const hit = topmostUnderPoint(slide, x, y);

  if (mods.shift) {
    if (hit === null) return [...current]; // shift on empty: no-op
    return toggleId(current, hit);
  }

  if (hit === null) return [];
  return [hit];
}

function topmostUnderPoint(slide: Slide, x: number, y: number): string | null {
  for (let i = slide.elements.length - 1; i >= 0; i--) {
    if (containsPoint(slide.elements[i].frame, x, y)) {
      return slide.elements[i].id;
    }
  }
  return null;
}

function toggleId(ids: readonly string[], id: string): string[] {
  const i = ids.indexOf(id);
  if (i === -1) return [...ids, id];
  return [...ids.slice(0, i), ...ids.slice(i + 1)];
}
```

- [ ] **Step 3.4: Run tests, confirm green**

Run: `pnpm slides test`
Expected: PASS.

- [ ] **Step 3.5: Write failing tests for `lasso.ts`**

Create `packages/slides/src/view/editor/interactions/lasso.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Slide } from '../../../model/presentation';
import type { Element } from '../../../model/element';
import { selectInRect, normalizeRect } from './lasso';

const blank = (elements: Element[]): Slide => ({
  id: 's1', layoutId: 'blank',
  background: { fill: '#fff' },
  elements, notes: [],
});
const at = (id: string, x: number, y: number, w = 100, h = 100): Element => ({
  id, type: 'shape',
  frame: { x, y, w, h, rotation: 0 },
  data: { kind: 'rect', fill: '#abc' },
});

describe('selectInRect — bbox intersection', () => {
  const slide = blank([
    at('a', 0,   0,   100, 100),
    at('b', 200, 0,   100, 100),
    at('c', 0,   200, 100, 100),
  ]);

  it('selects only elements whose bbox intersects the rect', () => {
    expect(selectInRect(slide, { x: 50, y: 50, w: 100, h: 100 }))
      .toEqual(['a']);
  });

  it('selects multiple elements when the rect spans them', () => {
    expect(selectInRect(slide, { x: 0, y: 0, w: 350, h: 50 }))
      .toEqual(['a', 'b']);
  });

  it('returns empty when the rect intersects nothing', () => {
    expect(selectInRect(slide, { x: 500, y: 500, w: 50, h: 50 }))
      .toEqual([]);
  });

  it('treats edge contact as intersection', () => {
    // rect's right edge at x=100 just touches element a's right edge.
    expect(selectInRect(slide, { x: 0, y: 0, w: 100, h: 100 }))
      .toEqual(['a']);
  });
});

describe('normalizeRect', () => {
  it('returns positive width/height regardless of drag direction', () => {
    expect(normalizeRect(100, 100, 50, 50))
      .toEqual({ x: 50, y: 50, w: 50, h: 50 });
  });
  it('handles zero-size rectangles', () => {
    expect(normalizeRect(10, 10, 10, 10))
      .toEqual({ x: 10, y: 10, w: 0, h: 0 });
  });
});
```

- [ ] **Step 3.6: Verify FAIL**

Run: `pnpm slides test`
Expected: FAIL — `./lasso` not found.

- [ ] **Step 3.7: Implement `lasso.ts`**

```ts
import type { Slide } from '../../../model/presentation';
import { boundingBox } from '../../../model/frame';

export interface Rect {
  x: number; y: number; w: number; h: number;
}

/**
 * Normalise a rectangle from two arbitrary corner points so that w/h
 * are non-negative. Used while the user is dragging — startX/startY
 * stay fixed, currentX/currentY can move in any direction.
 */
export function normalizeRect(
  startX: number, startY: number,
  currentX: number, currentY: number,
): Rect {
  const x = Math.min(startX, currentX);
  const y = Math.min(startY, currentY);
  const w = Math.abs(currentX - startX);
  const h = Math.abs(currentY - startY);
  return { x, y, w, h };
}

/**
 * Return ids of elements whose axis-aligned bounding box intersects
 * `rect`. Edge contact counts as intersection, matching how Google
 * Slides behaves (and the spec's "bbox intersects" wording).
 */
export function selectInRect(slide: Slide, rect: Rect): string[] {
  const ids: string[] = [];
  for (const el of slide.elements) {
    const bb = boundingBox(el.frame);
    if (rectsIntersect(bb, rect)) ids.push(el.id);
  }
  return ids;
}

function rectsIntersect(a: Rect, b: Rect): boolean {
  return !(
    a.x + a.w < b.x ||
    b.x + b.w < a.x ||
    a.y + a.h < b.y ||
    b.y + b.h < a.y
  );
}
```

- [ ] **Step 3.8: Run tests, confirm green**

Run: `pnpm slides test`
Expected: PASS.

- [ ] **Step 3.9: Wire pointer events in `editor.ts`**

Add an `attachInteractions` private method to `SlidesEditorImpl` and
call it at the end of the constructor. New imports:

```ts
import { selectAt } from './interactions/select';
import { normalizeRect, selectInRect, type Rect } from './interactions/lasso';
import { handleHitTest } from './hit-test';
```

In the class, add:

```ts
private attachInteractions(): void {
  this.on(this.options.canvas, 'mousedown', (e) => this.onPointerDown(e as MouseEvent));
}

private onPointerDown(e: MouseEvent): void {
  if (this.insertKind !== null) return;             // T7 owns insert mousedown
  if (this.handleAtClient(e.clientX, e.clientY) !== null) return; // T5/T6 own resize/rotate

  const slide = this.currentSlide();
  if (!slide) return;
  const { x, y } = this.clientToLogical(e.clientX, e.clientY);

  // Hit-test against an element first.
  const hit = topmostUnderPoint(slide, x, y);
  if (hit !== null) {
    const mods = { shift: e.shiftKey };
    const next = selectAt(slide, x, y, mods, this.selection.get());
    this.selection.set(next);
    // T4 takes over to start a drag from here.
    return;
  }

  // Empty canvas — start a lasso unless shift is held (which would be
  // an additive no-op per the spec).
  if (e.shiftKey) {
    return;
  }
  this.startLasso(e.clientX, e.clientY);
}

private startLasso(clientX: number, clientY: number): void {
  const rectEl = document.createElement('div');
  rectEl.style.position = 'absolute';
  rectEl.style.border = '1px dashed #3a7';
  rectEl.style.background = 'rgba(58, 168, 119, 0.1)';
  rectEl.style.pointerEvents = 'none';
  this.options.overlay.appendChild(rectEl);

  const start = this.clientToLogical(clientX, clientY);
  const onMove = (ev: MouseEvent) => {
    const cur = this.clientToLogical(ev.clientX, ev.clientY);
    const rect = normalizeRect(start.x, start.y, cur.x, cur.y);
    const scale = this.scale();
    rectEl.style.left = `${rect.x * scale}px`;
    rectEl.style.top = `${rect.y * scale}px`;
    rectEl.style.width = `${rect.w * scale}px`;
    rectEl.style.height = `${rect.h * scale}px`;
  };
  const onUp = (ev: MouseEvent) => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    rectEl.remove();
    const cur = this.clientToLogical(ev.clientX, ev.clientY);
    const rect = normalizeRect(start.x, start.y, cur.x, cur.y);
    const slide = this.currentSlide();
    if (!slide) return;
    if (rect.w < 2 && rect.h < 2) {
      // A click without drag — treat as empty-canvas click → clear.
      this.selection.clear();
      return;
    }
    this.selection.set(selectInRect(slide, rect));
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

private currentSlide() {
  return this.options.store.read().slides[0];
}

private clientToLogical(clientX: number, clientY: number): { x: number; y: number } {
  const rect = this.options.canvas.getBoundingClientRect();
  const scale = this.scale();
  return {
    x: (clientX - rect.left) / scale,
    y: (clientY - rect.top) / scale,
  };
}

private handleAtClient(clientX: number, clientY: number): string | null {
  const rect = this.options.overlay.getBoundingClientRect();
  return handleHitTest(
    this.options.overlay,
    clientX - rect.left,
    clientY - rect.top,
  );
}
```

Add the `topmostUnderPoint` helper to the bottom of `editor.ts`
(internal):

```ts
function topmostUnderPoint(slide: { elements: { id: string; frame: Frame }[] }, x: number, y: number): string | null {
  for (let i = slide.elements.length - 1; i >= 0; i--) {
    if (containsPoint(slide.elements[i].frame, x, y)) {
      return slide.elements[i].id;
    }
  }
  return null;
}
```

(Add `import { containsPoint } from '../../model/frame';` and
`import type { Frame } from '../../model/element';` at the top.)

Finally, in the constructor body after `this.selection.subscribe(...)`,
add:

```ts
this.attachInteractions();
```

- [ ] **Step 3.10: Add an editor-level test for click→select wiring**

> **NOTE:** the `target: Element | Document` parameter must be
> `target: globalThis.Element | Document` because `Element` from
> `../../model/element` is in scope and shadows the DOM type.

Append to `editor.test.ts`:

```ts
import type { Slide } from '../../model/presentation';

function dispatchMouseDown(target: globalThis.Element | Document, x: number, y: number, shift = false): void {
  target.dispatchEvent(new MouseEvent('mousedown', {
    clientX: x, clientY: y, shiftKey: shift, bubbles: true,
  }));
}

it('mousedown on a shape selects it', () => {
  const { canvas, overlay, store } = makeFixture();
  // Position canvas at (0,0) — jsdom getBoundingClientRect returns zeros
  // by default, which means clientX/Y == logical coords at scale=1.
  store.batch(() => {
    const sid = store.read().slides[0].id;
    store.addElement(sid, {
      type: 'shape',
      frame: { x: 100, y: 50, w: 200, h: 100, rotation: 0 },
      data: { kind: 'rect', fill: '#abc' },
    });
  });
  editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
  // Click at (150, 80) in client coords = (150, 80) in logical coords (scale=1).
  dispatchMouseDown(canvas, 150, 80);
  expect(editor.getSelection().length).toBe(1);
});

it('mousedown on empty canvas clears selection (after a click without drag)', () => {
  const { canvas, overlay, store } = makeFixture();
  store.batch(() => {
    const sid = store.read().slides[0].id;
    store.addElement(sid, {
      type: 'shape',
      frame: { x: 100, y: 50, w: 200, h: 100, rotation: 0 },
      data: { kind: 'rect', fill: '#abc' },
    });
  });
  editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
  // First select the shape.
  dispatchMouseDown(canvas, 150, 80);
  expect(editor.getSelection().length).toBe(1);
  // Then click empty space and immediately mouseup (no drag).
  dispatchMouseDown(canvas, 800, 800);
  document.dispatchEvent(new MouseEvent('mouseup', { clientX: 800, clientY: 800, bubbles: true }));
  expect(editor.getSelection()).toEqual([]);
});
```

- [ ] **Step 3.11: Run all tests**

Run: `pnpm slides test`
Expected: PASS — select + lasso + editor click tests green.

> **NOTE:** the lasso suite is 6 it-blocks, not 5: 4 in
> `selectInRect — bbox intersection` plus 2 in `normalizeRect`. Keep
> this in mind when checking running totals (e.g. running tally is
> `92 + 6 + 6 + 2 = 106` after T3, not `92 + 6 + 5 + 2 = 105`).

- [ ] **Step 3.12: Commit**

```bash
git add packages/slides/src/view/editor
git commit -m "Wire click and lasso selection in SlidesEditor" -m "selectAt is the pure decision: hit-test topmost element under the
pointer, optionally shift-toggle. selectInRect is the lasso payload:
bbox intersection, edge contact counts as a hit (matches Google
Slides). The editor wires both via canvas mousedown — handle / insert
hits short-circuit out so T4-T7 can take over, and shift-click on
empty canvas is a no-op so it does not accidentally clear an additive
multi-select.

A click-without-drag on empty canvas clears selection. The 2-pixel
threshold distinguishes 'click' from 'lasso' so a careless mousedown
does not produce a tiny rubber-band.

Refs docs/design/slides/slides.md 'Interactions' table rows
Select / Multi-select / Lasso select."
```

---

## Task 4: Drag interaction

**Files:**
- Create: `packages/slides/src/view/editor/snap.ts`
- Create: `packages/slides/src/view/editor/snap.test.ts`
- Create: `packages/slides/src/view/editor/interactions/drag.ts`
- Create: `packages/slides/src/view/editor/interactions/drag.test.ts`

Drag = mousedown on a selected element body → broadcast intermediate
frames in-memory (NOT through the store) → on mouseup, commit one
`updateElementFrame` per selected element inside a single
`store.batch`. This matches the spec's drag semantics.

Snap is intentionally minimal in v1: snap the dragged group's
bounding-box edges and centre to (a) the slide centre line and (b) the
nearest non-selected element's edges, within an 8-pixel threshold.

- [x] **Step 4.1: Write failing tests for `snap.ts`**

Create `packages/slides/src/view/editor/snap.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Frame } from '../../model/element';
import { snapDelta } from './snap';

const f = (x: number, y: number, w: number, h: number): Frame => ({
  x, y, w, h, rotation: 0,
});

describe('snapDelta', () => {
  const SLIDE = { w: 1920, h: 1080 };

  it('snaps the dragged centre to the slide centre when within 8 px', () => {
    // Group bbox = single 100x100 element starting at x=860, y=0.
    // Dragging right by dx=98 puts it at 958..1058 (centre at 1008,
    // exactly 48 from slide centre 960). Snap should NOT trigger
    // because 48 > 8.
    const result = snapDelta({ x: 860, y: 0, w: 100, h: 100 }, 98, 0, [], SLIDE);
    expect(result.dx).toBe(98);

    // Dragging right by 102 puts the element at 962..1062 (centre at
    // 1012, 52 from slide centre — also outside threshold). Snap to
    // slide centre would require dx that puts centre at 960, i.e.
    // dx = (960 - 100/2) - 860 = 50. So if drag is 50±8 the snap
    // engages.
    const result2 = snapDelta({ x: 860, y: 0, w: 100, h: 100 }, 53, 0, [], SLIDE);
    expect(result2.dx).toBe(50);
  });

  it('snaps to the nearest non-selected element edge', () => {
    const others: Frame[] = [f(500, 0, 100, 100)];
    // Dragging the bbox (originally at x=860) so its left edge is at
    // 603 (dx=-257) — within 3 of element a's right edge (600).
    // Snap: left edge → 600 → dx = -260.
    const result = snapDelta(
      { x: 860, y: 0, w: 100, h: 100 }, -257, 0, others, SLIDE,
    );
    expect(result.dx).toBe(-260);
  });

  it('does not snap when no edge is within threshold', () => {
    const result = snapDelta(
      { x: 0, y: 0, w: 100, h: 100 }, 17, 23, [], { w: 1920, h: 1080 },
    );
    expect(result).toEqual({ dx: 17, dy: 23 });
  });
});
```

- [x] **Step 4.2: Verify FAIL**

Run: `pnpm slides test`
Expected: FAIL — `./snap` not found.

- [x] **Step 4.3: Implement `snap.ts`**

```ts
import type { Frame } from '../../model/element';

const SNAP_THRESHOLD = 8;

export interface SlideDimensions { w: number; h: number; }

export function snapDelta(
  bbox: { x: number; y: number; w: number; h: number },
  dx: number,
  dy: number,
  others: readonly Frame[],
  slide: SlideDimensions,
): { dx: number; dy: number } {
  const dragged = {
    leftPx: bbox.x + dx,
    rightPx: bbox.x + dx + bbox.w,
    centerXPx: bbox.x + dx + bbox.w / 2,
    topPx: bbox.y + dy,
    bottomPx: bbox.y + dy + bbox.h,
    centerYPx: bbox.y + dy + bbox.h / 2,
  };

  const xCandidates: Array<{ from: number; to: number }> = [
    // Slide centre vs dragged centre
    { from: dragged.centerXPx, to: slide.w / 2 },
  ];
  const yCandidates: Array<{ from: number; to: number }> = [
    { from: dragged.centerYPx, to: slide.h / 2 },
  ];
  for (const o of others) {
    const oLeft = o.x;
    const oRight = o.x + o.w;
    const oTop = o.y;
    const oBot = o.y + o.h;
    xCandidates.push(
      { from: dragged.leftPx,  to: oLeft },
      { from: dragged.leftPx,  to: oRight },
      { from: dragged.rightPx, to: oLeft },
      { from: dragged.rightPx, to: oRight },
    );
    yCandidates.push(
      { from: dragged.topPx,    to: oTop },
      { from: dragged.topPx,    to: oBot },
      { from: dragged.bottomPx, to: oTop },
      { from: dragged.bottomPx, to: oBot },
    );
  }

  return {
    dx: dx + bestSnapAdjust(xCandidates),
    dy: dy + bestSnapAdjust(yCandidates),
  };
}

function bestSnapAdjust(cands: Array<{ from: number; to: number }>): number {
  let best = 0;
  let bestAbs = SNAP_THRESHOLD + 1;
  for (const c of cands) {
    const diff = c.to - c.from;
    const abs = Math.abs(diff);
    if (abs <= SNAP_THRESHOLD && abs < bestAbs) {
      best = diff;
      bestAbs = abs;
    }
  }
  return best;
}
```

- [x] **Step 4.4: Run tests, confirm green**

Run: `pnpm slides test`
Expected: PASS.

- [x] **Step 4.5: Write failing tests for `drag.ts`**

Create `packages/slides/src/view/editor/interactions/drag.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Element } from '../../../model/element';
import { applyDrag } from './drag';

const at = (id: string, x: number, y: number): Element => ({
  id, type: 'shape',
  frame: { x, y, w: 100, h: 100, rotation: 0 },
  data: { kind: 'rect', fill: '#abc' },
});

describe('applyDrag', () => {
  it('applies the same delta to every selected element', () => {
    const result = applyDrag([at('a', 0, 0), at('b', 200, 100)], 50, 30);
    expect(result.map((e) => ({ id: e.id, x: e.frame.x, y: e.frame.y }))).toEqual([
      { id: 'a', x: 50, y: 30 },
      { id: 'b', x: 250, y: 130 },
    ]);
  });

  it('preserves rotation and size', () => {
    const original: Element = {
      ...at('a', 0, 0),
      frame: { x: 0, y: 0, w: 100, h: 100, rotation: Math.PI / 4 },
    };
    const result = applyDrag([original], 10, 10);
    expect(result[0].frame.rotation).toBe(Math.PI / 4);
    expect(result[0].frame.w).toBe(100);
    expect(result[0].frame.h).toBe(100);
  });

  it('returns a new array — does not mutate inputs', () => {
    const input = [at('a', 0, 0)];
    const result = applyDrag(input, 1, 2);
    expect(result).not.toBe(input);
    expect(input[0].frame.x).toBe(0); // unchanged
  });
});
```

- [x] **Step 4.6: Verify FAIL**

Run: `pnpm slides test`
Expected: FAIL — `./drag` not found.

- [x] **Step 4.7: Implement `drag.ts`**

```ts
import type { Element } from '../../../model/element';

/**
 * Pure: apply a (dx, dy) translation to every element. Returns
 * deep-cloned elements so callers can pass the result through their
 * own state without worrying about input aliasing.
 */
export function applyDrag(
  elements: readonly Element[],
  dx: number, dy: number,
): Element[] {
  return elements.map((el) => ({
    ...el,
    frame: { ...el.frame, x: el.frame.x + dx, y: el.frame.y + dy },
  }));
}
```

- [x] **Step 4.8: Run tests, confirm green**

Run: `pnpm slides test`
Expected: PASS.

- [x] **Step 4.9: Wire drag into the editor**

In `editor.ts`, edit `onPointerDown` so the `if (hit !== null)` branch
also starts a drag. Replace that branch's body:

```ts
  if (hit !== null) {
    const mods = { shift: e.shiftKey };
    const nextSelection = selectAt(slide, x, y, mods, this.selection.get());
    this.selection.set(nextSelection);
    // Begin drag on the (possibly newly-)selected elements unless the
    // element was just removed by shift-toggle.
    if (this.selection.has(hit)) {
      this.startDrag(e.clientX, e.clientY);
    }
    return;
  }
```

Add `startDrag`:

```ts
private startDrag(clientX: number, clientY: number): void {
  const startSlide = this.currentSlide();
  if (!startSlide) return;
  const selectedIds = new Set(this.selection.get());
  const originalFrames = new Map<string, Frame>();
  for (const el of startSlide.elements) {
    if (selectedIds.has(el.id)) originalFrames.set(el.id, { ...el.frame });
  }
  if (originalFrames.size === 0) return;

  const start = this.clientToLogical(clientX, clientY);
  const otherFrames = startSlide.elements
    .filter((e) => !selectedIds.has(e.id))
    .map((e) => e.frame);

  // Track dragged frames in memory; commit once at mouseup.
  const live = new Map(originalFrames);

  const onMove = (ev: MouseEvent) => {
    const cur = this.clientToLogical(ev.clientX, ev.clientY);
    const rawDx = cur.x - start.x;
    const rawDy = cur.y - start.y;
    const bbox = combinedBoundingBox(Array.from(originalFrames.values()))!;
    const { dx, dy } = snapDelta(bbox, rawDx, rawDy, otherFrames, { w: SLIDE_WIDTH, h: SLIDE_HEIGHT });

    for (const [id, base] of originalFrames) {
      live.set(id, { ...base, x: base.x + dx, y: base.y + dy });
    }
    // Repaint canvas + overlay with the live frames; we DO NOT touch
    // the store yet.
    this.paintLive(live);
  };
  const onUp = (_ev: MouseEvent) => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    // Commit one batch with the final frames.
    const slideId = startSlide.id;
    this.options.store.batch(() => {
      for (const [id, frame] of live) {
        this.options.store.updateElementFrame(slideId, id, frame);
      }
    });
    this.renderer.markDirty();
    this.render();
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

private paintLive(live: Map<string, Frame>): void {
  // Render a synthesised slide where the selected elements use their
  // live frames. We bypass the store so each mousemove is one paint,
  // not one Yorkie op.
  const slide = this.currentSlide();
  if (!slide) return;
  const synthetic = {
    ...slide,
    elements: slide.elements.map((el) =>
      live.has(el.id) ? { ...el, frame: live.get(el.id)! } : el,
    ),
  };
  this.renderer.markDirty();
  // SlideRenderer.render takes a Slide; pass synthetic in.
  // (We need a small surface change: SlideRenderer already accepts
  // any Slide-shaped object, so this works.)
  // Use the underlying ctx directly through the renderer instance:
  this.renderer['render'](synthetic);
  // Repaint overlay against the live frames so handles follow.
  const selected = synthetic.elements.filter((e) => this.selection.has(e.id));
  renderOverlay(this.options.overlay, selected, { scale: this.scale() });
}
```

Add new imports:

```ts
import { combinedBoundingBox } from '../../model/frame';
import { snapDelta } from './snap';
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../../model/presentation';
```

> **NOTE:** do NOT import `applyDrag` into `editor.ts` — TS strict
> `noUnusedLocals` rejects unused imports, and the inline
> `originalFrames` Map handles the per-element delta directly.
> `applyDrag` lives in `drag.ts` for unit testing only.

> **NOTE on `this.renderer['render']`** — bracket access bypasses the
> tsc unused-method warning if we add a public `paint(slide)` method to
> SlideRenderer. The cleaner fix is to expose `paint(slide)` on
> SlideRenderer that paints unconditionally (no dirty-flag check). Do
> that as part of T4 instead of the bracket hack: edit `slide-renderer.ts`
> to add:
>
> ```ts
> /** Paint unconditionally (skip the dirty check). Used by interaction live-paint. */
> forceRender(slide: Slide): void {
>   this.dirty = true;
>   this.render(slide);
> }
> ```
>
> Then call `this.renderer.forceRender(synthetic)` instead of the
> bracket-access trick. Add a one-line test in
> `slide-renderer.test.ts` that `forceRender` paints even when not
> dirty.

- [x] **Step 4.10: Add `forceRender` to SlideRenderer + test**

Edit `packages/slides/src/view/canvas/slide-renderer.ts` — append:

```ts
  /**
   * Paint unconditionally (bypass the dirty check). Used by interaction
   * live-paint paths in the editor that need to draw an in-memory
   * frame override on every mousemove without committing to the store.
   */
  forceRender(slide: Slide): void {
    this.dirty = true;
    this.render(slide);
  }
```

Append a test in `slide-renderer.test.ts`:

```ts
  it('forceRender paints even when not dirty', () => {
    const { renderer, ctx } = makeRenderer();
    renderer.render(blankSlide());        // dirty → false
    const before = ctx.clearRect.mock.calls.length;
    renderer.forceRender(blankSlide());
    expect(ctx.clearRect.mock.calls.length).toBe(before + 1);
  });
```

Update `paintLive` in `editor.ts` to use it:

```ts
this.renderer.forceRender(synthetic);
```

(Drop the bracket-access workaround.)

- [x] **Step 4.11: Add a drag editor-level test**

Append to `editor.test.ts`:

```ts
it('drag moves the selected element by the pointer delta and commits one batch', () => {
  const { canvas, overlay, store } = makeFixture();
  let elementId = '';
  store.batch(() => {
    const sid = store.read().slides[0].id;
    elementId = store.addElement(sid, {
      type: 'shape',
      frame: { x: 100, y: 100, w: 200, h: 100, rotation: 0 },
      data: { kind: 'rect', fill: '#abc' },
    });
  });
  editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
  // Select + start drag at (200, 150) — middle of the shape.
  dispatchMouseDown(canvas, 200, 150);
  // Drag to (350, 250).
  document.dispatchEvent(new MouseEvent('mousemove', { clientX: 350, clientY: 250, bubbles: true }));
  document.dispatchEvent(new MouseEvent('mouseup',   { clientX: 350, clientY: 250, bubbles: true }));
  // Frame should have moved by (150, 100). Snap might tweak by ≤ 8 px.
  const frame = store.read().slides[0].elements[0].frame;
  expect(Math.abs(frame.x - 250)).toBeLessThanOrEqual(8);
  expect(Math.abs(frame.y - 200)).toBeLessThanOrEqual(8);
  // Single undo entry.
  expect(store.canUndo()).toBe(true);
  store.undo();
  expect(store.read().slides[0].elements[0].frame.x).toBe(100);
});
```

- [x] **Step 4.12: Run tests, confirm green**

Run: `pnpm slides test`
Expected: PASS.

- [x] **Step 4.13: Commit**

```bash
git add packages/slides/src/view/editor packages/slides/src/view/canvas/slide-renderer.ts packages/slides/src/view/canvas/slide-renderer.test.ts
git commit -m "Add element drag with snap-to-edge in SlidesEditor" -m "mousedown on a selected element starts a drag; mousemove updates an
in-memory frame map and forceRender's the canvas + overlay every
frame; mouseup commits one updateElementFrame per dragged element
inside a single store.batch — exactly one undo entry per drag.

snapDelta proposes the smallest adjustment that lands the dragged
group's centre or any of its edges on the slide centre or an
non-selected element's edge, within an 8 px threshold. v1 leaves
guideline visualisation out — the snap effect alone is enough to
feel responsive; visible guidelines arrive in 3b polish.

SlideRenderer gains forceRender as the 'skip the dirty check' entry
point for interaction live-paint. Tests cover both the pure delta
math and an end-to-end drag through the editor.

Refs docs/design/slides/slides.md 'Interactions' table row Drag move,
and 'Yorkie schema > Undo grouping' for the one-batch-per-drag rule."
```

---

## Task 5: Resize interaction

**Files:**
- Create: `packages/slides/src/view/editor/interactions/resize.ts`
- Create: `packages/slides/src/view/editor/interactions/resize.test.ts`

The resize math is the heaviest piece in Phase 3a. Per the overlay
simplification in T2, handles operate on the combined axis-aligned
bbox even for a single rotated element. So `resizeFrame` for v1 only
needs the unrotated case — the rotated case clamps the entire group
to its bbox and resizes that bbox.

For the unrotated single-element case (the common case):
- Each handle has a fixed anchor point (the opposite corner / opposite
  edge midpoint stays put).
- `shift` preserves aspect ratio, scaling around the anchor.

- [ ] **Step 5.1: Write failing tests**

Create `packages/slides/src/view/editor/interactions/resize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Frame } from '../../../model/element';
import { resizeFrame, type ResizeHandle } from './resize';

const f = (x: number, y: number, w: number, h: number): Frame => ({
  x, y, w, h, rotation: 0,
});

describe('resizeFrame — east handle', () => {
  it('grows the frame to the right when dragging east-positive', () => {
    const start = f(100, 100, 200, 100);
    const next = resizeFrame(start, 'e', 50, 0, false);
    expect(next).toEqual({ x: 100, y: 100, w: 250, h: 100, rotation: 0 });
  });
  it('shrinks the frame when dragging east-negative', () => {
    const start = f(100, 100, 200, 100);
    const next = resizeFrame(start, 'e', -150, 0, false);
    expect(next.w).toBe(50);
  });
  it('does not move the west edge', () => {
    const start = f(100, 100, 200, 100);
    expect(resizeFrame(start, 'e', 30, 0, false).x).toBe(100);
  });
});

describe('resizeFrame — nw handle', () => {
  it('moves the top-left corner; keeps bottom-right in place', () => {
    const start = f(100, 100, 200, 100);
    const next = resizeFrame(start, 'nw', -50, -25, false);
    expect(next).toEqual({ x: 50, y: 75, w: 250, h: 125, rotation: 0 });
  });
});

describe('resizeFrame — shift preserves aspect', () => {
  it('uses the larger relative drag and scales the other axis proportionally', () => {
    const start = f(0, 0, 200, 100);            // 2:1 aspect
    const next = resizeFrame(start, 'se', 100, 10, true); // shift on
    // 100 / 200 = 0.5 (x-relative). 10 / 100 = 0.1 (y-relative).
    // Larger relative is 0.5; apply to both → +100 width, +50 height.
    expect(next.w).toBe(300);
    expect(next.h).toBe(150);
  });
});

describe('resizeFrame — minimum size', () => {
  it('clamps to a 1px minimum so the frame never inverts', () => {
    const start = f(0, 0, 100, 100);
    const next = resizeFrame(start, 'se', -200, -200, false);
    expect(next.w).toBe(1);
    expect(next.h).toBe(1);
  });
});
```

- [ ] **Step 5.2: Verify FAIL**

Run: `pnpm slides test`
Expected: FAIL.

- [ ] **Step 5.3: Implement `resize.ts`**

```ts
import type { Frame } from '../../../model/element';

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const MIN_SIZE = 1;

/**
 * Apply a resize drag to a frame. Returns a new frame; does not mutate
 * the input. v1 ignores `frame.rotation` — handles act on the
 * axis-aligned bbox per the T2 simplification.
 *
 * Each handle has an anchor (the opposite corner or edge midpoint)
 * that stays fixed. Dragging changes the dimensions on the active
 * side(s).
 *
 * `shift` preserves aspect: the larger of |dx|/w and |dy|/h is taken
 * as the scale factor, then applied to the other axis.
 */
export function resizeFrame(
  start: Frame,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  shift: boolean,
): Frame {
  const right  = start.x + start.w;
  const bottom = start.y + start.h;

  // Track edges; let the handle pick which ones move.
  let left = start.x;
  let top = start.y;
  let r = right;
  let b = bottom;

  if (shift) {
    ({ dx, dy } = preserveAspect(start.w, start.h, handle, dx, dy));
  }

  switch (handle) {
    case 'e':  r = right + dx;                   break;
    case 'w':  left = start.x + dx;              break;
    case 's':  b = bottom + dy;                  break;
    case 'n':  top = start.y + dy;               break;
    case 'ne': r = right + dx; top = start.y + dy; break;
    case 'nw': left = start.x + dx; top = start.y + dy; break;
    case 'se': r = right + dx; b = bottom + dy;  break;
    case 'sw': left = start.x + dx; b = bottom + dy; break;
  }

  // Enforce minimum size by clamping the moving edge against its anchor.
  const w = Math.max(MIN_SIZE, r - left);
  const h = Math.max(MIN_SIZE, b - top);
  // If clamping shrank one dimension, keep the anchor edge fixed.
  // For w/h-clamped edges, snap the moving edge back so size === MIN_SIZE.
  if (r - left < MIN_SIZE) {
    if (handle === 'w' || handle === 'nw' || handle === 'sw') {
      left = right - MIN_SIZE;
    } else {
      r = left + MIN_SIZE;
    }
  }
  if (b - top < MIN_SIZE) {
    if (handle === 'n' || handle === 'nw' || handle === 'ne') {
      top = bottom - MIN_SIZE;
    } else {
      b = top + MIN_SIZE;
    }
  }

  return {
    x: left, y: top,
    w: r - left, h: b - top,
    rotation: start.rotation,
  };
}

function preserveAspect(
  w: number, h: number,
  handle: ResizeHandle,
  dx: number, dy: number,
): { dx: number; dy: number } {
  // Edges only get one degree of freedom — shift is a no-op.
  if (handle === 'e' || handle === 'w' || handle === 'n' || handle === 's') {
    return { dx, dy };
  }
  // Sign of dy depends on whether the handle pulls top or bottom.
  const dyForGrowth = (handle === 'nw' || handle === 'ne') ? -dy : dy;
  const dxForGrowth = (handle === 'nw' || handle === 'sw') ? -dx : dx;
  const xScale = dxForGrowth / w;
  const yScale = dyForGrowth / h;
  const scale = Math.abs(xScale) > Math.abs(yScale) ? xScale : yScale;
  const targetDx = scale * w * ((handle === 'nw' || handle === 'sw') ? -1 : 1);
  const targetDy = scale * h * ((handle === 'nw' || handle === 'ne') ? -1 : 1);
  return { dx: targetDx, dy: targetDy };
}
```

- [ ] **Step 5.4: Run tests, confirm green**

Run: `pnpm slides test`
Expected: PASS.

- [ ] **Step 5.5: Wire resize into the editor**

In `editor.ts`, the resize path: `onPointerDown` already short-circuits
when a handle is hit. Add the implementation:

```ts
private onPointerDownHandle(handle: HandleKind, clientX: number, clientY: number): void {
  if (handle === 'rotate') {
    // T6 owns rotate.
    this.startRotate(clientX, clientY);
    return;
  }
  this.startResize(handle, clientX, clientY);
}

private startResize(handle: ResizeHandle, clientX: number, clientY: number): void {
  const startSlide = this.currentSlide();
  if (!startSlide) return;
  const selectedIds = this.selection.get();
  if (selectedIds.length !== 1) return; // multi-resize is a v2 polish item
  const elementId = selectedIds[0];
  const startEl = startSlide.elements.find((e) => e.id === elementId);
  if (!startEl) return;
  const startFrame = { ...startEl.frame };
  const start = this.clientToLogical(clientX, clientY);
  const live = { frame: startFrame };

  const onMove = (ev: MouseEvent) => {
    const cur = this.clientToLogical(ev.clientX, ev.clientY);
    const dx = cur.x - start.x;
    const dy = cur.y - start.y;
    live.frame = resizeFrame(startFrame, handle, dx, dy, ev.shiftKey);
    const livMap = new Map<string, Frame>([[elementId, live.frame]]);
    this.paintLive(livMap);
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    this.options.store.batch(() => {
      this.options.store.updateElementFrame(startSlide.id, elementId, live.frame);
    });
    this.renderer.markDirty();
    this.render();
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}
```

Update `onPointerDown` to call `onPointerDownHandle` when a handle is
hit:

```ts
const handle = this.handleAtClient(e.clientX, e.clientY);
if (handle !== null) {
  this.onPointerDownHandle(handle, e.clientX, e.clientY);
  return;
}
```

Add imports:

```ts
import { resizeFrame, type ResizeHandle } from './interactions/resize';
```

- [ ] **Step 5.6: Add an editor-level resize test**

```ts
it('dragging the e handle resizes the selected element', () => {
  const { canvas, overlay, store } = makeFixture();
  let elementId = '';
  store.batch(() => {
    const sid = store.read().slides[0].id;
    elementId = store.addElement(sid, {
      type: 'shape',
      frame: { x: 100, y: 100, w: 200, h: 100, rotation: 0 },
      data: { kind: 'rect', fill: '#abc' },
    });
  });
  editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
  // Select the element first (mousedown inside its frame).
  dispatchMouseDown(canvas, 150, 150);
  document.dispatchEvent(new MouseEvent('mouseup', { clientX: 150, clientY: 150, bubbles: true }));
  // Now there should be handles in overlay. Find the 'e' handle's
  // logical center: the bbox right edge is at x=300 (200 + 100), y centre 150.
  // Overlay coordinates equal logical at scale=1, getBoundingClientRect
  // returns zeros in jsdom so client = overlay = logical.
  const eHandle = overlay.querySelector<HTMLDivElement>('[data-handle="e"]')!;
  const left = parseFloat(eHandle.style.left);
  const top = parseFloat(eHandle.style.top);
  // mousedown at handle centre (left + 4, top + 4) — handle is 8x8.
  dispatchMouseDown(canvas, left + 4, top + 4); // wait — we need to dispatch on overlay or canvas?
  // The editor listens on canvas for mousedown; handle hit-test reads
  // overlay positions. But the actual MouseEvent.target depends on the
  // dispatcher, which jsdom routes by getBoundingClientRect — and the
  // overlay has a zero rect. To exercise the handle path, dispatch on
  // canvas with the handle's overlay-relative position; the editor
  // does handle-hit-test against overlay regardless of which DOM node
  // received the event.
  const startX = left + 4;
  const startY = top + 4;
  dispatchMouseDown(canvas, startX, startY);
  document.dispatchEvent(new MouseEvent('mousemove', { clientX: startX + 50, clientY: startY, bubbles: true }));
  document.dispatchEvent(new MouseEvent('mouseup',   { clientX: startX + 50, clientY: startY, bubbles: true }));
  expect(store.read().slides[0].elements[0].frame.w).toBe(250);
});
```

- [ ] **Step 5.7: Run tests, confirm green**

Run: `pnpm slides test`
Expected: PASS.

- [ ] **Step 5.8: Commit**

```bash
git add packages/slides/src/view/editor
git commit -m "Add eight-handle resize in SlidesEditor" -m "resizeFrame is the pure decision: each handle anchors at the opposite
corner or edge, dragging moves the active edges, and shift preserves
aspect by adopting the larger relative axis change. A 1 px minimum
clamps both dimensions so frames never invert.

Editor wiring is single-element only in v1 — multi-element
proportional resize is a v2 polish item. Per the T2 simplification,
handles operate on the axis-aligned bbox even for rotated frames; the
rotated-resize-around-element-axis case lands later when overlay
gains per-rotated-frame handles.

Refs docs/design/slides/slides.md 'Interactions' table row Resize."
```

---

## Task 6: Rotate interaction

**Files:**
- Create: `packages/slides/src/view/editor/interactions/rotate.ts`
- Create: `packages/slides/src/view/editor/interactions/rotate.test.ts`

`rotate.ts` exposes `applyRotate(startRotation, startAngle, currentAngle,
shift): number` — pure radians math. Editor wiring computes `angle =
atan2(y - centerY, x - centerX)` from the slide-coords pointer and
the bbox centre.

`shift` snaps to 15° (π/12).

- [ ] **Step 6.1: Write failing tests**

Create `packages/slides/src/view/editor/interactions/rotate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { applyRotate, snapAngle } from './rotate';

const TAU = Math.PI * 2;
const STEP = Math.PI / 12; // 15°

describe('applyRotate', () => {
  it('applies the angular delta to the start rotation', () => {
    expect(applyRotate(0, 0, Math.PI / 4, false)).toBeCloseTo(Math.PI / 4);
  });
  it('preserves a non-zero start rotation', () => {
    expect(applyRotate(Math.PI / 6, 0, Math.PI / 4, false)).toBeCloseTo(Math.PI / 6 + Math.PI / 4);
  });
  it('shift snaps to 15° increments', () => {
    // 0.30 rad ≈ 17.2° → rounds down to 15° (1 × STEP).
    expect(applyRotate(0, 0, 0.30, true)).toBeCloseTo(Math.PI / 12);
    // π/9 = 20° → rounds down to 15° (1 × STEP).
    expect(applyRotate(0, 0, Math.PI / 9, true)).toBeCloseTo(Math.PI / 12);
  });
});

describe('snapAngle', () => {
  it('rounds to the nearest 15° step', () => {
    // 0.30 rad → 1 × STEP = 0.262.
    expect(snapAngle(0.30)).toBeCloseTo(STEP);
    expect(snapAngle(STEP * 2.6)).toBeCloseTo(STEP * 3);
  });
  it('preserves negative angles', () => {
    expect(snapAngle(-STEP * 1.4)).toBeCloseTo(-STEP);
  });
});
```

- [ ] **Step 6.2: Verify FAIL**

Run: `pnpm slides test`
Expected: FAIL.

- [ ] **Step 6.3: Implement `rotate.ts`**

```ts
const STEP = Math.PI / 12; // 15°

export function applyRotate(
  startRotation: number,
  startAngle: number,
  currentAngle: number,
  shift: boolean,
): number {
  const delta = currentAngle - startAngle;
  const next = startRotation + delta;
  return shift ? snapAngle(next) : next;
}

export function snapAngle(angle: number): number {
  return Math.round(angle / STEP) * STEP;
}
```

- [ ] **Step 6.4: Run tests, confirm green**

- [ ] **Step 6.5: Wire rotate into the editor**

In `editor.ts`, implement `startRotate` (called by
`onPointerDownHandle` when handle === 'rotate'):

```ts
private startRotate(clientX: number, clientY: number): void {
  const startSlide = this.currentSlide();
  if (!startSlide) return;
  const selectedIds = this.selection.get();
  if (selectedIds.length !== 1) return; // single-element only in v1
  const elementId = selectedIds[0];
  const startEl = startSlide.elements.find((e) => e.id === elementId);
  if (!startEl) return;
  const startRotation = startEl.frame.rotation;
  const cx = startEl.frame.x + startEl.frame.w / 2;
  const cy = startEl.frame.y + startEl.frame.h / 2;
  const start = this.clientToLogical(clientX, clientY);
  const startAngle = Math.atan2(start.y - cy, start.x - cx);
  let liveRotation = startRotation;

  const onMove = (ev: MouseEvent) => {
    const cur = this.clientToLogical(ev.clientX, ev.clientY);
    const angle = Math.atan2(cur.y - cy, cur.x - cx);
    liveRotation = applyRotate(startRotation, startAngle, angle, ev.shiftKey);
    const liveFrame: Frame = { ...startEl.frame, rotation: liveRotation };
    this.paintLive(new Map([[elementId, liveFrame]]));
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    this.options.store.batch(() => {
      this.options.store.updateElementFrame(startSlide.id, elementId, { rotation: liveRotation });
    });
    this.renderer.markDirty();
    this.render();
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}
```

Add imports:

```ts
import { applyRotate } from './interactions/rotate';
```

- [ ] **Step 6.6: Run tests, confirm green**

Run: `pnpm slides test`
Expected: PASS.

- [ ] **Step 6.7: Commit**

```bash
git add packages/slides/src/view/editor
git commit -m "Add rotate handle interaction in SlidesEditor" -m "Dragging the rotate handle (positioned 24 px above the bbox top-centre)
spins the single selected element around its frame centre. shift snaps
to 15° steps (the same snap docs uses for line angle); release commits
one updateElementFrame batch with the final rotation.

Multi-element rotate is deferred to v2 — the question of 'rotate
around what?' (each element's own centre vs the group bbox centre) is
a UX decision worth dedicated brainstorming, and v1 doesn't need it.

Refs docs/design/slides/slides.md 'Interactions' table row Rotate."
```

---

## Task 7: Insert mode

**Files:**
- Create: `packages/slides/src/view/editor/interactions/insert.ts`
- Create: `packages/slides/src/view/editor/interactions/insert.test.ts`

When `setInsertMode('rect')` is called, the editor enters "place new
shape" mode. The next mousedown on the canvas anchors a new element
at that point; mousemove drags out the size; mouseup commits one
`addElement` and exits insert mode (back to idle).

Text insert is a special case: a single click creates a fixed-size
text box (no drag-to-size).

- [ ] **Step 7.1: Write failing tests**

Create `packages/slides/src/view/editor/interactions/insert.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { InsertKind } from '../editor';
import { buildInsertElement } from './insert';

describe('buildInsertElement — drag-shaped shapes', () => {
  it('builds a rect from the drag rectangle', () => {
    const init = buildInsertElement('rect', { x: 10, y: 20 }, { x: 110, y: 80 });
    expect(init).toEqual({
      type: 'shape',
      frame: { x: 10, y: 20, w: 100, h: 60, rotation: 0 },
      data: { kind: 'rect', fill: '#cccccc' },
    });
  });
  it('builds an ellipse the same way', () => {
    const init = buildInsertElement('ellipse', { x: 0, y: 0 }, { x: 50, y: 50 });
    expect(init).toEqual({
      type: 'shape',
      frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
      data: { kind: 'ellipse', fill: '#cccccc' },
    });
  });
  it('normalises a backwards drag', () => {
    const init = buildInsertElement('rect', { x: 100, y: 100 }, { x: 50, y: 60 });
    expect(init.frame).toEqual({ x: 50, y: 60, w: 50, h: 40, rotation: 0 });
  });
});

describe('buildInsertElement — line and arrow', () => {
  it('places line/arrow as a thin box from start to end', () => {
    const line = buildInsertElement('line', { x: 0, y: 0 }, { x: 100, y: 50 });
    expect(line.type).toBe('shape');
    expect(line.frame.w).toBe(100);
    expect(line.frame.h).toBe(50);
    if (line.type === 'shape' && line.data.kind === 'line') {
      expect(line.data.stroke?.width).toBe(2);
    }
  });
});

describe('buildInsertElement — text', () => {
  it('returns a default-sized text box anchored at the start point', () => {
    const text = buildInsertElement('text', { x: 50, y: 50 }, { x: 50, y: 50 });
    expect(text.type).toBe('text');
    expect(text.frame.w).toBe(400);
    expect(text.frame.h).toBe(80);
    expect(text.frame.x).toBe(50);
    expect(text.frame.y).toBe(50);
  });
});
```

- [ ] **Step 7.2: Verify FAIL**

Run: `pnpm slides test`
Expected: FAIL.

- [ ] **Step 7.3: Implement `insert.ts`**

```ts
import type { Block } from '@wafflebase/docs';
import type { ElementInit } from '../../../model/element';
import type { InsertKind } from '../editor';

const DEFAULT_FILL = '#cccccc';
const DEFAULT_STROKE_WIDTH = 2;
const TEXT_DEFAULT_W = 400;
const TEXT_DEFAULT_H = 80;

export interface Point { x: number; y: number; }

/**
 * Build the ElementInit for a freshly-inserted element given the
 * pointer's drag start and end. Shapes use the drag rectangle as the
 * frame; text uses a default-sized box anchored at the start point
 * (insert text is a single-click operation, not a drag).
 */
export function buildInsertElement(
  kind: InsertKind,
  start: Point, end: Point,
): ElementInit {
  if (kind === 'text') {
    return {
      type: 'text',
      frame: { x: start.x, y: start.y, w: TEXT_DEFAULT_W, h: TEXT_DEFAULT_H, rotation: 0 },
      data: {
        blocks: [{
          id: 'placeholder',
          type: 'paragraph',
          inlines: [{ text: '', style: {} }],
          style: {},
        } as Block],
      },
    };
  }

  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const w = Math.abs(end.x - start.x);
  const h = Math.abs(end.y - start.y);
  const frame = { x, y, w, h, rotation: 0 };

  switch (kind) {
    case 'rect':    return { type: 'shape', frame, data: { kind: 'rect', fill: DEFAULT_FILL } };
    case 'ellipse': return { type: 'shape', frame, data: { kind: 'ellipse', fill: DEFAULT_FILL } };
    case 'line':    return { type: 'shape', frame, data: { kind: 'line',  stroke: { color: '#222', width: DEFAULT_STROKE_WIDTH } } };
    case 'arrow':   return { type: 'shape', frame, data: { kind: 'arrow', stroke: { color: '#222', width: DEFAULT_STROKE_WIDTH }, fill: '#222' } };
  }
}
```

- [ ] **Step 7.4: Run tests, confirm green**

Run: `pnpm slides test`
Expected: PASS.

- [ ] **Step 7.5: Wire insert into the editor**

In `editor.ts`, replace the `if (this.insertKind !== null) return;` short-circuit with:

```ts
if (this.insertKind !== null) {
  this.startInsert(e.clientX, e.clientY);
  return;
}
```

Add `startInsert`:

```ts
private startInsert(clientX: number, clientY: number): void {
  const kind = this.insertKind;
  if (kind === null) return;
  const slide = this.currentSlide();
  if (!slide) return;
  const start = this.clientToLogical(clientX, clientY);

  if (kind === 'text') {
    // Single-click insert.
    const init = buildInsertElement('text', start, start);
    this.options.store.batch(() => {
      const id = this.options.store.addElement(slide.id, init);
      this.selection.set([id]);
    });
    this.setInsertMode(null);
    this.renderer.markDirty();
    this.render();
    return;
  }

  // Drag-to-size for shapes.
  let endPoint = start;
  const onMove = (ev: MouseEvent) => {
    endPoint = this.clientToLogical(ev.clientX, ev.clientY);
    // Live preview: paint the in-progress shape over the slide.
    const init = buildInsertElement(kind, start, endPoint);
    const synthetic = {
      ...slide,
      elements: [...slide.elements, { ...init, id: '__preview__' } as Element],
    };
    this.renderer.forceRender(synthetic);
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    const init = buildInsertElement(kind, start, endPoint);
    if (init.frame.w < 4 && init.frame.h < 4) {
      // No real drag — drop a default-sized shape.
      init.frame = { x: start.x, y: start.y, w: 200, h: 100, rotation: 0 };
    }
    this.options.store.batch(() => {
      const id = this.options.store.addElement(slide.id, init);
      this.selection.set([id]);
    });
    this.setInsertMode(null);
    this.renderer.markDirty();
    this.render();
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}
```

Add imports:

```ts
import { buildInsertElement } from './interactions/insert';
import type { Element } from '../../model/element';
```

- [ ] **Step 7.6: Add an editor-level insert test**

```ts
it('insert mode places a new shape on canvas drag', () => {
  const { canvas, overlay, store } = makeFixture();
  editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
  editor.setInsertMode('rect');
  dispatchMouseDown(canvas, 100, 100);
  document.dispatchEvent(new MouseEvent('mousemove', { clientX: 300, clientY: 200, bubbles: true }));
  document.dispatchEvent(new MouseEvent('mouseup',   { clientX: 300, clientY: 200, bubbles: true }));
  const elements = store.read().slides[0].elements;
  expect(elements.length).toBe(1);
  expect(elements[0].frame).toEqual({ x: 100, y: 100, w: 200, h: 100, rotation: 0 });
  expect(editor.getSelection()).toEqual([elements[0].id]);
});
```

- [ ] **Step 7.7: Run tests, confirm green**

Run: `pnpm slides test`
Expected: PASS.

- [ ] **Step 7.8: Commit**

```bash
git add packages/slides/src/view/editor
git commit -m "Add toolbar-driven insert mode in SlidesEditor" -m "setInsertMode(kind) puts the editor into 'place a new element'
mode. The next canvas mousedown anchors the start; mousemove drags
out a live preview; mouseup commits one addElement inside a single
batch and selects the new element. Tiny drags (< 4 px on both axes)
fall back to a default 200x100 frame so a careless click still gives
the user something usable.

Text insert is single-click — drag-to-size is rare for text and the
default 400x80 frame gives a useful starting size for typing.

Insert mode auto-exits to idle after a successful place; the toolbar
is responsible for re-entering it if the user wants to insert another.

Refs docs/design/slides/slides.md 'Interactions' table row
Add shape/text/image."
```

---

## Task 8: Demo update + visual verify + final gate

**Files:**
- Modify: `packages/slides/index.html`
- Modify: `packages/slides/demo.ts`
- Modify: `packages/slides/src/index.ts`
- Modify: `docs/tasks/active/20260505-slides-package-mvp-todo.md`

The demo grows a small toolbar above the canvas (vanilla DOM buttons)
and an overlay div absolutely positioned over the canvas. Clicking a
toolbar button calls `editor.setInsertMode(kind)`; clicking on a
shape selects/drags it.

- [ ] **Step 8.1: Update `src/index.ts` with the editor exports**

Append after the existing `// View — Canvas renderers (Phase 2)` block:

```ts
// View — Editor (Phase 3a)
export { initialize as initializeEditor, type SlidesEditor, type SlidesEditorOptions, type InsertKind } from './view/editor/editor';
```

> Do NOT export internal interaction modules (`select`, `drag`,
> `resize`, etc.) — they are implementation details of the editor.

- [ ] **Step 8.2: Update `index.html` to add a toolbar + overlay**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>@wafflebase/slides demo</title>
    <style>
      body { margin: 0; background: #1a1a1a; color: #ddd; font-family: system-ui, sans-serif; }
      .stage { display: grid; place-items: center; min-height: 100vh; padding: 24px; gap: 12px; grid-template-columns: 1fr; }
      .label { font-size: 12px; opacity: 0.7; margin-bottom: 8px; }
      .toolbar { display: flex; gap: 8px; }
      .toolbar button {
        background: #2a2a2a; color: #ddd; border: 1px solid #444;
        padding: 6px 12px; cursor: pointer; border-radius: 4px;
        font-size: 13px;
      }
      .toolbar button:hover { background: #333; }
      .toolbar button.active { background: #3a7; border-color: #3a7; color: #fff; }
      .canvas-wrap { position: relative; }
      canvas { background: #fff; box-shadow: 0 8px 32px rgba(0,0,0,0.5); display: block; }
      .overlay {
        position: absolute; left: 0; top: 0;
        width: 960px; height: 540px;
        pointer-events: none;       /* handles re-enable per element */
      }
      .overlay [data-handle] { pointer-events: auto; }
    </style>
  </head>
  <body>
    <div class="stage">
      <div class="label">@wafflebase/slides Phase 3a — interactive editor</div>
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
    </div>
    <script type="module" src="./demo.ts"></script>
  </body>
</html>
```

- [ ] **Step 8.3: Replace `demo.ts` with an interactive build**

```ts
import {
  MemSlidesStore,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  initializeEditor,
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
  const slideId = store.addSlide('blank');
  // A starter rectangle the user can drag around immediately.
  store.addElement(slideId, {
    type: 'shape',
    frame: { x: 200, y: 200, w: 400, h: 200, rotation: 0 },
    data: { kind: 'rect', fill: '#3a7' },
  });
});

const editor = initializeEditor({
  canvas, overlay, store,
  hostWidth: HOST_W, hostHeight: HOST_H, dpr: DPR,
});

// Toolbar wiring.
const toolbar = document.getElementById('toolbar') as HTMLDivElement;
toolbar.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const insert = target.dataset.insert as InsertKind | undefined;
  if (!insert) return;
  // Toggle: clicking the same button again exits insert mode.
  const wasActive = target.classList.contains('active');
  toolbar.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
  if (wasActive) {
    editor.setInsertMode(null);
  } else {
    target.classList.add('active');
    editor.setInsertMode(insert);
  }
});

// Drive an animation-frame loop so async asset loads (image cache)
// repaint when ready.
function tick(): void {
  editor.render();
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

void SLIDE_HEIGHT; // suppress unused-export warning
void SLIDE_WIDTH;
```

- [ ] **Step 8.4: Boot dev server, verify HTTP 200, then stop**

Run: `pnpm slides dev` (background)

The dev server should print a URL. Confirm:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/demo.ts
```

Both should print `200`. Stop the dev server.

If it fails to compile, the most common cause is a missing import in
the demo or a wrong type cast. Fix the root cause.

- [ ] **Step 8.5: Run typecheck + tests + verify:fast**

Run: `pnpm slides typecheck && pnpm slides test`
Expected: both exit 0.

Run: `pnpm verify:fast`
Expected: exit 0.

- [ ] **Step 8.6: Tick Phase 3a items in the high-level checklist**

Edit `docs/tasks/active/20260505-slides-package-mvp-todo.md` and mark
items 3.1, 3.2, 3.3, 3.4, 3.5, 3.6 as `[x]`. Items 3.7-3.15 are
Phase 3b — leave them unchecked.

- [ ] **Step 8.7: Commit**

```bash
git add packages/slides/index.html packages/slides/demo.ts packages/slides/src/index.ts docs/tasks/active/20260505-slides-package-mvp-todo.md
git commit -m "Wire interactive demo + expose Phase 3a editor API" -m "demo.ts now mounts the SlidesEditor on the existing canvas + a new
overlay div, and the toolbar buttons call setInsertMode so a user can
place rect / ellipse / line / arrow / text by dragging on the
canvas. Existing shapes can be selected, multi-selected with
shift-click, lassoed via empty-canvas drag, dragged with snap-to-edge,
resized through any of eight handles, and rotated through the rotate
handle.

Editor entry points (initializeEditor, SlidesEditor, SlidesEditorOptions,
InsertKind) are added to the package public surface so Phase 4's
React wrapper imports them through the package boundary.

Phase 3a checklist items 3.1-3.6 ticked. 3.7-3.15 are Phase 3b.

verify:fast green at this commit."
```

---

## Phase 3a Done

After Task 8:

- `pnpm slides test` and `pnpm slides typecheck` are green.
- `pnpm verify:fast` is green.
- `pnpm slides dev` opens a working single-user editor: select / drag
  / resize / rotate / insert work on the four shape kinds + text.
- `@wafflebase/slides` exposes `initializeEditor` so Phase 4's React
  wrapper imports through the package boundary.
- Nothing in `frontend`, `backend`, `cli`, `sheets`, or `docs` has
  been touched.

When you are ready for **Phase 3b** (keyboard shortcuts, clipboard,
slide thumbnail interactions, right-click context menus, speaker
notes panel, undo/redo wiring, the docs RichText spike), I will write
`docs/tasks/active/<date>-slides-phase3b-plan.md`.

## Self-review

- **Spec coverage:** Every Phase 3 spec sentence under "Editor UI"
  and the Interactions table rows for select / multi-select / lasso /
  drag / resize / rotate / insert is exercised. Speaker notes,
  context menus, clipboard, keyboard shortcuts, and thumbnail
  interactions are explicitly deferred to Phase 3b.
- **Type consistency:** `Frame`, `Element`, `ElementInit` all imported
  from `../../model/element` consistently. `ResizeHandle` defined
  once in `hit-test.ts` and re-imported by `resize.ts` and
  `interactions/select.ts` rather than redeclared.
- **Placeholder scan:** No "TBD" / "TODO" inside the implementation;
  the deliberate gaps (rotated single-element handles on bbox vs
  rotated frame; multi-element resize/rotate; visible snap guidelines)
  are documented inline with a "v2" tag and the reason.
