import { describe, expect, it } from 'vitest';
import {
  matchesConditionalFormatRule,
  resolveConditionalFormatStyleAt,
} from '../../src/model/conditional-format';
import { ConditionalFormatRule } from '../../src/model/types';

describe('ConditionalFormat', () => {
  it('matches text contains case-insensitively', () => {
    const rule: ConditionalFormatRule = {
      id: 'rule-1',
      range: [
        { r: 1, c: 1 },
        { r: 10, c: 10 },
      ],
      op: 'textContains',
      value: 'todo',
      style: { b: true },
    };

    expect(matchesConditionalFormatRule('TODO item', rule)).toBe(true);
    expect(matchesConditionalFormatRule('done', rule)).toBe(false);
  });

  it('matches greater than and between with numeric text', () => {
    const greaterThan: ConditionalFormatRule = {
      id: 'rule-1',
      range: [
        { r: 1, c: 1 },
        { r: 10, c: 10 },
      ],
      op: 'greaterThan',
      value: '1000',
      style: { tc: '#ff0000' },
    };
    const between: ConditionalFormatRule = {
      id: 'rule-2',
      range: [
        { r: 1, c: 1 },
        { r: 10, c: 10 },
      ],
      op: 'between',
      value: '5',
      value2: '10',
      style: { bg: '#fff59d' },
    };

    expect(matchesConditionalFormatRule('1,234', greaterThan)).toBe(true);
    expect(matchesConditionalFormatRule('999', greaterThan)).toBe(false);
    expect(matchesConditionalFormatRule('7', between)).toBe(true);
    expect(matchesConditionalFormatRule('12', between)).toBe(false);
  });

  it('matches date before/after', () => {
    const before: ConditionalFormatRule = {
      id: 'rule-1',
      range: [
        { r: 1, c: 1 },
        { r: 10, c: 10 },
      ],
      op: 'dateBefore',
      value: '2026-02-20',
      style: { bg: '#ffcdd2' },
    };
    const after: ConditionalFormatRule = {
      id: 'rule-2',
      range: [
        { r: 1, c: 1 },
        { r: 10, c: 10 },
      ],
      op: 'dateAfter',
      value: '2026-02-20',
      style: { bg: '#c8e6c9' },
    };

    expect(matchesConditionalFormatRule('2026-02-19', before)).toBe(true);
    expect(matchesConditionalFormatRule('2026-02-22', before)).toBe(false);
    expect(matchesConditionalFormatRule('2026-02-22', after)).toBe(true);
    expect(matchesConditionalFormatRule('2026-02-19', after)).toBe(false);
  });

  it('resolves style by applying later matching rules last', () => {
    const rules: ConditionalFormatRule[] = [
      {
        id: 'rule-1',
        range: [
          { r: 1, c: 1 },
          { r: 10, c: 10 },
        ],
        op: 'isNotEmpty',
        style: { tc: '#ff0000', bg: '#fff59d' },
      },
      {
        id: 'rule-2',
        range: [
          { r: 1, c: 1 },
          { r: 10, c: 10 },
        ],
        op: 'textContains',
        value: 'urgent',
        style: { tc: '#0000ff', b: true },
      },
    ];

    const style = resolveConditionalFormatStyleAt(rules, 1, 1, {
      v: 'urgent task',
    });
    expect(style).toEqual({
      tc: '#0000ff',
      bg: '#fff59d',
      b: true,
    });
  });
});
