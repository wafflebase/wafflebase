// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { CanvasTextMeasurer } from '../../src/view/canvas-measurer.js';
import type { ResolvedFont } from '../../src/view/measurer.js';

function injectedCtxMeasurer(): {
  measurer: CanvasTextMeasurer;
  fonts: string[];
  calls: number;
} {
  const fonts: string[] = [];
  let calls = 0;
  const ctx = {
    set font(v: string) {
      fonts.push(v);
    },
    get font() {
      return fonts[fonts.length - 1] ?? '';
    },
    measureText(text: string) {
      calls++;
      // 8 px per char so the assertions are deterministic without
      // depending on the host's actual font metrics.
      return { width: text.length * 8 } as TextMetrics;
    },
  } as unknown as CanvasRenderingContext2D;
  const measurer = CanvasTextMeasurer.fromContext(ctx);
  return {
    measurer,
    fonts,
    get calls() {
      return calls;
    },
  };
}

describe('CanvasTextMeasurer', () => {
  it('returns the underlying ctx.measureText width', () => {
    const { measurer } = injectedCtxMeasurer();
    const font: ResolvedFont = {
      family: 'Arial', size: 16, weight: 'normal', style: 'normal',
    };
    expect(measurer.measureWidth('hello', font)).toBe(40);
  });

  it('serialises ResolvedFont into a Canvas font shorthand', () => {
    const { measurer, fonts } = injectedCtxMeasurer();
    measurer.measureWidth('A', {
      family: 'Arial', size: 14, weight: 'bold', style: 'italic',
    });
    measurer.measureWidth('A', {
      family: 'Helvetica', size: 12, weight: 'normal', style: 'normal',
    });
    expect(fonts).toEqual([
      'italic bold 14px Arial',
      '12px Helvetica',
    ]);
  });

  it('caches the last font string to avoid thrashing ctx.font', () => {
    const { measurer, fonts } = injectedCtxMeasurer();
    const font: ResolvedFont = {
      family: 'Arial', size: 16, weight: 'normal', style: 'normal',
    };
    measurer.measureWidth('hello', font);
    measurer.measureWidth('world', font);
    expect(fonts).toEqual(['16px Arial']);
  });

  it('lazily creates an offscreen canvas when no ctx is supplied', () => {
    // jsdom lacks Canvas 2D; the lazy branch should still construct
    // without throwing — it only fails when measureWidth is called.
    expect(() => new CanvasTextMeasurer()).not.toThrow();
  });
});
