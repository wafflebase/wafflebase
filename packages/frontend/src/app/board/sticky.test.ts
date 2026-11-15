import { describe, it, expect, vi } from 'vitest';
import {
  STICKY_COLORS,
  STICKY_GAP,
  STICKY_SIZE,
  buildStickyInit,
  dropStickyAtViewportCenter,
  freeStickyCenter,
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

  it('walks past a whole row to the first free square', () => {
    const row = [sq(0, 0), sq(step, 0), sq(2 * step, 0)];
    expect(freeStickyCenter(row, { x: 0, y: 0 })).toEqual({ x: 3 * step, y: 0 });
  });

  it('steps off a partial cover, not only an exact one', () => {
    expect(freeStickyCenter([sq(-40, 30)], { x: 0, y: 0 })).toEqual({ x: step, y: 0 });
  });

  it('falls back to the centre on a board too dense to find room', () => {
    const wall = { x: -1e6, y: -1e6, w: 2e6, h: 2e6, rotation: 0 };
    expect(freeStickyCenter([wall], { x: 5, y: 5 })).toEqual({ x: 5, y: 5 });
  });
});
