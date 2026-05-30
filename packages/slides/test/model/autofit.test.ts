import { describe, it, expect } from 'vitest';
import {
  DEFAULT_BLOCK_STYLE,
  type Block,
  type ResolvedFont,
  type TextMeasurer,
} from '@wafflebase/docs';
import {
  scaleBlocks,
  computeAutofitScale,
} from '../../src/model/autofit';

// Width proportional to font size so wrapping (and therefore totalHeight)
// changes with scale — exercises the non-linear binary search.
const fakeMeasurer: TextMeasurer = {
  measureWidth: (text: string, font: ResolvedFont) => text.length * font.size * 0.6,
};

function para(text: string, fontSize = 20): Block {
  return {
    id: `b-${text}`,
    type: 'paragraph',
    inlines: [{ text, style: { fontSize } }],
    style: { ...DEFAULT_BLOCK_STYLE },
  };
}

describe('scaleBlocks', () => {
  it('returns the same reference when scale is 1', () => {
    const blocks = [para('hello')];
    expect(scaleBlocks(blocks, 1)).toBe(blocks);
  });

  it('multiplies inline fontSize and block margins, preserving identity', () => {
    const source = [para('hello', 20)];
    const [b] = scaleBlocks(source, 0.5);
    expect(b.inlines[0].style.fontSize).toBe(10);
    expect(b.id).toBe('b-hello');
    expect(b.inlines[0].text).toBe('hello');
    expect(b.style.marginBottom).toBe(DEFAULT_BLOCK_STYLE.marginBottom * 0.5);
    // Source blocks must not be mutated (binary search re-scales them repeatedly).
    expect(source[0].inlines[0].style.fontSize).toBe(20);
  });

  it('falls back to the default font size (11) when inline has none', () => {
    const blocks: Block[] = [{
      id: 'x', type: 'paragraph',
      inlines: [{ text: 'a', style: {} }],
      style: { ...DEFAULT_BLOCK_STYLE },
    }];
    expect(scaleBlocks(blocks, 0.5)[0].inlines[0].style.fontSize).toBe(5.5);
  });

  it('scales marker.fontSize alongside inline fontSize', () => {
    const source: Block[] = [{
      id: 'b-marker',
      type: 'list-item',
      inlines: [{ text: 'x', style: { fontSize: 18 } }],
      style: { ...DEFAULT_BLOCK_STYLE },
      listKind: 'unordered',
      listLevel: 0,
      marker: { fontSize: 18, fontFamily: 'Arial', color: '#FF9900' },
    }];
    const [b] = scaleBlocks(source, 0.5);
    expect(b.marker?.fontSize).toBe(9);
    // Non-size axes pass through unchanged.
    expect(b.marker?.fontFamily).toBe('Arial');
    expect(b.marker?.color).toBe('#FF9900');
    // Source must not be mutated (binary search re-scales repeatedly).
    expect(source[0].marker?.fontSize).toBe(18);
  });

  it('preserves marker objects without fontSize untouched', () => {
    const source: Block[] = [{
      id: 'b-color-only',
      type: 'list-item',
      inlines: [{ text: 'x', style: { fontSize: 18 } }],
      style: { ...DEFAULT_BLOCK_STYLE },
      listKind: 'unordered',
      listLevel: 0,
      marker: { color: '#FF9900' },
    }];
    const [b] = scaleBlocks(source, 0.5);
    expect(b.marker).toEqual({ color: '#FF9900' });
  });
});

describe('computeAutofitScale', () => {
  it('returns 1 when content already fits the box', () => {
    const scale = computeAutofitScale([para('hi', 20)], fakeMeasurer, 1000, 1000, 0);
    expect(scale).toBe(1);
  });

  it('returns a scale < 1 when content overflows', () => {
    const blocks = Array.from({ length: 20 }, (_, i) => para(`line ${i}`, 40));
    const scale = computeAutofitScale(blocks, fakeMeasurer, 200, 200, 0);
    expect(scale).toBeGreaterThan(0.1);
    expect(scale).toBeLessThan(1);
  });

  it('never returns below the floor', () => {
    const blocks = Array.from({ length: 500 }, (_, i) => para(`line ${i}`, 80));
    const scale = computeAutofitScale(blocks, fakeMeasurer, 50, 20, 0);
    expect(scale).toBeGreaterThanOrEqual(0.1);
  });
});

describe('empty content (e.g. a freshly inserted text box)', () => {
  it('computeAutofitScale returns 1 for no blocks', () => {
    expect(computeAutofitScale([], fakeMeasurer, 200, 200, 0)).toBe(1);
  });
});
