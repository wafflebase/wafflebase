import { describe, it, expect } from 'vitest';
import { STICKY_ROLE, STICKY_SHADOW, isStickyData } from './sticky';

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
