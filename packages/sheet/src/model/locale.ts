const DefaultLocale = 'en-US';
const DefaultCurrency = 'USD';

const EuroRegions = new Set([
  'AT',
  'BE',
  'CY',
  'DE',
  'EE',
  'ES',
  'FI',
  'FR',
  'GR',
  'HR',
  'IE',
  'IT',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'PT',
  'SI',
  'SK',
]);

const CurrencyByRegion: Record<string, string> = {
  AE: 'AED',
  AR: 'ARS',
  AU: 'AUD',
  BD: 'BDT',
  BR: 'BRL',
  CA: 'CAD',
  CH: 'CHF',
  CL: 'CLP',
  CN: 'CNY',
  CO: 'COP',
  CZ: 'CZK',
  DK: 'DKK',
  EG: 'EGP',
  GB: 'GBP',
  HK: 'HKD',
  HU: 'HUF',
  ID: 'IDR',
  IL: 'ILS',
  IN: 'INR',
  JP: 'JPY',
  KE: 'KES',
  KR: 'KRW',
  KW: 'KWD',
  MX: 'MXN',
  MY: 'MYR',
  NG: 'NGN',
  NO: 'NOK',
  NZ: 'NZD',
  PE: 'PEN',
  PH: 'PHP',
  PK: 'PKR',
  PL: 'PLN',
  QA: 'QAR',
  RO: 'RON',
  RU: 'RUB',
  SA: 'SAR',
  SE: 'SEK',
  SG: 'SGD',
  TH: 'THB',
  TR: 'TRY',
  TW: 'TWD',
  UA: 'UAH',
  US: 'USD',
  VN: 'VND',
  ZA: 'ZAR',
};

const currencyByLocaleCache = new Map<string, string>();

function normalizeLocale(locale?: string): string {
  if (locale && locale.trim()) {
    return locale.trim();
  }

  if (typeof navigator !== 'undefined' && navigator.language) {
    return navigator.language;
  }

  return Intl.DateTimeFormat().resolvedOptions().locale || DefaultLocale;
}

function resolveRegionFromLocale(locale: string): string | undefined {
  const [base] = locale.replace(/_/g, '-').split('-u-');
  const parts = base.split('-').filter(Boolean);
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (/^[a-z]{2}$/i.test(part)) {
      return part.toUpperCase();
    }
  }

  try {
    const region = new Intl.Locale(locale).maximize().region;
    if (region) {
      return region.toUpperCase();
    }
  } catch {
    // Ignore and fall back to default currency.
  }

  return undefined;
}

function safeFormatNumber(
  value: number,
  locale: string,
  options: Intl.NumberFormatOptions,
): string {
  try {
    return new Intl.NumberFormat(locale, options).format(value);
  } catch {
    return new Intl.NumberFormat(DefaultLocale, options).format(value);
  }
}

function safeFormatDate(value: Date, _locale: string): string {
  const year = String(value.getFullYear()).padStart(4, '0');
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export type LocaleFormatPreview = {
  locale: string;
  currency: string;
  number: string;
  currencyValue: string;
  percent: string;
  date: string;
};

export function resolveSystemLocale(): string {
  return normalizeLocale();
}

export function resolveCurrencyForLocale(locale?: string): string {
  const normalizedLocale = normalizeLocale(locale);
  const cachedCurrency = currencyByLocaleCache.get(normalizedLocale);
  if (cachedCurrency) {
    return cachedCurrency;
  }

  const region = resolveRegionFromLocale(normalizedLocale);
  let currency = DefaultCurrency;

  if (region) {
    currency = EuroRegions.has(region)
      ? 'EUR'
      : (CurrencyByRegion[region] ?? DefaultCurrency);
  }

  currencyByLocaleCache.set(normalizedLocale, currency);
  return currency;
}

export function buildLocaleFormatPreview(locale?: string): LocaleFormatPreview {
  const normalizedLocale = normalizeLocale(locale);
  const currency = resolveCurrencyForLocale(normalizedLocale);

  return {
    locale: normalizedLocale,
    currency,
    number: safeFormatNumber(1234.56, normalizedLocale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
    currencyValue: safeFormatNumber(1234.56, normalizedLocale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
    percent: safeFormatNumber(0.1234, normalizedLocale, {
      style: 'percent',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
    date: safeFormatDate(new Date(2026, 1, 18), normalizedLocale),
  };
}
