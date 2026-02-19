import { inRange, toRange } from './coordinates';
import { remapIndex } from './shifting';
import {
  Axis,
  Cell,
  ConditionalFormatOperator,
  ConditionalFormatRule,
  ConditionalFormatStyle,
  Range,
} from './types';

const ConditionalFormatOperators = new Set<ConditionalFormatOperator>([
  'isEmpty',
  'isNotEmpty',
  'textContains',
  'greaterThan',
  'between',
  'dateBefore',
  'dateAfter',
]);

const ValueRequiredOperators = new Set<ConditionalFormatOperator>([
  'textContains',
  'greaterThan',
  'dateBefore',
  'dateAfter',
]);

function cloneRange(range: Range): Range {
  return [
    { r: range[0].r, c: range[0].c },
    { r: range[1].r, c: range[1].c },
  ];
}

function isOperator(value: string): value is ConditionalFormatOperator {
  return ConditionalFormatOperators.has(value as ConditionalFormatOperator);
}

function normalizeText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'object') {
    const withValue = value as { value?: unknown; toJSON?: () => unknown };
    if (withValue.value !== undefined && withValue.value !== value) {
      return normalizeText(withValue.value);
    }
    if (typeof withValue.toJSON === 'function') {
      try {
        const jsonValue = withValue.toJSON.call(value);
        if (jsonValue !== value) {
          return normalizeText(jsonValue);
        }
      } catch {
        // Ignore and fall back to string conversion.
      }
    }
  }
  return String(value);
}

function normalizeRange(range: Range): Range {
  return toRange(range[0], range[1]);
}

function normalizeNumericValue(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().replace(/,/g, '');
  if (!normalized) {
    return undefined;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeDateValue(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const isoDate = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDate) {
    const year = Number(isoDate[1]);
    const month = Number(isoDate[2]);
    const day = Number(isoDate[3]);
    const localDate = new Date(year, month - 1, day);
    if (
      localDate.getFullYear() !== year ||
      localDate.getMonth() !== month - 1 ||
      localDate.getDate() !== day
    ) {
      return undefined;
    }
    return localDate.getTime();
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return new Date(
    parsed.getFullYear(),
    parsed.getMonth(),
    parsed.getDate(),
  ).getTime();
}

function shiftBoundary(indexValue: number, index: number, count: number): number {
  if (count > 0) {
    return indexValue >= index ? indexValue + count : indexValue;
  }

  const absCount = Math.abs(count);
  if (indexValue >= index && indexValue < index + absCount) {
    return index;
  }
  if (indexValue >= index + absCount) {
    return indexValue + count;
  }
  return indexValue;
}

function clampRange(range: Range): Range {
  return toRange(
    { r: Math.max(1, range[0].r), c: Math.max(1, range[0].c) },
    { r: Math.max(1, range[1].r), c: Math.max(1, range[1].c) },
  );
}

function normalizeStyleColor(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

/**
 * `normalizeConditionalFormatStyle` removes undefined values and unsupported keys.
 */
export function normalizeConditionalFormatStyle(
  style: ConditionalFormatStyle,
): ConditionalFormatStyle | undefined {
  const next: ConditionalFormatStyle = {};

  if (style.b !== undefined) next.b = style.b;
  if (style.i !== undefined) next.i = style.i;
  if (style.u !== undefined) next.u = style.u;

  const textColor = normalizeStyleColor(style.tc);
  if (textColor !== undefined) {
    next.tc = textColor;
  }

  const backgroundColor = normalizeStyleColor(style.bg);
  if (backgroundColor !== undefined) {
    next.bg = backgroundColor;
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

/**
 * `cloneConditionalFormatRule` deep-clones a conditional format rule.
 */
export function cloneConditionalFormatRule(
  rule: ConditionalFormatRule,
): ConditionalFormatRule {
  const cloned: ConditionalFormatRule = {
    id: rule.id,
    range: cloneRange(rule.range),
    op: rule.op,
    style: { ...rule.style },
  };

  if (rule.value !== undefined) {
    cloned.value = rule.value;
  }
  if (rule.value2 !== undefined) {
    cloned.value2 = rule.value2;
  }

  return cloned;
}

/**
 * `normalizeConditionalFormatRule` validates and normalizes a rule payload.
 */
export function normalizeConditionalFormatRule(
  rule: ConditionalFormatRule,
): ConditionalFormatRule | undefined {
  const id = normalizeText(rule.id).trim();
  if (!id) {
    return undefined;
  }

  const op = normalizeText(rule.op).trim();
  if (!isOperator(op)) {
    return undefined;
  }

  const style = normalizeConditionalFormatStyle(rule.style || {});
  if (!style) {
    return undefined;
  }

  const normalized: ConditionalFormatRule = {
    id,
    range: normalizeRange(rule.range),
    op,
    style,
  };

  if (ValueRequiredOperators.has(op)) {
    const value = normalizeText(rule.value).trim();
    if (!value) {
      return undefined;
    }
    normalized.value = value;
    return normalized;
  }

  if (op === 'between') {
    const value = normalizeText(rule.value).trim();
    const value2 = normalizeText(rule.value2).trim();
    if (!value || !value2) {
      return undefined;
    }
    normalized.value = value;
    normalized.value2 = value2;
    return normalized;
  }

  return normalized;
}

/**
 * `matchesConditionalFormatRule` evaluates whether text value satisfies a rule.
 */
export function matchesConditionalFormatRule(
  value: string,
  rule: ConditionalFormatRule,
): boolean {
  const normalizedValue = normalizeText(value);
  const trimmedValue = normalizedValue.trim();

  switch (rule.op) {
    case 'isEmpty':
      return trimmedValue.length === 0;
    case 'isNotEmpty':
      return trimmedValue.length > 0;
    case 'textContains': {
      const keyword = normalizeText(rule.value).trim().toLowerCase();
      if (!keyword) return false;
      return trimmedValue.toLowerCase().includes(keyword);
    }
    case 'greaterThan': {
      const cellNumber = normalizeNumericValue(trimmedValue);
      const targetNumber = normalizeNumericValue(rule.value);
      return (
        cellNumber !== undefined &&
        targetNumber !== undefined &&
        cellNumber > targetNumber
      );
    }
    case 'between': {
      const cellNumber = normalizeNumericValue(trimmedValue);
      const low = normalizeNumericValue(rule.value);
      const high = normalizeNumericValue(rule.value2);
      if (
        cellNumber === undefined ||
        low === undefined ||
        high === undefined
      ) {
        return false;
      }
      const min = Math.min(low, high);
      const max = Math.max(low, high);
      return cellNumber >= min && cellNumber <= max;
    }
    case 'dateBefore': {
      const cellDate = normalizeDateValue(trimmedValue);
      const targetDate = normalizeDateValue(rule.value);
      return (
        cellDate !== undefined &&
        targetDate !== undefined &&
        cellDate < targetDate
      );
    }
    case 'dateAfter': {
      const cellDate = normalizeDateValue(trimmedValue);
      const targetDate = normalizeDateValue(rule.value);
      return (
        cellDate !== undefined &&
        targetDate !== undefined &&
        cellDate > targetDate
      );
    }
    default:
      return false;
  }
}

/**
 * `resolveConditionalFormatStyleAt` merges matching rule styles in list order.
 * Later matching rules override earlier ones.
 */
export function resolveConditionalFormatStyleAt(
  rules: ConditionalFormatRule[],
  row: number,
  col: number,
  cell?: Cell,
): ConditionalFormatStyle | undefined {
  if (rules.length === 0) {
    return undefined;
  }

  const point = { r: row, c: col };
  const value = normalizeText(cell?.v);
  let resolved: ConditionalFormatStyle | undefined;

  for (const rule of rules) {
    if (!inRange(point, rule.range)) {
      continue;
    }
    if (!matchesConditionalFormatRule(value, rule)) {
      continue;
    }
    resolved = { ...(resolved || {}), ...rule.style };
  }

  return resolved;
}

/**
 * `shiftConditionalFormatRules` remaps rules after insert/delete operations.
 */
export function shiftConditionalFormatRules(
  rules: ConditionalFormatRule[],
  axis: Axis,
  index: number,
  count: number,
): ConditionalFormatRule[] {
  const next: ConditionalFormatRule[] = [];
  for (const rule of rules) {
    const normalized = normalizeConditionalFormatRule(rule);
    if (!normalized) {
      continue;
    }

    const range = normalized.range;
    const shifted = axis === 'row'
      ? toRange(
          {
            r: shiftBoundary(range[0].r, index, count),
            c: range[0].c,
          },
          {
            r: shiftBoundary(range[1].r, index, count),
            c: range[1].c,
          },
        )
      : toRange(
          {
            r: range[0].r,
            c: shiftBoundary(range[0].c, index, count),
          },
          {
            r: range[1].r,
            c: shiftBoundary(range[1].c, index, count),
          },
        );

    next.push({
      ...cloneConditionalFormatRule(normalized),
      range: clampRange(shifted),
    });
  }
  return next;
}

/**
 * `moveConditionalFormatRules` remaps rules after row/column move operations.
 */
export function moveConditionalFormatRules(
  rules: ConditionalFormatRule[],
  axis: Axis,
  src: number,
  count: number,
  dst: number,
): ConditionalFormatRule[] {
  const next: ConditionalFormatRule[] = [];
  for (const rule of rules) {
    const normalized = normalizeConditionalFormatRule(rule);
    if (!normalized) {
      continue;
    }

    const range = normalized.range;
    const moved = axis === 'row'
      ? toRange(
          { r: remapIndex(range[0].r, src, count, dst), c: range[0].c },
          { r: remapIndex(range[1].r, src, count, dst), c: range[1].c },
        )
      : toRange(
          { r: range[0].r, c: remapIndex(range[0].c, src, count, dst) },
          { r: range[1].r, c: remapIndex(range[1].c, src, count, dst) },
        );

    next.push({
      ...cloneConditionalFormatRule(normalized),
      range: clampRange(moved),
    });
  }
  return next;
}
