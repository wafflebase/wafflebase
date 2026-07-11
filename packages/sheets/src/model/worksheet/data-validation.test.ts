import { describe, it, expect } from 'vitest';
import {
  normalizeDataValidationRule,
  cloneDataValidationRule,
  resolveDataValidationAt,
  isCheckboxChecked,
  toggleCheckboxValue,
  listOptionsOf,
  isValidListValue,
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
