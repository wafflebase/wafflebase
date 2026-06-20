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

/**
 * Seed `slides` slides, each with `perSlide` shape elements, in a single
 * batch. Returns the created slide ids and a parallel array of element
 * ids per slide.
 */
function seedDeck(
  store: YorkieSlidesStore,
  slides: number,
  perSlide: number,
): { slideIds: string[]; elementIds: string[][] } {
  const slideIds: string[] = [];
  const elementIds: string[][] = [];
  store.batch(() => {
    for (let s = 0; s < slides; s++) {
      const sid = store.addSlide('blank');
      slideIds.push(sid);
      const els: string[] = [];
      for (let e = 0; e < perSlide; e++) {
        els.push(
          store.addElement(sid, {
            type: 'shape',
            frame: { x: e, y: e, w: 100, h: 50, rotation: 0 },
            // Canonical ThemeColor fill (what the editor stores). A bare
            // '#abc' string would be wrapped by `migrateDocument` on read,
            // so the first undo would migrate every element — a one-time
            // cost that masks the steady-state reconcile churn we measure.
            data: { kind: 'rect', fill: { kind: 'srgb', value: '#abc' } },
          }),
        );
      }
      elementIds.push(els);
    }
  });
  return { slideIds, elementIds };
}

describe('YorkieSlidesStore — undo/redo churn', () => {
  // Regression guard for the 2026-06-20 node-OOM incident: `replaceRoot`
  // used to splice the whole `slides` / `layouts` arrays, so every undo
  // / redo tombstoned the entire document. Repeated undo/redo bloated one
  // deck to 118MB and OOM-cascaded the EKS nodes during housekeeping.
  //
  // `getGarbageLen()` counts CRDT nodes pending GC. A local (unattached)
  // document never GCs, so the delta across a single `undo()` measures
  // exactly how much that restore churned. Reverting one element's frame
  // must touch ~that one element — not all 60 elements + 3 slides + the
  // layout/theme/master trees.
  it('undo of a single-element move does not churn the whole document', () => {
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    const { slideIds, elementIds } = seedDeck(store, 3, 20);

    store.batch(() =>
      store.updateElementFrame(slideIds[1], elementIds[1][10], { x: 999 }),
    );

    const before = doc.getGarbageLen();
    store.undo();
    const churn = doc.getGarbageLen() - before;

    expect(churn).toBeLessThan(30);
  });

  it('redo of a single-element move does not churn the whole document', () => {
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    const { slideIds, elementIds } = seedDeck(store, 3, 20);

    store.batch(() =>
      store.updateElementFrame(slideIds[1], elementIds[1][10], { x: 999 }),
    );
    store.undo();

    const before = doc.getGarbageLen();
    store.redo();
    const churn = doc.getGarbageLen() - before;

    expect(churn).toBeLessThan(30);
  });

  // The incident deck was a real presentation — text boxes and groups, not
  // just shapes. Prove unchanged text / group elements round-trip through
  // the snapshot rebuild without churning: only the one moved shape should
  // tombstone anything.
  it('does not churn unchanged text / group elements on undo', () => {
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    let sid = '';
    const shapeIds: string[] = [];
    let ga = '';
    let gb = '';
    store.batch(() => {
      sid = store.addSlide('blank');
      for (let i = 0; i < 10; i++) {
        shapeIds.push(
          store.addElement(sid, {
            type: 'shape',
            frame: { x: i, y: i, w: 10, h: 10, rotation: 0 },
            data: { kind: 'rect', fill: { kind: 'srgb', value: '#abc' } },
          }),
        );
      }
      store.addElement(sid, {
        type: 'text',
        frame: { x: 0, y: 0, w: 100, h: 40, rotation: 0 },
        data: { blocks: [] },
      });
      ga = store.addElement(sid, {
        type: 'shape',
        frame: { x: 1, y: 1, w: 5, h: 5, rotation: 0 },
        data: { kind: 'rect' },
      });
      gb = store.addElement(sid, {
        type: 'shape',
        frame: { x: 8, y: 8, w: 5, h: 5, rotation: 0 },
        data: { kind: 'rect' },
      });
    });
    store.batch(() => store.group(sid, [ga, gb]));

    store.batch(() => store.updateElementFrame(sid, shapeIds[0], { x: 500 }));
    const before = doc.getGarbageLen();
    store.undo();
    const churn = doc.getGarbageLen() - before;

    expect(churn).toBeLessThan(30);
  });
});

describe('YorkieSlidesStore — undo/redo correctness (reconcile)', () => {
  it('restores exact content for a single-element move', () => {
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    const { slideIds, elementIds } = seedDeck(store, 2, 5);
    const original = store.read();

    store.batch(() =>
      store.updateElementFrame(slideIds[0], elementIds[0][2], { x: 777 }),
    );
    expect(store.read().slides[0].elements[2].frame.x).toBe(777);

    store.undo();
    expect(store.read()).toEqual(original);

    store.redo();
    expect(store.read().slides[0].elements[2].frame.x).toBe(777);
  });

  it('restores element order after a reorder', () => {
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    const { slideIds } = seedDeck(store, 1, 4);
    const before = store.read().slides[0].elements.map((e) => e.id);

    store.batch(() => store.reorderElement(slideIds[0], before[0], 3));
    const reordered = store.read().slides[0].elements.map((e) => e.id);
    expect(reordered).not.toEqual(before);

    store.undo();
    expect(store.read().slides[0].elements.map((e) => e.id)).toEqual(before);

    store.redo();
    expect(store.read().slides[0].elements.map((e) => e.id)).toEqual(reordered);
  });

  it('restores an added element (undo removes, redo re-adds)', () => {
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    const { slideIds } = seedDeck(store, 1, 2);

    let added = '';
    store.batch(() => {
      added = store.addElement(slideIds[0], {
        type: 'shape',
        frame: { x: 1, y: 1, w: 10, h: 10, rotation: 0 },
        data: { kind: 'rect', fill: '#def' },
      });
    });
    expect(store.read().slides[0].elements.map((e) => e.id)).toContain(added);

    store.undo();
    expect(store.read().slides[0].elements.map((e) => e.id)).not.toContain(
      added,
    );

    store.redo();
    expect(store.read().slides[0].elements.map((e) => e.id)).toContain(added);
  });

  it('restores a nested group child frame change', () => {
    const doc = makeDoc();
    const store = new YorkieSlidesStore(doc);
    let sid = '';
    let a = '';
    let b = '';
    store.batch(() => {
      sid = store.addSlide('blank');
      a = store.addElement(sid, {
        type: 'shape',
        frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
        data: { kind: 'rect', fill: '#abc' },
      });
      b = store.addElement(sid, {
        type: 'shape',
        frame: { x: 20, y: 20, w: 10, h: 10, rotation: 0 },
        data: { kind: 'rect', fill: '#abc' },
      });
    });
    store.batch(() => {
      store.group(sid, [a, b]);
    });
    const original = store.read();

    store.batch(() => store.updateElementFrame(sid, a, { x: 5 }));
    expect(store.read()).not.toEqual(original);

    store.undo();
    expect(store.read()).toEqual(original);
  });
});
