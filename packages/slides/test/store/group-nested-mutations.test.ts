import { describe, expect, it } from 'vitest';
import { MemSlidesStore } from '../../src/store/memory';
import type { GroupElement } from '../../src/model/element';

function setup() {
  const store = new MemSlidesStore();
  let sid!: string;
  store.batch(() => { sid = store.addSlide('blank', 0); });
  return { store, sid };
}

describe('updateElementFrame on nested elements', () => {
  it('mutates a child inside a group', () => {
    const { store, sid } = setup();
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
        frame: { x: 50, y: 0, w: 10, h: 10, rotation: 0 },
        data: { kind: 'rect' },
      });
    });
    store.batch(() => store.group(sid, [a, b]));
    store.batch(() => store.updateElementFrame(sid, a, { x: 5 }));
    const g = store.read().slides[0].elements[0] as GroupElement;
    expect(g.data.children[0].frame.x).toBe(5);
  });
});

describe('addElement with parentGroupId', () => {
  it('appends to the named group', () => {
    const { store, sid } = setup();
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
        frame: { x: 50, y: 0, w: 10, h: 10, rotation: 0 },
        data: { kind: 'rect' },
      });
    });
    let groupId!: string;
    store.batch(() => { groupId = store.group(sid, [a, b]).groupId; });
    let c!: string;
    store.batch(() => {
      c = store.addElement(sid, {
        type: 'shape',
        frame: { x: 5, y: 5, w: 10, h: 10, rotation: 0 },
        data: { kind: 'rect' },
      }, groupId);
    });
    const g = store.read().slides[0].elements[0] as GroupElement;
    expect(g.data.children.map(x => x.id)).toEqual([a, b, c]);
  });

  it('throws if parentGroupId is not a group', () => {
    const { store, sid } = setup();
    let a!: string;
    store.batch(() => {
      a = store.addElement(sid, {
        type: 'shape',
        frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
        data: { kind: 'rect' },
      });
    });
    expect(() => store.batch(() => store.addElement(sid, {
      type: 'shape',
      frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
      data: { kind: 'rect' },
    }, a))).toThrow(/not a group/i);
  });

  it('throws if parentGroupId is unknown', () => {
    const { store, sid } = setup();
    expect(() => store.batch(() => store.addElement(sid, {
      type: 'shape',
      frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
      data: { kind: 'rect' },
    }, 'no-such-id'))).toThrow();
  });
});

describe('empty-group auto-removal', () => {
  it('removeElement on the last group child removes the parent group', () => {
    const { store, sid } = setup();
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
    store.batch(() => { groupId = store.group(sid, [a, b]).groupId; });
    store.batch(() => store.removeElement(sid, a));
    // Group still has one child — should still exist.
    expect(store.read().slides[0].elements.find(e => e.id === groupId)).toBeDefined();
    store.batch(() => store.removeElement(sid, b));
    // Group is now empty — should be removed.
    expect(store.read().slides[0].elements.find(e => e.id === groupId)).toBeUndefined();
  });

  it('removeElements that empties multiple ancestor groups cleans them all', () => {
    const { store, sid } = setup();
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
        frame: { x: 20, y: 0, w: 10, h: 10, rotation: 0 },
        data: { kind: 'rect' },
      });
    });
    let innerId!: string;
    store.batch(() => { innerId = store.group(sid, [a, b]).groupId; });
    // Need a second element to make an outer group; add one and group with inner.
    store.batch(() => {
      c = store.addElement(sid, {
        type: 'shape',
        frame: { x: 100, y: 0, w: 10, h: 10, rotation: 0 },
        data: { kind: 'rect' },
      });
    });
    let outerId!: string;
    store.batch(() => { outerId = store.group(sid, [innerId, c]).groupId; });
    // Remove everything inside inner — should bubble up and remove inner and outer when c is also removed.
    store.batch(() => store.removeElements(sid, [a, b, c]));
    expect(store.read().slides[0].elements.find(e => e.id === innerId)).toBeUndefined();
    expect(store.read().slides[0].elements.find(e => e.id === outerId)).toBeUndefined();
  });
});

describe('reorderElement inside a group', () => {
  it('reorders within the immediate parent only', () => {
    const { store, sid } = setup();
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
        frame: { x: 20, y: 0, w: 10, h: 10, rotation: 0 },
        data: { kind: 'rect' },
      });
      c = store.addElement(sid, {
        type: 'shape',
        frame: { x: 40, y: 0, w: 10, h: 10, rotation: 0 },
        data: { kind: 'rect' },
      });
    });
    store.batch(() => store.group(sid, [a, b, c]));
    store.batch(() => store.reorderElement(sid, a, 2)); // move a from front to back of group.
    const g = store.read().slides[0].elements[0] as GroupElement;
    expect(g.data.children.map(x => x.id)).toEqual([b, c, a]);
  });
});
