import { describe, it, expect, beforeEach } from 'vitest';
import { cachedMeasureText, clearMeasureCache } from '../../src/view/layout.js';

describe('cachedMeasureText', () => {
  let callCount: number;
  let mockCtx: CanvasRenderingContext2D;

  beforeEach(() => {
    clearMeasureCache();
    callCount = 0;
    mockCtx = {
      font: '',
      measureText: (text: string) => {
        callCount++;
        return { width: text.length * 8 } as TextMetrics;
      },
    } as unknown as CanvasRenderingContext2D;
  });

  it('returns measured width', () => {
    const width = cachedMeasureText(mockCtx, 'hello', '16px sans-serif');
    expect(width).toBe(40);
  });

  it('caches result on second call with same args', () => {
    cachedMeasureText(mockCtx, 'hello', '16px sans-serif');
    cachedMeasureText(mockCtx, 'hello', '16px sans-serif');
    expect(callCount).toBe(1);
  });

  it('distinguishes different fonts', () => {
    cachedMeasureText(mockCtx, 'hello', '16px sans-serif');
    cachedMeasureText(mockCtx, 'hello', 'bold 16px sans-serif');
    expect(callCount).toBe(2);
  });

  it('distinguishes different text', () => {
    cachedMeasureText(mockCtx, 'hello', '16px sans-serif');
    cachedMeasureText(mockCtx, 'world', '16px sans-serif');
    expect(callCount).toBe(2);
  });
});
