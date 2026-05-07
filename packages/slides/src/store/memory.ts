import type { SlidesStore } from './store';
import type {
  Background,
  Slide,
  SlidesDocument,
} from '../model/presentation';
import type { Block } from '@wafflebase/docs';
import type { Element, ElementInit, Frame } from '../model/element';
import { generateId } from '../model/element';
import { BUILT_IN_LAYOUTS, getLayout } from '../model/layout';
import { DEFAULT_BACKGROUND } from '../model/presentation';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function emptyDocument(): SlidesDocument {
  return {
    meta: { title: 'Untitled presentation' },
    slides: [],
    layouts: clone(BUILT_IN_LAYOUTS),
  };
}

export class MemSlidesStore implements SlidesStore {
  private doc: SlidesDocument;
  private undoStack: SlidesDocument[] = [];
  private redoStack: SlidesDocument[] = [];
  private batchDepth = 0;

  constructor(doc?: SlidesDocument) {
    this.doc = doc ? clone(doc) : emptyDocument();
  }

  read(): SlidesDocument {
    return clone(this.doc);
  }

  // --- slide ops ---

  addSlide(layoutId: string, atIndex?: number): string {
    this.requireBatch();
    const layout = getLayout(layoutId);
    const id = generateId();
    const slide: Slide = {
      id,
      layoutId: layout.id,
      background: clone(DEFAULT_BACKGROUND),
      elements: layout.placeholders.map((p) => ({
        ...clone(p),
        id: generateId(),
      } as Element)),
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

  applyLayout(slideId: string, layoutId: string): void {
    this.requireBatch();
    const slide = this.requireSlide(slideId);
    const layout = getLayout(layoutId);
    slide.layoutId = layout.id;
    // Add placeholders that the slide does not already cover.
    // "Cover" here is conservative: we only add placeholders when the
    // slide currently has no element of the same type at the same frame
    // position. v2 master slides will replace this with real
    // placeholder identity tracking.
    for (const placeholder of layout.placeholders) {
      const matches = slide.elements.some(
        (e) => e.type === placeholder.type
          && e.frame.x === placeholder.frame.x
          && e.frame.y === placeholder.frame.y,
      );
      if (!matches) {
        slide.elements.push({
          ...clone(placeholder),
          id: generateId(),
        } as Element);
      }
    }
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
