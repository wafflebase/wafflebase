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

  // Regression coverage for C4: `elementsLookup` must recursively
  // resolve elements nested inside a group (not just top-level ones),
  // otherwise a connector attached to an element that becomes a group
  // member resolves via `resolveEndpoint`'s missing-target fallback and
  // collapses to the origin.
  it('connector attached to a grouped element resolves to its world frame, not the origin', () => {
    const store: SlidesStore = new YorkieBoardStore(makeYorkieBoardDoc());
    let aId = '';
    let connId = '';
    store.batch(() => {
      aId = store.addElement(SYNTHETIC_SLIDE_ID, {
        type: 'shape',
        frame: { x: 300, y: 300, w: 50, h: 50, rotation: 0 },
        data: { kind: 'rect' },
      });
      const bId = store.addElement(SYNTHETIC_SLIDE_ID, {
        type: 'shape',
        frame: { x: 500, y: 500, w: 50, h: 50, rotation: 0 },
        data: { kind: 'rect' },
      });
      // Grouping makes `aId` a group CHILD — no longer a top-level
      // element in `root.elements`.
      store.group(SYNTHETIC_SLIDE_ID, [aId, bId]);
      // A connector added AFTER the group exists, attached to the now-
      // nested `aId`. A top-level-only lookup can't find `aId` here.
      connId = store.addElement(SYNTHETIC_SLIDE_ID, {
        type: 'connector',
        routing: 'straight',
        start: { kind: 'attached', elementId: aId, siteIndex: 0 },
        end: { kind: 'free', x: 700, y: 700 },
        arrowheads: {},
        frame: { x: 0, y: 0, w: 0, h: 0, rotation: 0 },
      });
    });

    const conn = store
      .read()
      .slides[0].elements.find((e) => e.id === connId);
    expect(conn).toBeDefined();
    // With the origin-fallback bug, the connector's computed frame
    // collapses to a degenerate box at (0, 0). The grouped element `aId`
    // sits at world (300, 300)-ish, so a correctly resolved frame must
    // not sit at the origin.
    expect(conn!.frame.x === 0 && conn!.frame.y === 0).toBe(false);
  });
});
