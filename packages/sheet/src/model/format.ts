import { NumberFormat } from './types';

/**
 * `formatValue` converts a raw value to a display string based on the number format.
 * Returns the original value for non-numeric inputs or 'plain'/undefined format.
 * @param dp decimal places override (undefined uses format default of 2)
 */
export function formatValue(value: string, format?: NumberFormat, dp?: number): string {
  if (!format || format === 'plain') {
    return value;
  }

  if (value === '') {
    return value;
  }

  const num = Number(value);
  if (isNaN(num)) {
    return value;
  }

  const decimals = dp ?? 2;

  switch (format) {
    case 'number':
      return num.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
    case 'currency':
      return num.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
    case 'percent':
      return (num / 100).toLocaleString('en-US', {
        style: 'percent',
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
    default:
      return value;
  }
}
