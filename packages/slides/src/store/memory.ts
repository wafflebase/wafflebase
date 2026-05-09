import type { SlidesStore } from './store';
import type {
  Background,
  Slide,
  SlidesDocument,
} from '../model/presentation';
import type { Block } from '@wafflebase/docs';
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
    slide.elements.splice(i, 1);
  }

  removeElements(slideId: string, elementIds: string[]): void {
    this.requireBatch();
    const slide = this.requireSlide(slideId);
    const set = new Set(elementIds);
    slide.elements = slide.elements.filter((e) => !set.has(e.id));
  }

  updateElementFrame(
    slideId: string, elementId: string, frame: Partial<Frame>,
  ): void {
    this.requireBatch();
    const slide = this.requireSlide(slideId);
    const e = slide.elements[this.requireElementIndex(slide, elementId)];
    e.frame = { ...e.frame, ...frame };
  }

  updateElementData(
    slideId: string, elementId: string, patch: object,
  ): void {
    this.requireBatch();
    const slide = this.requireSlide(slideId);
    const e = slide.elements[this.requireElementIndex(slide, elementId)];
    // discriminated union — patch only the data sub-object.
    e.data = { ...(e.data as object), ...clone(patch) } as typeof e.data;
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
}
