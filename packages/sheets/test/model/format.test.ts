import { describe, it, expect } from 'vitest';
import {
  MAX_DECIMAL_PLACES,
  clampDecimals,
  formatValue,
  renderedDecimals,
} from '../../src/model/worksheet/format';
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

describe('formatValue hostile input', () => {
  it('should clamp a decimal count Intl would reject', () => {
    // Written out rather than compared against another `formatValue` call, so
    // the assertions pin the clamp to 20 / 0 / the fallback of 2 instead of
    // holding for any clamp that is merely self-consistent.
    expect(formatValue('1.5', 'number', 400, { locale: 'en-US' })).toBe(
      `1.5${'0'.repeat(19)}`,
    );
    expect(formatValue('1.5', 'number', -3, { locale: 'en-US' })).toBe('2');
    expect(formatValue('1.5', 'number', NaN, { locale: 'en-US' })).toBe('1.50');
    expect(formatValue('1.5', 'number', 2.7, { locale: 'en-US' })).toBe('1.50');
  });

  it('should not throw on a currency code Intl rejects', () => {
    expect(() =>
      formatValue('1.5', 'currency', 2, {
        locale: 'en-US',
        currency: 'not a currency',
      }),
    ).not.toThrow();
    expect(
      formatValue('1.5', 'currency', 2, {
        locale: 'en-US',
        currency: 'not a currency',
      }),
    ).toContain('1.5');
  });

  it('should not throw on a locale Intl rejects', () => {
    expect(() =>
      formatValue('1.5', 'number', 2, { locale: 'not a locale' }),
    ).not.toThrow();
  });
});

describe('clampDecimals', () => {
  it('should cap at the largest count Intl accepts everywhere', () => {
    expect(MAX_DECIMAL_PLACES).toBe(20);
    expect(clampDecimals(400, 2)).toBe(20);
    expect(clampDecimals(21, 2)).toBe(20);
    expect(clampDecimals(20, 2)).toBe(20);
  });

  it('should floor at zero and truncate a fractional count', () => {
    expect(clampDecimals(-3, 2)).toBe(0);
    expect(clampDecimals(0, 2)).toBe(0);
    expect(clampDecimals(3.9, 2)).toBe(3);
  });

  it('should fall back when there is no usable count', () => {
    expect(clampDecimals(undefined, 2)).toBe(2);
    expect(clampDecimals(NaN, 2)).toBe(2);
    expect(clampDecimals(Infinity, 4)).toBe(4);
    // The fallback is the caller's, not a constant.
    expect(clampDecimals(undefined, 0)).toBe(0);
  });
});

describe('renderedDecimals', () => {
  it('should report the value precision for pass-through formats', () => {
    expect(renderedDecimals('12.345', undefined)).toBe(3);
    expect(renderedDecimals('12.345', { nf: 'plain' })).toBe(3);
    expect(renderedDecimals('2026-02-18', { nf: 'date' })).toBe(0);
    // A stored `dp` changes nothing where the format does not use it.
    expect(renderedDecimals('12.345', { nf: 'plain', dp: 1 })).toBe(3);
  });

  it('should report the stored dp for the numeric formats', () => {
    expect(renderedDecimals('12', { nf: 'number' })).toBe(2);
    expect(renderedDecimals('12', { nf: 'number', dp: 0 })).toBe(0);
    expect(renderedDecimals('12', { nf: 'percent', dp: 4 })).toBe(4);
    expect(renderedDecimals('12', { nf: 'number', dp: 400 })).toBe(20);
  });

  it("should report a dp-less currency's own convention", () => {
    // Matches what `formatValue` renders, which leaves the fraction digits to
    // `Intl` when no `dp` is stored — 2 for USD, none for KRW, three for KWD.
    const digitsOf = (formatted: string) => {
      // `en-US` groups with ',' and separates decimals with '.'.
      const dot = formatted.lastIndexOf('.');
      return dot < 0 ? 0 : formatted.slice(dot + 1).replace(/\D/g, '').length;
    };

    for (const currency of ['USD', 'KRW', 'KWD']) {
      expect(
        renderedDecimals('1234.5678', { nf: 'currency' }, {
          locale: 'en-US',
          currency,
        }),
      ).toBe(
        digitsOf(
          formatValue('1234.5678', 'currency', undefined, {
            locale: 'en-US',
            currency,
          }),
        ),
      );
    }

    expect(
      renderedDecimals('1234.5678', { nf: 'currency' }, {
        locale: 'en-US',
        currency: 'KRW',
      }),
    ).toBe(0);
    expect(
      renderedDecimals('1234.5678', { nf: 'currency' }, {
        locale: 'en-US',
        currency: 'KWD',
      }),
    ).toBe(3);
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
