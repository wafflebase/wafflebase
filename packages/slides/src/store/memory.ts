import type { SlidesStore } from './store';
import type {
  Background,
  Slide,
  SlidesDocument,
} from '../model/presentation';
import type { Block } from '@wafflebase/docs';
import type { ArrowheadStyle, Endpoint } from '../model/connector';
import type { Element, ElementInit, Frame } from '../model/element';
import { generateId } from '../model/element';
import { BUILT_IN_LAYOUTS, applyLayoutToSlide, getLayout, slotRefsForLayout } from '../model/layout';
import { DEFAULT_BACKGROUND } from '../model/presentation';
import { DEFAULT_MASTER } from '../model/master';
import { migrateDocument } from '../model/migrate';
import { seedPlaceholderBlocks } from '../model/placeholder-blocks';
import type { Theme } from '../model/theme';
import { defaultLight } from '../themes/default-light';
import { clone } from '../model/clone';
import {
  computeConnectorFrame,
  resolveEndpoint,
} from '../view/canvas/connector-frame';

function emptyDocument(): SlidesDocument {
  return {
    meta: {
      title: 'Untitled presentation',
      themeId: 'default-light',
      masterId: 'default',
    },
    themes: [clone(defaultLight)],
    masters: [clone(DEFAULT_MASTER)],
    layouts: clone(BUILT_IN_LAYOUTS),
    slides: [],
  };
}

export class MemSlidesStore implements SlidesStore {
  private doc: SlidesDocument;
  private undoStack: SlidesDocument[] = [];
  private redoStack: SlidesDocument[] = [];
  private batchDepth = 0;

  constructor(doc?: SlidesDocument) {
    // Migrate at construction so mutators like `addTheme` / `applyTheme`
    // that access `this.doc.themes` directly don't throw `TypeError` on
    // legacy-shaped input before `read()` ever runs.
    this.doc = doc ? migrateDocument(clone(doc)) : emptyDocument();
  }

  read(): SlidesDocument {
    // Also migrate on read. After construction the doc is in v0.5 shape,
    // but mutators that accept untyped/legacy input (e.g. test paths
    // that cast through `unknown`, or future external callers) can
    // re-introduce legacy field shapes mid-session. Keeping `read()`
    // pass through migrate keeps Mem ≡ Yorkie equivalence — Yorkie's
    // `read()` always migrates because remote peers can send arbitrary
    // shapes. `migrateDocument` is idempotent, so the second pass is
    // near no-op for already-migrated docs.
    return migrateDocument(clone(this.doc));
  }

  // --- slide ops ---

  addSlide(layoutId: string, atIndex?: number): string {
    this.requireBatch();
    const layout = getLayout(layoutId);
    const id = generateId();
    const refs = slotRefsForLayout(layout);
    const master =
      this.doc.masters.find((m) => m.id === this.doc.meta.masterId)
      ?? this.doc.masters[0];
    const theme =
      this.doc.themes.find((t) => t.id === this.doc.meta.themeId)
      ?? this.doc.themes[0];
    const slide: Slide = {
      id,
      layoutId: layout.id,
      background: clone(DEFAULT_BACKGROUND),
      elements: layout.placeholders.map((p, i) => {
        const ref = refs[i];
        const cloned = clone(p);
        // Seed typed-text styling from the master's PlaceholderStyle so
        // user keystrokes inherit fontSize / fontFamily / color from
        // the very first character (matches the ghost-text rendering).
        if (cloned.type === 'text' && master && theme) {
          const placeholderStyle =
            master.placeholderStyles[ref.type]
            ?? master.placeholderStyles.body;
          if (placeholderStyle) {
            cloned.data = { blocks: seedPlaceholderBlocks(placeholderStyle, theme) };
          }
        }
        return {
          ...cloned,
          id: generateId(),
          placeholderRef: ref,
        } as Element;
      }),
      notes: [],
    };
    const insertAt = atIndex === undefined
      ? this.doc.slides.length
      : Math.max(0, Math.min(atIndex, this.doc.slides.length));
    this.doc.slides.splice(insertAt, 0, slide);
    return id;
  }

  duplicateSlide(slideId: string): string {
    this.requireBatch();
    const index = this.requireSlideIndex(slideId);
    const source = this.doc.slides[index];
    const copy: Slide = clone(source);
    copy.id = generateId();
    copy.elements = copy.elements.map((e) => ({ ...e, id: generateId() }));
    this.doc.slides.splice(index + 1, 0, copy);
    return copy.id;
  }

  removeSlide(slideId: string): void {
    this.requireBatch();
    const index = this.requireSlideIndex(slideId);
    this.doc.slides.splice(index, 1);
  }

  removeSlides(slideIds: string[]): void {
    this.requireBatch();
    const set = new Set(slideIds);
    this.doc.slides = this.doc.slides.filter((s) => !set.has(s.id));
  }

  moveSlide(slideId: string, toIndex: number): void {
    this.requireBatch();
    const from = this.requireSlideIndex(slideId);
    const [slide] = this.doc.slides.splice(from, 1);
    const clamped = Math.max(0, Math.min(toIndex, this.doc.slides.length));
    this.doc.slides.splice(clamped, 0, slide);
  }

  moveSlides(slideIds: string[], toIndex: number): void {
    this.requireBatch();
    // Pull them out preserving relative order, then re-insert as a block.
    const set = new Set(slideIds);
    const moving = this.doc.slides.filter((s) => set.has(s.id));
    this.doc.slides = this.doc.slides.filter((s) => !set.has(s.id));
    const clamped = Math.max(0, Math.min(toIndex, this.doc.slides.length));
    this.doc.slides.splice(clamped, 0, ...moving);
  }

  updateSlideBackground(slideId: string, bg: Background): void {
    this.requireBatch();
    const slide = this.requireSlide(slideId);
    slide.background = clone(bg);
  }

  addTheme(theme: Theme): void {
    this.requireBatch();
    if (this.doc.themes.find((t) => t.id === theme.id)) return; // idempotent
    this.doc.themes.push(clone(theme));
  }

  applyTheme(themeId: string): void {
    this.requireBatch();
    if (!this.doc.themes.find((t) => t.id === themeId)) {
      throw new Error(`[slides] theme '${themeId}' not in document`);
    }
    this.doc.meta.themeId = themeId;
  }

  applyLayout(slideId: string, layoutId: string): void {
    this.requireBatch();
    const slide = this.requireSlide(slideId);
    const master =
      this.doc.masters.find((m) => m.id === this.doc.meta.masterId)
      ?? this.doc.masters[0];
    const theme =
      this.doc.themes.find((t) => t.id === this.doc.meta.themeId)
      ?? this.doc.themes[0];
    applyLayoutToSlide(
      slide,
      getLayout(layoutId),
      master && theme ? { master, theme } : undefined,
    );
  }

  // --- element ops ---

  addElement(slideId: string, init: ElementInit): string {
    this.requireBatch();
    const slide = this.requireSlide(slideId);
    const id = generateId();
    const element = { ...clone(init), id } as Element;
    slide.elements.push(element);
    return id;
  }

  removeElement(slideId: string, elementId: string): void {
    this.requireBatch();
    const slide = this.requireSlide(slideId);
    const i = this.requireElementIndex(slide, elementId);
    // Cascade sweep — any connector still attached to the element being
    // removed must convert that endpoint to a `free` endpoint pinned at
    // the endpoint's *current* world position, so the connector survives
    // source deletion without snapping to the origin. (Q4 c1 policy.)
    // We compute the world position *before* removing the source from the
    // lookup so attached siteWorldPos still resolves.
    this.detachConnectorsTargeting(slide, elementId);
    slide.elements.splice(i, 1);
  }

  removeElements(slideId: string, elementIds: string[]): void {
    this.requireBatch();
    const slide = this.requireSlide(slideId);
    const set = new Set(elementIds);
    // Cascade sweep — convert any endpoint attached to one of the
    // about-to-be-removed elements into a free endpoint at its last
    // world position before any source is dropped.
    for (const id of set) {
      this.detachConnectorsTargeting(slide, id);
    }
    slide.elements = slide.elements.filter((e) => !set.has(e.id));
  }

  updateElementFrame(
    slideId: string, elementId: string, frame: Partial<Frame>,
  ): void {
    this.requireBatch();
    const slide = this.requireSlide(slideId);
    const e = slide.elements[this.requireElementIndex(slide, elementId)];
    e.frame = { ...e.frame, ...frame };
    // Recompute cached frames of connectors whose endpoints attach to
    // this element. The renderer reads endpoints live, so the visual
    // line already follows the source move — but selection bbox /
    // hit-testing uses the cached `frame`, which must stay fresh.
    // This is derived state; the snapshot-based undo already restores
    // the prior frame from the pre-batch snapshot.
    const lookup = this.elementsLookup(slideId);
    for (const el of slide.elements) {
      if (el.type !== 'connector') continue;
      const dependsOnUs =
        (el.start.kind === 'attached' && el.start.elementId === elementId) ||
        (el.end.kind   === 'attached' && el.end.elementId   === elementId);
      if (dependsOnUs) {
        el.frame = computeConnectorFrame(el, lookup);
      }
    }
  }

  updateElementData(
    slideId: string, elementId: string, patch: object,
  ): void {
    this.requireBatch();
    const slide = this.requireSlide(slideId);
    const e = slide.elements[this.requireElementIndex(slide, elementId)];
    if (e.type === 'connector') {
      // Connectors have no `data` sub-object; use `updateConnectorEndpoint`
      // or `updateConnectorArrowheads` instead.
      throw new Error(
        `Element ${elementId} is a connector; use updateConnectorEndpoint / updateConnectorArrowheads`,
      );
    }
    // discriminated union — patch only the data sub-object.
    e.data = { ...(e.data as object), ...clone(patch) } as typeof e.data;
  }

  updateConnectorEndpoint(
    slideId: string,
    elementId: string,
    side: 'start' | 'end',
    endpoint: Endpoint,
  ): void {
    this.requireBatch();
    const slide = this.requireSlide(slideId);
    const e = slide.elements[this.requireElementIndex(slide, elementId)];
    if (e.type !== 'connector') {
      throw new Error(`Element ${elementId} is not a connector`);
    }
    e[side] = clone(endpoint);
    e.frame = computeConnectorFrame(e, this.elementsLookup(slideId));
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
    const slide = this.requireSlide(slideId);
    const e = slide.elements[this.requireElementIndex(slide, elementId)];
    if (e.type !== 'connector') {
      throw new Error(`Element ${elementId} is not a connector`);
    }
    // Build a fresh arrowheads object — never mutate the existing one
    // in place, since other places may hold a snapshot reference to it.
    const next: { start?: ArrowheadStyle; end?: ArrowheadStyle } = {
      ...e.arrowheads,
    };
    for (const side of ['start', 'end'] as const) {
      if (!(side in heads)) continue; // `undefined` means "don't touch"
      const value = heads[side];
      if (value === null) {
        delete next[side];
      } else if (value !== undefined) {
        next[side] = clone(value);
      }
    }
    e.arrowheads = next;
  }

  reorderElement(
    slideId: string, elementId: string, toIndex: number,
  ): void {
    this.requireBatch();
    const slide = this.requireSlide(slideId);
    const from = this.requireElementIndex(slide, elementId);
    const [el] = slide.elements.splice(from, 1);
    const clamped = Math.max(0, Math.min(toIndex, slide.elements.length));
    slide.elements.splice(clamped, 0, el);
  }

  // --- text bridges ---

  withTextElement(
    slideId: string, elementId: string,
    fn: (blocks: Block[]) => Block[] | void,
  ): void {
    this.requireBatch();
    const slide = this.requireSlide(slideId);
    const e = slide.elements[this.requireElementIndex(slide, elementId)];
    if (e.type !== 'text') {
      throw new Error(`Element ${elementId} is not a text element`);
    }
    const next = fn(e.data.blocks);
    if (next !== undefined) {
      e.data.blocks = clone(next);
    }
  }

  withNotes(
    slideId: string,
    fn: (blocks: Block[]) => Block[] | void,
  ): void {
    this.requireBatch();
    const slide = this.requireSlide(slideId);
    const next = fn(slide.notes);
    if (next !== undefined) {
      slide.notes = clone(next);
    }
  }

  // --- transactions ---

  batch(fn: () => void): void {
    if (this.batchDepth === 0) {
      this.undoStack.push(clone(this.doc));
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
    this.redoStack.push(clone(this.doc));
    this.doc = this.undoStack.pop()!;
  }

  redo(): void {
    if (!this.canRedo()) return;
    this.undoStack.push(clone(this.doc));
    this.doc = this.redoStack.pop()!;
  }

  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }

  // --- internal helpers ---

  private requireSlide(slideId: string): Slide {
    return this.doc.slides[this.requireSlideIndex(slideId)];
  }

  private requireSlideIndex(slideId: string): number {
    const i = this.doc.slides.findIndex((s) => s.id === slideId);
    if (i === -1) throw new Error(`Slide not found: ${slideId}`);
    return i;
  }

  private requireElementIndex(slide: Slide, elementId: string): number {
    const i = slide.elements.findIndex((e) => e.id === elementId);
    if (i === -1) throw new Error(`Element not found: ${elementId}`);
    return i;
  }

  private requireBatch(): void {
    if (this.batchDepth === 0) {
      throw new Error('Mutations must be wrapped in batch()');
    }
  }

  /**
   * Read-only id → Element map for the given slide. Used by the
   * connector frame helpers to resolve attached endpoints.
   */
  private elementsLookup(slideId: string): ReadonlyMap<string, Element> {
    const i = this.doc.slides.findIndex((s) => s.id === slideId);
    if (i === -1) return new Map();
    const slide = this.doc.slides[i];
    return new Map(slide.elements.map((e) => [e.id, e] as const));
  }

  /**
   * For every connector on `slide` whose `start` or `end` is attached
   * to `targetId`, convert that endpoint to a `free` endpoint pinned at
   * the endpoint's current world position, then refresh the connector's
   * cached `frame`. Caller must invoke this *before* removing the target
   * so attached `siteWorldPos` still resolves to a defined location.
   */
  private detachConnectorsTargeting(slide: Slide, targetId: string): void {
    const lookup = new Map(slide.elements.map((e) => [e.id, e] as const));
    for (const el of slide.elements) {
      if (el.type !== 'connector') continue;
      let mutated = false;
      for (const side of ['start', 'end'] as const) {
        const ep = el[side];
        if (ep.kind === 'attached' && ep.elementId === targetId) {
          const w = resolveEndpoint(ep, lookup);
          el[side] = { kind: 'free', x: w.x, y: w.y };
          mutated = true;
        }
      }
      if (mutated) {
        // Rebuild the lookup so any subsequent connector sees the
        // freshly-detached state — though in practice we only read the
        // frames of *other* elements, so this is defensive.
        el.frame = computeConnectorFrame(
          el,
          new Map(slide.elements.map((e) => [e.id, e] as const)),
        );
      }
    }
  }
}
