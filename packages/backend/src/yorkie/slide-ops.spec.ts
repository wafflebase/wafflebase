import { BUILT_IN_LAYOUTS, MemSlidesStore } from '@wafflebase/slides';
import type { Slide, SlidesDocument } from '@wafflebase/slides';
import {
  SlideOpResult,
  addSlide,
  applySlideChange,
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

/**
 * Land the op's change on a copy of the deck's own `slides` array, the way the
 * controller lands it on the live CRDT array. Returns the resulting array and
 * the affected slide's 1-based position — the operation is only meaningful
 * together with its application, and a plain array exercises the same
 * `applySlideChange` a Yorkie proxy does (minus the in-place reorder, which
 * `moveSlide` covers separately below).
 */
function applied(
  before: SlidesDocument,
  result: SlideOpResult,
): { slides: Slide[]; index?: number } {
  if (!result.ok) throw new Error(`operation failed: ${result.reason}`);
  const slides = [...before.slides];
  const index = applySlideChange(slides, result.change);
  return { slides, index };
}

describe('addSlide', () => {
  it('appends a slide seeded from the layout', () => {
    const before = deck(1);
    const result = addSlide(before, 'title-body');
    expect(result.ok).toBe(true);
    const { slides, index } = applied(before, result);

    expect(slides).toHaveLength(2);
    expect(index).toBe(2);
    expect(slides[1].id).toBe(result.ok && result.id);
    expect(slides[1].layoutId).toBe('title-body');
    // The layout's two placeholders come back as real elements, which is the
    // work this endpoint exists to avoid making a caller do by hand.
    expect(slides[1].elements).toHaveLength(2);
  });

  it('inserts at a 1-based position', () => {
    const before = deck(2);
    const result = addSlide(before, 'blank', 1);
    const { slides, index } = applied(before, result);
    expect(slides[0].id).toBe(result.ok && result.id);
    expect(index).toBe(1);
  });

  it('clamps a position past the end to an append', () => {
    const before = deck(2);
    expect(applied(before, addSlide(before, 'blank', 99)).index).toBe(3);
  });

  it('leaves the caller-supplied document untouched', () => {
    const before = deck(1);
    addSlide(before, 'blank');
    expect(before.slides).toHaveLength(1);
  });

  it('carries only the new slide, never a replacement deck', () => {
    // The whole reason these verbs exist beside `PUT .../content`: assigning
    // a whole array is last-write-wins over the deck.
    const result = addSlide(deck(2), 'blank');
    expect(result.ok && result.change).toMatchObject({ kind: 'insert' });
    expect(result).not.toHaveProperty('slides');
  });
});

describe('duplicateSlide', () => {
  it('inserts the copy right after the source with fresh ids', () => {
    const before = deck(2);
    const sourceId = before.slides[0].id;
    const result = duplicateSlide(before, sourceId);
    expect(result.ok).toBe(true);
    const { slides, index } = applied(before, result);

    expect(slides).toHaveLength(3);
    expect(index).toBe(2);
    expect(result.ok && result.id).not.toBe(sourceId);
    const copy = slides[1];
    expect(copy.layoutId).toBe(before.slides[0].layoutId);
    const sourceElementIds = before.slides[0].elements.map((e) => e.id);
    for (const element of copy.elements) {
      expect(sourceElementIds).not.toContain(element.id);
    }
  });

  it('resolves the insertion point by source id, not by index', () => {
    // A concurrent insert ahead of the source must not push the copy onto
    // the wrong slide, which is why the change carries `afterId`.
    const before = deck(2);
    const sourceId = before.slides[1].id;
    const result = duplicateSlide(before, sourceId);
    if (!result.ok) throw new Error('unexpected failure');
    const live = [{ id: 'inserted-by-a-peer' } as Slide, ...before.slides];
    expect(applySlideChange(live, result.change)).toBe(4);
    expect(live[2].id).toBe(sourceId);
    expect(live[3].id).toBe(result.id);
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
    const { slides, index } = applied(before, result);
    expect(slides).toHaveLength(1);
    expect(slides[0].id).toBe(before.slides[1].id);
    expect(index).toBeUndefined();
  });

  it('refuses the last remaining slide', () => {
    const one = deck(1);
    expect(deleteSlide(one, one.slides[0].id)).toEqual({
      ok: false,
      reason: 'last_slide',
    });
  });

  it('is a no-op when the slide is already gone at apply time', () => {
    const before = deck(2);
    const result = deleteSlide(before, before.slides[0].id);
    if (!result.ok) throw new Error('unexpected failure');
    const live = [before.slides[1]];
    expect(applySlideChange(live, result.change)).toBeUndefined();
    expect(live).toHaveLength(1);
  });
});

describe('moveSlide', () => {
  it('moves a slide to a 1-based position', () => {
    const before = deck(3);
    const lastId = before.slides[2].id;
    const result = moveSlide(before, lastId, 1);
    const { slides, index } = applied(before, result);
    expect(slides[0].id).toBe(lastId);
    expect(index).toBe(1);
  });

  it('clamps a position past the end', () => {
    const before = deck(3);
    const firstId = before.slides[0].id;
    const result = moveSlide(before, firstId, 99);
    expect(applied(before, result).slides[2].id).toBe(firstId);
  });

  it('reorders in place when the array offers it, never rebuilding', () => {
    // A Yorkie array proxy has `moveAfterByIndex` / `moveFront`, which keep a
    // peer's concurrent edit to the moved slide's children. Remove-and-insert
    // would rebuild the subtree and drop it.
    const before = deck(3);
    const calls: string[] = [];
    const slides = [...before.slides] as unknown as Slide[] & {
      moveFront(id: unknown): void;
      moveAfterByIndex(prev: number, target: number): void;
      getElementByIndex(i: number): { getID(): unknown };
    };
    slides.moveFront = (id) => calls.push(`moveFront:${String(id)}`);
    slides.moveAfterByIndex = (prev, target) =>
      calls.push(`moveAfterByIndex:${prev}:${target}`);
    slides.getElementByIndex = (i) => ({ getID: () => `ticket-${i}` });
    const spliced = jest.spyOn(slides, 'splice');

    const toFront = moveSlide(before, before.slides[2].id, 1);
    if (!toFront.ok) throw new Error('unexpected failure');
    applySlideChange(slides, toFront.change);

    const toBack = moveSlide(before, before.slides[0].id, 3);
    if (!toBack.ok) throw new Error('unexpected failure');
    applySlideChange(slides, toBack.change);

    expect(calls).toEqual(['moveFront:ticket-2', 'moveAfterByIndex:2:0']);
    expect(spliced).not.toHaveBeenCalled();
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
