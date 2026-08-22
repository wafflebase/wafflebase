import { describe, it, expect } from 'vitest';
import {
  parseCsv,
  toColumnLabel,
  parseStartRef,
  buildCellMap,
  buildCellMapFromTable,
  isCellTable,
} from '../src/util/csv-parse.js';

describe('parseCsv', () => {
  it('parses simple CSV', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('handles quoted fields with commas', () => {
    expect(parseCsv('"hello, world",b\n1,2')).toEqual([
      ['hello, world', 'b'],
      ['1', '2'],
    ]);
  });

  it('handles escaped quotes', () => {
    expect(parseCsv('"say ""hi""",b')).toEqual([['say "hi"', 'b']]);
  });

  it('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('skips trailing empty row', () => {
    expect(parseCsv('a,b\n')).toEqual([['a', 'b']]);
  });
});

describe('toColumnLabel', () => {
  it('converts 1 to A', () => {
    expect(toColumnLabel(1)).toBe('A');
  });

  it('converts 26 to Z', () => {
    expect(toColumnLabel(26)).toBe('Z');
  });

  it('converts 27 to AA', () => {
    expect(toColumnLabel(27)).toBe('AA');
  });

  it('converts 52 to AZ', () => {
    expect(toColumnLabel(52)).toBe('AZ');
  });
});

describe('parseStartRef', () => {
  it('parses A1', () => {
    expect(parseStartRef('A1')).toEqual({ row: 1, col: 1 });
  });

  it('parses C5', () => {
    expect(parseStartRef('C5')).toEqual({ row: 5, col: 3 });
  });

  it('parses AA10', () => {
    expect(parseStartRef('AA10')).toEqual({ row: 10, col: 27 });
  });

  it('returns default for invalid ref', () => {
    expect(parseStartRef('???')).toEqual({ row: 1, col: 1 });
  });
});

describe('buildCellMap', () => {
  it('builds cell references from data', () => {
    const data = [
      ['Name', 'Score'],
      ['Alice', '95'],
    ];
    const cells = buildCellMap(data, 1, 1);
    expect(cells).toEqual({
      A1: { value: 'Name' },
      B1: { value: 'Score' },
      A2: { value: 'Alice' },
      B2: { value: '95' },
    });
  });

  it('applies start offset', () => {
    const data = [['Hello']];
    const cells = buildCellMap(data, 3, 2);
    expect(cells).toEqual({ B3: { value: 'Hello' } });
  });

  it('skips empty cells', () => {
    const data = [['a', '', 'c']];
    const cells = buildCellMap(data, 1, 1);
    expect(cells).toEqual({
      A1: { value: 'a' },
      C1: { value: 'c' },
    });
  });

  /**
   * The batch API stores `f` and `v` in different fields, so a formula
   * sent as `value` lands as literal text and is never evaluated —
   * which is what `sheets export --raw` exists to avoid.
   */
  it('sends =-leading text as a formula, not a value', () => {
    const cells = buildCellMap([['=SUM(B2:B100)', "'=SUM(B2:B100)"]], 1, 1);
    expect(cells).toEqual({
      A1: { formula: '=SUM(B2:B100)' },
      // The export guard's `'` prefix is one-way on purpose: it stays text.
      B1: { value: "'=SUM(B2:B100)" },
    });
  });
});

describe('isCellTable', () => {
  it('recognizes the header sheets export writes', () => {
    expect(isCellTable([['ref', 'value', 'formula', 'style']])).toBe(true);
    expect(isCellTable([['ref', 'value', 'formula']])).toBe(true);
    expect(isCellTable([['Ref', ' VALUE ', 'Formula']])).toBe(true);
  });

  it('leaves an ordinary grid alone', () => {
    expect(isCellTable([['Name', 'Score']])).toBe(false);
    expect(isCellTable([['ref', 'formula', 'value']])).toBe(false);
    expect(isCellTable([])).toBe(false);
  });
});

describe('buildCellMapFromTable', () => {
  /**
   * `sheets export --raw` then `sheets import` has to be an identity for
   * formulas. Before the table was recognized this CSV imported as a
   * 4-column grid whose A1 was the word "ref".
   */
  it('round-trips an exported sheet by reference', () => {
    const exported = parseCsv(
      [
        'ref,value,formula,style',
        'A1,Total,,',
        'B1,4950,=SUM(B2:B100),',
        'C1,,,',
      ].join('\n'),
    );

    expect(isCellTable(exported)).toBe(true);
    expect(buildCellMapFromTable(exported)).toEqual({
      A1: { value: 'Total' },
      // Only the formula is re-sent — the exported 4950 is a stale
      // computed answer the server recomputes.
      B1: { formula: '=SUM(B2:B100)' },
    });
  });

  it('ignores rows without a usable reference', () => {
    const rows = [
      ['ref', 'value', 'formula'],
      ['', 'orphan', ''],
      ['not-a-ref', 'junk', ''],
      ['b2', 'kept', ''],
    ];
    expect(buildCellMapFromTable(rows)).toEqual({ B2: { value: 'kept' } });
  });
});
