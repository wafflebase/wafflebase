import { describe, it, expect, vi } from 'vitest';
import {
  STICKY_COLORS,
  STICKY_GAP,
  STICKY_SIZE,
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

  it('walks out to the nearest free square of a crowded row', () => {
    const row = [sq(-step, 0), sq(0, 0), sq(step, 0)];
    expect(freeStickyCenter(row, { x: 0, y: 0 })).toEqual({ x: 2 * step, y: 0 });
  });

  it('steps off a partial cover, not only an exact one', () => {
    expect(freeStickyCenter([sq(-40, 30)], { x: 0, y: 0 })).toEqual({ x: step, y: 0 });
  });

  it('never steps outside the visible rect', () => {
    // Zoomed in: only the centre square and its right neighbour fit.
    const visible = { x: -100, y: -100, w: 100 + step + 100, h: 200, rotation: 0 };
    expect(freeStickyCenter([sq(0, 0)], { x: 0, y: 0 }, visible)).toEqual({ x: step, y: 0 });
    // Both visible squares taken: nudge, rather than walk off-screen.
    expect(freeStickyCenter([sq(0, 0), sq(step, 0)], { x: 0, y: 0 }, visible)).toEqual({
      x: STICKY_GAP, y: STICKY_GAP,
    });
  });

  it('cascades rather than covering exactly on a board too dense to find room', () => {
    const wall = { x: -1e6, y: -1e6, w: 2e6, h: 2e6, rotation: 0 };
    expect(freeStickyCenter([wall], { x: 5, y: 5 })).toEqual({ x: 5, y: 5 });
    // Each repeated drop with no room lands one gap further down-right.
    const visible = { x: -90, y: -90, w: 180, h: 180, rotation: 0 };
    const first = freeStickyCenter([sq(0, 0)], { x: 0, y: 0 }, visible);
    expect(first).toEqual({ x: STICKY_GAP, y: STICKY_GAP });
    const second = freeStickyCenter([sq(0, 0), sq(first.x, first.y)], { x: 0, y: 0 }, visible);
    expect(second).toEqual({ x: 2 * STICKY_GAP, y: 2 * STICKY_GAP });
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

  it('rejects a plain rounded rectangle someone typed into', () => {
    const init = buildStickyInit('#FFF8B8', { x: 0, y: 0 });
    const data = init.data as { text: { autofit: string } };
    data.text.autofit = 'grow';
    expect(isStickyElement(asElement(init))).toBe(false);
  });

  it('rejects other kinds, other types, and nothing', () => {
    const init = buildStickyInit('#FFF8B8', { x: 0, y: 0 });
    (init.data as { kind: string }).kind = 'rect';
    expect(isStickyElement(asElement(init))).toBe(false);
    expect(
      isStickyElement({ id: 't', type: 'text' } as unknown as import('@wafflebase/slides').Element),
    ).toBe(false);
    expect(isStickyElement(undefined)).toBe(false);
  });
});
