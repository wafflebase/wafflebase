import { describe, it, expect } from 'vitest';
import { formatJson } from '../src/output/json.js';
import { formatTable } from '../src/output/table.js';
import { formatCsv } from '../src/output/csv.js';
import { format } from '../src/output/formatter.js';

describe('formatJson', () => {
  it('pretty-prints JSON', () => {
    expect(formatJson({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
});

describe('formatTable', () => {
  it('formats array of objects as aligned table', () => {
    const data = [
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob' },
    ];
    const result = formatTable(data);
    const lines = result.split('\n');
    expect(lines).toHaveLength(4); // header + separator + 2 rows
    expect(lines[0]).toContain('id');
    expect(lines[0]).toContain('name');
    expect(lines[2]).toContain('Alice');
    expect(lines[3]).toContain('Bob');
  });

  it('returns no results for empty array', () => {
    expect(formatTable([])).toBe('(no results)');
  });
});

describe('formatCsv', () => {
  it('formats array of objects as CSV', () => {
    const data = [
      { name: 'Alice', score: 95 },
      { name: 'Bob', score: 87 },
    ];
    const result = formatCsv(data);
    const lines = result.split('\n');
    expect(lines[0]).toBe('name,score');
    expect(lines[1]).toBe('Alice,95');
    expect(lines[2]).toBe('Bob,87');
  });

  it('escapes commas and quotes', () => {
    const data = [{ value: 'has, comma' }, { value: 'has "quotes"' }];
    const result = formatCsv(data);
    const lines = result.split('\n');
    expect(lines[1]).toBe('"has, comma"');
    expect(lines[2]).toBe('"has ""quotes"""');
  });

  it('returns empty string for empty array', () => {
    expect(formatCsv([])).toBe('');
  });

  it('formats a single object as one-row CSV', () => {
    const result = formatCsv({ id: '1', title: 'Doc' });
    const lines = result.split('\n');
    expect(lines[0]).toBe('id,title');
    expect(lines[1]).toBe('1,Doc');
  });

  it('serializes nested objects as JSON', () => {
    const data = [{ name: 'a', meta: { x: 1 } }];
    const result = formatCsv(data);
    const lines = result.split('\n');
    // JSON is CSV-escaped: {"x":1} → "{""x"":1}"
    expect(lines[1]).toBe('a,"{""x"":1}"');
  });
});

describe('format dispatcher', () => {
  const data = [{ a: 1 }];

  it('dispatches to json', () => {
    expect(format(data, 'json')).toContain('"a"');
  });

  it('dispatches to table', () => {
    expect(format(data, 'table')).toContain('a');
  });

  it('dispatches to csv', () => {
    expect(format(data, 'csv')).toContain('a\n1');
  });
});
