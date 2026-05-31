import { describe, it, expect } from 'vitest';
import type { Block } from '@wafflebase/docs';
import { MemSlidesStore } from '../../src/store/memory';
import { BUILT_IN_LAYOUTS } from '../../src/model/layout';
import type { ElementInit } from '../../src/model/element';

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

  it('addSlide stamps text placeholders with shrink autofit', () => {
    // End-to-end guard: the layout spec seeds autofit 'shrink', and the
    // master-typography re-seed during stamping must preserve it (a bare
    // `data = { blocks }` reassignment would drop it).
    const store = new MemSlidesStore();
    let sid!: string;
    store.batch(() => { sid = store.addSlide('title-body', 0); });
    const slide = store.read().slides.find((s) => s.id === sid)!;
    const textEls = slide.elements.filter((e) => e.type === 'text');
    expect(textEls.length).toBeGreaterThan(0);
    for (const el of textEls) {
      if (el.type === 'text') expect(el.data.autofit).toBe('shrink');
    }
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

  it('addSlide clamps a negative atIndex to 0 and large atIndex to length', () => {
    const store = new MemSlidesStore();
    let a!: string;
    let b!: string;
    let c!: string;
    let d!: string;
    store.batch(() => {
      a = store.addSlide('blank');
      b = store.addSlide('blank', -5);   // clamped to 0
      c = store.addSlide('blank', 999);  // clamped to length
      d = store.addSlide('blank', 1);    // explicit middle
    });
    // After insertions in order: b at 0, then a (was 0, pushed), then d at 1, then c at end.
    expect(store.read().slides.map((s) => s.id)).toEqual([b, d, a, c]);
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
    const bg = { fill: { kind: 'srgb' as const, value: '#ff0000' } };
    store.batch(() => {
      const id = store.addSlide('blank');
      store.updateSlideBackground(id, bg);
    });
    bg.fill.value = '#00ff00'; // mutating the input must not change the store
    const fill = store.read().slides[0].background.fill;
    expect(fill.kind).toBe('srgb');
    if (fill.kind === 'srgb') expect(fill.value).toBe('#ff0000');
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

  it('withShapeText seeds an empty body on first call and persists the return value', () => {
    const store = new MemSlidesStore();
    let id = '';
    let slideId = '';
    store.batch(() => {
      slideId = store.addSlide('blank');
      id = store.addElement(slideId, shapeInit());
      store.withShapeText(slideId, id, (blocks) => {
        // First entry: no prior text, so seeded with [].
        expect(blocks).toEqual([]);
        return [paragraph('Hello')];
      });
    });
    const e = store.read().slides[0].elements[0] as {
      data: { text?: { blocks: Block[] } };
    };
    expect(e.data.text?.blocks[0].inlines[0].text).toBe('Hello');
  });

  it('withShapeText preserves prior blocks on subsequent calls', () => {
    const store = new MemSlidesStore();
    let id = '';
    let slideId = '';
    store.batch(() => {
      slideId = store.addSlide('blank');
      id = store.addElement(slideId, shapeInit());
      store.withShapeText(slideId, id, () => [paragraph('first')]);
    });
    store.batch(() => {
      store.withShapeText(slideId, id, (blocks) => {
        expect(blocks[0].inlines[0].text).toBe('first');
        return [paragraph('second')];
      });
    });
    const e = store.read().slides[0].elements[0] as {
      data: { text?: { blocks: Block[] } };
    };
    expect(e.data.text?.blocks[0].inlines[0].text).toBe('second');
  });

  it('withShapeText preserves an empty body after the user clears typed text', () => {
    // Concurrency contract: once `data.text` exists, withShapeText only
    // writes the `blocks` field — it never deletes `data.text`. A peer
    // typing into the same shape during a blur must not have its content
    // wiped by the wholesale-field delete that an earlier draft did.
    // The renderer's `isBlocksEmpty` short-circuit means an empty body
    // is visually invisible, so persisting it is harmless.
    const store = new MemSlidesStore();
    let id = '';
    let slideId = '';
    store.batch(() => {
      slideId = store.addSlide('blank');
      id = store.addElement(slideId, shapeInit());
      store.withShapeText(slideId, id, () => [paragraph('typed')]);
    });
    store.batch(() => {
      store.withShapeText(slideId, id, () => [paragraph('')]);
    });
    const e = store.read().slides[0].elements[0] as {
      data: { text?: { blocks: Block[] } };
    };
    expect(e.data.text).toBeDefined();
    expect(e.data.text!.blocks[0].inlines[0].text).toBe('');
  });

  it('withShapeText is a no-op when entered with no body and exited with no body', () => {
    // Click-into-shape-then-blur (no typing) must not materialise an
    // empty `data.text` on a shape that previously had none — keeps
    // freshly-inserted shapes clean.
    const store = new MemSlidesStore();
    let id = '';
    let slideId = '';
    store.batch(() => {
      slideId = store.addSlide('blank');
      id = store.addElement(slideId, shapeInit());
      store.withShapeText(slideId, id, () => [paragraph('')]);
    });
    const e = store.read().slides[0].elements[0] as {
      data: { text?: { blocks: Block[] } };
    };
    expect(e.data.text).toBeUndefined();
  });

  it('withShapeText throws on a non-shape element', () => {
    const store = new MemSlidesStore();
    store.batch(() => {
      const slide = store.addSlide('blank');
      const id = store.addElement(slide, textInit(0));
      expect(() => store.withShapeText(slide, id, () => undefined)).toThrow(
        /not a shape element/,
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

describe('MemSlidesStore — addSlide stamps placeholderRef', () => {
  it('annotates new placeholder elements with type and per-type index', () => {
    const store = new MemSlidesStore();
    let slideId = '';
    store.batch(() => {
      slideId = store.addSlide('title-two-columns');
    });
    const doc = store.read();
    const slide = doc.slides.find((s) => s.id === slideId)!;
    expect(slide.elements.map((e) => e.placeholderRef)).toEqual([
      { type: 'title', index: 0 },
      { type: 'body',  index: 0 },
      { type: 'body',  index: 1 },
    ]);
  });

  it('annotates layouts with no placeholders as empty (blank)', () => {
    const store = new MemSlidesStore();
    let slideId = '';
    store.batch(() => {
      slideId = store.addSlide('blank');
    });
    const doc = store.read();
    const slide = doc.slides.find((s) => s.id === slideId)!;
    expect(slide.elements).toEqual([]);
  });

  it('resets index per slot type — caption layout has body[0] then caption[0]', () => {
    const store = new MemSlidesStore();
    let slideId = '';
    store.batch(() => {
      slideId = store.addSlide('caption');
    });
    const doc = store.read();
    const slide = doc.slides.find((s) => s.id === slideId)!;
    expect(slide.elements.map((e) => e.placeholderRef)).toEqual([
      { type: 'body', index: 0 },
      { type: 'caption', index: 0 },
    ]);
  });
});

describe('MemSlidesStore — addSlide seeds master typography', () => {
  it('title placeholder gets fontSize 44, heading font, role-bound color, left align', () => {
    const store = new MemSlidesStore();
    let slideId = '';
    store.batch(() => { slideId = store.addSlide('title-body'); });
    const doc = store.read();
    const slide = doc.slides.find((s) => s.id === slideId)!;
    const titleEl = slide.elements.find((e) => e.placeholderRef?.type === 'title');
    expect(titleEl?.type).toBe('text');
    if (titleEl?.type === 'text') {
      const inline = titleEl.data.blocks[0]?.inlines[0];
      expect(inline?.style.fontSize).toBe(44);
      expect(typeof inline?.style.fontFamily).toBe('string');
      expect(inline?.style.color).toEqual({ kind: 'role', role: 'text' });
      expect(titleEl.data.blocks[0]?.style.alignment).toBe('left');
    }
  });

  it('big-number placeholder gets fontSize 96, center alignment', () => {
    const store = new MemSlidesStore();
    let slideId = '';
    store.batch(() => { slideId = store.addSlide('big-number'); });
    const doc = store.read();
    const slide = doc.slides.find((s) => s.id === slideId)!;
    const bigEl = slide.elements.find((e) => e.placeholderRef?.type === 'big-number');
    if (bigEl?.type === 'text') {
      expect(bigEl.data.blocks[0]?.inlines[0]?.style.fontSize).toBe(96);
      expect(bigEl.data.blocks[0]?.style.alignment).toBe('center');
    }
  });
});

describe('MemSlidesStore — connector methods', () => {
  /**
   * Set up a slide with a target rectangle at (100,100)-(300,200) and a
   * connector whose `end` is attached to the target's N connection site
   * (siteIndex 0 → world position (200, 100)) and whose `start` is a
   * free endpoint at the origin.
   */
  function setup() {
    const store = new MemSlidesStore();
    let slideId = '';
    let targetId = '';
    let connectorId = '';
    store.batch(() => {
      slideId = store.addSlide('blank');
      targetId = store.addElement(slideId, {
        type: 'shape',
        frame: { x: 100, y: 100, w: 200, h: 100, rotation: 0 },
        data: { kind: 'rect' },
      });
      connectorId = store.addElement(slideId, {
        type: 'connector',
        routing: 'straight',
        start: { kind: 'free', x: 0, y: 0 },
        end:   { kind: 'attached', elementId: targetId, siteIndex: 0 }, // N site
        arrowheads: {},
        frame: { x: 0, y: 0, w: 0, h: 0, rotation: 0 },
      });
    });
    return { store, slideId, targetId, connectorId };
  }

  it('addElement persists a connector with both endpoints', () => {
    const { store, slideId, targetId, connectorId } = setup();
    const slide = store.read().slides.find((s) => s.id === slideId)!;
    const c = slide.elements.find((e) => e.id === connectorId);
    expect(c?.type).toBe('connector');
    if (c?.type === 'connector') {
      expect(c.start).toEqual({ kind: 'free', x: 0, y: 0 });
      expect(c.end).toEqual({
        kind: 'attached', elementId: targetId, siteIndex: 0,
      });
    }
  });

  it('updateConnectorEndpoint replaces one endpoint and recomputes frame', () => {
    const { store, slideId, connectorId } = setup();
    store.batch(() => {
      store.updateConnectorEndpoint(slideId, connectorId, 'start', {
        kind: 'free', x: 42, y: 7,
      });
    });
    const c = store.read().slides
      .find((s) => s.id === slideId)!.elements
      .find((e) => e.id === connectorId);
    expect(c?.type).toBe('connector');
    if (c?.type === 'connector') {
      expect(c.start).toEqual({ kind: 'free', x: 42, y: 7 });
      // Frame is the tight bbox of (42,7) and the target N site (200,100),
      // expanded by half the default stroke width. min-x should not exceed 42.
      expect(c.frame.x).toBeLessThanOrEqual(42);
      expect(c.frame.y).toBeLessThanOrEqual(7);
    }
  });

  it('updateConnectorEndpoint throws when target element is not a connector', () => {
    const { store, slideId, targetId } = setup();
    store.batch(() => {
      expect(() =>
        store.updateConnectorEndpoint(slideId, targetId, 'start', {
          kind: 'free', x: 0, y: 0,
        }),
      ).toThrow(/not a connector/);
    });
  });

  it('updateElementFrame throws when target is a connector', () => {
    const { store, slideId, connectorId } = setup();
    expect(() => {
      store.batch(() => {
        store.updateElementFrame(slideId, connectorId, { x: 999 });
      });
    }).toThrow(/connector/i);
  });

  it('removeElement of attached target converts endpoint to free at last world position', () => {
    const { store, slideId, targetId, connectorId } = setup();
    // Target N site = (200, 100).
    store.batch(() => { store.removeElement(slideId, targetId); });
    const slide = store.read().slides.find((s) => s.id === slideId)!;
    const c = slide.elements.find((e) => e.id === connectorId);
    expect(c?.type).toBe('connector');
    if (c?.type === 'connector') {
      expect(c.end).toEqual({ kind: 'free', x: 200, y: 100 });
    }
  });

  it('removeElement undo restores both target and attached endpoint', () => {
    const { store, slideId, targetId, connectorId } = setup();
    store.batch(() => { store.removeElement(slideId, targetId); });
    store.undo();
    const slide = store.read().slides.find((s) => s.id === slideId)!;
    const c = slide.elements.find((e) => e.id === connectorId);
    expect(slide.elements.some((e) => e.id === targetId)).toBe(true);
    expect(c?.type).toBe('connector');
    if (c?.type === 'connector') {
      expect(c.end).toEqual({
        kind: 'attached', elementId: targetId, siteIndex: 0,
      });
    }
  });

  it('removeElements detaches connectors attached to any of the removed ids', () => {
    const { store, slideId, targetId, connectorId } = setup();
    store.batch(() => { store.removeElements(slideId, [targetId]); });
    const slide = store.read().slides.find((s) => s.id === slideId)!;
    const c = slide.elements.find((e) => e.id === connectorId);
    expect(slide.elements.some((e) => e.id === targetId)).toBe(false);
    if (c?.type === 'connector') {
      expect(c.end).toEqual({ kind: 'free', x: 200, y: 100 });
    }
  });

  it('updateConnectorArrowheads toggles end arrowhead', () => {
    const { store, slideId, connectorId } = setup();
    store.batch(() => {
      store.updateConnectorArrowheads(slideId, connectorId, {
        end: { kind: 'triangle', size: 'md' },
      });
    });
    const c1 = store.read().slides.find((s) => s.id === slideId)!
      .elements.find((e) => e.id === connectorId);
    if (c1?.type === 'connector') {
      expect(c1.arrowheads.end).toEqual({ kind: 'triangle', size: 'md' });
    }

    store.batch(() => {
      store.updateConnectorArrowheads(slideId, connectorId, { end: null });
    });
    const c2 = store.read().slides.find((s) => s.id === slideId)!
      .elements.find((e) => e.id === connectorId);
    if (c2?.type === 'connector') {
      expect(c2.arrowheads.end).toBeUndefined();
    }
  });

  it('updateConnectorArrowheads leaves untouched sides alone', () => {
    const { store, slideId, connectorId } = setup();
    store.batch(() => {
      store.updateConnectorArrowheads(slideId, connectorId, {
        start: { kind: 'circle', size: 'sm' },
        end:   { kind: 'triangle', size: 'lg' },
      });
    });
    store.batch(() => {
      // Only patch `end`; `start` must remain.
      store.updateConnectorArrowheads(slideId, connectorId, {
        end: { kind: 'diamond', size: 'md' },
      });
    });
    const c = store.read().slides.find((s) => s.id === slideId)!
      .elements.find((e) => e.id === connectorId);
    if (c?.type === 'connector') {
      expect(c.arrowheads.start).toEqual({ kind: 'circle', size: 'sm' });
      expect(c.arrowheads.end).toEqual({ kind: 'diamond', size: 'md' });
    }
  });

  it('duplicateSlide rewrites attached connector endpoint ids on the copy', () => {
    const { store, slideId, targetId, connectorId } = setup();
    let copyId = '';
    store.batch(() => { copyId = store.duplicateSlide(slideId); });
    const doc = store.read();
    const copySlide = doc.slides.find((s) => s.id === copyId)!;
    // The copy contains regenerated ids — neither matches the source.
    expect(copySlide.elements.map((e) => e.id))
      .not.toContain(targetId);
    expect(copySlide.elements.map((e) => e.id))
      .not.toContain(connectorId);
    // Locate the copy's connector + its target by type, not by id.
    const copyConnector = copySlide.elements.find((e) => e.type === 'connector');
    const copyTarget = copySlide.elements.find((e) => e.type === 'shape');
    expect(copyConnector?.type).toBe('connector');
    expect(copyTarget?.type).toBe('shape');
    if (copyConnector?.type === 'connector' && copyTarget) {
      // The copy's connector must attach to the COPY's target, not the
      // original target. Pre-fix, the connector still pointed at
      // `targetId` and resolveEndpoint's missing-target fallback would
      // snap it to (0, 0) when rendered on the copy slide.
      expect(copyConnector.end).toEqual({
        kind: 'attached',
        elementId: copyTarget.id,
        siteIndex: 0,
      });
      // Cached frame must also be derived from the rewritten endpoint
      // (i.e. the copy's target's N site at (200, 100)), so the bbox
      // matches the original.
      const orig = doc.slides
        .find((s) => s.id === slideId)!.elements
        .find((e) => e.id === connectorId);
      if (orig?.type === 'connector') {
        expect(copyConnector.frame).toEqual(orig.frame);
      }
    }
  });

  it('addElement recomputes frame for connector even if init.frame is degenerate', () => {
    const store = new MemSlidesStore();
    let slideId = '';
    let connectorId = '';
    store.batch(() => {
      slideId = store.addSlide('blank');
      connectorId = store.addElement(slideId, {
        type: 'connector',
        routing: 'straight',
        start: { kind: 'free', x: 100, y: 100 },
        end:   { kind: 'free', x: 400, y: 200 },
        arrowheads: {},
        // Deliberately degenerate — simulates a future paste/import
        // path that stores a stale or zero frame.
        frame: { x: 0, y: 0, w: 0, h: 0, rotation: 0 },
        stroke: { color: { kind: 'role', role: 'text' }, width: 2 },
      });
    });
    const c = store.read().slides[0].elements.find((e) => e.id === connectorId);
    expect(c?.type).toBe('connector');
    if (c?.type === 'connector') {
      // Frame derived from endpoints, not the degenerate input.
      expect(c.frame.w).toBeGreaterThan(0);
      expect(c.frame.h).toBeGreaterThan(0);
      expect(c.frame.x).toBeLessThanOrEqual(100);
      expect(c.frame.y).toBeLessThanOrEqual(100);
    }
  });

  it('updateElementFrame on attached target recomputes connector frame', () => {
    const { store, slideId, targetId, connectorId } = setup();
    const slide1 = store.read().slides.find((s) => s.id === slideId)!;
    const f1 = slide1.elements.find((e) => e.id === connectorId)!.frame;

    // Move the target by 400 in both axes.
    store.batch(() => {
      store.updateElementFrame(slideId, targetId, { x: 500, y: 500 });
    });

    const slide2 = store.read().slides.find((s) => s.id === slideId)!;
    const f2 = slide2.elements.find((e) => e.id === connectorId)!.frame;
    // After the move the attached endpoint's world position is (600, 500),
    // not (200, 100), so the bbox must differ.
    expect(f2).not.toEqual(f1);
  });

  it('updateConnectorRouting switches the routing field', () => {
    const { store, slideId, connectorId } = setup();
    store.batch(() => store.updateConnectorRouting(slideId, connectorId, 'curved'));
    const c = store.read().slides
      .find((s) => s.id === slideId)!.elements
      .find((e) => e.id === connectorId);
    expect(c?.type).toBe('connector');
    if (c?.type === 'connector') expect(c.routing).toBe('curved');
  });

  it('updateConnectorRouting clears elbowBend when leaving elbow routing', () => {
    const { store, slideId, connectorId } = setup();
    store.batch(() => store.updateConnectorRouting(slideId, connectorId, 'elbow'));
    store.batch(() => store.updateConnectorElbowBend(slideId, connectorId, 0.3));
    let c = store.read().slides
      .find((s) => s.id === slideId)!.elements
      .find((e) => e.id === connectorId);
    if (c?.type === 'connector') expect(c.elbowBend).toBe(0.3);

    store.batch(() => store.updateConnectorRouting(slideId, connectorId, 'curved'));
    c = store.read().slides
      .find((s) => s.id === slideId)!.elements
      .find((e) => e.id === connectorId);
    if (c?.type === 'connector') expect(c.elbowBend).toBeUndefined();
  });

  it('updateConnectorElbowBend rounds to 0.01 and clears on undefined', () => {
    const { store, slideId, connectorId } = setup();
    store.batch(() => store.updateConnectorElbowBend(slideId, connectorId, 0.123456));
    let c = store.read().slides
      .find((s) => s.id === slideId)!.elements
      .find((e) => e.id === connectorId);
    if (c?.type === 'connector') expect(c.elbowBend).toBe(0.12);
    store.batch(() => store.updateConnectorElbowBend(slideId, connectorId, undefined));
    c = store.read().slides
      .find((s) => s.id === slideId)!.elements
      .find((e) => e.id === connectorId);
    if (c?.type === 'connector') expect(c.elbowBend).toBeUndefined();
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

describe('MemSlidesStore — guides', () => {
  it('starts with no guides', () => {
    const store = new MemSlidesStore();
    expect(store.read().guides).toEqual([]);
  });

  it('addGuide appends and returns a stable id', () => {
    const store = new MemSlidesStore();
    let id!: string;
    store.batch(() => {
      id = store.addGuide('x', 400);
    });
    expect(store.read().guides).toEqual([
      { id, axis: 'x', position: 400 },
    ]);
  });

  it('moveGuide updates only the targeted guide position', () => {
    const store = new MemSlidesStore();
    let a!: string;
    let b!: string;
    store.batch(() => {
      a = store.addGuide('x', 100);
      b = store.addGuide('y', 250);
    });
    store.batch(() => store.moveGuide(a, 175));
    const guides = store.read().guides;
    expect(guides.find((g) => g.id === a)?.position).toBe(175);
    expect(guides.find((g) => g.id === b)?.position).toBe(250);
  });

  it('removeGuide drops the guide from the list', () => {
    const store = new MemSlidesStore();
    let id!: string;
    store.batch(() => {
      id = store.addGuide('x', 100);
      store.addGuide('y', 200);
    });
    store.batch(() => store.removeGuide(id));
    const guides = store.read().guides;
    expect(guides).toHaveLength(1);
    expect(guides[0].axis).toBe('y');
  });

  it('moveGuide throws on missing id', () => {
    const store = new MemSlidesStore();
    expect(() =>
      store.batch(() => store.moveGuide('does-not-exist', 0)),
    ).toThrow(/Guide not found/);
  });

  it('removeGuide throws on missing id', () => {
    const store = new MemSlidesStore();
    expect(() =>
      store.batch(() => store.removeGuide('does-not-exist')),
    ).toThrow(/Guide not found/);
  });

  it('mutations require a batch', () => {
    const store = new MemSlidesStore();
    expect(() => store.addGuide('x', 100)).toThrow(/must be wrapped in batch/);
    expect(() => store.moveGuide('id', 100)).toThrow(/must be wrapped in batch/);
    expect(() => store.removeGuide('id')).toThrow(/must be wrapped in batch/);
  });

  it('groups add + move + remove into one undo step when wrapped in batch', () => {
    const store = new MemSlidesStore();
    store.batch(() => {
      const id = store.addGuide('x', 100);
      store.moveGuide(id, 200);
      store.removeGuide(id);
    });
    expect(store.read().guides).toEqual([]);
    store.undo();
    // Single undo restores the pre-batch state (no guide).
    expect(store.read().guides).toEqual([]);
  });

  it('undoing addGuide drops the guide', () => {
    const store = new MemSlidesStore();
    store.batch(() => store.addGuide('x', 100));
    expect(store.read().guides).toHaveLength(1);
    store.undo();
    expect(store.read().guides).toEqual([]);
  });
});
