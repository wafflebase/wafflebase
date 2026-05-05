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

  // --- element ops (Task 7) ---
  addElement(_slideId: string, _init: ElementInit): string {
    throw new Error('not implemented yet');
  }
  removeElement(_slideId: string, _elementId: string): void {
    throw new Error('not implemented yet');
  }
  removeElements(_slideId: string, _elementIds: string[]): void {
    throw new Error('not implemented yet');
  }
  updateElementFrame(
    _slideId: string, _elementId: string, _frame: Partial<Frame>,
  ): void {
    throw new Error('not implemented yet');
  }
  updateElementData(
    _slideId: string, _elementId: string, _patch: object,
  ): void {
    throw new Error('not implemented yet');
  }
  reorderElement(
    _slideId: string, _elementId: string, _toIndex: number,
  ): void {
    throw new Error('not implemented yet');
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
}
