import { describe, expect, it } from 'vitest';
import type { ChartElement, Element } from '../../src/model/element';
import { clone } from '../../src/model/clone';

const CHART: ChartElement = {
  id: 'c1',
  type: 'chart',
  frame: { x: 10, y: 20, w: 300, h: 200, rotation: 0 },
  data: {
    kind: 'column',
    grouping: 'clustered',
    title: 'Revenue',
    categories: ['Q1', 'Q2'],
    series: [
      { name: 'A', values: [1, 2], color: { kind: 'srgb', value: '#3366cc' } },
      { name: 'B', values: [3, null] },
    ],
    legend: 'bottom',
    showGridlines: true,
  },
};

describe('ChartElement', () => {
  it('is assignable to the Element union', () => {
    const el: Element = CHART;
    expect(el.type).toBe('chart');
  });

  it('deep-clones without shared references', () => {
    const copy = clone(CHART);
    expect(copy).toEqual(CHART);
    expect(copy.data.series).not.toBe(CHART.data.series);
  });
});
