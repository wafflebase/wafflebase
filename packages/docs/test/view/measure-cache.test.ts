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

  it('isolates cached widths per measurer instance', () => {
    // Two measurers with different per-character widths must NOT pollute
    // each other's cache. This guards the CLI scenario where Canvas and
    // fontkit measurers may coexist in the same process (tests, future
    // SSR) — sharing a global cache would silently return the wrong
    // measurer's widths.
    let aCalls = 0;
    let bCalls = 0;
    const measurerA: TextMeasurer = {
      measureWidth(text: string) {
        aCalls++;
        return text.length * 8;
      },
    };
    const measurerB: TextMeasurer = {
      measureWidth(text: string) {
        bCalls++;
        return text.length * 12;
      },
    };

    const aWidth = cachedMeasureText(measurerA, 'hello', baseFont);
    const bWidth = cachedMeasureText(measurerB, 'hello', baseFont);

    expect(aWidth).toBe(40);
    expect(bWidth).toBe(60);
    // Each measurer was called exactly once — neither saw the other's cache.
    expect(aCalls).toBe(1);
    expect(bCalls).toBe(1);

    // Re-reading should still come from each measurer's own cache.
    expect(cachedMeasureText(measurerA, 'hello', baseFont)).toBe(40);
    expect(cachedMeasureText(measurerB, 'hello', baseFont)).toBe(60);
    expect(aCalls).toBe(1);
    expect(bCalls).toBe(1);
  });

  it('clearMeasureCache clears every measurer scope', () => {
    let aCalls = 0;
    let bCalls = 0;
    const measurerA: TextMeasurer = {
      measureWidth(text: string) {
        aCalls++;
        return text.length * 8;
      },
    };
    const measurerB: TextMeasurer = {
      measureWidth(text: string) {
        bCalls++;
        return text.length * 12;
      },
    };

    cachedMeasureText(measurerA, 'hello', baseFont);
    cachedMeasureText(measurerB, 'hello', baseFont);
    expect(aCalls).toBe(1);
    expect(bCalls).toBe(1);

    clearMeasureCache();

    cachedMeasureText(measurerA, 'hello', baseFont);
    cachedMeasureText(measurerB, 'hello', baseFont);
    expect(aCalls).toBe(2);
    expect(bCalls).toBe(2);
  });
});
