import { cloneRange, inRange } from '../core/coordinates';
import { moveRuleRanges, shiftRuleRanges } from './rule-ranges';
import {
  Axis,
  DataValidationKind,
  DataValidationOperator,
  DataValidationRule,
  Ref,
} from '../core/types';
import { inferInput } from './input';

export const CHECKBOX_TRUE = 'TRUE';
export const CHECKBOX_FALSE = 'FALSE';

const Kinds = new Set<DataValidationKind>([
  'checkbox',
  'list',
  'date',
  'number',
  'text',
]);

/**
 * `validationOperandCount` returns how many comparison operands an operator
 * consumes: 0 for the `*Valid` / email / url predicates, 2 for between /
 * not-between, else 1. Shared by the date, number, and text kinds.
 */
export function validationOperandCount(op: DataValidationOperator): number {
  switch (op) {
    case 'dateValid':
    case 'numberValid':
    case 'textIsEmail':
    case 'textIsUrl':
      return 0;
    case 'dateBetween':
    case 'dateNotBetween':
    case 'numberBetween':
    case 'numberNotBetween':
      return 2;
    default:
      return 1;
  }
}

/**
 * `dateValidationOperandCount` is retained for existing callers; delegates to
 * the shared `validationOperandCount`.
 */
export function dateValidationOperandCount(op: DataValidationOperator): number {
  return validationOperandCount(op);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * `parseNumberOperand` returns the finite number a raw operand represents, or
 * undefined when it is blank or not a number.
 */
function parseNumberOperand(raw: string | undefined): number | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : undefined;
}

/**
 * `toIsoDateOperand` normalizes a raw operand to an ISO `yyyy-mm-dd` string via
 * the shared input parser, or returns undefined when it is not a date.
 */
function toIsoDateOperand(raw: string | undefined): string | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  const inferred = inferInput(raw.trim());
  // `inferInput` returns the raw string for a datetime (`yyyy-mm-dd HH:MM:SS`);
  // keep only the `yyyy-mm-dd` date part so an operand is always a pure ISO date.
  return inferred.type === 'date' ? inferred.value.slice(0, 10) : undefined;
}

/**
 * `normalizeOperand` canonicalizes a single comparison operand by kind: an ISO
 * date, a finite-number string, or a trimmed text value. Returns '' for a
 * blank or unparseable operand (a fixed-length slot the value check treats as
 * incomplete).
 */
function normalizeOperand(
  kind: DataValidationKind,
  raw: string | undefined,
): string {
  if (kind === 'date') return toIsoDateOperand(raw) ?? '';
  if (kind === 'number') {
    const n = parseNumberOperand(raw);
    return n === undefined ? '' : String(n);
  }
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * `normalizeListOptions` trims each option, drops empty entries, and dedupes
 * (keeping first occurrence) — the canonical form of a list rule's options.
 */
export function normalizeListOptions(options: string[] | undefined): string[] {
  if (!Array.isArray(options)) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of options) {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

/**
 * `normalizeDataValidationRule` validates a rule and returns a normalized
 * copy, or null if the rule is unusable (no id, unknown kind, no ranges). A
 * list rule additionally requires at least one usable option; its options are
 * trimmed/deduped and `showArrow` defaults to true.
 */
export function normalizeDataValidationRule(
  rule: DataValidationRule,
): DataValidationRule | null {
  if (!rule || !rule.id || !Kinds.has(rule.kind)) {
    return null;
  }
  if (!Array.isArray(rule.ranges) || rule.ranges.length === 0) {
    return null;
  }
  const cloned = cloneDataValidationRule(rule);
  if (cloned.kind === 'list') {
    const list = normalizeListOptions(cloned.list);
    if (list.length === 0) {
      return null;
    }
    cloned.list = list;
    cloned.showArrow = cloned.showArrow ?? true;
  }
  if (
    cloned.kind === 'date' ||
    cloned.kind === 'number' ||
    cloned.kind === 'text'
  ) {
    const defaultOp: DataValidationOperator =
      cloned.kind === 'date'
        ? 'dateValid'
        : cloned.kind === 'number'
          ? 'numberValid'
          : 'textContains';
    const op: DataValidationOperator = cloned.operator ?? defaultOp;
    const need = validationOperandCount(op);
    // Keep a fixed-length slot per operand, storing '' for a missing or
    // unparseable one. This preserves position (a blank lower bound never
    // promotes the upper bound to index 0) AND retains the other operands
    // (clearing one bound of a between-rule must not drop the still-filled
    // one). An empty slot makes the comparison incomplete, so the value check
    // degrades to "always valid" until every required operand is filled.
    const slots: string[] = [];
    for (let i = 0; i < need; i++) {
      slots.push(normalizeOperand(cloned.kind, cloned.values?.[i]));
    }
    cloned.operator = op;
    cloned.values = slots.some((slot) => slot !== '') ? slots : undefined;
    cloned.onInvalid = cloned.onInvalid ?? 'warning';
  }
  return cloned;
}

/**
 * `cloneDataValidationRule` returns a deep copy of the rule.
 */
export function cloneDataValidationRule(
  rule: DataValidationRule,
): DataValidationRule {
  return {
    ...rule,
    ranges: rule.ranges.map((r) => cloneRange(r)),
    list: rule.list ? [...rule.list] : undefined,
    values: rule.values ? [...rule.values] : undefined,
  };
}

/**
 * `resolveDataValidationAt` returns the last rule whose ranges contain the
 * point (last-matching-rule-wins, matching conditional-format precedence).
 */
export function resolveDataValidationAt(
  point: Ref,
  rules: DataValidationRule[],
): DataValidationRule | undefined {
  let resolved: DataValidationRule | undefined;
  for (const rule of rules) {
    if (rule.ranges.some((r) => inRange(point, r))) {
      resolved = rule;
    }
  }
  return resolved;
}

/**
 * `checkedValueOf` / `uncheckedValueOf` return the string a checked/unchecked
 * checkbox stores. Custom values fall back to boolean TRUE/FALSE for now.
 */
function checkedValueOf(rule: DataValidationRule): string {
  return rule.checkedValue ?? CHECKBOX_TRUE;
}
function uncheckedValueOf(rule: DataValidationRule): string {
  return rule.uncheckedValue ?? CHECKBOX_FALSE;
}

/**
 * `isCheckboxChecked` reports whether the cell value represents "checked". A
 * fully-default boolean checkbox (neither custom value set) matches TRUE/FALSE
 * case-insensitively — values arriving via xlsx import / REST API / external
 * paste can be lowercase and bypass `setData` normalization, and the formula
 * engine and input parser already treat TRUE/FALSE case-insensitively. As soon
 * as *either* custom value is set the rule is exact-match (Google Sheets
 * parity) — case-folding a custom `uncheckedValue` like `"true"` would
 * otherwise invert the state. The canonical `TRUE`/`FALSE` are compared without
 * allocating (this runs per visible checkbox per repaint); only a non-canonical
 * lowercase value hits the `toUpperCase` fallback.
 */
export function isCheckboxChecked(
  rule: DataValidationRule,
  value: string | undefined,
): boolean {
  if (value === undefined) return false;
  if (rule.checkedValue === undefined && rule.uncheckedValue === undefined) {
    if (value === CHECKBOX_TRUE) return true;
    if (value === CHECKBOX_FALSE) return false;
    return value.toUpperCase() === CHECKBOX_TRUE;
  }
  return value === checkedValueOf(rule);
}

/**
 * `toggleCheckboxValue` returns the value to write when the box is toggled.
 */
export function toggleCheckboxValue(
  rule: DataValidationRule,
  value: string | undefined,
): string {
  return isCheckboxChecked(rule, value)
    ? uncheckedValueOf(rule)
    : checkedValueOf(rule);
}

/**
 * `listOptionsOf` returns the normalized option list for a list rule.
 */
export function listOptionsOf(rule: DataValidationRule): string[] {
  return normalizeListOptions(rule.list);
}

/**
 * `isValidListValue` reports whether a cell value is permitted by a list rule.
 * Empty/cleared values are always allowed (Google Sheets parity — a rule never
 * blocks deleting a cell); a non-empty value must match one of the options,
 * comparing both sides trimmed so a stray typed space still matches. Compares
 * against `rule.list` directly (canonical after `normalizeDataValidationRule`)
 * without allocating, since this runs per visible cell per repaint.
 */
export function isValidListValue(
  rule: DataValidationRule,
  value: string | undefined,
): boolean {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '') {
    return true;
  }
  const options = rule.list;
  if (!options) {
    return false;
  }
  return options.some((option) => option.trim() === trimmed);
}

/**
 * `isValidDateValue` reports whether a cell value satisfies a date rule. An
 * empty value is always allowed. The value and each operand are normalized to
 * an ISO `yyyy-mm-dd` string (which sorts chronologically) via the shared
 * input parser; a non-date value fails. When any required operand is still
 * blank (an unfilled slot), only "is a valid date" is enforced, so the rule
 * degrades safely rather than mis-flagging. A reversed `between`/`not between`
 * range (start > end) is swapped, matching Google Sheets.
 */
export function isValidDateValue(
  rule: DataValidationRule,
  value: string | undefined,
): boolean {
  if (value === undefined || value.trim() === '') return true;
  const iso = toIsoDateOperand(value);
  if (iso === undefined) return false;

  const op = rule.operator ?? 'dateValid';
  const need = dateValidationOperandCount(op);
  if (op === 'dateValid') return true;
  const operands = rule.values ?? [];
  // Any missing/blank required operand → validate "is a date" only.
  for (let i = 0; i < need; i++) {
    if (!operands[i]) return true;
  }

  const a = operands[0];
  switch (op) {
    case 'dateEquals':
      return iso === a;
    case 'dateBefore':
      return iso < a;
    case 'dateOnOrBefore':
      return iso <= a;
    case 'dateAfter':
      return iso > a;
    case 'dateOnOrAfter':
      return iso >= a;
    case 'dateBetween': {
      const lo = a <= operands[1] ? a : operands[1];
      const hi = a <= operands[1] ? operands[1] : a;
      return iso >= lo && iso <= hi;
    }
    case 'dateNotBetween': {
      const lo = a <= operands[1] ? a : operands[1];
      const hi = a <= operands[1] ? operands[1] : a;
      return iso < lo || iso > hi;
    }
    default:
      return true;
  }
}

/**
 * `describeDateRule` returns a short human phrase for a date rule's condition
 * (e.g. "must be after 2026-01-01", "must be between 2026-01-01 and
 * 2026-01-31"), so error messages can name the constraint instead of calling a
 * valid-but-out-of-range date "invalid". Falls back to "must be a valid date"
 * for `dateValid` or a rule whose operands are not yet fully filled. A reversed
 * between range is presented low→high to match how it is validated.
 */
export function describeDateRule(rule: DataValidationRule): string {
  const op = rule.operator ?? 'dateValid';
  const need = dateValidationOperandCount(op);
  const operands = rule.values ?? [];
  const complete =
    op === 'dateValid' || operands.slice(0, need).every((o) => !!o);
  if (!complete) return 'must be a valid date';
  const a = operands[0];
  const b = operands[1];
  const lo = a <= b ? a : b;
  const hi = a <= b ? b : a;
  switch (op) {
    case 'dateEquals':
      return `must be ${a}`;
    case 'dateBefore':
      return `must be before ${a}`;
    case 'dateOnOrBefore':
      return `must be on or before ${a}`;
    case 'dateAfter':
      return `must be after ${a}`;
    case 'dateOnOrAfter':
      return `must be on or after ${a}`;
    case 'dateBetween':
      return `must be between ${lo} and ${hi}`;
    case 'dateNotBetween':
      return `must not be between ${lo} and ${hi}`;
    default:
      return 'must be a valid date';
  }
}

/**
 * `isValidNumberValue` reports whether a cell value satisfies a number rule. An
 * empty value is always allowed; a non-number value always fails (even under
 * `numberValid`). When a required operand is still blank, only "is a number" is
 * enforced (degrade). A reversed `between`/`not between` range is swapped.
 */
export function isValidNumberValue(
  rule: DataValidationRule,
  value: string | undefined,
): boolean {
  if (value === undefined || value.trim() === '') return true;
  const n = parseNumberOperand(value);
  if (n === undefined) return false;

  const op = rule.operator ?? 'numberValid';
  if (op === 'numberValid') return true;
  const need = validationOperandCount(op);
  const operands = rule.values ?? [];
  for (let i = 0; i < need; i++) {
    if (!operands[i]) return true; // incomplete → "is a number" only
  }
  const a = parseNumberOperand(operands[0]);
  const b = parseNumberOperand(operands[1]);
  if (a === undefined) return true;
  switch (op) {
    case 'numberEquals':
      return n === a;
    case 'numberNotEquals':
      return n !== a;
    case 'numberGreater':
      return n > a;
    case 'numberGreaterEq':
      return n >= a;
    case 'numberLess':
      return n < a;
    case 'numberLessEq':
      return n <= a;
    case 'numberBetween': {
      if (b === undefined) return true;
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      return n >= lo && n <= hi;
    }
    case 'numberNotBetween': {
      if (b === undefined) return true;
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      return n < lo || n > hi;
    }
    default:
      return true;
  }
}

/**
 * `isValidTextValue` reports whether a cell value satisfies a text rule. An
 * empty value is always allowed. `contains`/`not contains` are case-insensitive
 * (Google Sheets parity); `is exactly` is a trimmed exact match; email/url use
 * a light structural check. A blank operand degrades to "always valid".
 */
export function isValidTextValue(
  rule: DataValidationRule,
  value: string | undefined,
): boolean {
  const text = value?.trim() ?? '';
  if (text === '') return true;
  const op = rule.operator ?? 'textContains';
  if (op === 'textIsEmail') return EMAIL_RE.test(text);
  if (op === 'textIsUrl') return isLikelyUrl(text);
  const operand = (rule.values ?? [])[0];
  if (!operand) return true; // incomplete → always valid
  switch (op) {
    case 'textContains':
      return text.toLowerCase().includes(operand.toLowerCase());
    case 'textNotContains':
      return !text.toLowerCase().includes(operand.toLowerCase());
    case 'textEquals':
      return text === operand;
    default:
      return true;
  }
}

/**
 * `isLikelyUrl` accepts an http(s) URL that the platform `URL` parser resolves
 * with a dotted host — a light structural check, not full RFC validation.
 */
function isLikelyUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (
      (u.protocol === 'http:' || u.protocol === 'https:') &&
      u.hostname.includes('.')
    );
  } catch {
    return false;
  }
}

/**
 * `describeNumberRule` / `describeTextRule` return a short human phrase for a
 * rule's condition, so a reject message can name the constraint. Both fall back
 * to a generic phrase for the `*Valid` predicate or an incomplete operand set.
 */
export function describeNumberRule(rule: DataValidationRule): string {
  const op = rule.operator ?? 'numberValid';
  const need = validationOperandCount(op);
  const operands = rule.values ?? [];
  // Incomplete (fewer than `need` non-blank operands) → generic phrase. Check by
  // index: `[].slice(0, need).every()` is vacuously true for a missing array.
  let filled = true;
  for (let i = 0; i < need; i++) if (!operands[i]) filled = false;
  if (op !== 'numberValid' && !filled) {
    return 'must be a number';
  }
  const a = parseNumberOperand(operands[0]);
  const b = parseNumberOperand(operands[1]);
  const lo = a !== undefined && b !== undefined ? Math.min(a, b) : a;
  const hi = a !== undefined && b !== undefined ? Math.max(a, b) : b;
  switch (op) {
    case 'numberEquals':
      return `must equal ${a}`;
    case 'numberNotEquals':
      return `must not equal ${a}`;
    case 'numberGreater':
      return `must be greater than ${a}`;
    case 'numberGreaterEq':
      return `must be greater than or equal to ${a}`;
    case 'numberLess':
      return `must be less than ${a}`;
    case 'numberLessEq':
      return `must be less than or equal to ${a}`;
    case 'numberBetween':
      return `must be between ${lo} and ${hi}`;
    case 'numberNotBetween':
      return `must not be between ${lo} and ${hi}`;
    default:
      return 'must be a number';
  }
}

export function describeTextRule(rule: DataValidationRule): string {
  const op = rule.operator ?? 'textContains';
  const operand = (rule.values ?? [])[0];
  if (op === 'textIsEmail') return 'must be a valid email';
  if (op === 'textIsUrl') return 'must be a valid URL';
  if (!operand) return 'is not valid';
  switch (op) {
    case 'textContains':
      return `must contain "${operand}"`;
    case 'textNotContains':
      return `must not contain "${operand}"`;
    case 'textEquals':
      return `must be exactly "${operand}"`;
    default:
      return 'is not valid';
  }
}

/**
 * `isValidValueForRule` dispatches value validation by rule kind. A checkbox
 * rule never rejects a typed value; list/date/number/text delegate.
 */
export function isValidValueForRule(
  rule: DataValidationRule,
  value: string | undefined,
): boolean {
  if (rule.kind === 'list') return isValidListValue(rule, value);
  if (rule.kind === 'date') return isValidDateValue(rule, value);
  if (rule.kind === 'number') return isValidNumberValue(rule, value);
  if (rule.kind === 'text') return isValidTextValue(rule, value);
  return true;
}

/**
 * `shiftDataValidationRules` remaps rules after row/column insert or delete.
 */
export function shiftDataValidationRules(
  rules: DataValidationRule[],
  axis: Axis,
  index: number,
  count: number,
): DataValidationRule[] {
  return shiftRuleRanges(
    rules,
    axis,
    index,
    count,
    normalizeDataValidationRule,
    cloneDataValidationRule,
  );
}

/**
 * `moveDataValidationRules` remaps rules after a row/column move.
 */
export function moveDataValidationRules(
  rules: DataValidationRule[],
  axis: Axis,
  src: number,
  count: number,
  dst: number,
): DataValidationRule[] {
  return moveRuleRanges(
    rules,
    axis,
    src,
    count,
    dst,
    normalizeDataValidationRule,
    cloneDataValidationRule,
  );
}
