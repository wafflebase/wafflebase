import { describe, it, expect } from 'vitest';
import {
  normalizeDataValidationRule,
  cloneDataValidationRule,
  resolveDataValidationAt,
  isCheckboxChecked,
  toggleCheckboxValue,
  listOptionsOf,
  isValidListValue,
  isValidDateValue,
  isValidValueForRule,
  shiftDataValidationRules,
  moveDataValidationRules,
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

  it('drops un-parseable operands but never drops the rule', () => {
    const out = normalizeDataValidationRule(
      dateRule('d3', { operator: 'dateAfter', values: ['not-a-date'] }),
    );
    expect(out).not.toBeNull();
    expect(out!.operator).toBe('dateAfter');
    expect(out!.values).toEqual([]);
  });

  it('deep-copies values via cloneDataValidationRule', () => {
    const rule = dateRule('d4', { operator: 'dateAfter', values: ['2026-01-01'] });
    const clone = cloneDataValidationRule(rule);
    clone.values![0] = 'mutated';
    expect(rule.values![0]).toBe('2026-01-01');
  });

  it('keeps operand positions when a leading between-operand is blank', () => {
    // A blank lower bound must not promote the upper bound to index 0.
    const out = normalizeDataValidationRule(
      dateRule('d5', { operator: 'dateBetween', values: ['', '2026-02-10'] }),
    );
    expect(out!.operator).toBe('dateBetween');
    expect(out!.values).toEqual([]);
  });

  it('keeps a valid leading between-operand when the upper bound is blank', () => {
    const out = normalizeDataValidationRule(
      dateRule('d6', { operator: 'dateBetween', values: ['2026-01-05', ''] }),
    );
    expect(out!.operator).toBe('dateBetween');
    expect(out!.values).toEqual(['2026-01-05']);
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
});

describe('isValidValueForRule dispatch', () => {
  it('dispatches by kind', () => {
    expect(isValidValueForRule(listRule('l', ['A']), 'B')).toBe(false);
    expect(isValidValueForRule(dateRule('d', { operator: 'dateValid' }), 'hello')).toBe(false);
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
