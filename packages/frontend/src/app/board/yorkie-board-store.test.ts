import { describe, it, expect, vi } from 'vitest';
import type { GroupElement, SlidesStore } from '@wafflebase/slides';
import { SYNTHETIC_SLIDE_ID } from '@wafflebase/board';
import { YorkieBoardStore } from './yorkie-board-store';
import { makeYorkieBoardDoc, makeShapeInit } from './__testkit__';

/**
 * Fire a synthetic SDK document event. `YorkieBoardStore` subscribes to
 * `remote-change` / `snapshot` in its constructor; with no server to
 * produce them, drive that subscription through Yorkie's public
 * `Document.publish`. The store only reads `event.type`, so the rest of
 * the payload is elided.
 */
function emitDocEvent(
  doc: ReturnType<typeof makeYorkieBoardDoc>,
  type: 'remote-change' | 'snapshot',
): void {
  (doc as unknown as { publish(events: unknown[]): void }).publish([{ type }]);
}

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

  // Regression: a presence write fired synchronously from inside a
  // `batch()` — which is what every insert does, because the editor
  // selects the element it just added and `Selection.notify()` is
  // synchronous — must fold into the batch's own change.
  //
  // Opening a nested `doc.update` there instead reissues the still-open
  // outer change's `clientSeq`, and the server refuses the whole pack
  // with "change clientSeq must increase by one". `clientSeq` is the
  // assertion rather than the change count because it is the exact thing
  // the server validates.
  it('a presence write inside batch() does not reissue the open change clientSeq', () => {
    const doc = makeYorkieBoardDoc();
    const store = new YorkieBoardStore(doc);

    store.batch(() => {
      store.addElement(SYNTHETIC_SLIDE_ID, makeShapeInit());
      store.updatePresence({ selectedElementIds: ['whatever'] });
    });

    const seqs = doc
      .createChangePack()
      .getChanges()
      .map((c) => c.getID().getClientSeq());
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    // Contiguity is what the server actually checks.
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBe(seqs[i - 1] + 1);
    }
  });

  // The other half of the seam: with no batch open there is nothing to
  // fold into, so `updatePresence` must still write. Asserted on the
  // outgoing change rather than `getMyPresence()` — these docs are never
  // attached to a server, and the SDK only reconciles presence into its
  // own map for an attached document.
  it('updatePresence outside a batch still emits the presence change', () => {
    const doc = makeYorkieBoardDoc();
    const store = new YorkieBoardStore(doc);
    store.updatePresence({ selectedElementIds: ['a'] });

    const changes = doc.createChangePack().getChanges();
    const presence = changes[changes.length - 1].getPresenceChange();
    expect(presence).toMatchObject({
      type: 'put',
      presence: { selectedElementIds: ['a'] },
    });
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

  // --- read() snapshot cache ---
  //
  // `read()` deep-unwraps every element (JSON.parse per node), and the
  // editor calls it at least twice per interaction frame. The snapshot is
  // memoized and must be dropped on EVERY path by which `root` can change.
  describe('read() snapshot cache', () => {
    it('returns the identical snapshot when nothing has changed', () => {
      const store: SlidesStore = new YorkieBoardStore(makeYorkieBoardDoc());
      store.batch(() => {
        store.addElement(SYNTHETIC_SLIDE_ID, makeShapeInit());
      });
      const first = store.read();
      const second = store.read();
      // Identity, not deep-equality: a rebuild would produce an equal but
      // distinct object, so `toBe` is what actually proves no re-walk.
      expect(second).toBe(first);
      expect(store.read().slides[0]).toBe(first.slides[0]);
    });

    it('does not re-unwrap the element tree on a repeated read()', () => {
      const doc = makeYorkieBoardDoc();
      const store: SlidesStore = new YorkieBoardStore(doc);
      store.batch(() => {
        store.addElement(SYNTHETIC_SLIDE_ID, makeShapeInit());
      });
      store.read();
      // Count the actual unwrap work: `yorkieToPlain` is
      // `JSON.parse(proxy.toJSON())`, so a rebuild is observable as
      // JSON.parse calls. A cache hit must do zero.
      const parseSpy = vi.spyOn(JSON, 'parse');
      try {
        store.read();
        expect(parseSpy).not.toHaveBeenCalled();
      } finally {
        parseSpy.mockRestore();
      }
    });

    it('invalidates on a local mutation', () => {
      const store: SlidesStore = new YorkieBoardStore(makeYorkieBoardDoc());
      const before = store.read();
      let id = '';
      store.batch(() => {
        id = store.addElement(SYNTHETIC_SLIDE_ID, makeShapeInit());
      });
      const after = store.read();
      expect(after).not.toBe(before);
      expect(after.slides[0].elements.map((e) => e.id)).toEqual([id]);
    });

    it('sees a mutation made earlier in the SAME batch', () => {
      // The correctness trap: `withUpdate` invalidates per-mutation rather
      // than only at the end of `batch()`, because Yorkie applies changes
      // to the local root optimistically. A batch-scoped invalidation
      // would serve a stale document to this mid-batch read.
      const store: SlidesStore = new YorkieBoardStore(makeYorkieBoardDoc());
      store.read();
      let seenMidBatch: string[] = [];
      let addedId = '';
      store.batch(() => {
        addedId = store.addElement(SYNTHETIC_SLIDE_ID, makeShapeInit());
        seenMidBatch = store.read().slides[0].elements.map((e) => e.id);
        store.updateElementFrame(SYNTHETIC_SLIDE_ID, addedId, { x: 42 });
        // The second mutation must be visible to a later mid-batch read too.
        expect(
          store.read().slides[0].elements.find((e) => e.id === addedId)?.frame.x,
        ).toBe(42);
      });
      expect(seenMidBatch).toEqual([addedId]);
    });

    it('invalidates on a remote change', () => {
      const doc = makeYorkieBoardDoc();
      const store: SlidesStore = new YorkieBoardStore(doc);
      const before = store.read();
      expect(before.slides[0].elements).toHaveLength(0);
      // Simulate the SDK delivering a remote change: mutate the root
      // out-of-band (as a merged remote change would) and fire the event
      // the store subscribed to in its constructor.
      doc.update((r) => {
        r.elements.push({
          id: 'remote-1',
          type: 'shape',
          frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
          data: { kind: 'rect' },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
      });
      emitDocEvent(doc, 'remote-change');
      const after = store.read();
      expect(after).not.toBe(before);
      expect(after.slides[0].elements.map((e) => e.id)).toEqual(['remote-1']);
    });

    it('invalidates on a snapshot event', () => {
      // 'snapshot' is a DISTINCT DocEventType from 'remote-change' — the
      // SDK emits it (and not 'remote-change') for a whole-document
      // server catch-up, so it must invalidate too or every later read()
      // would be permanently stale.
      const doc = makeYorkieBoardDoc();
      const store: SlidesStore = new YorkieBoardStore(doc);
      const before = store.read();
      doc.update((r) => {
        r.elements.push({
          id: 'snap-1',
          type: 'shape',
          frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
          data: { kind: 'rect' },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
      });
      emitDocEvent(doc, 'snapshot');
      const after = store.read();
      expect(after).not.toBe(before);
      expect(after.slides[0].elements.map((e) => e.id)).toEqual(['snap-1']);
    });

    it('invalidates on undo and redo', () => {
      const store: SlidesStore = new YorkieBoardStore(makeYorkieBoardDoc());
      let id = '';
      store.batch(() => {
        id = store.addElement(SYNTHETIC_SLIDE_ID, makeShapeInit());
      });
      const withElement = store.read();
      expect(withElement.slides[0].elements.map((e) => e.id)).toEqual([id]);

      store.undo();
      const undone = store.read();
      expect(undone).not.toBe(withElement);
      expect(undone.slides[0].elements).toHaveLength(0);

      store.redo();
      const redone = store.read();
      expect(redone).not.toBe(undone);
      expect(redone.slides[0].elements.map((e) => e.id)).toEqual([id]);
    });

    it('hands change listeners the post-change document', () => {
      // `notifyChange` drops the cache BEFORE invoking listeners: they
      // react by calling `read()`, so a stale snapshot here would defeat
      // the whole notification.
      const store: SlidesStore = new YorkieBoardStore(makeYorkieBoardDoc());
      store.read();
      const seen: number[] = [];
      store.onChange(() => {
        seen.push(store.read().slides[0].elements.length);
      });
      store.batch(() => {
        store.addElement(SYNTHETIC_SLIDE_ID, makeShapeInit());
      });
      expect(seen).toEqual([1]);
    });
  });
});
