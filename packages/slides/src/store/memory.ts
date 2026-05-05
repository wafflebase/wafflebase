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

  constructor(doc?: SlidesDocument) {
    this.doc = doc ? clone(doc) : emptyDocument();
  }

  read(): SlidesDocument {
    return clone(this.doc);
  }

  // --- slide ops ---

  addSlide(layoutId: string, atIndex?: number): string {
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
    const insertAt = atIndex ?? this.doc.slides.length;
    this.doc.slides.splice(insertAt, 0, slide);
    return id;
  }

  duplicateSlide(slideId: string): string {
    const index = this.requireSlideIndex(slideId);
    const source = this.doc.slides[index];
    const copy: Slide = clone(source);
    copy.id = generateId();
    copy.elements = copy.elements.map((e) => ({ ...e, id: generateId() }));
    this.doc.slides.splice(index + 1, 0, copy);
    return copy.id;
  }

  removeSlide(slideId: string): void {
    const index = this.requireSlideIndex(slideId);
    this.doc.slides.splice(index, 1);
  }

  removeSlides(slideIds: string[]): void {
    const set = new Set(slideIds);
    this.doc.slides = this.doc.slides.filter((s) => !set.has(s.id));
  }

  moveSlide(slideId: string, toIndex: number): void {
    const from = this.requireSlideIndex(slideId);
    const [slide] = this.doc.slides.splice(from, 1);
    const clamped = Math.max(0, Math.min(toIndex, this.doc.slides.length));
    this.doc.slides.splice(clamped, 0, slide);
  }

  moveSlides(slideIds: string[], toIndex: number): void {
    // Pull them out preserving relative order, then re-insert as a block.
    const set = new Set(slideIds);
    const moving = this.doc.slides.filter((s) => set.has(s.id));
    this.doc.slides = this.doc.slides.filter((s) => !set.has(s.id));
    const clamped = Math.max(0, Math.min(toIndex, this.doc.slides.length));
    this.doc.slides.splice(clamped, 0, ...moving);
  }

  updateSlideBackground(slideId: string, bg: Background): void {
    const slide = this.requireSlide(slideId);
    slide.background = clone(bg);
  }

  applyLayout(_slideId: string, _layoutId: string): void {
    throw new Error('not implemented yet');
  }

  // --- element ops ---

  addElement(slideId: string, init: ElementInit): string {
    const slide = this.requireSlide(slideId);
    const id = generateId();
    const element = { ...clone(init), id } as Element;
    slide.elements.push(element);
    return id;
  }

  removeElement(slideId: string, elementId: string): void {
    const slide = this.requireSlide(slideId);
    const i = this.requireElementIndex(slide, elementId);
    slide.elements.splice(i, 1);
  }

  removeElements(slideId: string, elementIds: string[]): void {
    const slide = this.requireSlide(slideId);
    const set = new Set(elementIds);
    slide.elements = slide.elements.filter((e) => !set.has(e.id));
  }

  updateElementFrame(
    slideId: string, elementId: string, frame: Partial<Frame>,
  ): void {
    const slide = this.requireSlide(slideId);
    const e = slide.elements[this.requireElementIndex(slide, elementId)];
    e.frame = { ...e.frame, ...frame };
  }

  updateElementData(
    slideId: string, elementId: string, patch: object,
  ): void {
    const slide = this.requireSlide(slideId);
    const e = slide.elements[this.requireElementIndex(slide, elementId)];
    // discriminated union — patch only the data sub-object.
    e.data = { ...(e.data as object), ...clone(patch) } as typeof e.data;
  }

  reorderElement(
    slideId: string, elementId: string, toIndex: number,
  ): void {
    const slide = this.requireSlide(slideId);
    const from = this.requireElementIndex(slide, elementId);
    const [el] = slide.elements.splice(from, 1);
    const clamped = Math.max(0, Math.min(toIndex, slide.elements.length));
    slide.elements.splice(clamped, 0, el);
  }

  // --- text bridges (Task 8) ---
  withTextElement(
    _slideId: string, _elementId: string,
    _fn: (blocks: Block[]) => Block[] | void,
  ): void {
    throw new Error('not implemented yet');
  }
  withNotes(
    _slideId: string,
    _fn: (blocks: Block[]) => Block[] | void,
  ): void {
    throw new Error('not implemented yet');
  }

  // --- transactions (Task 9) ---
  batch(_fn: () => void): void {
    throw new Error('not implemented yet');
  }
  undo(): void { /* Task 9 */ }
  redo(): void { /* Task 9 */ }
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
}
