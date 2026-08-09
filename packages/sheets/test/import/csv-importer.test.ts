import { describe, expect, it } from 'vitest';
import { getWorksheetCell } from '../../src';
import {
  createTableWriter,
  importTable,
  MAX_IMPORT_CELLS,
} from '../../src/import/csv-importer';
import { resolveRangeStyleAt } from '../../src/model/worksheet/range-styles';
import type { Worksheet } from '../../src/model/workbook/worksheet-document';

/** Reads a cell back by 1-indexed position, the way the XLSX tests do. */
const at = (ws: Worksheet, r: number, c: number) => getWorksheetCell(ws, { r, c });

/** `rows` × `cols` of distinct non-empty values. */
const table = (cols: number, rows: number): string[][] =>
  Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => `r${r}c${c}`),
  );

describe('toImportCell — value inference (equivalence partitions)', () => {
  // One representative per class `inferInput` distinguishes. The import path
  // must agree with the paste path, so these assert the same shapes a paste
  // would produce.
  const cellFor = (value: unknown) => at(importTable([[value]]).worksheet, 1, 1);

  it('stores a plain integer as a number', () => {
    expect(cellFor('42')).toEqual({ v: '42' });
  });

  it('normalizes a grouped number, dropping the separators', () => {
    expect(cellFor('1,234')?.v).toBe('1234');
  });

  it('KNOWN LIMITATION: loses precision on integers beyond IEEE-754 range', () => {
    // `inferInput` parses any numeric literal into a JS `number`, so a 20-digit
    // id round-trips through a float and comes back rounded. A CSV of order
    // numbers or account ids hits this.
    //
    // Pinned rather than fixed: `inferInput` is shared with the paste path, so
    // changing it here would make an imported cell disagree with a pasted one —
    // the exact divergence this importer is built to avoid. Fixing it belongs
    // in `inferInput` (fall back to text when the parse does not round-trip),
    // which is its own change with its own blast radius.
    expect(cellFor('12345678901234567890')?.v).toBe('12345678901234567000');
  });

  it('tags an ISO date with the date number format', () => {
    expect(cellFor('2026-08-06')).toEqual({
      v: '2026-08-06',
      s: { nf: 'date' },
    });
  });

  it('tags a percent with the percent number format', () => {
    const cell = cellFor('25%');
    expect(cell?.v).toBe('0.25');
    expect(cell?.s?.nf).toBe('percent');
  });

  it('tags a currency with its ISO code', () => {
    const cell = cellFor('$5.00');
    expect(cell?.v).toBe('5');
    expect(cell?.s).toEqual({ nf: 'currency', cu: 'USD' });
  });

  it('normalizes booleans to upper case', () => {
    expect(cellFor('true')).toEqual({ v: 'TRUE' });
    expect(cellFor('False')).toEqual({ v: 'FALSE' });
  });

  it('keeps ordinary text as text', () => {
    expect(cellFor('hello')).toEqual({ v: 'hello' });
  });

  it('keeps a leading = as literal text, never a formula', () => {
    // Import writes the document directly and never runs the calculator, so a
    // formula cell would have no cached value and render blank.
    const cell = cellFor('=SUM(A1:A2)');
    expect(cell?.v).toBe('=SUM(A1:A2)');
    expect(cell?.f).toBeUndefined();
  });

  it('renders non-string inputs the way a CSV would have spelled them', () => {
    // `importTable` takes `unknown` so an in-process caller can hand over real
    // values; they must land on the same cell a CSV of the same table would.
    expect(cellFor(42)?.v).toBe('42');
    expect(cellFor(true)?.v).toBe('TRUE');
    expect(cellFor(new Date('2026-08-06T00:00:00Z'))).toEqual({
      v: '2026-08-06',
      s: { nf: 'date' },
    });
    expect(cellFor(new Date('2026-08-06T12:30:45Z'))?.v).toBe(
      '2026-08-06 12:30:45',
    );
  });

  it('skips an object whose JSON serialization is undefined', () => {
    // `JSON.stringify` returns `undefined` — not a string — when `toJSON()`
    // does, which its type signature hides. Left unguarded it reached
    // `text.trim()` and threw, taking down the whole import over one odd
    // field; it should be skipped like any other empty one.
    const { worksheet } = importTable([['a', { toJSON: () => undefined }, 'b']]);
    expect(at(worksheet, 1, 2)).toBeUndefined();
    expect(at(worksheet, 1, 3)?.v).toBe('b');
  });

  it('writes no cell for empty or whitespace-only fields', () => {
    // Both would store an empty `v` after trimming — skipping saves a CRDT
    // subtree and renders identically.
    const { worksheet } = importTable([['a', '', '   ', 'b']]);
    expect(at(worksheet, 1, 2)).toBeUndefined();
    expect(at(worksheet, 1, 3)).toBeUndefined();
    expect(at(worksheet, 1, 4)?.v).toBe('b');
  });
});

describe('importTable — layout', () => {
  it('places cells row-major at 1-indexed positions', () => {
    const { worksheet } = importTable([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(at(worksheet, 1, 1)?.v).toBe('a');
    expect(at(worksheet, 1, 2)?.v).toBe('b');
    expect(at(worksheet, 2, 1)?.v).toBe('c');
    expect(at(worksheet, 2, 2)?.v).toBe('d');
  });

  it('counts a blank row inside the table, which holds a grid position', () => {
    const result = importTable([['a'], ['', '  '], ['b']]);
    expect(result.rowCount).toBe(3);
    expect(result.cellCount).toBe(2);
  });

  it('rowCount is the grid extent, not a count of populated rows', () => {
    // Three numbers diverge here and it is worth pinning which one this is:
    // the source has 5 rows, the worksheet spans 5 (blank rows keep their
    // position), and 3 produced cells. `rowCount` is the extent — the
    // truncation message reads off it, and the extent is the only one of the
    // three the user can check against the sheet they end up looking at.
    const result = importTable([['a'], [''], ['b'], [''], ['c']]);
    expect(result.rowCount).toBe(5);
    expect(result.cellCount).toBe(3);
    expect(result.worksheet.rowOrder.length).toBe(5);
  });

  it('excludes trailing blank rows from the extent', () => {
    // The other direction: a trailing blank row must not inflate the number
    // the user is shown, and the extent stops at the last written cell.
    const result = importTable([['a'], ['b'], [''], ['']]);
    expect(result.rowCount).toBe(2);
    expect(result.cellCount).toBe(2);
  });

  it('keeps a blank row in place rather than shifting rows up', () => {
    // A dropped blank row would move every row below it, silently changing
    // which record sits at which position.
    const { worksheet } = importTable([['a'], [''], ['b']]);
    expect(at(worksheet, 1, 1)?.v).toBe('a');
    expect(at(worksheet, 2, 1)).toBeUndefined();
    expect(at(worksheet, 3, 1)?.v).toBe('b');
  });

  it('lets each row write by its own index, so a short row cannot shift a column', () => {
    const { worksheet } = importTable([
      ['a', 'b', 'c'],
      ['d', 'e'],
      ['f', 'g', 'h'],
    ]);
    expect(at(worksheet, 2, 2)?.v).toBe('e');
    expect(at(worksheet, 2, 3)).toBeUndefined();
    expect(at(worksheet, 3, 3)?.v).toBe('h');
  });
});

describe('importTable — header styling', () => {
  it('bolds the header row as a single range patch, not per-cell styles', () => {
    // Every per-cell style patch is its own CRDT subtree; one range patch for
    // the row is what keeps an imported document small.
    const { worksheet } = importTable([
      ['name', 'qty'],
      ['apple', '3'],
    ]);
    expect(worksheet.rangeStyles).toHaveLength(1);
    expect(resolveRangeStyleAt(worksheet.rangeStyles!, 1, 1)).toEqual({
      b: true,
    });
    expect(resolveRangeStyleAt(worksheet.rangeStyles!, 2, 1)).toBeUndefined();
    expect(at(worksheet, 1, 1)?.s).toBeUndefined();
  });

  it('bolds the first row that produced a cell, not row 1', () => {
    // Leading blank rows are kept, so bolding row 1 blindly would leave the
    // real header plain.
    const { worksheet } = importTable([[''], ['name', 'qty'], ['apple', '3']]);
    expect(resolveRangeStyleAt(worksheet.rangeStyles!, 1, 1)).toBeUndefined();
    expect(resolveRangeStyleAt(worksheet.rangeStyles!, 2, 1)).toEqual({
      b: true,
    });
  });

  it('does not bold past the table\'s real width when the header row has empty trailing fields', () => {
    // Regression: the range used to be `row.length` of the header row itself
    // (4 here), which would bold columns 3-4 even though no cell anywhere in
    // the table ever populates them — a later edit into one of those columns
    // would inherit bold unexpectedly. `maxColumn` (the table's actual
    // populated extent) is 2, so the range must stop there.
    const { worksheet } = importTable([
      ['name', 'qty', '', ''],
      ['apple', '3'],
    ]);
    expect(resolveRangeStyleAt(worksheet.rangeStyles!, 1, 2)).toEqual({ b: true });
    expect(resolveRangeStyleAt(worksheet.rangeStyles!, 1, 3)).toBeUndefined();
    expect(resolveRangeStyleAt(worksheet.rangeStyles!, 1, 4)).toBeUndefined();
  });

  it('bolds out to a data row wider than the header row', () => {
    // The opposite mismatch: header narrower than the widest data row. The
    // bold band should match the table's real width, not just the header's
    // own field count.
    const { worksheet } = importTable([
      ['name', 'qty'],
      ['apple', '3', 'extra', 'more'],
    ]);
    expect(resolveRangeStyleAt(worksheet.rangeStyles!, 1, 4)).toEqual({ b: true });
  });

  it('emits no patch at all when the caller says there is no header', () => {
    // The first row is then one of the user's own records; styling it as a
    // heading is a claim about their data that nothing supports.
    const { worksheet } = importTable([['apple', '3']], { hasHeader: false });
    expect(worksheet.rangeStyles).toBeUndefined();
  });
});

describe('cell budget (boundary value analysis)', () => {
  // MAX_IMPORT_CELLS is exact and checked before a row is written, so the
  // interesting inputs are the three around it plus the row that straddles it.
  const COLS = 10;
  const wholeRows = MAX_IMPORT_CELLS / COLS;

  it('imports a table of exactly MAX_IMPORT_CELLS cells untruncated', () => {
    const result = importTable(table(COLS, wholeRows));
    expect(result.truncated).toBe(false);
    expect(result.rowCount).toBe(wholeRows);
  });

  it('imports one cell under the budget untruncated', () => {
    const rows = table(COLS, wholeRows);
    rows[rows.length - 1] = rows[rows.length - 1].slice(0, COLS - 1);
    expect(importTable(rows).truncated).toBe(false);
  });

  it('truncates one row over the budget', () => {
    const result = importTable(table(COLS, wholeRows + 1));
    expect(result.truncated).toBe(true);
    expect(result.rowCount).toBe(wholeRows);
  });

  it('truncates on a row boundary, writing no part of the row that busts it', () => {
    // Half a record cannot be edited and its column count would silently
    // differ from every row above it.
    const result = importTable(table(COLS, wholeRows + 1));
    expect(at(result.worksheet, wholeRows, COLS)).toBeDefined();
    expect(at(result.worksheet, wholeRows + 1, 1)).toBeUndefined();
  });

  it('counts cells, not rows, so a narrow table gets proportionally more rows', () => {
    const narrow = importTable(table(2, MAX_IMPORT_CELLS));
    expect(narrow.rowCount).toBe(MAX_IMPORT_CELLS / 2);
    expect(narrow.truncated).toBe(true);
  });

  it('charges only cells it wrote, so a sparse table gets far more rows', () => {
    // The budget bounds what lands in the document, and an empty field writes
    // nothing. A table that is 90% blank therefore imports ~10x the rows a
    // dense one does, rather than being cut at a row count its shape does not
    // justify.
    const sparse = Array.from({ length: wholeRows + 1 }, () =>
      Array.from({ length: COLS }, (_, c) => (c === 0 ? 'x' : '')),
    );
    const result = importTable(sparse);
    expect(result.truncated).toBe(false);
    expect(result.rowCount).toBe(wholeRows + 1);
  });

  it('spends the whole budget on a sparse table rather than stopping short', () => {
    // Charging blank fields ended the import at 39,991 of 40,000 cells here,
    // because the check read the row's field count while the running total
    // only ever grew by the cells actually written.
    const sparse = Array.from({ length: MAX_IMPORT_CELLS + 1 }, () =>
      Array.from({ length: COLS }, (_, c) => (c === 0 ? 'x' : '')),
    );
    const result = importTable(sparse);
    expect(result.cellCount).toBe(MAX_IMPORT_CELLS);
    expect(result.truncated).toBe(true);
  });

  it('does not let a trailing blank row truncate an exact-budget import', () => {
    // papaparse emits one empty row for the newline that ends essentially
    // every real CSV ("a,b\n1,2\n" yields a third row of ['']). Charging that
    // row's field count made a file of exactly MAX_IMPORT_CELLS report "Only
    // the first N rows were imported" while holding every row it had.
    const rows = table(COLS, wholeRows);
    rows.push(['']);
    const result = importTable(rows);
    expect(result.cellCount).toBe(MAX_IMPORT_CELLS);
    expect(result.rowCount).toBe(wholeRows);
    expect(result.truncated).toBe(false);
  });
});

describe('error paths', () => {
  it('rejects a source with no rows at all', () => {
    expect(() => importTable([])).toThrow(/does not contain any data/);
  });

  it('rejects a source whose fields are all empty', () => {
    // Rows exist but no cell was written — "no data" is the honest message.
    expect(() => importTable([[''], ['  ', '']])).toThrow(
      /does not contain any data/,
    );
  });

  it('rejects a table too wide for a single row to fit the budget', () => {
    // Distinct from "no data": this table cannot be imported at any length.
    // Clamping to one row would ship twice the budget and still be unusable.
    const width = MAX_IMPORT_CELLS + 1;
    expect(() => importTable(table(width, 1))).toThrow(
      new RegExp(`too many columns to import \\(${width}\\)`),
    );
  });
});

describe('TableWriter — streaming contract', () => {
  it('returns true while the budget holds and false once it is exhausted', () => {
    const writer = createTableWriter();
    const row = Array.from({ length: MAX_IMPORT_CELLS }, () => 'x');
    expect(writer.push(row)).toBe(true);
    expect(writer.push(['overflow'])).toBe(false);
  });

  it('writes nothing for the row that returned false', () => {
    const writer = createTableWriter();
    writer.push(Array.from({ length: MAX_IMPORT_CELLS }, () => 'x'));
    writer.push(['overflow']);
    const { worksheet } = writer.finish();
    expect(at(worksheet, 2, 1)).toBeUndefined();
  });

  it('still finishes into a usable table after a rejected row', () => {
    const writer = createTableWriter();
    writer.push(['a', 'b']);
    writer.push(Array.from({ length: MAX_IMPORT_CELLS }, () => 'x'));
    const result = writer.finish();
    expect(result.truncated).toBe(true);
    expect(result.rowCount).toBe(1);
    expect(at(result.worksheet, 1, 1)?.v).toBe('a');
  });

  it('agrees cell-for-cell with importTable on the same input', () => {
    // One budget, two entry points — they must not drift.
    const rows = [
      ['name', 'qty', 'when'],
      ['apple', '3', '2026-08-06'],
      ['', '', ''],
      ['pear', '1,234', '25%'],
    ];
    const writer = createTableWriter();
    for (const row of rows) writer.push(row);
    const streamed = writer.finish();
    const bulk = importTable(rows);

    expect(streamed.rowCount).toBe(bulk.rowCount);
    expect(streamed.truncated).toBe(bulk.truncated);
    expect(streamed.worksheet.rangeStyles).toEqual(bulk.worksheet.rangeStyles);
    for (let r = 1; r <= rows.length; r++) {
      for (let c = 1; c <= 3; c++) {
        expect(at(streamed.worksheet, r, c)).toEqual(at(bulk.worksheet, r, c));
      }
    }
  });

  it('stops early: rows pushed after the budget do not change the result', () => {
    // This is what lets the caller abort the parser — feeding more must be a
    // no-op, not a silent overwrite.
    const writer = createTableWriter();
    writer.push(Array.from({ length: MAX_IMPORT_CELLS }, () => 'x'));
    const before = writer.push(['a']);
    const after = writer.push(['b']);
    expect(before).toBe(false);
    expect(after).toBe(false);
    expect(writer.finish().rowCount).toBe(1);
  });
});
