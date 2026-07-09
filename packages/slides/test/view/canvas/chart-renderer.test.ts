import { describe, it, expect } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import { asCtx, createCtxSpy } from '../../../src/view/canvas/ctx-spy';
import { drawChart, niceTicks } from '../../../src/view/canvas/chart-renderer';
import type { ChartElement } from '../../../src/model/element';
import type { Theme } from '../../../src/model/theme';

const THEME: Theme = {
  id: 't', name: 't',
  colors: {
    text: '#000', background: '#fff', textSecondary: '#444', backgroundAlt: '#f3f3f3',
    accent1: '#3366cc', accent2: '#dc3912', accent3: '#ff9900', accent4: '#109618',
    accent5: '#990099', accent6: '#0099c6',
    hyperlink: '#11c', visitedHyperlink: '#71a',
  },
  fonts: { heading: 'Inter', body: 'Inter' },
};

const size = { w: 400, h: 300 };

const columnData = (): ChartElement['data'] => ({
  kind: 'column',
  grouping: 'clustered',
  categories: ['Q1', 'Q2', 'Q3'],
  series: [
    { name: 'A', values: [1, 2, 3] },
    { name: 'B', values: [3, 2, 1] },
  ],
});

describe('niceTicks', () => {
  it('rounds the axis max up to a nice step', () => {
    expect(niceTicks(23).max).toBeGreaterThanOrEqual(23);
    expect(niceTicks(23).step).toBeGreaterThan(0);
  });
  it('handles an all-zero domain without NaN', () => {
    const t = niceTicks(0);
    expect(Number.isFinite(t.max)).toBe(true);
    expect(Number.isFinite(t.step)).toBe(true);
  });
});

describe('drawChart — column', () => {
  it('draws one filled rect per (series × category) bar', () => {
    const ctx = createCtxSpy();
    drawChart(asCtx(ctx), size, columnData(), THEME);
    // 2 series × 3 categories = 6 bars.
    expect(ctx.fillRect).toHaveBeenCalledTimes(6);
  });

  it('does not throw on empty series', () => {
    const ctx = createCtxSpy();
    expect(() =>
      drawChart(asCtx(ctx), size, { kind: 'column', categories: [], series: [] }, THEME),
    ).not.toThrow();
  });
});
