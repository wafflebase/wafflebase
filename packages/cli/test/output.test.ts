import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatJson } from '../src/output/json.js';
import { formatTable } from '../src/output/table.js';
import { formatCsv } from '../src/output/csv.js';
import {
  format,
  outputError,
  parseOutputFormat,
  InvalidFormatError,
} from '../src/output/formatter.js';
import { InvalidDocxError } from '../src/docs/docx-import.js';

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

  it('formats a single object as a key/value table', () => {
    const result = formatTable({ loggedIn: true, user: 'hackerwins' });
    const lines = result.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^loggedIn\s+true$/);
    expect(lines[1]).toMatch(/^user\s+hackerwins$/);
  });

  it('returns no results for an object with no fields', () => {
    expect(formatTable({})).toBe('(no results)');
  });

  it('returns no results for scalars', () => {
    expect(formatTable('nope')).toBe('(no results)');
    expect(formatTable(null)).toBe('(no results)');
  });
});

describe('parseOutputFormat', () => {
  it('accepts the supported formats', () => {
    expect(parseOutputFormat('json')).toBe('json');
    expect(parseOutputFormat('table')).toBe('table');
    expect(parseOutputFormat('csv')).toBe('csv');
  });

  it('rejects an unsupported format with a structured code', () => {
    expect(() => parseOutputFormat('bogus')).toThrow(InvalidFormatError);
    try {
      parseOutputFormat('bogus');
    } catch (e) {
      expect((e as InvalidFormatError).code).toBe('INVALID_FORMAT');
      expect((e as Error).message).toContain('json, table, csv');
    }
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

  // Every value here is server-supplied and settable by another
  // workspace member, so a formula prefix must land as text rather than
  // execute when the export is opened in a spreadsheet app.
  it('neutralizes spreadsheet formula prefixes', () => {
    const data = [
      { v: '=HYPERLINK("http://evil","click")' },
      { v: '+1+1' },
      { v: '-1+1' },
      { v: '@SUM(A1)' },
      { v: '\t=cmd' },
      { v: '\r=cmd' },
    ];
    const lines = formatCsv(data).split('\n');
    expect(lines[1]).toBe('"\'=HYPERLINK(""http://evil"",""click"")"');
    expect(lines[2]).toBe("'+1+1");
    expect(lines[3]).toBe("'-1+1");
    expect(lines[4]).toBe("'@SUM(A1)");
    expect(lines[5]).toBe("'\t=cmd");
    expect(lines[6]).toBe("'\r=cmd");
  });

  it('neutralizes a formula in a header key too', () => {
    expect(formatCsv([{ '=evil()': 1 }]).split('\n')[0]).toBe("'=evil()");
  });

  it('leaves plain signed numbers untouched', () => {
    const data = [{ v: -3 }, { v: '+1.5' }, { v: '-2e10' }, { v: '.5' }];
    const lines = formatCsv(data).split('\n');
    expect(lines.slice(1)).toEqual(['-3', '+1.5', '-2e10', '.5']);
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

  it('throws instead of printing "undefined" for an unknown format', () => {
    expect(() =>
      format(data, 'bogus' as unknown as 'json'),
    ).toThrow(InvalidFormatError);
  });
});

describe('outputError', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    stderrSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {
        /* swallow */
      });
    process.exitCode = 0;
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    process.exitCode = originalExitCode;
  });

  function getEmittedBody(): { error: { code: string; message: string } } {
    expect(stderrSpy).toHaveBeenCalledOnce();
    const raw = String(stderrSpy.mock.calls[0]?.[0]);
    return JSON.parse(raw) as { error: { code: string; message: string } };
  }

  it('defaults to code:"ERROR" for plain Error instances', () => {
    outputError(new Error('boom'), false);
    expect(getEmittedBody().error.code).toBe('ERROR');
    expect(process.exitCode).toBe(1);
  });

  it('preserves a structured `code` field on Error subclasses', () => {
    outputError(new InvalidDocxError('bad zip'), false);
    const body = getEmittedBody();
    expect(body.error.code).toBe('INVALID_DOCX');
    expect(body.error.message).toBe('bad zip');
    expect(process.exitCode).toBe(1);
  });

  it('falls back to "ERROR" when the code field is non-string', () => {
    class NumericCodeError extends Error {
      readonly code = 42;
    }
    outputError(new NumericCodeError('numeric'), false);
    expect(getEmittedBody().error.code).toBe('ERROR');
  });

  it('honors quiet by exiting 1 without emitting stderr', () => {
    outputError(new InvalidDocxError('bad zip'), true);
    expect(stderrSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
