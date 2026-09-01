import { toCell } from '../store/readonly';
import { cellFromInput } from '../model/worksheet/input';
import type { Cell } from '../model/core/types';
import { isEmptyCell } from '../model/worksheet/style-mutation';
import { createWorksheet } from '../model/workbook/worksheet-document';
import { writeWorksheetCell } from '../model/workbook/worksheet-grid';
import type { ImportedSheet } from './imported-sheet';
import { createImportBudget } from './csv-importer';

export type ImportedRecord = Record<string, unknown>;

export type RecordImportOptions = {
  sheetName: string;
  fallbackName: string;
  formatName: string;
  /** Converts a source value to a cell. Defaults to normal sheet inference. */
  cellForValue?: (value: unknown) => Cell | undefined;
  /** Reject before writing when the CSV document/grid budget would overflow. */
  enforceImportBudget?: boolean;
};

function defaultCellForValue(value: unknown): Cell | undefined {
  if (value === null || value === undefined) return undefined;
  const cell = cellFromInput(toCell(value));
  return isEmptyCell(cell) ? undefined : cell;
}

function assertRecordsFitImportBudget(
  records: ImportedRecord[],
  columns: string[],
  cellForValue: (value: unknown) => Cell | undefined,
  formatName: string,
): void {
  const budget = createImportBudget();
  const headerCells = columns.map<Cell>((column) => ({
    v: column,
    s: { b: true },
  }));
  if (budget.tryAddRow(headerCells)) {
    throw new Error(`${formatName} import exceeds the spreadsheet limit`);
  }

  for (const record of records) {
    const cells = columns
      .map((column) => cellForValue(record[column]))
      .filter((cell): cell is Cell => cell !== undefined);
    if (budget.tryAddRow(cells)) {
      throw new Error(`${formatName} import exceeds the spreadsheet limit`);
    }
  }
}

function collectColumns(
  records: ImportedRecord[],
  formatName: string,
): string[] {
  const columns = new Set<string>();
  for (const record of records) {
    for (const key of Object.keys(record)) {
      columns.add(key);
    }
  }
  if (columns.size === 0) {
    throw new Error(`${formatName} import contains no columns`);
  }
  return [...columns];
}

/**
 * Converts tabular records from a file parser into a single editable sheet.
 */
export function importRecordsAsSheet(
  records: ImportedRecord[],
  options: RecordImportOptions,
): ImportedSheet {
  if (records.length === 0) {
    throw new Error(`${options.formatName} import contains no records`);
  }

  const columns = collectColumns(records, options.formatName);
  const cellForValue = options.cellForValue ?? defaultCellForValue;

  if (options.enforceImportBudget) {
    assertRecordsFitImportBudget(
      records,
      columns,
      cellForValue,
      options.formatName,
    );
  }

  const worksheet = createWorksheet();
  let cellCount = 0;

  columns.forEach((column, index) => {
    writeWorksheetCell(
      worksheet,
      { r: 1, c: index + 1 },
      { v: column, s: { b: true } },
    );
    cellCount += 1;
  });

  records.forEach((record, rowIndex) => {
    columns.forEach((column, columnIndex) => {
      const cell = cellForValue(record[column]);
      if (!cell) return;
      writeWorksheetCell(
        worksheet,
        { r: rowIndex + 2, c: columnIndex + 1 },
        cell,
      );
      cellCount += 1;
    });
  });

  return {
    name: options.sheetName.trim() || options.fallbackName,
    worksheet,
    cellCount,
    rowCount: records.length + 1,
    columnCount: columns.length,
  };
}
