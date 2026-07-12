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

const Kinds = new Set<DataValidationKind>(['checkbox', 'list', 'date']);

/**
 * `dateValidationOperandCount` returns how many comparison operands an
 * operator consumes: 0 for `dateValid`, 2 for between/not-between, else 1.
 */
export function dateValidationOperandCount(op: DataValidationOperator): number {
  if (op === 'dateValid') return 0;
  if (op === 'dateBetween' || op === 'dateNotBetween') return 2;
  return 1;
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
  if (cloned.kind === 'date') {
    const op: DataValidationOperator = cloned.operator ?? 'dateValid';
    const need = dateValidationOperandCount(op);
    // Keep a fixed-length slot per operand, storing '' for a missing or
    // unparseable one. This preserves position (a blank lower bound never
    // promotes the upper bound to index 0) AND retains the other operands
    // (clearing one bound of a between-rule must not drop the still-filled
    // one). An empty slot makes the comparison incomplete, so `isValidDateValue`
    // degrades to "is a valid date" until every required operand is filled.
    const slots: string[] = [];
    for (let i = 0; i < need; i++) {
      slots.push(toIsoDateOperand(cloned.values?.[i]) ?? '');
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
 * `checkboxValue` returns the value to write to force a checkbox into the given
 * checked/unchecked state (used by range-uniform Space toggling).
 */
export function checkboxValue(
  rule: DataValidationRule,
  checked: boolean,
): string {
  return checked ? checkedValueOf(rule) : uncheckedValueOf(rule);
}

/**
 * `toggleCheckboxValue` returns the value to write when the box is toggled.
 */
export function toggleCheckboxValue(
  rule: DataValidationRule,
  value: string | undefined,
): string {
  return checkboxValue(rule, !isCheckboxChecked(rule, value));
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
 * `isValidValueForRule` dispatches value validation by rule kind. A checkbox
 * rule never rejects a typed value; list and date delegate to their checks.
 */
export function isValidValueForRule(
  rule: DataValidationRule,
  value: string | undefined,
): boolean {
  if (rule.kind === 'list') return isValidListValue(rule, value);
  if (rule.kind === 'date') return isValidDateValue(rule, value);
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
