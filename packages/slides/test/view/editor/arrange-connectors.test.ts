// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import type { Frame } from '../../../src/model/element';
import type { ConnectorElement } from '../../../src/model/connector';
import { MemSlidesStore } from '../../../src/store/memory';
import { initialize, type SlidesEditor } from '../../../src/view/editor/editor';
import { arrangeableFrames } from '../../../src/view/editor/align';
import { resolveEndpoint } from '../../../src/view/canvas/connector-frame';

const f = (x: number, y: number, w = 100, h = 100): Frame => ({ x, y, w, h, rotation: 0 });

describe('arrangeableFrames', () => {
  const frames = new Map<string, Frame>([
    ['a', f(0, 0)],
    ['c', f(50, 50)],
    ['b', f(300, 0)],
  ]);

  it('drops connectors from a mixed selection', () => {
    const out = arrangeableFrames(frames, (id) => id === 'c');
    expect([...out.keys()]).toEqual(['a', 'b']);
  });

  it('keeps every frame when the selection is only connectors', () => {
    const out = arrangeableFrames(frames, () => true);
    expect(out.size).toBe(3);
  });
});

describe('editor align / distribute with connectors', () => {
  let editor: SlidesEditor | null = null;

  afterEach(() => {
    editor?.detach();
    editor = null;
    document.body.innerHTML = '';
  });

  function setup() {
    const canvas = document.createElement('canvas');
    const overlay = document.createElement('div');
    document.body.append(canvas, overlay);
    const store = new MemSlidesStore();
    store.batch(() => store.addSlide('blank'));
    const sid = store.read().slides[0].id;
    const addShape = (x: number, w = 100) => {
      let id = '';
      store.batch(() => {
        id = store.addElement(sid, {
          type: 'shape',
          frame: f(x, 0, w),
          data: { kind: 'rect' },
        });
      });
      return id;
    };
    const addConnector = (
      start: ConnectorElement['start'],
      end: ConnectorElement['end'],
    ) => {
      let id = '';
      store.batch(() => {
        id = store.addElement(sid, {
          type: 'connector',
          routing: 'straight',
          start,
          end,
          arrowheads: {},
          frame: f(0, 0, 0, 0),
        });
      });
      return id;
    };
    editor = initialize({
      canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1,
    });
    const el = (id: string) =>
      store.read().slides[0].elements.find((e) => e.id === id)!;
    return { store, addShape, addConnector, el };
  }

  it('distribute spaces the shapes evenly and leaves glued connectors attached', () => {
    const { store, addShape, addConnector, el } = setup();
    const a = addShape(0);
    const b = addShape(150, 50);
    const c = addShape(400);
    // A connector from a's E site to b's W site, caught by the marquee.
    const conn = addConnector(
      { kind: 'attached', elementId: a, siteIndex: 1 },
      { kind: 'attached', elementId: b, siteIndex: 3 },
    );
    editor!.setSelection([a, b, c, conn]);
    editor!.distribute('horizontal');
    // Same result as distributing the three shapes alone:
    // gap = (400 - 0 - 150) / 2 = 125 → b.x = 225.
    expect(el(b).frame.x).toBe(225);
    expect(el(a).frame.x).toBe(0);
    expect(el(c).frame.x).toBe(400);
    const moved = el(conn) as ConnectorElement;
    expect(moved.start).toEqual({ kind: 'attached', elementId: a, siteIndex: 1 });
    expect(moved.end).toEqual({ kind: 'attached', elementId: b, siteIndex: 3 });
    // The glued end now resolves to b's new W site.
    const lookup = new Map(store.read().slides[0].elements.map((e) => [e.id, e]));
    expect(resolveEndpoint(moved.end, lookup)).toEqual({ x: 225, y: 50 });
  });

  it('align ignores a connector when computing the reference box', () => {
    const { addShape, addConnector, el } = setup();
    const a = addShape(100);
    const b = addShape(300);
    // A free connector reaching further left than either shape.
    const conn = addConnector(
      { kind: 'free', x: 0, y: 500 },
      { kind: 'free', x: 50, y: 600 },
    );
    editor!.setSelection([a, b, conn]);
    editor!.align('left');
    expect(el(a).frame.x).toBe(100);
    expect(el(b).frame.x).toBe(100);
    const c = el(conn) as ConnectorElement;
    expect(c.start).toEqual({ kind: 'free', x: 0, y: 500 });
  });

  it('one shape + a connector aligns to itself, not to the slide', () => {
    const { addShape, addConnector, el } = setup();
    const a = addShape(100);
    const conn = addConnector(
      { kind: 'free', x: 0, y: 500 },
      { kind: 'free', x: 50, y: 600 },
    );
    editor!.setSelection([a, conn]);
    editor!.align('center-h');
    expect(el(a).frame.x).toBe(100);
  });

  it('a selection of only connectors still aligns them', () => {
    const { addConnector, el } = setup();
    const c1 = addConnector({ kind: 'free', x: 100, y: 0 }, { kind: 'free', x: 200, y: 0 });
    const c2 = addConnector({ kind: 'free', x: 400, y: 100 }, { kind: 'free', x: 500, y: 100 });
    editor!.setSelection([c1, c2]);
    editor!.align('left');
    const moved = el(c2) as ConnectorElement;
    expect(moved.start.kind === 'free' && moved.start.x).toBeLessThan(400);
  });
});
