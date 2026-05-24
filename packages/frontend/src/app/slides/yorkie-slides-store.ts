import type { Document as YorkieDocument } from '@yorkie-js/sdk';
import {
  DEFAULT_BACKGROUND as MODEL_DEFAULT_BACKGROUND,
  DEFAULT_MASTER,
  type ArrowheadStyle,
  type Background,
  type ConnectorElement,
  type Element as ModelElement,
  type ElementInit,
  type Endpoint,
  type Frame,
  type GroupElement,
  type GroupTransform,
  type Layout,
  type Master,
  type PlaceholderRef,
  type Slide as ModelSlide,
  type SlidesDocument,
  type SlidesStore,
  type Stroke,
  type TextElement,
  type Theme,
  BUILT_IN_LAYOUTS,
  IDENTITY_GROUP_TRANSFORM,
  applyGroupTransform,
  applyGroupTransformMatrix,
  applyGroupTransformToPoint,
  applyInverseMatrix,
  applyInversePoint,
  applyLayoutToSlide,
  composeAncestorTransform,
  computeConnectorFrame,
  defaultLight,
  generateId,
  getLayout,
  groupToTransform,
  migrateDocument,
  normalizeToGroupLocal,
  resolveEndpoint,
  seedPlaceholderBlocks,
  slotRefsForLayout,
  worldTightFrame,
} from '@wafflebase/slides';
import type { Block } from '@wafflebase/docs';
import type { SlidesPresence } from '@/types/users';
import type {
  YorkieElement,
  YorkieGroupElement,
  YorkieSlide,
  YorkieSlidesRoot,
  YorkiePlaceholder,
} from '@/types/slides-document';

/**
 * YorkieElements array as seen inside a doc.update callback. The Yorkie
 * proxy exposes the same JS array-like interface (push, splice, find,
 * findIndex, iteration) as a plain Element[], but its items are proxies
 * rather than plain objects. We use `unknown[]` here because the exact
 * proxy type is not exposed by the SDK.
 */
type ProxyArray = { id: string; type: string; data?: unknown; [k: string]: unknown }[];

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
 * Reject `NaN` / `Infinity` before they reach the Yorkie root. The
 * snap engine's `Math.abs(diff)` and the overlay's
 * `position * scale` math both propagate `NaN` silently, so a bad
 * value committed here would surface as a hard-to-diagnose
 * downstream artifact rather than a clear error.
 */
function assertFiniteGuidePosition(op: string, position: number): void {
  if (!Number.isFinite(position)) {
    throw new Error(`${op}: position must be a finite number, got ${position}`);
  }
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
 * Fully unwrap a Yorkie element proxy into a plain object preserving every
 * field. Connectors store endpoints / arrowheads / routing / stroke as
 * top-level fields (no `data` sub-object), so the previous shape-only
 * rebuild paths dropped them. This helper unwraps the entire element via
 * `yorkieToPlain` in one shot, which is correct for every element kind:
 * text/image/shape all have `id` + `type` + `frame` + `data`; connectors
 * have `id` + `type` + `frame` + `routing` + `start` + `end` + `arrowheads`
 * + optional `stroke` + optional `elbowBend`.
 */
function unwrapElement(e: unknown): YorkieElement {
  return yorkieToPlain<YorkieElement>(e);
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
    const rootAny = r as {
      themes?: Theme[];
      masters?: Master[];
      guides?: unknown[];
    };
    if (rootAny.themes == null || rootAny.themes.length === 0) {
      rootAny.themes = [clone(defaultLight)];
    }
    if (rootAny.masters == null || rootAny.masters.length === 0) {
      rootAny.masters = [clone(DEFAULT_MASTER)];
    }
    // Pre-v0.4.2 (pre-ruler) docs predate the guides array. Lazy-init
    // an empty list so the slides store and renderer can read it
    // unconditionally. The first session writes the empty array; later
    // attaches no-op.
    if (rootAny.guides == null) {
      rootAny.guides = [];
    }
    // Backfill `meta.themeId` / `meta.masterId` against the document's
    // own `themes` / `masters` arrays, not against hard-coded ids. A
    // partially migrated or customized doc may carry a `themes` array
    // that doesn't include 'default-light'; pinning that id would make
    // `getActiveTheme(doc)` throw at render time.
    const meta = r.meta as { themeId?: string; masterId?: string };
    if (
      meta.themeId == null ||
      !rootAny.themes.some((t) => t.id === meta.themeId)
    ) {
      meta.themeId = rootAny.themes[0].id;
    }
    if (
      meta.masterId == null ||
      !rootAny.masters.some((m) => m.id === meta.masterId)
    ) {
      meta.masterId = rootAny.masters[0].id;
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
    // Walk the Yorkie root and build a plain unwrapped object. Yorkie
    // proxies of nested arrays / objects can serialize to a JSON string
    // via `toJSON()` rather than expose live references, so we unwrap
    // each field with `yorkieToPlain` before handing the payload to
    // `migrateDocument`. Migration then handles the actual shape work
    // (theme/master/layout backfill, color wrapping, layoutId remap)
    // — kept in one place so MemSlidesStore reads and Yorkie reads
    // produce identical SlidesDocuments.
    const meta = yorkieToPlain<{
      title?: string;
      themeId?: string;
      masterId?: string;
    }>(root.meta) ?? {};
    const slides = (root.slides ?? []).map((s) => {
      const id = (s as { id: string }).id;
      const layoutId = (s as { layoutId: string }).layoutId;
      const background = yorkieToPlain<unknown>((s as { background: unknown }).background);
      const elements = ((s as { elements: unknown[] }).elements ?? []).map(
        (e) => this.readElement(e),
      );
      const notes = yorkieToPlain<Block[]>((s as { notes: unknown }).notes) ?? [];
      return { id, layoutId, background, elements, notes };
    });
    const layouts = (root.layouts ?? []).map((l) => yorkieToPlain<Layout>(l));
    const rootAny = root as {
      themes?: unknown;
      masters?: unknown;
      guides?: unknown;
    };
    const themes = yorkieToPlain<Theme[]>(rootAny.themes);
    const masters = yorkieToPlain<Master[]>(rootAny.masters);
    const guides = yorkieToPlain<unknown[]>(rootAny.guides);
    return migrateDocument({
      meta,
      themes,
      masters,
      slides,
      layouts,
      guides,
    });
  }

  // --- read helpers ---

  /**
   * Recursively unwrap a single Yorkie element proxy into a plain
   * ModelElement. Group elements recurse into their `data.children`
   * array, which is itself a Yorkie proxy.
   */
  private readElement(e: unknown): ModelElement {
    const el = e as {
      id: string;
      type: string;
      frame: unknown;
      data: unknown;
      placeholderRef?: unknown;
    };
    const placeholderRef = yorkieToPlain<PlaceholderRef | undefined>(
      el.placeholderRef,
    );
    if (el.type === 'text') {
      const rawData = (el.data ?? {}) as Record<string, unknown>;
      const blocks = yorkieToPlain<Block[]>(rawData.blocks) ?? [];
      // Preserve box-level fields (fill, stroke, …) alongside the
      // CRDT-backed `blocks` Tree. The Tree itself is bridged through
      // `withTextElement`, but ancillary `data` keys are plain values
      // and would otherwise be dropped on every read.
      const extras: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rawData)) {
        if (k === 'blocks') continue;
        extras[k] = yorkieToPlain<unknown>(v);
      }
      return {
        id: el.id,
        type: 'text',
        frame: yorkieToPlain<Frame>(el.frame),
        placeholderRef,
        data: { ...extras, blocks } as TextElement['data'],
      } as ModelElement;
    }
    if (el.type === 'connector') {
      // Connectors store their endpoints / arrowheads / stroke /
      // routing as top-level fields (no `data` sub-object). Each is
      // a Yorkie proxy until we unwrap, so reading via the generic
      // `data`-only path above would drop them and crash the overlay
      // when it tries `connector.start.kind`. Connectors are never
      // placeholders, so we don't emit a `placeholderRef` field here.
      const c = el as unknown as {
        routing: ConnectorElement['routing'];
        start: Endpoint;
        end: Endpoint;
        arrowheads: ConnectorElement['arrowheads'];
        stroke?: ConnectorElement['stroke'];
        elbowBend?: number;
      };
      return {
        id: el.id,
        type: 'connector',
        frame: yorkieToPlain<Frame>(el.frame),
        routing: c.routing,
        start: yorkieToPlain<Endpoint>(c.start),
        end: yorkieToPlain<Endpoint>(c.end),
        arrowheads:
          yorkieToPlain<ConnectorElement['arrowheads']>(c.arrowheads)
          ?? {},
        stroke: c.stroke
          ? yorkieToPlain<ConnectorElement['stroke']>(c.stroke)
          : undefined,
        elbowBend: c.elbowBend,
      } as ModelElement;
    }
    if (el.type === 'group') {
      // Group children are stored in a nested Yorkie Array — we must
      // recurse to unwrap them rather than calling yorkieToPlain on
      // `data.children`, which would stringify the whole array. The
      // sibling `refSize` (when present) is plain and unwraps fine via
      // yorkieToPlain — without preserving it here, every read drops
      // refSize and the renderer can never compute the resize scale.
      const rawData = (el.data ?? {}) as {
        children?: unknown[];
        refSize?: unknown;
      };
      const rawChildren = rawData.children ?? [];
      const children = rawChildren.map((c) => this.readElement(c));
      const refSize = rawData.refSize
        ? yorkieToPlain<{ w: number; h: number }>(rawData.refSize)
        : undefined;
      return {
        id: el.id,
        type: 'group',
        frame: yorkieToPlain<Frame>(el.frame),
        data: refSize ? { children, refSize } : { children },
      } as ModelElement;
    }
    return {
      id: el.id,
      type: el.type,
      frame: yorkieToPlain<Frame>(el.frame),
      placeholderRef,
      data: yorkieToPlain<object>(el.data),
    } as ModelElement;
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
      //
      // Guides also live on the snapshot — without rewriting them here,
      // undo / redo of addGuide / moveGuide / removeGuide silently
      // diverges from the editor's pre-batch state.
      const rootAny = r as {
        themes?: Theme[];
        masters?: Master[];
        guides?: Array<{ id: string; axis: 'x' | 'y'; position: number }>;
      };
      rootAny.themes = clone(snapshot.themes);
      rootAny.masters = clone(snapshot.masters);
      rootAny.guides = clone(snapshot.guides ?? []);
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
    const refs = slotRefsForLayout(layout);
    const { master, theme } = this.resolveMasterAndTheme();
    this.doc.update((r) => {
      const elements: YorkieElement[] = layout.placeholders.map((p, i) => {
        const placeholder = clone(p) as YorkiePlaceholder;
        const elementId = generateId();
        const placeholderRef = refs[i];
        if (placeholder.type === 'text') {
          // Seed typed-text styling from the master's PlaceholderStyle so
          // user keystrokes inherit fontSize / fontFamily / color from
          // the very first character (matches the ghost-text rendering).
          const placeholderStyle =
            master.placeholderStyles[placeholderRef.type]
            ?? master.placeholderStyles.body;
          const blocks = placeholderStyle
            ? seedPlaceholderBlocks(placeholderStyle, theme)
            : (placeholder.data as { blocks?: Block[] }).blocks ?? [];
          return {
            id: elementId,
            type: 'text',
            frame: placeholder.frame,
            placeholderRef,
            data: { blocks: clone(blocks) },
          } as YorkieElement;
        }
        return {
          id: elementId,
          type: placeholder.type,
          frame: placeholder.frame,
          placeholderRef,
          data: placeholder.data,
        } as YorkieElement;
      });
      const slide: YorkieSlide = {
        id,
        layoutId: layout.id,
        background: clone(MODEL_DEFAULT_BACKGROUND) as YorkieSlide['background'],
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
      // Regenerate element ids and build an oldId → newId map. Without
      // remapping, every attached connector endpoint on a duplicated
      // slide would still point at the source slide's element id —
      // which resolves correctly on the source but to (0,0) on the
      // copy (resolveEndpoint's missing-target fallback).
      const idMap = new Map<string, string>();
      const sourceElements = ((src as { elements: unknown[] }).elements ?? []).map((e) => {
        const plain = unwrapElement(e);
        const newElementId = generateId();
        idMap.set((plain as { id: string }).id, newElementId);
        return { ...plain, id: newElementId } as YorkieElement;
      });
      // Rewrite connector endpoints to the new id space, then recompute
      // the cached frame off the rewritten endpoints.
      const lookup = new Map(
        sourceElements.map((e) => [(e as { id: string }).id, e] as const),
      );
      for (const e of sourceElements) {
        if ((e as { type: string }).type !== 'connector') continue;
        const c = e as unknown as {
          start: Endpoint;
          end: Endpoint;
          frame: Frame;
        };
        for (const side of ['start', 'end'] as const) {
          const ep = c[side];
          if (ep.kind === 'attached') {
            const mapped = idMap.get(ep.elementId);
            if (mapped) c[side] = { ...ep, elementId: mapped };
          }
        }
        const plain = e as unknown as ConnectorElement;
        c.frame = computeConnectorFrame(
          plain,
          lookup as unknown as ReadonlyMap<string, ModelElement>,
        );
      }
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
    const elements = ((src as { elements: unknown[] }).elements ?? []).map(
      (e) => unwrapElement(e) as YorkieElement,
    );
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

  // --- theme ops ---

  addTheme(theme: Theme): void {
    this.requireBatch();
    this.doc.update((r) => {
      const rootAny = r as { themes?: Theme[] };
      if (rootAny.themes == null) rootAny.themes = [] as Theme[];
      if (rootAny.themes.find((t) => t.id === theme.id)) return; // idempotent
      rootAny.themes.push(clone(theme) as Theme);
    });
  }

  applyTheme(themeId: string): void {
    this.requireBatch();
    this.doc.update((r) => {
      const rootAny = r as { themes?: Theme[] };
      if (!rootAny.themes?.find((t) => t.id === themeId)) {
        throw new Error(`[slides] theme '${themeId}' not in document`);
      }
      r.meta.themeId = themeId;
    });
  }

  applyLayout(slideId: string, layoutId: string): void {
    this.requireBatch();
    const layout = getLayout(layoutId);
    const { master, theme } = this.resolveMasterAndTheme();
    this.doc.update((r) => {
      const s = r.slides.find((s) => s.id === slideId);
      if (!s) throw new Error(`Slide not found: ${slideId}`);
      // Cast through unknown: Yorkie array proxies expose the same shape
      // as plain Slide for the operations applyLayoutToSlide performs
      // (property assignment on slide.layoutId; splice on slide.elements).
      applyLayoutToSlide(s as unknown as ModelSlide, layout, { master, theme });
    });
  }

  /**
   * Resolve the active master + theme from the Yorkie root, falling back
   * to defaults if the document predates the v0.5 theme system. The
   * fallback matches what `ensureSlidesRoot` would backfill, so callers
   * can rely on a non-null pair without checking.
   */
  private resolveMasterAndTheme(): { master: Master; theme: Theme } {
    const root = this.doc.getRoot() as {
      meta?: { themeId?: string; masterId?: string };
      themes?: unknown;
      masters?: unknown;
    };
    const themes = yorkieToPlain<Theme[]>(root.themes) ?? [];
    const masters = yorkieToPlain<Master[]>(root.masters) ?? [];
    const meta = yorkieToPlain<{ themeId?: string; masterId?: string }>(root.meta) ?? {};
    const master =
      masters.find((m) => m.id === meta.masterId)
      ?? masters[0]
      ?? DEFAULT_MASTER;
    const theme =
      themes.find((t) => t.id === meta.themeId)
      ?? themes[0]
      ?? defaultLight;
    return { master, theme };
  }

  // --- element ops ---

  addElement(slideId: string, init: ElementInit, parentGroupId?: string): string {
    this.requireBatch();
    const id = generateId();
    this.doc.update((r) => {
      const s = r.slides.find((s) => s.id === slideId);
      if (!s) throw new Error(`Slide not found: ${slideId}`);

      // Resolve the target array — slide root or a group's children.
      let targetArray: ProxyArray;
      if (parentGroupId !== undefined) {
        const path = yorkieFindElementPath(s.elements as unknown as ProxyArray, parentGroupId);
        if (!path) {
          throw new Error(
            `[slides] addElement(): parent group not found: ${parentGroupId}`,
          );
        }
        const parentEl = path[path.length - 1];
        if (parentEl.type !== 'group') {
          throw new Error(
            `[slides] addElement(): element ${parentGroupId} is not a group`,
          );
        }
        targetArray = (parentEl.data as { children: ProxyArray }).children;
      } else {
        targetArray = s.elements as unknown as ProxyArray;
      }

      if (init.type === 'text') {
        const blocks = (init.data as { blocks?: Block[] }).blocks ?? [];
        (targetArray as unknown as YorkieElement[]).push({
          id,
          type: 'text',
          frame: { ...init.frame },
          data: { blocks: clone(blocks) },
        } as YorkieElement);
        return;
      }
      if (init.type === 'connector') {
        // Connectors carry a derived `frame` cache. The insert call path
        // (buildConnectorInit) pre-fills it correctly, but any future
        // paste/import path could store a degenerate `{0,0,0,0}` frame
        // and silently break selection bbox. Recompute defensively from
        // the endpoints + current slide elements.
        const lookup = this.slideElementsLookup(s);
        const next = { ...clone(init), id } as ConnectorElement;
        next.frame = computeConnectorFrame(next, lookup);
        (targetArray as unknown as YorkieElement[]).push(next as unknown as YorkieElement);
        return;
      }
      (targetArray as unknown as YorkieElement[]).push({ ...clone(init), id } as YorkieElement);
    });
    return id;
  }

  removeElement(slideId: string, elementId: string): void {
    this.requireBatch();
    this.doc.update((r) => {
      const s = r.slides.find((s) => s.id === slideId);
      if (!s) throw new Error(`Slide not found: ${slideId}`);
      // Walk the element tree so removal works for both slide-root and
      // group-nested elements. Connector cascade sweep must run BEFORE
      // splicing so attached siteWorldPos still resolves. (Q4 c1 policy.)
      const path = yorkieFindElementPath(s.elements as unknown as ProxyArray, elementId);
      if (!path) throw new Error(`Element not found: ${elementId}`);
      this.detachConnectorsTargeting(s, elementId);
      const parentArray = this.resolveYorkieParentArray(s, path);
      const i = parentArray.findIndex((e) => e.id === elementId);
      (parentArray as unknown as { splice(i: number, d: number): void }).splice(i, 1);
      this.pruneEmptyYorkieAncestorGroups(s, path);
    });
  }

  removeElements(slideId: string, elementIds: string[]): void {
    this.requireBatch();
    const set = new Set(elementIds);
    this.doc.update((r) => {
      const s = r.slides.find((s) => s.id === slideId);
      if (!s) throw new Error(`Slide not found: ${slideId}`);
      // Collect paths before any removal so they all resolve correctly.
      const paths = new Map<string, ProxyArray[]>();
      for (const id of set) {
        const path = yorkieFindElementPath(s.elements as unknown as ProxyArray, id);
        if (path) paths.set(id, path);
      }
      // Cascade sweep: convert endpoints attached to any about-to-be-removed
      // element to free endpoints before any source is dropped.
      for (const id of set) {
        this.detachConnectorsTargeting(s, id);
      }
      // Remove from deepest leaves first (longest path first) to avoid stale
      // parent refs. Group by parent and splice all at once per parent array.
      type ParentEntry = { parentArray: ProxyArray; ids: Set<string>; repPath: ProxyArray[] };
      const byParent = new Map<string, ParentEntry>();
      for (const [id, path] of paths) {
        const parentArray = this.resolveYorkieParentArray(s, path);
        const parentPathKey = path.slice(0, -1).map((e) => e.id).join('/');
        if (!byParent.has(parentPathKey)) {
          byParent.set(parentPathKey, { parentArray, ids: new Set(), repPath: path });
        }
        byParent.get(parentPathKey)!.ids.add(id);
      }
      for (const { parentArray, ids, repPath } of byParent.values()) {
        for (let i = parentArray.length - 1; i >= 0; i--) {
          if (ids.has(parentArray[i].id)) {
            (parentArray as unknown as { splice(i: number, d: number): void }).splice(i, 1);
          }
        }
        this.pruneEmptyYorkieAncestorGroups(s, repPath);
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
      // Walk the element tree so updates work for both slide-root and
      // group-nested elements.
      const path = yorkieFindElementPath(s.elements as unknown as ProxyArray, elementId);
      if (!path) throw new Error(`Element not found: ${elementId}`);
      const e = path[path.length - 1];
      if (e.type === 'connector') {
        // Connector frame is derived from endpoint positions — patching it
        // directly would leave the cached bbox out of sync with the
        // endpoints. Callers must mutate endpoints via
        // `updateConnectorEndpoint`, which recomputes the frame for them.
        throw new Error(
          `Element ${elementId} is a connector; update its endpoints instead of its frame`,
        );
      }
      const eAny = e as { frame: Frame };
      eAny.frame = { ...eAny.frame, ...frame };
      // Refresh the cached frames of connectors whose endpoints attach to
      // this element. The renderer reads endpoints live, so the visual
      // line already follows the source move — but selection bbox /
      // hit-testing uses the cached `frame`, which must stay fresh.
      this.recomputeDependentConnectorFrames(s, elementId);
    });
  }

  updateElementData(slideId: string, elementId: string, patch: object): void {
    this.requireBatch();
    this.doc.update((r) => {
      const s = r.slides.find((s) => s.id === slideId);
      if (!s) throw new Error(`Slide not found: ${slideId}`);
      // Walk the element tree so updates work for both slide-root and
      // group-nested elements.
      const path = yorkieFindElementPath(s.elements as unknown as ProxyArray, elementId);
      if (!path) throw new Error(`Element not found: ${elementId}`);
      const e = path[path.length - 1];
      if (e.type === 'connector') {
        // Connectors have no `data` sub-object; use
        // `updateConnectorEndpoint` / `updateConnectorArrowheads`.
        throw new Error(
          `Element ${elementId} is a connector; use updateConnectorEndpoint / updateConnectorArrowheads`,
        );
      }
      // For text elements, text content goes through `withTextElement`; we
      // ignore any `blocks` field in the patch to avoid clobbering.
      const source = { ...(patch as object) } as Record<string, unknown>;
      if (e.type === 'text') {
        delete source.blocks;
        if (Object.keys(source).length === 0) return;
      }
      // Apply key-by-key, IN-PLACE on the Yorkie data object. Re-assigning
      // the whole `data` field breaks for groups because `data.children` is
      // a nested Yorkie.Array (CRDT subtree) — spreading it would expose
      // its proxy methods, and Yorkie rejects functions on `set`. Mutating
      // individual fields preserves the children array as-is.
      //
      // Explicit `undefined` removes the key (JSON.stringify strips
      // undefined, so the previous clone-and-spread silently dropped
      // clears — e.g., `{ crop: undefined }` for Reset Crop).
      const data = (e as { data: Record<string, unknown> }).data;
      for (const [k, v] of Object.entries(source)) {
        if (v === undefined) {
          delete data[k];
        } else {
          data[k] = clone(v);
        }
      }
    });
  }

  updateConnectorEndpoint(
    slideId: string,
    elementId: string,
    side: 'start' | 'end',
    endpoint: Endpoint,
  ): void {
    this.requireBatch();
    this.doc.update((r) => {
      const s = r.slides.find((s) => s.id === slideId);
      if (!s) throw new Error(`Slide not found: ${slideId}`);
      const path = yorkieFindElementPath(s.elements as unknown as ProxyArray, elementId);
      if (!path) throw new Error(`Element not found: ${elementId}`);
      const e = path[path.length - 1];
      if (e.type !== 'connector') {
        throw new Error(`Element ${elementId} is not a connector`);
      }
      const c = e as unknown as {
        start: Endpoint;
        end: Endpoint;
        frame: Frame;
      };
      if (side === 'start') c.start = clone(endpoint);
      else c.end = clone(endpoint);
      // Recompute the cached frame from the (post-update) endpoints +
      // current slide elements.
      const plain = unwrapElement(e) as unknown as ConnectorElement;
      c.frame = computeConnectorFrame(plain, this.slideElementsLookup(s));
    });
  }

  updateConnectorArrowheads(
    slideId: string,
    elementId: string,
    heads: {
      start?: ArrowheadStyle | null;
      end?:   ArrowheadStyle | null;
    },
  ): void {
    this.requireBatch();
    this.doc.update((r) => {
      const s = r.slides.find((s) => s.id === slideId);
      if (!s) throw new Error(`Slide not found: ${slideId}`);
      const path = yorkieFindElementPath(s.elements as unknown as ProxyArray, elementId);
      if (!path) throw new Error(`Element not found: ${elementId}`);
      const e = path[path.length - 1];
      if (e.type !== 'connector') {
        throw new Error(`Element ${elementId} is not a connector`);
      }
      const c = e as unknown as {
        arrowheads: { start?: ArrowheadStyle; end?: ArrowheadStyle };
      };
      // Build a fresh arrowheads object — never mutate the existing one
      // in place, since snapshot references may hold the prior shape.
      const prev =
        yorkieToPlain<{ start?: ArrowheadStyle; end?: ArrowheadStyle }>(
          c.arrowheads,
        ) ?? {};
      const next: { start?: ArrowheadStyle; end?: ArrowheadStyle } = {
        ...prev,
      };
      for (const side of ['start', 'end'] as const) {
        if (!(side in heads)) continue; // undefined = "don't touch"
        const value = heads[side];
        if (value === null) {
          delete next[side];
        } else if (value !== undefined) {
          next[side] = clone(value);
        }
      }
      c.arrowheads = next;
    });
  }

  updateConnectorStroke(
    slideId: string,
    elementId: string,
    stroke: Stroke | undefined,
  ): void {
    this.requireBatch();
    this.doc.update((r) => {
      const s = r.slides.find((s) => s.id === slideId);
      if (!s) throw new Error(`Slide not found: ${slideId}`);
      const path = yorkieFindElementPath(s.elements as unknown as ProxyArray, elementId);
      if (!path) throw new Error(`Element not found: ${elementId}`);
      const e = path[path.length - 1];
      if (e.type !== 'connector') {
        throw new Error(`Element ${elementId} is not a connector`);
      }
      const c = e as unknown as { stroke?: Stroke };
      if (stroke === undefined) {
        delete c.stroke;
      } else {
        c.stroke = clone(stroke);
      }
    });
  }

  reorderElement(slideId: string, elementId: string, toIndex: number): void {
    this.requireBatch();
    this.doc.update((r) => {
      const s = r.slides.find((s) => s.id === slideId);
      if (!s) throw new Error(`Slide not found: ${slideId}`);
      // Walk the element tree so reorder works for both slide-root and
      // group-nested elements.
      const path = yorkieFindElementPath(s.elements as unknown as ProxyArray, elementId);
      if (!path) throw new Error(`Element not found: ${elementId}`);
      const parentArray = this.resolveYorkieParentArray(s, path);
      const from = parentArray.findIndex((e) => e.id === elementId);
      // Rebuild the element so its data is detached from the proxy —
      // safer to re-insert into the Yorkie array.
      const rebuilt = unwrapElement(parentArray[from]) as YorkieElement;
      (parentArray as unknown as { splice(f: number, d: number): void }).splice(from, 1);
      const clamped = Math.max(0, Math.min(toIndex, parentArray.length));
      (parentArray as unknown as { splice(at: number, del: number, item: YorkieElement): void }).splice(clamped, 0, rebuilt);
    });
  }

  // --- group / ungroup ---

  group(
    slideId: string,
    elementIds: string[],
  ): { groupId: string; excludedConnectorIds: string[] } {
    this.requireBatch();

    if (elementIds.length < 2) {
      throw new Error(
        `[slides] group() requires at least 2 elements, got ${elementIds.length}`,
      );
    }

    let groupId = '';
    let excludedConnectorIds: string[] = [];

    this.doc.update((r) => {
      const s = r.slides.find((s) => s.id === slideId);
      if (!s) throw new Error(`Slide not found: ${slideId}`);

      const proxyElements = s.elements as unknown as ProxyArray;

      // All ids must exist somewhere on this slide.
      const paths = new Map<string, ProxyArray[]>();
      for (const id of elementIds) {
        const path = yorkieFindElementPath(proxyElements, id);
        if (!path) throw new Error(`[slides] group(): element not found: ${id}`);
        paths.set(id, path);
      }

      // All candidates must share the same parent.
      const parentKeyOf = (id: string): string => {
        const path = paths.get(id)!;
        if (path.length === 1) return '';
        return path[path.length - 2].id;
      };
      const firstParentKey = parentKeyOf(elementIds[0]);
      for (const id of elementIds.slice(1)) {
        if (parentKeyOf(id) !== firstParentKey) {
          throw new Error(
            `[slides] group(): all elements must share the same parent`,
          );
        }
      }

      // Resolve the parent array.
      let parentArray: ProxyArray;
      if (firstParentKey === '') {
        parentArray = proxyElements;
      } else {
        const parentPath = yorkieFindElementPath(proxyElements, firstParentKey);
        if (!parentPath) {
          throw new Error(`[slides] group(): parent not found: ${firstParentKey}`);
        }
        const parentEl = parentPath[parentPath.length - 1];
        if (parentEl.type !== 'group') {
          throw new Error(`[slides] group(): parent is not a group: ${firstParentKey}`);
        }
        parentArray = (parentEl.data as { children: ProxyArray }).children;
      }

      const candidateSet = new Set(elementIds);
      // Resolve candidates in parent-array order.
      const allCandidatesInOrder = parentArray.filter(e => candidateSet.has(e.id));

      // No placeholderRef on any candidate.
      for (const el of allCandidatesInOrder) {
        if ((el as { placeholderRef?: unknown }).placeholderRef != null) {
          throw new Error(
            `[slides] group(): placeholderRef cannot be grouped (element ${el.id})`,
          );
        }
      }

      // Connector partition: connectors whose both endpoints are internal join
      // the group; those with an external endpoint are excluded.
      const internalCandidates: ProxyArray = [];
      const excluded: string[] = [];

      for (const el of allCandidatesInOrder) {
        if (el.type !== 'connector') {
          internalCandidates.push(el);
          continue;
        }
        const c = el as unknown as { start: Endpoint; end: Endpoint };
        const startInternal =
          c.start.kind === 'free' ||
          candidateSet.has((c.start as { elementId?: string }).elementId ?? '');
        const endInternal =
          c.end.kind === 'free' ||
          candidateSet.has((c.end as { elementId?: string }).elementId ?? '');
        if (startInternal && endInternal) {
          internalCandidates.push(el);
        } else {
          excluded.push(el.id);
          candidateSet.delete(el.id);
        }
      }
      excludedConnectorIds = excluded;

      if (internalCandidates.length < 2) {
        throw new Error(
          `[slides] group(): cannot create a group: only ${internalCandidates.length} non-connector element(s) remain after excluding cross-group connectors`,
        );
      }

      const candidatesInOrder = internalCandidates;

      // Compute the cumulative ancestor transform from slide-root to parent space.
      const ancestorTransform = yorkieResolveAncestorTransform(proxyElements, firstParentKey);

      // Compute world frames for each candidate.
      const worldFrames = candidatesInOrder.map(el => {
        const frame = yorkieToPlain<Frame>((el as { frame: unknown }).frame)!;
        return applyGroupTransformMatrix(frame, ancestorTransform);
      });

      // Compute the rotated-corner AABB over all world frames.
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const wf of worldFrames) {
        const corners = frameCorners(wf);
        for (const [cx, cy] of corners) {
          if (cx < minX) minX = cx;
          if (cy < minY) minY = cy;
          if (cx > maxX) maxX = cx;
          if (cy > maxY) maxY = cy;
        }
      }
      // Clamp to at least 1px to prevent a degenerate (singular) group transform.
      const MIN_GROUP_DIM = 1;
      const groupWorldFrame: Frame = {
        x: minX, y: minY,
        w: Math.max(maxX - minX, MIN_GROUP_DIM),
        h: Math.max(maxY - minY, MIN_GROUP_DIM),
        rotation: 0,
      };

      // Convert the group's world frame back to parent-local space.
      const groupLocalFrame = applyInverseMatrix(groupWorldFrame, ancestorTransform);

      // Build a temporary GroupElement (plain object) to compute normalizeToGroupLocal.
      const tempGroup: GroupElement = {
        id: '__tmp__',
        type: 'group',
        frame: groupWorldFrame,
        data: { children: [] },
      };
      const groupSelfTransform = groupToTransform(tempGroup);

      // Build children with group-local frames from plain unwrapped copies.
      const childrenWithLocalFrames = candidatesInOrder.map((el, i) => {
        const plain = unwrapElement(el) as YorkieElement;
        const localFrame = normalizeToGroupLocal(worldFrames[i], tempGroup);
        if ((plain as { type: string }).type === 'connector') {
          // Normalize free endpoint coordinates from parent-local space to group-local.
          const plainConnector = plain as unknown as { start: Endpoint; end: Endpoint; frame: Frame };
          for (const side of ['start', 'end'] as const) {
            const ep = plainConnector[side];
            if (ep.kind === 'free') {
              const worldPt = applyGroupTransformToPoint(ep.x, ep.y, ancestorTransform);
              const local = applyInversePoint(worldPt.x, worldPt.y, groupSelfTransform);
              plainConnector[side] = { kind: 'free', x: local.x, y: local.y };
            }
          }
          return { ...plain, frame: localFrame } as YorkieElement;
        }
        return { ...(plain as YorkieElement), frame: localFrame };
      });

      groupId = generateId();
      const newGroup: YorkieGroupElement = {
        id: groupId,
        type: 'group',
        frame: groupLocalFrame,
        data: {
          children: childrenWithLocalFrames as YorkieGroupElement['data']['children'],
          // Anchor the local coordinate space so group resize scales children.
          // (OOXML chExt/ext semantics — see GroupElement.data.refSize.)
          refSize: { w: groupLocalFrame.w, h: groupLocalFrame.h },
        },
      };

      // Insert the group at the front-most target position, remove candidates.
      const candidateIndices = candidatesInOrder.map(el =>
        parentArray.findIndex(p => p.id === el.id),
      );
      const frontMostIndex = Math.max(...candidateIndices);

      // Remove all internal candidates from the parent array.
      for (const el of candidatesInOrder) {
        const idx = parentArray.findIndex(p => p.id === el.id);
        if (idx !== -1) {
          (parentArray as unknown as { splice(i: number, d: number): void }).splice(idx, 1);
        }
      }

      // Insert the new group at the adjusted position.
      const removedBefore = candidateIndices.filter(i => i < frontMostIndex).length;
      const insertAt = Math.max(0, frontMostIndex - removedBefore);
      (parentArray as unknown as { splice(at: number, del: number, item: YorkieGroupElement): void })
        .splice(insertAt, 0, newGroup);
    });

    return { groupId, excludedConnectorIds };
  }

  refitGroup(slideId: string, groupId: string): void {
    this.requireBatch();

    this.doc.update((r) => {
      const s = r.slides.find((s) => s.id === slideId);
      if (!s) return;

      const proxyElements = s.elements as unknown as ProxyArray;
      const path = yorkieFindElementPath(proxyElements, groupId);
      if (!path) return;

      const group = path[path.length - 1];
      if (group.type !== 'group') return;

      const plainGroup = unwrapElement(group) as unknown as GroupElement;
      if (plainGroup.data.children.length === 0) return;

      // Shared rotation-preserving refit math (see model/group.ts).
      // Children's world positions are invariant by construction.
      const { worldFrame: newFrame, localShift, newRefSize } =
        worldTightFrame(plainGroup);

      const EPS = 0.5;
      const close = (a: number, b: number) => Math.abs(a - b) < EPS;
      if (
        close(localShift.x, 0) &&
        close(localShift.y, 0) &&
        close(newRefSize.w, plainGroup.data.refSize?.w ?? plainGroup.frame.w) &&
        close(newRefSize.h, plainGroup.data.refSize?.h ?? plainGroup.frame.h)
      ) {
        // Local AABB already aligned with the local origin AND tight against
        // refSize — nothing to refit.
        return;
      }

      // Mutate the proxy in place to preserve Yorkie CRDT identity.
      const gAny = group as unknown as {
        frame: Frame;
        data: { refSize: { w: number; h: number }; children: ProxyArray };
      };
      gAny.frame = { ...newFrame };
      gAny.data.refSize = { ...newRefSize };

      gAny.data.children.forEach((ch) => {
        const chAny = ch as unknown as {
          type: string;
          frame: Frame;
          start?: Endpoint;
          end?: Endpoint;
        };
        chAny.frame = {
          ...chAny.frame,
          x: chAny.frame.x - localShift.x,
          y: chAny.frame.y - localShift.y,
        };
        if (chAny.type === 'connector') {
          for (const side of ['start', 'end'] as const) {
            const ep = chAny[side];
            if (ep && ep.kind === 'free') {
              (chAny as unknown as Record<'start' | 'end', Endpoint>)[side] = {
                kind: 'free',
                x: ep.x - localShift.x,
                y: ep.y - localShift.y,
              };
            }
          }
        }
      });
    });
  }

  ungroup(slideId: string, groupId: string): string[] {
    this.requireBatch();

    let childIds: string[] = [];

    this.doc.update((r) => {
      const s = r.slides.find((s) => s.id === slideId);
      if (!s) throw new Error(`Slide not found: ${slideId}`);

      const proxyElements = s.elements as unknown as ProxyArray;

      const path = yorkieFindElementPath(proxyElements, groupId);
      if (!path) throw new Error(`[slides] ungroup(): element not found: ${groupId}`);

      const group = path[path.length - 1];
      if (group.type !== 'group') {
        throw new Error(`[slides] ungroup(): element ${groupId} is not a group`);
      }

      // Resolve the parent array.
      let parentArray: ProxyArray;
      if (path.length === 1) {
        parentArray = proxyElements;
      } else {
        const parentEl = path[path.length - 2];
        parentArray = (parentEl.data as { children: ProxyArray }).children;
      }

      const groupIndex = parentArray.findIndex(e => e.id === groupId);

      // Unwrap the group proxy to a plain GroupElement so we can do math.
      const plainGroup = unwrapElement(group) as unknown as GroupElement;

      // Bake the group's transform into each child's frame.
      // For connectors, also transform free endpoints from group-local
      // to parent space so line geometry stays correct after ungroup.
      const groupTx = groupToTransform(plainGroup);
      const bakedChildren: YorkieElement[] = plainGroup.data.children.map((child) => {
        const next = {
          ...clone(child),
          frame: applyGroupTransform(child.frame, plainGroup),
        } as YorkieElement;
        if (next.type === 'connector') {
          const c = next as unknown as { start: { kind: string; x: number; y: number }; end: { kind: string; x: number; y: number } };
          for (const side of ['start', 'end'] as const) {
            const ep = c[side];
            if (ep.kind === 'free') {
              const p = applyGroupTransformToPoint(ep.x, ep.y, groupTx);
              c[side] = { kind: 'free', x: p.x, y: p.y };
            }
          }
        }
        return next;
      });

      childIds = bakedChildren.map(c => (c as { id: string }).id);

      // Replace the group in the parent array with its children.
      (parentArray as unknown as {
        splice(i: number, d: number, ...items: YorkieElement[]): void
      }).splice(groupIndex, 1, ...bakedChildren);
    });

    return childIds;
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
      // Walk the element tree so updates work for both slide-root and
      // group-nested elements.
      const path = yorkieFindElementPath(s.elements as unknown as ProxyArray, elementId);
      if (!path) throw new Error(`Element not found: ${elementId}`);
      const e = path[path.length - 1];
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
      const eAny = e as { data: Record<string, unknown> };
      eAny.data = {
        ...eAny.data,
        blocks: clone(next ?? blocks),
      };
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

  // --- guides (presentation-wide) ---

  addGuide(axis: 'x' | 'y', position: number): string {
    this.requireBatch();
    assertFiniteGuidePosition('addGuide', position);
    const id = generateId();
    this.doc.update((r) => {
      const rootAny = r as { guides?: Array<{ id: string; axis: 'x' | 'y'; position: number }> };
      if (rootAny.guides == null) rootAny.guides = [];
      rootAny.guides.push({ id, axis, position });
    });
    return id;
  }

  moveGuide(id: string, position: number): void {
    this.requireBatch();
    assertFiniteGuidePosition('moveGuide', position);
    this.doc.update((r) => {
      const rootAny = r as { guides?: Array<{ id: string; position: number }> };
      const guide = rootAny.guides?.find((g) => g.id === id);
      if (!guide) throw new Error(`Guide not found: ${id}`);
      guide.position = position;
    });
  }

  removeGuide(id: string): void {
    this.requireBatch();
    this.doc.update((r) => {
      const rootAny = r as { guides?: Array<{ id: string }> };
      const idx = rootAny.guides?.findIndex((g) => g.id === id) ?? -1;
      if (idx === -1) throw new Error(`Guide not found: ${id}`);
      rootAny.guides!.splice(idx, 1);
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

  /**
   * Read-only id → unwrapped Element map for the given Yorkie slide.
   * Used by the connector-frame helpers to resolve attached endpoints.
   * Each element is `yorkieToPlain`-unwrapped so the map carries plain
   * objects with live `frame` / endpoint fields — `resolveEndpoint` and
   * `computeConnectorFrame` only read, never mutate.
   */
  private slideElementsLookup(s: YorkieSlide): ReadonlyMap<string, ModelElement> {
    const map = new Map<string, ModelElement>();
    for (const e of s.elements) {
      const plain = unwrapElement(e) as unknown as ModelElement;
      map.set(plain.id, plain);
    }
    return map;
  }

  /**
   * For every connector on `s` whose `start` or `end` attaches to
   * `targetId`, convert that endpoint to a `free` endpoint pinned at the
   * endpoint's current world position and refresh the cached `frame`.
   * Caller MUST invoke this BEFORE removing the target so attached
   * `siteWorldPos` still resolves to a defined location. (Q4 c1 policy.)
   */
  private detachConnectorsTargeting(s: YorkieSlide, targetId: string): void {
    const lookup = this.slideElementsLookup(s);
    for (const el of s.elements) {
      if (el.type !== 'connector') continue;
      const c = el as unknown as {
        start: Endpoint;
        end: Endpoint;
        frame: Frame;
      };
      let mutated = false;
      for (const side of ['start', 'end'] as const) {
        const ep = c[side];
        if (ep.kind === 'attached' && ep.elementId === targetId) {
          const w = resolveEndpoint(ep, lookup);
          c[side] = { kind: 'free', x: w.x, y: w.y };
          mutated = true;
        }
      }
      if (mutated) {
        const plain = unwrapElement(el) as unknown as ConnectorElement;
        c.frame = computeConnectorFrame(plain, lookup);
      }
    }
  }

  /**
   * Refresh the cached `frame` of every connector on `s` whose `start`
   * or `end` attaches to `sourceId`. Called after a source element's
   * frame moves; keeps selection bbox / hit-testing in sync with the
   * already-live endpoint positions the renderer reads.
   */
  private recomputeDependentConnectorFrames(
    s: YorkieSlide,
    sourceId: string,
  ): void {
    const lookup = this.slideElementsLookup(s);
    for (const el of s.elements) {
      if (el.type !== 'connector') continue;
      const c = el as unknown as {
        start: Endpoint;
        end: Endpoint;
        frame: Frame;
      };
      const dependsOnUs =
        (c.start.kind === 'attached' && c.start.elementId === sourceId) ||
        (c.end.kind   === 'attached' && c.end.elementId   === sourceId);
      if (dependsOnUs) {
        const plain = unwrapElement(el) as unknown as ConnectorElement;
        c.frame = computeConnectorFrame(plain, lookup);
      }
    }
  }

  /**
   * Given a path (from yorkieFindElementPath), return the mutable Yorkie
   * proxy array that directly contains the leaf element.
   * - path.length === 1 → s.elements (slide root)
   * - path.length >= 2  → the immediate parent group's children proxy array
   */
  private resolveYorkieParentArray(s: YorkieSlide, path: ProxyArray[]): ProxyArray {
    if (path.length === 1) return s.elements as unknown as ProxyArray;
    const parent = path[path.length - 2];
    return (parent.data as { children: ProxyArray }).children;
  }

  /**
   * After removing element(s), walk the ancestor path upward and splice
   * any group whose `children` array has become empty. Equivalent to
   * MemSlidesStore.pruneEmptyAncestorGroups but operates on Yorkie proxies.
   *
   * `path` is the pre-removal path of the removed element (including the
   * removed element itself at the leaf). We walk from the immediate parent
   * upward toward the slide root.
   */
  private pruneEmptyYorkieAncestorGroups(s: YorkieSlide, path: ProxyArray[]): void {
    for (let depth = path.length - 2; depth >= 0; depth--) {
      const ancestor = path[depth];
      if (ancestor.type !== 'group') break;
      const children = (ancestor.data as { children: ProxyArray }).children;
      if (children.length > 0) break;
      // This group is now empty — remove it from ITS parent.
      const ancestorParentArray: ProxyArray =
        depth === 0
          ? (s.elements as unknown as ProxyArray)
          : (path[depth - 1].data as { children: ProxyArray }).children;
      const idx = ancestorParentArray.findIndex((e) => e.id === ancestor.id);
      if (idx !== -1) {
        (ancestorParentArray as unknown as { splice(i: number, d: number): void }).splice(idx, 1);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Module-level helpers for tree-aware Yorkie operations
// ---------------------------------------------------------------------------

/**
 * DFS walk of a Yorkie proxy element array to find an element by id.
 * Returns the path (chain from root → element, leaf last) or null.
 * Equivalent to `findElementPath` from model/group.ts but operates on
 * Yorkie proxy arrays whose items may also be proxies.
 */
function yorkieFindElementPath(
  elements: ProxyArray,
  elementId: string,
): ProxyArray[] | null {
  for (const el of elements) {
    if (el.id === elementId) return [el];
    if (el.type === 'group') {
      const children = (el.data as { children?: ProxyArray })?.children ?? [];
      const sub = yorkieFindElementPath(children, elementId);
      if (sub) return [el, ...sub];
    }
  }
  return null;
}

/**
 * Compose the ancestor transform from slide-root to the given parent element.
 * Returns the identity transform when `parentId` is '' (slide root).
 * Operates on Yorkie proxy arrays to walk the path without materializing a
 * full plain-object tree.
 */
function yorkieResolveAncestorTransform(
  slideElements: ProxyArray,
  parentId: string,
): GroupTransform {
  if (parentId === '') return { ...IDENTITY_GROUP_TRANSFORM };

  const path = yorkieFindElementPath(slideElements, parentId);
  if (!path) {
    throw new Error(`[slides] group(): parentId not found on slide: ${parentId}`);
  }

  // Collect only group ancestors (all entries in the path are groups for a
  // nested parent, up to and including the parent itself).
  const groupAncestors = path
    .filter(el => el.type === 'group')
    .map(el => ({
      frame: yorkieToPlain<Frame>((el as { frame: unknown }).frame)!,
    } as GroupElement));

  return composeAncestorTransform(groupAncestors);
}

/**
 * Return the 4 corners of a frame (accounting for rotation around its center).
 * Used to compute the tight AABB over all rotated candidate frames.
 * Mirrors the equivalent function in MemSlidesStore.
 */
function frameCorners(frame: Frame): [number, number][] {
  const { x, y, w, h, rotation } = frame;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const hw = w / 2;
  const hh = h / 2;
  return [
    [-hw, -hh],
    [+hw, -hh],
    [+hw, +hh],
    [-hw, +hh],
  ].map(([lx, ly]) => [
    cx + lx * cos - ly * sin,
    cy + lx * sin + ly * cos,
  ] as [number, number]);
}
