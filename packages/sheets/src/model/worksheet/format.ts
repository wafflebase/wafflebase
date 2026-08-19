import { CellStyle, NumberFormat } from '../core/types';
import { resolveCurrencyForLocale, resolveSystemLocale } from '../core/locale';

export type FormatValueOptions = {
  locale?: string;
  currency?: string;
};

/**
 * `MAX_DECIMAL_PLACES` is the largest fraction-digit count `Intl.NumberFormat`
 * accepts everywhere. Anything above it is a `RangeError`, so a `dp` that
 * reaches formatting is clamped to it rather than thrown on.
 */
export const MAX_DECIMAL_PLACES = 20;

/**
 * `clampDecimals` maps an arbitrary stored `dp` onto a fraction-digit count
 * `Intl` accepts. A `dp` can come from anywhere a style can — an imported
 * `.xlsx`, a collaborator's document — so it is never trusted to be a small
 * non-negative integer.
 */
export function clampDecimals(
  dp: number | undefined,
  fallback: number,
): number {
  if (dp === undefined || !Number.isFinite(dp)) {
    return fallback;
  }
  return Math.min(Math.max(Math.trunc(dp), 0), MAX_DECIMAL_PLACES);
}

/**
 * `safeFormat` renders a number without ever throwing. Every argument error
 * `Intl` raises here — an unsupported locale, an out-of-range fraction-digit
 * count, a currency code that is not well formed — would otherwise escape
 * `formatValue` on a paint and take the whole grid down, and the offending
 * value is stored in a shared document, so the failure would repeat on every
 * render for everyone. Each fallback drops one more piece of the request.
 */
function safeFormat(
  value: number,
  locale: string,
  options: Intl.NumberFormatOptions,
): string {
  try {
    return value.toLocaleString(locale, options);
  } catch {
    // Fall through: the locale may be the problem.
  }
  try {
    return value.toLocaleString('en-US', options);
  } catch {
    // Fall through: the options are the problem, not the locale.
  }
  try {
    return value.toLocaleString('en-US');
  } catch {
    return String(value);
  }
}

function parseDateValue(
  value: string,
): { date: Date; hasTime: boolean } | undefined {
  const isoDateMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDateMatch) {
    const year = Number(isoDateMatch[1]);
    const month = Number(isoDateMatch[2]);
    const day = Number(isoDateMatch[3]);
    const localDate = new Date(year, month - 1, day);
    if (
      localDate.getFullYear() === year &&
      localDate.getMonth() === month - 1 &&
      localDate.getDate() === day
    ) {
      return { date: localDate, hasTime: false };
    }
    return undefined;
  }

  const datetimeMatch = value.match(
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/,
  );
  if (datetimeMatch) {
    const year = Number(datetimeMatch[1]);
    const month = Number(datetimeMatch[2]);
    const day = Number(datetimeMatch[3]);
    const hour = Number(datetimeMatch[4]);
    const minute = Number(datetimeMatch[5]);
    const second = Number(datetimeMatch[6]);
    if (hour > 23 || minute > 59 || second > 59) return undefined;
    const localDate = new Date(year, month - 1, day, hour, minute, second);
    if (
      localDate.getFullYear() === year &&
      localDate.getMonth() === month - 1 &&
      localDate.getDate() === day
    ) {
      return { date: localDate, hasTime: true };
    }
    return undefined;
  }

  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) {
    return undefined;
  }
  return { date: parsed, hasTime: false };
}

function safeFormatDate(value: string, _locale: string): string {
  const result = parseDateValue(value);
  if (!result) {
    return value;
  }

  const { date, hasTime } = result;
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  if (!hasTime) {
    return `${year}-${month}-${day}`;
  }
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

/**
 * `decimalsInValue` returns how many decimal places a stored value string shows
 * on its own: `2` for `12.34`, `0` for `12`, an empty cell, or text.
 */
export function decimalsInValue(value?: string): number {
  if (!value) {
    return 0;
  }
  const dotIndex = value.indexOf('.');
  return dotIndex >= 0 ? value.length - dotIndex - 1 : 0;
}

/**
 * `renderedDecimals` returns how many decimal places a value actually shows
 * once its effective style is applied — which is not the same as what the raw
 * value holds. A cell storing `12` under `nf: 'number'` displays `12.00`, and a
 * caller asking "does this still have a decimal to drop?" has to see those two
 * digits.
 *
 * Formats that pass the value through untouched (`plain`, `date`, none) report
 * the value's own precision; the numeric formats report their stored `dp`, or
 * the format default of 2 when none is stored.
 */
export function renderedDecimals(
  value: string,
  style: CellStyle | undefined,
): number {
  const nf = style?.nf;
  if (!nf || nf === 'plain' || nf === 'date') {
    return decimalsInValue(value);
  }
  return clampDecimals(style?.dp, 2);
}

/**
 * `formatValue` converts a raw value to a display string based on the number format.
 * Returns the original value for non-numeric inputs or 'plain'/undefined format.
 * @param dp decimal places override (undefined uses format default of 2)
 */
export function formatValue(
  value: string,
  format?: NumberFormat,
  dp?: number,
  options?: FormatValueOptions,
): string {
  if (!format || format === 'plain') {
    return value;
  }

  if (value === '') {
    return value;
  }

  const decimals = clampDecimals(dp, 2);
  const locale = options?.locale ?? resolveSystemLocale();
  const currency = options?.currency ?? resolveCurrencyForLocale(locale);

  switch (format) {
    case 'number': {
      const num = Number(value);
      if (isNaN(num)) return value;
      return safeFormat(num, locale, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
    }
    case 'currency': {
      const num = Number(value);
      if (isNaN(num)) return value;
      if (dp === undefined) {
        return safeFormat(num, locale, {
          style: 'currency',
          currency,
        });
      }
      return safeFormat(num, locale, {
        style: 'currency',
        currency,
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
    }
    case 'percent': {
      const num = Number(value);
      if (isNaN(num)) return value;
      return safeFormat(num, locale, {
        style: 'percent',
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
    }
    case 'date':
      return safeFormatDate(value, locale);
    default:
      return value;
  }
}
