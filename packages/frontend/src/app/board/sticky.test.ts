import { describe, it, expect, vi } from 'vitest';
import {
  STICKY_COLORS,
  STICKY_GAP,
  STICKY_SIZE,
  adjacentStickyCenter,
  buildStickyInit,
  dropStickyAtViewportCenter,
  freeStickyCenter,
  isStickyElement,
  visibleWorldRect,
} from './sticky';

describe('buildStickyInit', () => {
  it('builds a roundRect shape centered on the given world point', () => {
    const init = buildStickyInit('#FFF8B8', { x: 500, y: 300 });
    expect(init.type).toBe('shape');
    const data = init.data as Record<string, unknown>;
    expect(data.kind).toBe('roundRect');
    expect(data.fill).toEqual({ kind: 'srgb', value: '#FFF8B8' });
    // frame centered on (500,300), size STICKY_SIZE square
    expect(init.frame).toMatchObject({
      x: 500 - STICKY_SIZE / 2,
      y: 300 - STICKY_SIZE / 2,
      w: STICKY_SIZE,
      h: STICKY_SIZE,
      rotation: 0,
    });
  });

  it('gives the sticky a middle-anchored, shrink-autofit, center-aligned text body', () => {
    const init = buildStickyInit('#CDEFC4', { x: 0, y: 0 });
    const text = (init.data as { text: { verticalAnchor: string; autofit: string; blocks: { style: { alignment: string } }[] } }).text;
    expect(text.verticalAnchor).toBe('middle');
    expect(text.autofit).toBe('shrink');
    expect(text.blocks[0].style.alignment).toBe('center');
  });

  it('writes the role marker, and the author and options it is given', () => {
    const init = buildStickyInit('#FFF8B8', { x: 0, y: 0 }, {
      author: ' Ada ', text: 'Idea', fontSize: 32, size: { w: 120, h: 120 },
    });
    const data = (init as unknown as { data: unknown }).data as {
      role: string; author: string;
      text: { blocks: { inlines: { text: string; style: { fontSize: number } }[] }[] };
    };
    expect(data.role).toBe('sticky');
    expect(data.author).toBe('Ada');
    expect(data.text.blocks[0].inlines[0].text).toBe('Idea');
    expect(data.text.blocks[0].inlines[0].style.fontSize).toBe(32);
    expect(init.frame).toMatchObject({ x: -60, y: -60, w: 120, h: 120 });
    expect('author' in buildStickyInit('#FFF8B8', { x: 0, y: 0 }).data).toBe(false);
  });

  it('carries a drop shadow', () => {
    const init = buildStickyInit('#C7E5FF', { x: 0, y: 0 });
    const effects = (init.data as { effects: { shadow?: unknown } }).effects;
    expect(effects.shadow).toBeDefined();
  });
});

describe('STICKY_COLORS', () => {
  it('has 6 distinct hex colors', () => {
    expect(STICKY_COLORS).toHaveLength(6);
    const values = STICKY_COLORS.map((c) => c.value);
    expect(new Set(values).size).toBe(6);
    for (const v of values) expect(v).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});

describe('dropStickyAtViewportCenter', () => {
  it('adds a sticky centered on the viewport, then selects + edits it', () => {
    const addElement = vi.fn().mockReturnValue('sticky-1');
    const batch = vi.fn((fn: () => void) => fn());
    const store = { addElement, batch } as unknown as import('@wafflebase/slides').SlidesStore;
    const setSelection = vi.fn();
    const enterTextEditing = vi.fn();
    const editor = { setSelection, enterTextEditing } as unknown as import('@wafflebase/slides').SlidesEditor;

    // viewport zoom=1, pan=0 → screen center (400,300) maps to world (400,300)
    const id = dropStickyAtViewportCenter({
      store, editor,
      viewport: { panX: 0, panY: 0, zoom: 1 },
      hostWidth: 800, hostHeight: 600,
      colorValue: '#FFF8B8',
    });

    expect(id).toBe('sticky-1');
    expect(batch).toHaveBeenCalledTimes(1);
    const [slideId, init] = addElement.mock.calls[0];
    expect(slideId).toBe('board');
    expect(init.frame.x).toBe(400 - STICKY_SIZE / 2);
    expect(init.frame.y).toBe(300 - STICKY_SIZE / 2);
    expect(setSelection).toHaveBeenCalledWith(['sticky-1']);
    expect(enterTextEditing).toHaveBeenCalledWith('sticky-1');
  });

  it('centers on the transformed world point under a panned + zoomed viewport', () => {
    const addElement = vi.fn().mockReturnValue('sticky-2');
    const batch = vi.fn((fn: () => void) => fn());
    const store = { addElement, batch } as unknown as import('@wafflebase/slides').SlidesStore;
    const editor = {
      setSelection: vi.fn(),
      enterTextEditing: vi.fn(),
    } as unknown as import('@wafflebase/slides').SlidesEditor;

    // zoom=2, pan=(100,50), host 800×600 → screen center (400,300) maps to
    // world ((400-100)/2, (300-50)/2) = (150, 125).
    dropStickyAtViewportCenter({
      store, editor,
      viewport: { panX: 100, panY: 50, zoom: 2 },
      hostWidth: 800, hostHeight: 600,
      colorValue: '#CDEFC4',
    });

    const [, init] = addElement.mock.calls[0];
    expect(init.frame.x).toBe(150 - STICKY_SIZE / 2);
    expect(init.frame.y).toBe(125 - STICKY_SIZE / 2);
  });

  it('steps right off a sticky already sitting on the viewport centre', () => {
    const addElement = vi.fn().mockReturnValue('sticky-3');
    const batch = vi.fn((fn: () => void) => fn());
    const store = { addElement, batch } as unknown as import('@wafflebase/slides').SlidesStore;
    const editor = {
      setSelection: vi.fn(),
      enterTextEditing: vi.fn(),
    } as unknown as import('@wafflebase/slides').SlidesEditor;

    dropStickyAtViewportCenter({
      store, editor,
      viewport: { panX: 0, panY: 0, zoom: 1 },
      hostWidth: 800, hostHeight: 600,
      colorValue: '#FFF8B8',
      occupied: [
        { x: 400 - STICKY_SIZE / 2, y: 300 - STICKY_SIZE / 2, w: STICKY_SIZE, h: STICKY_SIZE, rotation: 0 },
      ],
    });

    const [, init] = addElement.mock.calls[0];
    expect(init.frame.x).toBe(400 + STICKY_GAP + STICKY_SIZE / 2);
    expect(init.frame.y).toBe(300 - STICKY_SIZE / 2);
  });
});

describe('freeStickyCenter', () => {
  const sq = (cx: number, cy: number) => ({
    x: cx - STICKY_SIZE / 2, y: cy - STICKY_SIZE / 2, w: STICKY_SIZE, h: STICKY_SIZE, rotation: 0,
  });
  const step = STICKY_SIZE + STICKY_GAP;

  it('keeps the centre when nothing is there', () => {
    expect(freeStickyCenter([], { x: 10, y: 20 })).toEqual({ x: 10, y: 20 });
  });

  it('keeps the centre when existing elements only sit beside it', () => {
    expect(freeStickyCenter([sq(0, 0)], { x: step, y: 0 })).toEqual({ x: step, y: 0 });
  });

  it('steps right first, then left', () => {
    expect(freeStickyCenter([sq(0, 0)], { x: 0, y: 0 })).toEqual({ x: step, y: 0 });
    expect(freeStickyCenter([sq(0, 0), sq(step, 0)], { x: 0, y: 0 })).toEqual({ x: -step, y: 0 });
  });

  it('moves to the row below once the nearest ring of a row is taken', () => {
    const row = [sq(-step, 0), sq(0, 0), sq(step, 0)];
    expect(freeStickyCenter(row, { x: 0, y: 0 })).toEqual({ x: 0, y: step });
  });

  it('steps off a partial cover, not only an exact one', () => {
    expect(freeStickyCenter([sq(-40, 30)], { x: 0, y: 0 })).toEqual({ x: step, y: 0 });
  });

  it('fills the visible rows in reading order: right, left, then the row below', () => {
    // Three columns by two rows fit on screen around the centre.
    const visible = { x: -step * 1.5, y: -step * 0.5, w: step * 3, h: step * 2, rotation: 0 };
    const placed: ReturnType<typeof sq>[] = [];
    const order: { x: number; y: number }[] = [];
    for (let n = 0; n < 6; n++) {
      const p = freeStickyCenter(placed, { x: 0, y: 0 }, visible);
      order.push(p);
      placed.push(sq(p.x, p.y));
    }
    expect(order).toEqual([
      { x: 0, y: 0 }, { x: step, y: 0 }, { x: -step, y: 0 },
      { x: 0, y: step }, { x: step, y: step }, { x: -step, y: step },
    ]);
  });

  it('never stacks: six drops on one point make six disjoint stickies', () => {
    const visible = { x: -400, y: -300, w: 800, h: 600, rotation: 0 };
    const placed: ReturnType<typeof sq>[] = [];
    for (let n = 0; n < 6; n++) {
      const p = freeStickyCenter(placed, { x: 0, y: 0 }, visible);
      const box = sq(p.x, p.y);
      for (const other of placed) {
        const disjoint =
          box.x >= other.x + other.w || other.x >= box.x + box.w ||
          box.y >= other.y + other.h || other.y >= box.y + box.h;
        expect(disjoint).toBe(true);
      }
      placed.push(box);
    }
  });

  it('goes off-screen to the nearest free square once the screen is full', () => {
    // Only the centre square fits on screen, and it is taken.
    const visible = { x: -100, y: -100, w: 200, h: 200, rotation: 0 };
    expect(freeStickyCenter([sq(0, 0)], { x: 0, y: 0 }, visible)).toEqual({ x: step, y: 0 });
  });

  it('places a sticky of another size on its own grid', () => {
    const wide = { w: 360, h: 180 };
    const p = freeStickyCenter([sq(0, 0)], { x: 0, y: 0 }, undefined, wide);
    expect(p).toEqual({ x: 360 + STICKY_GAP, y: 0 });
  });

  it('lands right of everything on a board too dense to search', () => {
    const wall = { x: -1e6, y: -1e6, w: 2e6, h: 2e6, rotation: 0 };
    expect(freeStickyCenter([wall], { x: 5, y: 5 })).toEqual({
      x: 1e6 + STICKY_GAP + STICKY_SIZE / 2, y: 5,
    });
  });
});

describe('adjacentStickyCenter', () => {
  const step = STICKY_SIZE + STICKY_GAP;
  const sq = (cx: number, cy: number) => ({
    x: cx - STICKY_SIZE / 2, y: cy - STICKY_SIZE / 2, w: STICKY_SIZE, h: STICKY_SIZE, rotation: 0,
  });

  it('puts the new sticky one gap away on the asked side', () => {
    const source = sq(0, 0);
    expect(adjacentStickyCenter([source], source, 'right')).toEqual({ x: step, y: 0 });
    expect(adjacentStickyCenter([source], source, 'left')).toEqual({ x: -step, y: 0 });
    expect(adjacentStickyCenter([source], source, 'down')).toEqual({ x: 0, y: step });
    expect(adjacentStickyCenter([source], source, 'up')).toEqual({ x: 0, y: -step });
  });

  it('walks further along a taken side', () => {
    const source = sq(0, 0);
    expect(adjacentStickyCenter([source, sq(step, 0)], source, 'right')).toEqual({ x: 2 * step, y: 0 });
  });

  it('keeps the source size', () => {
    const wide = { x: 0, y: 0, w: 360, h: 180, rotation: 0 };
    expect(adjacentStickyCenter([wide], wide, 'right')).toEqual({ x: 180 + 360 + STICKY_GAP, y: 90 });
  });

  it('wraps to the next row when the line hits the screen edge', () => {
    const source = sq(0, 0);
    const visible = { x: -100, y: -100, w: step + 200, h: step + 200, rotation: 0 };
    const p = adjacentStickyCenter([source, sq(step, 0)], source, 'right', visible);
    expect(p).toEqual({ x: step, y: step });
  });
});

describe('visibleWorldRect', () => {
  it('maps the host through the viewport', () => {
    expect(visibleWorldRect({ panX: 100, panY: 50, zoom: 2 }, 800, 600)).toEqual({
      x: -50, y: -25, w: 400, h: 300, rotation: 0,
    });
  });
});

describe('isStickyElement', () => {
  const asElement = (init: ReturnType<typeof buildStickyInit>, id = 'e') =>
    ({ ...init, id }) as unknown as import('@wafflebase/slides').Element;

  it('recognizes a sticky built by the toolbar, in any colour', () => {
    expect(isStickyElement(asElement(buildStickyInit('#FFF8B8', { x: 0, y: 0 })))).toBe(true);
    // A Miro import maps named colours outside STICKY_COLORS.
    expect(isStickyElement(asElement(buildStickyInit('#ABCDEF', { x: 0, y: 0 })))).toBe(true);
  });

  it('rejects an unmarked rounded rectangle someone typed into', () => {
    const init = buildStickyInit('#FFF8B8', { x: 0, y: 0 });
    const data = (init as unknown as { data: { role?: string; text: { autofit: string } } }).data;
    delete data.role;
    data.text.autofit = 'grow';
    expect(isStickyElement(asElement(init))).toBe(false);
  });

  it('keeps a marked sticky a sticky after a gradient and a border', () => {
    const init = buildStickyInit('#FFF8B8', { x: 0, y: 0 });
    const data = (init as unknown as { data: Record<string, unknown> }).data;
    data.fill = { kind: 'gradient' };
    data.stroke = { color: '#000', width: 2 };
    expect(isStickyElement(asElement(init))).toBe(true);
  });

  it('rejects other kinds, other types, and nothing', () => {
    const init = buildStickyInit('#FFF8B8', { x: 0, y: 0 });
    const data = (init as unknown as { data: { role?: string; kind: string } }).data;
    delete data.role;
    data.kind = 'rect';
    expect(isStickyElement(asElement(init))).toBe(false);
    expect(
      isStickyElement({ id: 't', type: 'text' } as unknown as import('@wafflebase/slides').Element),
    ).toBe(false);
    expect(isStickyElement(undefined)).toBe(false);
  });
});
