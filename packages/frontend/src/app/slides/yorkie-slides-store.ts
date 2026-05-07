import type { Document as YorkieDocument } from '@yorkie-js/sdk';
import {
  DEFAULT_MASTER,
  type Background,
  type ElementInit,
  type Frame,
  type Layout,
  type Master,
  type SlidesDocument,
  type SlidesStore,
  type Theme,
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
  YorkiePlaceholder,
} from '@/types/slides-document';

/**
 * Inline placeholder theme so the Yorkie-backed store can hand back a
 * well-formed `SlidesDocument` (with `themes`, `masters`,
 * `meta.themeId`, `meta.masterId`) before the real theme module is
 * shipped. Mirrors `MemSlidesStore`'s placeholder so both stores
 * resolve theme colors identically. Task 5 deletes this in favour of
 * importing `defaultLight` from `@wafflebase/slides/themes/default-light`.
 */
const PLACEHOLDER_DEFAULT_LIGHT: Theme = {
  id: 'default-light',
  name: 'Simple Light',
  colors: {
    text: '#202124',
    background: '#FFFFFF',
    textSecondary: '#5F6368',
    backgroundAlt: '#F1F3F4',
    accent1: '#1A73E8',
    accent2: '#34A853',
    accent3: '#FBBC04',
    accent4: '#EA4335',
    accent5: '#673AB7',
    accent6: '#FF6D01',
    hyperlink: '#1A73E8',
    visitedHyperlink: '#7B1FA2',
  },
  fonts: { heading: 'Inter', body: 'Inter' },
};

const DEFAULT_BACKGROUND: YorkieSlide['background'] = {
  fill: { kind: 'role', role: 'background' },
};

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

// ---------------------------------------------------------------------------
// ensureSlidesRoot — initialise the Yorkie root with the slides shape. Safe
// to call on every mount.
//
// Phase 5a originally migrated text-element bodies + slide notes to
// `yorkie.Tree`, but Yorkie.Tree does NOT register correctly when nested
// inside an array element (it's serialized to its initial JSON shape and
// loses CRDT semantics). The migration was reverted; bodies/notes are now
// stored as plain `Block[]` JSON. Concurrent edits resolve as last-write-
// wins on commit (blur). Per-keystroke convergence will be revisited in
// Phase 5a-2 with a root-level Tree map keyed by element id.
// ---------------------------------------------------------------------------

/**
 * Idempotently initialise the Yorkie root with the slides shape.
 * Safe to call on every mount; existing slides/layouts are preserved.
 *
 * For pre-existing slides we ensure each slide's `notes` field is an
 * array (defaulting to `[]` if missing) and each text element's
 * `data.blocks` is an array (defaulting to `[]` if missing). No Tree
 * creation here.
 */
export function ensureSlidesRoot(
  doc: YorkieDocument<YorkieSlidesRoot>,
): void {
  const root = doc.getRoot();
  const needsRoot = root.meta == null || root.slides == null || root.layouts == null;
  if (needsRoot) {
    doc.update((r) => {
      if (r.meta == null) {
        r.meta = {
          title: 'Untitled presentation',
          themeId: 'default-light',
          masterId: 'default',
        };
      }
      if (r.slides == null) r.slides = [];
      if (r.layouts == null) {
        r.layouts = clone(BUILT_IN_LAYOUTS) as YorkieLayout[];
      }
    });
  }
  // Backfill optional theme fields on pre-v0.5 documents. Task 3
  // ships the proper migration; this is the minimum to keep the
  // SlidesDocument well-formed.
  doc.update((r) => {
    const meta = r.meta as { themeId?: string; masterId?: string };
    if (meta.themeId == null) meta.themeId = 'default-light';
    if (meta.masterId == null) meta.masterId = 'default';
    const rootAny = r as { themes?: Theme[]; masters?: Master[] };
    if (rootAny.themes == null) {
      rootAny.themes = [clone(PLACEHOLDER_DEFAULT_LIGHT)];
    }
    if (rootAny.masters == null) {
      rootAny.masters = [clone(DEFAULT_MASTER)];
    }
    for (const slide of r.slides) {
      const notes = (slide as { notes?: unknown }).notes;
      if (!Array.isArray(yorkieToPlain<unknown>(notes))) {
        slide.notes = [] as unknown as YorkieSlide['notes'];
      }
      for (const el of slide.elements) {
        if (el.type === 'text') {
          const data = el.data as { blocks?: unknown };
          const blocks = yorkieToPlain<unknown>(data.blocks);
          if (!Array.isArray(blocks)) {
            el.data = { blocks: [] } as unknown as typeof el.data;
          }
        }
      }
    }
  });
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
  /**
   * @deprecated Use `onChange` instead. Kept for one release for any
   * older callers; will be removed once Phase 5 lands.
   */
  onRemoteChange?: () => void;

  private doc: YorkieDocument<YorkieSlidesRoot>;
  private undoStack: SlidesDocument[] = [];
  private redoStack: SlidesDocument[] = [];
  private batchDepth = 0;
  private changeListeners = new Set<() => void>();
  private unsubscribeDoc: (() => void) | undefined;

  constructor(doc: YorkieDocument<YorkieSlidesRoot>) {
    this.doc = doc;
    // Capture the unsubscribe handle so we can detach when the store
    // is disposed. Without this, every test/route that builds a fresh
    // YorkieSlidesStore for the same Yorkie document leaks one
    // subscription per construction; remote-change events then fire
    // notifyChange() on every stale instance still in memory.
    this.unsubscribeDoc = doc.subscribe((e) => {
      if (e.type === 'remote-change') {
        this.onRemoteChange?.();
        this.notifyChange();
      }
    });
  }

  /**
   * Detach from the underlying Yorkie document. Idempotent. The store
   * itself remains queryable but stops firing change notifications.
   */
  dispose(): void {
    this.unsubscribeDoc?.();
    this.unsubscribeDoc = undefined;
  }

  /**
   * Subscribe to ANY change to the document — local batch commits OR
   * remote changes pushed in by another peer. Unlike `onRemoteChange`,
   * fires for local mutations too, so consumers like the React wrapper
   * can refresh thumbnails after a drag/resize/rotate commit without
   * polling.
   */
  onChange(cb: () => void): () => void {
    this.changeListeners.add(cb);
    return () => { this.changeListeners.delete(cb); };
  }

  private notifyChange(): void {
    for (const cb of this.changeListeners) {
      try { cb(); } catch { /* swallow listener errors */ }
    }
  }

  // --- read ---

  /**
   * O(1) accessor for the slide count. Used by the SlidesView RAF tick
   * to decide whether the thumbnail panel needs a refresh — we don't
   * want to call `read()` (which JSON-clones the entire presentation)
   * 60 times per second just to compare an integer.
   */
  getSlideCount(): number {
    const root = this.doc.getRoot() as { slides?: { length?: number } };
    return root.slides?.length ?? 0;
  }

  read(): SlidesDocument {
    const root = this.doc.getRoot();
    const meta = yorkieToPlain<{
      title: string;
      themeId?: string;
      masterId?: string;
    }>(root.meta) ?? { title: 'Untitled presentation' };
    const slides = (root.slides ?? []).map((s) => {
      const id = (s as { id: string }).id;
      const layoutId = (s as { layoutId: string }).layoutId;
      const background = yorkieToPlain<SlidesDocument['slides'][number]['background']>((s as { background: unknown }).background);
      const elements = ((s as { elements: unknown[] }).elements ?? []).map((e) => {
        const el = e as { id: string; type: string; frame: unknown; data: unknown };
        if (el.type === 'text') {
          const blocks = yorkieToPlain<Block[]>((el.data as { blocks?: unknown }).blocks) ?? [];
          return {
            id: el.id,
            type: 'text',
            frame: yorkieToPlain<Frame>(el.frame),
            data: { blocks },
          };
        }
        return {
          id: el.id,
          type: el.type,
          frame: yorkieToPlain<Frame>(el.frame),
          data: yorkieToPlain<object>(el.data),
        };
      }) as SlidesDocument['slides'][number]['elements'];
      const notes = yorkieToPlain<Block[]>((s as { notes: unknown }).notes) ?? [];
      return {
        id,
        layoutId,
        background,
        elements,
        notes,
      } as SlidesDocument['slides'][number];
    });
    const layouts = (root.layouts ?? []).map((l) =>
      yorkieToPlain<Layout>(l),
    );
    const rootAny = root as { themes?: unknown; masters?: unknown };
    const themesRaw = yorkieToPlain<Theme[]>(rootAny.themes);
    const themes = Array.isArray(themesRaw) && themesRaw.length > 0
      ? themesRaw
      : [clone(PLACEHOLDER_DEFAULT_LIGHT)];
    const mastersRaw = yorkieToPlain<Master[]>(rootAny.masters);
    const masters = Array.isArray(mastersRaw) && mastersRaw.length > 0
      ? mastersRaw
      : [clone(DEFAULT_MASTER)];
    return {
      meta: {
        title: meta.title ?? 'Untitled presentation',
        themeId: meta.themeId ?? 'default-light',
        masterId: meta.masterId ?? 'default',
      },
      themes,
      masters,
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
      if (this.batchDepth === 0) {
        this.notifyChange();
      }
    }
  }

  undo(): void {
    if (!this.canUndo()) return;
    const snapshot = this.undoStack.pop()!;
    this.redoStack.push(this.read());
    this.replaceRoot(snapshot);
    this.notifyChange();
  }

  redo(): void {
    if (!this.canRedo()) return;
    const snapshot = this.redoStack.pop()!;
    this.undoStack.push(this.read());
    this.replaceRoot(snapshot);
    this.notifyChange();
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
      // Themes/masters are part of the snapshot too — undo of an op that
      // touches them needs them mirrored here. Until Task 5 ships the
      // theme-edit ops these arrays don't change, but writing them keeps
      // the Yorkie root consistent with the cloned snapshot.
      const rootAny = r as { themes?: Theme[]; masters?: Master[] };
      rootAny.themes = clone(snapshot.themes);
      rootAny.masters = clone(snapshot.masters);
      const nextSlides: YorkieSlide[] = snapshot.slides.map((s) => ({
        id: s.id,
        layoutId: s.layoutId,
        background: clone(s.background),
        elements: s.elements.map((e) => {
          if (e.type === 'text') {
            return {
              id: e.id,
              type: 'text',
              frame: { ...e.frame },
              data: { blocks: clone(e.data.blocks ?? []) },
            } as YorkieElement;
          }
          return clone(e) as YorkieElement;
        }),
        notes: clone(s.notes ?? []),
      }));
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
    this.doc.update((r) => {
      const elements: YorkieElement[] = layout.placeholders.map((p) => {
        const placeholder = clone(p) as YorkiePlaceholder;
        const elementId = generateId();
        if (placeholder.type === 'text') {
          const blocks = (placeholder.data as { blocks?: Block[] }).blocks ?? [];
          return {
            id: elementId,
            type: 'text',
            frame: placeholder.frame,
            data: { blocks: clone(blocks) },
          } as YorkieElement;
        }
        return {
          id: elementId,
          type: placeholder.type,
          frame: placeholder.frame,
          data: placeholder.data,
        } as YorkieElement;
      });
      const slide: YorkieSlide = {
        id,
        layoutId: layout.id,
        background: { ...DEFAULT_BACKGROUND },
        elements,
        notes: [],
      };
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
      const src = r.slides[idx];
      const sourceBackground = yorkieToPlain<YorkieSlide['background']>((src as { background: unknown }).background);
      const sourceLayoutId = (src as { layoutId: string }).layoutId;
      const sourceElements = ((src as { elements: unknown[] }).elements ?? []).map((e) => {
        const el = e as { type: string; frame: unknown; data: unknown };
        if (el.type === 'text') {
          const blocks = yorkieToPlain<Block[]>((el.data as { blocks?: unknown }).blocks) ?? [];
          return {
            id: generateId(),
            type: 'text',
            frame: yorkieToPlain<Frame>(el.frame),
            data: { blocks: clone(blocks) },
          } as YorkieElement;
        }
        return {
          id: generateId(),
          type: el.type as 'image' | 'shape',
          frame: yorkieToPlain<Frame>(el.frame),
          data: yorkieToPlain<object>(el.data),
        } as YorkieElement;
      });
      const sourceNotes = yorkieToPlain<Block[]>((src as { notes: unknown }).notes) ?? [];
      const newSlide: YorkieSlide = {
        id: newId,
        layoutId: sourceLayoutId,
        background: sourceBackground,
        elements: sourceElements,
        notes: clone(sourceNotes),
      };
      r.slides.splice(idx + 1, 0, newSlide);
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
      // Move requires reconstructing the slide because the proxy returned
      // by splice can't be re-inserted directly.
      const moved = this.rebuildSlide(r.slides[from]);
      r.slides.splice(from, 1);
      const clamped = Math.max(0, Math.min(toIndex, r.slides.length));
      r.slides.splice(clamped, 0, moved);
    });
  }

  moveSlides(slideIds: string[], toIndex: number): void {
    this.requireBatch();
    const set = new Set(slideIds);
    this.doc.update((r) => {
      const moving: YorkieSlide[] = [];
      const remaining: YorkieSlide[] = [];
      for (const s of r.slides) {
        const rebuilt = this.rebuildSlide(s);
        if (set.has(s.id)) moving.push(rebuilt);
        else remaining.push(rebuilt);
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

  /**
   * Read a YorkieSlide proxy and return a fully-detached copy. Used by
   * reorder / move paths where we must remove and re-insert a slide;
   * Yorkie array splices can't safely shuffle proxies.
   */
  private rebuildSlide(src: YorkieSlide): YorkieSlide {
    const background = yorkieToPlain<YorkieSlide['background']>((src as { background: unknown }).background);
    const layoutId = (src as { layoutId: string }).layoutId;
    const id = (src as { id: string }).id;
    const elements = ((src as { elements: unknown[] }).elements ?? []).map((e) => {
      const el = e as { id: string; type: string; frame: unknown; data: unknown };
      if (el.type === 'text') {
        const blocks = yorkieToPlain<Block[]>((el.data as { blocks?: unknown }).blocks) ?? [];
        return {
          id: el.id,
          type: 'text',
          frame: yorkieToPlain<Frame>(el.frame),
          data: { blocks: clone(blocks) },
        } as YorkieElement;
      }
      return {
        id: el.id,
        type: el.type as 'image' | 'shape',
        frame: yorkieToPlain<Frame>(el.frame),
        data: yorkieToPlain<object>(el.data),
      } as YorkieElement;
    });
    const notes = yorkieToPlain<Block[]>((src as { notes: unknown }).notes) ?? [];
    return {
      id,
      layoutId,
      background,
      elements,
      notes: clone(notes),
    };
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
          const cloned = clone(placeholder) as YorkiePlaceholder;
          if (cloned.type === 'text') {
            const blocks = (cloned.data as { blocks?: Block[] }).blocks ?? [];
            s.elements.push({
              id: generateId(),
              type: 'text',
              frame: cloned.frame,
              data: { blocks: clone(blocks) },
            } as YorkieElement);
          } else {
            s.elements.push({
              id: generateId(),
              type: cloned.type,
              frame: cloned.frame,
              data: cloned.data,
            } as YorkieElement);
          }
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
      if (init.type === 'text') {
        const blocks = (init.data as { blocks?: Block[] }).blocks ?? [];
        s.elements.push({
          id,
          type: 'text',
          frame: { ...init.frame },
          data: { blocks: clone(blocks) },
        } as YorkieElement);
      } else {
        s.elements.push({ ...clone(init), id } as YorkieElement);
      }
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
      // For text elements, text content goes through `withTextElement`; we
      // ignore any `blocks` field in the patch to avoid clobbering.
      if (e.type === 'text') {
        const safe = { ...(patch as object) } as Record<string, unknown>;
        delete safe.blocks;
        if (Object.keys(safe).length === 0) return;
        e.data = { ...(e.data as object), ...clone(safe) } as typeof e.data;
        return;
      }
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
      // Rebuild the element so its data is detached from the proxy —
      // safer to re-insert into the Yorkie array.
      const src = s.elements[from];
      let rebuilt: YorkieElement;
      if (src.type === 'text') {
        const blocks = yorkieToPlain<Block[]>((src.data as { blocks?: unknown }).blocks) ?? [];
        rebuilt = {
          id: src.id,
          type: 'text',
          frame: yorkieToPlain<Frame>((src as { frame: unknown }).frame),
          data: { blocks: clone(blocks) },
        } as YorkieElement;
      } else {
        rebuilt = {
          id: src.id,
          type: src.type,
          frame: yorkieToPlain<Frame>((src as { frame: unknown }).frame),
          data: yorkieToPlain<object>((src as { data: unknown }).data),
        } as YorkieElement;
      }
      s.elements.splice(from, 1);
      const clamped = Math.max(0, Math.min(toIndex, s.elements.length));
      s.elements.splice(clamped, 0, rebuilt);
    });
  }

  // --- text bridges ---
  //
  // Text bodies and notes are stored as plain `Block[]` JSON. The
  // Block[]-callback API is preserved so existing wiring (text-box-editor
  // → onCommit(blocks)) doesn't change. Concurrent edits resolve as
  // last-write-wins on commit (blur).

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
      const blocks = yorkieToPlain<Block[]>((e.data as { blocks?: unknown }).blocks) ?? [];
      const next = fn(blocks);
      // Always write back. `yorkieToPlain` returns a plain JSON copy
      // (Yorkie proxies don't expose live nested values for non-CRDT
      // fields), so a void-returning `fn` that mutates `blocks` in
      // place would otherwise have no effect — diverging from
      // MemSlidesStore where the callback receives the live reference.
      // `next ?? blocks` covers both the explicit-return path and the
      // void-mutation path with one assignment.
      e.data = { blocks: clone(next ?? blocks) } as unknown as typeof e.data;
    });
  }

  withNotes(slideId: string, fn: (blocks: Block[]) => Block[] | void): void {
    this.requireBatch();
    this.doc.update((r) => {
      const s = r.slides.find((s) => s.id === slideId);
      if (!s) throw new Error(`Slide not found: ${slideId}`);
      const blocks = yorkieToPlain<Block[]>((s as { notes: unknown }).notes) ?? [];
      const next = fn(blocks);
      // Same rationale as withTextElement above — write back regardless
      // of whether `fn` returned a value or mutated in place.
      s.notes = clone(next ?? blocks) as unknown as YorkieSlide['notes'];
    });
  }

  // --- presence ---

  updatePresence(presence: Partial<SlidesPresence>): void {
    // Yorkie's Presence.set takes a Partial<P> and MERGES — it does not
    // replace. So callers should pass ONLY the fields they want to
    // update, not the full presence shape with placeholder values.
    // Filling identity fields (username/email/photo) with empty strings
    // here would silently clobber the values the SlidesDetail wrapper
    // seeded via `initialPresence`, making the user appear anonymous to
    // peers after the first selection / slide change.
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
