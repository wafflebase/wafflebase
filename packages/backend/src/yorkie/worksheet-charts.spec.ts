import { BadRequestException } from '@nestjs/common';
import { parseCharts } from './worksheet-charts';

const CHART = {
  id: 'chart-1',
  type: 'bar',
  sourceTabId: 'tab-1',
  sourceRange: 'A1:B5',
  anchor: 'D2',
  offsetX: 0,
  offsetY: 0,
  width: 400,
  height: 300,
};

describe('parseCharts', () => {
  it('accepts a valid chart with optional fields', () => {
    const out = parseCharts({
      charts: [
        {
          ...CHART,
          title: 'Sales',
          seriesColumns: ['B'],
          legendPosition: 'bottom',
          showGridlines: true,
        },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'chart-1', title: 'Sales' });
  });

  it('rejects a non-array or non-object body', () => {
    expect(() => parseCharts({})).toThrow(BadRequestException);
    expect(() => parseCharts({ charts: {} })).toThrow(BadRequestException);
  });

  it('rejects an unknown chart type', () => {
    expect(() => parseCharts({ charts: [{ ...CHART, type: 'radar' }] })).toThrow(
      BadRequestException,
    );
  });

  it('rejects a malformed anchor', () => {
    expect(() => parseCharts({ charts: [{ ...CHART, anchor: '123' }] })).toThrow(
      BadRequestException,
    );
  });

  it('rejects a non-positive size', () => {
    expect(() => parseCharts({ charts: [{ ...CHART, width: 0 }] })).toThrow(
      BadRequestException,
    );
  });

  it('rejects duplicate chart ids', () => {
    expect(() => parseCharts({ charts: [CHART, CHART] })).toThrow(
      BadRequestException,
    );
  });
});
