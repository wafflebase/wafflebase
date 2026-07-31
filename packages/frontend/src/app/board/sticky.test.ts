import { describe, it, expect, vi } from 'vitest';
import { STICKY_COLORS, STICKY_SIZE, buildStickyInit, dropStickyAtViewportCenter } from './sticky';

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
});
