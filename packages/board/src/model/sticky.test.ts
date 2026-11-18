import { describe, it, expect } from 'vitest';
import {
  STICKY_CORNER_ADJ,
  STICKY_ROLE,
  STICKY_SHADOW,
  STICKY_TEXT_INSET,
  buildStickyInit,
  isStickyData,
  withStickyDefaults,
} from './sticky';

const sticky = () => ({
  kind: 'roundRect',
  fill: { kind: 'srgb', value: '#FFF8B8' },
  effects: { shadow: { ...STICKY_SHADOW } },
  text: { blocks: [], verticalAnchor: 'middle', autofit: 'shrink' },
});

describe('isStickyData', () => {
  it('recognizes the preset in any fill colour', () => {
    expect(isStickyData(sticky())).toBe(true);
    expect(isStickyData({ ...sticky(), fill: { kind: 'srgb', value: '#ABCDEF' } })).toBe(true);
  });

  it('rejects a rounded rectangle without the shadow (a Miro shape, a typed-into shape)', () => {
    const { effects: _e, ...noShadow } = sticky();
    expect(isStickyData(noShadow)).toBe(false);
    expect(isStickyData({ ...sticky(), text: { autofit: 'grow' } })).toBe(false);
  });

  it('rejects a bordered rounded rectangle', () => {
    expect(isStickyData({ ...sticky(), stroke: { color: '#000', width: 1 } })).toBe(false);
  });

  it('rejects other kinds, gradient fills and junk', () => {
    expect(isStickyData({ ...sticky(), kind: 'rect' })).toBe(false);
    expect(isStickyData({ ...sticky(), fill: { kind: 'gradient' } })).toBe(false);
    expect(isStickyData(undefined)).toBe(false);
    expect(isStickyData('sticky')).toBe(false);
  });

  it('keeps a marked sticky a sticky through a gradient, a border or a reshape', () => {
    const marked = { ...sticky(), role: STICKY_ROLE };
    expect(isStickyData({ ...marked, fill: { kind: 'gradient' } })).toBe(true);
    expect(isStickyData({ ...marked, stroke: { color: '#000', width: 1 } })).toBe(true);
    expect(isStickyData({ ...marked, kind: 'rect', text: { autofit: 'none' } })).toBe(true);
  });

  it('ignores any other role value', () => {
    expect(isStickyData({ kind: 'rect', role: 'section' })).toBe(false);
  });
});

describe('withStickyDefaults', () => {
  it('fills the corner radius and text padding on a sticky that lacks them', () => {
    const out = withStickyDefaults({ ...sticky(), role: STICKY_ROLE }) as {
      adjustments?: number[];
      text: { inset?: unknown };
    };
    expect(out.adjustments).toEqual([STICKY_CORNER_ADJ]);
    expect(out.text.inset).toEqual(STICKY_TEXT_INSET);
  });

  it('keeps values the sticky carries and never mutates its input', () => {
    const input = {
      ...sticky(),
      adjustments: [9000],
      text: { ...sticky().text, inset: { left: 1, top: 2, right: 3, bottom: 4 } },
    };
    const snapshot = JSON.parse(JSON.stringify(input));
    expect(withStickyDefaults(input)).toBe(input);
    expect(input).toEqual(snapshot);
  });

  it('leaves the radius alone on a sticky reshaped into another kind', () => {
    const out = withStickyDefaults({ ...sticky(), role: STICKY_ROLE, kind: 'ellipse' }) as {
      adjustments?: number[];
      text: { inset?: unknown };
    };
    expect(out.adjustments).toBeUndefined();
    expect(out.text.inset).toEqual(STICKY_TEXT_INSET);
  });

  it('returns non-stickies untouched', () => {
    const shape = { kind: 'roundRect', fill: { kind: 'srgb', value: '#fff' } };
    expect(withStickyDefaults(shape)).toBe(shape);
    expect(withStickyDefaults(undefined)).toBeUndefined();
  });
});

describe('buildStickyInit', () => {
  it('writes the small corner radius and even padding explicitly', () => {
    const init = buildStickyInit('#FFF8B8', { x: 0, y: 0 }) as unknown as {
      data: { adjustments: number[]; text: { inset: unknown } };
    };
    expect(init.data.adjustments).toEqual([STICKY_CORNER_ADJ]);
    expect(init.data.text.inset).toEqual(STICKY_TEXT_INSET);
  });
});
