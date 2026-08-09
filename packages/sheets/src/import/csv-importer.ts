import type { Cell } from '../model/core/types';
import { createWorksheet } from '../model/workbook/worksheet-document';
import {
  ensureWorksheetExtent,
  replaceWorksheetCells,
} from '../model/workbook/worksheet-grid';
import type { Ref } from '../model/core/types';
import { cellFromInput } from '../model/worksheet/input';
import type { ImportedSheet } from './imported-sheet';

/**
 * `toImportText` renders one source value as the text `inferInput` would have
 * seen had the same table arrived as CSV.
 *
 * The parameter is `unknown` rather than `string` because the callers disagree:
 * a CSV parser hands over `string[]`, while an in-process caller (a query
 * result, a future non-CSV importer) hands over real `number`s, `Date`s and
 * `null`s. Both have to land on the same cell — otherwise where a table came
 * from would decide its cell types.
 *
 * There is deliberately **no** ISO-8601 normalization for strings: this
 * function also serves the CSV path, so normalizing here would rewrite a plain
 * text file that happens to contain a timestamp. The `Date` branch exists only
 * because `importTable` accepts `unknown` and `JSON.stringify(new Date())`
 * yields a *quoted* string, which would be silently wrong rather than merely
 * unhandled — it normalizes to the two forms `inferInput` recognizes.
 */
function toImportText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    // UTC. A midnight timestamp becomes a plain date so it infers as one.
    const iso = value.toISOString();
    const time = iso.slice(11, 19);
    return time === '00:00:00'
      ? iso.slice(0, 10)
      : `${iso.slice(0, 10)} ${time}`;
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * `toImportCell` normalizes one field through `cellFromInput`, the same entry
 * point a paste and a JSON import use, with one deliberate exception: a leading
 * `=` is kept as literal text.
 *
 * The import path writes the document directly and never runs the calculator,
 * so a formula cell would carry no cached value and render blank
 * (`toDisplayString` reads only `v`). XLSX can store a formula because Excel
 * ships its cached value alongside; CSV has none. Re-entering the cell commits
 * a real formula.
 *
 * The `=` test is `inferInput`'s own (it classifies a formula by exactly this
 * prefix on the trimmed input), applied before `cellFromInput` rather than
 * after so the text is inferred once.
 */
function toImportCell(value: unknown): Cell | undefined {
  const text = toImportText(value);
  // `inferInput` trims, so a whitespace-only field would store an empty `v`.
  // Skip it instead — one less CRDT subtree, same rendered result.
  const trimmed = text.trim();
  if (trimmed === '') {
    return undefined;
  }

  if (trimmed.startsWith('=')) {
    return { v: trimmed };
  }
  return cellFromInput(text);
}

/**
 * What an import is ultimately bounded by: the Yorkie document byte ceiling.
 *
 * `MaxSizePerDocument` is 10,485,760 bytes on the project this app attaches to
 * (verified against a live server, and the default `NewProjectInfo` assigns in
 * `yorkie/server/backend/database/project_info.go`). Past it, `doc.update()`
 * throws `document size exceeds the limit` — at persist time, long after the
 * user picked the file, with nothing they can do about it.
 *
 * The budget here is deliberately well under that. The estimate below is
 * approximate, a document also carries tab metadata and whatever styling the
 * user adds afterwards, and running a sheet right up to a hard CRDT ceiling
 * leaves no room to edit it.
 */
const MAX_IMPORT_BYTES = 8_000_000;

/**
 * Measured CRDT cost of one cell beyond the text it holds.
 *
 * From `packages/frontend/src/app/spreadsheet/csv-doc-size.test.ts`, which
 * walks real worksheets through a Yorkie document and reads `getDocSize()`
 * back: 113–124 bytes per cell across shapes from 3x1000 to 200x50 at
 * 8-character values. Almost all of it is CRDT metadata — a subtree per cell
 * plus its axis ids — which is why it barely moves with table shape.
 */
const CELL_OVERHEAD_BYTES = 110;

/**
 * Bytes Yorkie charges per character of cell text.
 *
 * Two, not one: it sizes strings as UTF-16. Measured rather than assumed — the
 * same test reports 124 B/cell at 8-character values and 503 B/cell at
 * 200-character ones, and 379 bytes across 192 extra characters is 1.97 each.
 *
 * This is the difference between a budget that holds and one that does not. A
 * per-cell estimate that ignores it lets a column of prose through at 320 B/cell
 * when the document is really charged ~503, which overshoots the ceiling by 20%
 * — exactly the unrecoverable persist-time failure the budget exists to stop.
 */
const BYTES_PER_CHARACTER = 2;

/**
 * Extra CRDT bytes a cell's `s` (style) object costs, on top of
 * `CELL_OVERHEAD_BYTES`.
 *
 * `toImportCell` attaches a style whenever a field infers as a date, percent,
 * or currency (`applyInferredFormat`) — all common in real CSVs (order dates,
 * prices). Measured with the same method as the other constants here, holding
 * character count fixed to isolate the style's own cost: a date's `{nf:
 * 'date'}` (one key) added ~106 bytes over an unstyled cell of the same
 * length; a currency's `{nf: 'currency', cu: 'USD'}` (two keys) added ~160.
 *
 * This was previously not charged at all — a bug a code review caught. The
 * estimator only counted `cell.v.length`, so a column of dates or prices was
 * undercounted by roughly 2x (measured 223.6 B/cell for dates against a
 * ~130 B/cell estimate), which can carry an import past the real Yorkie
 * ceiling despite `MAX_IMPORT_BYTES` reporting comfortable headroom — the
 * exact unrecoverable persist-time failure this budget exists to prevent.
 *
 * 160 is the higher of the two measured cases (currency's two-key style),
 * applied to every styled cell rather than per format, so a future format
 * with its own style shape is never assumed cheaper than what was measured.
 */
const STYLE_OVERHEAD_BYTES = 160;

/**
 * How many cells one import may materialize.
 *
 * A second bound alongside the byte budget, because the two constrain different
 * things: bytes bound what Yorkie will accept, cells bound how big a *grid* a
 * browser has to render and a person has to edit. A file of 500,000 one-character
 * cells fits in the byte budget and is still not a spreadsheet anyone can use.
 *
 * 40,000 keeps the worst measured shape (122 B/cell) at ~4.9 MB — under half the
 * ceiling — while leaving typical files far more rows than a row cap would: a
 * 3-column file gets 13,333 rows rather than being cut at a row count chosen for
 * a shape it does not have.
 */
export const MAX_IMPORT_CELLS = 40_000;

/**
 * What a streamed table import produces.
 *
 * Extends the format-neutral `ImportedSheet` the XLSX and JSON importers
 * already return, so a table can go straight into
 * `createSpreadsheetDocumentFromImportedSheets` with them. `truncated` is the
 * one field they have no use for: neither of those importers has a budget, so
 * neither can stop short.
 */
export interface ImportedTable extends ImportedSheet {
  /**
   * How many rows the imported sheet has — its row extent, the position of the
   * last row holding a cell.
   *
   * Deliberately the extent rather than a count of rows that produced cells,
   * because this number is what the truncation message shows the user and the
   * extent is the only one of the three candidates they can check. A file with
   * blank separator rows makes all three diverge (measured: 55 source lines,
   * 54 rows of extent, 50 rows that produced a cell) — of those, the source's
   * line count is not tracked here at all, and a count of populated rows
   * matches neither the file the user opens in an editor nor the sheet they
   * are looking at. The extent matches the sheet.
   *
   * Trailing blank rows are excluded (the extent stops at the last cell), so
   * this never overstates what arrived.
   */
  rowCount: number;
  /**
   * Cells actually written — the exact figure, not `rowCount * columns`, which
   * overstates any table with a blank row or a ragged edge.
   */
  cellCount: number;
  /**
   * The source had more data than a budget allowed — either `MAX_IMPORT_CELLS`
   * or the document byte budget, whichever bound first.
   */
  truncated: boolean;
}

/**
 * A row-at-a-time worksheet builder.
 *
 * This exists because the client parser is a *stream*: papaparse hands rows to
 * a callback one at a time, so there is no array for a caller to iterate. The
 * writer owns the loop position instead, and `push` returning `false` is the
 * signal to stop feeding — the caller turns that into `parser.abort()`, which
 * is what keeps import cost proportional to the budget rather than to file
 * size.
 *
 * The cell budget lives here rather than in any caller: this is the one place
 * every *row-major table* import (CSV/TSV today) meets, and a budget enforced
 * in only some of them would let *how* a table arrived decide whether it
 * imports at all.
 *
 * This does **not** cover XLSX: `xlsx-importer.ts` builds a `Worksheet`
 * directly from workbook XML and never calls `createTableWriter`/`importTable`,
 * so it has no size cap of its own today — noted here because a claim like
 * "every import path" invites exactly that assumption.
 */
export interface TableWriter {
  /**
   * Writes one row. Returns `false` when the budget is exhausted — in which
   * case the row was **not** written and the caller must stop.
   */
  push(row: ReadonlyArray<unknown>): boolean;
  /** Builds the final table. Throws when nothing could be imported. */
  finish(): ImportedTable;
}

/**
 * `createTableWriter` starts a worksheet that rows can be streamed into.
 *
 * `hasHeader` defaults to true because most callers cannot tell: papaparse
 * reports no such signal, so the CSV path assumes a header the way every
 * spreadsheet import does. Pass `false` only when the source actually says so —
 * bolding a record the user wrote is worse than leaving a header plain.
 */
export function createTableWriter(options?: {
  hasHeader?: boolean;
  /**
   * Names the resulting sheet, the way `importJsonText` takes its `sheetName`.
   * A CSV carries no internal name of its own — it is just rows — so the only
   * caller that can supply one is whoever knows where the rows came from.
   */
  sheetName?: string;
}): TableWriter {
  const worksheet = createWorksheet();
  // Cells are collected and written in one pass at `finish` rather than as they
  // arrive. Writing each cell straight into the worksheet grows the row axis by
  // one per row, and every growth rescans that axis to keep its generated ids
  // unique — which makes the fill quadratic in row count (measurably: ~20s for
  // 50k cells, ~30ms buffered). The buffer costs nothing extra in practice: it
  // is bounded by the same budget the worksheet is.
  const pending: Array<[Ref, Cell]> = [];
  let maxColumn = 0;
  let cellCount = 0;
  let byteCount = 0;
  let rowIndex = 0;
  let truncated = false;
  // The header is the first row that produced a cell, not necessarily row 1:
  // leading blank rows are kept, and bolding one of those would leave the real
  // header plain.
  let headerRow = 0;
  let oversizedRowWidth: number | undefined;

  return {
    push(row: ReadonlyArray<unknown>): boolean {
      // Checked before writing, so truncation always lands on a row boundary.
      // Half a record is not something anyone can edit, and its column count
      // would silently differ from every row above it.
      if (cellCount + row.length > MAX_IMPORT_CELLS) {
        truncated = true;
        oversizedRowWidth = row.length;
        return false;
      }

      // Converted before anything is committed, so the byte cost of the row is
      // known while it can still be rejected whole. A row half-written would
      // have a column count silently different from every row above it.
      const converted: Array<[number, Cell]> = [];
      let rowBytes = 0;
      for (let columnIndex = 0; columnIndex < row.length; columnIndex++) {
        const cell = toImportCell(row[columnIndex]);
        if (!cell) continue;
        converted.push([columnIndex + 1, cell]);
        rowBytes +=
          CELL_OVERHEAD_BYTES +
          (cell.v?.length ?? 0) * BYTES_PER_CHARACTER +
          (cell.s ? STYLE_OVERHEAD_BYTES : 0);
      }

      // The byte budget is what actually protects the document, and it is the
      // binding one for text-heavy files: at ~8-character values a cell costs
      // ~122 bytes, but a column of prose runs several times that, so a file
      // can exhaust the document long before it exhausts the cell count.
      if (byteCount + rowBytes > MAX_IMPORT_BYTES) {
        truncated = true;
        return false;
      }

      rowIndex += 1;
      for (const [column, cell] of converted) {
        pending.push([{ r: rowIndex, c: column }, cell]);
        if (column > maxColumn) maxColumn = column;
        if (headerRow === 0) headerRow = rowIndex;
      }
      cellCount += converted.length;
      byteCount += rowBytes;
      return true;
    },

    finish(): ImportedTable {
      // Guard on what was written, not on the row count: an empty source, a
      // whitespace-only one and one of entirely empty fields all arrive here
      // with rows but no cells. This also guarantees `headerRow` was set below.
      if (cellCount === 0) {
        // A first row that busted a budget on its own is a table that cannot be
        // imported at all, which is a different problem from a file with no
        // data — and the two budgets fail for different reasons, so they say so
        // separately rather than blaming columns for a row of long text.
        if (oversizedRowWidth !== undefined) {
          throw new Error(
            `This file has too many columns to import (${oversizedRowWidth}).`,
          );
        }
        if (truncated) {
          throw new Error(
            'This file has too much data in a single row to import.',
          );
        }
        throw new Error('This file does not contain any data.');
      }

      // Grow both axes to the final extent once, then fill. The last buffered
      // cell is the bottom-most one written, so its row is the extent — which
      // is also what `rowCount` reports, since a trailing blank row must not
      // inflate either the grid or the number the user is shown.
      const rowCount = pending[pending.length - 1][0].r;
      ensureWorksheetExtent(worksheet, { r: rowCount, c: maxColumn });
      replaceWorksheetCells(worksheet, pending);

      // One range patch for the whole header row rather than a style on each
      // cell: every per-cell patch is its own CRDT subtree, and stamping the
      // row cell-by-cell is what makes an imported document balloon (the XLSX
      // importer coalesces its patches for the same reason). The width is
      // `maxColumn` — the table's actual populated extent, already tracked
      // above at no extra cost — not the header row's own raw field count.
      // Using the header row's `row.length` instead was a bug: a header with
      // empty trailing fields (`name,qty,,` — `row.length` 4, 2 populated)
      // would bold columns the table never uses, so typing into one of those
      // columns later inherits bold unexpectedly. A header narrower than the
      // widest data row is the opposite case, and `maxColumn` gets that right
      // too — the bold band matches the table's real width either way.
      //
      // Skipped outright when the caller knows there is no header: the first
      // row is then one of the user's own records, and styling it as a heading
      // is a claim about their data that nothing supports.
      if (options?.hasHeader !== false) {
        worksheet.rangeStyles = [
          {
            range: [
              { r: headerRow, c: 1 },
              { r: headerRow, c: maxColumn },
            ],
            style: { b: true },
          },
        ];
      }

      return {
        name: options?.sheetName?.trim() || 'Imported Sheet',
        worksheet,
        rowCount,
        cellCount,
        columnCount: maxColumn,
        truncated,
      };
    },
  };
}

/**
 * `importTable` writes a row-major table into a single editable worksheet.
 *
 * A thin loop over `createTableWriter` so an in-memory table and a streamed one
 * cannot disagree about the budget, the header, or the empty-input error. Use
 * the writer directly when rows arrive incrementally.
 */
export function importTable(
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  options?: { hasHeader?: boolean },
): ImportedTable {
  const writer = createTableWriter(options);
  for (const row of rows) {
    if (!writer.push(row)) break;
  }
  return writer.finish();
}
