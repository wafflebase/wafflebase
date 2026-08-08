import { describe, expect, it } from 'vitest';
import { getWorksheetCell } from '../../src';
import { importJsonText } from '../../src/import/json-importer';

describe('importJsonText', () => {
  it('maps object records to a worksheet using first-seen columns', () => {
    const imported = importJsonText(
      JSON.stringify([
        {
          name: 'Alice',
          score: 95,
          active: true,
          meta: { role: 'admin' },
          tags: ['owner'],
        },
        {
          name: 'Bob',
          score: null,
          joined: '2026-07-29',
        },
      ]),
      { sheetName: 'People' },
    );

    expect(imported.name).toBe('People');
    expect(imported.rowCount).toBe(3);
    expect(imported.columnCount).toBe(6);
    expect(imported.cellCount).toBe(13);

    const { worksheet } = imported;
    expect(getWorksheetCell(worksheet, { r: 1, c: 1 })).toEqual({
      v: 'name',
      s: { b: true },
    });
    expect(getWorksheetCell(worksheet, { r: 1, c: 6 })?.v).toBe('joined');
    expect(getWorksheetCell(worksheet, { r: 2, c: 1 })?.v).toBe('Alice');
    expect(getWorksheetCell(worksheet, { r: 2, c: 2 })?.v).toBe('95');
    expect(getWorksheetCell(worksheet, { r: 2, c: 3 })?.v).toBe('TRUE');
    expect(getWorksheetCell(worksheet, { r: 2, c: 4 })?.v).toBe(
      '{"role":"admin"}',
    );
    expect(getWorksheetCell(worksheet, { r: 2, c: 5 })?.v).toBe('["owner"]');
    expect(getWorksheetCell(worksheet, { r: 2, c: 6 })).toBeUndefined();
    expect(getWorksheetCell(worksheet, { r: 3, c: 2 })).toBeUndefined();
    expect(getWorksheetCell(worksheet, { r: 3, c: 6 })).toEqual({
      v: '2026-07-29',
      s: { nf: 'date' },
    });
  });

  it('accepts a single object and applies normal sheet input inference', () => {
    const imported = importJsonText(
      JSON.stringify({
        formula: '=SUM(1, 2)',
        percent: '25%',
        currency: '$1,200',
        padded: '001',
        disabled: false,
      }),
      { sheetName: ' ' },
    );

    expect(imported.name).toBe('Imported JSON');
    expect(getWorksheetCell(imported.worksheet, { r: 2, c: 1 })).toEqual({
      f: '=SUM(1, 2)',
    });
    expect(getWorksheetCell(imported.worksheet, { r: 2, c: 2 })).toEqual({
      v: '0.25',
      s: { nf: 'percent' },
    });
    expect(getWorksheetCell(imported.worksheet, { r: 2, c: 3 })).toEqual({
      v: '1200',
      s: { nf: 'currency', cu: 'USD' },
    });
    expect(getWorksheetCell(imported.worksheet, { r: 2, c: 4 })?.v).toBe(
      '001',
    );
    expect(getWorksheetCell(imported.worksheet, { r: 2, c: 5 })?.v).toBe(
      'FALSE',
    );
  });

  it('leaves empty inferred values as blank cells', () => {
    const imported = importJsonText('{"empty":"","spaces":"  "}', {
      sheetName: 'Empty values',
    });

    expect(imported.cellCount).toBe(2);
    expect(getWorksheetCell(imported.worksheet, { r: 2, c: 1 })).toBeUndefined();
    expect(getWorksheetCell(imported.worksheet, { r: 2, c: 2 })).toBeUndefined();
  });

  it('falls back to NDJSON in auto mode and supports BOM, CRLF, and blank lines', () => {
    const imported = importJsonText(
      '\uFEFF{"first":1}\r\n\r\n{"second":2}\r\n',
      { sheetName: 'Events' },
    );

    expect(imported.rowCount).toBe(3);
    expect(imported.columnCount).toBe(2);
    expect(getWorksheetCell(imported.worksheet, { r: 1, c: 1 })?.v).toBe(
      'first',
    );
    expect(getWorksheetCell(imported.worksheet, { r: 1, c: 2 })?.v).toBe(
      'second',
    );
    expect(getWorksheetCell(imported.worksheet, { r: 2, c: 1 })?.v).toBe('1');
    expect(getWorksheetCell(imported.worksheet, { r: 3, c: 2 })?.v).toBe('2');
  });

  it('reports the source line for malformed and non-object NDJSON records', () => {
    expect(() =>
      importJsonText('{"ok":1}\n\n{broken}', {
        sheetName: 'Events',
        mode: 'ndjson',
      }),
    ).toThrow(/Invalid NDJSON at line 3/);

    expect(() =>
      importJsonText('{"ok":1}\n42', {
        sheetName: 'Events',
        mode: 'ndjson',
      }),
    ).toThrow(/NDJSON line 2 must be a JSON object/);
  });

  it.each([
    ['', /contains no records/],
    ['[]', /contains no records/],
    ['{}', /contains no columns/],
    ['[{},{}]', /contains no columns/],
    ['null', /must be an object or an array of objects/],
    ['[["a"],["b"]]', /record 1 must be an object/],
    ['[1,2]', /record 1 must be an object/],
  ])('rejects unsupported JSON input %#', (text, message) => {
    expect(() => importJsonText(text, { sheetName: 'Invalid' })).toThrow(
      message,
    );
  });
});
