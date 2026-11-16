import { describe, it, expect } from 'vitest';
import { STICKY_SHADOW, isStickyData } from './sticky';

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
});
