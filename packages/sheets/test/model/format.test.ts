import { describe, it, expect } from 'vitest';
import { formatValue } from '../../src/model/worksheet/format';
import {
  resolveCurrencyForLocale,
  resolveSystemLocale,
} from '../../src/model/core/locale';

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

  it('should use explicit currency regardless of locale', () => {
    // KRW cell opened on en-US device must stay KRW, not become USD
    const krwOnUs = formatValue('50000', 'currency', undefined, {
      locale: 'en-US',
      currency: 'KRW',
    });
    expect(krwOnUs).toContain('50,000');
    expect(krwOnUs).not.toContain('$');

    // USD cell opened on ko-KR device must stay USD, not become KRW
    const usdOnKr = formatValue('1234.5', 'currency', undefined, {
      locale: 'ko-KR',
      currency: 'USD',
    });
    expect(usdOnKr).toContain('$');
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

  it('should format dates as YYYY-MM-DD', () => {
    expect(formatValue('2026-02-18', 'date', undefined, { locale: 'en-US' })).toBe(
      '2026-02-18',
    );
    expect(formatValue('2026-02-18', 'date', undefined, { locale: 'ko-KR' })).toBe(
      '2026-02-18',
    );
  });

  it('should return original value for invalid date input', () => {
    expect(formatValue('not-a-date', 'date', undefined, { locale: 'en-US' })).toBe(
      'not-a-date',
    );
  });

  it('should format datetime as YYYY-MM-DD HH:mm:ss', () => {
    expect(formatValue('2026-03-09 14:30:45', 'date', undefined, { locale: 'en-US' })).toBe(
      '2026-03-09 14:30:45',
    );
    expect(formatValue('2025-12-31 23:59:59', 'date', undefined, { locale: 'en-US' })).toBe(
      '2025-12-31 23:59:59',
    );
    // zero-padded time components
    expect(formatValue('2025-01-01 00:00:00', 'date', undefined, { locale: 'en-US' })).toBe(
      '2025-01-01 00:00:00',
    );
  });

  it('should return original value for datetime with invalid time components', () => {
    expect(formatValue('2025-01-01 24:00:00', 'date', undefined, { locale: 'en-US' })).toBe(
      '2025-01-01 24:00:00',
    );
    expect(formatValue('2025-01-01 00:60:00', 'date', undefined, { locale: 'en-US' })).toBe(
      '2025-01-01 00:60:00',
    );
    expect(formatValue('2025-01-01 00:00:60', 'date', undefined, { locale: 'en-US' })).toBe(
      '2025-01-01 00:00:60',
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
