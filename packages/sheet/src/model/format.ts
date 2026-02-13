import { NumberFormat } from './types';

/**
 * `formatValue` converts a raw value to a display string based on the number format.
 * Returns the original value for non-numeric inputs or 'plain'/undefined format.
 */
export function formatValue(value: string, format?: NumberFormat): string {
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

  switch (format) {
    case 'number':
      return num.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    case 'currency':
      return num.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
      });
    case 'percent':
      return (num / 100).toLocaleString('en-US', {
        style: 'percent',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    default:
      return value;
  }
}
