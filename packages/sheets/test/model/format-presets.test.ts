import { describe, it, expect } from 'vitest';
import {
  activeNumberFormatPreset,
  buildNumberFormatPresets,
} from '../../src/model/worksheet/format-presets';
import { formatValue } from '../../src/model/worksheet/format';

const ids = (locale: string) =>
  buildNumberFormatPresets({ locale }).map((preset) => preset.id);

describe('buildNumberFormatPresets', () => {
  it('should offer one currency family for a USD locale', () => {
    expect(ids('en-US')).toEqual([
      'plain',
      'number',
      'percent',
      'scientific',
      'accounting',
      'financial',
      'currency',
      'currencyRounded',
      'date',
      'time',
      'datetime',
    ]);
  });

  it('should add a distinct US dollar item beside a non-USD locale currency', () => {
    const presets = buildNumberFormatPresets({ locale: 'de-DE' });
    const currency = presets.find((p) => p.id === 'currency')!;
    const usd = presets.find((p) => p.id === 'currencyUSD')!;
    expect(currency.style).toEqual({ nf: 'currency', cu: 'EUR', dp: 2 });
    expect(usd.style).toEqual({ nf: 'currency', cu: 'USD', dp: 2 });
    expect(currency.label).toContain('EUR');
    expect(usd.label).toContain('USD');
  });

  it('should store the locale currency explicitly so it never shifts per viewer', () => {
    const presets = buildNumberFormatPresets({ locale: 'ko-KR' });
    const currency = presets.find((p) => p.id === 'currency')!;
    expect(currency.style).toEqual({ nf: 'currency', cu: 'KRW', dp: 0 });
    // KRW has no minor unit, so "rounded" would duplicate "Currency".
    expect(presets.some((p) => p.id === 'currencyRounded')).toBe(false);
  });

  it('should preview each preset with the formatter it applies', () => {
    for (const preset of buildNumberFormatPresets({ locale: 'en-US' })) {
      if (preset.id === 'plain') continue;
      expect(preset.preview).toBe(
        formatValue(preset.sample, preset.style.nf, preset.style.dp, {
          locale: 'en-US',
          currency: preset.style.cu,
        }),
      );
    }
    const byId = Object.fromEntries(
      buildNumberFormatPresets({ locale: 'en-US' }).map((p) => [p.id, p]),
    );
    expect(byId.number.preview).toBe('1,000.12');
    expect(byId.percent.preview).toBe('10.12%');
    expect(byId.scientific.preview).toBe('1.00E+03');
    expect(byId.accounting.preview).toBe('($1,000.12)');
    expect(byId.financial.preview).toBe('(1,000.12)');
    expect(byId.currency.preview).toBe('$1,000.12');
    expect(byId.currencyRounded.preview).toBe('$1,000');
    expect(byId.date.preview).toBe('2008-09-26');
    expect(byId.time.preview).toBe('15:59:00');
    expect(byId.datetime.preview).toBe('2008-09-26 15:59:00');
  });
});

describe('activeNumberFormatPreset', () => {
  const us = buildNumberFormatPresets({ locale: 'en-US' });
  const de = buildNumberFormatPresets({ locale: 'de-DE' });

  it('should report nothing for an unformatted cell', () => {
    expect(activeNumberFormatPreset(undefined, us)).toBeUndefined();
    expect(activeNumberFormatPreset({ b: true }, us)).toBeUndefined();
  });

  it('should match each preset by the style it applies', () => {
    for (const preset of [...us, ...de]) {
      const presets = us.includes(preset) ? us : de;
      expect(activeNumberFormatPreset(preset.style, presets)).toBe(preset.id);
    }
  });

  it('should tell locale currency and US dollar apart', () => {
    expect(
      activeNumberFormatPreset({ nf: 'currency', cu: 'EUR', dp: 2 }, de),
    ).toBe('currency');
    expect(
      activeNumberFormatPreset({ nf: 'currency', cu: 'USD', dp: 2 }, de),
    ).toBe('currencyUSD');
    // A currency no preset applies is no preset's.
    expect(
      activeNumberFormatPreset({ nf: 'currency', cu: 'JPY' }, de),
    ).toBeUndefined();
  });

  it('should read a legacy currency with no code as the locale currency', () => {
    // Older documents stored `nf: 'currency'` alone; it renders in the
    // viewer's locale currency, which is what the "Currency" item applies.
    expect(activeNumberFormatPreset({ nf: 'currency' }, de)).toBe('currency');
    expect(activeNumberFormatPreset({ nf: 'currency' }, us)).toBe('currency');
  });

  it('should keep a format checked after its decimals are stepped', () => {
    expect(activeNumberFormatPreset({ nf: 'number', dp: 4 }, us)).toBe(
      'number',
    );
    expect(
      activeNumberFormatPreset({ nf: 'currency', cu: 'USD', dp: 3 }, us),
    ).toBe('currency');
    expect(
      activeNumberFormatPreset({ nf: 'currency', cu: 'USD', dp: 0 }, us),
    ).toBe('currencyRounded');
  });
});
