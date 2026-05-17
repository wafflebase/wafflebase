import { describe, expect, it } from 'vitest';
import { MemSlidesStore } from '../../src/store/memory';
import type { GroupElement } from '../../src/model/element';

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

describe('ungroup() stub', () => {
  it('throws "not implemented"', () => {
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
    expect(() => store.batch(() => store.ungroup(sid, groupId))).toThrow(/not implemented/i);
  });
});
