import { BUILT_IN_LAYOUTS, MemSlidesStore } from '@wafflebase/slides';
import type { SlidesDocument } from '@wafflebase/slides';
import {
  addSlide,
  deleteSlide,
  duplicateSlide,
  listLayouts,
  moveSlide,
} from './slide-ops';

/** A deck with `count` slides, built through the engine's own store. */
function deck(count: number): SlidesDocument {
  const store = new MemSlidesStore();
  store.batch(() => {
    for (let i = 0; i < count; i++) store.addSlide('title-body');
  });
  return store.read();
}

describe('addSlide', () => {
  it('appends a slide seeded from the layout', () => {
    const before = deck(1);
    const result = addSlide(before, 'title-body');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.slides).toHaveLength(2);
    expect(result.index).toBe(2);
    expect(result.slides[1].id).toBe(result.id);
    expect(result.slides[1].layoutId).toBe('title-body');
    // The layout's two placeholders come back as real elements, which is the
    // work this endpoint exists to avoid making a caller do by hand.
    expect(result.slides[1].elements).toHaveLength(2);
  });

  it('inserts at a 1-based position', () => {
    const before = deck(2);
    const result = addSlide(before, 'blank', 1);
    expect(result.ok && result.slides[0].id).toBe(result.ok && result.id);
    expect(result.ok && result.index).toBe(1);
  });

  it('clamps a position past the end to an append', () => {
    const result = addSlide(deck(2), 'blank', 99);
    expect(result.ok && result.index).toBe(3);
  });

  it('leaves the caller-supplied document untouched', () => {
    const before = deck(1);
    addSlide(before, 'blank');
    expect(before.slides).toHaveLength(1);
  });
});

describe('duplicateSlide', () => {
  it('inserts the copy right after the source with fresh ids', () => {
    const before = deck(2);
    const sourceId = before.slides[0].id;
    const result = duplicateSlide(before, sourceId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.slides).toHaveLength(3);
    expect(result.index).toBe(2);
    expect(result.id).not.toBe(sourceId);
    const copy = result.slides[1];
    expect(copy.layoutId).toBe(before.slides[0].layoutId);
    const sourceElementIds = before.slides[0].elements.map((e) => e.id);
    for (const element of copy.elements) {
      expect(sourceElementIds).not.toContain(element.id);
    }
  });

  it('reports not_found for an unknown slide', () => {
    expect(duplicateSlide(deck(1), 'nope')).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });
});

describe('deleteSlide', () => {
  it('removes the slide', () => {
    const before = deck(2);
    const result = deleteSlide(before, before.slides[0].id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.slides).toHaveLength(1);
    expect(result.slides[0].id).toBe(before.slides[1].id);
  });

  it('refuses the last remaining slide', () => {
    const one = deck(1);
    expect(deleteSlide(one, one.slides[0].id)).toEqual({
      ok: false,
      reason: 'last_slide',
    });
  });
});

describe('moveSlide', () => {
  it('moves a slide to a 1-based position', () => {
    const before = deck(3);
    const lastId = before.slides[2].id;
    const result = moveSlide(before, lastId, 1);
    expect(result.ok && result.slides[0].id).toBe(lastId);
    expect(result.ok && result.index).toBe(1);
  });

  it('clamps a position past the end', () => {
    const before = deck(3);
    const firstId = before.slides[0].id;
    const result = moveSlide(before, firstId, 99);
    expect(result.ok && result.slides[2].id).toBe(firstId);
  });

  it('reports not_found for an unknown slide', () => {
    expect(moveSlide(deck(2), 'nope', 1)).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });
});

describe('listLayouts', () => {
  it("reports the deck's own layouts", () => {
    const document = deck(1);
    const layouts = listLayouts(document, BUILT_IN_LAYOUTS);
    expect(layouts.length).toBe(document.layouts.length);
    const titleBody = layouts.find((l) => l.id === 'title-body');
    expect(titleBody).toMatchObject({
      name: 'Title and body',
      placeholders: ['title', 'body'],
    });
  });

  it('falls back to the built-in set for a deck with no layouts', () => {
    const document = { ...deck(1), layouts: [] };
    expect(listLayouts(document, BUILT_IN_LAYOUTS)).toHaveLength(
      BUILT_IN_LAYOUTS.length,
    );
  });
});
