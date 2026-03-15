import { describe, it, expect } from 'vitest';
import { parseCsv, toColumnLabel, parseStartRef, buildCellMap } from '../src/util/csv-parse.js';

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
});
