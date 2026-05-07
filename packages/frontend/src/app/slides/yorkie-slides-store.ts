import type { Document as YorkieDocument } from '@yorkie-js/sdk';
import {
  type Background,
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

type YorkieLayout = YorkieSlidesRoot['layouts'][number];

/**
 * Plain-value deep clone via JSON. Use for snapshot values, init payloads,
 * and any other plain-JS objects. Do NOT pass a Yorkie proxy directly: its
 * `toJSON()` returns a string, which causes JSON.stringify to double-encode.
 * Use `yorkieToPlain` for Yorkie proxies instead.
 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Convert a Yorkie object/array proxy to a plain JS value. Yorkie proxies
 * implement `toJSON()` that returns a JSON string (not a plain object), so
 * we parse it back. Returns the input unchanged when it doesn't have the
 * Yorkie `toJSON` shape (e.g. plain primitives).
 */
function yorkieToPlain<T>(value: unknown): T {
  if (value && typeof value === 'object') {
    const maybeJson = (value as { toJSON?: () => string }).toJSON;
    if (typeof maybeJson === 'function') {
      const str = maybeJson.call(value);
      if (typeof str === 'string') {
        return JSON.parse(str) as T;
      }
    }
  }
  return value as T;
}

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
      if (r.layouts == null) {
        r.layouts = clone(BUILT_IN_LAYOUTS) as YorkieLayout[];
      }
    });
  }
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

  private doc: YorkieDocument<YorkieSlidesRoot>;
  private undoStack: SlidesDocument[] = [];
  private redoStack: SlidesDocument[] = [];
  private batchDepth = 0;

  constructor(doc: YorkieDocument<YorkieSlidesRoot>) {
    this.doc = doc;
    doc.subscribe((e) => {
      if (e.type === 'remote-change') {
        this.onRemoteChange?.();
      }
    });
  }

  // --- read ---

  read(): SlidesDocument {
    const root = this.doc.getRoot();
    const meta = yorkieToPlain<{ title: string }>(root.meta) ?? {
      title: 'Untitled presentation',
    };
    const slides = (root.slides ?? []).map((s) =>
      yorkieToPlain<SlidesDocument['slides'][number]>(s),
    );
    const layouts = (root.layouts ?? []).map((l) =>
      yorkieToPlain<Layout>(l),
    );
    return {
      meta: { title: meta.title ?? 'Untitled presentation' },
      slides,
      layouts,
    };
  }

  // --- batch + undo ---

  batch(fn: () => void): void {
    if (this.batchDepth === 0) {
      this.undoStack.push(this.read());
      this.redoStack = [];
    }
    this.batchDepth++;
    try {
      fn();
    } finally {
      this.batchDepth--;
    }
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

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  private replaceRoot(snapshot: SlidesDocument): void {
    this.doc.update((r) => {
      r.meta = clone(snapshot.meta);
      const nextSlides = snapshot.slides.map(toYorkieSlide);
      r.slides.splice(0, r.slides.length, ...(nextSlides as never[]));
      const nextLayouts = clone(snapshot.layouts) as YorkieLayout[];
      r.layouts.splice(0, r.layouts.length, ...(nextLayouts as never[]));
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
      elements: layout.placeholders.map(
        (p) =>
          ({
            ...clone(p),
            id: generateId(),
          }) as YorkieElement,
      ),
      notes: [],
    };
    this.doc.update((r) => {
      const insertAt =
        atIndex == null
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
      // Convert via toJSON; plain spread on a Yorkie proxy keeps proxy refs.
      const source = yorkieToPlain<YorkieSlide>(r.slides[idx]);
      source.id = newId;
      source.elements = source.elements.map((e) => ({
        ...e,
        id: generateId(),
      }));
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
      // Splice from the end so indices stay valid as we go.
      for (let i = r.slides.length - 1; i >= 0; i--) {
        if (set.has(r.slides[i].id)) r.slides.splice(i, 1);
      }
    });
  }

  moveSlide(slideId: string, toIndex: number): void {
    this.requireBatch();
    this.doc.update((r) => {
      const from = r.slides.findIndex((s) => s.id === slideId);
      if (from === -1) throw new Error(`Slide not found: ${slideId}`);
      // Capture a plain-JS copy BEFORE splicing, since the proxy returned
      // by splice can't be safely re-inserted.
      const plain = yorkieToPlain<YorkieSlide>(r.slides[from]);
      r.slides.splice(from, 1);
      const clamped = Math.max(0, Math.min(toIndex, r.slides.length));
      r.slides.splice(clamped, 0, plain);
    });
  }

  moveSlides(slideIds: string[], toIndex: number): void {
    this.requireBatch();
    const set = new Set(slideIds);
    this.doc.update((r) => {
      // Snapshot moving set as plain JS BEFORE we mutate the array.
      const moving: YorkieSlide[] = [];
      const remaining: YorkieSlide[] = [];
      for (const s of r.slides) {
        if (set.has(s.id)) moving.push(yorkieToPlain<YorkieSlide>(s));
        else remaining.push(yorkieToPlain<YorkieSlide>(s));
      }
      const clamped = Math.max(0, Math.min(toIndex, remaining.length));
      const next = [
        ...remaining.slice(0, clamped),
        ...moving,
        ...remaining.slice(clamped),
      ];
      r.slides.splice(0, r.slides.length, ...(next as never[]));
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
          (e) =>
            e.type === placeholder.type &&
            e.frame.x === placeholder.frame.x &&
            e.frame.y === placeholder.frame.y,
        );
        if (!matches) {
          s.elements.push({
            ...clone(placeholder),
            id: generateId(),
          } as YorkieElement);
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
      for (let i = s.elements.length - 1; i >= 0; i--) {
        if (set.has(s.elements[i].id)) s.elements.splice(i, 1);
      }
    });
  }

  updateElementFrame(
    slideId: string,
    elementId: string,
    frame: Partial<Frame>,
  ): void {
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
      // Capture as plain JS BEFORE splicing — the proxy returned by splice
      // can't be safely re-inserted into a Yorkie array.
      const plain = yorkieToPlain<YorkieElement>(s.elements[from]);
      s.elements.splice(from, 1);
      const clamped = Math.max(0, Math.min(toIndex, s.elements.length));
      s.elements.splice(clamped, 0, plain);
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
      const blocks = yorkieToPlain<Block[]>(e.data.blocks);
      const next = fn(blocks);
      if (next !== undefined) e.data.blocks = clone(next);
    });
  }

  withNotes(slideId: string, fn: (blocks: Block[]) => Block[] | void): void {
    this.requireBatch();
    this.doc.update((r) => {
      const s = r.slides.find((s) => s.id === slideId);
      if (!s) throw new Error(`Slide not found: ${slideId}`);
      const notes = yorkieToPlain<Block[]>(s.notes);
      const next = fn(notes);
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

function toYorkieSlide(s: SlidesDocument['slides'][number]): YorkieSlide {
  return {
    id: s.id,
    layoutId: s.layoutId,
    background: clone(s.background),
    elements: s.elements.map((e) => clone(e) as YorkieElement),
    notes: clone(s.notes),
  };
}
