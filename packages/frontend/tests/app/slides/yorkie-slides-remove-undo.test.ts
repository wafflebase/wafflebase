import { describe, it, expect } from 'vitest';
import yorkie from '@yorkie-js/sdk';
import type { Document } from '@yorkie-js/sdk';
import type { YorkieSlidesRoot } from '../../../src/types/slides-document.ts';
import {
  YorkieSlidesStore,
  ensureSlidesRoot,
} from '../../../src/app/slides/yorkie-slides-store.ts';

function makeDoc(): Document<YorkieSlidesRoot> {
  const doc = new yorkie.Document<YorkieSlidesRoot>(
    `test-${Date.now()}-${Math.random()}`,
  );
  ensureSlidesRoot(doc);
  return doc;
}

// Undo of a multi-element delete must survive the tombstone GC that runs
// once the delete has synced. See `yorkie-array-remove.ts`.
describe('YorkieSlidesStore — removeElements undo after GC', () => {
  it('restores two adjacent elements in order', () => {
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    let slideId = '';
    const ids: string[] = [];
    store.batch(() => {
      slideId = store.addSlide('blank');
    });
    for (let i = 0; i < 3; i++) {
      store.batch(() => {
        ids.push(
          store.addElement(slideId, {
            type: 'shape',
            frame: { x: i * 200, y: 0, w: 100, h: 100, rotation: 0 },
            data: { kind: 'rect', fill: { kind: 'srgb', value: '#abc' } },
          }),
        );
      });
    }
    const order = () =>
      store.read().slides.find((s) => s.id === slideId)!.elements.map((e) => e.id);

    store.batch(() => store.removeElements(slideId, [ids[1], ids[2]]));
    expect(order()).toEqual([ids[0]]);
    doc.garbageCollect(doc.getVersionVector());

    expect(() => store.undo()).not.toThrow();
    expect(order()).toEqual(ids);
  });
});
