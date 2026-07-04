import { describe, it, expect } from 'vitest';
import yorkie from '@yorkie-js/sdk';
import {
  MemSlidesStore,
  type SlidesDocument,
  type SlidesStore,
} from '@wafflebase/slides';
import {
  YorkieSlidesStore,
  ensureSlidesRoot,
} from '@/app/slides/yorkie-slides-store.ts';
import type { YorkieSlidesRoot } from '@/types/slides-document.ts';

function makeYorkie(): YorkieSlidesStore {
  const doc = new (yorkie as unknown as {
    Document: new (key: string) => yorkie.Document<YorkieSlidesRoot>;
  }).Document(`equiv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  ensureSlidesRoot(doc);
  return new YorkieSlidesStore(doc);
}

/** Apply the same op sequence to both stores and return their final snapshots. */
function runBoth(seq: (s: SlidesStore) => void): { mem: SlidesDocument; yo: SlidesDocument } {
  const mem = new MemSlidesStore();
  const yo = makeYorkie();
  seq(mem);
  seq(yo);
  return { mem: mem.read(), yo: yo.read() };
}

/**
 * Compare two snapshots structurally. Element / slide ids are
 * generated independently per store, so we strip them before comparing
 * to focus on the structural shape: order, frames, types, layout ids.
 */
function stripIds(doc: SlidesDocument): unknown {
  return {
    meta: doc.meta,
    layouts: doc.layouts.map((l) => ({ id: l.id, name: l.name, placeholderCount: l.placeholders.length })),
    slides: doc.slides.map((s) => ({
      layoutId: s.layoutId,
      background: s.background,
      notesLength: s.notes.length,
      elements: s.elements.map((e) => ({
        type: e.type,
        frame: e.frame,
      })),
    })),
  };
}

describe('YorkieSlidesStore ≡ MemSlidesStore (single client, local doc)', () => {
  it('add 3 slides, reorder, remove one', () => {
    const { mem, yo } = runBoth((store) => {
      const ids: string[] = [];
      store.batch(() => {
        for (let i = 0; i < 3; i++) ids.push(store.addSlide(i === 1 ? 'title' : 'blank'));
      });
      store.batch(() => store.moveSlide(ids[2], 0));
      store.batch(() => store.removeSlide(ids[1]));
    });
    expect(stripIds(yo)).toEqual(stripIds(mem));
    expect(yo.slides.length).toBe(2);
  });

  it('seeds + persists autofit defaults equivalently, surviving undo/redo', () => {
    // Guards the production Yorkie store's text-element construction paths
    // (addSlide placeholder seed, addElement insert, undo/redo snapshot
    // restore), each of which rebuilds `data` and previously dropped
    // `autofit`. stripIds() compares only type/frame, so this is separate.
    const check = (doc: SlidesDocument, label: string): void => {
      const slide = doc.slides[0];
      const placeholders = slide.elements.filter(
        (e) => e.type === 'text' && e.placeholderRef,
      );
      const inserted = slide.elements.filter(
        (e) => e.type === 'text' && !e.placeholderRef,
      );
      expect(placeholders.length, `${label}: has placeholders`).toBeGreaterThan(0);
      for (const p of placeholders) {
        if (p.type === 'text') {
          expect(p.data.autofit, `${label}: placeholder autofit`).toBe('shrink');
        }
      }
      expect(inserted.length, `${label}: has inserted box`).toBe(1);
      if (inserted[0]?.type === 'text') {
        expect(inserted[0].data.autofit, `${label}: inserted autofit`).toBe('grow');
      }
    };

    const { mem, yo } = runBoth((store) => {
      let sid!: string;
      store.batch(() => { sid = store.addSlide('title-body', 0); });
      store.batch(() => {
        store.addElement(sid, {
          type: 'text',
          frame: { x: 10, y: 10, w: 100, h: 40, rotation: 0 },
          data: { autofit: 'grow', blocks: [] },
        });
      });
      // Exercise the snapshot-restore path.
      store.undo();
      store.redo();
    });
    check(mem, 'mem');
    check(yo, 'yorkie');
  });

  it('setSlideHeight scales content + meta equivalently across stores', () => {
    const { mem, yo } = runBoth((store) => {
      let sid = '';
      let a = '';
      let b = '';
      store.batch(() => { sid = store.addSlide('blank'); });
      store.batch(() => {
        a = store.addElement(sid, {
          type: 'shape',
          frame: { x: 100, y: 200, w: 100, h: 100, rotation: 0 },
          data: { kind: 'rect' },
        });
        b = store.addElement(sid, {
          type: 'shape',
          frame: { x: 300, y: 400, w: 100, h: 100, rotation: 0 },
          data: { kind: 'rect' },
        });
        store.addElement(sid, {
          type: 'table',
          frame: { x: 0, y: 600, w: 400, h: 200, rotation: 0 },
          data: {
            columnWidths: [200, 200],
            rows: [
              { height: 100, cells: [{ body: { blocks: [] }, style: {} }, { body: { blocks: [] }, style: {} }] },
              { height: 100, cells: [{ body: { blocks: [] }, style: {} }, { body: { blocks: [] }, style: {} }] },
            ],
          },
        });
        store.addElement(sid, {
          type: 'connector',
          routing: 'straight',
          arrowheads: {},
          frame: { x: 0, y: 0, w: 0, h: 0, rotation: 0 },
          start: { kind: 'free', x: 100, y: 300 },
          end: { kind: 'free', x: 500, y: 600 },
        });
      });
      store.batch(() => { store.group(sid, [a, b]); });
      store.batch(() => store.setSlideHeight(1440)); // 1080 → 1440
    });
    // stripIds compares meta (→ slideHeight) and every top-level frame.
    expect(stripIds(yo)).toEqual(stripIds(mem));
    expect(mem.meta.slideHeight).toBe(1440);
    expect(yo.meta.slideHeight).toBe(1440);
    // Group frame (the two shapes' bbox y=200..500 → y*4/3, h*4/3).
    const grp = mem.slides[0].elements.find((e) => e.type === 'group')!;
    expect(grp.frame.y).toBeCloseTo(200 * (4 / 3), 2);
    expect(grp.frame.h).toBeCloseTo(300 * (4 / 3), 2);
  });

  it('add element, updateElementFrame, reorderElement, remove', () => {
    const { mem, yo } = runBoth((store) => {
      let slideId = '';
      let aId = '';
      let bId = '';
      store.batch(() => { slideId = store.addSlide('blank'); });
      store.batch(() => {
        aId = store.addElement(slideId, {
          type: 'shape',
          frame: { x: 10, y: 10, w: 100, h: 60, rotation: 0 },
          data: { kind: 'rect', fill: '#abc' },
        });
        bId = store.addElement(slideId, {
          type: 'shape',
          frame: { x: 20, y: 20, w: 100, h: 60, rotation: 0 },
          data: { kind: 'ellipse', fill: '#def' },
        });
      });
      store.batch(() => store.updateElementFrame(slideId, aId, { x: 200 }));
      store.batch(() => store.reorderElement(slideId, aId, 1));
      store.batch(() => store.removeElement(slideId, bId));
    });
    expect(stripIds(yo)).toEqual(stripIds(mem));
    expect(yo.slides[0].elements.length).toBe(1);
    expect(yo.slides[0].elements[0].frame.x).toBe(200);
  });

  it('applyLayout preserves user-edited elements', () => {
    const { mem, yo } = runBoth((store) => {
      let slideId = '';
      store.batch(() => { slideId = store.addSlide('blank'); });
      store.batch(() => {
        store.addElement(slideId, {
          type: 'shape',
          frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
          data: { kind: 'rect', fill: '#abc' },
        });
      });
      store.batch(() => store.applyLayout(slideId, 'title-body'));
    });
    expect(stripIds(yo)).toEqual(stripIds(mem));
    // Title-body adds 2 placeholders; user shape preserved → 3 total.
    expect(yo.slides[0].elements.length).toBe(3);
  });

  it('batch / undo / redo round-trip', () => {
    const { mem, yo } = runBoth((store) => {
      store.batch(() => { store.addSlide('blank'); store.addSlide('blank'); });
      store.undo();
      store.redo();
      store.batch(() => store.addSlide('title'));
    });
    expect(stripIds(yo)).toEqual(stripIds(mem));
    expect(yo.slides.length).toBe(3);
  });

  it('updateSlideBackground stores a deep clone (mem vs yorkie)', () => {
    const { mem, yo } = runBoth((store) => {
      let id = '';
      store.batch(() => { id = store.addSlide('blank'); });
      // Legacy callers may still hand us a string fill; migrateDocument
      // wraps it into the v0.5 ThemeColor shape on read.
      const bg = { fill: '#ff0000' } as unknown as Parameters<typeof store.updateSlideBackground>[1];
      store.batch(() => store.updateSlideBackground(id, bg));
      (bg as { fill: string }).fill = '#00ff00'; // mutating the input must not change either store
    });
    expect(stripIds(yo)).toEqual(stripIds(mem));
    expect(yo.slides[0].background.fill).toEqual({ kind: 'srgb', value: '#ff0000' });
  });

  it('withTextElement replace-mode round-trip', () => {
    const { mem, yo } = runBoth((store) => {
      let slideId = '';
      let elId = '';
      store.batch(() => {
        slideId = store.addSlide('blank');
        elId = store.addElement(slideId, {
          type: 'text',
          frame: { x: 0, y: 0, w: 200, h: 100, rotation: 0 },
          data: { blocks: [{ id: 'b1', type: 'paragraph', inlines: [{ text: 'hi', style: {} }], style: {} }] as never },
        });
      });
      store.batch(() => {
        store.withTextElement(slideId, elId, () => [
          { id: 'b2', type: 'paragraph', inlines: [{ text: 'bye', style: {} }], style: {} } as never,
        ]);
      });
    });
    expect(stripIds(yo)).toEqual(stripIds(mem));
  });
});

// ---------------------------------------------------------------------------
// Group / ungroup equivalence
// ---------------------------------------------------------------------------

/**
 * Strip ids from a slide element tree so we can compare structural shape
 * without caring about the concrete UUIDs generated independently per store.
 * We keep `type`, `frame`, and recursively strip group children.
 */
function stripElementIds(el: { type: string; frame: unknown; data?: unknown }): unknown {
  if (el.type === 'group') {
    const g = el as { type: string; frame: unknown; data: { children: Array<{ type: string; frame: unknown; data?: unknown }> } };
    return {
      type: g.type,
      frame: g.frame,
      children: g.data.children.map(stripElementIds),
    };
  }
  return { type: el.type, frame: el.frame };
}

function stripGroupIds(doc: SlidesDocument): unknown {
  return {
    meta: doc.meta,
    slides: doc.slides.map((s) => ({
      layoutId: s.layoutId,
      elements: s.elements.map(stripElementIds),
    })),
  };
}

describe('YorkieSlidesStore ≡ MemSlidesStore (group / ungroup)', () => {
  it('group() produces equivalent structure in both stores', () => {
    const { mem, yo } = runBoth((store) => {
      let slideId = '';
      let aId = '';
      let bId = '';
      store.batch(() => {
        slideId = store.addSlide('blank');
        aId = store.addElement(slideId, {
          type: 'shape',
          frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
          data: { kind: 'rect' },
        });
        bId = store.addElement(slideId, {
          type: 'shape',
          frame: { x: 100, y: 0, w: 50, h: 50, rotation: 0 },
          data: { kind: 'ellipse' },
        });
      });
      store.batch(() => { store.group(slideId, [aId, bId]); });
    });
    expect(stripGroupIds(yo)).toEqual(stripGroupIds(mem));
    expect(yo.slides[0].elements.length).toBe(1);
    expect(yo.slides[0].elements[0].type).toBe('group');
  });

  it('group() + ungroup() round-trips to flat elements', () => {
    const { mem, yo } = runBoth((store) => {
      let slideId = '';
      let aId = '';
      let bId = '';
      let groupId = '';
      store.batch(() => {
        slideId = store.addSlide('blank');
        aId = store.addElement(slideId, {
          type: 'shape',
          frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
          data: { kind: 'rect' },
        });
        bId = store.addElement(slideId, {
          type: 'shape',
          frame: { x: 100, y: 0, w: 50, h: 50, rotation: 0 },
          data: { kind: 'ellipse' },
        });
      });
      store.batch(() => {
        groupId = store.group(slideId, [aId, bId]).groupId;
      });
      store.batch(() => { store.ungroup(slideId, groupId); });
    });
    // Both should now have 2 flat shapes.
    expect(stripGroupIds(yo)).toEqual(stripGroupIds(mem));
    expect(yo.slides[0].elements.length).toBe(2);
    expect(yo.slides[0].elements.every(e => e.type === 'shape')).toBeTruthy();
  });

  it('addElement(parentGroupId) appends child in both stores equivalently', () => {
    const { mem, yo } = runBoth((store) => {
      let slideId = '';
      let aId = '';
      let bId = '';
      let groupId = '';
      store.batch(() => {
        slideId = store.addSlide('blank');
        aId = store.addElement(slideId, {
          type: 'shape',
          frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
          data: { kind: 'rect' },
        });
        bId = store.addElement(slideId, {
          type: 'shape',
          frame: { x: 100, y: 0, w: 50, h: 50, rotation: 0 },
          data: { kind: 'ellipse' },
        });
      });
      store.batch(() => {
        groupId = store.group(slideId, [aId, bId]).groupId;
      });
      store.batch(() => {
        store.addElement(slideId, {
          type: 'shape',
          frame: { x: 20, y: 20, w: 10, h: 10, rotation: 0 },
          data: { kind: 'rect' },
        }, groupId);
      });
    });
    expect(stripGroupIds(yo)).toEqual(stripGroupIds(mem));
    const groupEl = yo.slides[0].elements[0] as { data: { children: unknown[] } };
    expect(groupEl.data.children.length).toBe(3);
  });

  it('group() + ungroup() with a free-endpoint connector preserves endpoint world coords', () => {
    // Guards the M1 fix: ungroup() must bake connector free endpoints from
    // group-local into parent (world) space, not just the cached frame.
    const { mem, yo } = runBoth((store) => {
      let slideId = '';
      let aId = '';
      let bId = '';
      let connectorId = '';
      let groupId = '';
      store.batch(() => {
        slideId = store.addSlide('blank');
        aId = store.addElement(slideId, {
          type: 'shape',
          frame: { x: 100, y: 100, w: 50, h: 50, rotation: 0 },
          data: { kind: 'rect' },
        });
        bId = store.addElement(slideId, {
          type: 'shape',
          frame: { x: 200, y: 100, w: 50, h: 50, rotation: 0 },
          data: { kind: 'rect' },
        });
        // Connector with a free start endpoint at (110, 125) and
        // a free end endpoint at (210, 125) — both in world coords.
        connectorId = store.addElement(slideId, {
          type: 'connector',
          routing: 'straight',
          start: { kind: 'free', x: 110, y: 125 },
          end:   { kind: 'free', x: 210, y: 125 },
          arrowheads: {},
          frame: { x: 0, y: 0, w: 0, h: 0, rotation: 0 },
        });
      });
      store.batch(() => {
        groupId = store.group(slideId, [aId, bId, connectorId]).groupId;
      });
      store.batch(() => { store.ungroup(slideId, groupId); });
    });
    // Structural equivalence between both stores.
    expect(stripGroupIds(yo)).toEqual(stripGroupIds(mem));
    // After group + ungroup the slide must be flat again.
    expect(yo.slides[0].elements.length).toBe(3);
    // Find the connector and verify its free endpoints survived the round-trip
    // in world coordinates — both stores must agree.
    const yoConnector = yo.slides[0].elements.find((e) => e.type === 'connector') as
      { type: 'connector'; start: { kind: string; x: number; y: number }; end: { kind: string; x: number; y: number } } | undefined;
    const memConnector = mem.slides[0].elements.find((e) => e.type === 'connector') as
      { type: 'connector'; start: { kind: string; x: number; y: number }; end: { kind: string; x: number; y: number } } | undefined;
    expect(yoConnector, 'connector should exist in yorkie store').toBeTruthy();
    expect(memConnector, 'connector should exist in mem store').toBeTruthy();
    expect(yoConnector.start.kind).toBe('free');
    expect(yoConnector.end.kind).toBe('free');
    // Both stores must agree on the endpoint world positions.
    expect(
      Math.abs(yoConnector.start.x - memConnector.start.x) < 1e-6,
      'start.x mismatch'
    ).toBeTruthy();
    expect(
      Math.abs(yoConnector.start.y - memConnector.start.y) < 1e-6,
      'start.y mismatch'
    ).toBeTruthy();
    expect(Math.abs(yoConnector.end.x - memConnector.end.x) < 1e-6, 'end.x mismatch').toBeTruthy();
    expect(Math.abs(yoConnector.end.y - memConnector.end.y) < 1e-6, 'end.y mismatch').toBeTruthy();
  });

  it('empty-group auto-removal works in both stores', () => {
    const { mem, yo } = runBoth((store) => {
      let slideId = '';
      let aId = '';
      let bId = '';
      store.batch(() => {
        slideId = store.addSlide('blank');
        aId = store.addElement(slideId, {
          type: 'shape',
          frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
          data: { kind: 'rect' },
        });
        bId = store.addElement(slideId, {
          type: 'shape',
          frame: { x: 100, y: 0, w: 50, h: 50, rotation: 0 },
          data: { kind: 'ellipse' },
        });
      });
      store.batch(() => { store.group(slideId, [aId, bId]); });
      // Read the group's children to get their actual ids.
      const doc = store.read();
      const grp = doc.slides[0].elements[0] as { data: { children: Array<{ id: string }> } };
      const [childA, childB] = grp.data.children;
      store.batch(() => store.removeElement(slideId, childA.id));
      store.batch(() => store.removeElement(slideId, childB.id));
    });
    // After removing all children, the group should be gone.
    expect(stripGroupIds(yo)).toEqual(stripGroupIds(mem));
    expect(yo.slides[0].elements).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Resting-scale invariant on the REAL Yorkie proxy path — smoke coverage for
// bakeProxyGroupTree + ungroup settle (docs/design/slides/slides-group.md
// §6.1). The in-memory store is unit-tested exhaustively; these prove the
// live-app store produces identical results on Yorkie proxies.
// ---------------------------------------------------------------------------

/** True when every group in the tree rests at scale 1 (refSize ≈ frame). */
function allGroupsSettled(doc: SlidesDocument): boolean {
  const eps = 0.01;
  const walk = (
    els: readonly { type: string; frame: { w: number; h: number }; data?: unknown }[],
  ): boolean =>
    els.every((el) => {
      if (el.type !== 'group') return true;
      const g = el as unknown as {
        frame: { w: number; h: number };
        data: { refSize?: { w: number; h: number }; children: typeof els };
      };
      const ref = g.data.refSize;
      const settled =
        !ref ||
        (Math.abs(ref.w - g.frame.w) <= eps && Math.abs(ref.h - g.frame.h) <= eps);
      return settled && walk(g.data.children);
    });
  return doc.slides.every((s) => walk(s.elements as never));
}

/**
 * Group a rotated 60×40 "smiley" + a plain rect, force a residual
 * non-uniform scale (updateElementFrame WITHOUT bake — the dirty state a
 * pre-fix commit left behind), then ungroup. Returns the final snapshot.
 */
function dirtyGroupThenUngroup(store: SlidesStore): SlidesDocument {
  let sid!: string;
  store.batch(() => { sid = store.addSlide('blank'); });
  let aId!: string; let bId!: string;
  store.batch(() => {
    aId = store.addElement(sid, {
      type: 'shape',
      frame: { x: 0, y: 0, w: 60, h: 40, rotation: Math.PI / 9 },
      data: { kind: 'smileyFace' },
    });
    bId = store.addElement(sid, {
      type: 'shape',
      frame: { x: 160, y: 0, w: 50, h: 50, rotation: 0 },
      data: { kind: 'rect' },
    });
  });
  let groupId!: string;
  store.batch(() => { ({ groupId } = store.group(sid, [aId, bId])); });
  const g0 = store.read().slides[0].elements.find((e) => e.id === groupId)!;
  store.batch(() =>
    store.updateElementFrame(sid, groupId, { w: g0.frame.w * 1.5, h: g0.frame.h }),
  );
  store.batch(() => store.ungroup(sid, groupId));
  return store.read();
}

describe('YorkieSlidesStore resting-scale invariant (live proxy path)', () => {
  it('ungroup settles a dirty non-uniform group identically to MemSlidesStore', () => {
    const mem = dirtyGroupThenUngroup(new MemSlidesStore());
    const yo = dirtyGroupThenUngroup(makeYorkie());

    // No group survives (was flat) and nothing leaked a residual scale.
    expect(allGroupsSettled(yo)).toBe(true);
    expect(yo.slides[0].elements.some((e) => e.type === 'group')).toBe(false);

    // The rotated smiley's baked frame matches the proven-correct Mem path
    // (same rotation identifies it — ids differ per store).
    const rot = (d: SlidesDocument) =>
      d.slides[0].elements.find(
        (e) => e.type === 'shape' && Math.abs(e.frame.rotation - Math.PI / 9) < 1e-9,
      )!;
    const yChild = rot(yo);
    const mChild = rot(mem);
    expect(yChild).toBeTruthy();
    expect(yChild.frame.w).toBeCloseTo(mChild.frame.w, 4);
    expect(yChild.frame.h).toBeCloseTo(mChild.frame.h, 4);
    expect(yChild.frame.x).toBeCloseTo(mChild.frame.x, 4);
    expect(yChild.frame.y).toBeCloseTo(mChild.frame.y, 4);
    expect(yChild.frame.rotation).toBeCloseTo(Math.PI / 9, 6);
  });

  it('bakeGroupResize settles a group on the Yorkie proxy path', () => {
    const store = makeYorkie();
    let sid!: string;
    store.batch(() => { sid = store.addSlide('blank'); });
    let aId!: string; let bId!: string;
    store.batch(() => {
      aId = store.addElement(sid, {
        type: 'shape', frame: { x: 0, y: 0, w: 40, h: 40, rotation: 0 },
        data: { kind: 'rect' },
      });
      bId = store.addElement(sid, {
        type: 'shape', frame: { x: 60, y: 0, w: 40, h: 40, rotation: 0 },
        data: { kind: 'rect' },
      });
    });
    let groupId!: string;
    store.batch(() => { ({ groupId } = store.group(sid, [aId, bId])); });
    const g0 = store.read().slides[0].elements.find((e) => e.id === groupId)!;
    store.batch(() => {
      store.updateElementFrame(sid, groupId, { w: g0.frame.w * 2, h: g0.frame.h });
      store.bakeGroupResize(sid, groupId);
    });
    expect(allGroupsSettled(store.read())).toBe(true);
  });
});
