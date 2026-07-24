import { describe, it, expect } from 'vitest';
import type { SlidesStore } from '@wafflebase/slides';
import { SYNTHETIC_SLIDE_ID } from '@wafflebase/board';
import { YorkieBoardStore } from './yorkie-board-store';
import { makeYorkieBoardDoc, makeShapeInit } from './__testkit__';

describe('YorkieBoardStore', () => {
  it('read() exposes one synthetic slide holding the elements', () => {
    const store: SlidesStore = new YorkieBoardStore(makeYorkieBoardDoc());
    const doc = store.read();
    expect(doc.slides).toHaveLength(1);
    expect(doc.slides[0].id).toBe(SYNTHETIC_SLIDE_ID);
    expect(doc.slides[0].elements).toEqual([]);
  });

  it('addElement then updateElementFrame mutates the elements plane (slideId ignored)', () => {
    const store: SlidesStore = new YorkieBoardStore(makeYorkieBoardDoc());
    let id = '';
    store.batch(() => {
      id = store.addElement(SYNTHETIC_SLIDE_ID, makeShapeInit());
      store.updateElementFrame(SYNTHETIC_SLIDE_ID, id, { x: 40 });
    });
    expect(store.read().slides[0].elements.find((e) => e.id === id)?.frame.x).toBe(40);

    // slideId is ignored: an arbitrary/garbage slideId still resolves
    // against the single elements plane.
    store.batch(() => {
      store.updateElementFrame('some-other-slide-id', id, { y: 77 });
    });
    expect(store.read().slides[0].elements.find((e) => e.id === id)?.frame.y).toBe(77);
  });

  it('throws notSupported on a slide-level method', () => {
    const store: SlidesStore = new YorkieBoardStore(makeYorkieBoardDoc());
    expect(() => store.addSlide('layout')).toThrow(/not supported/i);
  });

  it('batch collapses N edits into one undo unit', () => {
    const store: SlidesStore = new YorkieBoardStore(makeYorkieBoardDoc());
    store.batch(() => {
      store.addElement(SYNTHETIC_SLIDE_ID, makeShapeInit());
      store.addElement(SYNTHETIC_SLIDE_ID, makeShapeInit());
    });
    expect(store.read().slides[0].elements).toHaveLength(2);
    store.undo();
    expect(store.read().slides[0].elements).toHaveLength(0);
  });
});
