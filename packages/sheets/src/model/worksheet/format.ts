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

type DatePart = 'date' | 'time' | 'datetime';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * `safeFormatDate` renders a date string as the requested part. `date` keeps
 * the time when the value carries one (the behavior documents already rely
 * on); `time` and `datetime` always show it, midnight for a date-only value.
 *
 * The model stores dates as strings, never as serial numbers, so a bare number
 * under `time`/`datetime` passes through untouched rather than being read by
 * `Date`'s permissive parser as some arbitrary year.
 */
function safeFormatDate(value: string, part: DatePart): string {
  if (part !== 'date' && !isNaN(Number(value))) {
    return value;
  }
  const result = parseDateValue(value);
  if (!result) {
    return value;
  }

  const { date, hasTime } = result;
  const year = String(date.getFullYear()).padStart(4, '0');
  const ymd = `${year}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  const hms = `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(
    date.getSeconds(),
  )}`;
  if (part === 'time') {
    return hms;
  }
  if (part === 'datetime' || hasTime) {
    return `${ymd} ${hms}`;
  }
  return ymd;
}

/**
 * `formatScientific` renders `1234.5` as `1.23E+03`: a mantissa with exactly
 * `decimals` fraction digits and a signed, at-least-two-digit exponent, the
 * shape Google Sheets and Excel use for `0.00E+00`.
 */
function formatScientific(value: number, decimals: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }
  const [mantissa, exponent] = value.toExponential(decimals).split('e');
  const exp = Number(exponent);
  const sign = exp < 0 ? '-' : '+';
  return `${mantissa}E${sign}${String(Math.abs(exp)).padStart(2, '0')}`;
}

/**
 * `formatAccounting` renders a currency with negatives in parentheses and zero
 * as a dash (`$ -`), the accounting convention. The digits come from the same
 * `Intl` currency format `currency` uses, so separators and symbol placement
 * follow the locale.
 */
function formatAccounting(
  value: number,
  locale: string,
  options: Intl.NumberFormatOptions,
): string {
  const accounting: Intl.NumberFormatOptions = {
    ...options,
    style: 'currency',
    currencySign: 'accounting',
  };
  if (value !== 0) {
    return safeFormat(value, locale, accounting);
  }
  let parts: Intl.NumberFormatPart[];
  try {
    parts = new Intl.NumberFormat(locale, accounting).formatToParts(0);
  } catch {
    return safeFormat(value, locale, accounting);
  }
  const numeric = new Set(['integer', 'group', 'decimal', 'fraction']);
  let out = '';
  let dashed = false;
  for (const part of parts) {
    if (!numeric.has(part.type)) {
      out += part.value;
    } else if (!dashed) {
      out += '-';
      dashed = true;
    }
  }
  // Keep the dash visibly apart from an adjacent symbol: `$ -`, not `$-`.
  return out.replace(/(\S)-/, '$1 -').replace(/-(\S)/, '- $1');
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
 * `currencyDecimals` returns how many fraction digits a currency renders with
 * when nothing overrides it. It is the currency's own convention, not a flat 2:
 * `KRW` and `JPY` show none, `KWD` shows three. `formatValue` leaves the
 * fraction-digit options off entirely for a `dp`-less currency precisely so
 * `Intl` applies that convention, so anything reporting what such a cell shows
 * has to ask `Intl` the same question.
 */
export function currencyDecimals(locale: string, currency: string): number {
  try {
    const resolved = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
    }).resolvedOptions();
    return resolved.maximumFractionDigits ?? 2;
  } catch {
    // A locale or currency `Intl` rejects renders through `safeFormat`'s
    // fallbacks, which end at the plain-number default of 2.
    return 2;
  }
}

/**
 * `renderedDecimals` returns how many decimal places a value actually shows
 * once its effective style is applied — which is not the same as what the raw
 * value holds. A cell storing `12` under `nf: 'number'` displays `12.00`, and a
 * caller asking "does this still have a decimal to drop?" has to see those two
 * digits.
 *
 * Formats that pass the value through untouched (`plain`, the date formats,
 * none) report the value's own precision. The numeric formats report their
 * stored `dp`; with none stored, `number`/`percent`/`scientific`/`financial`
 * render 2 digits and `currency`/`accounting` render the currency's own
 * convention — which is what `formatValue` does for the same input.
 */
export function renderedDecimals(
  value: string,
  style: CellStyle | undefined,
  options?: FormatValueOptions,
): number {
  const nf = style?.nf;
  if (
    !nf ||
    nf === 'plain' ||
    nf === 'date' ||
    nf === 'time' ||
    nf === 'datetime'
  ) {
    return decimalsInValue(value);
  }
  if ((nf === 'currency' || nf === 'accounting') && style?.dp === undefined) {
    const locale = options?.locale ?? resolveSystemLocale();
    return currencyDecimals(
      locale,
      options?.currency ?? resolveCurrencyForLocale(locale),
    );
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
    case 'scientific': {
      const num = Number(value);
      if (isNaN(num)) return value;
      return formatScientific(num, decimals);
    }
    case 'financial': {
      const num = Number(value);
      if (isNaN(num)) return value;
      const digits = safeFormat(Math.abs(num), locale, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
      // A value that rounds to zero shows no parentheses: `(0.00)` would
      // claim a debit the digits do not show.
      return num < 0 && /[1-9]/.test(digits) ? `(${digits})` : digits;
    }
    case 'accounting': {
      const num = Number(value);
      if (isNaN(num)) return value;
      const accounting: Intl.NumberFormatOptions = { currency };
      if (dp !== undefined) {
        accounting.minimumFractionDigits = decimals;
        accounting.maximumFractionDigits = decimals;
      }
      return formatAccounting(num, locale, accounting);
    }
    case 'date':
    case 'time':
    case 'datetime':
      return safeFormatDate(value, format);
    default:
      return value;
  }
}
