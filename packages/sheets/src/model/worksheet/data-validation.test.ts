import { describe, it, expect } from 'vitest';
import {
  normalizeDataValidationRule,
  cloneDataValidationRule,
  resolveDataValidationAt,
  isCheckboxChecked,
  toggleCheckboxValue,
  CHECKBOX_TRUE,
  CHECKBOX_FALSE,
} from './data-validation';
import { DataValidationRule } from '../core/types';

const checkboxRule = (id: string): DataValidationRule => ({
  id,
  kind: 'checkbox',
  ranges: [
    [
      { r: 1, c: 1 },
      { r: 2, c: 2 },
    ],
  ],
});

describe('data-validation model', () => {
  it('normalizes a valid checkbox rule and drops an invalid one', () => {
    expect(normalizeDataValidationRule(checkboxRule('a'))).not.toBeNull();
    expect(
      normalizeDataValidationRule({
        id: '',
        kind: 'checkbox',
        ranges: [],
      } as DataValidationRule),
    ).toBeNull();
  });

  it('clones deeply (mutating the clone does not touch the source)', () => {
    const src = checkboxRule('a');
    const copy = cloneDataValidationRule(src);
    copy.ranges[0][0].r = 99;
    expect(src.ranges[0][0].r).toBe(1);
  });

  it('resolves the last matching rule for a point', () => {
    const r1 = checkboxRule('first');
    const r2 = checkboxRule('second');
    expect(resolveDataValidationAt({ r: 1, c: 1 }, [r1, r2])?.id).toBe('second');
    expect(resolveDataValidationAt({ r: 9, c: 9 }, [r1, r2])).toBeUndefined();
  });

  it('reads and toggles checkbox values', () => {
    const rule = checkboxRule('a');
    expect(isCheckboxChecked(rule, CHECKBOX_TRUE)).toBe(true);
    expect(isCheckboxChecked(rule, undefined)).toBe(false);
    expect(isCheckboxChecked(rule, 'FALSE')).toBe(false);
    expect(toggleCheckboxValue(rule, CHECKBOX_FALSE)).toBe(CHECKBOX_TRUE);
    expect(toggleCheckboxValue(rule, CHECKBOX_TRUE)).toBe(CHECKBOX_FALSE);
    expect(toggleCheckboxValue(rule, undefined)).toBe(CHECKBOX_TRUE);
  });
});
