import { describe, it, expect } from 'vitest';
import {
  buildLayoutSlide,
  getLayout,
  layoutEditSlideId,
  parsePlaceholderElementId,
  placeholderElementId,
} from '../../src/model/layout';
import { DEFAULT_MASTER } from '../../src/model/master';
import { defaultLight } from '../../src/themes/default-light';

/**
 * PR3 commit 5a — `buildLayoutSlide` materializes a transient Slide from
 * a layout so the existing canvas editor can render and edit the layout's
 * placeholders. Never persisted; the LayoutEditStore proxy serves it from
 * `read()` and routes geometry commits back to the layout.
 */
describe('buildLayoutSlide', () => {
  it('materializes one element per placeholder, each carrying its (type,index) ref', () => {
    const layout = getLayout('title-body');
    const slide = buildLayoutSlide(layout, DEFAULT_MASTER, defaultLight);

    expect(slide.elements).toHaveLength(2);
    expect(slide.elements.map((e) => e.placeholderRef)).toEqual([
      { type: 'title', index: 0 },
      { type: 'body', index: 0 },
    ]);
  });

  it('indexes same-type slots so a second body placeholder is index 1', () => {
    const layout = getLayout('title-two-columns');
    const slide = buildLayoutSlide(layout, DEFAULT_MASTER, defaultLight);

    expect(slide.elements.map((e) => e.placeholderRef)).toEqual([
      { type: 'title', index: 0 },
      { type: 'body', index: 0 },
      { type: 'body', index: 1 },
    ]);
  });

  it('copies each placeholder frame from the layout spec', () => {
    const layout = getLayout('title-body');
    const slide = buildLayoutSlide(layout, DEFAULT_MASTER, defaultLight);

    expect(slide.elements[0].frame).toEqual(layout.placeholders[0].frame);
    expect(slide.elements[1].frame).toEqual(layout.placeholders[1].frame);
  });

  it('uses a stable synthetic id derived from the layout id', () => {
    const layout = getLayout('title-body');
    const slide = buildLayoutSlide(layout, DEFAULT_MASTER, defaultLight);

    expect(slide.id).toBe(layoutEditSlideId('title-body'));
    expect(slide.layoutId).toBe('title-body');
  });

  it('inherits background (empty) so the renderer resolves layout→master→theme', () => {
    const layout = getLayout('title-body');
    const slide = buildLayoutSlide(layout, DEFAULT_MASTER, defaultLight);

    expect(slide.background).toEqual({});
  });

  it('assigns deterministic, ref-derived element ids that are stable across builds', () => {
    const layout = getLayout('title-two-columns');
    const a = buildLayoutSlide(layout, DEFAULT_MASTER, defaultLight);
    const b = buildLayoutSlide(layout, DEFAULT_MASTER, defaultLight);

    // Same ids across two independent builds — the editor holds an id
    // between reading the slide and committing a drag, so a fresh
    // generateId() per build would break the ref mapping.
    expect(a.elements.map((e) => e.id)).toEqual(b.elements.map((e) => e.id));
    expect(a.elements.map((e) => e.id)).toEqual([
      placeholderElementId({ type: 'title', index: 0 }),
      placeholderElementId({ type: 'body', index: 0 }),
      placeholderElementId({ type: 'body', index: 1 }),
    ]);
  });

  it('round-trips placeholderElementId ↔ parsePlaceholderElementId, including hyphenated types', () => {
    for (const ref of [
      { type: 'title' as const, index: 0 },
      { type: 'body' as const, index: 1 },
      { type: 'big-number' as const, index: 0 },
      { type: 'subtitle' as const, index: 2 },
    ]) {
      expect(parsePlaceholderElementId(placeholderElementId(ref))).toEqual(ref);
    }
  });

  it('parsePlaceholderElementId returns undefined for non-placeholder ids', () => {
    expect(parsePlaceholderElementId('some-uuid-1234')).toBeUndefined();
    expect(parsePlaceholderElementId('__ph__bogustype_0')).toBeUndefined();
    expect(parsePlaceholderElementId('__ph__title_x')).toBeUndefined();
  });

  it('produces an empty-placeholder slide for the blank layout', () => {
    const layout = getLayout('blank');
    const slide = buildLayoutSlide(layout, DEFAULT_MASTER, defaultLight);

    expect(slide.elements).toEqual([]);
    expect(slide.notes).toEqual([]);
  });
});
