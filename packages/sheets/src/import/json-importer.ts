import { toCell } from '../store/readonly';
import { cellFromInput } from '../model/worksheet/input';
import { isEmptyCell } from '../model/worksheet/style-mutation';
import { createWorksheet } from '../model/workbook/worksheet-document';
import { writeWorksheetCell } from '../model/workbook/worksheet-grid';
import type { ImportedSheet } from './imported-sheet';

export type JsonImportMode = 'auto' | 'ndjson';

export type JsonImportOptions = {
  sheetName: string;
  mode?: JsonImportMode;
};

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function noRecordsError(): Error {
  return new Error('JSON import contains no records');
}

function recordsFromParsedJson(parsed: unknown): JsonRecord[] {
  if (isJsonRecord(parsed)) {
    return [parsed];
  }

  if (!Array.isArray(parsed)) {
    throw new Error('JSON must be an object or an array of objects');
  }
  if (parsed.length === 0) {
    throw noRecordsError();
  }

  return parsed.map((value, index) => {
    if (!isJsonRecord(value)) {
      throw new Error(`JSON record ${index + 1} must be an object`);
    }
    return value;
  });
}

function parseNdjson(text: string): JsonRecord[] {
  const records: JsonRecord[] = [];
  const lines = text.split(/\r\n|\n|\r/);

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      const message = error instanceof Error ? `: ${error.message}` : '';
      throw new Error(`Invalid NDJSON at line ${index + 1}${message}`);
    }

    if (!isJsonRecord(parsed)) {
      throw new Error(`NDJSON line ${index + 1} must be a JSON object`);
    }
    records.push(parsed);
  });

  if (records.length === 0) {
    throw noRecordsError();
  }
  return records;
}

function parseRecords(text: string, mode: JsonImportMode): JsonRecord[] {
  const withoutBom = text.replace(/^\uFEFF/, '');
  if (!withoutBom.trim()) {
    throw noRecordsError();
  }

  if (mode === 'ndjson') {
    return parseNdjson(withoutBom);
  }

  try {
    return recordsFromParsedJson(JSON.parse(withoutBom));
  } catch (error) {
    if (error instanceof SyntaxError) {
      return parseNdjson(withoutBom);
    }
    throw error;
  }
}

function collectColumns(records: JsonRecord[]): string[] {
  const columns = new Set<string>();
  for (const record of records) {
    for (const key of Object.keys(record)) {
      columns.add(key);
    }
  }
  if (columns.size === 0) {
    throw new Error('JSON import contains no columns');
  }
  return [...columns];
}

export function importJsonText(
  text: string,
  options: JsonImportOptions,
): ImportedSheet {
  const records = parseRecords(text, options.mode ?? 'auto');
  const columns = collectColumns(records);
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
    name: options.sheetName.trim() || 'Imported JSON',
    worksheet,
    cellCount,
    rowCount: records.length + 1,
    columnCount: columns.length,
  };
}
