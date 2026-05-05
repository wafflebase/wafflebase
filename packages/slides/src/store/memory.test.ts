import { describe, it, expect } from 'vitest';
import { MemSlidesStore } from './memory';
import { BUILT_IN_LAYOUTS } from '../model/layout';

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
    const id = store.addSlide('blank');
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    expect(store.read().slides.map((s) => s.id)).toEqual([id]);
  });

  it('addSlide with atIndex inserts at that position', () => {
    const store = new MemSlidesStore();
    const a = store.addSlide('blank');
    const b = store.addSlide('blank');
    const c = store.addSlide('blank', 1); // between a and b
    expect(store.read().slides.map((s) => s.id)).toEqual([a, c, b]);
  });

  it('addSlide("title-body") seeds two text placeholders', () => {
    const store = new MemSlidesStore();
    const id = store.addSlide('title-body');
    const slide = store.read().slides.find((s) => s.id === id)!;
    expect(slide.elements).toHaveLength(2);
    expect(slide.elements.every((e) => e.type === 'text')).toBe(true);
    expect(slide.layoutId).toBe('title-body');
  });

  it('removeSlide drops the slide', () => {
    const store = new MemSlidesStore();
    const id = store.addSlide('blank');
    store.removeSlide(id);
    expect(store.read().slides).toEqual([]);
  });

  it('removeSlides removes a set in one call', () => {
    const store = new MemSlidesStore();
    const a = store.addSlide('blank');
    const b = store.addSlide('blank');
    const c = store.addSlide('blank');
    store.removeSlides([a, c]);
    expect(store.read().slides.map((s) => s.id)).toEqual([b]);
  });

  it('moveSlide reorders', () => {
    const store = new MemSlidesStore();
    const a = store.addSlide('blank');
    const b = store.addSlide('blank');
    const c = store.addSlide('blank');
    store.moveSlide(c, 0);
    expect(store.read().slides.map((s) => s.id)).toEqual([c, a, b]);
  });

  it('duplicateSlide deep-copies and inserts after the source', () => {
    const store = new MemSlidesStore();
    const original = store.addSlide('title-body');
    const copyId = store.duplicateSlide(original);
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
    const id = store.addSlide('blank');
    const bg = { fill: '#ff0000' };
    store.updateSlideBackground(id, bg);
    bg.fill = '#00ff00'; // mutating the input must not change the store
    expect(store.read().slides[0].background.fill).toBe('#ff0000');
  });
});
