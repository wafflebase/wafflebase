import { describe, it, expect } from 'vitest';
import type { GroupElement, SlidesStore } from '@wafflebase/slides';
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
    // The connector's other endpoint is free at (700, 700), so its
    // bbox always includes that point regardless of the bug — a naive
    // "is the frame exactly (0, 0)" check would not actually
    // distinguish the two cases (a degenerate attach at the origin
    // still produces a small negative x/y from the stroke padding, not
    // literally 0). Assert on magnitude instead: `aId` sits at world
    // (300, 300)-(350, 350), so a correctly resolved frame's x must sit
    // well above 250. With the origin-fallback bug (top-level-only
    // lookup can't find the now-grouped `aId`), `resolveEndpoint` falls
    // back to (0, 0) and frame.x collapses to roughly -0.5 (just the
    // stroke pad), which fails this assertion.
    expect(conn!.frame.x).toBeGreaterThan(250);
  });

  // Regression coverage for F4: `detachConnectorsTargeting` (and
  // `recomputeDependentConnectorFrames`) must walk the element tree
  // RECURSIVELY, not just `root.elements` top-level — `group()`
  // deliberately moves a connector into `group.data.children` when both
  // its endpoints are internal to the grouped set, so a non-recursive
  // walk silently skips a grouped connector when its target is removed,
  // leaving a dangling `attached` endpoint pointing at an element that
  // no longer exists.
  it('removing a grouped element detaches a connector nested inside the same group', () => {
    const store: SlidesStore = new YorkieBoardStore(makeYorkieBoardDoc());
    let aId = '';
    let bId = '';
    let connId = '';
    store.batch(() => {
      aId = store.addElement(SYNTHETIC_SLIDE_ID, {
        type: 'shape',
        frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
        data: { kind: 'rect' },
      });
      bId = store.addElement(SYNTHETIC_SLIDE_ID, {
        type: 'shape',
        frame: { x: 200, y: 200, w: 50, h: 50, rotation: 0 },
        data: { kind: 'rect' },
      });
      connId = store.addElement(SYNTHETIC_SLIDE_ID, {
        type: 'connector',
        routing: 'straight',
        start: { kind: 'attached', elementId: aId, siteIndex: 0 },
        end: { kind: 'attached', elementId: bId, siteIndex: 0 },
        arrowheads: {},
        frame: { x: 0, y: 0, w: 0, h: 0, rotation: 0 },
      });
      // Both connector endpoints are internal to [aId, bId, connId], so
      // group() moves the connector into the new group's children —
      // it's no longer a top-level element in `root.elements`.
      store.group(SYNTHETIC_SLIDE_ID, [aId, bId, connId]);
    });

    const groupBefore = store
      .read()
      .slides[0].elements.find((e) => e.type === 'group') as GroupElement;
    expect(groupBefore).toBeDefined();
    // Sanity: the connector really did land inside the group, not
    // top-level — otherwise this test wouldn't distinguish the fix from
    // the pre-fix behavior.
    expect(groupBefore.data.children.some((c) => c.id === connId)).toBe(true);

    store.batch(() => {
      store.removeElement(SYNTHETIC_SLIDE_ID, bId);
    });

    const groupAfter = store
      .read()
      .slides[0].elements.find((e) => e.type === 'group') as GroupElement;
    const conn = groupAfter.data.children.find((c) => c.id === connId) as
      | { end: { kind: string } }
      | undefined;
    expect(conn).toBeDefined();
    // With the pre-fix non-recursive walk, `detachConnectorsTargeting`
    // never sees this nested connector, so `end` would still read
    // `{ kind: 'attached', elementId: bId }` after `bId` is gone.
    expect(conn!.end.kind).toBe('free');
  });
});
