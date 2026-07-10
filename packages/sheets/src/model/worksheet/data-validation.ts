import { cloneRange, inRange } from '../core/coordinates';
import { moveRuleRanges, shiftRuleRanges } from './rule-ranges';
import {
  Axis,
  DataValidationKind,
  DataValidationRule,
  Ref,
} from '../core/types';

export const CHECKBOX_TRUE = 'TRUE';
export const CHECKBOX_FALSE = 'FALSE';

const Kinds = new Set<DataValidationKind>(['checkbox', 'list', 'date']);

/**
 * `normalizeDataValidationRule` validates a rule and returns a normalized
 * copy, or null if the rule is unusable (no id, unknown kind, no ranges).
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
  return cloneDataValidationRule(rule);
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
 * `isCheckboxChecked` reports whether the cell value represents "checked".
 */
export function isCheckboxChecked(
  rule: DataValidationRule,
  value: string | undefined,
): boolean {
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
