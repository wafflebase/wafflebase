import { describe, it, expect } from 'vitest';
import {
  normalizeDataValidationRule,
  cloneDataValidationRule,
  resolveDataValidationAt,
  isCheckboxChecked,
  checkboxValue,
  toggleCheckboxValue,
  listOptionsOf,
  isValidListValue,
  isValidDateValue,
  isValidNumberValue,
  isValidTextValue,
  isValidValueForRule,
  validationOperandCount,
  describeNumberRule,
  shiftDataValidationRules,
  moveDataValidationRules,
  CHECKBOX_TRUE,
  CHECKBOX_FALSE,
} from './data-validation';
import { DataValidationOperator, DataValidationRule } from '../core/types';

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

const listRule = (id: string, options: string[]): DataValidationRule => ({
  id,
  kind: 'list',
  ranges: [
    [
      { r: 1, c: 1 },
      { r: 2, c: 2 },
    ],
  ],
  list: options,
});

const dateRule = (
  id: string,
  patch: Partial<DataValidationRule> = {},
): DataValidationRule => ({
  id,
  kind: 'date',
  ranges: [
    [
      { r: 1, c: 1 },
      { r: 2, c: 2 },
    ],
  ],
  ...patch,
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

  it('forces a checkbox to a target state via checkboxValue', () => {
    const rule = checkboxRule('a');
    expect(checkboxValue(rule, true)).toBe(CHECKBOX_TRUE);
    expect(checkboxValue(rule, false)).toBe(CHECKBOX_FALSE);
    const custom: DataValidationRule = {
      ...checkboxRule('b'),
      checkedValue: 'Yes',
      uncheckedValue: 'No',
    };
    expect(checkboxValue(custom, true)).toBe('Yes');
    expect(checkboxValue(custom, false)).toBe('No');
  });

  it('matches default boolean checkbox values case-insensitively', () => {
    // A default checkbox has no custom checkedValue. Values arriving via xlsx
    // import / REST API / external paste can be lowercase and bypass setData
    // normalization; they must still render checked (formula engine + input
    // parser already treat TRUE/FALSE case-insensitively).
    const rule = checkboxRule('a');
    expect(isCheckboxChecked(rule, 'true')).toBe(true);
    expect(isCheckboxChecked(rule, 'True')).toBe(true);
    expect(isCheckboxChecked(rule, 'TRUE')).toBe(true);
    expect(isCheckboxChecked(rule, 'false')).toBe(false);
    // A lowercase checked value toggles to the canonical unchecked value.
    expect(toggleCheckboxValue(rule, 'true')).toBe(CHECKBOX_FALSE);
  });

  it('matches a custom checked value exactly (case-sensitive)', () => {
    const rule: DataValidationRule = {
      ...checkboxRule('a'),
      checkedValue: 'Yes',
      uncheckedValue: 'No',
    };
    expect(isCheckboxChecked(rule, 'Yes')).toBe(true);
    expect(isCheckboxChecked(rule, 'yes')).toBe(false);
    expect(isCheckboxChecked(rule, 'YES')).toBe(false);
  });

  it('does not case-fold when only a custom uncheckedValue is set', () => {
    // Default checkedValue ('TRUE') but a custom uncheckedValue that upper-cases
    // to 'TRUE' must NOT be misread as checked — case-folding only applies to a
    // fully-default boolean checkbox (both custom values absent).
    const rule: DataValidationRule = {
      ...checkboxRule('a'),
      uncheckedValue: 'true',
    };
    expect(isCheckboxChecked(rule, 'true')).toBe(false); // the unchecked value
    expect(isCheckboxChecked(rule, 'TRUE')).toBe(true); // the checked value
  });

  it('normalizes a list rule: trims, drops empties, dedupes, defaults arrow', () => {
    const normalized = normalizeDataValidationRule(
      listRule('a', ['  Red ', 'Green', 'Red', '', '  ']),
    );
    expect(normalized).not.toBeNull();
    expect(normalized!.list).toEqual(['Red', 'Green']);
    expect(normalized!.showArrow).toBe(true); // default when undefined
  });

  it('preserves an explicit showArrow=false on a list rule', () => {
    const normalized = normalizeDataValidationRule({
      ...listRule('a', ['Red']),
      showArrow: false,
    });
    expect(normalized!.showArrow).toBe(false);
  });

  it('drops a list rule with no usable options', () => {
    expect(normalizeDataValidationRule(listRule('a', []))).toBeNull();
    expect(normalizeDataValidationRule(listRule('a', ['', '  ']))).toBeNull();
  });

  it('reads list options and validates membership', () => {
    const rule = normalizeDataValidationRule(listRule('a', ['Red', 'Green']))!;
    expect(listOptionsOf(rule)).toEqual(['Red', 'Green']);
    expect(isValidListValue(rule, 'Red')).toBe(true);
    expect(isValidListValue(rule, 'Blue')).toBe(false);
    // Empty / cleared values are always allowed (matches Google Sheets).
    expect(isValidListValue(rule, '')).toBe(true);
    expect(isValidListValue(rule, undefined)).toBe(true);
  });

  it('validates membership tolerant of surrounding whitespace', () => {
    const rule = normalizeDataValidationRule(listRule('a', ['Yes', 'No']))!;
    // A typed value with stray whitespace still matches its trimmed option.
    expect(isValidListValue(rule, 'Yes ')).toBe(true);
    expect(isValidListValue(rule, '  No')).toBe(true);
    expect(isValidListValue(rule, '   ')).toBe(true); // whitespace-only == empty
    expect(isValidListValue(rule, 'Maybe')).toBe(false);
  });

  it('clones a list rule deeply (mutating the clone list does not touch source)', () => {
    const src = listRule('a', ['Red', 'Green']);
    const copy = cloneDataValidationRule(src);
    copy.list!.push('Blue');
    expect(src.list).toEqual(['Red', 'Green']);
  });
});

describe('date rule normalization', () => {
  it('defaults operator to dateValid and onInvalid to warning', () => {
    const out = normalizeDataValidationRule(dateRule('d1'));
    expect(out).not.toBeNull();
    expect(out!.operator).toBe('dateValid');
    expect(out!.onInvalid).toBe('warning');
    expect(out!.values).toBeUndefined();
  });

  it('normalizes operands to ISO and keeps the operator', () => {
    const out = normalizeDataValidationRule(
      dateRule('d2', { operator: 'dateBetween', values: ['2026-01-05', '2026-02-10'] }),
    );
    expect(out!.operator).toBe('dateBetween');
    expect(out!.values).toEqual(['2026-01-05', '2026-02-10']);
  });

  it('drops the values array when no operand is filled', () => {
    const out = normalizeDataValidationRule(
      dateRule('d3', { operator: 'dateAfter', values: ['not-a-date'] }),
    );
    expect(out).not.toBeNull();
    expect(out!.operator).toBe('dateAfter');
    expect(out!.values).toBeUndefined();
  });

  it('deep-copies values via cloneDataValidationRule', () => {
    const rule = dateRule('d4', { operator: 'dateAfter', values: ['2026-01-01'] });
    const clone = cloneDataValidationRule(rule);
    clone.values![0] = 'mutated';
    expect(rule.values![0]).toBe('2026-01-01');
  });

  it('preserves the upper bound when the lower between-operand is blank', () => {
    // A blank lower bound keeps its slot ('') so the still-filled upper bound
    // is neither dropped nor promoted to index 0.
    const out = normalizeDataValidationRule(
      dateRule('d5', { operator: 'dateBetween', values: ['', '2026-02-10'] }),
    );
    expect(out!.operator).toBe('dateBetween');
    expect(out!.values).toEqual(['', '2026-02-10']);
  });

  it('preserves the lower bound when the upper between-operand is blank', () => {
    const out = normalizeDataValidationRule(
      dateRule('d6', { operator: 'dateBetween', values: ['2026-01-05', ''] }),
    );
    expect(out!.operator).toBe('dateBetween');
    expect(out!.values).toEqual(['2026-01-05', '']);
  });

  it('does not drop the other bound when one is later cleared (regression)', () => {
    // Clearing only the start date in the panel must not lose the end date.
    const out = normalizeDataValidationRule(
      dateRule('d5b', { operator: 'dateBetween', values: ['', '2026-01-31'] }),
    );
    expect(out!.values).toEqual(['', '2026-01-31']);
  });

  it('strips a time component from a datetime operand', () => {
    const out = normalizeDataValidationRule(
      dateRule('d7', { operator: 'dateAfter', values: ['2026-01-05 10:30:00'] }),
    );
    expect(out!.values).toEqual(['2026-01-05']);
  });
});

describe('isValidDateValue', () => {
  const v = (op: DataValidationRule['operator'], values?: string[]) =>
    normalizeDataValidationRule(dateRule('x', { operator: op, values }))!;

  it('allows empty values', () => {
    expect(isValidDateValue(v('dateValid'), '')).toBe(true);
    expect(isValidDateValue(v('dateValid'), undefined)).toBe(true);
  });

  it('dateValid accepts any parseable date, rejects non-dates', () => {
    expect(isValidDateValue(v('dateValid'), '2026-03-15')).toBe(true);
    expect(isValidDateValue(v('dateValid'), 'hello')).toBe(false);
  });

  it('compares before / after / on-or-* correctly (inclusive edges)', () => {
    expect(isValidDateValue(v('dateBefore', ['2026-03-15']), '2026-03-14')).toBe(true);
    expect(isValidDateValue(v('dateBefore', ['2026-03-15']), '2026-03-15')).toBe(false);
    expect(isValidDateValue(v('dateOnOrBefore', ['2026-03-15']), '2026-03-15')).toBe(true);
    expect(isValidDateValue(v('dateAfter', ['2026-03-15']), '2026-03-16')).toBe(true);
    expect(isValidDateValue(v('dateOnOrAfter', ['2026-03-15']), '2026-03-15')).toBe(true);
    expect(isValidDateValue(v('dateEquals', ['2026-03-15']), '2026-03-15')).toBe(true);
    expect(isValidDateValue(v('dateEquals', ['2026-03-15']), '2026-03-16')).toBe(false);
  });

  it('between is inclusive; not-between is its negation', () => {
    const b = v('dateBetween', ['2026-01-01', '2026-12-31']);
    expect(isValidDateValue(b, '2026-01-01')).toBe(true);
    expect(isValidDateValue(b, '2026-12-31')).toBe(true);
    expect(isValidDateValue(b, '2027-01-01')).toBe(false);
    const nb = v('dateNotBetween', ['2026-01-01', '2026-12-31']);
    expect(isValidDateValue(nb, '2026-06-01')).toBe(false);
    expect(isValidDateValue(nb, '2027-01-01')).toBe(true);
  });

  it('falls back to date-valid when operands are incomplete', () => {
    // operator kept but operand dropped by normalize → only "is a date" enforced
    const r = v('dateAfter', ['not-a-date']);
    expect(isValidDateValue(r, '2026-03-15')).toBe(true);
    expect(isValidDateValue(r, 'hello')).toBe(false);
  });

  it('degrades to date-valid when a between bound is still blank', () => {
    // Upper bound preserved, lower still blank → only "is a date" enforced.
    const r = v('dateBetween', ['', '2026-02-10']);
    expect(r.values).toEqual(['', '2026-02-10']);
    expect(isValidDateValue(r, '2020-01-01')).toBe(true); // no lower bound to fail
    expect(isValidDateValue(r, 'hello')).toBe(false);
  });

  it('swaps a reversed between range instead of rejecting everything', () => {
    const r = v('dateBetween', ['2020-12-31', '2020-01-01']); // start > end
    expect(isValidDateValue(r, '2020-06-01')).toBe(true); // inside the swapped range
    expect(isValidDateValue(r, '2021-01-01')).toBe(false);
  });

  it('not-between excludes the interior window (both edges excluded)', () => {
    const nb = v('dateNotBetween', ['2026-01-10', '2026-01-20']);
    expect(isValidDateValue(nb, '2026-01-15')).toBe(false); // inside excluded window
    expect(isValidDateValue(nb, '2026-01-05')).toBe(true);
    expect(isValidDateValue(nb, '2026-01-25')).toBe(true);
  });
});

const numberRule = (
  id: string,
  patch: Partial<DataValidationRule> = {},
): DataValidationRule => ({
  id,
  kind: 'number',
  ranges: [
    [
      { r: 1, c: 1 },
      { r: 2, c: 2 },
    ],
  ],
  ...patch,
});

const textRule = (
  id: string,
  patch: Partial<DataValidationRule> = {},
): DataValidationRule => ({
  id,
  kind: 'text',
  ranges: [
    [
      { r: 1, c: 1 },
      { r: 2, c: 2 },
    ],
  ],
  ...patch,
});

describe('validationOperandCount', () => {
  it('returns operand counts across kinds', () => {
    expect(validationOperandCount('numberValid')).toBe(0);
    expect(validationOperandCount('textIsEmail')).toBe(0);
    expect(validationOperandCount('numberGreater')).toBe(1);
    expect(validationOperandCount('textContains')).toBe(1);
    expect(validationOperandCount('numberBetween')).toBe(2);
    expect(validationOperandCount('dateNotBetween')).toBe(2);
  });
});

describe('number rule', () => {
  const n = (op: DataValidationOperator, values?: string[]) =>
    normalizeDataValidationRule(numberRule('n', { operator: op, values }))!;

  it('defaults operator to numberValid and onInvalid to warning', () => {
    const out = normalizeDataValidationRule(numberRule('n'));
    expect(out!.operator).toBe('numberValid');
    expect(out!.onInvalid).toBe('warning');
    expect(out!.values).toBeUndefined();
  });

  it('rejects non-numbers even under numberValid; allows empty', () => {
    const r = n('numberValid');
    expect(isValidNumberValue(r, '42')).toBe(true);
    expect(isValidNumberValue(r, 'abc')).toBe(false);
    expect(isValidNumberValue(r, '')).toBe(true);
    expect(isValidNumberValue(r, undefined)).toBe(true);
  });

  it('applies comparison operators', () => {
    expect(isValidNumberValue(n('numberGreater', ['10']), '11')).toBe(true);
    expect(isValidNumberValue(n('numberGreater', ['10']), '10')).toBe(false);
    expect(isValidNumberValue(n('numberLessEq', ['10']), '10')).toBe(true);
    expect(isValidNumberValue(n('numberEquals', ['3.5']), '3.5')).toBe(true);
    expect(isValidNumberValue(n('numberNotEquals', ['3.5']), '3.5')).toBe(false);
  });

  it('between is inclusive and swaps a reversed range', () => {
    const b = n('numberBetween', ['1', '10']);
    expect(isValidNumberValue(b, '1')).toBe(true);
    expect(isValidNumberValue(b, '10')).toBe(true);
    expect(isValidNumberValue(b, '11')).toBe(false);
    const rev = n('numberBetween', ['10', '1']); // reversed
    expect(isValidNumberValue(rev, '5')).toBe(true);
    const nb = n('numberNotBetween', ['1', '10']);
    expect(isValidNumberValue(nb, '5')).toBe(false);
    expect(isValidNumberValue(nb, '20')).toBe(true);
  });

  it('degrades to "is a number" when an operand is blank', () => {
    const r = n('numberBetween', ['', '10']);
    expect(r.values).toEqual(['', '10']);
    expect(isValidNumberValue(r, '999')).toBe(true); // no lower bound → degrade
    expect(isValidNumberValue(r, 'abc')).toBe(false); // still must be a number
  });

  it('drops non-number operands during normalization', () => {
    const r = n('numberGreater', ['xyz']);
    expect(r.values).toBeUndefined();
    expect(describeNumberRule(r)).toBe('must be a number');
  });
});

describe('text rule', () => {
  const t = (op: DataValidationOperator, values?: string[]) =>
    normalizeDataValidationRule(textRule('t', { operator: op, values }))!;

  it('defaults operator to textContains and onInvalid to warning', () => {
    const out = normalizeDataValidationRule(textRule('t'));
    expect(out!.operator).toBe('textContains');
    expect(out!.onInvalid).toBe('warning');
  });

  it('contains / not-contains are case-insensitive; empty allowed', () => {
    expect(isValidTextValue(t('textContains', ['cat']), 'Category')).toBe(true);
    expect(isValidTextValue(t('textContains', ['dog']), 'Category')).toBe(false);
    expect(isValidTextValue(t('textNotContains', ['dog']), 'Category')).toBe(true);
    expect(isValidTextValue(t('textContains', ['cat']), '')).toBe(true);
  });

  it('is-exactly is a trimmed exact match', () => {
    expect(isValidTextValue(t('textEquals', ['Yes']), 'Yes')).toBe(true);
    expect(isValidTextValue(t('textEquals', ['Yes']), 'yes')).toBe(false);
  });

  it('validates email and url predicates (no operand)', () => {
    const email = t('textIsEmail');
    expect(isValidTextValue(email, 'a@b.com')).toBe(true);
    expect(isValidTextValue(email, 'nope')).toBe(false);
    const url = t('textIsUrl');
    expect(isValidTextValue(url, 'https://example.com/x')).toBe(true);
    expect(isValidTextValue(url, 'not a url')).toBe(false);
  });

  it('degrades to always-valid when the operand is blank', () => {
    const r = t('textContains', ['']);
    expect(r.values).toBeUndefined();
    expect(isValidTextValue(r, 'anything')).toBe(true);
  });
});

describe('isValidValueForRule dispatch', () => {
  it('dispatches by kind', () => {
    expect(isValidValueForRule(listRule('l', ['A']), 'B')).toBe(false);
    expect(isValidValueForRule(dateRule('d', { operator: 'dateValid' }), 'hello')).toBe(false);
    expect(
      isValidValueForRule(numberRule('n', { operator: 'numberValid' }), 'abc'),
    ).toBe(false);
    expect(
      isValidValueForRule(
        normalizeDataValidationRule(
          textRule('t', { operator: 'textContains', values: ['x'] }),
        )!,
        'yz',
      ),
    ).toBe(false);
    expect(isValidValueForRule(checkboxRule('c'), 'anything')).toBe(true);
  });
});

describe('data-validation structural edits', () => {
  const rule = (): DataValidationRule => ({
    id: 'a',
    kind: 'checkbox',
    ranges: [
      [
        { r: 3, c: 1 },
        { r: 5, c: 1 },
      ],
    ],
  });

  it('shifts ranges down when rows are inserted above', () => {
    const [shifted] = shiftDataValidationRules([rule()], 'row', 1, 2);
    expect(shifted.ranges[0][0].r).toBe(5);
    expect(shifted.ranges[0][1].r).toBe(7);
    expect(shifted.kind).toBe('checkbox'); // fields preserved through clone
  });

  it('collapses a fully-deleted range to a single boundary row', () => {
    const result = shiftDataValidationRules([rule()], 'row', 3, -3);
    expect(result).toHaveLength(1);
    expect(result[0].ranges[0][0].r).toBe(3);
    expect(result[0].ranges[0][1].r).toBe(3);
  });

  it('remaps ranges on a row move', () => {
    // Move rows 3-5 with dst 10. `remapIndex` interprets dst against the
    // post-removal indices, so the block lands at rows 7-9 (matching the
    // shared moveRuleRanges / conditional-format behavior).
    const result = moveDataValidationRules([rule()], 'row', 3, 3, 10);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a');
    expect(result[0].ranges[0][0].r).toBe(7);
    expect(result[0].ranges[0][1].r).toBe(9);
  });

  it('does not mutate the source rules', () => {
    const src = [rule()];
    shiftDataValidationRules(src, 'row', 1, 2);
    expect(src[0].ranges[0][0].r).toBe(3); // untouched
  });

  it('shifts a list rule and preserves its options', () => {
    const listRule = (): DataValidationRule => ({
      id: 'l',
      kind: 'list',
      ranges: [
        [
          { r: 3, c: 1 },
          { r: 5, c: 1 },
        ],
      ],
      list: ['Red', 'Green'],
      showArrow: true,
    });
    const [shifted] = shiftDataValidationRules([listRule()], 'row', 1, 2);
    expect(shifted.ranges[0][0].r).toBe(5);
    expect(shifted.kind).toBe('list');
    expect(shifted.list).toEqual(['Red', 'Green']);
    expect(shifted.showArrow).toBe(true);
  });
});
