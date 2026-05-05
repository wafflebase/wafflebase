import { describe, it, expect } from 'vitest';
import type { Block } from '@wafflebase/docs';
import { MemSlidesStore } from './memory';
import { BUILT_IN_LAYOUTS } from '../model/layout';
import type { ElementInit } from '../model/element';

// Local id helper for the test (the docs package re-exports its own,
// but we don't need to depend on it just for the test).
let n = 0;
function generateBlockId(): string {
  return `b${++n}`;
}

function paragraph(text: string): Block {
  return {
    id: generateBlockId(),
    type: 'paragraph',
    inlines: [{ text, style: {} }],
    style: {},
  } as Block;
}

describe('MemSlidesStore — slides', () => {
  it('starts with an empty presentation that knows the built-in layouts', () => {
    const store = new MemSlidesStore();
    const doc = store.read();
    expect(doc.slides).toEqual([]);
    expect(doc.layouts.map((l) => l.id)).toEqual(BUILT_IN_LAYOUTS.map((l) => l.id));
    expect(doc.meta.title).toBe('Untitled presentation');
  });

  it('addSlide appends and returns a fresh id', () => {
    const store = new MemSlidesStore();
    let id!: string;
    store.batch(() => { id = store.addSlide('blank'); });
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    expect(store.read().slides.map((s) => s.id)).toEqual([id]);
  });

  it('addSlide with atIndex inserts at that position', () => {
    const store = new MemSlidesStore();
    let a!: string;
    let b!: string;
    let c!: string;
    store.batch(() => {
      a = store.addSlide('blank');
      b = store.addSlide('blank');
      c = store.addSlide('blank', 1); // between a and b
    });
    expect(store.read().slides.map((s) => s.id)).toEqual([a, c, b]);
  });

  it('addSlide("title-body") seeds two text placeholders', () => {
    const store = new MemSlidesStore();
    let id!: string;
    store.batch(() => { id = store.addSlide('title-body'); });
    const slide = store.read().slides.find((s) => s.id === id)!;
    expect(slide.elements).toHaveLength(2);
    expect(slide.elements.every((e) => e.type === 'text')).toBe(true);
    expect(slide.layoutId).toBe('title-body');
  });

  it('removeSlide drops the slide', () => {
    const store = new MemSlidesStore();
    store.batch(() => {
      const id = store.addSlide('blank');
      store.removeSlide(id);
    });
    expect(store.read().slides).toEqual([]);
  });

  it('removeSlides removes a set in one call', () => {
    const store = new MemSlidesStore();
    let b!: string;
    store.batch(() => {
      const a = store.addSlide('blank');
      b = store.addSlide('blank');
      const c = store.addSlide('blank');
      store.removeSlides([a, c]);
    });
    expect(store.read().slides.map((s) => s.id)).toEqual([b]);
  });

  it('moveSlide reorders', () => {
    const store = new MemSlidesStore();
    let a!: string;
    let b!: string;
    let c!: string;
    store.batch(() => {
      a = store.addSlide('blank');
      b = store.addSlide('blank');
      c = store.addSlide('blank');
      store.moveSlide(c, 0);
    });
    expect(store.read().slides.map((s) => s.id)).toEqual([c, a, b]);
  });

  it('duplicateSlide deep-copies and inserts after the source', () => {
    const store = new MemSlidesStore();
    let original!: string;
    let copyId!: string;
    store.batch(() => {
      original = store.addSlide('title-body');
      copyId = store.duplicateSlide(original);
    });
    const slides = store.read().slides;
    expect(slides.map((s) => s.id)).toEqual([original, copyId]);
    expect(copyId).not.toBe(original);
    // Element ids must also be regenerated so the copy can edit independently.
    const orig = slides.find((s) => s.id === original)!;
    const copy = slides.find((s) => s.id === copyId)!;
    expect(orig.elements[0].id).not.toBe(copy.elements[0].id);
  });

  it('updateSlideBackground stores a clone, not a reference', () => {
    const store = new MemSlidesStore();
    const bg = { fill: '#ff0000' };
    store.batch(() => {
      const id = store.addSlide('blank');
      store.updateSlideBackground(id, bg);
    });
    bg.fill = '#00ff00'; // mutating the input must not change the store
    expect(store.read().slides[0].background.fill).toBe('#ff0000');
  });
});

const textInit = (x: number): ElementInit => ({
  type: 'text',
  frame: { x, y: 0, w: 100, h: 40, rotation: 0 },
  data: { blocks: [] },
});
const shapeInit = (kind: 'rect' | 'ellipse' = 'rect'): ElementInit => ({
  type: 'shape',
  frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
  data: { kind },
});

describe('MemSlidesStore — elements', () => {
  it('addElement assigns an id and appends in z-order', () => {
    const store = new MemSlidesStore();
    let a!: string;
    let b!: string;
    store.batch(() => {
      const slide = store.addSlide('blank');
      a = store.addElement(slide, textInit(10));
      b = store.addElement(slide, shapeInit('rect'));
    });
    const elements = store.read().slides[0].elements;
    expect(elements.map((e) => e.id)).toEqual([a, b]);
  });

  it('removeElement drops by id', () => {
    const store = new MemSlidesStore();
    store.batch(() => {
      const slide = store.addSlide('blank');
      const a = store.addElement(slide, textInit(10));
      store.removeElement(slide, a);
    });
    expect(store.read().slides[0].elements).toEqual([]);
  });

  it('removeElements drops a set in one call', () => {
    const store = new MemSlidesStore();
    let b!: string;
    store.batch(() => {
      const slide = store.addSlide('blank');
      const a = store.addElement(slide, textInit(10));
      b = store.addElement(slide, textInit(20));
      const c = store.addElement(slide, textInit(30));
      store.removeElements(slide, [a, c]);
    });
    expect(store.read().slides[0].elements.map((e) => e.id)).toEqual([b]);
  });

  it('updateElementFrame applies a partial patch', () => {
    const store = new MemSlidesStore();
    store.batch(() => {
      const slide = store.addSlide('blank');
      const id = store.addElement(slide, textInit(10));
      store.updateElementFrame(slide, id, { x: 100, w: 200 });
    });
    const e = store.read().slides[0].elements[0];
    expect(e.frame).toEqual({ x: 100, y: 0, w: 200, h: 40, rotation: 0 });
  });

  it('updateElementData merges a partial patch (image)', () => {
    const store = new MemSlidesStore();
    store.batch(() => {
      const slide = store.addSlide('blank');
      const id = store.addElement(slide, {
        type: 'image',
        frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
        data: { src: 'a.png', alt: 'before' },
      });
      store.updateElementData(slide, id, { alt: 'after' });
    });
    const e = store.read().slides[0].elements[0] as { data: { alt?: string; src: string } };
    expect(e.data.alt).toBe('after');
    expect(e.data.src).toBe('a.png');
  });

  it('reorderElement moves to a new z-index in the array', () => {
    const store = new MemSlidesStore();
    let a!: string;
    let b!: string;
    let c!: string;
    store.batch(() => {
      const slide = store.addSlide('blank');
      a = store.addElement(slide, textInit(0));
      b = store.addElement(slide, textInit(0));
      c = store.addElement(slide, textInit(0));
      // Bring `a` to front: index = length - 1.
      store.reorderElement(slide, a, 2);
    });
    expect(store.read().slides[0].elements.map((e) => e.id)).toEqual([b, c, a]);
  });

  it('throws on unknown slide or element', () => {
    const store = new MemSlidesStore();
    store.batch(() => {
      expect(() => store.addElement('nope', textInit(0))).toThrow(/Slide not found/);
      const slide = store.addSlide('blank');
      expect(() => store.removeElement(slide, 'nope')).toThrow(/Element not found/);
    });
  });
});

describe('MemSlidesStore — text bridges', () => {
  it('withTextElement passes the current blocks and persists the return value', () => {
    const store = new MemSlidesStore();
    store.batch(() => {
      const slide = store.addSlide('blank');
      const id = store.addElement(slide, {
        type: 'text',
        frame: { x: 0, y: 0, w: 100, h: 40, rotation: 0 },
        data: { blocks: [paragraph('hello')] },
      });
      store.withTextElement(slide, id, (blocks) => {
        expect(blocks[0].inlines[0].text).toBe('hello');
        return [paragraph('world')];
      });
    });
    const e = store.read().slides[0].elements[0] as { data: { blocks: Block[] } };
    expect(e.data.blocks[0].inlines[0].text).toBe('world');
  });

  it('withTextElement allows void return for in-place mutation', () => {
    const store = new MemSlidesStore();
    store.batch(() => {
      const slide = store.addSlide('blank');
      const id = store.addElement(slide, {
        type: 'text',
        frame: { x: 0, y: 0, w: 100, h: 40, rotation: 0 },
        data: { blocks: [paragraph('hi')] },
      });
      store.withTextElement(slide, id, (blocks) => {
        blocks[0].inlines[0].text = 'bye';
      });
    });
    const e = store.read().slides[0].elements[0] as { data: { blocks: Block[] } };
    expect(e.data.blocks[0].inlines[0].text).toBe('bye');
  });

  it('withTextElement throws on a non-text element', () => {
    const store = new MemSlidesStore();
    store.batch(() => {
      const slide = store.addSlide('blank');
      const id = store.addElement(slide, shapeInit());
      expect(() => store.withTextElement(slide, id, () => undefined)).toThrow(
        /not a text element/,
      );
    });
  });

  it('withNotes round-trips the speaker notes', () => {
    const store = new MemSlidesStore();
    store.batch(() => {
      const slide = store.addSlide('blank');
      store.withNotes(slide, () => [paragraph('remember to smile')]);
    });
    expect(store.read().slides[0].notes[0].inlines[0].text).toBe('remember to smile');
  });
});

describe('MemSlidesStore — applyLayout', () => {
  it('switches the layout id and adds missing placeholders', () => {
    const store = new MemSlidesStore();
    store.batch(() => {
      const slide = store.addSlide('blank');
      expect(store.read().slides[0].elements).toEqual([]);
      store.applyLayout(slide, 'title-body');
    });
    const after = store.read().slides[0];
    expect(after.layoutId).toBe('title-body');
    expect(after.elements).toHaveLength(2);
  });

  it('preserves user elements when the same layout is reapplied', () => {
    const store = new MemSlidesStore();
    let userShape!: string;
    store.batch(() => {
      const slide = store.addSlide('title-body');
      userShape = store.addElement(slide, shapeInit());
      expect(store.read().slides[0].elements).toHaveLength(3);
      store.applyLayout(slide, 'title-body');
    });
    const ids = store.read().slides[0].elements.map((e) => e.id);
    expect(ids).toContain(userShape);
    // Still has the two placeholders + the user shape.
    expect(ids).toHaveLength(3);
  });
});

describe('MemSlidesStore — batch / undo / redo', () => {
  it('batch groups multiple mutations into one undo entry', () => {
    const store = new MemSlidesStore();
    store.batch(() => {
      store.addSlide('blank');
      store.addSlide('blank');
    });
    expect(store.read().slides).toHaveLength(2);
    expect(store.canUndo()).toBe(true);
    store.undo();
    expect(store.read().slides).toHaveLength(0);
    expect(store.canRedo()).toBe(true);
    store.redo();
    expect(store.read().slides).toHaveLength(2);
  });

  it('a mutation outside any batch is its own undo entry', () => {
    const store = new MemSlidesStore();
    store.batch(() => store.addSlide('blank'));
    store.batch(() => store.addSlide('blank'));
    expect(store.read().slides).toHaveLength(2);
    store.undo();
    expect(store.read().slides).toHaveLength(1);
    store.undo();
    expect(store.read().slides).toHaveLength(0);
  });

  it('nested batches collapse into the outer batch', () => {
    const store = new MemSlidesStore();
    store.batch(() => {
      store.addSlide('blank');
      store.batch(() => {
        store.addSlide('blank');
      });
    });
    store.undo();
    expect(store.read().slides).toHaveLength(0);
  });

  it('any mutation after an undo clears the redo stack', () => {
    const store = new MemSlidesStore();
    store.batch(() => store.addSlide('blank'));
    store.undo();
    expect(store.canRedo()).toBe(true);
    store.batch(() => store.addSlide('title'));
    expect(store.canRedo()).toBe(false);
  });

  it('throws if a mutation is called outside a batch', () => {
    const store = new MemSlidesStore();
    expect(() => store.addSlide('blank')).toThrow(/must be wrapped in batch/);
  });
});
