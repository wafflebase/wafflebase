import { describe, expect, it } from 'vitest';
import { getWorksheetCell, type Worksheet } from '../../src';
import {
  importCsv,
  importTable,
  MAX_IMPORT_CELLS,
} from '../../src/import/csv-importer';

// Most cases assert on cells, not on the counts that come back alongside the
// worksheet; these keep them reading as they did before the cap was added.
const sheetOf = (text: string): Worksheet => importCsv(text).worksheet;
const tableOf = (
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  options?: { hasHeader?: boolean },
): Worksheet => importTable(rows, options).worksheet;

describe('importCsv', () => {
  it('writes cells from A1 down', () => {
    const ws = sheetOf('a,b,c\nd,e,f\ng,h,i');

    expect(getWorksheetCell(ws, { r: 1, c: 1 })).toEqual({ v: 'a' });
    expect(getWorksheetCell(ws, { r: 1, c: 3 })).toEqual({ v: 'c' });
    expect(getWorksheetCell(ws, { r: 3, c: 1 })).toEqual({ v: 'g' });
    expect(getWorksheetCell(ws, { r: 3, c: 3 })).toEqual({ v: 'i' });
    expect(getWorksheetCell(ws, { r: 4, c: 1 })).toBeUndefined();
  });

  it('detects a tab delimiter, so .tsv needs no parser of its own', () => {
    const ws = sheetOf('a\tb\tc\nd\te\tf');

    expect(getWorksheetCell(ws, { r: 1, c: 3 })).toEqual({ v: 'c' });
    expect(getWorksheetCell(ws, { r: 2, c: 1 })).toEqual({ v: 'd' });
    // A tab-separated row must not collapse into one cell.
    expect(getWorksheetCell(ws, { r: 1, c: 2 })).toEqual({ v: 'b' });
  });

  it('normalizes values and attaches only the inferred number formats', () => {
    const ws = sheetOf('n,d,p\n1234,2026-07-28,50%');

    // A plain integer gets no style: `applyInferredFormat` returns undefined and
    // the right alignment comes from `defaultAlign` at render time.
    expect(getWorksheetCell(ws, { r: 2, c: 1 })).toEqual({ v: '1234' });
    expect(getWorksheetCell(ws, { r: 2, c: 2 })).toEqual({
      v: '2026-07-28',
      s: { nf: 'date' },
    });
    expect(getWorksheetCell(ws, { r: 2, c: 3 })).toEqual({
      v: '0.5',
      s: { nf: 'percent' },
    });
  });

  it('stores a leading = as literal text, never as a formula', () => {
    const ws = sheetOf('a\n=1+1');
    const cell = getWorksheetCell(ws, { r: 2, c: 1 });

    // Import never runs the calculator, so a formula cell would have no cached
    // `v` and render blank. Also guards against storing `inferInput`'s value,
    // which has the `=` stripped.
    expect(cell).toEqual({ v: '=1+1' });
    expect(cell?.f).toBeUndefined();
  });

  it('keeps ragged rows aligned to their own column index', () => {
    const ws = sheetOf('a,b,c\nd\ne,f,g,h');

    expect(getWorksheetCell(ws, { r: 2, c: 1 })).toEqual({ v: 'd' });
    expect(getWorksheetCell(ws, { r: 2, c: 2 })).toBeUndefined();
    expect(getWorksheetCell(ws, { r: 3, c: 1 })).toEqual({ v: 'e' });
    expect(getWorksheetCell(ws, { r: 3, c: 4 })).toEqual({ v: 'h' });
  });

  it('bolds row 1 with a single range patch sized to the first row', () => {
    const ws = sheetOf('a,b,c\nd,e,f');

    expect(ws.rangeStyles).toEqual([
      {
        range: [
          { r: 1, c: 1 },
          { r: 1, c: 3 },
        ],
        style: { b: true },
      },
    ]);
  });

  it('sizes the header range by the header row, not by the widest row', () => {
    const ws = sheetOf('a,b\nc,d,e');

    expect(ws.rangeStyles?.[0].range[1].c).toBe(2);
  });

  it('bolds the first row that has content, skipping a leading empty row', () => {
    // `,,` stays a real row, so row 1 exists but wrote no cells. Bolding it
    // would leave the actual header plain.
    const ws = sheetOf(',,\nname,qty\na,1');

    expect(ws.rangeStyles).toEqual([
      {
        range: [
          { r: 2, c: 1 },
          { r: 2, c: 2 },
        ],
        style: { b: true },
      },
    ]);
  });

  it('parses a single-column file instead of throwing on UndetectableDelimiter', () => {
    const ws = sheetOf('name\nA\nB');

    expect(getWorksheetCell(ws, { r: 1, c: 1 })).toEqual({ v: 'name' });
    expect(getWorksheetCell(ws, { r: 3, c: 1 })).toEqual({ v: 'B' });
  });

  it('skips whitespace-only fields instead of storing an empty value', () => {
    const ws = sheetOf('a,   ,c');

    expect(getWorksheetCell(ws, { r: 1, c: 2 })).toBeUndefined();
    expect(getWorksheetCell(ws, { r: 1, c: 3 })).toEqual({ v: 'c' });
  });

  // Both skip modes drop one of these: `'greedy'` drops the `,,` row, and `true`
  // drops the empty line. Either way `c,d` is pulled up to row 2 and every row
  // below a blank line shifts.
  it.each([
    ['a row of empty fields', 'a,b\n,,\nc,d'],
    ['an empty line', 'a,b\n\nc,d'],
  ])('preserves %s inside the table', (_label, text) => {
    expect(getWorksheetCell(sheetOf(text), { r: 3, c: 1 })).toEqual({
      v: 'c',
    });
  });

  it('throws on an unterminated quoted field instead of importing one giant cell', () => {
    // papaparse consumes the rest of the file into a single field here, so
    // cells *are* written — without the `MissingQuotes` check this would look
    // like a successful import.
    expect(() => sheetOf('name,note\n"a,b\nc,d\ne,f')).toThrow(
      /unterminated quoted field/,
    );
  });

  it('imports a stray quote inside a quoted field', () => {
    // papaparse reports `InvalidQuotes` here but recovers and parses the file
    // correctly, so it must not be treated like `MissingQuotes`.
    const ws = sheetOf('size,price\n"5" x 7",10\nsmall,4');

    expect(getWorksheetCell(ws, { r: 2, c: 1 })).toEqual({ v: '5" x 7' });
    expect(getWorksheetCell(ws, { r: 3, c: 2 })).toEqual({ v: '4' });
  });

  it.each([
    ['an empty file', ''],
    ['a whitespace-only file', '   '],
    ['a file of empty fields', ',,\n,,'],
  ])('throws on %s', (_label, text) => {
    expect(() => sheetOf(text)).toThrow(/does not contain any data/);
  });
});

describe('importTable', () => {
  /**
   * Cells by position. Two separately built worksheets never compare equal as
   * objects — `createWorksheetAxisId` mints a fresh id per row and column, so
   * the cell keys differ even when every value matches.
   */
  function cellsOf(ws: Worksheet, rows: number, columns: number) {
    return Array.from({ length: rows }, (_, r) =>
      Array.from({ length: columns }, (_, c) =>
        getWorksheetCell(ws, { r: r + 1, c: c + 1 }),
      ),
    );
  }

  // The whole reason `toImportText` exists: a table that arrives already typed
  // must produce the same cells as the equivalent CSV text, or the file's size
  // would decide its cell types. Values here are shaped the way they actually
  // arrive — a JSON response, so dates are already strings.
  it('lands wire values on the same cells the CSV text would have', () => {
    const wire = tableOf([
      ['name', 'when', 'qty'],
      ['apple', '2026-01-02', 3],
    ]);
    const text = sheetOf('name,when,qty\napple,2026-01-02,3');

    expect(cellsOf(wire, 2, 3)).toEqual(cellsOf(text, 2, 3));
    expect(wire.rangeStyles).toEqual(text.rangeStyles);
  });

  // The production path. A server reading with type inference off sends the
  // file's own text, so these are the forms that actually arrive — a `Date`
  // cannot survive JSON in any case.
  it.each([
    ['a plain date', '2026-01-02', '2026-01-02'],
    ['a datetime', '2026-01-02 14:30:00', '2026-01-02 14:30:00'],
  ])('reads %s from the wire as a date cell', (_label, sent, stored) => {
    const ws = tableOf([['when'], [sent]]);

    expect(getWorksheetCell(ws, { r: 2, c: 1 })).toEqual({
      v: stored,
      s: { nf: 'date' },
    });
  });

  // Pins the deliberate non-conversion: an ISO-8601 timestamp stays text.
  // Inferring it as a date would change what a plain CSV containing one does,
  // and this function serves that path too.
  it('leaves an ISO-8601 timestamp as text', () => {
    const ws = tableOf([['when'], ['2026-01-02T00:00:00.000Z']]);

    expect(getWorksheetCell(ws, { r: 2, c: 1 })).toEqual({
      v: '2026-01-02T00:00:00.000Z',
    });
  });

  // Only reachable in-process; `JSON.stringify` would otherwise quote it.
  it.each([
    ['midnight', '2026-01-02T00:00:00Z', '2026-01-02'],
    ['a time', '2026-01-02T14:30:00Z', '2026-01-02 14:30:00'],
  ])('normalizes an in-process Date at %s', (_label, iso, stored) => {
    const ws = tableOf([['when'], [new Date(iso)]]);

    expect(getWorksheetCell(ws, { r: 2, c: 1 })).toEqual({
      v: stored,
      s: { nf: 'date' },
    });
  });

  it('writes no cell for null or undefined instead of the literal text', () => {
    const ws = tableOf([
      ['a', 'b', 'c'],
      [null, undefined, 'x'],
    ]);

    // `toCell` renders null as the string "null"; a NULL is an empty cell.
    expect(getWorksheetCell(ws, { r: 2, c: 1 })).toBeUndefined();
    expect(getWorksheetCell(ws, { r: 2, c: 2 })).toBeUndefined();
    expect(getWorksheetCell(ws, { r: 2, c: 3 })).toEqual({ v: 'x' });
  });

  it('normalizes real numbers and booleans the way their text form infers', () => {
    const ws = tableOf([
      ['n', 'b'],
      [1234, true],
    ]);

    expect(getWorksheetCell(ws, { r: 2, c: 1 })).toEqual({ v: '1234' });
    expect(getWorksheetCell(ws, { r: 2, c: 2 })).toEqual({ v: 'TRUE' });
  });

  it('renders a nested value as JSON, the same as ReadOnlyStore', () => {
    const ws = tableOf([['meta'], [{ a: 1 }]]);

    expect(getWorksheetCell(ws, { r: 2, c: 1 })).toEqual({ v: '{"a":1}' });
  });

  it('bolds row 0, so column names passed in become the header', () => {
    const ws = tableOf([
      ['name', 'qty'],
      ['apple', 3],
    ]);

    expect(ws.rangeStyles).toEqual([
      {
        range: [
          { r: 1, c: 1 },
          { r: 1, c: 2 },
        ],
        style: { b: true },
      },
    ]);
  });

  // A backend parser that finds no header hands back placeholder column names,
  // which the caller drops — so row 0 is one of the user's own records and
  // styling it as a heading would misrepresent their file.
  it('leaves the first row plain when the source had no header', () => {
    const ws = tableOf(
      [
        ['apple', 3],
        ['pear', 10],
      ],
      { hasHeader: false },
    );

    expect(ws.rangeStyles).toBeUndefined();
    expect(getWorksheetCell(ws, { r: 1, c: 1 })).toEqual({ v: 'apple' });
  });

  // Auto-detection scores candidates by field-count consistency, so one comma
  // inside a tab-separated file outscores the tabs and swallows the row into a
  // single cell. A blank line does the same. Both are silent — at most
  // `UndetectableDelimiter`, which this importer ignores as noise. The server's
  // reader gets these right, so guessing here would make file size decide how a
  // row splits.
  it.each([
    ['a comma inside a field', 'a\tb\n1,5\t2\n'],
    ['a blank line', 'a\tb\n\n1\t2\n'],
    ['a comma-heavy header', 'a\tb,c,d\n1\t2,3,4\n'],
  ])('splits a tab-separated file with %s when told the delimiter', (_l, text) => {
    const guessed = importCsv(text).worksheet;
    const told = importCsv(text, { delimiter: '\t' }).worksheet;

    // Told: two columns, the tab honoured.
    expect(getWorksheetCell(told, { r: 1, c: 1 })).toEqual({ v: 'a' });
    expect(getWorksheetCell(told, { r: 1, c: 2 })).toBeDefined();
    // Guessed: everything before the first comma lands in one cell.
    expect(getWorksheetCell(guessed, { r: 1, c: 1 })).not.toEqual({ v: 'a' });
  });

  // `.csv` keeps guessing on purpose — the extension does not promise a comma
  // and semicolon-separated exports are common.
  it('still detects a semicolon file when no delimiter is given', () => {
    const ws = sheetOf('a;b;c\n1;2;3\n');

    expect(getWorksheetCell(ws, { r: 1, c: 1 })).toEqual({ v: 'a' });
    expect(getWorksheetCell(ws, { r: 1, c: 3 })).toEqual({ v: 'c' });
  });

  it('throws when no value produced a cell', () => {
    expect(() =>
      tableOf([
        [null, ''],
        ['   ', undefined],
      ]),
    ).toThrow(/does not contain any data/);
  });

  // A row wider than the whole budget can never write a cell, so the
  // `cellCount === 0` guard above would otherwise call this "no data" — wrong,
  // and inconsistent with the backend path's identical check for the same
  // shape of failure (`file-import.service.ts`).
  it('throws "too many columns", not "no data", when the first row alone busts the cap', () => {
    expect(() =>
      tableOf([Array.from({ length: MAX_IMPORT_CELLS + 1 }, (_, c) => `v${c}`)]),
    ).toThrow(/too many columns to import \(50001\)/);
  });
});

// Proving the cap binds means writing a full budget of cells, which is real
// work (~2s), so the cases that do get a timeout of their own instead of the
// 5s default they sit just under on an idle machine and exceed under load.
const CAP_TEST_TIMEOUT = 20_000;

describe('importTable cell cap', () => {
  const table = (columns: number, rows: number) =>
    Array.from({ length: rows }, (_, r) =>
      Array.from({ length: columns }, (_, c) => `v${r}_${c}`),
    );

  it('reports what it wrote when nothing was cut', () => {
    const result = importTable(table(4, 10));

    expect(result.truncated).toBe(false);
    expect(result.rowCount).toBe(10);
  });

  // `rowCount` is rows *written*, header included — it feeds the "only the
  // first N rows were imported" warning, which speaks about the file, whose
  // first row is the header. Redefining it as data records would contradict
  // the budget the cap is expressed in, and the two paths would disagree:
  // the client prepends nothing, the backend prepends column names.
  it('counts a header row like any other written row', () => {
    const withHeader = importTable([['name', 'qty'], ...table(2, 9)]);
    const headerless = importTable(table(2, 9), { hasHeader: false });

    expect(withHeader.rowCount).toBe(10);
    expect(headerless.rowCount).toBe(9);
  });

  it('stops on a row boundary once the budget is spent', () => {
    const columns = 8;
    const allowed = MAX_IMPORT_CELLS / columns;
    const result = importTable(table(columns, allowed + 50));

    expect(result.truncated).toBe(true);
    expect(result.rowCount).toBe(allowed);
    // The last kept row is whole — a partial record would have a different
    // column count from every row above it.
    expect(getWorksheetCell(result.worksheet, { r: allowed, c: columns })).toEqual(
      { v: `v${allowed - 1}_${columns - 1}` },
    );
    expect(
      getWorksheetCell(result.worksheet, { r: allowed + 1, c: 1 }),
    ).toBeUndefined();
  }, CAP_TEST_TIMEOUT);

  // The budget is cells, so the row count it buys depends on the shape. A
  // fixed row limit would cut a narrow file that fits comfortably.
  it('keeps more rows from a narrow table than a wide one', () => {
    const wide = importTable(table(50, 2000));
    const narrow = importTable(table(2, 2000));

    expect(wide.truncated).toBe(true);
    expect(wide.rowCount).toBe(MAX_IMPORT_CELLS / 50);
    expect(narrow.truncated).toBe(false);
    expect(narrow.rowCount).toBe(2000);
  }, CAP_TEST_TIMEOUT);

  // The cap is what keeps a large file from reaching `applyImportedContent`
  // and dying there with a raw `document size exceeded`, so it has to hold on
  // the client path too — not only on the one that goes through the server.
  it(
    'applies to the papaparse path as well',
    () => {
      const columns = 5;
      const rows = MAX_IMPORT_CELLS / columns + 100;
      const csv = Array.from({ length: rows }, (_, r) =>
        Array.from({ length: columns }, (_, c) => `v${r}_${c}`).join(','),
      ).join('\n');

      const result = importCsv(csv);

      expect(result.truncated).toBe(true);
      expect(result.rowCount).toBe(MAX_IMPORT_CELLS / columns);
    },
    CAP_TEST_TIMEOUT,
  );
});
