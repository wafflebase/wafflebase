import { toCell } from '../store/readonly';
import { cellFromInput } from '../model/worksheet/input';
import { isEmptyCell } from '../model/worksheet/style-mutation';
import { createWorksheet } from '../model/workbook/worksheet-document';
import { writeWorksheetCell } from '../model/workbook/worksheet-grid';
import type { ImportedSheet } from './imported-sheet';

export type ImportedRecord = Record<string, unknown>;

export type RecordImportOptions = {
  sheetName: string;
  fallbackName: string;
  formatName: string;
};

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
      const value = record[column];
      if (value === null || value === undefined) {
        return;
      }
      const cell = cellFromInput(toCell(value));
      if (isEmptyCell(cell)) {
        return;
      }
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
