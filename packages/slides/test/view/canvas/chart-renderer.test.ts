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
    // legend: 'none' isolates bar fillRect calls from the legend's own
    // fillRect swatches, so this measures bar count exactly.
    drawChart(asCtx(ctx), size, { ...columnData(), legend: 'none' }, THEME);
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

describe('drawChart — legend', () => {
  it('draws a square swatch per series via fillRect when the legend is on', () => {
    const off = createCtxSpy();
    drawChart(asCtx(off), size, { ...columnData(), legend: 'none' }, THEME);
    const on = createCtxSpy();
    drawChart(asCtx(on), size, columnData(), THEME);
    // 2 series → 2 extra fillRect calls (bars: 6, bars + legend: 8).
    expect(on.fillRect).toHaveBeenCalledTimes(off.fillRect.mock.calls.length + 2);
    // Each swatch is a 10x10 square.
    const swatchCalls = on.fillRect.mock.calls.slice(-2);
    for (const [, , w, h] of swatchCalls) {
      expect(w).toBe(10);
      expect(h).toBe(10);
    }
  });
});

describe('drawChart — line/area/pie', () => {
  const line = (kind: 'line' | 'area'): ChartElement['data'] => ({
    kind, categories: ['a', 'b', 'c'],
    series: [{ name: 'S', values: [1, 3, 2] }],
  });

  it('strokes a polyline for a line chart', () => {
    const ctx = createCtxSpy();
    drawChart(asCtx(ctx), size, line('line'), THEME);
    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.lineTo).toHaveBeenCalled();
  });

  it('fills an area chart', () => {
    const ctx = createCtxSpy();
    drawChart(asCtx(ctx), size, line('area'), THEME);
    expect(ctx.fill).toHaveBeenCalled();
  });

  it('draws pie slices with arc()', () => {
    const ctx = createCtxSpy();
    drawChart(asCtx(ctx), size, {
      kind: 'pie', categories: ['A', 'B'], series: [{ values: [60, 40] }],
    }, THEME);
    expect(ctx.arc).toHaveBeenCalledTimes(2);
  });

  it('draws gridlines when showGridlines is set', () => {
    const plain = createCtxSpy();
    drawChart(asCtx(plain), size, columnData(), THEME);
    const grid = createCtxSpy();
    drawChart(asCtx(grid), size, { ...columnData(), showGridlines: true }, THEME);
    expect(grid.stroke.mock.calls.length).toBeGreaterThan(plain.stroke.mock.calls.length);
  });
});

describe('drawChart — category-axis labels', () => {
  it('draws each category name under the plot for a column chart', () => {
    const ctx = createCtxSpy();
    drawChart(asCtx(ctx), size, { ...columnData(), legend: 'none' }, THEME);
    const texts = ctx.fillText.mock.calls.map(([t]) => t);
    expect(texts).toContain('Q1');
    expect(texts).toContain('Q2');
    expect(texts).toContain('Q3');
  });

  it('draws each category name for a line chart data point', () => {
    const ctx = createCtxSpy();
    drawChart(asCtx(ctx), size, {
      kind: 'line', categories: ['a', 'b', 'c'],
      series: [{ name: 'S', values: [1, 3, 2] }],
      legend: 'none',
    }, THEME);
    const texts = ctx.fillText.mock.calls.map(([t]) => t);
    expect(texts).toContain('a');
    expect(texts).toContain('b');
    expect(texts).toContain('c');
  });

  it('does not draw category labels for a pie chart', () => {
    const ctx = createCtxSpy();
    drawChart(asCtx(ctx), size, {
      kind: 'pie', categories: ['A', 'B'], series: [{ values: [60, 40] }],
      legend: 'none',
    }, THEME);
    // Pie has no category-axis band; category names only appear via the
    // legend, which is off here.
    const texts = ctx.fillText.mock.calls.map(([t]) => t);
    expect(texts).not.toContain('A');
    expect(texts).not.toContain('B');
  });
});

describe('drawChart — value-axis tick labels', () => {
  it('labels the 0 tick and the domain max even without showGridlines', () => {
    const ctx = createCtxSpy();
    drawChart(asCtx(ctx), size, {
      kind: 'column', categories: ['Q1', 'Q2'],
      series: [{ name: 'A', values: [10, 30] }],
      legend: 'none',
    }, THEME);
    const texts = ctx.fillText.mock.calls.map(([t]) => t);
    // domainMax for 30 rounds up to a nice tick of 30 (niceTicks(30,5) step 10).
    expect(texts).toContain('0');
    expect(texts).toContain('30');
  });

  it('formats percentStacked ticks as percentages', () => {
    const ctx = createCtxSpy();
    drawChart(asCtx(ctx), size, {
      kind: 'column', grouping: 'percentStacked', categories: ['Q1', 'Q2'],
      series: [
        { name: 'A', values: [10, 30] },
        { name: 'B', values: [10, 30] },
      ],
      legend: 'none',
    }, THEME);
    const texts = ctx.fillText.mock.calls.map(([t]) => t);
    expect(texts).toContain('0%');
    expect(texts).toContain('100%');
  });

  it('does not draw value-axis ticks for a pie chart', () => {
    const ctx = createCtxSpy();
    drawChart(asCtx(ctx), size, {
      kind: 'pie', categories: ['A', 'B'], series: [{ values: [60, 40] }],
      legend: 'none',
    }, THEME);
    const texts = ctx.fillText.mock.calls.map(([t]) => t);
    expect(texts).not.toContain('0');
  });
});

describe('drawChart — pie legend', () => {
  it('lists categories (not series) with per-slice colors', () => {
    const ctx = createCtxSpy();
    drawChart(asCtx(ctx), size, {
      kind: 'pie', categories: ['A', 'B', 'C'],
      series: [{ values: [50, 30, 20] }],
      legend: 'right',
    }, THEME);
    const texts = ctx.fillText.mock.calls.map(([t]) => t);
    expect(texts).toContain('A');
    expect(texts).toContain('B');
    expect(texts).toContain('C');
    expect(texts).not.toContain('Series 1');
  });

  it('keeps series-based legend for non-pie charts', () => {
    const ctx = createCtxSpy();
    drawChart(asCtx(ctx), size, columnData(), THEME);
    const texts = ctx.fillText.mock.calls.map(([t]) => t);
    expect(texts).toContain('A');
    expect(texts).toContain('B');
  });
});
