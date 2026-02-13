import { describe, it, expect } from 'vitest';
import { formatValue } from '../../src/model/format';

describe('formatValue', () => {
  it('should return original value for plain format', () => {
    expect(formatValue('1234', 'plain')).toBe('1234');
  });

  it('should return original value for undefined format', () => {
    expect(formatValue('hello')).toBe('hello');
  });

  it('should return original value for non-numeric input with number format', () => {
    expect(formatValue('abc', 'number')).toBe('abc');
  });

  it('should format number with commas and 2 decimal places', () => {
    expect(formatValue('1234', 'number')).toBe('1,234.00');
    expect(formatValue('1234.5', 'number')).toBe('1,234.50');
    expect(formatValue('0', 'number')).toBe('0.00');
  });

  it('should format currency with dollar sign', () => {
    expect(formatValue('1234.5', 'currency')).toBe('$1,234.50');
    expect(formatValue('0', 'currency')).toBe('$0.00');
  });

  it('should format percent', () => {
    expect(formatValue('50', 'percent')).toBe('50.00%');
    expect(formatValue('100', 'percent')).toBe('100.00%');
    expect(formatValue('15', 'percent')).toBe('15.00%');
  });

  it('should handle negative numbers', () => {
    expect(formatValue('-1234', 'number')).toBe('-1,234.00');
  });

  it('should handle empty string', () => {
    expect(formatValue('', 'number')).toBe('');
  });
});
