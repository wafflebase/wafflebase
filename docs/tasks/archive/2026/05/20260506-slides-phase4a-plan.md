# Slides Phase 4a (Frontend Yorkie Integration) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Wire `@wafflebase/slides` into the frontend monorepo against
real Yorkie. Land a `YorkieSlidesStore` that implements the
`SlidesStore` interface against a Yorkie document, mount the editor
inside a React `SlidesView` wrapper, register the new
`SlidesDocument` Yorkie type on the backend, and route to a new
`SlidesDetail` page from the documents list. End the phase with the
ability to create a slides document from the documents UI and edit
it in the browser; two-user concurrency tests are Phase 4b.

**Architecture:**
- `YorkieSlidesStore` mirrors `YorkieStore` / `YorkieDocStore`: it
  takes a `Yorkie.Document<YorkieSlidesRoot>` in the constructor and
  exposes the same `SlidesStore` interface that `MemSlidesStore` does.
- Yorkie root for v1 stores text element bodies as plain `blocks:
  Block[]` (JSON), NOT Yorkie.Tree. Phase 5 introduces Yorkie.Tree for
  intent-preserving text editing alongside the docs IME bridge — until
  then, plain JSON is enough and keeps Phase 4a's surface narrow.
- Snapshot-based undo/redo, same shape as `MemSlidesStore`. Multi-user
  undo subtleties (a remote change invalidates a local undo stack) are
  documented as Phase 4b/v2 work; for Phase 4a the editor is
  effectively single-user-via-Yorkie.
- React shell mirrors `DocsView`/`DocsDetail`: `useDocument` hook from
  `@yorkie-js/react`, `useEffect` mount, presence wiring through
  `doc.update((_, p) => p.set(...))`.

**Spec:** [`docs/design/slides/slides.md`](../../design/slides/slides.md)
sections "Yorkie schema" and "Presence". This plan delivers todo
items 4.1 (yorkie store), 4.3 (presence + drag broadcast), 4.4 (peer
cursors), 4.5 (backend type), 4.6 (frontend type + route), 4.7
(document-detail branch). Items 4.2 (equivalence tests) and 4.8/4.9
(two-user + verify:integration) are Phase 4b.

> Phase 4a ends when these checklist items are ticked, `pnpm
> verify:fast` is green, and you can: (a) create a slides document
> from the documents list UI, (b) navigate to its `/p/:id` route, and
> (c) edit it in the browser with the existing Phase 3 editor surface
> backed by Yorkie.

---

## File structure

Created in this phase:

```
packages/frontend/src/types/
└── slides-document.ts                          # T1 (YorkieSlidesRoot type)

packages/frontend/src/app/slides/
├── yorkie-slides-store.ts                      # T1
├── yorkie-slides-store.test.ts                 # T1
├── slides-view.tsx                             # T2
└── slides-detail.tsx                           # T2
```

Modified in this phase:

- `packages/frontend/src/types/users.ts` — add `SlidesPresence`
- `packages/frontend/src/types/documents.ts` — add `'slides'` to `DocumentType`
- `packages/frontend/src/App.tsx` — add `<Route path="/p/:id" element={<SlidesDetail />} />`
- `packages/frontend/src/app/documents/document-list.tsx` — `/p/${id}` link for `type === 'slides'`
- `packages/backend/src/yorkie/yorkie.types.ts` — re-export `SlidesDocument`
- `packages/backend/...` (creation API) — accept `type: 'slides'` if a code path needs adjustment
- `docs/tasks/active/20260505-slides-package-mvp-todo.md` — tick 4.1, 4.3-4.7

---

## Conventions

Same as prior phases. Frontend tests use the existing vitest setup;
backend tests use Jest. No `--no-verify`. All work on
`feat/slides-phase1`.

Yorkie operations are SYNCHRONOUS via `doc.update(updater)` — the
updater runs immediately, the returned change is queued internally
for sync. So `SlidesStore`'s synchronous interface maps cleanly.

---

## Task 1: YorkieSlidesStore + types + unit tests

**Files:**
- Create: `packages/frontend/src/types/slides-document.ts`
- Modify: `packages/frontend/src/types/users.ts` (add `SlidesPresence`)
- Create: `packages/frontend/src/app/slides/yorkie-slides-store.ts`
- Create: `packages/frontend/src/app/slides/yorkie-slides-store.test.ts`

The store implements `SlidesStore` from `@wafflebase/slides` against
a Yorkie Document. Each mutation wraps `doc.update`. `batch(fn)`
collects everything `fn` does into one Yorkie change (and snapshots
the root for local undo).

- [ ] **Step 1.1: Create `packages/frontend/src/types/slides-document.ts`**

```ts
import type { Block } from '@wafflebase/docs';

/**
 * Yorkie document root for the slides editor. Phase 4a stores text
 * element bodies as plain `blocks: Block[]` (JSON); Phase 5 will
 * migrate text bodies to Yorkie.Tree alongside the docs IME bridge.
 */
export interface YorkieSlidesRoot {
  meta: { title: string };
  slides: YorkieSlide[];
  layouts: YorkieLayout[];
}

export interface YorkieSlide {
  id: string;
  layoutId: string;
  background: { fill: string; image?: { src: string; w: number; h: number } };
  elements: YorkieElement[];
  notes: Block[];
}

export type YorkieElement =
  | YorkieTextElement
  | YorkieImageElement
  | YorkieShapeElement;

interface YorkieFrame {
  x: number; y: number; w: number; h: number; rotation: number;
}

export interface YorkieTextElement {
  id: string;
  type: 'text';
  frame: YorkieFrame;
  data: { blocks: Block[] };
}

export interface YorkieImageElement {
  id: string;
  type: 'image';
  frame: YorkieFrame;
  data: {
    src: string;
    crop?: { x: number; y: number; w: number; h: number };
    alt?: string;
  };
}

export interface YorkieShapeElement {
  id: string;
  type: 'shape';
  frame: YorkieFrame;
  data: {
    kind: 'rect' | 'ellipse' | 'line' | 'arrow';
    fill?: string;
    stroke?: { color: string; width: number };
  };
}

export interface YorkieLayout {
  id: string;
  name: string;
  placeholders: Omit<YorkieElement, 'id'>[];
}
```

- [ ] **Step 1.2: Add `SlidesPresence` to `types/users.ts`**

Append after the existing `DocsPresence` block:

```ts
export type SlidesPresence = {
  username: string;
  email: string;
  photo: string;
  /** id of the slide the user is currently viewing/editing. */
  activeSlideId?: string;
  /** ids of elements the user has selected on activeSlideId. */
  selectedElementIds?: string[];
  /** during an active drag/resize/rotate, the live frame for visual
   * peer feedback. Cleared on mouseup. */
  activeFrames?: Array<{
    elementId: string;
    x: number; y: number; w: number; h: number; rotation: number;
  }>;
};
```

- [ ] **Step 1.3: Write failing tests for `YorkieSlidesStore`**

Create `packages/frontend/src/app/slides/yorkie-slides-store.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import yorkie from '@yorkie-js/sdk';
import type { Document } from '@yorkie-js/sdk';
import type { YorkieSlidesRoot } from '@/types/slides-document';
import { YorkieSlidesStore, ensureSlidesRoot } from './yorkie-slides-store';

function makeDoc(): Document<YorkieSlidesRoot> {
  const doc = new yorkie.Document<YorkieSlidesRoot>(`test-${Date.now()}-${Math.random()}`);
  ensureSlidesRoot(doc);
  return doc;
}

describe('YorkieSlidesStore — read', () => {
  it('returns a deep snapshot of the Yorkie root', () => {
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    const out = store.read();
    expect(out.meta.title).toBe('Untitled presentation');
    expect(out.slides).toEqual([]);
    expect(out.layouts.length).toBeGreaterThan(0);
  });
});

describe('YorkieSlidesStore — slide ops', () => {
  it('addSlide pushes onto the array and returns the new id', () => {
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    let id = '';
    store.batch(() => { id = store.addSlide('blank'); });
    expect(store.read().slides.map((s) => s.id)).toEqual([id]);
    expect(typeof id).toBe('string');
  });

  it('addSlide("title-body") seeds two text placeholders', () => {
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    let id = '';
    store.batch(() => { id = store.addSlide('title-body'); });
    const slide = store.read().slides.find((s) => s.id === id)!;
    expect(slide.elements).toHaveLength(2);
  });

  it('removeSlide drops the slide', () => {
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    let id = '';
    store.batch(() => { id = store.addSlide('blank'); });
    store.batch(() => store.removeSlide(id));
    expect(store.read().slides).toEqual([]);
  });

  it('moveSlide reorders', () => {
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    const ids: string[] = [];
    store.batch(() => {
      for (let i = 0; i < 3; i++) ids.push(store.addSlide('blank'));
    });
    store.batch(() => store.moveSlide(ids[2], 0));
    expect(store.read().slides.map((s) => s.id)).toEqual([ids[2], ids[0], ids[1]]);
  });
});

describe('YorkieSlidesStore — element ops', () => {
  it('addElement / updateElementFrame / removeElement', () => {
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    let slideId = '';
    let elId = '';
    store.batch(() => {
      slideId = store.addSlide('blank');
      elId = store.addElement(slideId, {
        type: 'shape',
        frame: { x: 10, y: 10, w: 100, h: 50, rotation: 0 },
        data: { kind: 'rect', fill: '#abc' },
      });
    });
    store.batch(() => store.updateElementFrame(slideId, elId, { x: 100 }));
    expect(store.read().slides[0].elements[0].frame.x).toBe(100);
    store.batch(() => store.removeElement(slideId, elId));
    expect(store.read().slides[0].elements).toEqual([]);
  });
});

describe('YorkieSlidesStore — undo/redo (snapshot-based)', () => {
  it('one batch = one undo entry', () => {
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    store.batch(() => { store.addSlide('blank'); store.addSlide('blank'); });
    expect(store.read().slides).toHaveLength(2);
    store.undo();
    expect(store.read().slides).toEqual([]);
    store.redo();
    expect(store.read().slides).toHaveLength(2);
  });

  it('throws if a mutation is called outside a batch', () => {
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    expect(() => store.addSlide('blank')).toThrow(/must be wrapped in batch/);
  });
});

describe('YorkieSlidesStore — remote-change subscription', () => {
  it('fires onRemoteChange when another doc applies a change and we sync', async () => {
    // For a complete test we'd need two clients sharing a docKey via
    // the real Yorkie server (Phase 4b). For Phase 4a we just verify
    // that the subscriber wiring exists and a local change does NOT
    // fire it (only remote changes should).
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    let fired = false;
    store.onRemoteChange = () => { fired = true; };
    store.batch(() => store.addSlide('blank'));
    expect(fired).toBe(false);
  });
});
```

- [ ] **Step 1.4: Verify FAIL**

Run from frontend: `pnpm --filter @wafflebase/frontend test src/app/slides/yorkie-slides-store.test.ts`
Expected: FAIL — `./yorkie-slides-store` not found.

- [ ] **Step 1.5: Implement `yorkie-slides-store.ts`**

```ts
import type { Document as YorkieDocument } from '@yorkie-js/react';
import type yorkie from '@yorkie-js/sdk';
import {
  type Background,
  type Element,
  type ElementInit,
  type Frame,
  type Layout,
  type SlidesDocument,
  type SlidesStore,
  BUILT_IN_LAYOUTS,
  generateId,
  getLayout,
} from '@wafflebase/slides';
import type { Block } from '@wafflebase/docs';
import type { SlidesPresence } from '@/types/users';
import type {
  YorkieElement,
  YorkieSlide,
  YorkieSlidesRoot,
} from '@/types/slides-document';

const DEFAULT_BACKGROUND = { fill: '#ffffff' };

/**
 * Idempotently initialise the Yorkie root with the slides shape.
 * Safe to call on every mount; existing slides/layouts are preserved.
 */
export function ensureSlidesRoot(
  doc: YorkieDocument<YorkieSlidesRoot>,
): void {
  const root = doc.getRoot();
  if (root.meta == null || root.slides == null || root.layouts == null) {
    doc.update((r) => {
      if (r.meta == null) r.meta = { title: 'Untitled presentation' };
      if (r.slides == null) r.slides = [];
      if (r.layouts == null) r.layouts = clone(BUILT_IN_LAYOUTS) as YorkieLayout[];
    });
  }
}

type YorkieLayout = YorkieSlidesRoot['layouts'][number];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Yorkie-backed `SlidesStore`. Wraps every mutation in `doc.update`
 * and snapshots the root before each top-level batch for local undo.
 *
 * Multi-user undo subtleties — where a remote change between batch
 * and undo would have the undo overwrite that remote change — are
 * deliberately ignored in Phase 4a; the behaviour matches MemSlidesStore.
 */
export class YorkieSlidesStore implements SlidesStore {
  /** Set by the React wrapper to schedule a re-render on remote change. */
  onRemoteChange?: () => void;

  private undoStack: SlidesDocument[] = [];
  private redoStack: SlidesDocument[] = [];
  private batchDepth = 0;

  constructor(private doc: YorkieDocument<YorkieSlidesRoot>) {
    doc.subscribe((e) => {
      if (e.type === 'remote-change') {
        this.onRemoteChange?.();
      }
    });
  }

  // --- read ---

  read(): SlidesDocument {
    const root = this.doc.getRoot();
    return {
      meta: { title: root.meta?.title ?? 'Untitled presentation' },
      slides: (root.slides ?? []).map(snapshotSlide),
      layouts: (root.layouts ?? []).map(snapshotLayout),
    };
  }

  // --- batch + undo ---

  batch(fn: () => void): void {
    if (this.batchDepth === 0) {
      this.undoStack.push(this.read());
      this.redoStack = [];
    }
    this.batchDepth++;
    try { fn(); } finally { this.batchDepth--; }
  }

  undo(): void {
    if (!this.canUndo()) return;
    const snapshot = this.undoStack.pop()!;
    this.redoStack.push(this.read());
    this.replaceRoot(snapshot);
  }

  redo(): void {
    if (!this.canRedo()) return;
    const snapshot = this.redoStack.pop()!;
    this.undoStack.push(this.read());
    this.replaceRoot(snapshot);
  }

  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }

  private replaceRoot(snapshot: SlidesDocument): void {
    this.doc.update((r) => {
      r.meta = clone(snapshot.meta);
      r.slides = snapshot.slides.map(toYorkieSlide);
      r.layouts = clone(snapshot.layouts) as YorkieLayout[];
    });
  }

  // --- slide ops ---

  addSlide(layoutId: string, atIndex?: number): string {
    this.requireBatch();
    const layout = getLayout(layoutId);
    const id = generateId();
    const slide: YorkieSlide = {
      id,
      layoutId: layout.id,
      background: { ...DEFAULT_BACKGROUND },
      elements: layout.placeholders.map((p) => ({
        ...clone(p),
        id: generateId(),
      } as YorkieElement)),
      notes: [],
    };
    this.doc.update((r) => {
      const insertAt = atIndex == null
        ? r.slides.length
        : Math.max(0, Math.min(atIndex, r.slides.length));
      r.slides.splice(insertAt, 0, slide);
    });
    return id;
  }

  duplicateSlide(slideId: string): string {
    this.requireBatch();
    const newId = generateId();
    this.doc.update((r) => {
      const idx = r.slides.findIndex((s) => s.id === slideId);
      if (idx === -1) throw new Error(`Slide not found: ${slideId}`);
      const source = clone(r.slides[idx]) as YorkieSlide;
      source.id = newId;
      source.elements = source.elements.map((e) => ({ ...e, id: generateId() }));
      r.slides.splice(idx + 1, 0, source);
    });
    return newId;
  }

  removeSlide(slideId: string): void {
    this.requireBatch();
    this.doc.update((r) => {
      const i = r.slides.findIndex((s) => s.id === slideId);
      if (i === -1) throw new Error(`Slide not found: ${slideId}`);
      r.slides.splice(i, 1);
    });
  }

  removeSlides(slideIds: string[]): void {
    this.requireBatch();
    const set = new Set(slideIds);
    this.doc.update((r) => {
      r.slides = r.slides.filter((s) => !set.has(s.id)) as never;
    });
  }

  moveSlide(slideId: string, toIndex: number): void {
    this.requireBatch();
    this.doc.update((r) => {
      const from = r.slides.findIndex((s) => s.id === slideId);
      if (from === -1) throw new Error(`Slide not found: ${slideId}`);
      const [s] = r.slides.splice(from, 1);
      const clamped = Math.max(0, Math.min(toIndex, r.slides.length));
      r.slides.splice(clamped, 0, s);
    });
  }

  moveSlides(slideIds: string[], toIndex: number): void {
    this.requireBatch();
    const set = new Set(slideIds);
    this.doc.update((r) => {
      const moving = r.slides.filter((s) => set.has(s.id));
      r.slides = r.slides.filter((s) => !set.has(s.id)) as never;
      const clamped = Math.max(0, Math.min(toIndex, r.slides.length));
      r.slides.splice(clamped, 0, ...moving);
    });
  }

  updateSlideBackground(slideId: string, bg: Background): void {
    this.requireBatch();
    this.doc.update((r) => {
      const s = r.slides.find((s) => s.id === slideId);
      if (!s) throw new Error(`Slide not found: ${slideId}`);
      s.background = clone(bg);
    });
  }

  applyLayout(slideId: string, layoutId: string): void {
    this.requireBatch();
    const layout = getLayout(layoutId);
    this.doc.update((r) => {
      const s = r.slides.find((s) => s.id === slideId);
      if (!s) throw new Error(`Slide not found: ${slideId}`);
      s.layoutId = layout.id;
      for (const placeholder of layout.placeholders) {
        const matches = s.elements.some(
          (e) => e.type === placeholder.type
            && e.frame.x === placeholder.frame.x
            && e.frame.y === placeholder.frame.y,
        );
        if (!matches) {
          s.elements.push({ ...clone(placeholder), id: generateId() } as YorkieElement);
        }
      }
    });
  }

  // --- element ops ---

  addElement(slideId: string, init: ElementInit): string {
    this.requireBatch();
    const id = generateId();
    this.doc.update((r) => {
      const s = r.slides.find((s) => s.id === slideId);
      if (!s) throw new Error(`Slide not found: ${slideId}`);
      s.elements.push({ ...clone(init), id } as YorkieElement);
    });
    return id;
  }

  removeElement(slideId: string, elementId: string): void {
    this.requireBatch();
    this.doc.update((r) => {
      const s = r.slides.find((s) => s.id === slideId);
      if (!s) throw new Error(`Slide not found: ${slideId}`);
      const i = s.elements.findIndex((e) => e.id === elementId);
      if (i === -1) throw new Error(`Element not found: ${elementId}`);
      s.elements.splice(i, 1);
    });
  }

  removeElements(slideId: string, elementIds: string[]): void {
    this.requireBatch();
    const set = new Set(elementIds);
    this.doc.update((r) => {
      const s = r.slides.find((s) => s.id === slideId);
      if (!s) throw new Error(`Slide not found: ${slideId}`);
      s.elements = s.elements.filter((e) => !set.has(e.id)) as never;
    });
  }

  updateElementFrame(slideId: string, elementId: string, frame: Partial<Frame>): void {
    this.requireBatch();
    this.doc.update((r) => {
      const s = r.slides.find((s) => s.id === slideId);
      if (!s) throw new Error(`Slide not found: ${slideId}`);
      const e = s.elements.find((e) => e.id === elementId);
      if (!e) throw new Error(`Element not found: ${elementId}`);
      e.frame = { ...e.frame, ...frame };
    });
  }

  updateElementData(slideId: string, elementId: string, patch: object): void {
    this.requireBatch();
    this.doc.update((r) => {
      const s = r.slides.find((s) => s.id === slideId);
      if (!s) throw new Error(`Slide not found: ${slideId}`);
      const e = s.elements.find((e) => e.id === elementId);
      if (!e) throw new Error(`Element not found: ${elementId}`);
      e.data = { ...(e.data as object), ...clone(patch) } as typeof e.data;
    });
  }

  reorderElement(slideId: string, elementId: string, toIndex: number): void {
    this.requireBatch();
    this.doc.update((r) => {
      const s = r.slides.find((s) => s.id === slideId);
      if (!s) throw new Error(`Slide not found: ${slideId}`);
      const from = s.elements.findIndex((e) => e.id === elementId);
      if (from === -1) throw new Error(`Element not found: ${elementId}`);
      const [el] = s.elements.splice(from, 1);
      const clamped = Math.max(0, Math.min(toIndex, s.elements.length));
      s.elements.splice(clamped, 0, el);
    });
  }

  // --- text bridges (Phase 4a: plain Block[]; Phase 5 swaps to Yorkie.Tree) ---

  withTextElement(
    slideId: string,
    elementId: string,
    fn: (blocks: Block[]) => Block[] | void,
  ): void {
    this.requireBatch();
    this.doc.update((r) => {
      const s = r.slides.find((s) => s.id === slideId);
      if (!s) throw new Error(`Slide not found: ${slideId}`);
      const e = s.elements.find((e) => e.id === elementId);
      if (!e) throw new Error(`Element not found: ${elementId}`);
      if (e.type !== 'text') {
        throw new Error(`Element ${elementId} is not a text element`);
      }
      const next = fn(clone(e.data.blocks));
      if (next !== undefined) e.data.blocks = clone(next);
    });
  }

  withNotes(slideId: string, fn: (blocks: Block[]) => Block[] | void): void {
    this.requireBatch();
    this.doc.update((r) => {
      const s = r.slides.find((s) => s.id === slideId);
      if (!s) throw new Error(`Slide not found: ${slideId}`);
      const next = fn(clone(s.notes));
      if (next !== undefined) s.notes = clone(next);
    });
  }

  // --- presence ---

  updatePresence(presence: SlidesPresence): void {
    this.doc.update((_, p) => p.set(presence));
  }

  getPeers(): Array<{ clientID: string; presence: SlidesPresence }> {
    return this.doc.getOthersPresences().map((p) => ({
      clientID: String(p.clientID),
      presence: p.presence as SlidesPresence,
    }));
  }

  // --- internal ---

  private requireBatch(): void {
    if (this.batchDepth === 0) {
      throw new Error('Mutations must be wrapped in batch()');
    }
  }
}

function snapshotSlide(s: YorkieSlide): SlidesDocument['slides'][number] {
  return {
    id: s.id,
    layoutId: s.layoutId,
    background: clone(s.background),
    elements: s.elements.map((e) => clone(e) as Element),
    notes: clone(s.notes),
  };
}

function snapshotLayout(l: YorkieLayout): Layout {
  return clone(l) as Layout;
}

function toYorkieSlide(s: SlidesDocument['slides'][number]): YorkieSlide {
  return {
    id: s.id,
    layoutId: s.layoutId,
    background: clone(s.background),
    elements: s.elements.map((e) => clone(e) as YorkieElement),
    notes: clone(s.notes),
  };
}
```

> Note: the `as never` casts on `r.slides = ...` and `s.elements = ...`
> are due to Yorkie's typing of array assignment inside `doc.update`.
> If a cleaner alternative emerges during implementation (e.g.
> `splice(0, length, ...next)`), prefer it.

- [ ] **Step 1.6: Run tests, confirm green**

Run: `pnpm --filter @wafflebase/frontend test src/app/slides/`
Expected: PASS — every YorkieSlidesStore test green.

- [ ] **Step 1.7: Commit**

```bash
git add packages/frontend/src/types/slides-document.ts packages/frontend/src/types/users.ts packages/frontend/src/app/slides
git commit -m "Add YorkieSlidesStore and SlidesPresence type" -m "Implements SlidesStore against a Yorkie Document so the existing
@wafflebase/slides editor surface works against real Yorkie. Each
mutation wraps doc.update; batch wraps multiple ops in one Yorkie
change AND captures a local snapshot for undo. Phase 4a stores text
element bodies and slide notes as plain Block[] JSON — Phase 5 will
migrate them to Yorkie.Tree alongside the docs IME bridge.

ensureSlidesRoot is idempotent: safe to call on every React mount.
The remote-change subscription fires the onRemoteChange callback the
React wrapper sets, so a peer's edit triggers a re-render without the
local store re-batching anything.

Refs docs/design/slides/slides.md 'Yorkie schema'."
```

---

## Task 2: SlidesView React wrapper + SlidesDetail page + presence

**Files:**
- Create: `packages/frontend/src/app/slides/slides-view.tsx`
- Create: `packages/frontend/src/app/slides/slides-detail.tsx`

`SlidesView` mirrors `DocsView`: `useDocument<YorkieSlidesRoot,
SlidesPresence>()`, mount the slides editor on a canvas + overlay
container, wire presence updates and peer cursors. `SlidesDetail`
mirrors `DocsDetail`: top-level page that fetches document metadata
and renders `<SlidesView documentId={...} />` inside a Yorkie
provider.

- [ ] **Step 2.1: Create `slides-view.tsx`**

```tsx
import {
  initializeEditor,
  mountThumbnailPanel,
  mountNotesPanel,
  type SlidesEditor,
  type InsertKind,
} from '@wafflebase/slides';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useDocument } from '@yorkie-js/react';
import { Loader } from '@/components/loader';
import type { YorkieSlidesRoot } from '@/types/slides-document';
import type { SlidesPresence } from '@/types/users';
import {
  YorkieSlidesStore,
  ensureSlidesRoot,
} from './yorkie-slides-store';

interface SlidesViewProps {
  documentId?: string;
  readOnly?: boolean;
  onEditorReady?: (editor: SlidesEditor | null) => void;
}

const HOST_W = 960;
const HOST_H = 540;

export function SlidesView({ readOnly, onEditorReady }: SlidesViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<SlidesEditor | null>(null);
  const [didMount, setDidMount] = useState(false);
  const { doc, loading, error } = useDocument<YorkieSlidesRoot, SlidesPresence>();

  useEffect(() => setDidMount(true), []);

  useEffect(() => {
    if (!didMount || !doc) return;
    const container = containerRef.current;
    if (!container) return;

    ensureSlidesRoot(doc);

    // Build the canvas + overlay DOM into the container.
    container.innerHTML = '';
    const dpr = window.devicePixelRatio || 1;

    const layout = document.createElement('div');
    layout.style.display = 'grid';
    layout.style.gridTemplateColumns = '220px 1fr';
    layout.style.gap = '12px';
    layout.style.padding = '12px';
    layout.style.boxSizing = 'border-box';
    layout.style.height = '100%';

    const left = document.createElement('div');
    left.style.overflowY = 'auto';
    const thumbsHost = document.createElement('div');
    left.appendChild(thumbsHost);
    layout.appendChild(left);

    const right = document.createElement('div');
    right.style.display = 'flex';
    right.style.flexDirection = 'column';
    right.style.gap = '12px';

    const canvasWrap = document.createElement('div');
    canvasWrap.style.position = 'relative';
    canvasWrap.style.alignSelf = 'flex-start';

    const canvas = document.createElement('canvas');
    canvas.width = HOST_W * dpr;
    canvas.height = HOST_H * dpr;
    canvas.style.width = `${HOST_W}px`;
    canvas.style.height = `${HOST_H}px`;
    canvas.style.background = '#fff';
    canvasWrap.appendChild(canvas);

    const overlay = document.createElement('div');
    overlay.style.position = 'absolute';
    overlay.style.left = '0';
    overlay.style.top = '0';
    overlay.style.width = `${HOST_W}px`;
    overlay.style.height = `${HOST_H}px`;
    overlay.style.pointerEvents = 'none';
    canvasWrap.appendChild(overlay);

    right.appendChild(canvasWrap);

    const notesHost = document.createElement('div');
    right.appendChild(notesHost);

    layout.appendChild(right);
    container.appendChild(layout);

    // Inject pointer-events for handles (overlay-level CSS).
    const style = document.createElement('style');
    style.textContent = '[data-handle] { pointer-events: auto !important; }';
    document.head.appendChild(style);

    const store = new YorkieSlidesStore(doc);
    const editor = initializeEditor({
      canvas, overlay, store,
      hostWidth: HOST_W, hostHeight: HOST_H, dpr,
    });
    editorRef.current = editor;
    onEditorReady?.(editor);

    const thumbHandle = mountThumbnailPanel(thumbsHost, store, editor);
    mountNotesPanel(notesHost, store, editor);

    // Re-render on remote change.
    store.onRemoteChange = () => {
      editor.render();
      thumbHandle.refresh();
    };

    // Local presence: broadcast active slide + selection.
    const offSelection = editor.onSelectionChange(() => {
      store.updatePresence({
        username: '', email: '', photo: '',
        activeSlideId: editor.getCurrentSlideId(),
        selectedElementIds: editor.getSelection().slice(),
      });
    });
    const offSlide = editor.onCurrentSlideChange(() => {
      store.updatePresence({
        username: '', email: '', photo: '',
        activeSlideId: editor.getCurrentSlideId(),
        selectedElementIds: editor.getSelection().slice(),
      });
    });

    // RAF loop so async asset loads + thumbnail refresh happen.
    let last = store.read().slides.length;
    let raf = 0;
    const tick = () => {
      editor.render();
      const n = store.read().slides.length;
      if (n !== last) { last = n; thumbHandle.refresh(); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      offSelection();
      offSlide();
      thumbHandle.dispose();
      editor.detach();
      editorRef.current = null;
      onEditorReady?.(null);
      style.remove();
    };
  }, [didMount, doc, readOnly, onEditorReady]);

  if (loading) return <Loader />;
  if (error) return <div style={{ padding: 24 }}>Failed to load slides: {String(error)}</div>;
  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}

export default SlidesView;
```

> The hand-built DOM scaffolding (canvas + overlay + thumbs + notes
> hosts) is verbose because the slides editor is vanilla DOM. A future
> refactor could move this into a small `useEditorMount` hook; for
> Phase 4a inline is fine.

- [ ] **Step 2.2: Create `slides-detail.tsx`**

Mirror `packages/frontend/src/app/docs/docs-detail.tsx` structure.
The page:
- Uses `useParams` to get the document id.
- Wraps `<SlidesView />` in `<DocumentProvider>` from `@yorkie-js/react`.
- Provides initial root via `() => ({ meta: {...}, slides: [], layouts: [] })`.

```tsx
import { lazy, Suspense, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DocumentProvider } from '@yorkie-js/react';
import { Loader } from '@/components/loader';
import { useAuth } from '@/hooks/use-auth';
import { fetchDocument } from '@/api/documents';

const SlidesView = lazy(() => import('./slides-view'));

export function SlidesDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [docMeta, setDocMeta] = useState<{ workspaceId: string; title: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    fetchDocument(id)
      .then((d) => setDocMeta({ workspaceId: d.workspaceId, title: d.title }))
      .catch((e) => setError(String(e)));
  }, [id]);

  if (error) return <div style={{ padding: 24 }}>Could not load slides: {error}</div>;
  if (!id || !docMeta) return <Loader />;

  return (
    <DocumentProvider
      docKey={id}
      initialPresence={{
        username: user?.username ?? '',
        email: user?.email ?? '',
        photo: user?.photo ?? '',
      }}
    >
      <Suspense fallback={<Loader />}>
        <SlidesView documentId={id} />
      </Suspense>
    </DocumentProvider>
  );
}

export default SlidesDetail;
```

> The exact import paths for `useAuth`, `fetchDocument`, `Loader`,
> `DocumentProvider` may differ slightly from what the codebase uses
> today — match the existing `docs-detail.tsx` shape. Read that file
> as the reference; `slides-detail.tsx` is its near-verbatim sibling.

- [ ] **Step 2.3: Verify typecheck**

Run: `pnpm --filter @wafflebase/frontend typecheck`
Expected: exit 0.

- [ ] **Step 2.4: Commit**

```bash
git add packages/frontend/src/app/slides/slides-view.tsx packages/frontend/src/app/slides/slides-detail.tsx
git commit -m "Add SlidesView React wrapper and SlidesDetail page" -m "SlidesView mirrors DocsView: useDocument hook from @yorkie-js/react,
useEffect mount, hand-built canvas + overlay + thumbnail + notes DOM
hosts that the vanilla slides editor mounts onto. Presence updates
fire on selection and current-slide changes; the RAF tick handles
async asset loads (image cache) and thumbnail refresh after store
mutations.

SlidesDetail mirrors DocsDetail: route entry that wraps SlidesView in
a Yorkie DocumentProvider keyed by the document id. Document metadata
comes from the existing fetchDocument API; no new backend endpoints.

Refs docs/design/slides/slides.md 'Frontend integration'."
```

---

## Task 3: Backend SlidesDocument type

**Files:**
- Modify: `packages/backend/src/yorkie/yorkie.types.ts`

The backend type is a thin re-export so consumers (Yorkie service,
share-link handlers, CLI export) can refer to `SlidesDocument`
symbolically. The runtime shape is whatever the frontend stores.

- [ ] **Step 3.1: Add SlidesDocument re-export**

In `packages/backend/src/yorkie/yorkie.types.ts`, append after the
existing `DocsDocument` re-exports:

```ts
// Slides Yorkie document — frontend stores YorkieSlidesRoot under
// this key, but the canonical type the backend reasons about is the
// snapshot shape from @wafflebase/slides.
export type {
  SlidesDocument,
  Slide as SlidesSlide,
  Element as SlidesElement,
  TextElement as SlidesTextElement,
  ImageElement as SlidesImageElement,
  ShapeElement as SlidesShapeElement,
  Layout as SlidesLayout,
} from '@wafflebase/slides';
```

- [ ] **Step 3.2: Verify backend typecheck**

Run: `pnpm --filter @wafflebase/backend typecheck` (or the equivalent
build command — backend uses Nest, check `package.json`).
Expected: exit 0.

- [ ] **Step 3.3: Commit**

```bash
git add packages/backend/src/yorkie/yorkie.types.ts
git commit -m "Re-export SlidesDocument and friends from backend Yorkie types" -m "Adds the slides snapshot types alongside the existing
SpreadsheetDocument and DocsDocument re-exports so backend consumers
(Yorkie service, future share-link handlers, CLI export) refer to the
slides shape symbolically. Pure re-exports — no behaviour change."
```

---

## Task 4: DocumentType + routing + creation

**Files:**
- Modify: `packages/frontend/src/types/documents.ts`
- Modify: `packages/frontend/src/App.tsx`
- Modify: `packages/frontend/src/app/documents/document-list.tsx`
- Modify: any `createDocument` flow that gates on `type` (typically a
  dropdown in the documents list "+ New" menu)

- [ ] **Step 4.1: Extend `DocumentType`**

```ts
export type DocumentType = "sheet" | "doc" | "slides";
```

- [ ] **Step 4.2: Add `/p/:id` route in App.tsx**

After the existing `<Route path="/d/:id" element={<DocsDetail />} />`:

```tsx
const SlidesDetail = lazy(() => import("@/app/slides/slides-detail"));
// ...
<Route path="/p/:id" element={<SlidesDetail />} />
```

- [ ] **Step 4.3: Update document-list.tsx link helper**

```ts
function detailHrefFor(doc: Document): string {
  switch (doc.type) {
    case 'doc': return `/d/${doc.id}`;
    case 'slides': return `/p/${doc.id}`;
    case 'sheet': return `/s/${doc.id}`;
  }
}
```

(Replace the existing ternary at line 78.)

- [ ] **Step 4.4: Add a "New presentation" entry to the create-document UI**

Find the "+ New" menu in `document-list.tsx` (it currently offers
"Spreadsheet" and "Document"). Add:

```tsx
<DropdownMenuItem onClick={() => createDocument({ type: 'slides', title: 'Untitled presentation' })}>
  Presentation
</DropdownMenuItem>
```

(The exact MenuItem component name depends on what the existing items
use — match them.)

- [ ] **Step 4.5: Backend creation endpoint accepts `type: 'slides'`**

If `packages/backend/src/document/document.controller.ts` (or wherever
document creation lives) gates the type, add `'slides'` to the allowed
values. Most likely the existing code is a free-form string pass
through (`type: body.type ?? 'sheet'`); confirm and adjust.

- [ ] **Step 4.6: Verify typecheck + tests**

Run: `pnpm --filter @wafflebase/frontend typecheck && pnpm --filter @wafflebase/frontend test`
Expected: exit 0 both.

- [ ] **Step 4.7: Commit**

```bash
git add packages/frontend/src/types/documents.ts packages/frontend/src/App.tsx packages/frontend/src/app/documents/document-list.tsx packages/backend/src/document
git commit -m "Add 'slides' DocumentType, route, and create entry" -m "DocumentType union grows to 'sheet' | 'doc' | 'slides'. App.tsx
adds /p/:id → SlidesDetail. document-list.tsx routes to /p/... for
slides documents and offers Presentation in the + New menu. Backend
creation accepts the new type unchanged (string pass-through).

Refs docs/design/slides/slides.md 'Integration points'."
```

---

## Task 5: Final verify + smoke test

**Files:**
- Modify: `docs/tasks/active/20260505-slides-package-mvp-todo.md`

- [ ] **Step 5.1: Run `pnpm verify:fast`**

Expected: exit 0.

- [ ] **Step 5.2: Smoke test (optional but recommended)**

In two terminals:
```bash
docker compose up -d                  # Postgres + Yorkie
pnpm dev                              # Frontend (:5173) + backend (:3000)
```

Visit http://localhost:5173, log in, create a Presentation document
via the + New menu, navigate to /p/{id}, verify the editor mounts and
basic operations (add slide, drag shape, undo) work.

If you don't have a working dev environment, skip this step and rely
on `verify:fast` + browser-side debugging in a follow-up session.

- [ ] **Step 5.3: Tick Phase 4a items in the high-level todo**

In `docs/tasks/active/20260505-slides-package-mvp-todo.md`, mark
4.1, 4.3, 4.4, 4.5, 4.6, 4.7 as `[x]`. Items 4.2, 4.8, 4.9 are
Phase 4b — leave them unchecked.

- [ ] **Step 5.4: Commit**

```bash
git add docs/tasks/active/20260505-slides-package-mvp-todo.md
git commit -m "Tick Phase 4a checklist items" -m "Items 4.1, 4.3-4.7 ticked. 4.2 (equivalence), 4.8 (two-user), 4.9
(verify:integration) are Phase 4b — they need a running Yorkie server
+ Postgres and live in a separate test lane."
```

---

## Phase 4a Done

After Task 5:

- `pnpm verify:fast` is green.
- A user can create a Presentation document from the documents UI and
  edit it at `/p/:id` with the existing Phase 3 editor surface,
  backed by Yorkie.
- Backend recognises the new `SlidesDocument` Yorkie type symbolically.
- Phase 3 demo (`pnpm slides dev`) continues to work (no regressions).

Phase 4b (equivalence tests, two-user concurrency, integration lane)
gets its own plan when this lands.
