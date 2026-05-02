import { describe, it, expect, beforeEach } from 'vitest';
import { cachedMeasureText, clearMeasureCache } from '../../src/view/layout.js';
import type { ResolvedFont, TextMeasurer } from '../../src/view/measurer.js';

const baseFont: ResolvedFont = {
  family: 'sans-serif', size: 16, weight: 'normal', style: 'normal',
};
const boldFont: ResolvedFont = { ...baseFont, weight: 'bold' };

describe('cachedMeasureText', () => {
  let callCount: number;
  let measurer: TextMeasurer;

  beforeEach(() => {
    clearMeasureCache();
    callCount = 0;
    measurer = {
      measureWidth(text: string) {
        callCount++;
        return text.length * 8;
      },
    };
  });

  it('returns measured width', () => {
    const width = cachedMeasureText(measurer, 'hello', baseFont);
    expect(width).toBe(40);
  });

  it('caches result on second call with same args', () => {
    cachedMeasureText(measurer, 'hello', baseFont);
    cachedMeasureText(measurer, 'hello', baseFont);
    expect(callCount).toBe(1);
  });

  it('distinguishes different fonts', () => {
    cachedMeasureText(measurer, 'hello', baseFont);
    cachedMeasureText(measurer, 'hello', boldFont);
    expect(callCount).toBe(2);
  });

  it('distinguishes different text', () => {
    cachedMeasureText(measurer, 'hello', baseFont);
    cachedMeasureText(measurer, 'world', baseFont);
    expect(callCount).toBe(2);
  });
});
