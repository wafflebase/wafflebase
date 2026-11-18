import { describe, expect, it } from 'vitest';
import type { ElementInit } from '@wafflebase/slides';
import { SYNTHETIC_SLIDE_ID } from '@wafflebase/board';
import { YorkieBoardStore } from './yorkie-board-store';
import { makeYorkieBoardDoc } from './__testkit__';

/**
 * Undo of a multi-element delete must survive garbage collection. In the
 * app the delete syncs, the server's min-synced version vector lets the
 * client purge the tombstones, and only then does the user press Mod+Z.
 * Deleting adjacent elements back-to-front made that undo throw
 * `cant find the given node` (the eraser crossing two strokes, or a
 * multi-select Delete of two neighbouring stickies).
 */

function stroke(x: number): ElementInit {
  return {
    type: 'shape',
    frame: { x, y: 0, w: 100, h: 100, rotation: 0 },
    data: {
      kind: 'freeform',
      path: { commands: [{ c: 'M', x: 0, y: 0 }, { c: 'L', x: 1, y: 1 }] },
      stroke: { color: { kind: 'srgb', value: '#1E1E1E' }, width: 4, cap: 'round' },
    },
  };
}

function sticky(x: number): ElementInit {
  return {
    type: 'shape',
    frame: { x, y: 0, w: 200, h: 200, rotation: 0 },
    data: { kind: 'roundRect', fill: { kind: 'srgb', value: '#FFE07A' } },
  };
}

function setup(make: (x: number) => ElementInit, n: number) {
  const doc = makeYorkieBoardDoc();
  const store = new YorkieBoardStore(doc);
  const ids: string[] = [];
  // One batch per element, as the marker commits one stroke per gesture.
  for (let i = 0; i < n; i++) {
    store.batch(() => {
      ids.push(store.addElement(SYNTHETIC_SLIDE_ID, make(i * 300)));
    });
  }
  return { doc, store, ids };
}

const order = (store: YorkieBoardStore) =>
  store.read().slides[0].elements.map((e) => e.id);

describe('YorkieBoardStore removeElements undo after GC', () => {
  const cases: [string, (x: number) => ElementInit, number[]][] = [
    ['two adjacent strokes (eraser)', stroke, [0, 1]],
    ['the last two strokes (eraser)', stroke, [1, 2]],
    ['three strokes', stroke, [0, 1, 2]],
    ['two adjacent stickies (multi-select Delete)', sticky, [1, 2]],
  ];
  for (const [name, make, which] of cases) {
    it(`restores ${name} in order`, () => {
      const { doc, store, ids } = setup(make, 3);
      store.batch(() => {
        store.removeElements(SYNTHETIC_SLIDE_ID, which.map((i) => ids[i]));
      });
      expect(order(store)).toHaveLength(3 - which.length);
      expect(doc.garbageCollect(doc.getVersionVector())).toBeGreaterThan(0);

      expect(() => store.undo()).not.toThrow();
      expect(order(store)).toEqual(ids);

      // The erase was not skipped: the next undo removes the last stroke.
      store.undo();
      expect(order(store)).toEqual(ids.slice(0, 2));
    });
  }
});
