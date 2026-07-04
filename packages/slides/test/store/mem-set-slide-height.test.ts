import { describe, it, expect } from 'vitest';
import { MemSlidesStore } from '../../src/store/memory';
import type { GroupElement, TableElement } from '../../src/model/element';
import type { ConnectorElement } from '../../src/model/connector';
import { applyGroupTransform } from '../../src/model/group';

/** Fresh store with one blank slide; returns [store, slideId]. */
function seed(): [MemSlidesStore, string] {
  const store = new MemSlidesStore();
  let sid!: string;
  store.batch(() => {
    sid = store.addSlide('blank', 0);
  });
  return [store, sid];
}

describe('MemSlidesStore.setSlideHeight', () => {
  it('records meta.slideHeight and scales a shape y/h, leaving x/w', () => {
    const [store, sid] = seed();
    let id!: string;
    store.batch(() => {
      id = store.addElement(sid, {
        type: 'shape',
        frame: { x: 100, y: 300, w: 400, h: 200, rotation: 0 },
        data: { kind: 'rect' },
      });
    });
    store.batch(() => store.setSlideHeight(1440)); // 1080 -> 1440, factor 4/3
    const doc = store.read();
    expect(doc.meta.slideHeight).toBe(1440);
    const f = doc.slides[0].elements.find((e) => e.id === id)!.frame;
    expect(f.x).toBe(100);
    expect(f.w).toBe(400);
    expect(f.y).toBeCloseTo(400, 6); // 300 * 4/3
    expect(f.h).toBeCloseTo(266.6667, 3); // 200 * 4/3
  });

  it('is a no-op when the height is unchanged', () => {
    const [store, sid] = seed();
    let id!: string;
    store.batch(() => {
      id = store.addElement(sid, {
        type: 'shape',
        frame: { x: 0, y: 300, w: 10, h: 10, rotation: 0 },
        data: { kind: 'rect' },
      });
    });
    const before = store.read().slides[0].elements.find((e) => e.id === id)!.frame.y;
    store.batch(() => store.setSlideHeight(1080));
    expect(store.read().slides[0].elements.find((e) => e.id === id)!.frame.y).toBe(before);
  });

  it('scales group children proportionally in world space', () => {
    const [store, sid] = seed();
    let a!: string;
    let b!: string;
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
    });
    let gid!: string;
    store.batch(() => {
      ({ groupId: gid } = store.group(sid, [a, b]));
    });
    store.batch(() => store.setSlideHeight(1440));
    const group = store
      .read()
      .slides[0].elements.find((e) => e.id === gid) as GroupElement;
    // Child A's world frame: originally y=200 h=100 → y=266.67 h=133.33.
    const childA = group.data.children.find((c) => c.id === a)!;
    const world = applyGroupTransform(childA.frame, group);
    expect(world.x).toBeCloseTo(100, 3); // x unchanged
    expect(world.w).toBeCloseTo(100, 3);
    expect(world.y).toBeCloseTo(200 * (4 / 3), 3);
    expect(world.h).toBeCloseTo(100 * (4 / 3), 3);
  });

  it('scales table row heights with the frame', () => {
    const [store, sid] = seed();
    let id!: string;
    store.batch(() => {
      id = store.addElement(sid, {
        type: 'table',
        frame: { x: 0, y: 0, w: 400, h: 200, rotation: 0 },
        data: {
          columnWidths: [200, 200],
          rows: [
            { height: 100, cells: [{ body: { blocks: [] }, style: {} }, { body: { blocks: [] }, style: {} }] },
            { height: 100, cells: [{ body: { blocks: [] }, style: {} }, { body: { blocks: [] }, style: {} }] },
          ],
        },
      });
    });
    store.batch(() => store.setSlideHeight(1440));
    const t = store.read().slides[0].elements.find((e) => e.id === id) as TableElement;
    expect(t.frame.h).toBeCloseTo(200 * (4 / 3), 3);
    expect(t.data.rows[0].height).toBeCloseTo(100 * (4 / 3), 3);
    expect(t.data.columnWidths[0]).toBe(200); // widths untouched
  });

  it('scales a connector free endpoint y, leaving x', () => {
    const [store, sid] = seed();
    let id!: string;
    store.batch(() => {
      id = store.addElement(sid, {
        type: 'connector',
        routing: 'straight',
        arrowheads: {},
        frame: { x: 0, y: 0, w: 0, h: 0, rotation: 0 },
        start: { kind: 'free', x: 100, y: 300 },
        end: { kind: 'free', x: 500, y: 600 },
      });
    });
    store.batch(() => store.setSlideHeight(1440));
    const c = store.read().slides[0].elements.find((e) => e.id === id) as ConnectorElement;
    expect(c.start.kind).toBe('free');
    if (c.start.kind === 'free') {
      expect(c.start.x).toBe(100);
      expect(c.start.y).toBeCloseTo(300 * (4 / 3), 3);
    }
    if (c.end.kind === 'free') {
      expect(c.end.y).toBeCloseTo(600 * (4 / 3), 3);
    }
  });

  it('undo restores the prior height and frames in one step', () => {
    const [store, sid] = seed();
    let id!: string;
    store.batch(() => {
      id = store.addElement(sid, {
        type: 'shape',
        frame: { x: 0, y: 300, w: 10, h: 10, rotation: 0 },
        data: { kind: 'rect' },
      });
    });
    store.batch(() => store.setSlideHeight(1440));
    store.undo();
    const doc = store.read();
    expect(doc.meta.slideHeight ?? 1080).toBe(1080);
    expect(doc.slides[0].elements.find((e) => e.id === id)!.frame.y).toBe(300);
  });
});
