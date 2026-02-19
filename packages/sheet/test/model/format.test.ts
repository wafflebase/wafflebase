import { describe, it, expect } from 'vitest';
import { formatValue } from '../../src/model/format';
import {
  resolveCurrencyForLocale,
  resolveSystemLocale,
} from '../../src/model/locale';

describe('formatValue', () => {
  it('should return original value for plain format', () => {
    expect(formatValue('1234', 'plain')).toBe('1234');
  });

  it('should return original value for undefined format', () => {
    expect(formatValue('hello')).toBe('hello');
  });

  it('should return original value for non-numeric input with number format', () => {
    expect(formatValue('abc', 'number', undefined, { locale: 'en-US' })).toBe(
      'abc',
    );
  });

  it('should format number with commas and 2 decimal places', () => {
    expect(formatValue('1234', 'number', undefined, { locale: 'en-US' })).toBe(
      '1,234.00',
    );
    expect(
      formatValue('1234.5', 'number', undefined, { locale: 'en-US' }),
    ).toBe('1,234.50');
    expect(formatValue('0', 'number', undefined, { locale: 'en-US' })).toBe(
      '0.00',
    );
  });

  it('should format currency with dollar sign', () => {
    expect(
      formatValue('1234.5', 'currency', undefined, { locale: 'en-US' }),
    ).toBe('$1,234.50');
    expect(formatValue('0', 'currency', undefined, { locale: 'en-US' })).toBe(
      '$0.00',
    );
  });

  it('should format KRW currency without decimals by default', () => {
    const formatted = formatValue('113300000', 'currency', undefined, {
      locale: 'ko-KR',
      currency: 'KRW',
    });
    expect(formatted).toContain('113,300,000');
    expect(formatted).not.toContain('.');
  });

  it('should format percent', () => {
    expect(formatValue('0.5', 'percent', undefined, { locale: 'en-US' })).toBe(
      '50.00%',
    );
    expect(formatValue('1', 'percent', undefined, { locale: 'en-US' })).toBe(
      '100.00%',
    );
    expect(formatValue('0.15', 'percent', undefined, { locale: 'en-US' })).toBe(
      '15.00%',
    );
  });

  it('should handle negative numbers', () => {
    expect(
      formatValue('-1234', 'number', undefined, { locale: 'en-US' }),
    ).toBe('-1,234.00');
  });

  it('should handle empty string', () => {
    expect(formatValue('', 'number')).toBe('');
  });

  it('should use locale-specific separators', () => {
    expect(formatValue('1234.5', 'number', undefined, { locale: 'de-DE' })).toBe(
      '1.234,50',
    );
  });

  it('should format ISO dates with locale', () => {
    expect(formatValue('2026-02-18', 'date', undefined, { locale: 'en-US' })).toBe(
      'Feb 18, 2026',
    );
    const koDate = formatValue('2026-02-18', 'date', undefined, {
      locale: 'ko-KR',
    });
    expect(koDate).toContain('2026');
    expect(koDate).not.toBe('2026-02-18');
  });

  it('should return original value for invalid date input', () => {
    expect(formatValue('not-a-date', 'date', undefined, { locale: 'en-US' })).toBe(
      'not-a-date',
    );
  });
});

describe('locale helpers', () => {
  it('should resolve currency from locale', () => {
    expect(resolveCurrencyForLocale('ko-KR')).toBe('KRW');
    expect(resolveCurrencyForLocale('ko')).toBe('KRW');
    expect(resolveCurrencyForLocale('de-DE')).toBe('EUR');
    expect(resolveCurrencyForLocale('en-US')).toBe('USD');
  });

  it('should resolve a non-empty system locale', () => {
    expect(resolveSystemLocale()).not.toHaveLength(0);
  });
});
