import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeLayout,
  computeCharOffsets,
  clearMeasureCache,
} from '../../src/view/layout.js';
import { createEmptyBlock } from '../../src/model/types.js';
import type { Block } from '../../src/model/types.js';
import type { ResolvedFont, TextMeasurer } from '../../src/view/measurer.js';

const font: ResolvedFont = {
  family: 'sans-serif', size: 16, weight: 'normal', style: 'normal',
};

function makeBlock(text: string): Block {
  const block = createEmptyBlock();
  block.inlines = [{ text, style: {} }];
  return block;
}

describe('char offset caching', () => {
  let calls: number;
  let measurer: TextMeasurer;

  beforeEach(() => {
    clearMeasureCache();
    calls = 0;
    measurer = {
      measureWidth(text: string) {
        calls++;
        return text.length * 8;
      },
    };
  });

  it('computeCharOffsets caches its result per (font, text)', () => {
    const first = computeCharOffsets(measurer, 'abcd', font);
    expect(calls).toBeGreaterThan(0);
    calls = 0;
    const second = computeCharOffsets(measurer, 'abcd', font);
    expect(calls).toBe(0);
    expect(second).toEqual(first);
  });

  it('a full re-layout after a warm cache performs no measurement', () => {
    // Both word widths (measureSegments) and per-character caret offsets
    // (computeCharOffsets) must be cached, so re-laying-out unchanged content
    // — as happens on every structural edit, remote change, undo/redo, and
    // resize — costs zero canvas measurements.
    const blocks = [
      makeBlock('Hello world of measurement'),
      makeBlock('A second paragraph with several words'),
    ];
    computeLayout(blocks, measurer, 500); // warm the caches
    calls = 0;
    // dirtyBlockIds undefined => full recompute of every block.
    computeLayout(blocks, measurer, 500);
    expect(calls).toBe(0);
  });

  it('re-measures when the text changes', () => {
    computeCharOffsets(measurer, 'abcd', font);
    calls = 0;
    computeCharOffsets(measurer, 'abce', font);
    expect(calls).toBeGreaterThan(0);
  });
});
