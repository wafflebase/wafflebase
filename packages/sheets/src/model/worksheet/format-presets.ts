import { CellStyle, NumberFormat } from '../core/types';
import { resolveCurrencyForLocale, resolveSystemLocale } from '../core/locale';
import { currencyDecimals, formatValue } from './format';

/**
 * `NumberFormatPresetId` names one entry of the toolbar's number-format menu.
 */
export type NumberFormatPresetId =
  | 'plain'
  | 'number'
  | 'percent'
  | 'scientific'
  | 'accounting'
  | 'financial'
  | 'currency'
  | 'currencyRounded'
  | 'currencyUSD'
  | 'date'
  | 'time'
  | 'datetime';

/**
 * `NumberFormatPreset` is one menu entry: the style patch it applies, and a
 * preview rendered by the same `formatValue` the grid paints with, so what the
 * menu shows is what the cell will show.
 */
export type NumberFormatPreset = {
  id: NumberFormatPresetId;
  label: string;
  style: { nf: NumberFormat; cu?: string; dp?: number };
  sample: string;
  preview: string;
};

const NumberSample = '1000.12';
const NegativeSample = '-1000.12';
const DateSample = '2008-09-26';
const DateTimeSample = '2008-09-26 15:59:00';

/**
 * `buildNumberFormatPresets` returns the number-format menu for a locale,
 * modelled on Google Sheets' "More formats" list.
 *
 * Every currency entry stores its currency code explicitly. A `nf: 'currency'`
 * with no `cu` renders in each *viewer's* locale currency, so the same amount
 * would read `$1,000` to one collaborator and `₩1,000` to another; applying a
 * format pins the currency the author saw. When the locale currency is not the
 * US dollar, a separate US-dollar entry is offered beside it, so "$" and the
 * locale currency are two distinct formats rather than one applied twice.
 *
 * Each entry also stores its decimal count: the style model cannot unset a key
 * on a range ("no explicit none"), so re-applying "Currency" after "Currency
 * rounded" has to write the decimals back rather than drop them.
 */
export function buildNumberFormatPresets(options?: {
  locale?: string;
}): NumberFormatPreset[] {
  const locale = options?.locale ?? resolveSystemLocale();
  const localCurrency = resolveCurrencyForLocale(locale);
  const localDecimals = currencyDecimals(locale, localCurrency);

  const entries: Array<Omit<NumberFormatPreset, 'preview'>> = [
    { id: 'plain', label: 'Plain text', style: { nf: 'plain' }, sample: '' },
    {
      id: 'number',
      label: 'Number',
      style: { nf: 'number', dp: 2 },
      sample: NumberSample,
    },
    {
      id: 'percent',
      label: 'Percent',
      style: { nf: 'percent', dp: 2 },
      sample: '0.1012',
    },
    {
      id: 'scientific',
      label: 'Scientific',
      style: { nf: 'scientific', dp: 2 },
      sample: NumberSample,
    },
    {
      id: 'accounting',
      label: 'Accounting',
      style: { nf: 'accounting', cu: localCurrency, dp: localDecimals },
      sample: NegativeSample,
    },
    {
      id: 'financial',
      label: 'Financial',
      style: { nf: 'financial', dp: 2 },
      sample: NegativeSample,
    },
    {
      id: 'currency',
      label:
        localCurrency === 'USD' ? 'Currency' : `Currency (${localCurrency})`,
      style: { nf: 'currency', cu: localCurrency, dp: localDecimals },
      sample: NumberSample,
    },
  ];
  if (localDecimals > 0) {
    entries.push({
      id: 'currencyRounded',
      label:
        localCurrency === 'USD'
          ? 'Currency rounded'
          : `Currency rounded (${localCurrency})`,
      style: { nf: 'currency', cu: localCurrency, dp: 0 },
      sample: NumberSample,
    });
  }
  if (localCurrency !== 'USD') {
    entries.push({
      id: 'currencyUSD',
      label: 'Currency (USD)',
      style: { nf: 'currency', cu: 'USD', dp: 2 },
      sample: NumberSample,
    });
  }
  entries.push(
    { id: 'date', label: 'Date', style: { nf: 'date' }, sample: DateSample },
    {
      id: 'time',
      label: 'Time',
      style: { nf: 'time' },
      sample: DateTimeSample,
    },
    {
      id: 'datetime',
      label: 'Date time',
      style: { nf: 'datetime' },
      sample: DateTimeSample,
    },
  );

  return entries.map((entry) => ({
    ...entry,
    preview:
      entry.id === 'plain'
        ? ''
        : formatValue(entry.sample, entry.style.nf, entry.style.dp, {
            locale,
            currency: entry.style.cu,
          }),
  }));
}

/**
 * `activeNumberFormatPreset` returns the menu entry a style currently renders
 * through, or undefined when none does (no format, or a currency no entry
 * applies). Decimals other than the rounded/non-rounded split are ignored, so
 * a format stays checked after Increase/Decrease decimal places.
 *
 * A currency stored without a code (documents written before codes were
 * pinned) renders in the viewer's locale currency, so it reads as that entry.
 */
export function activeNumberFormatPreset(
  style: CellStyle | undefined,
  presets: NumberFormatPreset[],
): NumberFormatPresetId | undefined {
  const nf = style?.nf;
  if (!nf) {
    return undefined;
  }
  const has = (id: NumberFormatPresetId) =>
    presets.some((preset) => preset.id === id);

  if (nf === 'currency' || nf === 'accounting') {
    const local = presets.find((preset) => preset.id === 'currency')?.style.cu;
    const code = style?.cu ?? local;
    if (nf === 'accounting') {
      return code === local && has('accounting') ? 'accounting' : undefined;
    }
    if (code === local) {
      return style?.dp === 0 && has('currencyRounded')
        ? 'currencyRounded'
        : 'currency';
    }
    return code === 'USD' && has('currencyUSD') ? 'currencyUSD' : undefined;
  }

  const match = presets.find((preset) => preset.style.nf === nf);
  return match?.id;
}
