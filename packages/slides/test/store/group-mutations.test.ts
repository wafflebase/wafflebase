import { describe, expect, it } from 'vitest';
import { MemSlidesStore } from '../../src/store/memory';
import type { GroupElement } from '../../src/model/element';
import type { ConnectorElement } from '../../src/model/connector';
import { applyGroupTransform } from '../../src/model/group';
import type { Element } from '../../src/model/element';
import { collectUnsettledGroups } from '../support/group-invariant';

describe('group()', () => {
  it('requires at least two elements', () => {
    const store = new MemSlidesStore();
    let sid!: string;
    store.batch(() => { sid = store.addSlide('blank', 0); });
    let a!: string;
    store.batch(() => {
      a = store.addElement(sid, {
        type: 'shape',
        frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
        data: { kind: 'rect' },
      });
    });
    expect(() => store.batch(() => store.group(sid, [a]))).toThrow();
  });

  it('groups two slide-root shapes and replaces them with one GroupElement', () => {
    const store = new MemSlidesStore();
    let sid!: string;
    store.batch(() => { sid = store.addSlide('blank', 0); });
    let a!: string;
    let b!: string;
    store.batch(() => {
      a = store.addElement(sid, {
        type: 'shape',
        frame: { x: 10, y: 10, w: 20, h: 20, rotation: 0 },
        data: { kind: 'rect' },
      });
      b = store.addElement(sid, {
        type: 'shape',
        frame: { x: 40, y: 50, w: 30, h: 10, rotation: 0 },
        data: { kind: 'rect' },
      });
    });

    let groupId!: string;
    store.batch(() => {
      ({ groupId } = store.group(sid, [a, b]));
    });

    const slide = store.read().slides[0];
    expect(slide.elements).toHaveLength(1);
    expect(slide.elements[0].type).toBe('group');
    expect(slide.elements[0].id).toBe(groupId);
    const g = slide.elements[0] as GroupElement;
    expect(g.data.children.map(c => c.id)).toEqual([a, b]);
    // AABB of a=(10,10,20,20) and b=(40,50,30,10):
    //   x: min(10, 40) = 10, y: min(10, 50) = 10
    //   right: max(10+20, 40+30) = max(30, 70) = 70, w=70-10=60
    //   bottom: max(10+20, 50+10) = max(30, 60) = 60, h=60-10=50
    expect(g.frame).toMatchObject({ x: 10, y: 10, w: 60, h: 50, rotation: 0 });
    // Children in group-local space (group origin at 10,10):
    //   a: x=0, y=0, w=20, h=20
    //   b: x=30, y=40, w=30, h=10
    expect(g.data.children[0].frame).toMatchObject({ x: 0, y: 0, w: 20, h: 20 });
    expect(g.data.children[1].frame).toMatchObject({ x: 30, y: 40, w: 30, h: 10 });
  });

  it('rejects mixed parents', () => {
    const store = new MemSlidesStore();
    let sid!: string;
    store.batch(() => { sid = store.addSlide('blank', 0); });
    let a!: string;
    let b!: string;
    store.batch(() => {
      a = store.addElement(sid, {
        type: 'shape',
        frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
        data: { kind: 'rect' },
      });
      b = store.addElement(sid, {
        type: 'shape',
        frame: { x: 20, y: 0, w: 10, h: 10, rotation: 0 },
        data: { kind: 'rect' },
      });
    });
    store.batch(() => { store.group(sid, [a, b]); });
    let c!: string;
    store.batch(() => {
      c = store.addElement(sid, {
        type: 'shape',
        frame: { x: 100, y: 0, w: 10, h: 10, rotation: 0 },
        data: { kind: 'rect' },
      });
    });
    // `a` is now inside the group, `c` is at slide-root → mixed parents.
    expect(() => store.batch(() => store.group(sid, [a, c]))).toThrow(/same parent/i);
  });

  it('inserts the group at the front-most selected element position', () => {
    const store = new MemSlidesStore();
    let sid!: string;
    store.batch(() => { sid = store.addSlide('blank', 0); });
    let a!: string;
    let b!: string;
    let c!: string;
    store.batch(() => {
      a = store.addElement(sid, {
        type: 'shape',
        frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
        data: { kind: 'rect' },
      });
      b = store.addElement(sid, {
        type: 'shape',
        frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
        data: { kind: 'rect' },
      });
      c = store.addElement(sid, {
        type: 'shape',
        frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
        data: { kind: 'rect' },
      });
    });
    store.batch(() => { store.group(sid, [a, c]); }); // skip b
    const slide = store.read().slides[0];
    // a and c become children; the group takes c's position (front-most).
    expect(slide.elements.map(e => e.type)).toEqual(['shape', 'group']);
    expect(slide.elements[0].id).toBe(b);
  });

  it('groups two children already inside a group (nested group)', () => {
    const store = new MemSlidesStore();
    let sid!: string;
    store.batch(() => { sid = store.addSlide('blank', 0); });

    // Create an outer group with two children
    let outerGroupId!: string;
    let innerA!: string;
    let innerB!: string;
    store.batch(() => {
      innerA = store.addElement(sid, {
        type: 'shape',
        frame: { x: 10, y: 10, w: 20, h: 20, rotation: 0 },
        data: { kind: 'rect' },
      });
      innerB = store.addElement(sid, {
        type: 'shape',
        frame: { x: 40, y: 10, w: 20, h: 20, rotation: 0 },
        data: { kind: 'rect' },
      });
      ({ groupId: outerGroupId } = store.group(sid, [innerA, innerB]));
    });

    // Now innerA and innerB are children of the outer group (in local coords).
    // Add a third element inside the outer group by first checking the structure,
    // then group innerA and innerB (which now share parent = outerGroup).
    // Actually let's verify the structure first, then sub-group within it.

    // At this point slide has one group with two shape children.
    // Let's add more children to the outer group by creating a new shape at slide root
    // then trying to sub-group — to get children inside a group, we need to
    // work with what's already inside. Let's re-group innerA and innerB again
    // (they're already inside the outer group now, sharing that parent).
    store.batch(() => {
      const { groupId: nestedGroupId } = store.group(sid, [innerA, innerB]);

      const slide = store.read().slides[0];
      // The outer group should still be the only slide-root element
      expect(slide.elements).toHaveLength(1);
      expect(slide.elements[0].id).toBe(outerGroupId);

      const outer = slide.elements[0] as GroupElement;
      // The outer group should now have one child: the nested group
      expect(outer.data.children).toHaveLength(1);
      expect(outer.data.children[0].type).toBe('group');
      expect(outer.data.children[0].id).toBe(nestedGroupId);

      const nested = outer.data.children[0] as GroupElement;
      // The nested group's children are innerA and innerB
      expect(nested.data.children.map(c => c.id)).toEqual([innerA, innerB]);

      // The nested group's frame should be in the outer group's local coordinate space
      // (not world space). Since outerGroup frame was the AABB of innerA+innerB:
      // innerA was at (10,10,20,20) and innerB at (40,10,20,20) in world.
      // Outer group AABB: x=10, y=10, w=50, h=20
      // In outer-local, innerA was at (0,0,20,20) and innerB at (30,0,20,20).
      // AABB of those local frames: x=0, y=0, w=50, h=20
      // So nested group local frame = (0, 0, 50, 20) within outer group
      expect(nested.frame).toMatchObject({ x: 0, y: 0, w: 50, h: 20, rotation: 0 });
    });
  });

  it('throws when element id does not exist on the slide', () => {
    const store = new MemSlidesStore();
    let sid!: string;
    store.batch(() => { sid = store.addSlide('blank', 0); });
    let a!: string;
    store.batch(() => {
      a = store.addElement(sid, {
        type: 'shape',
        frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
        data: { kind: 'rect' },
      });
    });
    expect(() => store.batch(() => store.group(sid, [a, 'does-not-exist']))).toThrow();
  });

  it('throws when a candidate carries a placeholderRef', () => {
    // Placeholders are seeded by addSlide from layouts. Use a layout that has placeholders.
    const store = new MemSlidesStore();
    let sid!: string;
    store.batch(() => { sid = store.addSlide('title-body', 0); });

    const slide = store.read().slides[0];
    // title-and-body layout should have placeholder elements
    const placeholders = slide.elements.filter(e => e.placeholderRef != null);
    expect(placeholders.length).toBeGreaterThanOrEqual(1);

    if (placeholders.length >= 2) {
      expect(() =>
        store.batch(() => store.group(sid, [placeholders[0].id, placeholders[1].id]))
      ).toThrow(/placeholderRef/i);
    } else {
      // Only one placeholder; add a normal shape and try to group together
      let normal!: string;
      store.batch(() => {
        normal = store.addElement(sid, {
          type: 'shape',
          frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
          data: { kind: 'rect' },
        });
      });
      expect(() =>
        store.batch(() => store.group(sid, [placeholders[0].id, normal]))
      ).toThrow(/placeholderRef/i);
    }
  });

  it('group() is undoable in one step via batch', () => {
    const store = new MemSlidesStore();
    let sid!: string;
    store.batch(() => { sid = store.addSlide('blank', 0); });
    let a!: string;
    let b!: string;
    store.batch(() => {
      a = store.addElement(sid, {
        type: 'shape',
        frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
        data: { kind: 'rect' },
      });
      b = store.addElement(sid, {
        type: 'shape',
        frame: { x: 20, y: 0, w: 10, h: 10, rotation: 0 },
        data: { kind: 'rect' },
      });
    });
    store.batch(() => { store.group(sid, [a, b]); });

    // After group: one GroupElement
    expect(store.read().slides[0].elements).toHaveLength(1);
    expect(store.read().slides[0].elements[0].type).toBe('group');

    store.undo();

    // After undo: back to two shapes
    const afterUndo = store.read().slides[0].elements;
    expect(afterUndo).toHaveLength(2);
    expect(afterUndo.map(e => e.type)).toEqual(['shape', 'shape']);
    expect(afterUndo.map(e => e.id)).toContain(a);
    expect(afterUndo.map(e => e.id)).toContain(b);
  });

  it('computes rotation-aware AABB across rotated and axis-aligned candidates', () => {
    const store = new MemSlidesStore();
    let sid!: string;
    store.batch(() => { sid = store.addSlide('blank', 0); });

    // Shape A: 100×40 at (0,0) rotated 90°.
    // Center is at (50, 20). With cos(π/2)=0, sin(π/2)=1 the corners map to:
    //   [70,-30], [70,70], [30,70], [30,-30]
    // AABB: x:[30,70], y:[-30,70]
    let a!: string;
    store.batch(() => {
      a = store.addElement(sid, {
        type: 'shape',
        frame: { x: 0, y: 0, w: 100, h: 40, rotation: Math.PI / 2 },
        data: { kind: 'rect' },
      });
    });

    // Shape B: 50×50 at (100,100) with no rotation.
    // AABB: x:[100,150], y:[100,150]
    let b!: string;
    store.batch(() => {
      b = store.addElement(sid, {
        type: 'shape',
        frame: { x: 100, y: 100, w: 50, h: 50, rotation: 0 },
        data: { kind: 'rect' },
      });
    });

    let groupId!: string;
    store.batch(() => { ({ groupId } = store.group(sid, [a, b])); });

    // Combined AABB: minX=30, maxX=150, minY=-30, maxY=150
    // → frame: { x:30, y:-30, w:120, h:180, rotation:0 }
    const slide = store.read().slides[0];
    const g = slide.elements.find(e => e.id === groupId)!;
    expect(g.frame.rotation).toBe(0);
    expect(g.frame.x).toBeCloseTo(30, 4);
    expect(g.frame.y).toBeCloseTo(-30, 4);
    expect(g.frame.w).toBeCloseTo(120, 4);
    expect(g.frame.h).toBeCloseTo(180, 4);
  });
});

// ---------------------------------------------------------------------------
// Helper to add a connector between two elements (or with free endpoints).
// ---------------------------------------------------------------------------
function addConnector(
  store: MemSlidesStore,
  sid: string,
  startEndpoint: { kind: 'attached'; elementId: string; siteIndex: number } | { kind: 'free'; x: number; y: number },
  endEndpoint: { kind: 'attached'; elementId: string; siteIndex: number } | { kind: 'free'; x: number; y: number },
): string {
  let cid!: string;
  store.batch(() => {
    cid = store.addElement(sid, {
      type: 'connector',
      routing: 'straight',
      start: startEndpoint,
      end: endEndpoint,
      arrowheads: {},
      frame: { x: 0, y: 0, w: 0, h: 0, rotation: 0 },
    });
  });
  return cid;
}

describe('group() — connector partition', () => {
  it('connector with both endpoints in selection joins the group', () => {
    const store = new MemSlidesStore();
    let sid!: string;
    store.batch(() => { sid = store.addSlide('blank', 0); });
    let a!: string;
    let b!: string;
    store.batch(() => {
      a = store.addElement(sid, {
        type: 'shape',
        frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
        data: { kind: 'rect' },
      });
      b = store.addElement(sid, {
        type: 'shape',
        frame: { x: 100, y: 0, w: 50, h: 50, rotation: 0 },
        data: { kind: 'rect' },
      });
    });
    const c = addConnector(
      store, sid,
      { kind: 'attached', elementId: a, siteIndex: 0 },
      { kind: 'attached', elementId: b, siteIndex: 0 },
    );

    let groupId!: string;
    let excludedConnectorIds!: string[];
    store.batch(() => {
      ({ groupId, excludedConnectorIds } = store.group(sid, [a, b, c]));
    });

    expect(excludedConnectorIds).toEqual([]);
    const slide = store.read().slides[0];
    // The group is the only element at slide root.
    expect(slide.elements).toHaveLength(1);
    const g = slide.elements[0] as GroupElement;
    expect(g.id).toBe(groupId);
    // All three (a, b, c) are children of the group.
    expect(g.data.children.map(ch => ch.id)).toContain(a);
    expect(g.data.children.map(ch => ch.id)).toContain(b);
    expect(g.data.children.map(ch => ch.id)).toContain(c);
  });

  it('connector with one external endpoint is excluded', () => {
    const store = new MemSlidesStore();
    let sid!: string;
    store.batch(() => { sid = store.addSlide('blank', 0); });
    let a!: string;
    let b!: string;
    let outside!: string;
    store.batch(() => {
      a = store.addElement(sid, {
        type: 'shape',
        frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
        data: { kind: 'rect' },
      });
      b = store.addElement(sid, {
        type: 'shape',
        frame: { x: 100, y: 0, w: 50, h: 50, rotation: 0 },
        data: { kind: 'rect' },
      });
      outside = store.addElement(sid, {
        type: 'shape',
        frame: { x: 300, y: 0, w: 50, h: 50, rotation: 0 },
        data: { kind: 'rect' },
      });
    });
    // Connector: start attached to a (inside), end attached to outside (not in selection).
    const c = addConnector(
      store, sid,
      { kind: 'attached', elementId: a, siteIndex: 0 },
      { kind: 'attached', elementId: outside, siteIndex: 0 },
    );

    let groupId!: string;
    let excludedConnectorIds!: string[];
    store.batch(() => {
      ({ groupId, excludedConnectorIds } = store.group(sid, [a, b, c]));
    });

    // c is excluded because it references `outside`.
    expect(excludedConnectorIds).toEqual([c]);

    const slide = store.read().slides[0];
    // Slide root has: the group + outside + c (the excluded connector stays).
    const rootIds = slide.elements.map(e => e.id);
    expect(rootIds).toContain(groupId);
    expect(rootIds).toContain(outside);
    expect(rootIds).toContain(c);

    const g = slide.elements.find(e => e.id === groupId) as GroupElement;
    // Group children: only a and b.
    expect(g.data.children.map(ch => ch.id)).toContain(a);
    expect(g.data.children.map(ch => ch.id)).toContain(b);
    expect(g.data.children.map(ch => ch.id)).not.toContain(c);
  });

  it('connector with two free endpoints joins the group with normalized coords', () => {
    const store = new MemSlidesStore();
    let sid!: string;
    store.batch(() => { sid = store.addSlide('blank', 0); });
    let a!: string;
    let b!: string;
    store.batch(() => {
      a = store.addElement(sid, {
        type: 'shape',
        frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
        data: { kind: 'rect' },
      });
      b = store.addElement(sid, {
        type: 'shape',
        frame: { x: 100, y: 0, w: 50, h: 50, rotation: 0 },
        data: { kind: 'rect' },
      });
    });
    // Free endpoints in world space: (10, 10) and (140, 10).
    const c = addConnector(
      store, sid,
      { kind: 'free', x: 10, y: 10 },
      { kind: 'free', x: 140, y: 10 },
    );

    let groupId!: string;
    let excludedConnectorIds!: string[];
    store.batch(() => {
      ({ groupId, excludedConnectorIds } = store.group(sid, [a, b, c]));
    });

    expect(excludedConnectorIds).toEqual([]);

    const slide = store.read().slides[0];
    const g = slide.elements.find(e => e.id === groupId) as GroupElement;
    const connector = g.data.children.find(ch => ch.id === c) as ConnectorElement;
    expect(connector).toBeDefined();
    expect(connector.type).toBe('connector');

    // The group AABB covers a=(0,0,50,50) and b=(100,0,50,50):
    // → x: 0, y: 0, w: 150, h: 50.
    // The group origin is at (0, 0) in world, rotation 0.
    // So group-local coords = world coords - group origin.
    // World (10, 10) → group-local (10, 10).
    // World (140, 10) → group-local (140, 10).
    expect(connector.start).toMatchObject({ kind: 'free', x: 10, y: 10 });
    expect(connector.end).toMatchObject({ kind: 'free', x: 140, y: 10 });
  });

  it('throws when excluding connectors leaves fewer than 2 candidates', () => {
    const store = new MemSlidesStore();
    let sid!: string;
    store.batch(() => { sid = store.addSlide('blank', 0); });
    let a!: string;
    let outside!: string;
    store.batch(() => {
      a = store.addElement(sid, {
        type: 'shape',
        frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
        data: { kind: 'rect' },
      });
      outside = store.addElement(sid, {
        type: 'shape',
        frame: { x: 200, y: 0, w: 50, h: 50, rotation: 0 },
        data: { kind: 'rect' },
      });
    });
    // Connector c links a (inside selection) to outside (not in selection).
    const c = addConnector(
      store, sid,
      { kind: 'attached', elementId: a, siteIndex: 0 },
      { kind: 'attached', elementId: outside, siteIndex: 0 },
    );

    // group([a, c]) → c is excluded → only a remains → not enough to form a group.
    expect(() =>
      store.batch(() => store.group(sid, [a, c])),
    ).toThrow(/cannot create a group/i);
  });

  it('mixed: multiple connectors — some join, some excluded', () => {
    const store = new MemSlidesStore();
    let sid!: string;
    store.batch(() => { sid = store.addSlide('blank', 0); });
    let a!: string;
    let b!: string;
    let outside!: string;
    store.batch(() => {
      a = store.addElement(sid, {
        type: 'shape',
        frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
        data: { kind: 'rect' },
      });
      b = store.addElement(sid, {
        type: 'shape',
        frame: { x: 100, y: 0, w: 50, h: 50, rotation: 0 },
        data: { kind: 'rect' },
      });
      outside = store.addElement(sid, {
        type: 'shape',
        frame: { x: 300, y: 0, w: 50, h: 50, rotation: 0 },
        data: { kind: 'rect' },
      });
    });
    // c1: both endpoints inside selection → joins the group.
    const c1 = addConnector(
      store, sid,
      { kind: 'attached', elementId: a, siteIndex: 0 },
      { kind: 'attached', elementId: b, siteIndex: 0 },
    );
    // c2: end attached to outside → excluded.
    const c2 = addConnector(
      store, sid,
      { kind: 'attached', elementId: a, siteIndex: 1 },
      { kind: 'attached', elementId: outside, siteIndex: 0 },
    );

    let groupId!: string;
    let excludedConnectorIds!: string[];
    store.batch(() => {
      ({ groupId, excludedConnectorIds } = store.group(sid, [a, b, c1, c2]));
    });

    expect(excludedConnectorIds).toEqual([c2]);

    const slide = store.read().slides[0];
    const g = slide.elements.find(e => e.id === groupId) as GroupElement;
    const childIds = g.data.children.map(ch => ch.id);
    expect(childIds).toContain(a);
    expect(childIds).toContain(b);
    expect(childIds).toContain(c1);
    expect(childIds).not.toContain(c2);

    // c2 and outside remain at slide root.
    const rootIds = slide.elements.map(e => e.id);
    expect(rootIds).toContain(c2);
    expect(rootIds).toContain(outside);
  });
});

describe('ungroup()', () => {
  it('flattens a group back into the parent at the same z-position', () => {
    const store = new MemSlidesStore();
    let sid!: string;
    store.batch(() => { sid = store.addSlide('blank', 0); });
    let a!: string;
    let b!: string;
    store.batch(() => {
      a = store.addElement(sid, {
        type: 'shape',
        frame: { x: 10, y: 10, w: 20, h: 20, rotation: 0 },
        data: { kind: 'rect' },
      });
      b = store.addElement(sid, {
        type: 'shape',
        frame: { x: 40, y: 50, w: 30, h: 10, rotation: 0 },
        data: { kind: 'rect' },
      });
    });
    let groupId!: string;
    store.batch(() => { ({ groupId } = store.group(sid, [a, b])); });
    let childIds!: string[];
    store.batch(() => { childIds = store.ungroup(sid, groupId); });
    expect(childIds).toEqual([a, b]);
    const slide = store.read().slides[0];
    expect(slide.elements.map(e => e.id)).toEqual([a, b]);
    expect(slide.elements[0].frame).toMatchObject({ x: 10, y: 10, w: 20, h: 20 });
    expect(slide.elements[1].frame).toMatchObject({ x: 40, y: 50, w: 30, h: 10 });
  });

  it('preserves rotation across group-ungroup round-trip', () => {
    const store = new MemSlidesStore();
    let sid!: string;
    store.batch(() => { sid = store.addSlide('blank', 0); });
    let a!: string;
    let b!: string;
    store.batch(() => {
      a = store.addElement(sid, {
        type: 'shape',
        frame: { x: 100, y: 100, w: 40, h: 20, rotation: Math.PI / 6 },
        data: { kind: 'rect' },
      });
      b = store.addElement(sid, {
        type: 'shape',
        frame: { x: 200, y: 100, w: 40, h: 20, rotation: 0 },
        data: { kind: 'rect' },
      });
    });
    let groupId!: string;
    store.batch(() => { ({ groupId } = store.group(sid, [a, b])); });
    // Rotate the group itself.
    store.batch(() => store.updateElementFrame(sid, groupId, { rotation: Math.PI / 4 }));
    store.batch(() => store.ungroup(sid, groupId));
    const slide = store.read().slides[0];
    // Composed rotation = child rotation + group rotation.
    expect(slide.elements[0].frame.rotation).toBeCloseTo(Math.PI / 6 + Math.PI / 4, 5);
    expect(slide.elements[1].frame.rotation).toBeCloseTo(Math.PI / 4, 5);
  });

  it('throws on missing group id', () => {
    const store = new MemSlidesStore();
    let sid!: string;
    store.batch(() => { sid = store.addSlide('blank', 0); });
    expect(() => store.batch(() => store.ungroup(sid, 'no-such-id'))).toThrow();
  });

  it('throws when element is not a group', () => {
    const store = new MemSlidesStore();
    let sid!: string;
    store.batch(() => { sid = store.addSlide('blank', 0); });
    let a!: string;
    store.batch(() => {
      a = store.addElement(sid, {
        type: 'shape',
        frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
        data: { kind: 'rect' },
      });
    });
    expect(() => store.batch(() => store.ungroup(sid, a))).toThrow(/not a group/i);
  });

  it('one ungroup = one undo step', () => {
    const store = new MemSlidesStore();
    let sid!: string;
    store.batch(() => { sid = store.addSlide('blank', 0); });
    let a!: string;
    let b!: string;
    store.batch(() => {
      a = store.addElement(sid, {
        type: 'shape',
        frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
        data: { kind: 'rect' },
      });
      b = store.addElement(sid, {
        type: 'shape',
        frame: { x: 20, y: 0, w: 10, h: 10, rotation: 0 },
        data: { kind: 'rect' },
      });
    });
    let groupId!: string;
    store.batch(() => { ({ groupId } = store.group(sid, [a, b])); });
    const before = store.read();
    store.batch(() => store.ungroup(sid, groupId));
    store.undo();
    const after = store.read();
    // After undo, the group is back as one element.
    expect(after.slides[0].elements.length).toBe(before.slides[0].elements.length);
    expect(after.slides[0].elements[0].type).toBe('group');
  });
});

import fc from 'fast-check';

// Math.fround of Math.PI gives us the nearest 32-bit float boundary.
const FC_PI = Math.fround(Math.PI);

describe('group/ungroup round-trip (property)', () => {
  it('world frames of children are preserved through group → ungroup', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            x: fc.float({ min: 0, max: 1000, noNaN: true }),
            y: fc.float({ min: 0, max: 1000, noNaN: true }),
            w: fc.float({ min: 10, max: 200, noNaN: true }),
            h: fc.float({ min: 10, max: 200, noNaN: true }),
            r: fc.float({ min: -FC_PI, max: FC_PI, noNaN: true }),
          }),
          { minLength: 2, maxLength: 5 },
        ),
        (shapes) => {
          const store = new MemSlidesStore();
          let sid!: string;
          store.batch(() => { sid = store.addSlide('blank', 0); });
          const ids: string[] = [];
          for (const s of shapes) {
            let id!: string;
            store.batch(() => {
              id = store.addElement(sid, {
                type: 'shape',
                frame: {
                  x: Math.fround(s.x), y: Math.fround(s.y),
                  w: Math.fround(s.w), h: Math.fround(s.h),
                  rotation: s.r,
                },
                data: { kind: 'rect' },
              });
            });
            ids.push(id);
          }
          const before = store.read().slides[0].elements.map((e) => ({ ...e.frame }));
          let groupId!: string;
          store.batch(() => { ({ groupId } = store.group(sid, ids)); });
          store.batch(() => store.ungroup(sid, groupId));
          const after = store.read().slides[0].elements.map((e) => ({ ...e.frame }));
          // Same count, same world frames within tight tolerance.
          expect(after).toHaveLength(before.length);
          for (let i = 0; i < before.length; i++) {
            expect(after[i].x).toBeCloseTo(before[i].x, 2);
            expect(after[i].y).toBeCloseTo(before[i].y, 2);
            expect(after[i].w).toBeCloseTo(before[i].w, 2);
            expect(after[i].h).toBeCloseTo(before[i].h, 2);
            expect(Math.sin(after[i].rotation)).toBeCloseTo(Math.sin(before[i].rotation), 4);
            expect(Math.cos(after[i].rotation)).toBeCloseTo(Math.cos(before[i].rotation), 4);
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe('legacy group refSize migration (simulates editor.ts startResize onUp)', () => {
  it('legacy group without refSize gains it on resize-style batch commit', () => {
    const store = new MemSlidesStore();
    let sid!: string;
    store.batch(() => { sid = store.addSlide('blank', 0); });
    let a!: string;
    let b!: string;
    store.batch(() => {
      a = store.addElement(sid, {
        type: 'shape',
        frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
        data: { kind: 'rect' },
      });
      b = store.addElement(sid, {
        type: 'shape',
        frame: { x: 100, y: 0, w: 50, h: 50, rotation: 0 },
        data: { kind: 'rect' },
      });
    });
    let groupId!: string;
    store.batch(() => { ({ groupId } = store.group(sid, [a, b])); });

    // Simulate legacy data: remove refSize as it would be absent in documents
    // created before the refSize field was introduced.
    store.batch(() => store.updateElementData(sid, groupId, { refSize: undefined }));
    const gBefore = store.read().slides[0].elements.find(e => e.id === groupId) as GroupElement;
    expect(gBefore.data.refSize).toBeUndefined();

    const startW = gBefore.frame.w;
    const startH = gBefore.frame.h;

    // Simulate the resize commit pattern from editor.ts startResize onUp.
    store.batch(() => {
      if (gBefore.type === 'group' && gBefore.data.refSize === undefined) {
        store.updateElementData(sid, groupId, { refSize: { w: startW, h: startH } });
      }
      store.updateElementFrame(sid, groupId, { w: startW * 2, h: startH });
    });

    const gAfter = store.read().slides[0].elements.find(e => e.id === groupId) as GroupElement;
    expect(gAfter.data.refSize).toEqual({ w: startW, h: startH });
    expect(gAfter.frame.w).toBe(startW * 2);
  });
});

describe('refitGroup()', () => {
  /**
   * Build a slide with a group of two rects (A at (0,0,40,30), B at
   * (60,60,40,40)). Returns the store, slide id, and group id so each
   * test can mutate further before calling refitGroup.
   */
  function setupGroupWithTwoShapes(): {
    store: MemSlidesStore;
    sid: string;
    groupId: string;
    aId: string;
    bId: string;
  } {
    const store = new MemSlidesStore();
    let sid!: string;
    let aId!: string;
    let bId!: string;
    let groupId!: string;
    store.batch(() => {
      sid = store.addSlide('blank', 0);
    });
    store.batch(() => {
      aId = store.addElement(sid, {
        type: 'shape',
        frame: { x: 0, y: 0, w: 40, h: 30, rotation: 0 },
        data: { kind: 'rect' },
      });
      bId = store.addElement(sid, {
        type: 'shape',
        frame: { x: 60, y: 60, w: 40, h: 40, rotation: 0 },
        data: { kind: 'rect' },
      });
    });
    store.batch(() => {
      const result = store.group(sid, [aId, bId]);
      groupId = result.groupId;
    });
    return { store, sid, groupId, aId, bId };
  }

  it('is a no-op when children are still tightly fit (idempotent)', () => {
    const { store, sid, groupId } = setupGroupWithTwoShapes();
    const before = store.read().slides[0].elements.find(
      (e) => e.id === groupId,
    ) as GroupElement;
    const beforeFrame = { ...before.frame };
    const beforeRefSize = { ...before.data.refSize! };

    store.batch(() => {
      store.refitGroup(sid, groupId);
    });

    const after = store.read().slides[0].elements.find(
      (e) => e.id === groupId,
    ) as GroupElement;
    expect(after.frame).toEqual(beforeFrame);
    expect(after.data.refSize).toEqual(beforeRefSize);
  });

  it('shrinks frame to the new AABB when a child was moved further outside (slide-root)', () => {
    // Initial: group AABB = (0, 0, 100, 100). Move child B to (110, 110)
    // so the AABB grows to (0, 0, 150, 150). Refit should update frame.
    const { store, sid, groupId, bId } = setupGroupWithTwoShapes();

    // Update B's local frame (B sits inside group local space). Since the
    // group started with frame == refSize == (0,0,100,100) and unit scale,
    // local coords equal world coords for B's original frame. After move,
    // B's local frame becomes (110, 110, 40, 40).
    store.batch(() => {
      store.updateElementFrame(sid, bId, { x: 110, y: 110 });
    });

    store.batch(() => {
      store.refitGroup(sid, groupId);
    });

    const after = store.read().slides[0].elements.find(
      (e) => e.id === groupId,
    ) as GroupElement;
    expect(after.frame.x).toBeCloseTo(0, 4);
    expect(after.frame.y).toBeCloseTo(0, 4);
    expect(after.frame.w).toBeCloseTo(150, 4);
    expect(after.frame.h).toBeCloseTo(150, 4);
    expect(after.frame.rotation).toBe(0);
    expect(after.data.refSize).toEqual({ w: 150, h: 150 });
  });

  it('preserves children world positions across the refit', () => {
    const { store, sid, groupId, aId, bId } = setupGroupWithTwoShapes();

    // Move B to (-30, -20) inside group-local coords (B's world position
    // = (-30, -20) since scale=1 / origin=0 here).
    store.batch(() => {
      store.updateElementFrame(sid, bId, { x: -30, y: -20 });
    });

    // Capture world positions of A and B BEFORE refit.
    const slideBefore = store.read().slides[0];
    const groupBefore = slideBefore.elements.find(
      (e) => e.id === groupId,
    ) as GroupElement;
    const childrenBefore = groupBefore.data.children.map((ch) =>
      applyGroupTransform(ch.frame, groupBefore),
    );
    const aBefore = childrenBefore.find((_, i) => groupBefore.data.children[i].id === aId)!;
    const bBefore = childrenBefore.find((_, i) => groupBefore.data.children[i].id === bId)!;

    store.batch(() => {
      store.refitGroup(sid, groupId);
    });

    const groupAfter = store.read().slides[0].elements.find(
      (e) => e.id === groupId,
    ) as GroupElement;
    const childrenAfter = groupAfter.data.children.map((ch) =>
      applyGroupTransform(ch.frame, groupAfter),
    );
    const aAfter = childrenAfter.find((_, i) => groupAfter.data.children[i].id === aId)!;
    const bAfter = childrenAfter.find((_, i) => groupAfter.data.children[i].id === bId)!;

    expect(aAfter.x).toBeCloseTo(aBefore.x, 4);
    expect(aAfter.y).toBeCloseTo(aBefore.y, 4);
    expect(aAfter.w).toBeCloseTo(aBefore.w, 4);
    expect(aAfter.h).toBeCloseTo(aBefore.h, 4);
    expect(bAfter.x).toBeCloseTo(bBefore.x, 4);
    expect(bAfter.y).toBeCloseTo(bBefore.y, 4);
  });

  it('preserves group.frame.rotation across refit (rotated group stays rotated)', () => {
    const { store, sid, groupId } = setupGroupWithTwoShapes();
    store.batch(() => {
      store.updateElementFrame(sid, groupId, { rotation: Math.PI / 4 });
    });

    store.batch(() => {
      store.refitGroup(sid, groupId);
    });

    const after = store.read().slides[0].elements.find(
      (e) => e.id === groupId,
    ) as GroupElement;
    expect(after.frame.rotation).toBeCloseTo(Math.PI / 4, 6);
  });

  it('refit on a rotated group with a moved child preserves rotation AND each child world position', () => {
    const { store, sid, groupId, aId, bId } = setupGroupWithTwoShapes();
    // 1. Rotate the group.
    store.batch(() => {
      store.updateElementFrame(sid, groupId, { rotation: Math.PI / 6 });
    });
    // 2. Move child B inside drill-in (move its local frame).
    store.batch(() => {
      store.updateElementFrame(sid, bId, { x: 200, y: -50 });
    });

    // Capture children's world positions BEFORE refit using the rotated
    // group's transform.
    const before = store.read().slides[0].elements.find(
      (e) => e.id === groupId,
    ) as GroupElement;
    const worldBefore = new Map(
      before.data.children.map((ch) => [
        ch.id,
        applyGroupTransform(ch.frame, before),
      ]),
    );

    store.batch(() => {
      store.refitGroup(sid, groupId);
    });

    const after = store.read().slides[0].elements.find(
      (e) => e.id === groupId,
    ) as GroupElement;

    // Rotation preserved.
    expect(after.frame.rotation).toBeCloseTo(Math.PI / 6, 6);

    // Each child's world position invariant across refit.
    for (const childId of [aId, bId]) {
      const childAfter = after.data.children.find((c) => c.id === childId)!;
      const worldAfter = applyGroupTransform(childAfter.frame, after);
      const w = worldBefore.get(childId)!;
      expect(worldAfter.x).toBeCloseTo(w.x, 3);
      expect(worldAfter.y).toBeCloseTo(w.y, 3);
      expect(worldAfter.w).toBeCloseTo(w.w, 3);
      expect(worldAfter.h).toBeCloseTo(w.h, 3);
    }

    // Local AABB after refit is tight: minX = 0, minY = 0 and refSize
    // matches the children's local extent.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const ch of after.data.children) {
      if (ch.frame.x < minX) minX = ch.frame.x;
      if (ch.frame.y < minY) minY = ch.frame.y;
      if (ch.frame.x + ch.frame.w > maxX) maxX = ch.frame.x + ch.frame.w;
      if (ch.frame.y + ch.frame.h > maxY) maxY = ch.frame.y + ch.frame.h;
    }
    expect(minX).toBeCloseTo(0, 4);
    expect(minY).toBeCloseTo(0, 4);
    expect(after.data.refSize?.w).toBeCloseTo(maxX - minX, 4);
    expect(after.data.refSize?.h).toBeCloseTo(maxY - minY, 4);
  });

  it('no-op when group has been removed concurrently (defensive)', () => {
    const { store, sid, groupId } = setupGroupWithTwoShapes();
    store.batch(() => {
      store.removeElement(sid, groupId);
    });
    expect(() =>
      store.batch(() => {
        store.refitGroup(sid, groupId);
      }),
    ).not.toThrow();
  });

  it('no-op on a non-group element id (defensive)', () => {
    const { store, sid, aId } = setupGroupWithTwoShapes();
    expect(() =>
      store.batch(() => {
        store.refitGroup(sid, aId);
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Resting-scale invariant — regression for the "smiley squishes on ungroup"
// bug. See docs/design/slides/slides-group.md §6.1 and
// docs/tasks/active/20260704-ungroup-scale-invariant-todo.md.
// ---------------------------------------------------------------------------

describe('resting-scale invariant', () => {
  function findDeep(els: Element[], id: string): Element | undefined {
    for (const e of els) {
      if (e.id === id) return e;
      if (e.type === 'group') {
        const r = findDeep(e.data.children, id);
        if (r) return r;
      }
    }
    return undefined;
  }

  it('bakeGroupResize recursively settles nested child groups', () => {
    const store = new MemSlidesStore();
    let sid!: string;
    store.batch(() => { sid = store.addSlide('blank', 0); });
    let a!: string; let b!: string; let c!: string;
    store.batch(() => {
      a = store.addElement(sid, {
        type: 'shape', frame: { x: 0, y: 0, w: 40, h: 40, rotation: 0 },
        data: { kind: 'rect' },
      });
      b = store.addElement(sid, {
        type: 'shape', frame: { x: 60, y: 0, w: 40, h: 40, rotation: 0 },
        data: { kind: 'rect' },
      });
      c = store.addElement(sid, {
        type: 'shape', frame: { x: 0, y: 120, w: 40, h: 40, rotation: 0 },
        data: { kind: 'rect' },
      });
    });
    let inner!: string;
    store.batch(() => { inner = store.group(sid, [a, b]).groupId; });
    let outer!: string;
    store.batch(() => { outer = store.group(sid, [inner, c]).groupId; });

    const g0 = findDeep(store.read().slides[0].elements, outer)! as GroupElement;
    const w0 = g0.frame.w; const h0 = g0.frame.h;
    const innerW0 = (findDeep(store.read().slides[0].elements, inner)! as GroupElement).frame.w;

    // Non-uniform resize commit (updateElementFrame + bakeGroupResize),
    // exactly the pattern the editor uses at resize onUp.
    store.batch(() => {
      store.updateElementFrame(sid, outer, { w: w0 * 2, h: h0 });
      store.bakeGroupResize(sid, outer);
    });

    const els = store.read().slides[0].elements;
    // The whole tree — outer AND inner — rests at scale 1.
    expect(collectUnsettledGroups(els)).toEqual([]);
    const innerG = findDeep(els, inner)! as GroupElement;
    expect(innerG.data.refSize).toEqual({ w: innerG.frame.w, h: innerG.frame.h });
    // The inner group's width was scaled by the outer's 2× (children
    // follow the group), proving the bake actually descended.
    expect(innerG.frame.w).toBeCloseTo(innerW0 * 2, 4);
  });

  // Build a group of a rotated "smiley" + a plain rect, then force a
  // residual non-uniform scale WITHOUT baking — the exact state a pre-fix
  // multi-resize / format-panel commit leaves behind.
  function buildDirtyGroup(): {
    store: MemSlidesStore; sid: string; groupId: string; aId: string;
  } {
    const store = new MemSlidesStore();
    let sid!: string;
    store.batch(() => { sid = store.addSlide('blank', 0); });
    let a!: string; let b!: string;
    store.batch(() => {
      // Non-square (60×40) rotated 20° so scaleRotatedFrame's bbox solver
      // produces a genuinely different result from the per-axis bake — a
      // square child would hit the solver's degenerate fallback (which
      // equals per-axis) and mask the bug.
      a = store.addElement(sid, {
        type: 'shape',
        frame: { x: 0, y: 0, w: 60, h: 40, rotation: Math.PI / 9 },
        data: { kind: 'smileyFace' },
      });
      b = store.addElement(sid, {
        type: 'shape', frame: { x: 160, y: 0, w: 50, h: 50, rotation: 0 },
        data: { kind: 'rect' },
      });
    });
    let groupId!: string;
    store.batch(() => { groupId = store.group(sid, [a, b]).groupId; });
    const g0 = store.read().slides[0].elements.find(
      (e) => e.id === groupId,
    ) as GroupElement;
    // Mild 1.5× horizontal stretch (sx=1.5, sy=1) — keeps the solver in
    // its positive-root branch instead of the degenerate fallback.
    store.batch(() => {
      store.updateElementFrame(sid, groupId, { w: g0.frame.w * 1.5, h: g0.frame.h });
    });
    return { store, sid, groupId, aId: a };
  }

  it('ungroup leaves no residual group scale even from a dirty group', () => {
    const { store, sid, groupId } = buildDirtyGroup();
    // Precondition: the group is genuinely dirty (scale ≈ 2×1).
    expect(collectUnsettledGroups(store.read().slides[0].elements)).toHaveLength(1);

    store.batch(() => { store.ungroup(sid, groupId); });
    expect(collectUnsettledGroups(store.read().slides[0].elements)).toEqual([]);
  });

  it('ungroup(dirty) equals bakeGroupResize + ungroup (settle-first, no distortion)', () => {
    // Path A: ungroup the dirty group directly.
    const A = buildDirtyGroup();
    A.store.batch(() => { A.store.ungroup(A.sid, A.groupId); });
    const childA = A.store.read().slides[0].elements.find((e) => e.id === A.aId)!;

    // Path B: bake the residual scale first, then ungroup.
    const B = buildDirtyGroup();
    B.store.batch(() => {
      B.store.bakeGroupResize(B.sid, B.groupId);
      B.store.ungroup(B.sid, B.groupId);
    });
    const childB = B.store.read().slides[0].elements.find((e) => e.id === B.aId)!;

    // The rotated smiley's baked frame is identical either way — ungroup
    // settles the scale internally instead of shearing it into a
    // bbox-preserving rect.
    expect(childA.frame.x).toBeCloseTo(childB.frame.x, 6);
    expect(childA.frame.y).toBeCloseTo(childB.frame.y, 6);
    expect(childA.frame.w).toBeCloseTo(childB.frame.w, 6);
    expect(childA.frame.h).toBeCloseTo(childB.frame.h, 6);
    expect(childA.frame.rotation).toBeCloseTo(childB.frame.rotation, 6);
    // Rotation is preserved (not folded into a bbox).
    expect(childA.frame.rotation).toBeCloseTo(Math.PI / 9, 6);
  });

  it('recursive bake scales grandchildren of a LEGACY nested group (no refSize)', () => {
    const store = new MemSlidesStore();
    let sid!: string;
    store.batch(() => { sid = store.addSlide('blank', 0); });
    let a!: string; let b!: string; let c!: string;
    store.batch(() => {
      a = store.addElement(sid, {
        type: 'shape', frame: { x: 0, y: 0, w: 40, h: 40, rotation: 0 },
        data: { kind: 'rect' },
      });
      b = store.addElement(sid, {
        type: 'shape', frame: { x: 60, y: 0, w: 40, h: 40, rotation: 0 },
        data: { kind: 'rect' },
      });
      c = store.addElement(sid, {
        type: 'shape', frame: { x: 0, y: 120, w: 40, h: 40, rotation: 0 },
        data: { kind: 'rect' },
      });
    });
    let inner!: string;
    store.batch(() => { inner = store.group(sid, [a, b]).groupId; });
    // Simulate a legacy inner group created before the refSize field
    // existed (the model documents refSize as optional / backward-compat).
    store.batch(() => store.updateElementData(sid, inner, { refSize: undefined }));
    let outer!: string;
    store.batch(() => { outer = store.group(sid, [inner, c]).groupId; });

    const grandBefore = (findDeep(store.read().slides[0].elements, a) as Element).frame.w;
    const g0 = findDeep(store.read().slides[0].elements, outer) as GroupElement;

    // Non-uniform 2× horizontal resize of the OUTER group + commit.
    store.batch(() => {
      store.updateElementFrame(sid, outer, { w: g0.frame.w * 2, h: g0.frame.h });
      store.bakeGroupResize(sid, outer);
    });

    const els = store.read().slides[0].elements;
    expect(collectUnsettledGroups(els)).toEqual([]);
    // The grandchild inside the legacy inner group must have scaled with
    // the group (width ×2), not been left at its original size inside a
    // doubled inner frame.
    const grandAfter = (findDeep(els, a) as Element).frame.w;
    expect(grandAfter).toBeCloseTo(grandBefore * 2, 3);
  });
});
