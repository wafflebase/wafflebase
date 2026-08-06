import { parse } from 'papaparse';
import type { Cell } from '../model/core/types';
import {
  createWorksheet,
  type Worksheet,
} from '../model/workbook/worksheet-document';
import { writeWorksheetCell } from '../model/workbook/worksheet-grid';
import {
  applyInferredFormat,
  inferInput,
  toStoredValue,
} from '../model/worksheet/input';
import { compactCell } from '../model/worksheet/style-mutation';

/**
 * `toImportText` renders one source value as the text `inferInput` would have
 * seen had the same table arrived as CSV. papaparse hands over `string[][]`; a
 * query engine hands over real `number`s and `null`s, and both have to land on
 * the same cell — otherwise the file's size decides its cell types.
 *
 * ## Why there is no date conversion on the hot path
 *
 * The server reads data files with type inference off, so a date column
 * arrives as the text the file held — the same text papaparse would have
 * produced. The two paths converge by construction rather than by agreement,
 * which is what keeps file size from deciding a cell's type.
 *
 * Normalizing ISO-8601 *strings* here would break that: this function also
 * serves the papaparse path, so it would rewrite a plain CSV that happens to
 * contain a timestamp, changing behavior for files that never touch a server.
 *
 * The `Date` branch below is only for an in-process caller — `importTable`
 * takes `unknown`, and `JSON.stringify(new Date())` yields a *quoted* string,
 * so falling through to the tail would be silently wrong rather than merely
 * unhandled. It normalizes to the two forms `inferInput` recognizes
 * (`parseIsoDate`, `parseDatetime`).
 */
function toImportText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    // UTC, and the same two forms the wire contract specifies. A midnight
    // timestamp becomes a plain date so it infers as one.
    const iso = value.toISOString();
    const time = iso.slice(11, 19);
    return time === '00:00:00'
      ? iso.slice(0, 10)
      : `${iso.slice(0, 10)} ${time}`;
  }
  // Same *tail* as `ReadOnlyStore`'s `toCell` (nested value → JSON, everything
  // else → `String()`), inlined: two lines are not worth an import edge from
  // `import/` into `store/`. Only this tail — the `Date`/null branches above
  // are deliberately different from `toCell`'s: this function feeds
  // `inferInput`, which wants a plain date/time string and an empty field for
  // a blank cell, not `toCell`'s full ISO timestamp and literal `"null"`.
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * `toImportCell` normalizes one field with the same inference a paste uses,
 * with one deliberate exception: a leading `=` is kept as literal text. The
 * import path writes the Yorkie document directly and never runs the
 * calculator, so a formula cell with no cached value would render blank
 * (`toDisplayString` reads only `v`). XLSX carries Excel's cached value
 * alongside the formula; CSV has none. Re-entering the cell commits a real
 * formula.
 */
function toImportCell(value: unknown): Cell | undefined {
  const text = toImportText(value);
  // `inferInput` trims, so a whitespace-only field would store an empty `v`.
  // Skip it instead — one less CRDT subtree, same rendered result.
  const trimmed = text.trim();
  if (trimmed === '') {
    return undefined;
  }

  const inferred = inferInput(text);
  if (inferred.type === 'formula') {
    return { v: trimmed };
  }
  return compactCell(
    { v: toStoredValue(inferred) },
    applyInferredFormat(undefined, inferred),
  );
}

/**
 * How many cells one import may materialize.
 *
 * The unit is cells, not rows, because that is the unit of the cost: the
 * import path writes one CRDT subtree per cell and a Yorkie document is capped
 * at 10 MB. Measured on this importer's own output at 10 columns, 1,000 rows
 * cost ~1.29 MB (≈87% of it CRDT metadata), so a 10-column sheet stops fitting
 * around 7,700 rows. 50,000 cells is 5,000 × 10 (≈6.4 MB) — inside the wall
 * with room for wider rows — while a 3-column file still gets ~16,600 rows
 * rather than being cut at a row count chosen for a shape it does not have.
 *
 * Without this a ~420 KB CSV fails in `applyImportedContent` with a raw
 * `document size exceeded`, which is neither actionable nor recoverable.
 */
export const MAX_IMPORT_CELLS = 50_000;

export interface ImportedTable {
  worksheet: Worksheet;
  /** Rows that produced at least one cell. */
  rowCount: number;
  /** The source had more rows than `MAX_IMPORT_CELLS` allowed. */
  truncated: boolean;
}

/**
 * `importTable` writes a row-major table into a single editable worksheet.
 *
 * Callers own the shape: a parser hands its rows straight through, while a
 * column/row result puts the column names in row 0 so they become the header.
 * Values are `unknown` rather than `string` because the callers disagree — see
 * `toImportText`.
 *
 * This is where both import paths meet — the client parser and the server one
 * — so the cell cap lives here rather than in either caller. A cap in only one
 * of them would let file *size* decide whether an import succeeds or dies.
 *
 * `hasHeader` defaults to true because most callers cannot tell: papaparse
 * reports no such signal, so the client path assumes a header the way every
 * spreadsheet import does. Pass `false` only when the source actually says so
 * — a parser that reports its own placeholder column names, for instance —
 * since bolding a record the user wrote is worse than leaving a header plain.
 */
export function importTable(
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  options?: { hasHeader?: boolean },
): ImportedTable {
  const worksheet = createWorksheet();
  let cellCount = 0;
  let rowCount = 0;
  let truncated = false;
  // The header is the first row that produced a cell, not necessarily row 1:
  // leading blank rows are kept (see `importCsv`), and bolding one of those
  // would leave the real header plain.
  let headerRow = 0;
  let headerWidth = 0;
  let oversizedRowWidth: number | undefined;
  for (const [rowIndex, row] of rows.entries()) {
    // Stop on a row boundary, never mid-row: half a record is not something
    // anyone can edit, and the column count would silently differ from every
    // row above it.
    if (cellCount + row.length > MAX_IMPORT_CELLS) {
      truncated = true;
      oversizedRowWidth = row.length;
      break;
    }
    let wroteCell = false;
    row.forEach((value, columnIndex) => {
      const cell = toImportCell(value);
      if (cell) {
        writeWorksheetCell(
          worksheet,
          { r: rowIndex + 1, c: columnIndex + 1 },
          cell,
        );
        cellCount += 1;
        wroteCell = true;
        if (headerRow === 0) {
          headerRow = rowIndex + 1;
          headerWidth = row.length;
        }
      }
    });
    if (wroteCell) rowCount += 1;
  }

  // Guard on what was actually written, not on the row count: an empty file, a
  // whitespace-only file and a file of empty fields all arrive here with rows
  // but no cells. This also guarantees `headerRow` was set below.
  if (cellCount === 0) {
    // `truncated` here means the very first row already busted the cap on its
    // own width — a table that cannot be imported at all, not one with no
    // data. Same distinction and wording as the backend path's equivalent
    // check (`file-import.service.ts`), so which side imports a file does not
    // change which error the user sees.
    if (truncated) {
      throw new Error(
        `This file has too many columns to import (${oversizedRowWidth}).`,
      );
    }
    throw new Error('This file does not contain any data.');
  }

  // The header row is bold — the same assumption `loadQueryResults` makes for
  // query results (`store/readonly.ts`). One range patch for the whole row:
  // unlike XLSX there are no per-cell styles to coalesce, and each patch is a
  // CRDT subtree. The width is that row's own field count, so trailing empty
  // fields are included but invisible; finding the last non-empty index is not
  // worth the extra pass.
  //
  // Skipped outright when the caller knows there is no header: the first row
  // is then one of the user's own records, and styling it as a heading is a
  // claim about their data that nothing supports.
  if (options?.hasHeader !== false) {
    worksheet.rangeStyles = [
      {
        range: [
          { r: headerRow, c: 1 },
          { r: headerRow, c: headerWidth },
        ],
        style: { b: true },
      },
    ];
  }

  return { worksheet, rowCount, truncated };
}

/**
 * `importCsv` parses CSV text into a single editable worksheet. A CSV file is
 * one table, so this returns one worksheet rather than a list — the caller
 * names the tab (`createSpreadsheetDocument`).
 * Callers own the decoding: `File.text()` decodes UTF-8 and strips a leading BOM.
 *
 * **Pass `delimiter` whenever the caller knows it.** Auto-detection scores the
 * candidates by how consistent a field count they produce, so a single comma
 * anywhere in a tab-separated file can outscore the tabs and take the whole row
 * as one cell — `a\tb` + `1,5\t2` parses to `["a\tb"]`. A blank line does the
 * same. Both report `UndetectableDelimiter` at most, which this importer treats
 * as noise (it fires for every single-column file), so the failure is silent.
 * The server's reader is not fooled by either, which would make file *size*
 * decide how the file splits — the one thing this import path must never do.
 * `.csv` is left to auto-detection on purpose: the extension does not promise a
 * comma, and semicolon-separated exports are common.
 *
 * `truncated` comes from `importTable`'s cell cap: a large file yields a
 * partial sheet plus a flag to say so, rather than a document Yorkie refuses.
 */
export function importCsv(
  text: string,
  options?: { delimiter?: string },
): ImportedTable {
  // No `skipEmptyLines` (papaparse defaults to keeping them). Both skip modes
  // drop a blank line inside the table and shift every row below it up; a kept
  // blank row writes no cells, so the trailing-newline artifact costs nothing.
  //
  // Only `MissingQuotes` is fatal: an unterminated quoted field makes papaparse
  // swallow the rest of the file into a single cell, which still writes cells and
  // would otherwise look like a successful import of one giant value. The other
  // errors are noise, including its sibling `InvalidQuotes` (a stray quote inside
  // a quoted field, e.g. `5" x 7"`), which papaparse recovers from and parses
  // correctly. A single-column file always reports `UndetectableDelimiter` even
  // though it parsed fine, and ragged rows report nothing at all (field-count
  // mismatches are a `header: true` feature) yet cannot shift a column, because
  // every row writes its cells by its own index.
  // `delimiter: undefined` is not the same as omitting it — papaparse treats an
  // explicit undefined as "no delimiter given" and guesses, which is what we
  // want for `.csv`.
  const { data, errors } = parse<string[]>(text, {
    delimiter: options?.delimiter,
  });
  if (errors.some((error) => error.code === 'MissingQuotes')) {
    // Not "CSV file": the same importer handles `.tsv`, and this string is
    // surfaced verbatim next to the file name in the upload panel.
    throw new Error('This file has an unterminated quoted field.');
  }

  return importTable(data);
}
