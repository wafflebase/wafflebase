import type { ImportedSheet } from './imported-sheet';
import { importRecordsAsSheet, type ImportedRecord } from './record-importer';

export type JsonImportMode = 'auto' | 'ndjson';

export type JsonImportOptions = {
  sheetName: string;
  mode?: JsonImportMode;
};

type JsonRecord = ImportedRecord;

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

export function importJsonText(
  text: string,
  options: JsonImportOptions,
): ImportedSheet {
  const records = parseRecords(text, options.mode ?? 'auto');
  return importRecordsAsSheet(records, {
    sheetName: options.sheetName,
    fallbackName: 'Imported JSON',
    formatName: 'JSON',
  });
}
