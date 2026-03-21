const CurrencySymbolToCode = {
  '$': 'USD',
  '₩': 'KRW',
} as const;

type CurrencySymbol = keyof typeof CurrencySymbolToCode;

export type InferredInputFormat = 'percent' | 'yyyy-mm-dd' | `currency:${string}`;

export type InferredInput =
  | {
      type: 'number';
      value: number;
      format?: Exclude<InferredInputFormat, 'yyyy-mm-dd'>;
    }
  | {
      type: 'date';
      value: string;
      format: 'yyyy-mm-dd';
    }
  | {
      type: 'boolean';
      value: boolean;
    }
  | {
      type: 'formula';
      value: string;
    }
  | {
      type: 'text';
      value: string;
    };

export type InferInputOptions = {
  referenceDate?: Date;
};

type ParseNumberOptions = {
  allowExponent: boolean;
  allowLeadingDot: boolean;
  allowPaddedInteger: boolean;
};

type ParsedCurrency = {
  code: string;
  value: number;
};

function hasForbiddenLeadingZero(integerPart: string): boolean {
  return integerPart.length > 1 && integerPart.startsWith('0');
}

function parseGroupedInteger(raw: string): string | undefined {
  if (!raw.includes(',')) {
    return /^\d+$/.test(raw) ? raw : undefined;
  }

  const groups = raw.split(',');
  if (!/^\d{1,3}$/.test(groups[0])) return undefined;
  for (let i = 1; i < groups.length; i++) {
    if (!/^\d{3}$/.test(groups[i])) {
      return undefined;
    }
  }

  return groups.join('');
}

function parseNumberLiteral(
  input: string,
  options: ParseNumberOptions,
): number | undefined {
  if (input.length === 0 || /\s/.test(input)) {
    return undefined;
  }

  if (options.allowExponent && /[eE]/.test(input)) {
    const exponentMatch = input.match(
      /^([+-])?(\d+(?:\.\d+)?|\.\d+)[eE]([+-]?\d+)$/,
    );
    if (!exponentMatch) return undefined;

    const sign = exponentMatch[1] ?? '';
    const mantissa = exponentMatch[2];
    const exponent = exponentMatch[3];
    const integerPart = mantissa.startsWith('.')
      ? '0'
      : mantissa.split('.')[0];
    if (
      !options.allowPaddedInteger &&
      hasForbiddenLeadingZero(integerPart)
    ) {
      return undefined;
    }

    const value = Number(`${sign}${mantissa}e${exponent}`);
    return Number.isFinite(value) ? value : undefined;
  }

  const standardMatch = input.match(/^([+-])?(\d[\d,]*)(?:\.(\d*))?$/);
  if (standardMatch) {
    const sign = standardMatch[1] ?? '';
    const rawInteger = standardMatch[2];
    const fractional = standardMatch[3];
    const integer = parseGroupedInteger(rawInteger);
    if (!integer) return undefined;
    if (
      !options.allowPaddedInteger &&
      hasForbiddenLeadingZero(integer)
    ) {
      return undefined;
    }

    const literal =
      fractional !== undefined
        ? `${sign}${integer}.${fractional}`
        : `${sign}${integer}`;
    const value = Number(literal);
    return Number.isFinite(value) ? value : undefined;
  }

  if (options.allowLeadingDot) {
    const leadingDotMatch = input.match(/^([+-])?\.(\d+)$/);
    if (!leadingDotMatch) return undefined;
    const sign = leadingDotMatch[1] ?? '';
    const fractional = leadingDotMatch[2];
    const value = Number(`${sign}0.${fractional}`);
    return Number.isFinite(value) ? value : undefined;
  }

  return undefined;
}

function toIsoDate(year: number, month: number, day: number): string | undefined {
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return undefined;
  }

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseIsoDate(input: string): string | undefined {
  const match = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return toIsoDate(year, month, day);
}

function parseMonthDay(input: string, year: number): string | undefined {
  const match = input.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!match) return undefined;

  const month = Number(match[1]);
  const day = Number(match[2]);
  return toIsoDate(year, month, day);
}

function parseCurrency(input: string): ParsedCurrency | undefined {
  const match = input.match(
    /^([+-])?\s*([$₩])\s*([0-9][0-9,]*(?:\.[0-9]+)?|\.\d+)$/,
  );
  if (!match) return undefined;

  const sign = match[1] ?? '';
  const symbol = match[2] as CurrencySymbol;
  const amount = match[3];
  const value = parseNumberLiteral(`${sign}${amount}`, {
    allowExponent: false,
    allowLeadingDot: true,
    allowPaddedInteger: true,
  });

  if (value === undefined) return undefined;
  return {
    code: CurrencySymbolToCode[symbol],
    value,
  };
}

function parsePercent(input: string): number | undefined {
  const match = input.match(
    /^([+-])?\s*([0-9][0-9,]*(?:\.[0-9]+)?|\.\d+)\s*%$/,
  );
  if (!match) return undefined;

  const sign = match[1] ?? '';
  const amount = match[2];
  const value = parseNumberLiteral(`${sign}${amount}`, {
    allowExponent: false,
    allowLeadingDot: true,
    allowPaddedInteger: true,
  });

  if (value === undefined) return undefined;
  return value / 100;
}

/**
 * `inferInput` conservatively infers the normalized value type from user input.
 */
export function inferInput(
  input: string,
  options?: InferInputOptions,
): InferredInput {
  const trimmed = input.trim();

  if (trimmed.startsWith('=')) {
    return {
      type: 'formula',
      value: trimmed.slice(1).trimStart(),
    };
  }

  const lower = trimmed.toLowerCase();
  if (lower === 'true') {
    return { type: 'boolean', value: true };
  }
  if (lower === 'false') {
    return { type: 'boolean', value: false };
  }

  const currency = parseCurrency(trimmed);
  if (currency) {
    return {
      type: 'number',
      value: currency.value,
      format: `currency:${currency.code}`,
    };
  }

  const percent = parsePercent(trimmed);
  if (percent !== undefined) {
    return {
      type: 'number',
      value: percent,
      format: 'percent',
    };
  }

  const isoDate = parseIsoDate(trimmed);
  if (isoDate) {
    return {
      type: 'date',
      value: isoDate,
      format: 'yyyy-mm-dd',
    };
  }

  const year =
    options?.referenceDate?.getFullYear() ?? new Date().getFullYear();
  const mdDate = parseMonthDay(trimmed, year);
  if (mdDate) {
    return {
      type: 'date',
      value: mdDate,
      format: 'yyyy-mm-dd',
    };
  }

  const numeric = parseNumberLiteral(trimmed, {
    allowExponent: true,
    allowLeadingDot: true,
    allowPaddedInteger: false,
  });
  if (numeric !== undefined) {
    return { type: 'number', value: numeric };
  }

  return { type: 'text', value: trimmed };
}
