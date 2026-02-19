import { describe, expect, it } from 'vitest';
import { inferInput } from '../../src/model/input';

describe('inferInput', () => {
  it('infers currency', () => {
    expect(inferInput('₩ 113,300,000')).toEqual({
      value: 113300000,
      type: 'number',
      format: 'currency:KRW',
    });
    expect(inferInput('$1,200.50')).toEqual({
      value: 1200.5,
      type: 'number',
      format: 'currency:USD',
    });
    expect(inferInput('-₩ 10,000')).toEqual({
      value: -10000,
      type: 'number',
      format: 'currency:KRW',
    });
  });

  it('infers percent', () => {
    expect(inferInput('12.34%')).toEqual({
      value: 0.1234,
      type: 'number',
      format: 'percent',
    });
    expect(inferInput('-5%')).toEqual({
      value: -0.05,
      type: 'number',
      format: 'percent',
    });
  });

  it('infers number', () => {
    expect(inferInput('1,234,567')).toEqual({
      value: 1234567,
      type: 'number',
    });
    expect(inferInput('12.34')).toEqual({
      value: 12.34,
      type: 'number',
    });
    expect(inferInput('1e6')).toEqual({
      value: 1000000,
      type: 'number',
    });
  });

  it('infers date', () => {
    expect(inferInput('2025-02-19')).toEqual({
      value: '2025-02-19',
      type: 'date',
      format: 'yyyy-mm-dd',
    });
    expect(inferInput('2/19', { referenceDate: new Date(2026, 1, 19) })).toEqual(
      {
        value: '2026-02-19',
        type: 'date',
        format: 'yyyy-mm-dd',
      },
    );
  });

  it('infers boolean', () => {
    expect(inferInput('true')).toEqual({
      value: true,
      type: 'boolean',
    });
  });

  it('infers formula', () => {
    expect(inferInput('=1+2')).toEqual({
      value: '1+2',
      type: 'formula',
    });
    expect(inferInput('= SUM(A1:A10)')).toEqual({
      value: 'SUM(A1:A10)',
      type: 'formula',
    });
  });

  it('keeps leading-zero and id-like inputs as text', () => {
    expect(inferInput('00123')).toEqual({
      value: '00123',
      type: 'text',
    });
    expect(inferInput('010-1234-5678')).toEqual({
      value: '010-1234-5678',
      type: 'text',
    });
    expect(inferInput('2024-AB-001')).toEqual({
      value: '2024-AB-001',
      type: 'text',
    });
  });

  it('trims whitespace before inference', () => {
    expect(inferInput('  $1,200.50  ')).toEqual({
      value: 1200.5,
      type: 'number',
      format: 'currency:USD',
    });
  });
});
