import { NumberFormat } from './types';
import { resolveCurrencyForLocale, resolveSystemLocale } from './locale';

export type FormatValueOptions = {
  locale?: string;
  currency?: string;
};

function safeFormat(
  value: number,
  locale: string,
  options: Intl.NumberFormatOptions,
): string {
  try {
    return value.toLocaleString(locale, options);
  } catch {
    return value.toLocaleString('en-US', options);
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

  const decimals = dp ?? 2;
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
